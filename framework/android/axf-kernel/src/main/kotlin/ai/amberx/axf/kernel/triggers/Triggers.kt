package ai.amberx.axf.kernel.triggers

import ai.amberx.axf.kernel.alerts.Diagnostic
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * Triggers — triggers@1 (kernel API level 1). Same design as the web reference framework/core/triggers.ts; conformance
 * fixture spec/fixtures/triggers.json (TriggersConformanceTest). Written without a compiler: CI (:axf-kernel:test) is
 * what compiles and replays it.
 *
 * A trigger turns an INPUT (a spoken phrase, a hand gesture, a face gesture…) into an ACTION with arguments. The kernel
 * ships the data model, the open kind registry ([TriggerKinds]: voice built, gesture + face typed placeholders), the
 * module-scoped [TriggerRegistry] (conflicts become [Diagnostic.ContributionConflict]) and the pure matcher
 * ([TriggerMatcher]: threshold, armed state, context filter, cooldown, argument capture). Detectors are modules.
 *
 * lib-voice's `VoiceCommand`s are hosted as voice triggers through [TriggerHosting.voiceCommand] (same phrases, 80 %,
 * no arming), so Voice Vault keeps working unchanged.
 */

public const val TRIGGERS_CONTRACT: String = "triggers@1"
/** Capability a trigger host (the thing that listens and runs the matcher) registers under. */
public const val TRIGGERS_CAPABILITY: String = "axf.triggers"

public enum class TriggerKindStatus(public val id: String) { BUILT("built"), PLACEHOLDER("placeholder") }

public data class TriggerKindSpec(
    val id: String,
    val label: String,
    val status: TriggerKindStatus,
    /** capability a detector for this kind registers under */
    val capability: String,
    /** true when inputs of this kind are phrases with argument slots (else: signature ids) */
    val spoken: Boolean,
    val note: String? = null,
) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("id", JsonPrimitive(id)); put("label", JsonPrimitive(label)); put("status", JsonPrimitive(status.id))
        put("capability", JsonPrimitive(capability)); put("spoken", JsonPrimitive(spoken))
        if (note != null) put("note", JsonPrimitive(note))
    })
}

/** Capabilities declared now so detector modules plug in later without reshuffling. */
public object TriggerPlaceholders {
    public const val GESTURE: String = "axf.triggers.gesture"
    public const val FACE: String = "axf.triggers.face"
    public val ALL: List<String> = listOf(GESTURE, FACE)
}

/** Open registry of trigger kinds. A port or a module adds a kind (or marks a placeholder built). */
public object TriggerKinds {
    public const val VOICE: String = "voice"
    public const val GESTURE: String = "gesture"
    public const val FACE: String = "face"
    private val kinds = LinkedHashMap<String, TriggerKindSpec>()

    init {
        register(TriggerKindSpec(VOICE, "Voice", TriggerKindStatus.BUILT, "axf.voice", true, "Spoken phrases with argument slots (lib-voice on Android)"))
        register(TriggerKindSpec(GESTURE, "Hand gesture", TriggerKindStatus.PLACEHOLDER, TriggerPlaceholders.GESTURE, false, "Static poses and motions seen by a camera detector; also the arming poses"))
        register(TriggerKindSpec(FACE, "Face gesture", TriggerKindStatus.PLACEHOLDER, TriggerPlaceholders.FACE, false, "Head poses and blendshape rules (nod, shake, double blink…)"))
    }

    @Synchronized public fun all(): List<TriggerKindSpec> = kinds.values.toList()
    @Synchronized public fun get(id: String): TriggerKindSpec? = kinds[id]
    @Synchronized public fun register(spec: TriggerKindSpec) { kinds[spec.id] = spec }
}

/** PERMANENT: shipped by a module, editable but never removed · CUSTOM: made by the user. */
public enum class TriggerSource(public val id: String) {
    PERMANENT("permanent"), CUSTOM("custom");
    public companion object { public fun parse(s: String?): TriggerSource? = entries.firstOrNull { it.id == s } }
}

/** REQUIRED: fires only while its kind is armed (an arming pose was seen) · ALWAYS: fires whenever it matches. */
public enum class TriggerArming(public val id: String) {
    REQUIRED("required"), ALWAYS("always");
    public companion object { public fun parse(s: String?): TriggerArming? = entries.firstOrNull { it.id == s } }
}

/** Thresholds are percentages: a trigger fires when the input's confidence is at least this. */
public object Thresholds {
    public const val MIN: Double = 0.01
    public const val MAX: Double = 99.99
    public const val DEFAULT: Double = 80.0
    public const val DEFAULT_COOLDOWN_MS: Long = 600
    /** `worksIn` entry meaning every context. An empty `worksIn` means the same. */
    public const val ANY_CONTEXT: String = "*"
    /** lib-voice matches at 0.8 → 80 %. */
    public const val VOICE_COMMAND: Double = 80.0

