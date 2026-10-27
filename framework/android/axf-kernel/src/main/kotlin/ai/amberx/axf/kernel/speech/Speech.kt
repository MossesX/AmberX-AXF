package ai.amberx.axf.kernel.speech

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
 * Speech — speech@1 (kernel API level 1; the SPEAKING side — listening stays on lib-voice / triggers@1). Same design as
 * the web reference framework/core/speech.ts; fixture spec/fixtures/speech.json (SpeechConformanceTest). Written
 * without a compiler: CI (:axf-kernel:test) compiles and replays it.
 *
 * Contract shape only (an implementation step follows): a [SpeechProvider] a platform module registers under
 * `axf.speech` (lib-speech's AndroidTtsProvider over TextToSpeech does; the kernel keeps [PlaceholderSpeechProvider] until one
 * does), and the pure [SpeechQueue] rules every host runs the same way — enqueue, pause, skip, rate steps 0.5–2.0,
 * repeat. AmberX speaks in any app through this.
 */

public const val SPEECH_CONTRACT: String = "speech@1"
public const val SPEECH_CAPABILITY: String = "axf.speech"

public data class SpeechVoice(val id: String, val label: String, val language: String, val kind: String? = null)

public data class SpeakOptions(
    val voice: String? = null,
    /** 0.5..2.0 (1 = normal) */
    val rate: Double? = null,
    /** 0.5..2.0 (1 = normal) */
    val pitch: Double? = null,
    val language: String? = null,
    /** stop what is playing and speak now */
    val interrupt: Boolean = false,
) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        if (voice != null) put("voice", JsonPrimitive(voice))
        if (rate != null) put("rate", SpeechJson.number(rate))
        if (pitch != null) put("pitch", SpeechJson.number(pitch))
        if (language != null) put("language", JsonPrimitive(language))
        if (interrupt) put("interrupt", JsonPrimitive(true))
    })

    public companion object {
        public fun parse(o: JsonObject?): SpeakOptions? = o?.let {
            SpeakOptions(SpeechJson.str(it, "voice"), SpeechJson.double(it, "rate"), SpeechJson.double(it, "pitch"), SpeechJson.str(it, "language"), SpeechJson.bool(it, "interrupt") ?: false)
        }
    }
}

public enum class SpeakOutcome(public val id: String) {
    DONE("done"), STOPPED("stopped"), FAILED("failed");
    public companion object { public fun parse(s: String?): SpeakOutcome = entries.firstOrNull { it.id == s } ?: FAILED }
}

/** What a platform module provides (Android: lib-speech's AndroidTtsProvider over TextToSpeech). */
public interface SpeechProvider {
    public val id: String
    public val label: String
    public suspend fun available(): Boolean
    /** returns when the utterance is over (done, stopped or failed) */
    public suspend fun speak(text: String, opts: SpeakOptions? = null): AxfResult<SpeakOutcome>
    public suspend fun stop()
    public suspend fun voices(): AxfResult<List<SpeechVoice>>
}

/** The kernel default until a provider registers. Never pretends to work. */
public object PlaceholderSpeechProvider : SpeechProvider {
    override val id: String = "placeholder"
    override val label: String = "No speech provider"
    override suspend fun available(): Boolean = false
    override suspend fun speak(text: String, opts: SpeakOptions?): AxfResult<SpeakOutcome> = AxfResult.err(AxfFailure.NotImplemented(SPEECH_CAPABILITY))
    override suspend fun stop() {}
    override suspend fun voices(): AxfResult<List<SpeechVoice>> = AxfResult.ok(emptyList())
}

/* ---------- queue rules (pure) ---------- */

public enum class RepeatMode(public val id: String) {
    NONE("none"), ONE("one"), ALL("all");
    public companion object {
        public val IDS: List<String> = entries.map { it.id }
        public fun parse(s: String?): RepeatMode? = entries.firstOrNull { it.id == s }
    }
}

public data class SpeechItem(val id: String, val text: String, val opts: SpeakOptions? = null) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("id", JsonPrimitive(id)); put("text", JsonPrimitive(text))
        if (opts != null) put("opts", opts.toJson())
    })

    public companion object { public fun parse(o: JsonObject): SpeechItem = SpeechItem(SpeechJson.str(o, "id") ?: "", SpeechJson.str(o, "text") ?: "", SpeakOptions.parse(o["opts"] as? JsonObject)) }
}

