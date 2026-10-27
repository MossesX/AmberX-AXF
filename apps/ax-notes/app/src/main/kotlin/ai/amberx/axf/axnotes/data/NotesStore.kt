package ai.amberx.axf.axnotes.data

import ai.amberx.axf.axnotes.model.Categories
import ai.amberx.axf.axnotes.model.Category
import ai.amberx.axf.axnotes.model.Ids
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.ListRules
import ai.amberx.axf.axnotes.model.ListSort
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteList
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.model.NotesCodec
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.axnotes.model.SmartFilter
import ai.amberx.axf.axnotes.model.Text
import ai.amberx.axf.axnotes.model.TodoItem
import ai.amberx.axf.data.JsonDocumentStore
import ai.amberx.axf.data.OfflineFirstRepository
import ai.amberx.axf.data.OutboxEntry
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject

/**
 * AX Notes' offline-first store (axf-data [OfflineFirstRepository]): notes, lists (with their to-do items) and the
 * shared categories each live in their own collection on this phone, every write lands locally first and is queued
 * for axHub through [NotesHubSync]. The screens read the [StateFlow]s; every change goes through the functions here.
 *
 * Each collection uses its own module folder (`ai.amberx.axf.axnotes.<collection>`) because the repository keeps
 * one outbox per module folder.
 */