    public fun clamp(n: Double): Double {
        if (n.isNaN() || n.isInfinite()) return DEFAULT
        val r = Math.round(n * 100) / 100.0
        return minOf(MAX, maxOf(MIN, r))
    }
}

public data class Trigger(
    /** namespaced: `<module>.<name>` (`notes.add`, `todo.check`) */
    val id: String,
    /** trigger kind id (open: `voice`, `gesture`, `face`, …) */
    val kind: String,
    val source: TriggerSource,
    /** owning module id; the registry scopes register/unregister by it */
    val module: String,
    val label: String,
    /** spoken kinds: phrases with slots (`note <text>`, `jump to <time:time>`); other kinds: signature ids */
    val phrases: List<String>,
    /** action id (namespaced) the trigger fires; captured slots are merged over [args] */
    val action: String,
    val args: JsonObject? = null,
    /** 0.01..99.99 (percent) */
    val threshold: Double = Thresholds.DEFAULT,
    /** contexts the trigger works in (open set); empty = anywhere */
    val worksIn: List<String> = emptyList(),
    val arming: TriggerArming = TriggerArming.ALWAYS,
    val enabled: Boolean = true,
    val cooldownMs: Long = Thresholds.DEFAULT_COOLDOWN_MS,
    /** epoch ms until which the trigger is muted */
    val mutedUntil: Long = 0,
) {
    public fun worksIn(context: String): Boolean = worksIn.isEmpty() || Thresholds.ANY_CONTEXT in worksIn || context in worksIn

    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("id", JsonPrimitive(id)); put("kind", JsonPrimitive(kind)); put("source", JsonPrimitive(source.id)); put("module", JsonPrimitive(module))
        put("label", JsonPrimitive(label)); put("phrases", JsonArray(phrases.map(::JsonPrimitive))); put("action", JsonPrimitive(action))
        if (args != null && args.isNotEmpty()) put("args", args)
        put("threshold", TriggerJson.number(threshold)); put("worksIn", JsonArray(worksIn.map(::JsonPrimitive))); put("arming", JsonPrimitive(arming.id))
        put("enabled", JsonPrimitive(enabled)); put("cooldownMs", JsonPrimitive(cooldownMs)); put("mutedUntil", JsonPrimitive(mutedUntil))
    })

    public companion object {
        /** A trigger from its JSON (a fixture, a stored custom trigger); null when it doesn't validate. */
        public fun parse(o: JsonObject): Trigger? = TriggerValidation.validate(o).trigger
    }
}

public data class TriggerCheck(val ok: Boolean, val trigger: Trigger? = null, val errors: List<String> = emptyList()) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("ok", JsonPrimitive(ok))
        if (trigger != null) put("trigger", trigger.toJson())
        put("errors", JsonArray(errors.map(::JsonPrimitive)))
    })
}

public object TriggerValidation {
    private val namespaced = Regex("^[a-z][a-z0-9-]*(\\.[a-z0-9][a-z0-9-]*)+$")

    public fun isNamespacedId(id: String?): Boolean = id != null && namespaced.matches(id)