public data class SpeechQueueState(
    val items: List<SpeechItem>,
    /** index of the item being (or about to be) spoken; = items.size when the queue is over */
    val index: Int,
    val paused: Boolean,
    val rate: Double,
    val repeat: RepeatMode,
    /** true while the provider is speaking the current item */
    val speaking: Boolean,
) {
    /** The item the host should be speaking now, or null (over, paused, empty). */
    public val current: SpeechItem? get() = if (paused || index < 0 || index >= items.size) null else items[index]

    public fun toJson(): JsonObject = JsonObject(mapOf(
        "items" to JsonArray(items.map { it.toJson() }), "index" to JsonPrimitive(index), "paused" to JsonPrimitive(paused),
        "rate" to SpeechJson.number(rate), "repeat" to JsonPrimitive(repeat.id), "speaking" to JsonPrimitive(speaking),
    ))
}

public sealed class SpeechQueueEvent {
    public data class Enqueue(val item: SpeechItem, val next: Boolean = false) : SpeechQueueEvent()
    public object Started : SpeechQueueEvent()
    public data class Done(val outcome: SpeakOutcome) : SpeechQueueEvent()
    public object Pause : SpeechQueueEvent()
    public object Resume : SpeechQueueEvent()
    public object Skip : SpeechQueueEvent()
    public object Back : SpeechQueueEvent()
    /** an unknown mode is ignored */
    public data class Repeat(val mode: RepeatMode?) : SpeechQueueEvent()
    public object Again : SpeechQueueEvent()
    public data class Rate(val rate: Double) : SpeechQueueEvent()
    public object Faster : SpeechQueueEvent()
    public object Slower : SpeechQueueEvent()
    public object Clear : SpeechQueueEvent()

    public companion object {
        public val TYPES: List<String> = listOf("enqueue", "started", "done", "pause", "resume", "skip", "back", "repeat", "again", "rate", "faster", "slower", "clear")

        /** An event from its JSON (`{type, …}`); null for an unknown type. */
        public fun parse(o: JsonObject): SpeechQueueEvent? = when (SpeechJson.str(o, "type")) {
            "enqueue" -> Enqueue(SpeechItem.parse(o["item"] as? JsonObject ?: return null), SpeechJson.bool(o, "next") ?: false)
            "started" -> Started
            "done" -> Done(SpeakOutcome.parse(SpeechJson.str(o, "outcome")))
            "pause" -> Pause
            "resume" -> Resume
            "skip" -> Skip
            "back" -> Back
            "repeat" -> Repeat(RepeatMode.parse(SpeechJson.str(o, "mode")))
            "again" -> Again
            "rate" -> Rate(SpeechJson.double(o, "rate") ?: Double.NaN)
            "faster" -> Faster
            "slower" -> Slower
            "clear" -> Clear
            else -> null
        }
    }
}

/** What the host does after an event: speak the current item at the queue's rate, stop the provider, or nothing. */
public sealed class SpeechEffect {
    public data class Speak(val item: SpeechItem, val rate: Double) : SpeechEffect()
    public object Stop : SpeechEffect()

    public fun toJson(): JsonObject = when (this) {
        is Speak -> JsonObject(mapOf("effect" to JsonPrimitive("speak"), "item" to item.toJson(), "rate" to SpeechJson.number(rate)))
        is Stop -> JsonObject(mapOf("effect" to JsonPrimitive("stop")))
    }
}

public data class SpeechStep(val state: SpeechQueueState, val effects: List<SpeechEffect>)

public object SpeechQueue {
    public const val RATE_MIN: Double = 0.5
    public const val RATE_MAX: Double = 2.0
    public const val RATE_DEFAULT: Double = 1.0
    /** The rate steps "faster" / "slower" move through. */
    public val RATE_STEPS: List<Double> = listOf(0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0)

    public fun clampRate(rate: Double): Double {
        if (rate.isNaN() || rate.isInfinite()) return RATE_DEFAULT
        return minOf(RATE_MAX, maxOf(RATE_MIN, Math.round(rate * 100) / 100.0))
    }

    /** The next step up or down from any rate (a rate between steps snaps to the next step in that direction). */
    public fun stepRate(rate: Double, up: Boolean): Double {
        val r = clampRate(rate)
        return if (up) RATE_STEPS.firstOrNull { it > r + 1e-9 } ?: RATE_MAX else RATE_STEPS.reversed().firstOrNull { it < r - 1e-9 } ?: RATE_MIN
    }

    public fun initial(rate: Double = RATE_DEFAULT, repeat: RepeatMode = RepeatMode.NONE): SpeechQueueState = SpeechQueueState(emptyList(), 0, false, clampRate(rate), repeat, false)

