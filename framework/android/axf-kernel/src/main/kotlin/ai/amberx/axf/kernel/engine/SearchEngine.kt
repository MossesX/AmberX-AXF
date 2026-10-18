package ai.amberx.axf.kernel.engine

import java.text.Normalizer

/**
 * Search engine — one index over everything an app can show. Mirrors core/engines/search.ts: same entry shape,
 * same scoring (fixtures: spec/fixtures/search.json), open provider registry. Entries say *what* to focus
 * (`focus` = kind + fields); the UI layer (axf-ui) decides *how*. Kinds the framework knows: view, action,
 * setting, settings-tab, dialog, asset, window, text; providers may add others.
 */
public data class SearchEntry(
    val id: String,
    val kind: String,
    val label: String,
    val detail: String? = null,
    val icon: String? = null,
    val keywords: List<String> = emptyList(),
    val requires: String? = null,
    /** e.g. {kind: "view", view: "home"} · {kind: "setting", tab: "appearance", anchor: "setting:axf.roll.slot.toolbar"} */
    val focus: Map<String, String>,
)

public data class SearchHit(val entry: SearchEntry, val score: Double, val locked: Boolean)

public fun interface SearchProvider { public fun entries(): List<SearchEntry> }

public object SearchEngine {
    public val KIND_LABELS: Map<String, String> = mapOf(
        "view" to "Page", "action" to "Action", "setting" to "Setting", "settings-tab" to "Settings",
        "dialog" to "Dialog", "asset" to "Asset", "window" to "Window", "text" to "On page",
    )

    private fun norm(s: String): String = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFKD).replace(Regex("[\\u0300-\\u036f]"), "")

    /** Same rules and numbers as scoreEntry in search.ts: every word must match; label hits rank highest. 0 = no match. */
    public fun score(label: String, detail: String?, keywords: List<String>, kind: String, query: String): Double {
        val words = norm(query).split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return 0.0
        val l = norm(label)
        val rest = norm((listOf(detail ?: "") + keywords + (KIND_LABELS[kind] ?: kind)).joinToString(" "))
        val full = norm(query).trim()
        var score = 0.0
        for (w in words) {
            val s = when {
                l == w -> 100
                l.startsWith(w) -> 60
                Regex("(^|[^a-z0-9])" + Regex.escape(w)).containsMatchIn(l) -> 40
                l.contains(w) -> 25
                rest.contains(w) -> 10
                else -> return 0.0
            }
            score += s
        }
        if (words.size > 1 && l.contains(full)) score += 30
        return score - minOf(l.length, 60) / 60.0
    }

    public fun score(e: SearchEntry, query: String): Double = score(e.label, e.detail, e.keywords, e.kind, query)
}

/** Providers by id (re-adding replaces). [gate] maps a permission to ALLOW / DISABLE / HIDE (the runtime's UAC gate). */
public class SearchIndex(private val gate: (String?) -> Gate) {
    private val providers = LinkedHashMap<String, SearchProvider>()

    public fun add(id: String, provider: SearchProvider): () -> Unit {
        providers[id] = provider
        return { if (providers[id] === provider) providers.remove(id) }
    }
    public fun remove(id: String) { providers.remove(id) }

    public fun entries(): List<SearchEntry> {
        val seen = LinkedHashMap<String, SearchEntry>()
        for (p in providers.values) for (e in runCatching { p.entries() }.getOrDefault(emptyList())) seen.putIfAbsent(e.id, e)
        return seen.values.toList()
    }

    public fun query(q: String, limit: Int = 12, kinds: List<String> = emptyList()): List<SearchHit> {
        if (q.isBlank()) return emptyList()
        return entries().asSequence()
            .filter { kinds.isEmpty() || it.kind in kinds }
            .mapNotNull { e ->
                val g = gate(e.requires)
                if (g == Gate.HIDE) return@mapNotNull null
                val s = SearchEngine.score(e, q)
                if (s > 0) SearchHit(e, s, g == Gate.DISABLE) else null
            }
            .sortedWith(compareByDescending<SearchHit> { it.score }.thenBy { it.entry.label })
            .take(limit)
            .toList()
    }
}