    /** Validates a raw trigger: ids namespaced, a known kind (placeholders allowed), phrases present and parseable, threshold clamped. */
    public fun validate(raw: JsonElement?): TriggerCheck {
        val errors = ArrayList<String>()
        val r = raw as? JsonObject ?: return TriggerCheck(false, null, listOf("trigger must be an object"))
        val id = TriggerJson.str(r, "id")
        if (!isNamespacedId(id)) errors += "id must be namespaced (module.name)"
        val kind = TriggerJson.str(r, "kind") ?: ""
        val spec = TriggerKinds.get(kind)
        if (spec == null) errors += "unknown kind \"$kind\""
        val source = TriggerSource.parse(TriggerJson.str(r, "source"))
        if (source == null) errors += "source must be permanent or custom"
        val module = TriggerJson.str(r, "module")
        if (module.isNullOrEmpty()) errors += "module is required"
        val label = TriggerJson.str(r, "label")
        if (label == null || label.trim().isEmpty()) errors += "label is required"
        val phrases = (r["phrases"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.takeIf { s -> s.trim().isNotEmpty() } } ?: emptyList()
        if (phrases.isEmpty()) errors += "at least one phrase or signature is required"
        if (spec?.spoken == true) for (p in phrases) { val e = Patterns.errors(p); if (e.isNotEmpty()) errors += "phrase \"$p\": $e" }
        val action = TriggerJson.str(r, "action")
        if (!isNamespacedId(action)) errors += "action must be a namespaced action id"
        val argsRaw = r["args"]
        if (argsRaw != null && argsRaw !is JsonObject) errors += "args must be an object"
        val armingRaw = r["arming"]
        val arming: TriggerArming? = if (armingRaw == null) (if (spec?.spoken == true) TriggerArming.ALWAYS else TriggerArming.REQUIRED) else TriggerArming.parse((armingRaw as? JsonPrimitive)?.takeIf { it.isString }?.content)
        if (arming == null) errors += "arming must be required or always"
        val worksInRaw = r["worksIn"]
        val worksIn: List<String>? = when (worksInRaw) {
            null -> emptyList()
            is JsonArray -> worksInRaw.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.trim()?.takeIf { s -> s.isNotEmpty() } }
            else -> null
        }
        if (worksIn == null) errors += "worksIn must be a list of context ids"
        if (errors.isNotEmpty()) return TriggerCheck(false, null, errors)
        val cooldown = TriggerJson.double(r, "cooldownMs")
        val muted = TriggerJson.double(r, "mutedUntil")
        val args = (argsRaw as? JsonObject)?.takeIf { it.isNotEmpty() }
        val trigger = Trigger(
            id = id!!, kind = kind, source = source!!, module = module!!, label = label!!.trim(), phrases = phrases, action = action!!, args = args,
            threshold = Thresholds.clamp(TriggerJson.double(r, "threshold") ?: Double.NaN), worksIn = worksIn!!, arming = arming!!,
            enabled = TriggerJson.bool(r, "enabled") != false,
            cooldownMs = if (cooldown != null && cooldown >= 0) Math.floor(cooldown).toLong() else Thresholds.DEFAULT_COOLDOWN_MS,
            mutedUntil = if (muted != null && muted > 0) Math.floor(muted).toLong() else 0,
        )
        return TriggerCheck(true, trigger, emptyList())
    }
}

/* ---------- phrases: normalizing, patterns, argument capture ---------- */

public enum class SlotType(public val id: String) {
    TEXT("text"), NUMBER("number"), TIME("time");
    public companion object {
        public val IDS: List<String> = entries.map { it.id }
        public fun parse(s: String?): SlotType? = entries.firstOrNull { it.id == s }
    }
}

public sealed class PatternPart {
    public data class Literal(var text: String) : PatternPart()
    public data class Slot(val name: String, val type: SlotType) : PatternPart()

    public fun toJson(): JsonObject = when (this) {
        is Literal -> JsonObject(mapOf("literal" to JsonPrimitive(text)))
        is Slot -> JsonObject(mapOf("slot" to JsonObject(mapOf("name" to JsonPrimitive(name), "type" to JsonPrimitive(type.id)))))
    }
}

public data class PhraseMatch(
    /** 1 exact · 0.95 found inside more words · < 0.95 similarity (slot-less patterns only) · 0 none */
    val score: Double,
    /** captured slot values, parsed by slot type (number/time → a number, or the raw text when it doesn't parse) */
    val args: JsonObject = JsonObject(emptyMap()),
) {
    public fun toJson(): JsonObject = JsonObject(mapOf("score" to TriggerJson.number(score), "args" to args))
}

/** Pure phrase rules shared with lib-voice's PhraseMatcher (same normalizing and similarity). */
public object Patterns {
    private val nonWord = Regex("[^\\p{L}\\p{N} ]")
    private val spaces = Regex("\\s+")
    private val slot = Regex("^<([a-z][a-z0-9_-]*)(?::(text|number|time))?>$", RegexOption.IGNORE_CASE)

    /** Lowercase, punctuation to spaces, single spaces. */
    public fun normalize(text: String): String = text.lowercase().replace(nonWord, " ").replace(spaces, " ").trim()

