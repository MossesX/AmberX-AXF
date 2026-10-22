package ai.amberx.axf.voice

/**
 * Pure-Kotlin phrase matching (no Android imports, so every port can mirror it): normalizes what the
 * recognizer heard and scores it against trigger phrases or free-form labels such as site names.
 */
public object PhraseMatcher {
    private val nonWord = Regex("[^\\p{L}\\p{N} ]")
    private val spaces = Regex("\\s+")
    private val siteNoise = setOf("dot", "www", "http", "https", "the")

    /** Lowercase, punctuation to spaces, single spaces. "Store  Password!" → "store password". */
    public fun normalize(text: String): String = text.lowercase().replace(nonWord, " ").replace(spaces, " ").trim()

    /** Like [normalize] but also drops URL noise, so "Gmail dot com", "gmail.com" and "www.gmail.com" agree. */
    public fun normalizeLabel(text: String): String = normalize(text).split(' ').filter { it.isNotEmpty() && it !in siteNoise }.joinToString(" ")

    /** 1.0 = identical, 0.0 = nothing in common (Levenshtein distance over the longer length). */
    public fun similarity(a: String, b: String): Double {
        if (a == b) return 1.0
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val prev = IntArray(b.length + 1) { it }
        val cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            }
            cur.copyInto(prev)
        }
        return 1.0 - prev[b.length].toDouble() / maxOf(a.length, b.length)
    }

    /** True when `phrase` appears in `heard` as whole words ("ok store password now" contains "store password"). */
    public fun containsPhrase(heard: String, phrase: String): Boolean {
        val h = " ${normalize(heard)} "
        val p = normalize(phrase)
        return p.isNotEmpty() && h.contains(" $p ")
    }

    /** Score of a spoken trigger against one phrase: 1.0 exact, 0.95 contained, otherwise similarity. */
    public fun triggerScore(heard: String, phrase: String): Double {
        val h = normalize(heard)
        val p = normalize(phrase)
        if (p.isEmpty() || h.isEmpty()) return 0.0
        if (h == p) return 1.0
        if (containsPhrase(h, p)) return 0.95
        return similarity(h, p)
    }

    /**
     * Score of a spoken label against a stored one (sites, contacts, …). Also accepts the first word
     * alone ("gmail" for "gmail.com") and a match without the last word (the TLD).
     */
    public fun labelScore(heard: String, label: String): Double {
        val h = normalizeLabel(heard)
        val l = normalizeLabel(label)
        if (h.isEmpty() || l.isEmpty()) return 0.0
        if (h == l) return 1.0
        val words = l.split(' ')
        val noTld = if (words.size > 1) words.dropLast(1).joinToString(" ") else l
        if (h == noTld) return 0.97
        if (containsPhrase(l, h) || containsPhrase(h, l)) return 0.9
        return maxOf(similarity(h, l), similarity(h, noTld), similarity(h.replace(" ", ""), l.replace(" ", "")))
    }

    /** One candidate and its score. */
    public data class Match<T>(val item: T, val score: Double, val heard: String)

    /**
     * Best candidate over every recognizer alternative, or null below [threshold]. Ties go to the
     * longer label, so "retrieve password" beats "password".
     */
    public fun <T> best(heard: List<String>, candidates: List<T>, threshold: Double, label: (T) -> String, score: (String, String) -> Double = ::labelScore): Match<T>? {
        var best: Match<T>? = null
        for (h in heard) for (c in candidates) {
            val s = score(h, label(c))
            val b = best
            if (s >= threshold && (b == null || s > b.score || (s == b.score && label(c).length > label(b.item).length))) best = Match(c, s, h)
        }
        return best
    }

    /** Every candidate at or above [threshold], best first — used to offer "did you mean" choices. */
    public fun <T> ranked(heard: List<String>, candidates: List<T>, threshold: Double, label: (T) -> String): List<Match<T>> =
        candidates.mapNotNull { c -> heard.map { h -> Match(c, labelScore(h, label(c)), h) }.maxByOrNull { it.score }?.takeIf { it.score >= threshold } }.sortedByDescending { it.score }
}
