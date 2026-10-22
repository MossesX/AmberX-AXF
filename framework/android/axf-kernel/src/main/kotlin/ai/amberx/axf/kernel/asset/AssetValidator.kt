package ai.amberx.axf.kernel.asset

import ai.amberx.axf.kernel.AxfVersion
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

public data class ValidationResult(val ok: Boolean, val errors: List<String>) {
    public companion object { public val OK: ValidationResult = ValidationResult(true, emptyList()) }
}

/**
 * Validates an asset against the shared type spec. Mirrors framework/core/validate.ts and the Node
 * build engine line for line, so an asset that passes here passes `axf validate` and vice versa.
 */
public class AssetValidator(private val types: AssetTypeRegistry) {
    public fun validate(raw: JsonObject): ValidationResult {
        val errors = mutableListOf<String>()
        for (k in types.requiredEnvelopeFields()) if (k !in raw) errors += "Missing envelope field \"$k\""
        val frame = raw.strOrNull("\$axf")
        if (frame !in AxfVersion.ASSET_FRAMES) errors += "\"\$axf\" must be one of ${AxfVersion.ASSET_FRAMES.joinToString()}"
        val type = raw.strOrNull("type") ?: ""
        val ts = types.get(type)
        if (ts == null) { errors += "Unknown asset type \"$type\""; return ValidationResult(false, errors) }
        val id = raw.strOrNull("id")
        if (id == null || !types.idPattern.matches(id)) errors += "\"id\" must match ${types.idPattern.pattern}"
        if (raw.strOrNull("name").isNullOrBlank()) errors += "\"name\" must be a non-empty string"
        val data = raw.obj("data")
        if (data == null) { errors += "\"data\" must be an object"; return ValidationResult(false, errors) }
        for (k in ts.required) if (k !in data) errors += "data.$k is required for $type"
        for ((k, allowed) in ts.enums) {
            val v = (data[k] as? JsonPrimitive)?.content
            if (k in data && v !in allowed) errors += "data.$k must be one of: ${allowed.joinToString(", ")}"
        }
        for ((k, keys) in ts.nested) {
            val inner = data.obj(k) ?: continue
            for (nk in keys) if (nk !in inner) errors += "data.$k.$nk is required"
        }
        if (type == AssetTypes.LAYOUT && "slots" in data) errors += validateSlots(data["slots"])
        // Widget hosts (banner.attach, toolbar.widgets): every entry names a type and side the host takes.
        ai.amberx.axf.kernel.engine.WidgetEngine.hostSpec(type)?.let { h -> if (h.field in data) errors += ai.amberx.axf.kernel.engine.WidgetEngine.validateHostAttachments(type, data[h.field]) }
        if (type == AssetTypes.UAC_POLICY) {
            val roles = data.arr("roles") as? JsonArray
            val ids = roles?.mapNotNull { (it as? JsonObject)?.strOrNull("id") } ?: emptyList()
            if (data.strOrNull("defaultRole") !in ids) errors += "data.defaultRole must reference a role id"
        }
        return ValidationResult(errors.isEmpty(), errors)
    }

    public fun validate(asset: AssetEnvelope): ValidationResult = validate(asset.toJson())

    /** Layout slot contract; same messages as validateSlots in core/validate.ts and build-engine.mjs. */
    private fun validateSlots(slots: kotlinx.serialization.json.JsonElement?): List<String> {
        val regions = ai.amberx.axf.kernel.engine.Region.entries.map { it.id }
        val obj = slots as? JsonObject ?: return listOf("data.slots must be an object")
        val errors = mutableListOf<String>()
        for ((r, v) in obj) {
            if (r !in regions) { errors += "data.slots.$r is not a layout region (one of: ${regions.joinToString(", ")})"; continue }
            val list = v as? JsonArray
            if (list == null) { errors += "data.slots.$r must be a list of asset types"; continue }
            for (t in list) {
                val name = (t as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (name == null || types.get(name) == null) errors += "data.slots.$r accepts unknown asset type \"${name ?: t.toString()}\""
            }
        }
        return errors
    }
}