    /** 1.0 = identical, 0.0 = nothing in common (Levenshtein over the longer length). */
    public fun similarity(a: String, b: String): Double {
        if (a == b) return 1.0
        if (a.isEmpty() || b.isEmpty()) return 0.0
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1)
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            }
            prev = cur
        }
        return 1.0 - prev[b.length].toDouble() / maxOf(a.length, b.length)
    }

    /** Splits a pattern into literal words and slots. Literals are normalized; a slot keeps its name as written. */
    public fun parse(pattern: String): List<PatternPart> {
        val parts = ArrayList<PatternPart>()
        for (tok in pattern.trim().split(spaces)) {
            if (tok.isEmpty()) continue
            val m = slot.find(tok)
            if (m != null) { parts += PatternPart.Slot(m.groupValues[1], SlotType.parse(m.groupValues[2].takeIf { it.isNotEmpty() } ?: "text") ?: SlotType.TEXT); continue }
            val lit = normalize(tok)
            if (lit.isEmpty()) continue
            val last = parts.lastOrNull()
            if (last is PatternPart.Literal) last.text = last.text + " " + lit else parts += PatternPart.Literal(lit)
        }
        return parts
    }

    /** Why a pattern can't be used, or "" when it is fine. */
    public fun errors(pattern: String): String {
        val parts = parse(pattern)
        if (parts.isEmpty()) return "empty"
        if (parts.all { it is PatternPart.Slot }) return "a pattern needs at least one word"
        for (i in 1 until parts.size) if (parts[i] is PatternPart.Slot && parts[i - 1] is PatternPart.Slot) return "two slots in a row"
        val names = parts.filterIsInstance<PatternPart.Slot>().map { it.name.lowercase() }
        if (names.toSet().size != names.size) return "duplicate slot name"
        val raw = pattern.trim().split(spaces).filter { it.startsWith("<") && !slot.matches(it) }
        if (raw.isNotEmpty()) return "bad slot \"${raw[0]}\""
        return ""
    }

    public fun hasSlots(pattern: String): Boolean = parse(pattern).any { it is PatternPart.Slot }

    /** Words in a pattern (a slot counts as one); the tie-breaker between phrases that score the same. */
    public fun words(pattern: String): Int = parse(pattern).sumOf { if (it is PatternPart.Literal) it.text.split(' ').size else 1 }

    private fun regex(parts: List<PatternPart>): Regex {
        val lastSlot = parts.indexOfLast { it is PatternPart.Slot }
        val src = parts.mapIndexed { i, p -> if (p is PatternPart.Slot) (if (i == lastSlot) "(.+)" else "(.+?)") else Regex.escape((p as PatternPart.Literal).text) }.joinToString(" ")
        return Regex("^$src$")
    }

    private fun parseSlot(type: SlotType, text: String): JsonElement = when (type) {
        SlotType.NUMBER -> SpokenNumbers.number(text)?.let { JsonPrimitive(it) } ?: JsonPrimitive(text)
        SlotType.TIME -> SpokenNumbers.seconds(text)?.let { JsonPrimitive(it) } ?: JsonPrimitive(text)
        SlotType.TEXT -> JsonPrimitive(text)
    }

    /** Scores what was heard against one pattern and captures its slots. Pure; the same on every port. */
    public fun match(heard: String, pattern: String): PhraseMatch {
        val h = normalize(heard)
        val parts = parse(pattern)
        if (h.isEmpty() || parts.isEmpty() || parts.all { it is PatternPart.Slot }) return PhraseMatch(0.0)
        val slots = parts.filterIsInstance<PatternPart.Slot>()
        val re = regex(parts)
        fun capture(m: MatchResult): JsonObject = JsonObject(slots.mapIndexed { i, s -> s.name to parseSlot(s.type, m.groupValues[i + 1].trim()) }.toMap())
        re.find(h)?.let { return PhraseMatch(1.0, capture(it)) }
        if (slots.isEmpty()) {
            val p = (parts[0] as PatternPart.Literal).text
            if (" $h ".contains(" $p ")) return PhraseMatch(0.95)
            return PhraseMatch(Math.round(similarity(h, p) * 10000) / 10000.0)
        }
        // with slots: the pattern may sit inside more words ("ok amber note buy milk" → note <text>)
        val first = parts[0]
        if (first is PatternPart.Literal) {
            val at = " $h ".indexOf(" ${first.text} ")
            if (at > 0) re.find(h.substring(at))?.let { return PhraseMatch(0.95, capture(it)) }
        }
        return PhraseMatch(0.0)
    }

    public data class Best(val phrase: String, val heard: String, val match: PhraseMatch)

    /** Best pattern of a trigger for any recognizer alternative; ties go to the pattern with more words. */
    public fun best(heard: List<String>, phrases: List<String>): Best? {
        var best: Best? = null
        for (h in heard) for (phrase in phrases) {
            val m = match(h, phrase)
            if (m.score <= 0) continue
            val b = best
            if (b == null || m.score > b.match.score || (m.score == b.match.score && words(phrase) > words(b.phrase))) best = Best(phrase, h, m)
        }
        return best
    }
}

