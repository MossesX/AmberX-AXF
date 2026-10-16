package ai.amberx.axf.data

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject

/** A pending write waiting for connectivity. Persisted through the document store so it survives restarts. */
public data class OutboxEntry(val id: String, val collection: String, val op: String, val doc: JsonObject?, val atMillis: Long, val attempts: Int = 0)

/** How a conflict between a local change and a remote version is resolved. */
public enum class ConflictRule { LOCAL_WINS, REMOTE_WINS, LAST_WRITE_WINS, MANUAL }

/**
 * Offline-first repository base (Foundations: f.offline): the local document store is the source of truth,
 * every write is applied locally first and queued in the outbox, and [sync] drains the outbox then pulls
 * remote changes. Subclasses implement the remote side; `axf-network` supplies the transport.
 */
public abstract class OfflineFirstRepository(protected val docs: JsonDocumentStore, public val module: String, public val collection: String, public val conflictRule: ConflictRule = ConflictRule.LAST_WRITE_WINS) {
    private val _outbox = MutableStateFlow<List<OutboxEntry>>(loadOutbox())
    public val outbox: StateFlow<List<OutboxEntry>> get() = _outbox
    private val _syncing = MutableStateFlow(false)
    public val syncing: StateFlow<Boolean> get() = _syncing

    public fun all(): List<Pair<String, JsonObject>> = docs.list(module, collection).mapNotNull { id -> docs.read(module, collection, id).getOrNull()?.let { id to it } }
    public fun get(id: String): JsonObject? = docs.read(module, collection, id).getOrNull()
    public fun put(id: String, doc: JsonObject): AxfResult<Unit> { val r = docs.write(module, collection, id, doc); if (r.isOk) enqueue(OutboxEntry(id, collection, "put", doc, System.currentTimeMillis())); return r }
    public fun delete(id: String): Boolean { val ok = docs.delete(module, collection, id); if (ok) enqueue(OutboxEntry(id, collection, "delete", null, System.currentTimeMillis())); return ok }

    /** Push one outbox entry. Return Unavailable to retry later, any other failure to drop it. */
    protected abstract suspend fun push(entry: OutboxEntry): AxfResult<Unit>
    /** Pull remote documents newer than `sinceMillis`. */
    protected abstract suspend fun pull(sinceMillis: Long): AxfResult<List<Pair<String, JsonObject>>>

    public suspend fun sync(): AxfResult<Int> {
        if (_syncing.value) return AxfResult.ok(0)
        _syncing.value = true
        var pushed = 0
        try {
            for (e in _outbox.value.toList()) {
                when (val r = push(e)) {
                    is AxfResult.Ok -> { dequeue(e); pushed++ }
                    is AxfResult.Err -> if (r.failure is AxfFailure.Unavailable) { bump(e); return AxfResult.err(r.failure) } else dequeue(e)
                }
            }
            val since = docs.read(module, "_meta", "sync").getOrNull()?.get("at")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() } ?: 0L
            pull(since).onOk { remote -> for ((id, doc) in remote) if (resolve(id, doc)) docs.write(module, collection, id, doc) }
            docs.write(module, "_meta", "sync", kotlinx.serialization.json.buildJsonObject { put("at", kotlinx.serialization.json.JsonPrimitive(System.currentTimeMillis())) })
            return AxfResult.ok(pushed)
        } finally { _syncing.value = false }
    }

    /** Whether a remote doc replaces the local one. Override for MANUAL. */
    protected open fun resolve(id: String, remote: JsonObject): Boolean = when (conflictRule) {
        ConflictRule.REMOTE_WINS -> true
        ConflictRule.LOCAL_WINS -> _outbox.value.none { it.id == id }
        ConflictRule.LAST_WRITE_WINS -> { val localAt = _outbox.value.firstOrNull { it.id == id }?.atMillis ?: 0L; val remoteAt = (remote["updatedAt"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: Long.MAX_VALUE; remoteAt >= localAt }
        ConflictRule.MANUAL -> false
    }

    private fun enqueue(e: OutboxEntry) { _outbox.update { it.filterNot { x -> x.id == e.id && x.op == e.op } + e }; saveOutbox() }
    private fun dequeue(e: OutboxEntry) { _outbox.update { it - e }; saveOutbox() }
    private fun bump(e: OutboxEntry) { _outbox.update { l -> l.map { if (it === e) it.copy(attempts = it.attempts + 1) else it } }; saveOutbox() }
    private fun loadOutbox(): List<OutboxEntry> = docs.list(module, "_outbox").mapNotNull { id -> docs.read(module, "_outbox", id).getOrNull()?.let { o -> OutboxEntry(id, (o["collection"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: collection, (o["op"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "put", o["doc"] as? JsonObject, (o["at"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: 0L, (o["attempts"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() ?: 0) } }
    private fun saveOutbox() {
        val current = _outbox.value
        for (id in docs.list(module, "_outbox")) if (current.none { it.id == id }) docs.delete(module, "_outbox", id)
        for (e in current) docs.write(module, "_outbox", e.id, kotlinx.serialization.json.buildJsonObject { put("collection", kotlinx.serialization.json.JsonPrimitive(e.collection)); put("op", kotlinx.serialization.json.JsonPrimitive(e.op)); e.doc?.let { put("doc", it) }; put("at", kotlinx.serialization.json.JsonPrimitive(e.atMillis)); put("attempts", kotlinx.serialization.json.JsonPrimitive(e.attempts)) })
    }
}