class NotesStore(
    private val store: JsonDocumentStore,
    private val scope: CoroutineScope,
    val sync: NotesHubSync,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private inner class Repo(collection: String) : OfflineFirstRepository(store, "$MODULE.$collection", collection) {
        override suspend fun push(entry: OutboxEntry): AxfResult<Unit> = sync.push(collection, entry.id, if (entry.op == "delete") null else entry.doc)
        override suspend fun pull(sinceMillis: Long): AxfResult<List<Pair<String, JsonObject>>> = sync.pull(collection, sinceMillis)
    }

    private val notesRepo = Repo(NOTES)
    private val listsRepo = Repo(LISTS)
    private val categoriesRepo = Repo(CATEGORIES)
    private val io = Mutex()

    private val _notes = MutableStateFlow<List<Note>>(emptyList())
    val notes: StateFlow<List<Note>> = _notes.asStateFlow()
    private val _lists = MutableStateFlow<List<NoteList>>(emptyList())
    val lists: StateFlow<List<NoteList>> = _lists.asStateFlow()
    private val _categories = MutableStateFlow<List<Category>>(emptyList())
    val categories: StateFlow<List<Category>> = _categories.asStateFlow()
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
    /** Changes not on axHub yet. */
    private val _pending = MutableStateFlow(0)
    val pending: StateFlow<Int> = _pending.asStateFlow()
    private val _syncNote = MutableStateFlow<String?>(null)
    val syncNote: StateFlow<String?> = _syncNote.asStateFlow()
    /** Called after every new note (the app announces it to plugins as `axnotes.notes.saved`). */
    @Volatile var onCreated: ((Note) -> Unit)? = null

    fun load() {
        scope.launch(Dispatchers.IO) {
            io.withLock {
                _notes.value = notesRepo.all().mapNotNull { (id, o) -> NotesCodec.note(o, id) }
                _lists.value = listsRepo.all().mapNotNull { (id, o) -> NotesCodec.list(o, id) }.sortedBy { it.createdAt }
                _categories.value = categoriesRepo.all().mapNotNull { (id, o) -> NotesCodec.category(o, id) }.sortedBy { it.order }
                countPending()
            }
            if (_lists.value.isEmpty()) seedLists()
            _loaded.value = true
        }
    }

    /** First run: an Inbox for notes and a To-do list. */
    private fun seedLists() {
        val now = clock()
        saveList(NoteList(INBOX, "Inbox", ListKind.NOTES, ListSort.DATE, createdAt = now, updatedAt = now))
        saveList(NoteList(TODO, "To-do", ListKind.TODO, ListSort.PRIORITY, createdAt = now + 1, updatedAt = now + 1))
    }

    // ---------------------------------------------------------------- notes

    fun note(id: String): Note? = _notes.value.firstOrNull { it.id == id }

    /** New note; the category is resolved by name (existing one by fuzzy name, else created). */
    fun createNote(
        text: String, title: String? = null, categoryName: String? = null, tags: List<String> = emptyList(),
        source: NoteSource = NoteSource.TYPED, listIds: List<String> = listOf(INBOX), priority: Priority = Priority.NONE,
    ): Note {
        val now = clock()
        val cat = categoryName?.takeIf { it.isNotBlank() }?.let { ensureCategory(it).id } ?: ""
        val n = Note(Ids.next("note", now), title?.takeIf { it.isNotBlank() } ?: Text.titleFrom(text), text.trim(), cat, cleanTags(tags), now, now,
            listIds.filter { id -> id == INBOX || _lists.value.any { it.id == id && it.kind == ListKind.NOTES } }, source = source, priority = priority)
        saveNote(n, touch = false)
        runCatching { onCreated?.invoke(n) }
        return n
    }

    fun saveNote(n: Note, touch: Boolean = true) {
        val saved = if (touch) n.copy(updatedAt = clock(), tags = cleanTags(n.tags)) else n
        _notes.update { l -> l.filterNot { it.id == saved.id } + saved }
        write(notesRepo, saved.id, NotesCodec.noteJson(saved))
    }

    fun deleteNote(id: String) {
        _notes.update { l -> l.filterNot { it.id == id } }
        remove(notesRepo, id)
        // Drop it from every to-do item that held it.
        for (l in _lists.value.filter { it.kind == ListKind.TODO && it.items.any { i -> id in i.noteIds } })
            saveList(l.copy(items = l.items.map { i -> if (id in i.noteIds) i.copy(noteIds = i.noteIds - id) else i }))
    }

    /** Re-categorize by hand ("" = uncategorized). */
    fun recategorize(noteId: String, categoryName: String) {
        val n = note(noteId) ?: return
        val cat = if (categoryName.isBlank()) "" else ensureCategory(categoryName).id
        if (cat != n.category) saveNote(n.copy(category = cat))
    }

    fun addToList(noteId: String, listId: String) {
        val n = note(noteId) ?: return
        if (listId !in n.listIds) saveNote(n.copy(listIds = n.listIds + listId))
    }

    fun removeFromList(noteId: String, listId: String) {
        val n = note(noteId) ?: return
        if (listId in n.listIds) saveNote(n.copy(listIds = n.listIds - listId))
    }

    private fun cleanTags(tags: List<String>): List<String> =
        tags.map { it.trim().removePrefix("#").trim() }.filter { it.isNotEmpty() }.distinctBy { Text.normalize(it) }.take(30)

    // ---------------------------------------------------------------- categories (shared by notes and to-dos)

    fun ensureCategory(name: String): Category {
        val c = Categories.resolve(name, _categories.value)
        if (_categories.value.none { it.id == c.id }) {
            _categories.update { it + c }
            write(categoriesRepo, c.id, NotesCodec.categoryJson(c))
        }
        return c
    }

    fun renameCategory(id: String, name: String) {
        val c = _categories.value.firstOrNull { it.id == id } ?: return
        if (name.isBlank()) return
        val renamed = c.copy(name = name.trim())
        _categories.update { l -> l.map { if (it.id == id) renamed else it } }
        write(categoriesRepo, id, NotesCodec.categoryJson(renamed))
    }

    // ---------------------------------------------------------------- lists

    fun list(id: String): NoteList? = _lists.value.firstOrNull { it.id == id }

    fun createList(name: String, kind: ListKind, sort: ListSort = if (kind == ListKind.TODO) ListSort.PRIORITY else ListSort.DATE, filter: SmartFilter? = null): NoteList {
        val now = clock()
        val l = NoteList(Ids.next("list", now), name.trim().ifBlank { "New list" }.replaceFirstChar { it.uppercase() }, kind, sort,
            filter = if (kind == ListKind.SMART) filter ?: SmartFilter() else null, createdAt = now, updatedAt = now)
        saveList(l)
        return l
    }

    fun saveList(l: NoteList) {
        val saved = l.copy(updatedAt = maxOf(clock(), l.updatedAt))
        _lists.update { all -> if (all.any { it.id == saved.id }) all.map { if (it.id == saved.id) saved else it } else all + saved }
        write(listsRepo, saved.id, NotesCodec.listJson(saved))
    }

    fun deleteList(id: String) {
        _lists.update { l -> l.filterNot { it.id == id } }
        remove(listsRepo, id)
        for (n in _notes.value.filter { id in it.listIds }) saveNote(n.copy(listIds = n.listIds - id))
    }

    fun setSort(listId: String, sort: ListSort, descending: Boolean) {
        val l = list(listId) ?: return
        saveList(l.copy(sort = sort, descending = descending))
    }

    /** Manual order: [shown] is what is on screen now; switches the list to MANUAL. */
    fun move(listId: String, shown: List<String>, id: String, to: Int) {
        val l = list(listId) ?: return
        saveList(l.copy(sort = ListSort.MANUAL, order = ListRules.move(shown, id, to)))
    }

    // ---------------------------------------------------------------- to-dos

    fun addTodo(listId: String, text: String, dueAt: Long? = null, priority: Priority = Priority.NONE, categoryName: String? = null): TodoItem? {
        val l = list(listId)?.takeIf { it.kind == ListKind.TODO } ?: return null
        val now = clock()
        val cat = categoryName?.takeIf { it.isNotBlank() }?.let { ensureCategory(it).id } ?: ""
        val item = TodoItem(Ids.next("todo", now), text.trim().replaceFirstChar { it.uppercase() }, dueAt = dueAt, priority = priority, category = cat, createdAt = now, updatedAt = now)
        saveList(l.copy(items = l.items + item, order = if (l.sort == ListSort.MANUAL) l.order + item.id else l.order))
        return item
    }

    fun updateTodo(listId: String, item: TodoItem) {
        val l = list(listId) ?: return
        val saved = item.copy(updatedAt = clock())
        saveList(l.copy(items = l.items.map { if (it.id == item.id) saved else it }))
    }

    fun setDone(listId: String, itemId: String, done: Boolean) {
        val l = list(listId) ?: return
        val i = l.items.firstOrNull { it.id == itemId } ?: return
        if (i.done == done) return
        updateTodo(listId, i.copy(done = done, doneAt = if (done) clock() else null))
    }

    fun deleteTodo(listId: String, itemId: String) {
        val l = list(listId) ?: return
        saveList(l.copy(items = l.items.filterNot { it.id == itemId }, order = l.order - itemId))
    }

    fun attachNote(listId: String, itemId: String, noteId: String) {
        val i = list(listId)?.items?.firstOrNull { it.id == itemId } ?: return
        if (noteId !in i.noteIds) updateTodo(listId, i.copy(noteIds = i.noteIds + noteId))
    }

    fun detachNote(listId: String, itemId: String, noteId: String) {
        val i = list(listId)?.items?.firstOrNull { it.id == itemId } ?: return
        if (noteId in i.noteIds) updateTodo(listId, i.copy(noteIds = i.noteIds - noteId))
    }

    /** Recategorize a to-do item by hand (same shared categories as notes). */
    fun recategorizeTodo(listId: String, itemId: String, categoryName: String) {
        val i = list(listId)?.items?.firstOrNull { it.id == itemId } ?: return
        updateTodo(listId, i.copy(category = if (categoryName.isBlank()) "" else ensureCategory(categoryName).id))
    }

    // ---------------------------------------------------------------- sync

    /** Push queued changes and pull the hub's; a no-op (with a note) while [NotesHubSync.ready] is false. */
    fun syncNow() {
        scope.launch(Dispatchers.IO) {
            if (!sync.ready) { _syncNote.value = "axHub sync isn't connected yet. ${_pending.value} change(s) wait on this phone."; return@launch }
            io.withLock {
                var failed: String? = null
                for (r in listOf(categoriesRepo, listsRepo, notesRepo)) r.sync().onErr { failed = it.message }
                _notes.value = notesRepo.all().mapNotNull { (id, o) -> NotesCodec.note(o, id) }
                _lists.value = listsRepo.all().mapNotNull { (id, o) -> NotesCodec.list(o, id) }.sortedBy { it.createdAt }
                _categories.value = categoriesRepo.all().mapNotNull { (id, o) -> NotesCodec.category(o, id) }.sortedBy { it.order }
                countPending()
                _syncNote.value = failed?.let { "Sync stopped: $it" } ?: "Synced with axHub."
            }
        }
    }

    private fun countPending() { _pending.value = notesRepo.outbox.value.size + listsRepo.outbox.value.size + categoriesRepo.outbox.value.size }

    private fun write(repo: OfflineFirstRepository, id: String, doc: JsonObject) {
        scope.launch(Dispatchers.IO) { io.withLock { repo.put(id, doc); countPending() } }
    }

    private fun remove(repo: OfflineFirstRepository, id: String) {
        scope.launch(Dispatchers.IO) { io.withLock { repo.delete(id); countPending() } }
    }

    companion object {
        const val MODULE = "ai.amberx.axf.axnotes"
        const val NOTES = "notes"
        const val LISTS = "lists"
        const val CATEGORIES = "categories"
        const val INBOX = "inbox"
        const val TODO = "todo"
    }
}
