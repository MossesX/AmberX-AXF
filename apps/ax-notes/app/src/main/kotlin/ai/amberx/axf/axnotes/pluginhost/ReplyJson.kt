package ai.amberx.axf.axnotes.pluginhost

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Pulls the JSON object out of an AI reply (plain JSON, a ```json fence, or JSON inside prose). Pure. */
object ReplyJson {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    const val MAX_REPLY = 400_000

    /** The first top-level `{…}` in [text] that parses, else null. */
    fun extract(text: String): JsonObject? {
        val t = text.take(MAX_REPLY)
        var from = t.indexOf('{')
        var tries = 0
        while (from >= 0 && tries < 20) {
            val end = matchingBrace(t, from)
            if (end > from) runCatching { json.parseToJsonElement(t.substring(from, end + 1)) as? JsonObject }.getOrNull()?.let { return it }
            from = t.indexOf('{', from + 1)
            tries++
        }
        return null
    }

    /** Index of the brace closing the one at [start], skipping strings; -1 when unbalanced. */
    private fun matchingBrace(s: String, start: Int): Int {
        var depth = 0
        var inString = false
        var escaped = false
        for (i in start until s.length) {
            val c = s[i]
            if (inString) {
                when {
                    escaped -> escaped = false
                    c == '\\' -> escaped = true
                    c == '"' -> inString = false
                }
                continue
            }
            when (c) {
                '"' -> inString = true
                '{' -> depth++
                '}' -> { depth--; if (depth == 0) return i }
            }
        }
        return -1
    }
}

/** Small JSON readers shared by the host and its plugins. */
object J {
    fun str(o: JsonObject?, k: String): String? = (o?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content
    fun text(o: JsonObject?, k: String, max: Int): String = (str(o, k) ?: "").trim().take(max)
    fun long(o: JsonObject?, k: String): Long? = (o?.get(k) as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.toDoubleOrNull()?.takeIf { it.isFinite() }?.toLong()
    fun int(o: JsonObject?, k: String): Int? = long(o, k)?.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
    fun bool(o: JsonObject?, k: String): Boolean? = (o?.get(k) as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toBooleanStrictOrNull()
    fun strings(e: JsonElement?, max: Int = 1000): List<String> =
        (e as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }?.take(max) ?: emptyList()
    fun objects(e: JsonElement?, max: Int = 2000): List<JsonObject> = (e as? JsonArray)?.mapNotNull { it as? JsonObject }?.take(max) ?: emptyList()
    fun arr(l: List<String>): JsonArray = JsonArray(l.map(::JsonPrimitive))
}

/** Stable short hashes (FNV-1a 64) for ids and change detection. Pure, same on every run. */
object Hashes {
    fun fnv64(s: String): String {
        var h = -0x340d631b7bdddcdbL // 0xcbf29ce484222325
        for (b in s.toByteArray(Charsets.UTF_8)) {
            h = h xor (b.toLong() and 0xff)
            h *= 0x100000001b3L
        }
        return java.lang.Long.toUnsignedString(h, 16).padStart(16, '0')
    }
}
