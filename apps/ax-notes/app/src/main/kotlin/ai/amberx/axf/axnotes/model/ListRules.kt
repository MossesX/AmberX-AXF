package ai.amberx.axf.axnotes.model

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Pure list logic: what a list shows, in which order, smart-list filtering, grouping views, manual moves. */
object ListRules {

    // ---- what a list holds ----

    /** The notes a list shows, sorted by its own sort. To-do lists show no notes (their items hold them). */
    fun notesOf(list: NoteList, all: List<Note>, categories: List<Category> = emptyList()): List<Note> {
        val picked = when (list.kind) {
            ListKind.NOTES -> all.filter { list.id in it.listIds }
            ListKind.SMART -> all.filter { matches(it, list.filter ?: SmartFilter()) }
            ListKind.TODO -> emptyList()
        }
        return sortNotes(picked, list.sort, list.descending, list.order, categories)
    }

    /** A to-do list's items: open ones first, then done ones, each part by the list's sort. */
    fun itemsOf(list: NoteList, categories: List<Category> = emptyList()): List<TodoItem> =
        sortTodos(list.items, list.sort, list.descending, list.order, categories)

    // ---- smart-list filter / search ----

    fun matches(note: Note, f: SmartFilter): Boolean {
        if (!f.category.isNullOrBlank() && note.category != f.category) return false
        if (!f.tag.isNullOrBlank()) {
            val t = Text.normalize(f.tag)
            if (note.tags.none { Text.normalize(it) == t }) return false
        }
        if (f.fromAt != null && note.createdAt < f.fromAt) return false
        if (f.toAt != null && note.createdAt > f.toAt) return false
        if (!f.text.isNullOrBlank()) {
            // Every word must start a word of the title, text or tags ("mil" finds "milk", "x" doesn't find "text").
            val hay = Text.tokens(note.title + " " + note.text + " " + note.tags.joinToString(" "))
            if (Text.tokens(f.text).any { w -> hay.none { it.startsWith(w) } }) return false
        }
        return true
    }

    /** Search box: every word must appear in the title, text or tags; newest first. */
    fun search(all: List<Note>, query: String): List<Note> =
        if (query.isBlank()) all.sortedByDescending { it.updatedAt } else all.filter { matches(it, SmartFilter(text = query)) }.sortedByDescending { it.updatedAt }

    // ---- sorting ----

    fun sortNotes(notes: List<Note>, sort: ListSort, descending: Boolean, order: List<String>, categories: List<Category>): List<Note> {
        val newest = compareByDescending<Note> { it.updatedAt }.thenBy { it.id }
        return when (sort) {
            ListSort.DATE -> if (descending) notes.sortedWith(newest) else notes.sortedWith(compareBy<Note> { it.updatedAt }.thenBy { it.id })
            ListSort.CATEGORY -> {
                val byName = compareBy<Note> { it.category.isBlank() }.then(
                    if (descending) compareByDescending { catKey(it.category, categories) } else compareBy { catKey(it.category, categories) })
                notes.sortedWith(byName.then(newest))
            }
            ListSort.PRIORITY -> notes.sortedWith((if (descending) compareByDescending<Note> { it.priority.rank } else compareBy { it.priority.rank }).then(newest))
            ListSort.MANUAL -> manual(notes, order, { it.id }, newest)
        }
    }

    fun sortTodos(items: List<TodoItem>, sort: ListSort, descending: Boolean, order: List<String>, categories: List<Category>): List<TodoItem> {
        val created = compareBy<TodoItem> { it.createdAt }.thenBy { it.id }
        if (sort == ListSort.MANUAL) return manual(items, order, { it.id }, created)
        val primary: Comparator<TodoItem> = when (sort) {
            // Date = due date, soonest first (descending flips it), undated after dated, then oldest added first.
            ListSort.DATE -> compareBy<TodoItem> { it.dueAt == null }.then(if (descending) compareByDescending { it.dueAt ?: 0L } else compareBy { it.dueAt ?: 0L })
            ListSort.CATEGORY -> compareBy<TodoItem> { it.category.isBlank() }.then(compareBy { catKey(it.category, categories) })
            ListSort.PRIORITY -> compareByDescending<TodoItem> { it.priority.rank }.then(compareBy<TodoItem> { it.dueAt == null }).then(compareBy { it.dueAt ?: 0L })
            ListSort.MANUAL -> created
        }
        return items.sortedWith(compareBy<TodoItem> { it.done }.then(primary).then(created))
    }

    private fun catKey(id: String, categories: List<Category>): String = Text.normalize(Categories.nameOf(id, categories))

    /** Ids in [order] first, in that order; the rest after, by [rest]. */
    private fun <T> manual(items: List<T>, order: List<String>, id: (T) -> String, rest: Comparator<T>): List<T> {
        val pos = HashMap<String, Int>()
        order.forEachIndexed { i, s -> pos.putIfAbsent(s, i) }
        val (placed, loose) = items.partition { id(it) in pos }
        return placed.sortedBy { pos.getValue(id(it)) } + loose.sortedWith(rest)
    }

