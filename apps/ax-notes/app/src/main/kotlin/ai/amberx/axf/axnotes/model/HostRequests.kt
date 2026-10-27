package ai.amberx.axf.axnotes.model

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * The plugin host actions' payloads and the pure rules behind them (no store, no Android). The store
 * (data/NotesStore.kt) resolves names to categories / lists and writes; AppModule wires the actions:
 *   axnotes.notes.save      {id?, title?, text, tags?, category?, source?, priority?, fileInto[]?, codeLinks[]?}
 *   axnotes.notes.saved     dispatched by the app after every create and edit: the note JSON + `change`
 *   axnotes.notes.announce  {by?}  → `axnotes.notes.saved` again for every note (change `announce`)
 *   axnotes.todos.add       {list, text, noteId?, category?, createList?}
 *   axnotes.todos.sync      {list: {id, name, kind?}, owner, add[], update[], close[], reopen[]}
 *   axnotes.lists.delete    {id}
 */

/** `axnotes.notes.save`. A null field was not given: an update keeps the note's value. [category] is a name ("" = none). */
data class NoteSaveRequest(
    val id: String? = null,
    val title: String? = null,
    val text: String? = null,
    val tags: List<String>? = null,
    val category: String? = null,
    val source: NoteSource? = null,
    val priority: Priority? = null,
    /** List ids or names (note lists) to add the note to. */
    val fileInto: List<String> = emptyList(),
    val codeLinks: List<CodeLink>? = null,
)

/** `axnotes.todos.add`. [list] is a to-do list name (or id); [category] a name. */
data class TodoAddRequest(val list: String, val text: String, val noteId: String? = null, val category: String? = null, val createList: Boolean = false)

/** `axnotes.todos.sync`: changes to a generated to-do list, made by [owner] (a plugin id). */
data class TodoSyncRequest(
    val listId: String,
    val listName: String,
    val owner: String,
    val add: List<TodoItem> = emptyList(),
    val update: List<TodoItem> = emptyList(),
    val close: List<String> = emptyList(),
    val reopen: List<String> = emptyList(),
)

/** What [HostRequests.applySync] did. [items] = the list's items afterwards (order kept, new ones at the end). */
data class SyncOutcome(val items: List<TodoItem>, val added: List<String>, val updated: List<String>, val closed: List<String>, val reopened: List<String>) {
    val changed: Boolean get() = added.isNotEmpty() || updated.isNotEmpty() || closed.isNotEmpty() || reopened.isNotEmpty()
}

object HostRequests {
    /** `change` in `axnotes.notes.saved`: a new note, an edit, or a re-announcement (`axnotes.notes.announce`). */
    const val CHANGE_CREATED = "created"
    const val CHANGE_UPDATED = "updated"
    const val CHANGE_ANNOUNCE = "announce"

    private val ID = Regex("[A-Za-z0-9._:-]{1,160}")

    /** Ids a plugin may give a note, list or item (letters, digits, `._:-`). */
    fun validId(s: String?): Boolean = s != null && ID.matches(s)

    // ---- payload readers (tolerant: a wrong type reads as "not given")

    private fun JsonObject.has(k: String): Boolean = this[k] is JsonPrimitive && (this[k] as JsonPrimitive).isString
    private fun JsonObject.s(k: String, max: Int = NotesCodec.MAX_SHORT): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content?.take(max)
    private fun JsonObject.b(k: String): Boolean = (this[k] as? JsonPrimitive)?.content == "true"
    private fun strings(e: JsonElement?, max: Int): List<String>? =
        (e as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.take(NotesCodec.MAX_SHORT) }?.take(max)
    private fun objects(e: JsonElement?, max: Int): List<JsonObject> = (e as? JsonArray)?.mapNotNull { it as? JsonObject }?.take(max) ?: emptyList()

    /** `voice` / `typed` as such, any other word = AI (a plugin wrote it); blank = not given. */
    fun source(s: String?): NoteSource? = when (s?.trim()?.lowercase()) {
        null, "" -> null
        "voice" -> NoteSource.VOICE
        "typed" -> NoteSource.TYPED
        else -> NoteSource.AI
    }

