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
        if (type == AssetTypes.LAYOUT && "repeat" in data) errors += validateRepeat(data["repeat"])
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

    /** Repeating slots (layout.repeat); same messages as validateRepeat in core/validate.ts and build-engine.mjs. */
    private fun validateRepeat(repeat: kotlinx.serialization.json.JsonElement?): List<String> {
        val regions = ai.amberx.axf.kernel.engine.Region.entries.map { it.id }
        val styles = REPEAT_STYLES
        val list = repeat as? JsonArray ?: return listOf("data.repeat must be a list of repeating slots")
        val errors = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        fun str(v: kotlinx.serialization.json.JsonElement?): String? = (v as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun whole(v: kotlinx.serialization.json.JsonElement?, min: Int, max: Int = Int.MAX_VALUE): Boolean {
            val d = (v as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull() ?: return false
            return d == kotlin.math.floor(d) && d >= min && d <= max
        }
        list.forEachIndexed { i, e ->
            val at = "data.repeat[$i]"
            val r = e as? JsonObject
            if (r == null) { errors += "$at must be an object"; return@forEachIndexed }
            val id = str(r["id"])
            if (id == null || id.isBlank()) errors += "$at.id must be a non-empty string"
            else if (!seen.add(id)) errors += "$at.id \"$id\" is used twice"
            if (str(r["dataSet"]).isNullOrBlank()) errors += "$at.dataSet must be a non-empty string"
            if ("region" in r && str(r["region"]) !in regions) errors += "$at.region is not a layout region (one of: ${regions.joinToString(", ")})"
            if ("style" in r && str(r["style"]) !in styles) errors += "$at.style must be one of: ${styles.joinToString(", ")}"
            if ("columns" in r && !whole(r["columns"], 1, REPEAT_MAX_COLUMNS)) errors += "$at.columns must be a whole number from 1 to $REPEAT_MAX_COLUMNS"
            if ("max" in r && !whole(r["max"], 0)) errors += "$at.max must be a whole number, 0 or more"
            if ("fallback" in r) {
                val f = r["fallback"] as? JsonObject
                if (f == null) errors += "$at.fallback must be an object"
                else {
                    if ("type" in f) { val t = str(f["type"]); if (t == null || types.get(t) == null) errors += "$at.fallback.type is unknown asset type \"${t ?: (f["type"] as? JsonPrimitive)?.content ?: f["type"].toString()}\"" }
                    if ("id" in f && str(f["id"]) == null) errors += "$at.fallback.id must be a string"
                    if ("label" in f && str(f["label"]) == null) errors += "$at.fallback.label must be a string"
                }
            }
        }
        return errors
    }

    public companion object {
        /** asset-types.json layout.repeat (styles, maxColumns); RepeatEngine reads the same values. */
        public val REPEAT_STYLES: List<String> = listOf("tabs", "cards", "grid", "stacked")
        public const val REPEAT_MAX_COLUMNS: Int = 12
    }
}
