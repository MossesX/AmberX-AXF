package ai.amberx.axf.selection

/**
 * What another app handed over from its text selection menu (Android `ACTION_PROCESS_TEXT`). Pure Kotlin, so other
 * ports (a desktop "selected text" hook, a browser extension) mirror the same rules.
 *
 * [readOnly] = the selection is in text the user can't edit (a web page, a label); false = an editable field, where the
 * entry may hand back replacement text. [entry] = which menu entry was tapped (the alias / entry id), [truncated] = the
 * text was longer than the cap and was cut.
 */
public data class SelectedText(val text: String, val readOnly: Boolean, val entry: String, val originalLength: Int, val truncated: Boolean) {
    public val isEmpty: Boolean get() = text.isBlank()
}

public object SelectionRules {
    /** Selections longer than this are cut (Android hands over up to ~1 MB of text in an intent). */
    public const val DEFAULT_MAX_CHARS: Int = 100_000
    public const val MIN_MAX_CHARS: Int = 1
    public const val HARD_MAX_CHARS: Int = 500_000
    private val ZERO_WIDTH = Regex("[\\u200B-\\u200D\\uFEFF\\u00AD]")
    private val CONTROL = Regex("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]")

    /**
     * Cleans what the other app sent: drops zero-width characters, soft hyphens and control characters (keeps tabs and
     * line breaks), normalises CRLF, trims, and cuts at [maxChars] (clamped to 1…[HARD_MAX_CHARS]) on the last word
     * boundary when [cutOnWord] and one exists in the last 10%.
     */
    public fun clean(raw: CharSequence?, entry: String = "", readOnly: Boolean = true, maxChars: Int = DEFAULT_MAX_CHARS, cutOnWord: Boolean = true): SelectedText {
        val s = (raw?.toString() ?: "").replace("\r\n", "\n").replace('\r', '\n').replace(ZERO_WIDTH, "").replace(CONTROL, "").trim()
        val cap = maxChars.coerceIn(MIN_MAX_CHARS, HARD_MAX_CHARS)
        if (s.length <= cap) return SelectedText(s, readOnly, entry, s.length, false)
        var cut = cap
        if (cutOnWord) {
            val ws = s.lastIndexOf(' ', cap).let { a -> maxOf(a, s.lastIndexOf('\n', cap)) }
            if (ws >= cap - cap / 10 && ws > 0) cut = ws
        }
        return SelectedText(s.substring(0, cut).trimEnd(), readOnly, entry, s.length, true)
    }

    /** Short preview for a toast / notification title: first line, at most [max] characters, with an ellipsis. */
    public fun preview(text: String, max: Int = 60): String {
        val line = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: return ""
        val m = max.coerceAtLeast(4)
        return if (line.length <= m) line else line.substring(0, m - 1).trimEnd() + "…"
    }

    /** Word count the way a reader counts them (runs of letters/digits, apostrophes inside words kept). */
    public fun words(text: String): Int = Regex("[\\p{L}\\p{N}]+(?:['’][\\p{L}\\p{N}]+)*").findAll(text).count()
}
