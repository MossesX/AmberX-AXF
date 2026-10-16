package ai.amberx.axf.kernel.flags

/** Where a flag's value came from, in precedence order (later wins). */
public enum class FlagSource { DEFAULT, MANIFEST, REMOTE, ROLE, USER, KILL_SWITCH }

public data class Flag(val id: String, val description: String = "", val default: Boolean = false, val module: String = "kernel", val sinceVersion: String = "0.2.0")

/**
 * Feature flags + kill switches (Foundations: f.featureflags). Every risky or incomplete capability is
 * behind a flag from day one, so a bad module can be switched off remotely without a release.
 */
public class FeatureFlags(private val onChange: (String, Boolean) -> Unit = { _, _ -> }) {
    private val flags = LinkedHashMap<String, Flag>()
    private val layers = LinkedHashMap<FlagSource, MutableMap<String, Boolean>>().apply { for (s in FlagSource.entries) put(s, LinkedHashMap()) }

    public fun declare(flag: Flag): Flag { flags.putIfAbsent(flag.id, flag); return flags.getValue(flag.id) }
    public fun declared(): List<Flag> = flags.values.toList()
    public fun set(id: String, enabled: Boolean, source: FlagSource = FlagSource.USER) {
        val before = isEnabled(id); layers.getValue(source)[id] = enabled
        if (before != isEnabled(id)) onChange(id, isEnabled(id))
    }
    public fun clear(id: String, source: FlagSource) { val before = isEnabled(id); layers.getValue(source).remove(id); if (before != isEnabled(id)) onChange(id, isEnabled(id)) }
    public fun isEnabled(id: String): Boolean {
        for (s in FlagSource.entries.reversed()) layers.getValue(s)[id]?.let { return it }
        return flags[id]?.default ?: false
    }
    public fun source(id: String): FlagSource { for (s in FlagSource.entries.reversed()) if (id in layers.getValue(s)) return s; return FlagSource.DEFAULT }
    public fun snapshot(): Map<String, Boolean> = flags.keys.associateWith { isEnabled(it) }
    /** Apply a remote-config map atomically. */
    public fun applyRemote(values: Map<String, Boolean>) { val l = layers.getValue(FlagSource.REMOTE); l.clear(); values.forEach { (k, v) -> set(k, v, FlagSource.REMOTE) } }
}