/** Numbers and times spoken in words or digits (= the web port's parseSpokenNumber / parseSpokenSeconds). */
public object SpokenNumbers {
    private val units = mapOf("zero" to 0, "oh" to 0, "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7, "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12, "thirteen" to 13, "fourteen" to 14, "fifteen" to 15, "sixteen" to 16, "seventeen" to 17, "eighteen" to 18, "nineteen" to 19)
    private val tens = mapOf("twenty" to 20, "thirty" to 30, "forty" to 40, "fifty" to 50, "sixty" to 60, "seventy" to 70, "eighty" to 80, "ninety" to 90)
    private val digits = Regex("^[0-9]+$")
    private val clock = Regex("([0-9]+):([0-9]{1,2})")
    private val spaces = Regex("\\s+")

    private class Parsed(val numbers: List<Int>, val minutes: Int?, val seconds: Int?)

    private fun parse(phrase: String): Parsed {
        val words = phrase.lowercase().replace("-", " ").split(spaces).filter { it.isNotEmpty() && it != "and" }
        val numbers = ArrayList<Int>()
        var cur: Int? = null
        var minutes: Int? = null
        var seconds: Int? = null
        fun flush() { cur?.let { numbers += it }; cur = null }
        for (w in words) {
            when {
                digits.matches(w) -> { flush(); cur = w.toIntOrNull() ?: Int.MAX_VALUE }
                // a tens word starts a new number unless it follows a hundreds value; a unit attaches only to a tens value
                tens.containsKey(w) -> { val c = cur; if (c != null && c % 100 != 0) flush(); cur = (cur ?: 0) + tens.getValue(w) }
                units.containsKey(w) -> { val c = cur; if (c != null && !(c % 10 == 0 && c >= 20)) flush(); cur = (cur ?: 0) + units.getValue(w) }
                w == "hundred" -> cur = (cur ?: 1) * 100
                w.startsWith("minute") -> { flush(); minutes = numbers.lastOrNull(); numbers.clear() }
                w.startsWith("second") -> { flush(); seconds = numbers.lastOrNull(); numbers.clear() }
            }
        }
        flush()
        return Parsed(numbers, minutes, seconds)
    }

    /** The first number in a spoken phrase ("set it to forty five" → 45), or null. */
    public fun number(phrase: String): Int? {
        val p = parse(phrase)
        if (p.minutes != null) return p.minutes
        if (p.seconds != null) return p.seconds
        return p.numbers.firstOrNull()
    }

    /** Spoken time to seconds: "one minute thirty-eight seconds", "one thirty eight", "2:15", "ninety seconds". */
    public fun seconds(phrase: String): Int? {
        val p = phrase.lowercase().replace("-", " ").trim()
        clock.find(p)?.let { return it.groupValues[1].toInt() * 60 + it.groupValues[2].toInt() }
        val n = parse(p)
        if (n.minutes != null || n.seconds != null) return (n.minutes ?: 0) * 60 + (n.seconds ?: n.numbers.firstOrNull() ?: 0)
        if (n.numbers.isEmpty()) return null
        if (n.numbers.size == 1) return n.numbers[0]
        return n.numbers[0] * 60 + n.numbers[1]
    }
}

/* ---------- the matcher (pure decisions) ---------- */

public enum class TriggerOutcome(public val id: String) {
    FIRED("fired"), NO_MATCH("no-match"), DISABLED("disabled"), MUTED("muted"), KIND_OFF("kind-off"), BELOW_THRESHOLD("below-threshold"), WRONG_CONTEXT("wrong-context"), NOT_ARMED("not-armed"), COOLDOWN("cooldown");
    public companion object { public val IDS: List<String> = entries.map { it.id } }
}

/** One input from a detector. Spoken kinds give [heard] (recognizer alternatives, best first); others give a [signature] id. */
public data class Observation(val kind: String, val at: Long, val heard: List<String> = emptyList(), val signature: String? = null, /** percent, default 100 */ val confidence: Double? = null)

/** What the host knows when an observation arrives. */
public data class MatchEnv(val context: String, val armed: List<String> = emptyList(), val kindsOff: List<String> = emptyList(), val lastFired: Map<String, Long> = emptyMap())

public data class TriggerDecision(val triggerId: String, val outcome: TriggerOutcome, val confidence: Double, val phrase: String? = null, val heard: String? = null, val args: JsonObject? = null) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("triggerId", JsonPrimitive(triggerId)); put("outcome", JsonPrimitive(outcome.id)); put("confidence", TriggerJson.number(confidence))
        if (phrase != null) put("phrase", JsonPrimitive(phrase))
        if (heard != null) put("heard", JsonPrimitive(heard))
        if (args != null) put("args", args)
    })
}

