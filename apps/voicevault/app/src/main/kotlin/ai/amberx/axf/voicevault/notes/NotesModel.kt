package ai.amberx.axf.voicevault.notes

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Voice notes — the model the listener reads (Kotlin twin of the console plugin's `plugins/voice-notes/web/core.ts`,
 * same defaults, limits and rules): the settings and lists edited in Dev Console → Settings → Plugins → Voice notes,
 * kept on axHub, and what the listener does with what it hears (strip the stop trigger, "give me the list of lists",
 * a spoken number → a list, which question set a trigger opens). Pure Kotlin, no Android.
 */
object Notes {
    const val HUB_PROJECT = "amberx-axf"
    const val SETTINGS_FILE = "settings/voice-notes.json"
    const val DATA_FOLDER = "voice-notes"
    const val LISTS_TABLE = "lists"
    const val NOTES_TABLE = "notes"
    const val MAX_LISTS = 99
    const val MAX_PHRASES = 12
    const val MAX_PHRASE_LEN = 60
}

data class Beep(val on: Boolean, val hz: Int, val ms: Int, val volume: Double)

data class NotesSettings(
    val enabled: Boolean, val startTriggers: List<String>, val stopTriggers: List<String>, val listTriggers: List<String>, val cancelTriggers: List<String>,
    val beep: Beep, val endBeep: Boolean, val maxSeconds: Int, val silenceSeconds: Int, val stripAudio: Boolean, val keepAudio: Boolean, val language: String,
    val askPrompt: String, val listFormat: String, val readListsFirst: Boolean, val confirm: Boolean, val confirmText: String, val retries: Int, val fallbackList: String,
) {
    companion object {
        val DEFAULT = NotesSettings(
            enabled = true, startTriggers = listOf("take a note", "new note"), stopTriggers = listOf("stop note", "end note"),
            listTriggers = listOf("give me the list of lists", "list the lists", "what lists"), cancelTriggers = listOf("cancel", "never mind"),
            beep = Beep(true, 880, 180, 0.4), endBeep = true, maxSeconds = 120, silenceSeconds = 0, stripAudio = true, keepAudio = false, language = "en-US",
            askPrompt = "Where should I store it? Say a list, or say give me the list of lists.", listFormat = "{number}: {name}", readListsFirst = false,
            confirm = true, confirmText = "Saved to {list}{sub}.", retries = 2, fallbackList = "",
        )
    }
}

data class Subcategory(val id: String, val number: Int, val name: String, val aliases: List<String>)
enum class TriggerKind { ALWAYS, NUMBER, PHRASE }
data class SetTrigger(val kind: TriggerKind, val number: Int? = null, val phrase: String? = null)
data class Question(val id: String, val ask: String, val field: String)
data class QuestionSet(val id: String, val label: String, val trigger: SetTrigger, val subcategory: String, val questions: List<Question>)
data class NoteList(
    val id: String, val number: Int, val name: String, val aliases: List<String>, val askSubcategory: Boolean, val subcategoryPrompt: String,
    val subcategories: List<Subcategory>, val questionSets: List<QuestionSet>, val questionPrompt: String,
)

object NotesRules {
    private val nonWord = Regex("[^\\p{L}\\p{N}' ]+")
    private val spaces = Regex("\\s+")
    private val lang = Regex("^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")

    /** A phrase as the listener compares it: lower case, words only, single spaces. */
    fun norm(s: String?): String = (s ?: "").lowercase().replace(nonWord, " ").replace(spaces, " ").trim()

