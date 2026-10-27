package ai.amberx.axf.axnotes.plugins.notesorter

import ai.amberx.axf.axnotes.model.Categories
import ai.amberx.axf.axnotes.model.Category
import ai.amberx.axf.axnotes.model.Fuzzy
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteList
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.axnotes.model.Text
import ai.amberx.axf.axnotes.model.TodoItem
import ai.amberx.axf.axnotes.pluginhost.Hashes
import ai.amberx.axf.axnotes.pluginhost.J
import ai.amberx.axf.axnotes.pluginhost.ReplyJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/*
 * Note sorter (plugin ai.amberx.axf.axnotes.plugins.note-sorter) — pure logic, unit-tested on the JVM:
 * the AI prompt + JSON reply, the local rule fallback, learning from re-categorizations, filing into lists, action
 * items → to-dos, and the daily / weekly digest text (plain sentences, ready to be read aloud by lib-speech).
 */

/** What sorting decided for one note. [category] is a name ("" = leave as is). */
data class SortResult(
    val category: String,
    val tags: List<String>,
    val title: String,
    val summary: String,
    val actions: List<String>,
    val fromAi: Boolean,
)

/** The user moved a note the sorter had filed under [from] to [to]; [sample] is the start of its text. */
data class Correction(val sample: String, val from: String, val to: String, val at: Long)

/** What the sorter last did to a note: re-sorts only when the text changes; a category change with the same text = a correction. */
data class SortRecord(
    val noteId: String,
    val textHash: String,
    /** category id the note had after sorting (or after the last correction) */
    val category: String,
    val summary: String,
    /** action items already turned into to-dos for this note */
    val actions: List<String>,
    val at: Long,
    /** the user picked this note's category by hand: sorting never changes it again */
    val userSet: Boolean = false,
)

enum class SummaryLength(val wire: String, val words: Int, val label: String) {
    SHORT("short", 20, "Short (about 20 words)"), MEDIUM("medium", 40, "Medium (about 40 words)"), LONG("long", 80, "Long (about 80 words)");

    companion object { fun of(s: String?): SummaryLength = entries.firstOrNull { it.wire == s?.trim()?.lowercase() } ?: SHORT }
}

enum class DigestPeriod(val wire: String) {
    OFF("off"), DAILY("daily"), WEEKLY("weekly");

    companion object { fun of(s: String?): DigestPeriod = entries.firstOrNull { it.wire == s?.trim()?.lowercase() } ?: OFF }
}

object Sorter {
    const val MAX_TEXT = 4000
    const val MAX_TAGS = 5
    const val MAX_ACTIONS = 10

    fun textHash(n: Note): String = Hashes.fnv64(n.text.trim())

    /** Notes the sorter looks at: typed or spoken, with text. Its own digests and other AI notes are never sorted. */
    fun sortable(n: Note): Boolean = n.source != NoteSource.AI && n.text.isNotBlank()

    /**
     * Notes to sort now: sortable, changed since enabled ([since]), and new to the sorter or with new text.
     * [records] by note id.
     */
    fun pending(notes: List<Note>, records: Map<String, SortRecord>, since: Long): List<Note> =
        notes.filter { sortable(it) && it.updatedAt >= since && records[it.id]?.textHash != textHash(it) }.sortedBy { it.updatedAt }

    /** Re-categorizations by hand: same text as when sorted, other category. */
    fun corrections(notes: List<Note>, records: Map<String, SortRecord>, categories: List<Category>, now: Long): List<Pair<SortRecord, Correction>> =
        notes.mapNotNull { n ->
            val r = records[n.id] ?: return@mapNotNull null
            if (r.textHash != textHash(n) || r.category == n.category || n.category.isBlank()) return@mapNotNull null
            r.copy(category = n.category, at = now, userSet = true) to Correction(sample(n.text), Categories.nameOf(r.category, categories), Categories.nameOf(n.category, categories), now)
        }

    fun sample(text: String): String = text.replace(Regex("\\s+"), " ").trim().take(160)

    /** Keeps the title the user wrote; replaces only an automatic one (first words of the text) or a blank one. */
    /** The category stays as it is: the user chose it when writing the note, or by hand at any time. */
    fun userCategory(current: Note, prev: SortRecord?): Boolean =
        current.category.isNotBlank() && (prev == null || prev.userSet || current.category != prev.category)

