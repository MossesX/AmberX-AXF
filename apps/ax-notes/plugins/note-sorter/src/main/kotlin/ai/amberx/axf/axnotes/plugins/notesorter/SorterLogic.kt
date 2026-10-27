package ai.amberx.axf.axnotes.plugins.notesorter

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
 * Note sorter (plugin ai.amberx.axf.axnotes.note-sorter) — pure logic, unit-tested on the JVM: the AI prompt and its
 * JSON reply, the local rule fallback, learning from re-categorizations, the save / to-do payloads for the app's host
 * actions, and the daily / weekly digest text (plain sentences, for lib-speech to read aloud).
 */

/** A note as the app announces it (`axnotes.notes.saved`, the app's note JSON). [category] is a category id (slug). */
data class NoteView(
    val id: String,
    val title: String,
    val text: String,
    val category: String,
    val tags: List<String>,
    val source: String,
    val createdAt: Long,
    val updatedAt: Long,
) {
    companion object {
        fun parse(o: JsonObject?): NoteView? {
            val id = J.str(o, "id")?.takeIf { it.isNotBlank() } ?: return null
            return NoteView(id, J.text(o, "title", 300), J.text(o, "text", 100_000), J.str(o, "category") ?: "", J.strings(o?.get("tags"), 30),
                J.str(o, "source") ?: "typed", J.long(o, "createdAt") ?: 0L, J.long(o, "updatedAt") ?: 0L)
        }
    }
}

/** What sorting decided for one note. [category] is a name ("" = leave as is). */
data class SortResult(val category: String, val tags: List<String>, val title: String, val summary: String, val actions: List<String>, val fromAi: Boolean)

/** The user moved a note the sorter had filed under [from] to [to]; [sample] is the start of its text. */
data class Correction(val sample: String, val from: String, val to: String, val at: Long)

