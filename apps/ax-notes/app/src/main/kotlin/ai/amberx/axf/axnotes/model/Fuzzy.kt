package ai.amberx.axf.axnotes.model

/** Text normalization shared by triggers, search and fuzzy matching (speech gives lower case, no punctuation). */
object Text {
    private val PUNCT = Regex("[^\\p{L}\\p{N}\\s]")
    private val SPACES = Regex("\\s+")

    /** Lower case, "to-do"/"to do" → "todo", punctuation dropped, single spaces. */
    fun normalize(s: String): String {
        var t = s.lowercase().replace("to-do", "todo").replace("to-dos", "todos")
        t = PUNCT.replace(t, " ")
        t = SPACES.replace(t, " ").trim()
        t = t.replace(Regex("\\bto do(s?)\\b"), "todo$1")
        return t
    }

    fun tokens(s: String): List<String> = normalize(s).split(' ').filter { it.isNotEmpty() }

    /** Words that carry no meaning when matching item names ("check off the milk" = "milk"). */
    val FILLER: Set<String> = setOf("the", "a", "an", "my", "to", "of", "item", "please")

    /** A short title from the first words of [text] (first sentence, at most [words] words). */
    fun titleFrom(text: String, words: Int = 6): String {
        val first = text.trim().split(Regex("(?<=[.!?])\\s+|\\n")).firstOrNull { it.isNotBlank() }?.trim() ?: return "Untitled note"
        val w = first.split(SPACES).filter { it.isNotEmpty() }
        val t = w.take(words).joinToString(" ").trimEnd('.', ',', ';', ':', '!', '?')
        return (if (w.size > words) "$t…" else t).replaceFirstChar { it.uppercase() }.ifBlank { "Untitled note" }
    }
}

/**
 * Small fuzzy matcher for speech: "check off by milk" should find "Buy milk". Scores 0..1 from whole-string and
 * per-word edit distance; filler words are ignored. Pure Kotlin so it is unit-tested without a device.
 */
object Fuzzy {
    data class Scored<T>(val item: T, val score: Double)

    fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.length]
    }

    fun ratio(a: String, b: String): Double {
        val m = maxOf(a.length, b.length)
        return if (m == 0) 1.0 else 1.0 - levenshtein(a, b).toDouble() / m
    }

    /** Plural-insensitive word: "groceries" = "grocery", "eggs" = "egg". */
    fun stem(w: String): String = when {
        w.length > 4 && w.endsWith("ies") -> w.dropLast(3) + "y"
        w.length > 3 && w.endsWith("s") && !w.endsWith("ss") -> w.dropLast(1)
        else -> w
    }

    private fun meaningful(s: String): List<String> = (Text.tokens(s).filter { it !in Text.FILLER }.ifEmpty { Text.tokens(s) }).map { stem(it) }

    /** How well [query] names [candidate], 0..1. */
    fun score(query: String, candidate: String): Double {
        val q = meaningful(query)
        val c = meaningful(candidate)
        if (q.isEmpty() || c.isEmpty()) return 0.0
        val qs = q.joinToString(" ")
        val cs = c.joinToString(" ")
        if (qs == cs) return 1.0
        val whole = ratio(qs, cs)
        // Every query word against its best candidate word, weighted by length; a candidate word used once.
        val used = BooleanArray(c.size)
        var sum = 0.0
        var weight = 0.0
        for (w in q) {
            var best = 0.0
            var at = -1
            for ((i, cw) in c.withIndex()) {
                if (used[i]) continue
                val r = ratio(w, cw)
                if (r > best) { best = r; at = i }
            }
            if (at >= 0 && best >= 0.6) used[at] = true else best = 0.0
            sum += best * w.length
            weight += w.length
        }
        val words = if (weight == 0.0) 0.0 else sum / weight
        // Penalize candidates with many words the query didn't mention (so "milk" prefers "Milk" over "Milk the cat for oat milk").
        val cover = used.count { it }.toDouble() / c.size
        val wordScore = words * (0.85 + 0.15 * cover)
        val contained = if (cs.contains(qs) && qs.length >= 3) 0.9 * (0.85 + 0.15 * qs.length / cs.length) else 0.0
        return maxOf(whole, wordScore, contained).coerceIn(0.0, 1.0)
    }

    fun <T> ranked(query: String, items: List<T>, threshold: Double = 0.6, name: (T) -> String): List<Scored<T>> =
        items.map { Scored(it, score(query, name(it))) }.filter { it.score >= threshold }.sortedByDescending { it.score }

    fun <T> best(query: String, items: List<T>, threshold: Double = 0.6, name: (T) -> String): Scored<T>? = ranked(query, items, threshold, name).firstOrNull()
}