    fun keepsTitle(n: Note): Boolean = n.title.isNotBlank() && n.title != Text.titleFrom(n.text) && n.title != "Untitled note"

    fun mergeTags(old: List<String>, new: List<String>): List<String> =
        (old + new).map { it.trim().removePrefix("#").trim() }.filter { it.isNotEmpty() }.distinctBy { Text.normalize(it) }.take(30)

    fun cleanTag(s: String): String = Text.normalize(s.removePrefix("#")).replace(' ', '-').take(30)

    fun words(s: String, max: Int): String {
        val w = s.replace(Regex("\\s+"), " ").trim().split(' ').filter { it.isNotEmpty() }
        return if (w.size <= max) w.joinToString(" ") else w.take(max).joinToString(" ").trimEnd('.', ',', ';', ':') + "…"
    }
}

object SorterPrompt {
    const val MAX_EXAMPLES = 5

    /** Short, structured prompt for mode ai.chat; the reply must be one JSON object. */
    fun build(text: String, categories: List<String>, corrections: List<Correction>, summaryWords: Int): String = buildString {
        append("Sort this note for the AX Notes app. Reply with ONE JSON object and nothing else:\n")
        append("{\"category\":\"<name>\",\"tags\":[\"<tag>\"],\"title\":\"<title>\",\"summary\":\"<summary>\",\"actions\":[\"<to-do>\"]}\n")
        val cats = categories.map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(40)
        if (cats.isNotEmpty()) append("category: one of ").append(cats.joinToString(", ")).append(" (a new short name only if none fits)\n")
        else append("category: a short name, one or two words\n")
        append("tags: up to ${Sorter.MAX_TAGS} short lowercase words. title: up to 8 words. summary: up to $summaryWords words.\n")
        append("actions: each thing the writer has to do, as a short imperative to-do; [] if none.\n")
        val ex = corrections.sortedByDescending { it.at }.take(MAX_EXAMPLES)
        if (ex.isNotEmpty()) {
            append("The user re-filed these notes; sort similar notes the same way:\n")
            for (c in ex) append("- \"").append(c.sample.replace("\"", "'")).append("\" -> ").append(c.to).append('\n')
        }
        append("Note:\n\"\"\"\n").append(text.take(Sorter.MAX_TEXT).replace("\"\"\"", "\"")).append("\n\"\"\"")
    }
}

object SorterReply {
    /** The AI's JSON reply as a [SortResult]; null when there is no usable object. */
    fun parse(reply: String, summaryWords: Int): SortResult? {
        val o = ReplyJson.extract(reply) ?: return null
        val category = J.text(o, "category", 60).trimEnd('.')
        val tags = J.strings(o["tags"], 20).map { Sorter.cleanTag(it) }.filter { it.isNotEmpty() }.distinct().take(Sorter.MAX_TAGS)
        val title = Sorter.words(J.text(o, "title", 200), 12)
        val summary = Sorter.words(J.text(o, "summary", 2000), summaryWords)
        val actions = cleanActions(J.strings(o["actions"], 40))
        if (category.isEmpty() && tags.isEmpty() && title.isEmpty() && summary.isEmpty() && actions.isEmpty()) return null
        return SortResult(category, tags, title, summary, actions, fromAi = true)
    }

    fun cleanActions(raw: List<String>): List<String> =
        raw.map { it.replace(Regex("\\s+"), " ").trim().removePrefix("- ").removePrefix("[ ]").trim().trimEnd('.').take(200) }
            .filter { it.length >= 2 }
            .map { it.replaceFirstChar { c -> c.uppercase() } }
            .distinctBy { Text.normalize(it) }
            .take(Sorter.MAX_ACTIONS)
}