/** What the sorter knows about a note: re-sorts only when the text changes; a category change with the same text = a correction. */
data class SortRecord(
    val noteId: String,
    val textHash: String,
    /** category id the note has after sorting (or after the user's correction) */
    val category: String,
    val title: String,
    val summary: String,
    /** action items already sent as to-dos for this note */
    val actions: List<String>,
    val createdAt: Long,
    val at: Long,
    /** the user picked the category by hand: sorting never changes it again */
    val userSet: Boolean = false,
    val digest: Boolean = false,
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
    const val DIGEST_TAG = "digest"

    fun textHash(n: NoteView): String = Hashes.fnv64(n.text.trim())

    fun isDigest(n: NoteView): Boolean = n.source == "ai" && n.tags.any { it.equals(DIGEST_TAG, true) }

    /** Sort this note now? Typed or spoken notes with text, changed since the plugin was enabled, with new text. */
    fun needsSort(n: NoteView, rec: SortRecord?, since: Long): Boolean =
        n.source != "ai" && n.text.isNotBlank() && n.updatedAt >= since && rec?.textHash != textHash(n)

    /** A re-categorization by hand (same text as when sorted, other category): the updated record and what was learned. */
    fun correction(n: NoteView, rec: SortRecord?, now: Long): Pair<SortRecord, Correction>? {
        if (rec == null || rec.textHash != textHash(n) || rec.category == n.category || n.category.isBlank()) return null
        return rec.copy(category = n.category, at = now, userSet = true) to Correction(sample(n.text), Txt.nameOfSlug(rec.category), Txt.nameOfSlug(n.category), now)
    }

    /** The category stays: the user chose it when writing the note, or by hand after it was sorted. */
    fun userCategory(n: NoteView, rec: SortRecord?): Boolean = n.category.isNotBlank() && (rec == null || rec.userSet || n.category != rec.category)

    /** Keeps a title the user wrote; replaces only an automatic one (first words of the text) or a blank one. */
    fun keepsTitle(n: NoteView): Boolean = n.title.isNotBlank() && n.title != Txt.titleFrom(n.text) && n.title != "Untitled note"

    fun sample(text: String): String = text.replace(Regex("\\s+"), " ").trim().take(160)

    fun mergeTags(old: List<String>, new: List<String>): List<String> =
        (old + new).map { it.trim().removePrefix("#").trim() }.filter { it.isNotEmpty() }.distinctBy { Txt.normalize(it) }.take(30)

    fun cleanTag(s: String): String = Txt.normalize(s.removePrefix("#")).replace(' ', '-').take(30)

    fun words(s: String, max: Int): String {
        val w = s.replace(Regex("\\s+"), " ").trim().split(' ').filter { it.isNotEmpty() }
        return if (w.size <= max) w.joinToString(" ") else w.take(max).joinToString(" ").trimEnd('.', ',', ';', ':') + "…"
    }

    /** Category id the note ends up with after [updatePayload] (for the record). */
    fun categoryAfter(n: NoteView, res: SortResult, keepCategory: Boolean): String =
        if (keepCategory || res.category.isBlank()) n.category else Txt.slug(res.category)

    /**
     * The app's `axnotes.notes.save` payload that applies [res] to [n] (null = nothing to change). `category` is a name
     * (the app resolves or creates it); `fileInto` names note lists the app adds the note to when one by that name exists.
     */
    fun updatePayload(n: NoteView, res: SortResult, keepCategory: Boolean): JsonObject? {
        val category = if (keepCategory || res.category.isBlank()) null else res.category
        val tags = mergeTags(n.tags, res.tags)
        val title = if (keepsTitle(n) || res.title.isBlank()) n.title else res.title
        val catName = category ?: if (n.category.isBlank()) "" else Txt.nameOfSlug(n.category)
        val fileInto = (listOf(catName) + res.tags).filter { it.isNotBlank() }.distinctBy { Txt.normalize(it) }
        val changed = (category != null && Txt.slug(category) != n.category) || tags != n.tags || title != n.title || fileInto.isNotEmpty()
        if (!changed) return null
        return JsonObject(buildMap {
            put("id", JsonPrimitive(n.id)); put("title", JsonPrimitive(title)); put("text", JsonPrimitive(n.text)); put("tags", J.arr(tags))
            put("source", JsonPrimitive(n.source))
            if (category != null) put("category", JsonPrimitive(category))
            if (fileInto.isNotEmpty()) put("fileInto", J.arr(fileInto))
        })
    }

    /** The app's `axnotes.todos.add` payload for one action item. */
    fun todoPayload(list: String, text: String, noteId: String, categoryName: String?): JsonObject = JsonObject(buildMap {
        put("list", JsonPrimitive(list)); put("text", JsonPrimitive(text)); put("noteId", JsonPrimitive(noteId)); put("createList", JsonPrimitive(true))
        if (!categoryName.isNullOrBlank()) put("category", JsonPrimitive(categoryName))
    })
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
            .distinctBy { Txt.normalize(it) }
            .take(Sorter.MAX_ACTIONS)
}

