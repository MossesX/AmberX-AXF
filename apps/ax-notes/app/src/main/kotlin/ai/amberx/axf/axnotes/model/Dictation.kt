package ai.amberx.axf.axnotes.model

/**
 * Continuous dictation until an end phrase. Pure: the capture controller feeds it final transcript chunks (the speech
 * engine's partial results only drive the live preview). An end phrase ("end note") anywhere in a chunk ends the note
 * and everything after it is dropped; a cancel phrase throws the note away.
 */
class Dictation(endPhrases: List<String>, cancelPhrases: List<String>) {
    private val ends = endPhrases.map { Text.tokens(it) }.filter { it.isNotEmpty() }
    private val cancels = cancelPhrases.map { Text.tokens(it) }.filter { it.isNotEmpty() }
    private val parts = mutableListOf<String>()

    sealed interface Step {
        /** Still listening; [text] = the note so far. */
        data class Continue(val text: String) : Step
        /** End phrase heard: [text] is the finished note (may be blank). */
        data class Finished(val text: String) : Step
        data object Cancelled : Step
    }

    var active: Boolean = false
        private set

    val text: String get() = parts.joinToString(" ").trim()

    fun start(initial: String = "") { parts.clear(); if (initial.isNotBlank()) parts += initial.trim(); active = true }

    fun feed(chunk: String): Step {
        if (!active) start()
        val words = chunk.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val norm = words.map { Text.normalize(it) }
        // Normalizing per word keeps indexes aligned with the original words (a word that normalizes to two, like
        // "to-do" → "todo", still counts as one).
        val flat = norm.map { it.replace(' ', '_') }
        fun find(ps: List<List<String>>): Int = ps.map { p -> NoteTriggers.indexOfPhrase(flat, p.map { it.replace(' ', '_') }) }.filter { it >= 0 }.minOrNull() ?: -1
        val cancelAt = find(cancels)
        val endAt = find(ends)
        if (cancelAt >= 0 && (endAt < 0 || cancelAt < endAt)) { parts.clear(); active = false; return Step.Cancelled }
        if (endAt >= 0) {
            val before = words.subList(0, endAt).joinToString(" ")
            if (before.isNotBlank()) parts += before
            active = false
            return Step.Finished(text)
        }
        if (words.isNotEmpty()) parts += words.joinToString(" ")
        return Step.Continue(text)
    }

    /** Finish by hand (the Done button). */
    fun finish(): String { active = false; return text }

    fun cancel() { parts.clear(); active = false }
}