    fun saveRequest(o: JsonObject?): NoteSaveRequest? {
        o ?: return null
        val id = o.s("id")?.trim()?.takeIf { it.isNotEmpty() }
        if (id != null && !validId(id)) return null
        val links = (o["codeLinks"] as? JsonArray)?.let { objects(it, 200).mapNotNull { l -> NotesCodec.codeLink(l) } }
        return NoteSaveRequest(
            id = id, title = o.s("title"), text = o.s("text", NotesCodec.MAX_TEXT), tags = strings(o["tags"], 50),
            category = if (o.has("category")) o.s("category")!!.trim() else null, source = source(o.s("source")),
            priority = o.s("priority")?.takeIf { it.isNotBlank() }?.let { Priority.of(it) },
            fileInto = strings(o["fileInto"], 30)?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList(), codeLinks = links,
        )
    }

    fun todoAddRequest(o: JsonObject?): TodoAddRequest? {
        o ?: return null
        val list = o.s("list")?.trim().orEmpty(); val text = o.s("text", 2000)?.trim().orEmpty()
        if (list.isEmpty() || text.isEmpty()) return null
        return TodoAddRequest(list, text, o.s("noteId")?.trim()?.takeIf { it.isNotEmpty() }, o.s("category")?.trim()?.takeIf { it.isNotEmpty() }, o.b("createList"))
    }

    fun todoSyncRequest(o: JsonObject?): TodoSyncRequest? {
        o ?: return null
        val list = o["list"] as? JsonObject ?: return null
        val listId = list.s("id")?.trim().orEmpty()
        val owner = o.s("owner")?.trim().orEmpty()
        if (!validId(listId) || owner.isEmpty()) return null
        fun items(k: String) = objects(o[k], 5000).mapNotNull { NotesCodec.todo(it) }.filter { validId(it.id) }
        fun ids(k: String) = strings(o[k], 5000)?.filter { validId(it) } ?: emptyList()
        return TodoSyncRequest(listId, list.s("name")?.trim().orEmpty().ifEmpty { "To-do" }, owner, items("add"), items("update"), ids("close"), ids("reopen"))
    }

    /** `axnotes.lists.delete` → the list id. */
    fun listId(o: JsonObject?): String? = o?.s("id")?.trim()?.takeIf { validId(it) }

    // ---- notes

    fun cleanTags(tags: List<String>): List<String> =
        tags.map { it.trim().removePrefix("#").trim() }.filter { it.isNotEmpty() }.distinctBy { Text.normalize(it) }.take(30)

    /**
     * The note after [r]: an update of [existing], or a new note (id = the request's id, else [newId]) in [defaultLists].
     * [categoryId] = the resolved category (null = not given), [fileInto] = resolved note-list ids. Null when a new note
     * would have no text.
     */
    fun applySave(existing: Note?, r: NoteSaveRequest, categoryId: String?, fileInto: List<String>, now: Long, newId: String, defaultLists: List<String> = emptyList()): Note? {
        val title = r.title?.trim()?.takeIf { it.isNotEmpty() }
        if (existing == null) {
            val text = r.text?.trim().orEmpty()
            if (text.isEmpty()) return null
            return Note(
                id = r.id ?: newId, title = title ?: Text.titleFrom(text), text = text, category = categoryId ?: "", tags = cleanTags(r.tags ?: emptyList()),
                createdAt = now, updatedAt = now, listIds = (defaultLists + fileInto).distinct(), codeLinks = r.codeLinks ?: emptyList(),
                source = r.source ?: NoteSource.AI, priority = r.priority ?: Priority.NONE,
            )
        }
        val text = r.text?.trim()?.takeIf { it.isNotEmpty() } ?: existing.text
        return existing.copy(
            title = title ?: existing.title, text = text, category = categoryId ?: existing.category, tags = r.tags?.let { cleanTags(it) } ?: existing.tags,
            updatedAt = maxOf(now, existing.updatedAt), listIds = (existing.listIds + fileInto).distinct(), codeLinks = r.codeLinks ?: existing.codeLinks,
            source = r.source ?: existing.source, priority = r.priority ?: existing.priority,
        )
    }

