package ai.amberx.axf.work

/**
 * Keeps a registry in step with a contribution list (pure, unit-tested): [sync] registers every item it hasn't seen or
 * whose value changed, and unregisters the ids it registered earlier that are no longer contributed. Ids registered by
 * someone else (an app's own `WorkModule(jobs = …)`) are never touched. [WorkModule] runs one over `axf.workers`.
 */
public class WorkerSync<T : Any>(
    private val idOf: (T) -> String,
    private val register: (T) -> Unit,
    private val unregister: (String) -> Unit,
) {
    private val owned = LinkedHashMap<String, T>()

    /** What [sync] changed. */
    public data class Change(val added: List<String>, val removed: List<String>)

    /** Ids this sync registered and still holds. */
    @Synchronized public fun ids(): List<String> = owned.keys.toList()

    /** Applies the current contributions (first of an id wins). A [register] that throws skips that item (reported in [failed]). */
    @Synchronized public fun sync(current: List<T>, failed: (T, Throwable) -> Unit = { _, _ -> }): Change {
        val next = LinkedHashMap<String, T>()
        for (item in current) next.putIfAbsent(idOf(item), item)
        val removed = owned.keys.filter { it !in next }
        for (id in removed) { owned.remove(id); unregister(id) }
        val added = ArrayList<String>()
        for ((id, item) in next) {
            if (owned[id] === item) continue
            try { register(item); owned[id] = item; added += id } catch (e: Throwable) { owned.remove(id)?.let { unregister(id) }; failed(item, e) }
        }
        return Change(added, removed)
    }
}