/** Sorting without AI: learned corrections first, then category names found in the text, then simple hints. */
object LocalSorter {
    private val HINTS: Map<String, Set<String>> = mapOf(
        "work" to setOf("meeting", "client", "deadline", "project", "email", "boss", "office", "report", "invoice", "sprint", "standup"),
        "home" to setOf("rent", "clean", "laundry", "kitchen", "garden", "repair", "bill", "house"),
        "shopping" to setOf("buy", "milk", "grocery", "store", "order", "shop"),
        "idea" to setOf("idea", "maybe", "concept", "brainstorm"),
        "health" to setOf("doctor", "gym", "medicine", "appointment", "workout", "dentist"),
        "family" to setOf("mom", "dad", "wife", "husband", "kid", "son", "daughter", "cousin"),
        "code" to setOf("bug", "commit", "repo", "build", "deploy", "kotlin", "function", "refactor"),
    )
    private val HASHTAG = Regex("(?<![\\p{L}\\p{N}_])#([\\p{L}\\p{N}_-]{2,30})")
    private val STOP = setOf("the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "it", "i", "my", "me", "at", "with", "this", "that", "be", "about", "we", "you")

    fun sort(text: String, categories: List<String>, corrections: List<Correction>, summaryWords: Int): SortResult {
        val tags = HASHTAG.findAll(text).map { Sorter.cleanTag(it.groupValues[1]) }.filter { it.isNotEmpty() }.distinct().take(Sorter.MAX_TAGS).toList()
        return SortResult(category(text, categories, corrections), tags, Txt.titleFrom(text), Sorter.words(firstSentences(text, summaryWords), summaryWords), ActionItems.extract(text), fromAi = false)
    }

    fun category(text: String, categories: List<String>, corrections: List<Correction>): String {
        nearest(text, corrections)?.let { return it.to }
        val words = Txt.tokens(text).map { Txt.stem(it) }.toSet()
        if (words.isEmpty()) return ""
        categories.firstOrNull { c -> val t = Txt.tokens(c).map { Txt.stem(it) }; t.isNotEmpty() && t.all { it in words } }?.let { return it }
        return categories.map { c -> c to (HINTS[Txt.stem(Txt.normalize(c))] ?: emptySet()).count { it in words } }
            .filter { it.second > 0 }.maxByOrNull { it.second }?.first ?: ""
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
            val score = a.intersect(b).size.toDouble() / a.union(b).size
            if (score > bestScore) { bestScore = score; best = c }
        }
        return if (bestScore >= 0.35) best else null
    }

    private fun meaningful(s: String): Set<String> = Txt.tokens(s.take(Sorter.MAX_TEXT)).filter { it !in STOP && it.length > 1 }.map { Txt.stem(it) }.toSet()

    private fun firstSentences(text: String, maxWords: Int): String {
        val out = StringBuilder()
        for (p in text.trim().split(Regex("(?<=[.!?])\\s+|\\n+")).map { it.trim() }.filter { it.isNotEmpty() }) {
            val next = if (out.isEmpty()) p else "$out $p"
            if (next.split(' ').size > maxWords && out.isNotEmpty()) break
            out.clear(); out.append(next)
        }
        return out.toString()
    }
}

/** Action items in a note, and which still need a to-do. */
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

    /** Actions not yet sent for this note (the app also skips an item already open on the list). */
    fun newOnes(actions: List<String>, already: List<String>): List<String> {
        val sent = already.map { Txt.normalize(it) }
        return actions.filter { a -> val n = Txt.normalize(a); n.isNotEmpty() && sent.none { it == n || Txt.ratio(it, n) >= 0.9 } }.distinctBy { Txt.normalize(it) }
    }
}

object Learning {
    const val MAX = 50

    /** Adds [c]; an older correction of the same text is replaced; keeps the newest [MAX]. */
    fun add(list: List<Correction>, c: Correction): List<Correction> =
        (list.filterNot { Txt.normalize(it.sample) == Txt.normalize(c.sample) } + c).sortedByDescending { it.at }.take(MAX)
}

/** Daily / weekly digest from the notes the sorter has seen: plain sentences for reading aloud. */
object Digest {
    data class Range(val from: Long, val to: Long, val label: String)
    data class Output(val title: String, val text: String)