    /** Note lists named by [refs] (id first, else the same name); names with no such list are skipped. */
    fun resolveLists(refs: List<String>, lists: List<NoteList>): List<String> {
        val notes = lists.filter { it.kind == ListKind.NOTES }
        return refs.mapNotNull { ref ->
            notes.firstOrNull { it.id == ref }?.id ?: Text.normalize(ref).takeIf { it.isNotEmpty() }?.let { n -> notes.firstOrNull { Text.normalize(it.name) == n }?.id }
        }.distinct()
    }

    /** `axnotes.notes.saved` payload: the note JSON plus `change` ([CHANGE_CREATED], [CHANGE_UPDATED], [CHANGE_ANNOUNCE]). */
    fun savedPayload(n: Note, change: String): JsonObject = JsonObject(NotesCodec.noteJson(n) + ("change" to JsonPrimitive(change)))

    // ---- to-dos

    /** The to-do list [ref] names: by id, else by name. */
    fun findTodoList(ref: String, lists: List<NoteList>): NoteList? {
        val todo = lists.filter { it.kind == ListKind.TODO }
        val n = Text.normalize(ref)
        return todo.firstOrNull { it.id == ref } ?: todo.firstOrNull { n.isNotEmpty() && Text.normalize(it.name) == n }
    }

    /** An open item with the same text (normalized) is already on [list]. */
    fun hasOpen(list: NoteList, text: String): Boolean {
        val n = Text.normalize(text)
        return list.items.any { !it.done && Text.normalize(it.text) == n }
    }

    /**
     * Applies [r] to [items]. Only items owned by `r.owner` are ever changed (the user's own items have owner ""):
     * `add` inserts new ids (owner set; an id already there counts as an update), `update` takes text / priority / due /
     * code links but keeps done, notes and category as they are on the phone (an item the user deleted stays deleted),
     * `close` ticks open items off, `reopen` opens ticked ones again.
     */
    fun applySync(items: List<TodoItem>, r: TodoSyncRequest, now: Long): SyncOutcome {
        val out = LinkedHashMap<String, TodoItem>()
        for (i in items) out[i.id] = i
        val added = ArrayList<String>(); val updated = ArrayList<String>(); val closed = ArrayList<String>(); val reopened = ArrayList<String>()
        fun mine(id: String): TodoItem? = out[id]?.takeIf { it.owner == r.owner }

        fun update(u: TodoItem) {
            val cur = mine(u.id) ?: return
            val next = cur.copy(text = u.text.trim().ifEmpty { cur.text }, priority = u.priority, dueAt = u.dueAt ?: cur.dueAt, codeLinks = u.codeLinks)
            if (next != cur) { out[u.id] = next.copy(updatedAt = now); updated += u.id }
        }
        for (a in r.add) {
            when {
                out[a.id] == null -> {
                    if (a.text.isBlank()) continue
                    out[a.id] = a.copy(text = a.text.trim(), owner = r.owner, createdAt = if (a.createdAt > 0) a.createdAt else now, updatedAt = now,
                        doneAt = if (a.done) a.doneAt ?: now else null)
                    added += a.id
                }
                else -> update(a)
            }
        }
        for (u in r.update) update(u)
        for (id in r.close.distinct()) {
            val cur = mine(id) ?: continue
            if (!cur.done) { out[id] = cur.copy(done = true, doneAt = now, updatedAt = now); closed += id }
        }
        for (id in r.reopen.distinct()) {
            val cur = mine(id) ?: continue
            if (cur.done) { out[id] = cur.copy(done = false, doneAt = null, updatedAt = now); reopened += id }
        }
        return SyncOutcome(out.values.toList(), added, updated.distinct(), closed, reopened)
    }
}
