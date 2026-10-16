package ai.amberx.axf.kernel.asset

import kotlinx.serialization.json.JsonObject

public data class RegisterResult(val ok: Boolean, val errors: List<String>, val asset: AssetEnvelope? = null)

/** In-memory store of every asset available to the app, keyed by type then id. Insertion order is kept (next/prev cycling). */
public class AssetRegistry(public val types: AssetTypeRegistry = AssetTypeRegistry.builtin()) {
    private val validator = AssetValidator(types)
    private val store = LinkedHashMap<String, LinkedHashMap<String, AssetEnvelope>>()
    private val listeners = mutableListOf<(AssetEnvelope) -> Unit>()

    public fun register(raw: JsonObject, source: AssetSource = AssetSource.BUILTIN): RegisterResult {
        val v = validator.validate(raw)
        if (!v.ok) return RegisterResult(false, v.errors)
        val asset = AssetEnvelope.fromJson(raw, source)
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