/** What the host runs when a trigger fires. */
public data class TriggerCommand(val triggerId: String, val action: String, val args: JsonObject, val phrase: String? = null, val heard: String? = null) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("triggerId", JsonPrimitive(triggerId)); put("action", JsonPrimitive(action)); put("args", args)
        if (phrase != null) put("phrase", JsonPrimitive(phrase))
        if (heard != null) put("heard", JsonPrimitive(heard))
    })
}

public data class MatchOutcome(val decisions: List<TriggerDecision>, val fired: TriggerCommand?, val lastFired: Map<String, Long>) {
    public fun toJson(): JsonObject = JsonObject(mapOf(
        "decisions" to JsonArray(decisions.map { it.toJson() }),
        "fired" to (fired?.toJson() ?: JsonNull),
        "lastFired" to JsonObject(lastFired.mapValues { JsonPrimitive(it.value) }),
    ))
}

public object TriggerMatcher {
    private fun round2(n: Double): Double = Math.round(n * 100) / 100.0

    /**
     * Decides one trigger against one observation. Order (= the web reference): enabled, not muted, kind on, input
     * matches (phrase/signature), confidence ≥ threshold, context, armed, cooldown.
     */
    public fun decide(t: Trigger, obs: Observation, env: MatchEnv): TriggerDecision {
        val base = TriggerDecision(t.id, TriggerOutcome.NO_MATCH, 0.0)
        if (t.kind != obs.kind) return base
        val spec = TriggerKinds.get(t.kind)
        var confidence = minOf(100.0, maxOf(0.0, obs.confidence ?: 100.0))
        val phrase: String
        var heard: String? = null
        var captured: JsonObject? = null
        if (spec?.spoken == true) {
            val best = Patterns.best(obs.heard, t.phrases) ?: return base
            phrase = best.phrase; heard = best.heard; captured = best.match.args; confidence = round2(confidence * best.match.score)
        } else {
            val sig = obs.signature
            if (sig == null || sig !in t.phrases) return base
            phrase = sig
        }
        val args = JsonObject(buildMap { t.args?.let { putAll(it) }; captured?.let { putAll(it) } })
        val d = TriggerDecision(t.id, TriggerOutcome.FIRED, confidence, phrase, heard, args)
        if (!t.enabled) return d.copy(outcome = TriggerOutcome.DISABLED)
        if (t.mutedUntil > obs.at) return d.copy(outcome = TriggerOutcome.MUTED)
        if (t.kind in env.kindsOff) return d.copy(outcome = TriggerOutcome.KIND_OFF)
        if (confidence < t.threshold) return d.copy(outcome = TriggerOutcome.BELOW_THRESHOLD)
        if (!t.worksIn(env.context)) return d.copy(outcome = TriggerOutcome.WRONG_CONTEXT)
        if (t.arming == TriggerArming.REQUIRED && t.kind !in env.armed) return d.copy(outcome = TriggerOutcome.NOT_ARMED)
        val last = env.lastFired[t.id]
        if (last != null && obs.at - last < t.cooldownMs) return d.copy(outcome = TriggerOutcome.COOLDOWN)
        return d
    }

    /**
     * Runs every trigger against an observation. Exactly one command fires per observation: the fired decision with the
     * highest confidence (ties → the longer phrase, then registration order). Returns the updated `lastFired`.
     */
    public fun match(triggers: List<Trigger>, obs: Observation, env: MatchEnv): MatchOutcome {
        val decisions = triggers.map { decide(it, obs, env) }
        var pickT: Trigger? = null
        var pickD: TriggerDecision? = null
        decisions.forEachIndexed { i, d ->
            if (d.outcome != TriggerOutcome.FIRED) return@forEachIndexed
            val p = pickD
            if (p == null || d.confidence > p.confidence || (d.confidence == p.confidence && Patterns.words(d.phrase ?: "") > Patterns.words(p.phrase ?: ""))) { pickT = triggers[i]; pickD = d }
        }
        val lastFired = LinkedHashMap(env.lastFired)
        val t = pickT ?: return MatchOutcome(decisions, null, lastFired)
        val d = pickD!!
        lastFired[t.id] = obs.at
        return MatchOutcome(decisions, TriggerCommand(t.id, t.action, d.args ?: JsonObject(emptyMap()), d.phrase, d.heard), lastFired)
    }

    public fun contextsOverlap(a: List<String>, b: List<String>): Boolean {
        val anyA = a.isEmpty() || Thresholds.ANY_CONTEXT in a
        val anyB = b.isEmpty() || Thresholds.ANY_CONTEXT in b
        return anyA || anyB || a.any { it in b }
    }
}

/* ---------- registry (modules register, conflicts become diagnostics) ---------- */

public data class TriggerFilter(val kind: String? = null, val module: String? = null, val context: String? = null, val source: TriggerSource? = null)

