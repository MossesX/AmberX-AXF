package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerRegistry

/*
 * What the voice bridge matches: the TriggerStore's effective triggers (user overrides applied, custom triggers) plus
 * every trigger that lives only in the kernel TriggerRegistry (lib-speech's speech controls, plugin triggers registered
 * straight into the registry). The store mirrors its own triggers into the registry, so the same id shows up in both:
 * the store's copy wins (it carries the user's overrides), and nothing is listed twice.
 */

/** Pure merge rule (unit-tested). */
public object TriggerUnion {
    /** [store] first, in its order, then registry triggers whose id the store doesn't have; first of an id wins. */
    public fun merge(store: List<Trigger>, registry: List<Trigger>): List<Trigger> {
        val seen = HashSet<String>()
        val out = ArrayList<Trigger>(store.size + registry.size)
        for (t in store) if (seen.add(t.id)) out += t
        for (t in registry) if (seen.add(t.id)) out += t
        return out
    }
}

/**
 * A live `() -> List<Trigger>` for [VoiceTriggerBridge]: the union of [store] and [registry], cached and rebuilt when the
 * registry changes ([TriggerRegistry.subscribe]) or the store publishes a new list. Thread-safe. [close] unsubscribes.
 */
public class UnionTriggerSource(
    private val store: TriggerStore,
    private val registry: TriggerRegistry?,
) : () -> List<Trigger> {
    @Volatile private var dirty = true
    @Volatile private var storeSeen: List<StoredTrigger>? = null
    @Volatile private var cached: List<Trigger> = emptyList()
    private val unsubscribe: () -> Unit = registry?.subscribe { dirty = true } ?: {}

    /** The current union. */
    override fun invoke(): List<Trigger> {
        val s = store.list.value
        if (!dirty && s === storeSeen) return cached
        synchronized(this) {
            if (!dirty && s === storeSeen) return cached
            dirty = false
            storeSeen = s
            cached = TriggerUnion.merge(s.map { it.trigger }, registry?.list() ?: emptyList())
            return cached
        }
    }

    /** Stops listening to the registry. */
    public fun close() { unsubscribe() }
}
