package ai.amberx.axf.kernel.asset

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The one JSON configuration used everywhere in the kernel. Lenient and unknown-field tolerant by
 * design: an older app must load a newer asset (with fields it has never seen) without failing.
 */
public val AxfJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = true
    prettyPrint = true
    prettyPrintIndent = "  "
    explicitNulls = false
    encodeDefaults = true
}

/* Tolerant readers. Missing or mistyped fields fall back to the supplied default instead of throwing. */
public fun JsonObject.str(key: String, default: String = ""): String = (this[key] as? JsonPrimitive)?.takeIf { it.isString || it !is JsonNull }?.content ?: default
public fun JsonObject.strOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content
public fun JsonObject.int(key: String, default: Int = 0): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: (this[key] as? JsonPrimitive)?.doubleOrNull?.toInt() ?: default
public fun JsonObject.double(key: String, default: Double = 0.0): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: default
public fun JsonObject.bool(key: String, default: Boolean = false): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: default
public fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
public fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray
public fun JsonObject.strList(key: String): List<String> = arr(key)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
public fun JsonObject.objList(key: String): List<JsonObject> = arr(key)?.mapNotNull { it as? JsonObject } ?: emptyList()
public fun JsonObject.strMap(key: String): Map<String, String> = obj(key)?.entries?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.let { k to it.content } }?.toMap() ?: emptyMap()
public fun JsonElement.asObjectOrNull(): JsonObject? = this as? JsonObject
public fun String.parseJsonObject(): JsonObject? = runCatching { AxfJson.parseToJsonElement(this).jsonObject }.getOrNull()