/** Sorting without AI: learned corrections first, then category names found in the text, then simple hints. */
object LocalSorter {
    /** Hint words for common category names; used only when a category with that name exists. */
    private val HINTS: Map<String, Set<String>> = mapOf(
        "work" to setOf("meeting", "client", "deadline", "project", "email", "boss", "office", "report", "invoice", "sprint", "standup"),
        "home" to setOf("rent", "clean", "laundry", "kitchen", "garden", "repair", "bills", "house"),
        "shopping" to setOf("buy", "milk", "groceries", "grocery", "store", "order", "shop"),
        "ideas" to setOf("idea", "maybe", "what if", "could", "concept", "brainstorm"),
        "health" to setOf("doctor", "gym", "medicine", "appointment", "workout", "run", "dentist"),
        "family" to setOf("mom", "dad", "wife", "husband", "kids", "son", "daughter", "cousin"),
        "code" to setOf("bug", "commit", "repo", "build", "deploy", "kotlin", "function", "refactor"),
    )
    private val HASHTAG = Regex("(?<![\\p{L}\\p{N}_])#([\\p{L}\\p{N}_-]{2,30})")

    fun sort(text: String, categories: List<String>, corrections: List<Correction>, summaryWords: Int): SortResult {
        val category = category(text, categories, corrections)
        val tags = HASHTAG.findAll(text).map { Sorter.cleanTag(it.groupValues[1]) }.filter { it.isNotEmpty() }.distinct().take(Sorter.MAX_TAGS).toList()
        val summary = Sorter.words(firstSentences(text, summaryWords), summaryWords)
        return SortResult(category, tags, Text.titleFrom(text), summary, ActionItems.extract(text), fromAi = false)
    }

    fun category(text: String, categories: List<String>, corrections: List<Correction>): String {
        nearest(text, corrections)?.let { return it.to }
        val words = Text.tokens(text).map { Fuzzy.stem(it) }.toSet()
        if (words.isEmpty()) return ""
        // A category whose name is in the text ("work on the deck" → Work).
        categories.firstOrNull { c -> val t = Text.tokens(c).map { Fuzzy.stem(it) }; t.isNotEmpty() && t.all { it in words } }?.let { return it }
        // Hint words for a category the user has.
        val norm = " " + Text.normalize(text) + " "
        val scored = categories.map { c ->
            val hints = HINTS[Fuzzy.stem(Text.normalize(c))] ?: HINTS[Text.normalize(c)] ?: emptySet()
            c to hints.count { h -> norm.contains(" $h ") || (" " + words.joinToString(" ") + " ").contains(" ${Fuzzy.stem(h)} ") }
        }.filter { it.second > 0 }.sortedByDescending { it.second }
        return scored.firstOrNull()?.first ?: ""
    }

    /** The learned correction whose sample is most like [text] (word overlap ≥ 0.35), newest first on ties. */
    fun nearest(text: String, corrections: List<Correction>): Correction? {
        val a = meaningful(text)
        if (a.isEmpty()) return null
        var best: Correction? = null
        var bestScore = 0.0
        for (c in corrections.sortedByDescending { it.at }) {
            val b = meaningful(c.sample)
            if (b.isEmpty()) continue
            val inter = a.intersect(b).size.toDouble()
            val score = inter / (a.union(b).size)
            if (score > bestScore) { bestScore = score; best = c }
        }
        return if (bestScore >= 0.35) best else null
    }

    private val STOP = setOf("the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "it", "i", "my", "me", "at", "with", "this", "that", "be", "about", "we", "you")
    private fun meaningful(s: String): Set<String> = Text.tokens(s.take(Sorter.MAX_TEXT)).filter { it !in STOP && it.length > 1 }.map { Fuzzy.stem(it) }.toSet()

    private fun firstSentences(text: String, maxWords: Int): String {
        val parts = text.trim().split(Regex("(?<=[.!?])\\s+|\\n+")).map { it.trim() }.filter { it.isNotEmpty() }
        val out = StringBuilder()
        for (p in parts) {
            val next = if (out.isEmpty()) p else "$out $p"
            if (next.split(' ').size > maxWords && out.isNotEmpty()) break
            out.clear(); out.append(next)
        }
        return out.toString()
    }
}

/** Action items in a note, and which of them still need a to-do. */
object ActionItems {
    private val LINE = Regex("^\\s*(?:[-*]\\s*)?(?:\\[\\s?]|todo\\s*[:\\-]|to-do\\s*[:\\-]|to do\\s*[:\\-]|action\\s*[:\\-])\\s*(.+)$", RegexOption.IGNORE_CASE)
    private val PHRASE = Regex("\\b(?:i |we )?(?:need to|have to|must|remember to|don't forget to|dont forget to|should)\\s+([^.!?\\n;]{2,160})", RegexOption.IGNORE_CASE)