    /**
     * The queue reducer. Pure: state + event → state + effects. A [SpeechEffect.Speak] is emitted whenever the host
     * should start (or restart) the current item; the host calls the provider, then sends Started and Done.
     */
    public fun reduce(s: SpeechQueueState, e: SpeechQueueEvent): SpeechStep {
        val effects = ArrayList<SpeechEffect>()
        val items = ArrayList(s.items)
        var index = s.index
        var paused = s.paused
        var rate = s.rate
        var repeat = s.repeat
        var speaking = s.speaking
        fun current(): SpeechItem? = if (paused || index < 0 || index >= items.size) null else items[index]
        fun speakCurrent() { current()?.let { effects += SpeechEffect.Speak(it, rate) } }
        fun stopIfSpeaking() { if (speaking) { effects += SpeechEffect.Stop; speaking = false } }
        fun restart() { stopIfSpeaking(); speakCurrent() }
        when (e) {
            is SpeechQueueEvent.Enqueue -> {
                val wasIdle = !speaking && current() == null && !paused
                if (e.next) items.add(minOf(index + (if (speaking) 1 else 0), items.size), e.item) else items.add(e.item)
                if (index > items.size - 1 && !speaking) index = items.size - 1
                if (wasIdle) speakCurrent()
            }
            is SpeechQueueEvent.Started -> speaking = true
            is SpeechQueueEvent.Done -> {
                speaking = false
                if (e.outcome != SpeakOutcome.STOPPED) {
                    if (repeat == RepeatMode.ONE) speakCurrent() else {
                        index += 1
                        if (index >= items.size) index = if (repeat == RepeatMode.ALL && items.isNotEmpty()) 0 else items.size
                        speakCurrent()
                    }
                }
            }
            is SpeechQueueEvent.Pause -> if (!paused) { paused = true; stopIfSpeaking() }
            is SpeechQueueEvent.Resume -> if (paused) { paused = false; speakCurrent() }
            is SpeechQueueEvent.Skip -> {
                stopIfSpeaking()
                if (index < items.size) index += 1
                if (index >= items.size && repeat == RepeatMode.ALL && items.isNotEmpty()) index = 0
                speakCurrent()
            }
            is SpeechQueueEvent.Back -> {
                stopIfSpeaking()
                // the previous item; when the queue is over, the last one
                index = if (index >= items.size) maxOf(0, items.size - 1) else maxOf(0, index - 1)
                speakCurrent()
            }
            is SpeechQueueEvent.Repeat -> if (e.mode != null) repeat = e.mode
            is SpeechQueueEvent.Again -> {
                if (index >= items.size && items.isNotEmpty()) index = items.size - 1
                paused = false
                restart()
            }
            is SpeechQueueEvent.Rate -> { val r = clampRate(e.rate); if (r != rate) { rate = r; restart() } }
            is SpeechQueueEvent.Faster -> { val r = stepRate(rate, true); if (r != rate) { rate = r; restart() } }
            is SpeechQueueEvent.Slower -> { val r = stepRate(rate, false); if (r != rate) { rate = r; restart() } }
            is SpeechQueueEvent.Clear -> { if (speaking) effects += SpeechEffect.Stop; items.clear(); index = 0; speaking = false; paused = false }
        }
        return SpeechStep(SpeechQueueState(items.toList(), index, paused, rate, repeat, speaking), effects)
    }

    /** Replays events from the initial state (fixtures). */
    public fun replay(events: List<SpeechQueueEvent>, rate: Double = RATE_DEFAULT, repeat: RepeatMode = RepeatMode.NONE): List<SpeechStep> {
        val out = ArrayList<SpeechStep>()
        var s = initial(rate, repeat)
        for (e in events) { val step = reduce(s, e); out += step; s = step.state }
        return out
    }
}

/** JSON helpers shared by the speech contract and its conformance test. */
public object SpeechJson {
    public fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    public fun bool(o: JsonObject, k: String): Boolean? = (o[k] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull
    public fun double(o: JsonObject, k: String): Double? = (o[k] as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.doubleOrNull
    public fun isNull(e: JsonElement?): Boolean = e == null || e is JsonNull
    /** Numbers print like JavaScript's: whole values without a fraction. */
    public fun number(d: Double): JsonPrimitive = if (d == Math.floor(d) && d.isFinite() && Math.abs(d) < 1e15) JsonPrimitive(d.toLong()) else JsonPrimitive(d)
}
