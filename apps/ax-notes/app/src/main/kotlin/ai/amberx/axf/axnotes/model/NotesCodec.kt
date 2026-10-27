package ai.amberx.axf.axnotes.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * JSON records (`axnotes-note@1`, `axnotes-list@1`, `axnotes-category@1`) for the local document store and axHub
 * `_data`. Hand-written (no serialization plugin), tolerant on read: unknown keys are ignored, missing fields default,
 * text fields are capped so one bad record can't blow up a screen.
 */
object NotesCodec {
    const val NOTE = "axnotes-note@1"
    const val LIST = "axnotes-list@1"
    const val CATEGORY = "axnotes-category@1"
    const val MAX_TEXT = 100_000
    const val MAX_SHORT = 300

    val json: Json = Json { ignoreUnknownKeys = true }

    // ---- small readers ----
    private fun JsonObject.str(k: String, max: Int = MAX_SHORT): String = ((this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "").take(max)
    private fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.content?.toLongOrNull()
    private fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.content?.toIntOrNull()
    private fun JsonObject.bool(k: String): Boolean = (this[k] as? JsonPrimitive)?.content == "true"
    private fun JsonObject.strings(k: String, max: Int = 200): List<String> =
        (this[k] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.take(MAX_SHORT) }?.take(max) ?: emptyList()
    private fun JsonObject.objects(k: String, max: Int = 2000): List<JsonObject> = (this[k] as? JsonArray)?.mapNotNull { it as? JsonObject }?.take(max) ?: emptyList()

    private fun p(s: String) = JsonPrimitive(s)
    private fun p(n: Long?) = if (n == null) JsonNull else JsonPrimitive(n)
    private fun p(n: Int?) = if (n == null) JsonNull else JsonPrimitive(n)
    private fun arr(l: List<String>) = JsonArray(l.map { JsonPrimitive(it) })

    // ---- code links ----
    fun codeLink(o: JsonObject): CodeLink? {
        val repo = o.str("repo"); val path = o.str("path", 1000)
        if (repo.isBlank() || path.isBlank()) return null
        return CodeLink(repo, path, o.int("lineStart"), o.int("lineEnd"), o.str("commit").ifBlank { null })
    }

    fun codeLinkJson(c: CodeLink): JsonObject = JsonObject(linkedMapOf(
        "repo" to p(c.repo), "path" to p(c.path), "lineStart" to p(c.lineStart), "lineEnd" to p(c.lineEnd), "commit" to (c.commit?.let { p(it) } ?: JsonNull),
    ))

    // ---- notes ----
    fun note(o: JsonObject, fallbackId: String = ""): Note? {
        val id = o.str("id").ifBlank { fallbackId }
        if (id.isBlank()) return null
        val created = o.long("createdAt") ?: 0L
        return Note(
            id = id, title = o.str("title"), text = o.str("text", MAX_TEXT), category = o.str("category"), tags = o.strings("tags", 50),
            createdAt = created, updatedAt = o.long("updatedAt") ?: created, listIds = o.strings("listIds"),
            codeLinks = o.objects("codeLinks", 200).mapNotNull { codeLink(it) }, source = NoteSource.of(o.str("source")), priority = Priority.of(o.str("priority")),
        )
    }

    fun noteJson(n: Note): JsonObject = JsonObject(linkedMapOf(
        "\$axf" to p(NOTE), "id" to p(n.id), "title" to p(n.title), "text" to p(n.text), "category" to p(n.category), "tags" to arr(n.tags),
        "createdAt" to p(n.createdAt), "updatedAt" to p(n.updatedAt), "listIds" to arr(n.listIds),
        "codeLinks" to JsonArray(n.codeLinks.map { codeLinkJson(it) }), "source" to p(n.source.wire), "priority" to p(n.priority.wire),
    ))

    // ---- categories ----
    fun category(o: JsonObject, fallbackId: String = ""): Category? {
        val id = o.str("id").ifBlank { fallbackId }
        if (id.isBlank()) return null
        return Category(id, o.str("name").ifBlank { id }, o.int("order") ?: 0)
    }

    fun categoryJson(c: Category): JsonObject = JsonObject(linkedMapOf("\$axf" to p(CATEGORY), "id" to p(c.id), "name" to p(c.name), "order" to p(c.order)))

    // ---- to-dos + lists ----
    fun todo(o: JsonObject): TodoItem? {
        val id = o.str("id")
        if (id.isBlank()) return null
        val created = o.long("createdAt") ?: 0L
        return TodoItem(
            id = id, text = o.str("text", 2000), done = o.bool("done"), dueAt = o.long("dueAt"), priority = Priority.of(o.str("priority")),
            noteIds = o.strings("noteIds"), category = o.str("category"), createdAt = created, updatedAt = o.long("updatedAt") ?: created,
            doneAt = o.long("doneAt"), codeLinks = o.objects("codeLinks", 200).mapNotNull { codeLink(it) },
        )
    }

    fun todoJson(t: TodoItem): JsonObject = JsonObject(linkedMapOf(
        "id" to p(t.id), "text" to p(t.text), "done" to JsonPrimitive(t.done), "dueAt" to p(t.dueAt), "priority" to p(t.priority.wire),
        "noteIds" to arr(t.noteIds), "category" to p(t.category), "createdAt" to p(t.createdAt), "updatedAt" to p(t.updatedAt), "doneAt" to p(t.doneAt),
        "codeLinks" to JsonArray(t.codeLinks.map { codeLinkJson(it) }),
    ))

    fun filter(o: JsonObject?): SmartFilter? {
        o ?: return null
        return SmartFilter(o.str("category").ifBlank { null }, o.str("tag").ifBlank { null }, o.long("fromAt"), o.long("toAt"), o.str("text").ifBlank { null })
    }

    fun filterJson(f: SmartFilter): JsonObject = JsonObject(linkedMapOf(
        "category" to (f.category?.let { p(it) } ?: JsonNull), "tag" to (f.tag?.let { p(it) } ?: JsonNull),
        "fromAt" to p(f.fromAt), "toAt" to p(f.toAt), "text" to (f.text?.let { p(it) } ?: JsonNull),
    ))

    fun list(o: JsonObject, fallbackId: String = ""): NoteList? {
        val id = o.str("id").ifBlank { fallbackId }
        if (id.isBlank()) return null
        val created = o.long("createdAt") ?: 0L
        val kind = ListKind.of(o.str("kind"))
        return NoteList(
            id = id, name = o.str("name").ifBlank { "List" }, kind = kind, sort = ListSort.of(o.str("sort")),
            descending = (o["descending"] as? JsonPrimitive)?.content != "false", order = o.strings("order", 5000),
            items = if (kind == ListKind.TODO) o.objects("items").mapNotNull { todo(it) } else emptyList(),
            filter = if (kind == ListKind.SMART) filter(o["filter"] as? JsonObject) ?: SmartFilter() else null,
            createdAt = created, updatedAt = o.long("updatedAt") ?: created,
        )
    }

    fun listJson(l: NoteList): JsonObject = JsonObject(linkedMapOf<String, JsonElement>(
        "\$axf" to p(LIST), "id" to p(l.id), "name" to p(l.name), "kind" to p(l.kind.wire), "sort" to p(l.sort.wire),
        "descending" to JsonPrimitive(l.descending), "order" to arr(l.order),
        "items" to JsonArray(l.items.map { todoJson(it) }), "filter" to (l.filter?.let { filterJson(it) } ?: JsonNull),
        "createdAt" to p(l.createdAt), "updatedAt" to p(l.updatedAt),
    ))

    // ---- triggers (assets/axnotes/triggers.json) ----
    /** `axnotes-triggers@1` → trigger definitions; null when the file isn't one (the app falls back to the defaults). */
    fun triggers(text: String): List<TriggerDef>? {
        val o = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return null
        if (o.str("\$axf") != NoteTriggers.FORMAT) return null
        val defs = o.objects("triggers", 200).mapNotNull { t ->
            val id = t.str("id"); val phrases = t.strings("phrases", 30).map { it.trim() }.filter { it.isNotEmpty() }
            if (id.isBlank() || phrases.isEmpty()) null else TriggerDef(id, t.str("label").ifBlank { id }, phrases, t.str("description", 500), t.str("group").ifBlank { "notes" })
        }
        return defs.ifEmpty { null }
    }
}
