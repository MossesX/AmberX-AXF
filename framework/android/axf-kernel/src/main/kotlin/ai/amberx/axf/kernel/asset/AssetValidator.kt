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
        if (type == AssetTypes.UAC_POLICY) {
            val roles = data.arr("roles") as? JsonArray
            val ids = roles?.mapNotNull { (it as? JsonObject)?.strOrNull("id") } ?: emptyList()
            if (data.strOrNull("defaultRole") !in ids) errors += "data.defaultRole must reference a role id"
        }
        return ValidationResult(errors.isEmpty(), errors)
    }

    public fun validate(asset: AssetEnvelope): ValidationResult = validate(asset.toJson())
}
