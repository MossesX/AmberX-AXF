package ai.amberx.axf.readaloud

/** One piece the TTS engine speaks: [start]/[end] index into the prepared text (for highlighting), then a pause. */
public data class Utterance(val index: Int, val text: String, val start: Int, val end: Int, val pauseAfterMs: Int, val paragraphEnd: Boolean)

/**
 * Splits prepared text into utterances. Sentence / clause / line / paragraph / fixed modes; anything longer than
 * maxUtterance (Android's TTS takes at most ~4000 characters) is split again on the last space before the limit.
 * Every utterance keeps its offsets so a reader can highlight it. Pure Kotlin.
 */
public object TextChunker {
    private val SENTENCE_END = Regex("""(?<=[.!?…。！？])["'”’)\]]*\s+""")
    private val CLAUSE_END = Regex("""(?<=[,;:—–])\s+|(?<=[.!?…。！？])["'”’)\]]*\s+""")

    public fun chunk(text: String, p: ReadAloudPrefs): List<Utterance> {
        val max = p.maxUtterance.coerceIn(ReadAloudRanges.MAX_UTTERANCE.min.toInt(), ReadAloudRanges.MAX_UTTERANCE.max.toInt())
        val out = ArrayList<Utterance>()
        // Paragraphs first (blank line), so every mode can pause longer at a paragraph end.
        var pos = 0
        val paragraphs = ArrayList<IntRange>()
        for (m in Regex("\n\\s*\n").findAll(text)) { if (m.range.first > pos) paragraphs += pos until m.range.first; pos = m.range.last + 1 }
        if (pos < text.length) paragraphs += pos until text.length
        for (para in paragraphs) {
            val pieces: List<IntRange> = when (p.chunk) {
                ChunkMode.PARAGRAPH -> listOf(para)
                ChunkMode.SENTENCE -> splitBy(text, para, SENTENCE_END)
                ChunkMode.CLAUSE -> splitBy(text, para, CLAUSE_END)
                ChunkMode.LINE -> splitBy(text, para, Regex("\n"))
                ChunkMode.FIXED -> listOf(para)
            }
            val sized = pieces.flatMap { splitLong(text, it, max) }
            sized.forEachIndexed { i, r ->
                val t = text.substring(r.first, r.last + 1).trim()
                if (t.isEmpty()) return@forEachIndexed
                val lead = text.substring(r.first, r.last + 1).indexOfFirst { !it.isWhitespace() }.coerceAtLeast(0)
                val start = r.first + lead
                val last = i == sized.lastIndex
                val clause = !last && t.last() in ",;:—–"
                val pause = when { last -> p.paragraphPauseMs; clause -> p.clausePauseMs; else -> p.sentencePauseMs }
                out += Utterance(out.size, t, start, start + t.length, pause, last)
            }
        }
        if (out.isNotEmpty()) out[out.lastIndex] = out.last().copy(pauseAfterMs = 0)
        return out
    }

    private fun splitBy(text: String, range: IntRange, re: Regex): List<IntRange> {
        val seg = text.substring(range.first, range.last + 1)
        val out = ArrayList<IntRange>()
        var s = 0
        for (m in re.findAll(seg)) { if (m.range.first > s) out += (range.first + s) until (range.first + m.range.first); s = m.range.last + 1 }
        if (s < seg.length) out += (range.first + s)..range.last
        return out
    }

    private fun splitLong(text: String, r: IntRange, max: Int): List<IntRange> {
        if (r.last - r.first + 1 <= max) return listOf(r)
        val out = ArrayList<IntRange>()
        var a = r.first
        while (r.last - a + 1 > max) {
            val window = text.substring(a, a + max)
            val cut = window.lastIndexOf(' ').takeIf { it > max / 3 } ?: max
            out += a until a + cut
            a += cut
            while (a <= r.last && text[a] == ' ') a++
        }
        if (a <= r.last) out += a..r.last
        return out
    }

    /** Index of the utterance [skip] steps from [current] (sentence = one, paragraph = to the next/previous paragraph end). */
    public fun skip(utterances: List<Utterance>, current: Int, forward: Boolean, unit: SkipUnit): Int {
        if (utterances.isEmpty()) return 0
        val c = current.coerceIn(0, utterances.lastIndex)
        if (unit == SkipUnit.SENTENCE) return (if (forward) c + 1 else c - 1).coerceIn(0, utterances.lastIndex)
        return if (forward) {
            val end = (c until utterances.size).firstOrNull { utterances[it].paragraphEnd } ?: utterances.lastIndex
            (end + 1).coerceAtMost(utterances.lastIndex)
        } else {
            // Start of this paragraph, or of the previous one when already at a start.
            fun startOf(i: Int): Int { var j = i; while (j > 0 && !utterances[j - 1].paragraphEnd) j--; return j }
            val s = startOf(c)
            if (s < c) s else startOf((s - 1).coerceAtLeast(0))
        }
    }

    /** Rough speaking time: ~15 characters a second at rate 1.0, plus pauses. */
    public fun estimateMs(utterances: List<Utterance>, rate: Double): Long {
        val chars = utterances.sumOf { it.text.length }
        val pauses = utterances.sumOf { it.pauseAfterMs.toLong() }
        return (chars / (15.0 * rate.coerceAtLeast(0.1)) * 1000).toLong() + pauses
    }

    /** The word under [offset] inside [text] (for word highlighting when the engine reports no range). */
    public fun wordAt(text: String, offset: Int): IntRange? {
        if (text.isEmpty()) return null
        var a = offset.coerceIn(0, text.lastIndex)
        if (!text[a].isLetterOrDigit()) return null
        var b = a
        while (a > 0 && text[a - 1].isLetterOrDigit()) a--
        while (b < text.lastIndex && text[b + 1].isLetterOrDigit()) b++
        return a..b
    }
}