    fun extract(text: String): List<String> {
        val out = ArrayList<String>()
        for (line in text.lines()) {
            val m = LINE.find(line)
            if (m != null) { out += m.groupValues[1]; continue }
            for (p in PHRASE.findAll(line)) out += p.groupValues[1]
        }
        return SorterReply.cleanActions(out)
    }

    /** Actions that aren't on the list yet (open items, fuzzy) and weren't already made for this note. */
    fun newOnes(actions: List<String>, existing: List<TodoItem>, already: List<String>): List<String> {
        val done = already.map { Text.normalize(it) }.toSet()
        val open = existing.filter { !it.done }.map { Text.normalize(it.text) }
        return actions.filter { a ->
            val n = Text.normalize(a)
            n.isNotEmpty() && n !in done && open.none { it == n || Fuzzy.ratio(it, n) >= 0.9 }
        }.distinctBy { Text.normalize(it) }
    }
}

/** Filing: the note lists whose name matches the note's category or one of its tags. */
object Filing {
    fun listsFor(categoryName: String, tags: List<String>, lists: List<NoteList>, current: List<String>): List<String> {
        val keys = (listOf(categoryName) + tags).map { Fuzzy.stem(Text.normalize(it.replace('-', ' '))) }.filter { it.isNotEmpty() }
        if (keys.isEmpty()) return emptyList()
        return lists.filter { l ->
            l.kind == ListKind.NOTES && l.id !in current &&
                Fuzzy.stem(Text.normalize(l.name)).let { name -> keys.any { k -> k == name || (k.length >= 4 && Fuzzy.ratio(k, name) >= 0.85) } }
        }.map { it.id }
    }
}

/** Daily / weekly digest note: plain sentences for reading aloud (lib-speech reads it; no markup, no bullets). */
object Digest {
    data class Range(val from: Long, val to: Long, val label: String)
    data class Output(val title: String, val text: String)

    private val DAY = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.ENGLISH)
    private val SHORT = DateTimeFormatter.ofPattern("d MMMM", Locale.ENGLISH)
    const val TAG = "digest"
    const val CATEGORY = "Digest"

