package ai.amberx.axf.kernel.asset

import ai.amberx.axf.kernel.AxfVersion
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Where an asset came from. Not part of the on-disk format. */
public enum class AssetSource { BUILTIN, APP, IMPORTED, REMOTE }

/**
 * The cross-platform, cross-application contract: every UI component and schema-driven object is an
 * asset wrapped in this envelope. Identical to the web port's AssetEnvelope, so any AXF app on any
 * port can load any other app's assets. `data` stays a raw JsonObject; typed views decode from it
 * lazily and tolerantly (see models.kt), which is what lets new fields ride along safely.
 */
public data class AssetEnvelope(
    val frame: String,
    val type: String,
    val id: String,
    val name: String,
    val version: String,
    val description: String? = null,
    val author: String? = null,
    val tags: List<String> = emptyList(),
    val data: JsonObject,
    val source: AssetSource = AssetSource.BUILTIN,
    /** Any envelope fields this kernel does not know are preserved here so re-export is lossless. */
    val extra: JsonObject = JsonObject(emptyMap()),
) {
    public val key: String get() = "$type:$id"
    public val isDark: Boolean? get() = data.strOrNull("scheme")?.let { it == "dark" }

    /** Portable on-disk JSON (runtime-only fields stripped). */
    public fun toJson(): JsonObject = buildJsonObject {
        put("\$axf", frame); put("type", type); put("id", id); put("name", name); put("version", version)
        description?.let { put("description", it) }
        author?.let { put("author", it) }
        put("tags", kotlinx.serialization.json.JsonArray(tags.map { JsonPrimitive(it) }))
        put("data", data)
        extra.forEach { (k, v) -> if (k !in KNOWN) put(k, v) }
    }

    public fun serialize(): String = AxfJson.encodeToString(JsonObject.serializer(), toJson())

    public companion object {
        private val KNOWN = setOf("\$axf", "type", "id", "name", "version", "description", "author", "tags", "data")

        /** Structural parse only — validation against the type spec is [AssetValidator]'s job. */
        public fun fromJson(raw: JsonObject, source: AssetSource = AssetSource.BUILTIN): AssetEnvelope = AssetEnvelope(
            frame = raw.str("\$axf", AxfVersion.ASSET_FRAMES.first()),
            type = raw.str("type"),
            id = raw.str("id"),
            name = raw.str("name"),
            version = raw.str("version", "1.0.0"),
            description = raw.strOrNull("description"),
            author = raw.strOrNull("author"),
            tags = raw.strList("tags"),
            data = raw.obj("data") ?: JsonObject(emptyMap()),
            source = source,
            extra = JsonObject(raw.filterKeys { it !in KNOWN }),
        )

        public fun parse(text: String, source: AssetSource = AssetSource.IMPORTED): AssetEnvelope? = text.parseJsonObject()?.let { fromJson(it, source) }
    }
}
