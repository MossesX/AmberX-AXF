package ai.amberx.axf.voicevault.notes

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * One saved note, as a row of the hub table `notes` (folder `voice-notes`), the shape the console reads through
 * lib-hubstore's `HubData.table('notes')`: what was said (the stop trigger already cut), where it went, the answers to
 * the list's questions by field, when, and which app/device. Text only: no audio leaves the phone.
 */
data class NoteRecord(
    val id: String, val list: String, val subcategory: String, val text: String, val answers: Map<String, String>,
    val at: String, val by: String, val device: String,
) {
    fun toJson(): JsonObject = JsonObject(mapOf(
        "id" to JsonPrimitive(id), "list" to JsonPrimitive(list), "subcategory" to JsonPrimitive(subcategory), "text" to JsonPrimitive(text),
        "answers" to JsonObject(answers.mapValues { JsonPrimitive(it.value) }), "at" to JsonPrimitive(at), "by" to JsonPrimitive(by), "device" to JsonPrimitive(device),
    ))
}

/**
 * The hub-table@1 frame lib-hubstore writes (framework/libs/hubstore/core.ts): `<folder>/<table>/head.json` holds the
 * rows inline while they fit, else `chunks` and the rows sit in `rows-<i>.json` pieces under 48 KB (axHub caps a file at
 * 64 KB). Same names and limits, so a table written here reads back in the console and the other way round.
 */
object HubTables {
    const val FORMAT = "hub-table@1"
    const val SETTINGS_FORMAT = "hub-settings@1"
    const val FILE_MAX = 64_000
    const val CHUNK = 48_000
    val json = Json { ignoreUnknownKeys = true }

    fun headPath(folder: String, table: String) = "$folder/$table/head.json"
    fun chunkPath(folder: String, table: String, i: Int) = "$folder/$table/rows-$i.json"

    private fun enc(e: JsonElement) = json.encodeToString(JsonElement.serializer(), e)

    /** Split rows into pieces whose JSON stays under [max] (a single oversized row gets a piece of its own). */
    fun chunk(rows: Map<String, JsonElement>, max: Int = CHUNK): List<Map<String, JsonElement>> {
        val out = mutableListOf(LinkedHashMap<String, JsonElement>())
        var size = 2
        for ((k, v) in rows) {
            val n = enc(JsonPrimitive(k)).length + enc(v).length + 2
            if (size + n > max && out.last().isNotEmpty()) { out += LinkedHashMap(); size = 2 }
            out.last()[k] = v
            size += n
        }
        return out
    }

    data class Head(val chunks: Int, val rows: Map<String, JsonElement>?)

    /** A head file → its chunk count and inline rows; null when it isn't a hub-table@1 head. */
    fun parseHead(e: JsonElement?): Head? {
        val o = e as? JsonObject ?: return null
        if ((o["\$axf"] as? JsonPrimitive)?.content != FORMAT) return null
        val chunks = (o["chunks"] as? JsonPrimitive)?.content?.toIntOrNull()?.coerceIn(0, 200) ?: 0
        return Head(chunks, (o["rows"] as? JsonObject)?.toMap())
    }

    fun head(table: String, rows: Map<String, JsonElement>, now: String, chunks: Int?): JsonObject = JsonObject(buildMap<String, JsonElement> {
        put("\$axf", JsonPrimitive(FORMAT)); put("table", JsonPrimitive(table)); put("count", JsonPrimitive(rows.size)); put("updatedAt", JsonPrimitive(now))
        put("chunks", JsonPrimitive(chunks ?: 0))
        if (chunks == null) put("rows", JsonObject(rows))
    })

    /** A hub-settings@1 document → its values (anything else → empty). */
    fun settingsValues(e: JsonElement?): JsonObject? {
        val o = e as? JsonObject ?: return null
        if ((o["\$axf"] as? JsonPrimitive)?.content != SETTINGS_FORMAT) return null
        return o["values"] as? JsonObject
    }

    fun encode(e: JsonElement): String = enc(e)
}