/** Open, module-scoped registry. Thread-safe; same rules as the web `TriggerRegistry`. */
public class TriggerRegistry(private val report: (Diagnostic) -> Unit = {}) {
    private val items = LinkedHashMap<String, Trigger>()
    private val listeners = LinkedHashSet<() -> Unit>()

    /**
     * Registers a module's triggers. An id already owned by another module is a conflict (the new one replaces it); a
     * slot-less phrase already answered by another enabled trigger of the same kind in an overlapping context is a
     * phrase conflict (both stay; the matcher picks by confidence). Returns the diagnostics raised.
     */
    public fun register(module: String, triggers: List<Trigger>): List<Diagnostic.ContributionConflict> {
        val out = ArrayList<Diagnostic.ContributionConflict>()
        synchronized(this) {
            for (t in triggers) {
                val was = items[t.id]
                if (was != null && was.module != module) out += Diagnostic.ContributionConflict("trigger", t.id, was.module, module)
                for (other in items.values) {
                    if (other.id == t.id || other.kind != t.kind || !other.enabled || !t.enabled) continue
                    if (!TriggerMatcher.contextsOverlap(other.worksIn, t.worksIn)) continue
                    for (p in t.phrases) {
                        if (Patterns.hasSlots(p)) continue
                        val n = Patterns.normalize(p)
                        if (other.phrases.any { !Patterns.hasSlots(it) && Patterns.normalize(it) == n }) out += Diagnostic.ContributionConflict("trigger-phrase", n, other.id, t.id)
                    }
                }
                items[t.id] = t.copy(module = module)
            }
        }
        for (d in out) report(d)
        if (triggers.isNotEmpty()) fire()
        return out
    }

    /** Removes every trigger a module registered. */
    public fun unregister(module: String): Int {
        val n = synchronized(this) { val gone = items.values.filter { it.module == module }; for (t in gone) items.remove(t.id); gone.size }
        if (n > 0) fire()
        return n
    }

    /** Removes one trigger; a permanent one can't be removed (false). */
    public fun remove(id: String): Boolean {
        val ok = synchronized(this) { val t = items[id]; if (t == null || t.source == TriggerSource.PERMANENT) false else { items.remove(id); true } }
        if (ok) fire()
        return ok
    }

    /** Replaces a trigger's editable fields from a JSON patch (phrases, threshold, worksIn, arming, enabled, cooldownMs, mutedUntil, label, args); id/kind/module/source/action stay. */
    public fun update(id: String, patch: JsonObject): Trigger? {
        val next = synchronized(this) {
            val t = items[id] ?: return null
            val merged = JsonObject(buildMap {
                putAll(t.toJson()); putAll(patch)
                put("id", JsonPrimitive(t.id)); put("kind", JsonPrimitive(t.kind)); put("module", JsonPrimitive(t.module)); put("source", JsonPrimitive(t.source.id)); put("action", JsonPrimitive(t.action))
            })
            val check = TriggerValidation.validate(merged)
            val v = check.trigger ?: return null
            items[id] = v
            v
        }
        fire()
        return next
    }

    @Synchronized public fun get(id: String): Trigger? = items[id]

    @Synchronized public fun list(filter: TriggerFilter = TriggerFilter()): List<Trigger> = items.values.filter { t ->
        (filter.kind == null || t.kind == filter.kind) && (filter.module == null || t.module == filter.module) &&
            (filter.source == null || t.source == filter.source) && (filter.context == null || t.worksIn(filter.context))
    }

    /** Which trigger answers to this exact (slot-less) phrase for a kind, if any. */
    @Synchronized public fun owner(kind: String, phrase: String): Trigger? {
        val n = Patterns.normalize(phrase)
        return items.values.firstOrNull { t -> t.kind == kind && t.phrases.any { !Patterns.hasSlots(it) && Patterns.normalize(it) == n } }
    }

    @Synchronized public fun subscribe(fn: () -> Unit): () -> Unit { listeners += fn; return { synchronized(this) { listeners.remove(fn) } } }

    private fun fire() { val fns = synchronized(this) { listeners.toList() }; for (fn in fns) fn() }
}

/* ---------- lib-voice commands and settings bindings as triggers ---------- */

/** Actions a settings binding fires. The settings host applies them to the registry. */
public object SettingsActions {
    public const val SET: String = "axf.settings.set"
    public const val TOGGLE: String = "axf.settings.toggle"
}

/** One phrase and what it does to the setting: a fixed value, a toggle, or the value captured in the `<value>` slot. */
public data class SettingPhrase(val pattern: String, val value: JsonElement? = null, val toggle: Boolean = false)