    private fun clamp(v: JsonElement?, lo: Double, hi: Double, fb: Double): Double {
        val n = (v as? JsonPrimitive)?.let { if (it.isString) it.content.toDoubleOrNull() else it.doubleOrNull } ?: return fb
        return if (n.isFinite()) n.coerceIn(lo, hi) else fb
    }
    private fun text(v: JsonElement?, fb: String, max: Int = 300): String = (v as? JsonPrimitive)?.takeIf { it.isString }?.content?.take(max) ?: fb
    private fun bool(v: JsonElement?, fb: Boolean): Boolean = (v as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: fb
    private fun obj(v: JsonElement?): JsonObject? = v as? JsonObject

    fun phrases(v: JsonElement?, fb: List<String>): List<String> {
        val arr = v as? JsonArray ?: return fb
        val out = mutableListOf<String>()
        for (p in arr) {
            val t = ((p as? JsonPrimitive)?.content ?: "").trim().take(Notes.MAX_PHRASE_LEN)
            if (norm(t).isNotEmpty() && out.none { norm(it) == norm(t) }) out += t
        }
        return out.take(Notes.MAX_PHRASES)
    }

    /** Stored values (any shape) → complete settings; anything missing or wrong falls back to the default. */
    fun settings(values: JsonObject?): NotesSettings {
        val d = NotesSettings.DEFAULT
        val v = values ?: JsonObject(emptyMap())
        val b = obj(v["beep"])
        return NotesSettings(
            enabled = bool(v["enabled"], d.enabled),
            startTriggers = phrases(v["startTriggers"], d.startTriggers), stopTriggers = phrases(v["stopTriggers"], d.stopTriggers),
            listTriggers = phrases(v["listTriggers"], d.listTriggers), cancelTriggers = phrases(v["cancelTriggers"], d.cancelTriggers),
            beep = Beep(bool(b?.get("on"), d.beep.on), clamp(b?.get("hz"), 200.0, 4000.0, d.beep.hz.toDouble()).toInt(), clamp(b?.get("ms"), 40.0, 2000.0, d.beep.ms.toDouble()).toInt(), clamp(b?.get("volume"), 0.0, 1.0, d.beep.volume)),
            endBeep = bool(v["endBeep"], d.endBeep),
            maxSeconds = Math.round(clamp(v["maxSeconds"], 5.0, 900.0, d.maxSeconds.toDouble())).toInt(),
            silenceSeconds = Math.round(clamp(v["silenceSeconds"], 0.0, 60.0, d.silenceSeconds.toDouble())).toInt(),
            stripAudio = bool(v["stripAudio"], d.stripAudio), keepAudio = bool(v["keepAudio"], d.keepAudio),
            language = text(v["language"], "").takeIf { lang.matches(it) } ?: d.language,
            askPrompt = text(v["askPrompt"], d.askPrompt), listFormat = text(v["listFormat"], d.listFormat, 80),
            readListsFirst = bool(v["readListsFirst"], d.readListsFirst), confirm = bool(v["confirm"], d.confirm),
            confirmText = text(v["confirmText"], d.confirmText), retries = Math.round(clamp(v["retries"], 0.0, 5.0, d.retries.toDouble())).toInt(),
            fallbackList = text(v["fallbackList"], "", 64),
        )
    }

    private fun sub(raw: JsonElement?, i: Int): Subcategory? {
        val o = obj(raw) ?: return null
        return Subcategory(text(o["id"], "", 64).ifEmpty { "sub-$i" }, Math.round(clamp(o["number"], 1.0, Notes.MAX_LISTS.toDouble(), (i + 1).toDouble())).toInt(), text(o["name"], "", 80), phrases(o["aliases"], emptyList()))
    }

    private fun set(raw: JsonElement?, i: Int): QuestionSet? {
        val o = obj(raw) ?: return null
        val t = obj(o["trigger"])
        val k = text(t?.get("kind"), "")
        val trigger = when (k) {
            "number" -> SetTrigger(TriggerKind.NUMBER, number = Math.round(clamp(t?.get("number"), 1.0, Notes.MAX_LISTS.toDouble(), 1.0)).toInt())
            "phrase" -> SetTrigger(TriggerKind.PHRASE, phrase = text(t?.get("phrase"), "", Notes.MAX_PHRASE_LEN))
            else -> SetTrigger(TriggerKind.ALWAYS)
        }
        val qs = (o["questions"] as? JsonArray).orEmpty().take(20).mapIndexed { n, q ->
            val x = obj(q)
            Question(text(x?.get("id"), "", 64).ifEmpty { "q-$n" }, text(x?.get("ask"), ""), text(x?.get("field"), "", 40))
        }
        return QuestionSet(text(o["id"], "", 64).ifEmpty { "set-$i" }, text(o["label"], "", 80), trigger, text(o["subcategory"], "", 64), qs)
    }

    /** A stored row → a list; null when it isn't one. */
    fun list(raw: JsonElement?, id: String): NoteList? {
        val o = obj(raw) ?: return null
        return NoteList(
            id = id, number = Math.round(clamp(o["number"], 1.0, Notes.MAX_LISTS.toDouble(), 1.0)).toInt(), name = text(o["name"], "", 80), aliases = phrases(o["aliases"], emptyList()),
            askSubcategory = bool(o["askSubcategory"], false), subcategoryPrompt = text(o["subcategoryPrompt"], "Which part of {list}?"),
            subcategories = (o["subcategories"] as? JsonArray).orEmpty().mapIndexedNotNull { i, x -> sub(x, i) },
            questionSets = (o["questionSets"] as? JsonArray).orEmpty().mapIndexedNotNull { i, x -> set(x, i) },
            questionPrompt = text(o["questionPrompt"], "Say a number or a trigger for the questions, or say none."),
        )
    }

    fun sorted(lists: List<NoteList>): List<NoteList> = lists.sortedWith(compareBy<NoteList> { it.number }.thenBy { it.name })

    private val UNITS = listOf("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
    private val TENS = listOf("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
    private val SKIP = setOf("number", "list", "the", "please", "option", "store", "it", "in", "to")
    private val ORDINAL = mapOf("first" to 1, "second" to 2, "third" to 3, "fourth" to 4, "fifth" to 5, "sixth" to 6, "seventh" to 7, "eighth" to 8, "ninth" to 9, "tenth" to 10)
    private val digits = Regex("^\\d{1,2}$")

    /** "3", "three", "number twenty one", "list 12", "the second one" → 1–99; null when there's no number. */
    fun spokenNumber(utterance: String): Int? {
        val words = norm(utterance).replace('-', ' ').split(' ').filter { it.isNotEmpty() && it !in SKIP }
        for ((i, w) in words.withIndex()) {
            if (digits.matches(w)) return w.toInt().takeIf { it != 0 }
            ORDINAL[w]?.let { return it }
            val t = TENS.indexOf(w)
            if (t >= 2) { val u = UNITS.indexOf(words.getOrNull(i + 1) ?: ""); return t * 10 + (if (u in 1..9) u else 0) }
            val u = UNITS.indexOf(w)
            if (u > 0) return u
        }
        return null
    }

    data class Stripped(val text: String, val cut: String?)
    private val trailing = Regex("[\\s,;:.!?-]+$")

    /** Cut the stop trigger (and anything after it) off the transcript: the last place any stop phrase is said. */
    fun stripStopTrigger(transcript: String, stops: List<String>): Stripped {
        val lower = transcript.lowercase()
        var bestAt = -1; var bestPhrase: String? = null
        for (p in stops) {
            val n = norm(p); if (n.isEmpty()) continue
            val re = Regex("(^|[^\\p{L}\\p{N}])" + n.split(' ').joinToString("[^\\p{L}\\p{N}]+") { Regex.escape(it) } + "(?=$|[^\\p{L}\\p{N}])")
            val last = re.findAll(lower).lastOrNull() ?: continue
            val at = last.range.first + last.groupValues[1].length
            if (at > bestAt) { bestAt = at; bestPhrase = p }
        }
        if (bestPhrase == null) return Stripped(transcript.trim(), null)
        return Stripped(transcript.substring(0, bestAt).replace(trailing, "").trim(), bestPhrase)
    }

    fun said(utterance: String, ps: List<String>): Boolean { val u = " ${norm(utterance)} "; return ps.any { val n = norm(it); n.isNotEmpty() && u.contains(" $n ") } }
    fun asksForLists(utterance: String, s: NotesSettings): Boolean = said(utterance, s.listTriggers)
    fun isCancel(utterance: String, s: NotesSettings): Boolean = said(utterance, s.cancelTriggers)
    fun isStart(utterance: String, s: NotesSettings): Boolean = said(utterance, s.startTriggers)
    fun saysNone(utterance: String): Boolean = said(utterance, listOf("none", "no", "nothing", "no questions", "skip"))

    /** The list a reply names: a spoken number first, else its name or an alias (the longest match). */
    fun pickList(utterance: String, lists: List<NoteList>): NoteList? {
        spokenNumber(utterance)?.let { n -> lists.firstOrNull { it.number == n }?.let { return it } }
        val u = " ${norm(utterance)} "
        var best: NoteList? = null; var len = 0
        for (l in lists) for (p in listOf(l.name) + l.aliases) { val k = norm(p); if (k.isNotEmpty() && u.contains(" $k ") && k.length > len) { best = l; len = k.length } }
        return best
    }

    fun pickSubcategory(utterance: String, list: NoteList): Subcategory? {
        spokenNumber(utterance)?.let { n -> list.subcategories.firstOrNull { it.number == n }?.let { return it } }
        val u = " ${norm(utterance)} "
        return list.subcategories.firstOrNull { x -> (listOf(x.name) + x.aliases).any { val k = norm(it); k.isNotEmpty() && u.contains(" $k ") } }
    }

    /** Which question set a reply opens: a number trigger, a phrase trigger, else the "always" set (or none). */
    fun pickQuestionSet(utterance: String, list: NoteList): QuestionSet? {
        spokenNumber(utterance)?.let { n -> list.questionSets.firstOrNull { it.trigger.kind == TriggerKind.NUMBER && it.trigger.number == n }?.let { return it } }
        val u = " ${norm(utterance)} "
        return list.questionSets.firstOrNull { it.trigger.kind == TriggerKind.PHRASE && norm(it.trigger.phrase).isNotEmpty() && u.contains(" ${norm(it.trigger.phrase)} ") }
            ?: list.questionSets.firstOrNull { it.trigger.kind == TriggerKind.ALWAYS }
    }

    fun readLists(s: NotesSettings, lists: List<NoteList>): List<String> = sorted(lists).map { s.listFormat.replace("{number}", it.number.toString()).replace("{name}", it.name) }

    fun confirmText(s: NotesSettings, list: NoteList, sub: Subcategory?): String = s.confirmText.replace("{list}", list.name).replace("{sub}", sub?.let { " › ${it.name}" } ?: "")
}
