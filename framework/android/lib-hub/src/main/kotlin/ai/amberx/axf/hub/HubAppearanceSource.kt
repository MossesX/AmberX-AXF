package ai.amberx.axf.hub

import ai.amberx.axf.kernel.engine.AppearanceChange
import ai.amberx.axf.kernel.engine.AppearanceDocument
import ai.amberx.axf.kernel.engine.AppearanceEngine
import ai.amberx.axf.kernel.engine.AppearanceSourceState
import ai.amberx.axf.kernel.runtime.AppearanceEvent
import ai.amberx.axf.kernel.runtime.AppearanceSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Android implementation of the runtime's [AppearanceSource] (web: react/hubAppearance.ts): a developer app's
 * appearance document read from and written to axHub's data API.
 *
 *   read   GET  <hub>/data/shared/settings/appearance.json  (ETag = version; the hub's session cookie or bearer token)
 *   write  PUT  …  If-Match: "<version>"                    (409 → re-read, re-merge this app's keys, retry once)
 *   live   GET  <hub>/data-events?watch=shared/settings/appearance.json (SSE, long-lived; a `change` line re-reads)
 *          plus a re-read on every [refresh] (the app calls it on resume) and a periodic one as a safety net.
 *
 * Unreachable / signed out → the state says so and the runtime keeps the app on its waiting screen (no cached copy,
 * no default-theme run). Redirects are never followed (a credential never leaves the hub's origin).
 */
public class HubAppearanceSource(
    hub: String,
    private val appId: String,
    private val credentials: HubCredentials,
    client: OkHttpClient? = null,
    private val project: String = AppearanceEngine.PROJECT,
    private val path: String = AppearanceEngine.PATH,
    private val live: Boolean = true,
    private val pollMs: Long = 60_000,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) : AppearanceSource {
    override val origin: String = HubOrigin.normalize(hub) ?: throw IllegalArgumentException("HubAppearanceSource: the hub address must be https")
    private val http: OkHttpClient = (client ?: OkHttpClient()).newBuilder().followRedirects(false).followSslRedirects(false).connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private val stream: OkHttpClient = http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private val listeners = LinkedHashSet<(AppearanceEvent) -> Unit>()
    @Volatile private var st: AppearanceSourceState = AppearanceSourceState.Connecting
    @Volatile private var doc: AppearanceDocument? = null
    @Volatile private var version: String? = null
    private var attempt = 0
    private var running = false
    private var retry: Job? = null
    private var watch: Job? = null
    private val io = Mutex()
    private var pending: AppearanceChange? = null

    public val documentUrl: String get() = "$origin/data/$project/$path"
    override fun state(): AppearanceSourceState = st
    override fun subscribe(listener: (AppearanceEvent) -> Unit): () -> Unit { synchronized(listeners) { listeners += listener }; return { synchronized(listeners) { listeners -= listener } } }

    override fun start() { if (running) return; running = true; attempt = 0; scope.launch { load() } }
    override fun stop() { running = false; retry?.cancel(); watch?.cancel(); retry = null; watch = null }
    override fun refresh() { if (running) scope.launch { load() } }

    override fun save(change: AppearanceChange) {
        synchronized(this) {
            val p = pending
            pending = if (p == null) change else AppearanceChange(p.slots + change.slots, change.spacing ?: p.spacing, p.hidden + change.hidden, change.palette ?: p.palette)
        }
        scope.launch { flush() }
    }

    private fun emit(ev: AppearanceEvent) { val ls = synchronized(listeners) { listeners.toList() }; for (l in ls) l(ev) }
    private fun setState(s: AppearanceSourceState) { st = s; emit(AppearanceEvent.State(s)) }

    private fun Request.Builder.auth(): Request.Builder? = when (val c = credentials.current()) {
        is HubCredential.SessionCookie -> header("Cookie", c.cookie)
        is HubCredential.Bearer -> header("Authorization", "Bearer ${c.token}")
        null -> null
    }

    internal suspend fun load(): Unit = io.withLock {
        if (!running) return
        val req = Request.Builder().url(documentUrl).header("Accept", "application/json").auth()
        if (req == null) { unauthorized("Sign in to $origin first."); return }
        val r = withContext(Dispatchers.IO) { runCatching { http.newCall(req.get().build()).execute() } }.getOrElse { failed("Can't reach $origin: ${it.message?.take(120)}"); return }
        r.use { res ->
            when {
                res.code == 401 -> { unauthorized("Sign in to $origin first."); return }
                res.code == 403 -> { unauthorized("$origin doesn't allow this account to read settings."); return }
                res.code == 404 -> { doc = null; version = null }
                res.isSuccessful -> {
                    val text = res.body?.string().orEmpty()
                    val parsed = AppearanceEngine.parse(text)
                    if (text.isNotBlank() && parsed == null) { failed("The appearance document on the hub is not a valid appearance@1 document."); return }
                    doc = parsed
                    version = res.header("X-Data-Version") ?: res.header("ETag")?.removePrefix("W/")?.trim('"')
                }
                else -> { failed("$origin answered ${res.code}."); return }
            }
        }
        attempt = 0
        setState(AppearanceSourceState.Ready(version))
        emit(AppearanceEvent.Document(doc, version))
        startWatch()
        if (pending != null) scope.launch { flush() }
    }

    private fun failed(reason: String) {
        attempt += 1
        val ms = AppearanceEngine.retryMs(attempt - 1)
        setState(AppearanceSourceState.Unreachable(reason, ms, attempt))
        watch?.cancel(); watch = null
        retry?.cancel()
        retry = scope.launch { delay(ms); load() }
    }

    private fun unauthorized(reason: String) {
        setState(AppearanceSourceState.Unauthorized(reason))
        watch?.cancel(); watch = null
        retry?.cancel()
        retry = scope.launch { delay(15_000); load() }
    }

    /** Follow changes: the hub's SSE feed (a plain streamed GET through Traefik); falls back to polling. */
    private fun startWatch() {
        if (watch?.isActive == true || !running) return
        watch = scope.launch {
            if (!live) { delay(pollMs); load(); return@launch }
            val req = Request.Builder().url("$origin/data-events?watch=${java.net.URLEncoder.encode("$project/$path", "UTF-8")}").header("Accept", "text/event-stream").auth() ?: return@launch
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    stream.newCall(req.get().build()).execute().use { res ->
                        if (!res.isSuccessful) return@runCatching false
                        val src = res.body?.source() ?: return@runCatching false
                        var event = ""
                        while (running) {
                            val line = src.readUtf8Line() ?: break
                            when {
                                line.startsWith("event:") -> event = line.substringAfter(':').trim()
                                line.isEmpty() -> { if (event == "change") scope.launch { load() }; event = "" }
                            }
                        }
                        true
                    }
                }.getOrDefault(false)
            }
            // the stream ended: a plain re-read tells whether the hub is still there (and reopens the stream)
            if (running) { if (!ok) delay(pollMs.coerceAtMost(10_000)); watch = null; load() }
        }
    }

    private suspend fun flush(retried: Boolean = false) {
        val change = synchronized(this) { pending.also { pending = null } } ?: return
        if (st !is AppearanceSourceState.Ready) { synchronized(this) { pending = pending?.let { AppearanceChange(change.slots + it.slots, it.spacing ?: change.spacing, change.hidden + it.hidden, it.palette ?: change.palette) } ?: change }; return }
        val next = AppearanceEngine.merge(doc, change, appId, java.time.Instant.now().toString())
        val req = Request.Builder().url(documentUrl).header("Content-Type", "application/json").header("If-Match", version?.let { "\"$it\"" } ?: "new").auth()
        if (req == null) { unauthorized("Sign in to $origin to change the look."); return }
        val r = withContext(Dispatchers.IO) { runCatching { http.newCall(req.put(next.serialize().toRequestBody("application/json".toMediaType())).build()).execute() } }
            .getOrElse { synchronized(this) { pending = change }; failed("Couldn't save to $origin: ${it.message?.take(120)}"); return }
        r.use { res ->
            when {
                res.code == 409 && !retried -> { synchronized(this) { pending = change }; load(); flush(true) }
                res.code == 401 -> unauthorized("Sign in to $origin to change the look.")
                res.code == 403 -> unauthorized("Your hub account may not change the shared look (needs admin or data.write).")
                !res.isSuccessful -> failed("$origin refused the save (${res.code}).")
                else -> { doc = next; version = res.header("X-Data-Version") ?: res.header("ETag")?.removePrefix("W/")?.trim('"') ?: version; setState(AppearanceSourceState.Ready(version)) }
            }
        }
        if (pending != null) flush()
    }
}