/** A setting exposes phrases → a setting change. Declared by the module that owns the setting. */
public data class SettingVoiceBinding(val key: String, val module: String, val label: String, val phrases: List<SettingPhrase>, val threshold: Double? = null, val worksIn: List<String>? = null)

public data class SettingChange(val key: String, val value: JsonElement? = null, val toggle: Boolean = false) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("key", JsonPrimitive(key))
        if (toggle) put("toggle", JsonPrimitive(true)) else if (value != null) put("value", value)
    })
}

public object TriggerHosting {
    private val slug = Regex("[^a-zA-Z0-9-]+")
    private val keySlug = Regex("[^a-zA-Z0-9.-]+")

    /** A lib-voice command hosted as a permanent voice trigger: its phrases, its id as the action, no arming, every context. */
    public fun voiceCommand(id: String, label: String, defaults: List<String>, module: String? = null, phrases: List<String> = defaults): Trigger {
        val mod = module?.takeIf { it.isNotEmpty() } ?: "app"
        val namespaced = TriggerValidation.isNamespacedId(id)
        val tid = if (namespaced) id else "${mod.split('.').last().ifEmpty { "app" }}.${id.replace(slug, "-").lowercase()}"
        return Trigger(tid, TriggerKinds.VOICE, TriggerSource.PERMANENT, mod, label, if (phrases.isNotEmpty()) phrases else defaults, if (namespaced) id else "voice.$tid", null, Thresholds.VOICE_COMMAND, emptyList(), TriggerArming.ALWAYS, true, Thresholds.DEFAULT_COOLDOWN_MS, 0)
    }

    /** The triggers a binding becomes: one per phrase, ids `<key>.<n>` under the setting key, permanent. */
    public fun bindingTriggers(b: SettingVoiceBinding): List<Trigger> {
        val base = b.key.replace(keySlug, "-").lowercase()
        return b.phrases.mapIndexed { i, p ->
            val args = JsonObject(buildMap { put("key", JsonPrimitive(b.key)); if (!p.toggle && p.value != null) put("value", p.value) })
            Trigger("$base.${i + 1}", TriggerKinds.VOICE, TriggerSource.PERMANENT, b.module, b.label, listOf(p.pattern), if (p.toggle) SettingsActions.TOGGLE else SettingsActions.SET, args,
                Thresholds.clamp(b.threshold ?: Thresholds.DEFAULT), b.worksIn ?: emptyList(), TriggerArming.ALWAYS, true, Thresholds.DEFAULT_COOLDOWN_MS, 0)
        }
    }

    /** The setting change a fired binding command means (a captured `value` slot wins over a fixed value). */
    public fun settingChange(cmd: TriggerCommand): SettingChange? {
        if (cmd.action != SettingsActions.SET && cmd.action != SettingsActions.TOGGLE) return null
        val key = TriggerJson.str(cmd.args, "key")?.takeIf { it.isNotEmpty() } ?: return null
        if (cmd.action == SettingsActions.TOGGLE) return SettingChange(key, null, true)
        return SettingChange(key, cmd.args["value"], false)
    }
}

/* ---------- detector placeholder ---------- */

/** What a detector module provides for a kind (a recognizer, a camera pipeline). Observations go to the host's matcher. */
public interface TriggerDetector {
    public val kind: String
    public suspend fun available(): Boolean
    /** Starts observing; the returned function stops it. */
    public suspend fun start(onObservation: (Observation) -> Unit): AxfResult<() -> Unit>
}

/** Kernel default for `gesture` and `face` until a detector module registers. Never pretends to work. */
public class PlaceholderDetector(override val kind: String, public val capability: String) : TriggerDetector {
    override suspend fun available(): Boolean = false
    override suspend fun start(onObservation: (Observation) -> Unit): AxfResult<() -> Unit> = AxfResult.err(AxfFailure.NotImplemented(capability))
}

/** JSON helpers shared by the triggers contract and its conformance test. */
public object TriggerJson {
    public fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    public fun bool(o: JsonObject, k: String): Boolean? = (o[k] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull
    public fun double(o: JsonObject, k: String): Double? = (o[k] as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.doubleOrNull
    public fun long(o: JsonObject, k: String): Long? = double(o, k)?.takeIf { it.isFinite() }?.let { Math.floor(it).toLong() }
    public fun strings(e: JsonElement?): List<String> = (e as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: emptyList()
    /** Numbers print like JavaScript's: whole values without a fraction. */
    public fun number(d: Double): JsonPrimitive = if (d == Math.floor(d) && d.isFinite() && Math.abs(d) < 1e15) JsonPrimitive(d.toLong()) else JsonPrimitive(d)
}
