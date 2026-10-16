package ai.amberx.axf.kernel.asset

import kotlinx.serialization.json.JsonObject

/** Function form of [JsonObject.int] for call sites that already shadow the name. */
public fun int(o: JsonObject, key: String, default: Int): Int = o.int(key, default)
public fun strMap(o: JsonObject, key: String): Map<String, String> = o.strMap(key)
public fun strOrNull(o: JsonObject, key: String): String? = o.strOrNull(key)
/** Function form of [String.parseJsonObject] for method references. */
public fun parseJsonObjectOf(text: String): JsonObject? = text.parseJsonObject()