    /**
     * Manual move (drag or up/down): [shown] is the order on screen, [id] moves to index [to]. Returns the new
     * `order` to store (every shown id, so later additions don't jump in between).
     */
    fun move(shown: List<String>, id: String, to: Int): List<String> {
        val from = shown.indexOf(id)
        if (from < 0) return shown
        val out = shown.toMutableList()
        out.removeAt(from)
        out.add(to.coerceIn(0, out.size), id)
        return out
    }

    // ---- grouped views (category / tag / date) ----

    fun byCategory(notes: List<Note>, categories: List<Category>): List<Pair<String, List<Note>>> =
        notes.groupBy { it.category }.entries
            .sortedWith(compareBy<Map.Entry<String, List<Note>>> { it.key.isBlank() }.thenBy { catKey(it.key, categories) })
            .map { Categories.nameOf(it.key, categories) to it.value.sortedByDescending { n -> n.updatedAt } }

    fun byTag(notes: List<Note>): List<Pair<String, List<Note>>> {
        val out = LinkedHashMap<String, MutableList<Note>>()
        for (n in notes) {
            if (n.tags.isEmpty()) out.getOrPut("") { mutableListOf() } += n
            for (t in n.tags.map { it.trim() }.filter { it.isNotEmpty() }.distinctBy { Text.normalize(it) }) out.getOrPut(Text.normalize(t)) { mutableListOf() } += n
        }
        return out.entries.sortedWith(compareBy<Map.Entry<String, MutableList<Note>>> { it.key.isEmpty() }.thenBy { it.key })
            .map { (if (it.key.isEmpty()) "No tags" else "#${it.key}") to it.value.sortedByDescending { n -> n.updatedAt } }
    }

    /** Newest day first; each day's notes newest first. Keys are ISO dates (yyyy-mm-dd) in [zone]. */
    fun byDay(notes: List<Note>, zone: ZoneId): List<Pair<LocalDate, List<Note>>> =
        notes.groupBy { day(it.createdAt, zone) }.entries.sortedByDescending { it.key }.map { it.key to it.value.sortedByDescending { n -> n.createdAt } }

    fun day(at: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()

    /** Start/end (inclusive) of a local day, for "today" filters and date-range smart lists. */
    fun dayRange(date: LocalDate, zone: ZoneId): Pair<Long, Long> {
        val start = date.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() - 1
        return start to end
    }

    // ---- to-dos ----

    sealed interface CheckOff {
        data class Found(val item: TodoItem, val score: Double) : CheckOff
        data class Ambiguous(val items: List<TodoItem>) : CheckOff
        data class AlreadyDone(val item: TodoItem) : CheckOff
        data object None : CheckOff
    }

    /**
     * "check off <words>": the open item the words name best. Two items scoring within 0.05 of each other and not an
     * exact match → Ambiguous (the app asks which). Only a done item matching → AlreadyDone.
     */
    fun checkOff(query: String, items: List<TodoItem>, threshold: Double = 0.6): CheckOff {
        val open = Fuzzy.ranked(query, items.filter { !it.done }, threshold) { it.text }
        if (open.isEmpty()) {
            val done = Fuzzy.best(query, items.filter { it.done }, threshold) { it.text }
            return if (done != null) CheckOff.AlreadyDone(done.item) else CheckOff.None
        }
        val top = open[0]
        if (top.score >= 0.999) return CheckOff.Found(top.item, top.score)
        val close = open.filter { top.score - it.score < 0.05 }
        return if (close.size > 1) CheckOff.Ambiguous(close.map { it.item }) else CheckOff.Found(top.item, top.score)
    }

    /** A list by spoken name ("read my list groceries"). */
    fun findList(name: String, lists: List<NoteList>, kind: ListKind? = null): NoteList? =
        Fuzzy.best(name.removeSuffix(" list").removeSuffix(" lists"), lists.filter { kind == null || it.kind == kind }, 0.7) { it.name }?.item

    /**
     * "add to-do buy milk to groceries": splits a trailing " to|on|in [the] <list> [list]" off when it names an
     * existing to-do list. Returns (item text, list or null).
     */
    fun splitTarget(arg: String, lists: List<NoteList>): Pair<String, NoteList?> {
        val words = arg.trim().split(Regex("\\s+"))
        for (i in words.indices.reversed()) {
            if (i == 0) break
            if (words[i].lowercase() !in setOf("to", "on", "in", "into")) continue
            val text = words.subList(0, i).joinToString(" ")
            var rest = words.subList(i + 1, words.size).joinToString(" ")
            if (rest.lowercase().startsWith("the ")) rest = rest.drop(4)
            if (rest.lowercase().startsWith("my ")) rest = rest.drop(3)
            if (rest.isBlank() || text.isBlank()) continue
            val list = findList(rest, lists, ListKind.TODO) ?: continue
            return text to list
        }
        return arg.trim() to null
    }
}
