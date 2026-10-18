package ai.amberx.axf.kernel.asset

import kotlinx.serialization.json.JsonObject

public data class RegisterResult(val ok: Boolean, val errors: List<String>, val asset: AssetEnvelope? = null)

/** An asset id registered again by someone else with different content (see AxfRuntime.diagnostics). */
public data class AssetReplacement(val type: String, val id: String, val was: String, val now: String)

/** In-memory store of every asset available to the app, keyed by type then id. Insertion order is kept (next/prev cycling). */
public class AssetRegistry(public val types: AssetTypeRegistry = AssetTypeRegistry.builtin()) {
    private val validator = AssetValidator(types)
    private val store = LinkedHashMap<String, LinkedHashMap<String, AssetEnvelope>>()
    private val listeners = mutableListOf<(AssetEnvelope) -> Unit>()
    private val origins = HashMap<String, String>()
    private val replacementList = mutableListOf<AssetReplacement>()
    /** Replacements seen so far (also those before a runtime attached [onReplace]). */
    public val replacements: List<AssetReplacement> get() = replacementList.toList()
    /** Called when two modules clash (same type and id, other content). Overriding a built-in is not a clash. */
    public var onReplace: ((AssetReplacement) -> Unit)? = null

    /** [origin] = the module (library / plugin id) registering it, when known. */
    public fun register(raw: JsonObject, source: AssetSource = AssetSource.BUILTIN, origin: String? = null): RegisterResult {
        val v = validator.validate(raw)
        if (!v.ok) return RegisterResult(false, v.errors)
        val asset = AssetEnvelope.fromJson(raw, source)
        val slot = "${asset.type}/${asset.id}"
        val prev = store[asset.type]?.get(asset.id)
        val was = origins[slot]
        if (prev != null && was != null && origin != null && was != origin && prev.toJson() != asset.toJson()) {
            val r = AssetReplacement(asset.type, asset.id, was, origin)
            replacementList += r
            if (replacementList.size > 100) replacementList.removeAt(0)
            onReplace?.invoke(r)
        }
        if (origin != null) origins[slot] = origin else origins.remove(slot)
        store.getOrPut(asset.type) { LinkedHashMap() }[asset.id] = asset
        listeners.forEach { it(asset) }
        return RegisterResult(true, emptyList(), asset)
    }

    public fun register(text: String, source: AssetSource = AssetSource.IMPORTED): RegisterResult =
        text.parseJsonObject()?.let { register(it, source) } ?: RegisterResult(false, listOf("Invalid JSON"))

    public fun get(type: String, id: String): AssetEnvelope? = store[type]?.get(id)
    public fun has(type: String, id: String): Boolean = store[type]?.containsKey(id) == true
    public fun list(type: String): List<AssetEnvelope> = store[type]?.values?.toList() ?: emptyList()
    public fun all(): List<AssetEnvelope> = store.values.flatMap { it.values }
    public fun count(): Int = store.values.sumOf { it.size }
    public fun countByType(): Map<String, Int> = store.mapValues { it.value.size }
    public fun remove(type: String, id: String): Boolean = store[type]?.remove(id) != null
    public fun onRegistered(fn: (AssetEnvelope) -> Unit) { listeners += fn }
    public fun validate(raw: JsonObject): ValidationResult = validator.validate(raw)
}
