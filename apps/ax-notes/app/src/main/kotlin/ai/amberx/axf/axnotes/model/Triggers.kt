package ai.amberx.axf.axnotes.model

/**
 * Voice triggers as data. The shipped set is `app/src/main/assets/axnotes/triggers.json` (format `axnotes-triggers@1`,
 * parsed by NotesCodec.triggers); [DEFAULTS] is the same set in code, used when the file can't be read.
 *
 * Phrase syntax: plain words, plus at most one slot at the end: `{name}` needs words after the phrase,
 * `{name?}` may be empty. "note {text}" matches "note buy milk" (text = "buy milk").
 *
 * TODO(lib-triggers, kernel triggers@1 — build steps s4/s7): these become triggers@1 records registered through the
 * shared trigger registry (permanent triggers, user-replaceable phrases, per-trigger threshold). Until then the app
 * matches transcripts itself ([match]) through the app-local TriggerSink (capture/Interfaces.kt).
 */
data class TriggerDef(
    val id: String,
    val label: String,
    val phrases: List<String>,
    val description: String = "",
    val group: String = "notes",
)

data class TriggerHit(val def: TriggerDef, val phrase: String, val arg: String)

object NoteTriggers {
    const val FORMAT = "axnotes-triggers@1"

    // Trigger ids (the controller dispatches on these).
    const val NOTE_QUICK = "notes.quick"
    const val NOTE_TAKE = "notes.take"
    const val NOTE_END = "notes.end"
    const val NOTE_CANCEL = "notes.cancel"
    const val READ_BACK = "notes.readBack"
    const val SUMMARIZE = "notes.summarize"
    const val OPEN_NOTES = "notes.open"
    const val TODO_ADD = "lists.todoAdd"
    const val TODO_CHECK = "lists.checkOff"
    const val LIST_READ = "lists.read"
    const val LIST_NEW = "lists.new"

    val DEFAULTS: List<TriggerDef> = listOf(
        TriggerDef(NOTE_TAKE, "Take a note", listOf("take a note", "new note", "start a note"), "Starts dictation; everything you say goes into the note until “end note”."),
        TriggerDef(NOTE_END, "End note", listOf("end note", "end of note", "stop note", "save note"), "Ends dictation and saves the note."),
        TriggerDef(NOTE_CANCEL, "Cancel note", listOf("cancel note", "discard note"), "Throws away the note being dictated."),
        TriggerDef(NOTE_QUICK, "Quick note", listOf("note {text}"), "Saves the words after “note” as a note right away."),
        TriggerDef(READ_BACK, "Read back", listOf("read back {target?}"), "Reads notes aloud: “read back last”, “read back today” or a category name."),
        TriggerDef(SUMMARIZE, "Summarize", listOf("summarize {category?}", "summarise {category?}"), "Summarizes a category (or all notes) aloud."),
        TriggerDef(OPEN_NOTES, "Open notes", listOf("open notes", "show notes", "open my notes"), "Opens AX Notes on the notes screen."),
        TriggerDef(TODO_ADD, "Add to-do", listOf("add todo {text}", "add a todo {text}", "new todo {text}"), "Adds an item; end with “to <list>” to pick the list.", "lists"),
        TriggerDef(TODO_CHECK, "Check off", listOf("check off {item}", "tick off {item}", "mark done {item}"), "Ticks the item whose words match best.", "lists"),
        TriggerDef(LIST_READ, "Read my list", listOf("read my list {name}", "read list {name}", "read my {name} list"), "Reads a list aloud.", "lists"),
        TriggerDef(LIST_NEW, "New list", listOf("new todo list {name}", "new list {name}", "create list {name}", "make a list {name}"), "Creates a list (“new todo list …” makes a to-do list).", "lists"),
    )

    private val SLOT = Regex("\\{([A-Za-z]+)(\\??)}\\s*$")

    private class Pattern(val def: TriggerDef, val phrase: String, val head: List<String>, val tail: List<String>, val slot: Boolean, val optional: Boolean)

    private fun compile(defs: List<TriggerDef>): List<Pattern> = defs.flatMap { d ->
        d.phrases.mapNotNull { p ->
            val m = SLOT.find(p)
            val words = Text.tokens(if (m != null) p.substring(0, m.range.first) else p)
            if (words.isEmpty() && m == null) return@mapNotNull null
            // "read my {name} list": a slot in the middle keeps the words after it as a tail.
            val mid = Regex("\\{([A-Za-z]+)(\\??)}").find(p)
            if (m == null && mid != null) {
                val head = Text.tokens(p.substring(0, mid.range.first))
                val tail = Text.tokens(p.substring(mid.range.last + 1))
                Pattern(d, p, head, tail, true, mid.groupValues[2] == "?")
            } else Pattern(d, p, words, emptyList(), m != null, m?.groupValues?.get(2) == "?")
        }
    }

    /**
     * The trigger [utterance] starts with, longest phrase first; null when none. A slot keeps the user's own words
     * (original casing, punctuation dropped).
     */
    fun match(utterance: String, defs: List<TriggerDef> = DEFAULTS): TriggerHit? {
        val said = Text.tokens(utterance)
        if (said.isEmpty()) return null
        val patterns = compile(defs).sortedByDescending { it.head.size + it.tail.size }
        for (p in patterns) {
            if (said.size < p.head.size + p.tail.size) continue
            if (said.subList(0, p.head.size) != p.head) continue
            if (p.tail.isNotEmpty() && said.subList(said.size - p.tail.size, said.size) != p.tail) continue
            val rest = said.subList(p.head.size, said.size - p.tail.size)
            if (!p.slot) { if (rest.isEmpty()) return TriggerHit(p.def, p.phrase, ""); continue }
            if (rest.isEmpty() && !p.optional) continue
            return TriggerHit(p.def, p.phrase, rest.joinToString(" "))
        }
        return null
    }

    /** Where [phrase] (e.g. "end note") occurs in [said] as whole words: token index, or -1. */
    fun indexOfPhrase(said: List<String>, phrase: List<String>): Int {
        if (phrase.isEmpty() || said.size < phrase.size) return -1
        for (i in 0..said.size - phrase.size) if (said.subList(i, i + phrase.size) == phrase) return i
        return -1
    }

    fun phrasesOf(id: String, defs: List<TriggerDef>): List<String> = defs.firstOrNull { it.id == id }?.phrases.orEmpty()
}

/** What "read back …" asked for. */
sealed interface ReadTarget {
    data object Last : ReadTarget
    data object Today : ReadTarget
    data class InCategory(val category: Category) : ReadTarget
    data class Unknown(val words: String) : ReadTarget

    companion object {
        fun parse(arg: String, categories: List<Category>): ReadTarget {
            val a = Text.normalize(arg).removePrefix("my ").removePrefix("the ").removeSuffix(" notes").removeSuffix(" note").trim()
            return when (a) {
                "", "last", "last note", "latest" -> Last
                "today", "todays", "today s" -> Today
                else -> Fuzzy.best(a, categories, 0.7) { it.name }?.let { InCategory(it.item) } ?: Unknown(arg)
            }
        }
    }
}
