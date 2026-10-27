package ai.amberx.axf.kernel.config

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Config layers in precedence order (later wins). */
public enum class ConfigLayer { DEFAULTS, MANIFEST, REMOTE, USER, OVERRIDE }

/**
 * Layered configuration (k.config): defaults → manifest → remote → user → override. Values are JSON
 * primitives/objects so every port and the build engine share one shape. Keys are dotted and namespaced.
 */
public class Config {
    private val layers = LinkedHashMap<ConfigLayer, MutableMap<String, kotlinx.serialization.json.JsonElement>>().apply { for (l in ConfigLayer.entries) put(l, LinkedHashMap()) }

    public fun set(key: String, value: kotlinx.serialization.json.JsonElement, layer: ConfigLayer = ConfigLayer.USER) { layers.getValue(layer)[key] = value }
    public fun set(key: String, value: String, layer: ConfigLayer = ConfigLayer.USER): Unit = set(key, JsonPrimitive(value), layer)
    public fun set(key: String, value: Boolean, layer: ConfigLayer = ConfigLayer.USER): Unit = set(key, JsonPrimitive(value), layer)
    public fun set(key: String, value: Number, layer: ConfigLayer = ConfigLayer.USER): Unit = set(key, JsonPrimitive(value), layer)
    public fun load(obj: JsonObject, layer: ConfigLayer, prefix: String = "") { for ((k, v) in obj) { val key = if (prefix.isEmpty()) k else "$prefix.$k"; if (v is JsonObject) load(v, layer, key) else set(key, v, layer) } }
    public fun get(key: String): kotlinx.serialization.json.JsonElement? { for (l in ConfigLayer.entries.reversed()) layers.getValue(l)[key]?.let { return it } ; return null }
    public fun string(key: String, default: String? = null): String? = (get(key) as? JsonPrimitive)?.content ?: default
    public fun bool(key: String, default: Boolean = false): Boolean = (get(key) as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: default
    public fun int(key: String, default: Int = 0): Int = (get(key) as? JsonPrimitive)?.content?.toIntOrNull() ?: default
    public fun source(key: String): ConfigLayer? { for (l in ConfigLayer.entries.reversed()) if (key in layers.getValue(l)) return l; return null }
    public fun keys(): Set<String> = layers.values.flatMap { it.keys }.toSet()
    public fun clear(layer: ConfigLayer): Unit = layers.getValue(layer).clear()
    /** Drops [key] from one layer (lower layers show through again). */
    public fun remove(key: String, layer: ConfigLayer = ConfigLayer.USER) { layers.getValue(layer).remove(key) }
    /** Drops every key starting with [prefix] from one layer; a blank prefix drops nothing. Returns how many went. */
    public fun removePrefix(prefix: String, layer: ConfigLayer = ConfigLayer.USER): Int {
        if (prefix.isBlank()) return 0
        val m = layers.getValue(layer)
        val gone = m.keys.filter { it.startsWith(prefix) }
        for (k in gone) m.remove(k)
        return gone.size
    }
}