    private fun day(at: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    private fun weekStart(d: LocalDate): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    private fun startOf(d: LocalDate, zone: ZoneId): Long = d.atStartOfDay(zone).toInstant().toEpochMilli()

    /** An automatic digest is due once a new day (week, from Monday) has started since the last one. */
    fun due(lastAt: Long?, now: Long, period: DigestPeriod, zone: ZoneId): Boolean = when (period) {
        DigestPeriod.OFF -> false
        DigestPeriod.DAILY -> lastAt == null || day(lastAt, zone) < day(now, zone)
        DigestPeriod.WEEKLY -> lastAt == null || weekStart(day(lastAt, zone)) < weekStart(day(now, zone))
    }

    /** [previous] = the day / week that just ended (automatic digest), else today / this week so far (asked for). */
    fun range(period: DigestPeriod, now: Long, zone: ZoneId, previous: Boolean): Range {
        val today = day(now, zone)
        return if (period == DigestPeriod.WEEKLY) {
            val start = weekStart(today).minusWeeks(if (previous) 1 else 0)
            val end = if (previous) startOf(start.plusWeeks(1), zone) - 1 else now
            Range(startOf(start, zone), end, "the week of ${start.format(SHORT)}")
        } else {
            val d = if (previous) today.minusDays(1) else today
            Range(startOf(d, zone), if (previous) startOf(d.plusDays(1), zone) - 1 else now, d.format(DAY))
        }
    }

    fun isDigest(n: Note): Boolean = n.tags.any { it.equals(TAG, ignoreCase = true) } && n.source == NoteSource.AI

    /** The digest for [range]; null when nothing happened in it. [summaries] by note id (from the sorter's records). */
    fun build(period: DigestPeriod, range: Range, notes: List<Note>, summaries: Map<String, String>, lists: List<NoteList>, categories: List<Category>): Output? {
        val inRange = notes.filter { !isDigest(it) && it.createdAt in range.from..range.to }.sortedBy { it.createdAt }
        val items = lists.filter { it.kind == ListKind.TODO }.flatMap { it.items }
        val added = items.count { it.createdAt in range.from..range.to }
        val done = items.count { it.doneAt != null && it.doneAt in range.from..range.to }
        val open = items.filter { !it.done }
        if (inRange.isEmpty() && added == 0 && done == 0) return null
        val kind = if (period == DigestPeriod.WEEKLY) "Weekly" else "Daily"
        val title = "$kind digest, ${range.label}"
        val out = StringBuilder()
        out.append("$kind digest for ${range.label}. ")
        out.append(when (inRange.size) { 0 -> "You wrote no notes."; 1 -> "You wrote one note."; else -> "You wrote ${inRange.size} notes." })
        val groups = inRange.groupBy { it.category }.entries.sortedWith(compareBy<Map.Entry<String, List<Note>>> { it.key.isBlank() }.thenByDescending { it.value.size })
        for ((cat, ns) in groups) {
            out.append("\n\n").append(Categories.nameOf(cat, categories)).append(", ").append(if (ns.size == 1) "one note" else "${ns.size} notes").append(". ")
            out.append(ns.take(8).joinToString(" ") { sentence(summaries[it.id]?.takeIf { s -> s.isNotBlank() } ?: it.title) })
            if (ns.size > 8) out.append(" And ${ns.size - 8} more.")
        }
        out.append("\n\nTo-dos: ")
        out.append(listOf(count(added, "added"), count(done, "done"), count(open.size, "still open")).joinToString(", ")).append('.')
        val top = open.sortedWith(compareByDescending<TodoItem> { it.priority.rank }.thenBy { it.dueAt ?: Long.MAX_VALUE }.thenBy { it.createdAt }).take(3)
        if (top.isNotEmpty() && (top[0].priority != Priority.NONE || top[0].dueAt != null)) out.append(" Most urgent: ").append(top.joinToString(", ") { it.text.trimEnd('.') }).append('.')
        return Output(title, out.toString())
    }

    private fun count(n: Int, what: String) = if (n == 1) "one $what" else "$n $what"
    private fun sentence(s: String): String { val t = s.trim().trimEnd('…'); return if (t.endsWith('.') || t.endsWith('!') || t.endsWith('?')) t else "$t." }
}

/** JSON for the sorter's own data (records, corrections, state). */
object SorterCodec {
    fun record(r: SortRecord): JsonObject = JsonObject(linkedMapOf(
        "noteId" to JsonPrimitive(r.noteId), "textHash" to JsonPrimitive(r.textHash), "category" to JsonPrimitive(r.category),
        "summary" to JsonPrimitive(r.summary), "actions" to J.arr(r.actions), "at" to JsonPrimitive(r.at), "userSet" to JsonPrimitive(r.userSet),
    ))

    fun record(o: JsonObject): SortRecord? {
        val id = J.str(o, "noteId") ?: return null
        return SortRecord(id, J.str(o, "textHash") ?: "", J.str(o, "category") ?: "", J.text(o, "summary", 2000), J.strings(o["actions"], 50), J.long(o, "at") ?: 0L, J.bool(o, "userSet") ?: false)
    }

    fun corrections(list: List<Correction>): JsonObject = JsonObject(mapOf("items" to JsonArray(list.map {
        JsonObject(linkedMapOf("sample" to JsonPrimitive(it.sample), "from" to JsonPrimitive(it.from), "to" to JsonPrimitive(it.to), "at" to JsonPrimitive(it.at)))
    })))

    fun corrections(o: JsonObject?): List<Correction> = J.objects(o?.get("items"), Learning.MAX).mapNotNull {
        val to = J.str(it, "to") ?: return@mapNotNull null
        Correction(J.text(it, "sample", 200), J.str(it, "from") ?: "", to, J.long(it, "at") ?: 0L)
    }
}

object Learning {
    const val MAX = 50

    /** Adds [c]; an older correction of nearly the same text is replaced; keeps the newest [MAX]. */
    fun add(list: List<Correction>, c: Correction): List<Correction> =
        (list.filterNot { Text.normalize(it.sample) == Text.normalize(c.sample) } + c).sortedByDescending { it.at }.take(MAX)
}
