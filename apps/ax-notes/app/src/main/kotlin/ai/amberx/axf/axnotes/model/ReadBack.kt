package ai.amberx.axf.axnotes.model

import java.time.LocalDate
import java.time.ZoneId

/** What AX Notes says aloud. Pure: the Speaker interface (capture/Interfaces.kt) does the talking. */
object ReadBack {
    const val MAX_READ = 5

    fun notes(target: ReadTarget, all: List<Note>, categories: List<Category>, today: LocalDate, zone: ZoneId): String {
        val newest = all.sortedByDescending { it.createdAt }
        return when (target) {
            ReadTarget.Last -> newest.firstOrNull()?.let { "Your last note: ${say(it)}" } ?: "You have no notes yet."
            ReadTarget.Today -> {
                val (from, to) = ListRules.dayRange(today, zone)
                val n = newest.filter { it.createdAt in from..to }
                if (n.isEmpty()) "No notes today." else "${count(n.size, "note")} today. " + list(n)
            }
            is ReadTarget.InCategory -> {
                val n = newest.filter { it.category == target.category.id }
                if (n.isEmpty()) "No notes in ${target.category.name}." else "${count(n.size, "note")} in ${target.category.name}. " + list(n)
            }
            is ReadTarget.Unknown -> "I don't have a category called ${target.words}." +
                (if (categories.isEmpty()) "" else " Categories: ${categories.sortedBy { it.order }.joinToString(", ") { it.name }}.")
        }
    }

    fun todoList(list: NoteList, categories: List<Category>): String {
        if (list.kind != ListKind.TODO) return "${list.name}: this is a note list."
        val items = ListRules.itemsOf(list, categories)
        val open = items.filter { !it.done }
        if (items.isEmpty()) return "${list.name} is empty."
        if (open.isEmpty()) return "${list.name}: everything is done."
        val shown = open.take(MAX_READ * 2)
        val more = open.size - shown.size
        return "${list.name}: ${count(open.size, "item")} to do. " + shown.joinToString(". ") { it.text } + "." + (if (more > 0) " And $more more." else "")
    }

    fun noteList(list: NoteList, all: List<Note>, categories: List<Category>): String {
        val n = ListRules.notesOf(list, all, categories)
        return if (n.isEmpty()) "${list.name} has no notes." else "${list.name}: ${count(n.size, "note")}. " + list(n)
    }

    /** Fallback when no AI is wired: count + titles. */
    fun localSummary(label: String, notes: List<Note>): String =
        if (notes.isEmpty()) "Nothing to summarize in $label." else "$label has ${count(notes.size, "note")}: " + notes.sortedByDescending { it.updatedAt }.take(MAX_READ).joinToString("; ") { it.title } + "."

    private fun say(n: Note): String = if (n.text.isBlank()) n.title else n.text
    private fun list(n: List<Note>): String = n.take(MAX_READ).joinToString(" ") { say(it).trimEnd().let { s -> if (s.endsWith('.')) s else "$s." } } +
        (if (n.size > MAX_READ) " And ${n.size - MAX_READ} more." else "")
    fun count(n: Int, word: String): String = if (n == 1) "1 $word" else "$n ${word}s"
}
