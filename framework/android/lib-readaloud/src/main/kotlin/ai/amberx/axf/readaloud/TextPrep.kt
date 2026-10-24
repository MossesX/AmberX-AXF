package ai.amberx.axf.readaloud

/**
 * Turns selected text into what should be spoken, following [ReadAloudPrefs]: markdown symbols, links, emoji,
 * bracketed asides, hashtags, abbreviations, ALL-CAPS words, digits, punctuation and the user's own pronunciation
 * list ("NASA=nasa; GIF=jif"). Line breaks that mark paragraphs survive so the chunker can pause on them. Pure Kotlin.
 */
public object TextPrep {
    private val URL = Regex("""\b(?:https?://|www\.)[^\s<>()"]+""", RegexOption.IGNORE_CASE)
    private val EMAIL = Regex("""\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b""")
    private val EMOJI = Regex("[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{FE0F}\\x{200D}\\x{1F1E6}-\\x{1F1FF}]")
    private val BRACKETS = Regex("""\s*(?:\([^()]*\)|\[[^\[\]]*\])""")
    private val MD_LINK = Regex("""!?\[([^\]]*)]\(([^)]*)\)""")
    private val MD_MARKS = Regex("""(?m)^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)|(\*\*|__|\*|_|~~|`{1,3})""")
    private val HASH = Regex("""(?<![\w#])[#@](\w+)""")
    private val HYPHEN_BREAK = Regex("""(\p{L})-\n(\p{Ll})""")
    private val CAPS_WORD = Regex("""\b[A-Z]{2,6}\b""")
    private val DIGITS = Regex("""\d{2,}""")
    private val SPACES = Regex("""[ \t ]+""")
    private val BLANK_LINES = Regex("""\n\s*\n+""")
    private val SINGLE_NL = Regex("""(?<!\n)\n(?!\n)""")

    /** Common abbreviations, spoken in full (whole word, case-sensitive where it matters). */
    public val ABBREVIATIONS: List<Pair<Regex, String>> = listOf(
        "e.g." to "for example", "i.e." to "that is", "etc." to "et cetera", "vs." to "versus", "approx." to "approximately",
        "Dr." to "Doctor", "Mr." to "Mister", "Mrs." to "Missus", "St." to "Street", "No." to "Number", "w/" to "with", "w/o" to "without",
    ).map { (a, b) -> Regex("(?<![\\w.])" + Regex.escape(a) + "(?![\\w])") to b }

    private val PUNCTUATION = mapOf(',' to "comma", ';' to "semicolon", ':' to "colon", '?' to "question mark", '!' to "exclamation mark", '"' to "quote")

    /** Parses "word=say; other=say" (also one pair per line); blank or malformed pairs are skipped. */
    public fun pronunciations(spec: String): List<Pair<String, String>> =
        spec.split(';', '\n').mapNotNull { p -> val i = p.indexOf('='); if (i <= 0) null else p.substring(0, i).trim().takeIf { it.isNotEmpty() }?.let { it to p.substring(i + 1).trim() } }

    public fun prepare(raw: String, p: ReadAloudPrefs): String {
        var s = raw.replace("\r\n", "\n")
        if (p.joinHyphenatedLines) s = s.replace(HYPHEN_BREAK, "$1$2")
        if (p.stripMarkdown) s = s.replace(MD_LINK) { it.groupValues[1] }.replace(MD_MARKS, "")
        s = s.replace(URL) { m ->
            when (p.urls) {
                UrlMode.READ -> m.value
                UrlMode.SAY_LINK -> "link"
                UrlMode.DOMAIN -> domainOf(m.value)?.let { "link to $it" } ?: "link"
                UrlMode.SKIP -> ""
            }
        }
        if (p.urls != UrlMode.READ) s = s.replace(EMAIL) { m -> m.value.replace("@", " at ").replace(".", " dot ") }
        if (p.emoji == EmojiMode.SKIP) s = s.replace(EMOJI, "")
        if (p.skipBrackets) s = s.replace(BRACKETS, "")
        if (p.dropHashSigns) s = s.replace(HASH, "$1")
        if (p.expandAbbreviations) for ((re, say) in ABBREVIATIONS) s = s.replace(re, say)
        for ((word, say) in pronunciations(p.pronunciations)) s = s.replace(Regex("(?<![\\w])" + Regex.escape(word) + "(?![\\w])", RegexOption.IGNORE_CASE), Regex.escapeReplacement(say))
        if (p.spellCaps) s = s.replace(CAPS_WORD) { m -> m.value.toCharArray().joinToString(" ") }
        if (p.numbers == NumberMode.DIGITS) s = s.replace(DIGITS) { m -> m.value.toCharArray().joinToString(" ") }
        if (p.readPunctuation) s = buildString { for (c in s) { val w = PUNCTUATION[c]; if (w != null) append(' ').append(w).append(' ') else append(c) } }
        if (p.spellOut) s = s.lineSequence().joinToString("\n") { line -> line.filter { !it.isWhitespace() }.toCharArray().joinToString(" ") }
        // Paragraphs survive as one blank line; single line breaks inside a paragraph become spaces.
        s = s.replace(SPACES, " ").replace(BLANK_LINES, "\n\n").replace(SINGLE_NL, " ")
        return s.lines().joinToString("\n") { it.trim() }.replace(Regex("\n{3,}"), "\n\n").trim()
    }

    /** "https://www.example.com/a/b" → "example.com"; null when no host. */
    public fun domainOf(url: String): String? {
        val noScheme = url.substringAfter("://", url)
        val host = noScheme.substringBefore('/').substringBefore('?').substringBefore('#').substringBefore(':').lowercase().removePrefix("www.")
        return host.takeIf { it.contains('.') && it.length > 3 }
    }

    /**
     * Applies the length limit: [OverLimit.CUT] cuts at [max] characters, [OverLimit.SENTENCE] cuts at the last sentence
     * end before it (or the cut when none), [OverLimit.REFUSE] returns null so the caller can say it's too long.
     */
    public fun limit(text: String, max: Int, mode: OverLimit): String? {
        if (text.length <= max) return text
        return when (mode) {
            OverLimit.REFUSE -> null
            OverLimit.CUT -> text.substring(0, max).trimEnd()
            OverLimit.SENTENCE -> {
                val head = text.substring(0, max)
                val end = Regex("[.!?…](?=\\s|$)").findAll(head).lastOrNull()?.range?.last
                (if (end != null && end > max / 3) head.substring(0, end + 1) else head).trimEnd()
            }
        }
    }
}
