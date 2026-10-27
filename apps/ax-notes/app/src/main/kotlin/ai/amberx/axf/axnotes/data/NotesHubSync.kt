package ai.amberx.axf.axnotes.data

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.serialization.json.JsonObject

/**
 * Where AX Notes keeps its copy on axHub: the project's `_data` area (axhub-projects@1:
 * `/projects/ax-notes/_data/<folder>/<collection>/<id>.json`), reached over the hub's data API
 * `GET/PUT/DELETE <hub>/data/<project>/<path>` (axHub decision #88: ETag / If-Match → 409, 64 KB a file).
 */
data class HubEndpoint(val hub: String, val project: String = PROJECT, val folder: String = FOLDER) {
    fun path(collection: String, id: String): String = "$folder/$collection/${safe(id)}.json"
    fun url(collection: String, id: String): String = "${hub.trimEnd('/')}/data/$project/${path(collection, id)}"
    fun indexUrl(collection: String): String = "${hub.trimEnd('/')}/data/$project/$folder/$collection/"

    companion object {
        const val PROJECT = "ax-notes"
        const val FOLDER = "notes"
        const val FILE_MAX = 64_000
        fun safe(id: String): String = id.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
    }
}

/**
 * The sync adapter the offline store talks to (one call per outbox entry, one pull per collection). The local
 * document store stays the source of truth; this only mirrors it to axHub.
 *
 * TODO(lib-hub data client — PORTING.md "lib-hubstore … Kotlin twin deferred", placeholder `axf.hubstore.android`):
 * back this with the shared lib-hub data client (OkHttp, session cookie from lib-hub HubCredentials, no redirects,
 * hub-table@1 frames if the hub wants tables). Until then [UnwiredHubSync] keeps every change queued locally.
 */
interface NotesHubSync {
    val endpoint: HubEndpoint?
    /** False = don't try (no hub configured / no client): the outbox keeps every change. */
    val ready: Boolean
    /** Write one record ([doc] = null deletes it). Unavailable = keep it queued and retry later. */
    suspend fun push(collection: String, id: String, doc: JsonObject?): AxfResult<Unit>
    /** Records changed on the hub since [sinceMillis] (their `updatedAt`). */
    suspend fun pull(collection: String, sinceMillis: Long): AxfResult<List<Pair<String, JsonObject>>>
}

/** Typed placeholder until a hub data client exists in the app: everything stays local and queued. */
class UnwiredHubSync(override val endpoint: HubEndpoint?) : NotesHubSync {
    override val ready: Boolean = false
    private val why = AxfFailure.Unavailable("axHub sync isn't wired in AX Notes yet; notes stay on this phone and sync once it is.")
    override suspend fun push(collection: String, id: String, doc: JsonObject?): AxfResult<Unit> = AxfResult.err(why)
    override suspend fun pull(collection: String, sinceMillis: Long): AxfResult<List<Pair<String, JsonObject>>> = AxfResult.err(why)
}
