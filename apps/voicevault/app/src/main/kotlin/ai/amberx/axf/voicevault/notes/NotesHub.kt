package ai.amberx.axf.voicevault.notes

import ai.amberx.axf.hub.HubCredential
import ai.amberx.axf.hub.HubCredentials
import ai.amberx.axf.hub.HubOrigin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** What the listener knows about axHub right now. */
sealed interface HubNotesState {
    data object Idle : HubNotesState
    data object Loading : HubNotesState
    data class Ready(val settings: NotesSettings, val lists: List<NoteList>, val at: Long) : HubNotesState
    data class SignedOut(val why: String) : HubNotesState
    data class Unreachable(val why: String) : HubNotesState
}

class HubUnavailable(val signedOut: Boolean, message: String) : Exception(message)

/**
 * Voice notes on axHub's data server (axHub decision #88: `GET/PUT <hub>/data/<project>/<path>`, ETag / If-Match →
 * 409, 64 KB a file), read and written with the hub session cookie the app signed in with (lib-hub [HubCredentials]).
 * App code (Voice Vault): the Kotlin twin of lib-hubstore is deferred while Android framework work is on hold, so this
 * speaks the same hub-settings@1 / hub-table@1 frames itself. Nothing is cached on the phone: hub down = no notes.
 * Only voice-notes files are touched; nothing from the vault ever goes here. Redirects are never followed.
 */
class NotesHub(hub: String, private val credentials: HubCredentials, private val appId: String, private val device: String) {
    val origin: String = HubOrigin.normalize(hub) ?: throw IllegalArgumentException("The hub address must be https")
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private val tags = HashMap<String, String>()
    private val io = Mutex()
    private val _state = MutableStateFlow<HubNotesState>(HubNotesState.Idle)
    val state: StateFlow<HubNotesState> = _state.asStateFlow()

    private fun url(path: String) = "$origin/data/${Notes.HUB_PROJECT}/$path"

    private fun Request.Builder.auth(): Request.Builder = when (val c = credentials.current()) {
        is HubCredential.SessionCookie -> header("Cookie", c.cookie)
        is HubCredential.Bearer -> header("Authorization", "Bearer ${c.token}")
        null -> throw HubUnavailable(true, "Sign in to axHub in Voice Vault first (Settings → Voice notes).")
    }

    private fun fail(code: Int, path: String): Nothing = when (code) {
        401 -> throw HubUnavailable(true, "Signed out of axHub. Sign in again in Settings → Voice notes.")
        403 -> throw HubUnavailable(true, "Your axHub account may not use $path.")
        else -> throw HubUnavailable(false, "axHub answered $code for $path.")
    }

    private suspend fun get(path: String): JsonElement? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url(path)).header("Accept", "application/json").auth().get().build()
        val res = runCatching { http.newCall(req).execute() }.getOrElse { throw HubUnavailable(false, "Can't reach axHub (${it.message?.take(100)}).") }
        res.use { r ->
            if (r.code == 404) { tags.remove(path); return@withContext null }
            if (!r.isSuccessful) fail(r.code, path)
            r.header("ETag")?.let { tags[path] = it }
            runCatching { HubTables.json.parseToJsonElement(r.body?.string().orEmpty()) }.getOrNull()
        }
    }

    /** PUT with the version last read; false = someone saved first (409/412). */
    private suspend fun put(path: String, body: JsonElement): Boolean = withContext(Dispatchers.IO) {
        val text = HubTables.encode(body)
        require(text.length <= HubTables.FILE_MAX) { "$path is over axHub's 64 KB limit" }
        val b = Request.Builder().url(url(path)).header("Content-Type", "application/json").auth()
        tags[path]?.let { b.header("If-Match", it) }
        val res = runCatching { http.newCall(b.put(text.toRequestBody("application/json".toMediaType())).build()).execute() }.getOrElse { throw HubUnavailable(false, "Can't reach axHub (${it.message?.take(100)}).") }
        res.use { r ->
            if (r.code == 409 || r.code == 412) return@withContext false
            if (!r.isSuccessful) fail(r.code, path)
            r.header("ETag")?.let { tags[path] = it }
            true
        }
    }

    private suspend fun readTable(table: String): Map<String, JsonElement> {
        val head = HubTables.parseHead(get(HubTables.headPath(Notes.DATA_FOLDER, table))) ?: return emptyMap()
        head.rows?.let { return it }
        val out = LinkedHashMap<String, JsonElement>()
        for (i in 0 until head.chunks) (get(HubTables.chunkPath(Notes.DATA_FOLDER, table, i)) as? JsonObject)?.let { out.putAll(it) }
        return out
    }

    private suspend fun writeTable(table: String, rows: Map<String, JsonElement>): Boolean {
        val now = java.time.Instant.now().toString()
        val inline = HubTables.head(table, rows, now, null)
        if (HubTables.encode(inline).length <= HubTables.FILE_MAX - 500) return put(HubTables.headPath(Notes.DATA_FOLDER, table), inline)
        val parts = HubTables.chunk(rows)
        for ((i, p) in parts.withIndex()) { val path = HubTables.chunkPath(Notes.DATA_FOLDER, table, i); runCatching { get(path) }; put(path, JsonObject(p)) }
        return put(HubTables.headPath(Notes.DATA_FOLDER, table), HubTables.head(table, rows, now, parts.size))
    }

    /** Read the settings and lists made in the console (on start, on resume and before every note). */
    suspend fun load(): HubNotesState = io.withLock {
        if (_state.value !is HubNotesState.Ready) _state.value = HubNotesState.Loading
        val next = try {
            val settings = NotesRules.settings(HubTables.settingsValues(get(Notes.SETTINGS_FILE)))
            val lists = NotesRules.sorted(readTable(Notes.LISTS_TABLE).mapNotNull { (id, row) -> NotesRules.list(row, id) })
            HubNotesState.Ready(settings, lists, System.currentTimeMillis())
        } catch (e: HubUnavailable) {
            if (e.signedOut) HubNotesState.SignedOut(e.message ?: "Signed out") else HubNotesState.Unreachable(e.message ?: "Unreachable")
        }
        _state.value = next
        next
    }

    /** Add one note to table `notes` (re-read and re-apply when another device saved first). */
    suspend fun save(note: NoteRecord): Unit = io.withLock {
        repeat(4) {
            val rows = LinkedHashMap(readTable(Notes.NOTES_TABLE))
            rows[note.id] = note.toJson()
            if (writeTable(Notes.NOTES_TABLE, rows)) return@withLock
        }
        throw HubUnavailable(false, "The notes table kept changing on axHub; try again.")
    }

    fun newNote(list: NoteList, sub: Subcategory?, text: String, answers: Map<String, String>): NoteRecord =
        NoteRecord("note-${System.currentTimeMillis().toString(36)}${(0..999).random().toString(36)}", list.id, sub?.id.orEmpty(), text, answers, java.time.Instant.now().toString(), appId, device)
}