    private val DAY = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.ENGLISH)
    private val SHORT = DateTimeFormatter.ofPattern("d MMMM", Locale.ENGLISH)

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
            Range(startOf(start, zone), if (previous) startOf(start.plusWeeks(1), zone) - 1 else now, "the week of ${start.format(SHORT)}")
        } else {
            val d = if (previous) today.minusDays(1) else today
            Range(startOf(d, zone), if (previous) startOf(d.plusDays(1), zone) - 1 else now, d.format(DAY))
        }
    }

    /** The digest for [range] from the sorter's records; null when nothing happened in it. */
    fun build(period: DigestPeriod, range: Range, records: List<SortRecord>): Output? {
        val notes = records.filter { !it.digest && it.createdAt in range.from..range.to }.sortedBy { it.createdAt }
        val actions = records.filter { !it.digest && it.at in range.from..range.to }.sumOf { it.actions.size }
        if (notes.isEmpty() && actions == 0) return null
        val kind = if (period == DigestPeriod.WEEKLY) "Weekly" else "Daily"
        val out = StringBuilder("$kind digest for ${range.label}. ")
        out.append(when (notes.size) { 0 -> "You wrote no new notes."; 1 -> "You wrote one note."; else -> "You wrote ${notes.size} notes." })
        val groups = notes.groupBy { it.category }.entries.sortedWith(compareBy<Map.Entry<String, List<SortRecord>>> { it.key.isBlank() }.thenByDescending { it.value.size })
        for ((cat, rs) in groups) {
            out.append("\n\n").append(Txt.nameOfSlug(cat)).append(", ").append(if (rs.size == 1) "one note" else "${rs.size} notes").append(". ")
            out.append(rs.take(8).joinToString(" ") { sentence(it.summary.ifBlank { it.title }) })
            if (rs.size > 8) out.append(" And ${rs.size - 8} more.")
        }
        if (actions > 0) out.append("\n\n").append(if (actions == 1) "One action item became a to-do." else "$actions action items became to-dos.")
        return Output("$kind digest, ${range.label}", out.toString())
    }

    private fun sentence(s: String): String { val t = s.trim().trimEnd('…'); return if (t.isEmpty() || t.endsWith('.') || t.endsWith('!') || t.endsWith('?')) t else "$t." }

    /** The app's `axnotes.notes.save` payload for a digest note. */
    fun payload(o: Output): JsonObject = JsonObject(mapOf("title" to JsonPrimitive(o.title), "text" to JsonPrimitive(o.text),
        "tags" to J.arr(listOf(Sorter.DIGEST_TAG)), "source" to JsonPrimitive("ai"), "category" to JsonPrimitive("Digest")))
}

/** JSON for the sorter's own data (KV values). */
object SorterCodec {
    fun record(r: SortRecord): JsonObject = JsonObject(linkedMapOf(
        "noteId" to JsonPrimitive(r.noteId), "textHash" to JsonPrimitive(r.textHash), "category" to JsonPrimitive(r.category), "title" to JsonPrimitive(r.title),
        "summary" to JsonPrimitive(r.summary), "actions" to J.arr(r.actions), "createdAt" to JsonPrimitive(r.createdAt), "at" to JsonPrimitive(r.at),
        "userSet" to JsonPrimitive(r.userSet), "digest" to JsonPrimitive(r.digest),
    ))

    fun record(o: JsonObject?): SortRecord? {
        val id = J.str(o, "noteId") ?: return null
        return SortRecord(id, J.str(o, "textHash") ?: "", J.str(o, "category") ?: "", J.text(o, "title", 300), J.text(o, "summary", 2000), J.strings(o?.get("actions"), 50),
            J.long(o, "createdAt") ?: 0L, J.long(o, "at") ?: 0L, J.bool(o, "userSet") ?: false, J.bool(o, "digest") ?: false)
    }

    fun corrections(list: List<Correction>): JsonObject = JsonObject(mapOf("items" to JsonArray(list.map {
        JsonObject(linkedMapOf("sample" to JsonPrimitive(it.sample), "from" to JsonPrimitive(it.from), "to" to JsonPrimitive(it.to), "at" to JsonPrimitive(it.at)))
    })))

    fun corrections(o: JsonObject?): List<Correction> = J.objects(o?.get("items"), Learning.MAX).mapNotNull {
        val to = J.str(it, "to") ?: return@mapNotNull null
        Correction(J.text(it, "sample", 200), J.str(it, "from") ?: "", to, J.long(it, "at") ?: 0L)
    }
}
