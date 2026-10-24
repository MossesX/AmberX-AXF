package ai.amberx.axf.readaloud

/*
 * Read-aloud preferences: every knob the engine reads, with wide ranges, clamped on read so a hand-edited or imported
 * value can never push the TTS engine out of bounds. Pure Kotlin (no Android imports) so other ports mirror it.
 * Keys are `<prefix><name>` so several plugins can each keep their own copy (X Select uses `xselect.`).
 */

/** A numeric preference: default, range and step, the same numbers the settings sliders use. */
public data class NumRange(val default: Double, val min: Double, val max: Double, val step: Double) {
    public fun clamp(v: Double?): Double = if (v == null || v.isNaN()) default else v.coerceIn(min, max)
}

public enum class UrlMode(public val id: String) { READ("read"), SAY_LINK("link"), DOMAIN("domain"), SKIP("skip") }
public enum class EmojiMode(public val id: String) { SKIP("skip"), KEEP("keep") }
public enum class NumberMode(public val id: String) { NATURAL("natural"), DIGITS("digits") }
public enum class ChunkMode(public val id: String) { SENTENCE("sentence"), PARAGRAPH("paragraph"), CLAUSE("clause"), LINE("line"), FIXED("fixed") }
public enum class QueuePolicy(public val id: String) { REPLACE("replace"), APPEND("append"), NEXT("next") }
public enum class RepeatMode(public val id: String) { OFF("off"), TIMES("times"), LOOP("loop") }
public enum class AudioUsage(public val id: String) { MEDIA("media"), ACCESSIBILITY("accessibility"), ASSISTANT("assistant"), NAVIGATION("navigation"), NOTIFICATION("notification"), ALARM("alarm") }
public enum class FocusMode(public val id: String) { PAUSE_OTHERS("pause"), DUCK_OTHERS("duck"), NONE("none") }
public enum class FocusLoss(public val id: String) { PAUSE("pause"), STOP("stop"), KEEP("keep") }
public enum class OverLimit(public val id: String) { CUT("cut"), SENTENCE("sentence"), REFUSE("refuse") }
public enum class HighlightMode(public val id: String) { WORD("word"), SENTENCE("sentence"), NONE("none") }
public enum class ControlsMode(public val id: String) { FULL("full"), COMPACT("compact"), NONE("none") }
public enum class SkipUnit(public val id: String) { SENTENCE("sentence"), PARAGRAPH("paragraph") }

internal inline fun <reified E : Enum<E>> enumOf(id: String?, default: E, ids: (E) -> String): E = enumValues<E>().firstOrNull { ids(it) == id } ?: default

public data class ReadAloudPrefs(
    // Voice
    val engine: String = "",
    val voice: String = "",
    val language: String = "system",
    val preferOffline: Boolean = true,
    val allowNetworkVoices: Boolean = true,
    val minQuality: Int = 0,
    // Speed, pitch, volume
    val rate: Double = ReadAloudRanges.RATE.default,
    val pitch: Double = ReadAloudRanges.PITCH.default,
    val volume: Double = ReadAloudRanges.VOLUME.default,
    val pan: Double = ReadAloudRanges.PAN.default,
    val slowRate: Double = ReadAloudRanges.SLOW_RATE.default,
    val longTextBoost: Boolean = false,
    val longTextChars: Int = ReadAloudRanges.LONG_TEXT.default.toInt(),
    val longTextRate: Double = ReadAloudRanges.LONG_RATE.default,
    // Pauses
    val startDelayMs: Int = ReadAloudRanges.START_DELAY.default.toInt(),
    val sentencePauseMs: Int = ReadAloudRanges.SENTENCE_PAUSE.default.toInt(),
    val paragraphPauseMs: Int = ReadAloudRanges.PARAGRAPH_PAUSE.default.toInt(),
    val clausePauseMs: Int = ReadAloudRanges.CLAUSE_PAUSE.default.toInt(),
    // Text
    val urls: UrlMode = UrlMode.DOMAIN,
    val emoji: EmojiMode = EmojiMode.SKIP,
    val numbers: NumberMode = NumberMode.NATURAL,
    val skipBrackets: Boolean = false,
    val stripMarkdown: Boolean = true,
    val expandAbbreviations: Boolean = true,
    val spellCaps: Boolean = false,
    val dropHashSigns: Boolean = true,
    val joinHyphenatedLines: Boolean = true,
    val readPunctuation: Boolean = false,
    val spellOut: Boolean = false,
    val pronunciations: String = "",
    val maxChars: Int = ReadAloudRanges.MAX_CHARS.default.toInt(),
    val overLimit: OverLimit = OverLimit.SENTENCE,
    // Chunking
    val chunk: ChunkMode = ChunkMode.SENTENCE,
    val maxUtterance: Int = ReadAloudRanges.MAX_UTTERANCE.default.toInt(),
    // Queue
    val queue: QueuePolicy = QueuePolicy.REPLACE,
    val queueSize: Int = ReadAloudRanges.QUEUE_SIZE.default.toInt(),
    val history: Int = ReadAloudRanges.HISTORY.default.toInt(),
    val repeat: RepeatMode = RepeatMode.OFF,
    val repeatTimes: Int = ReadAloudRanges.REPEAT_TIMES.default.toInt(),
    // Audio
    val usage: AudioUsage = AudioUsage.MEDIA,
    val focus: FocusMode = FocusMode.DUCK_OTHERS,
    val onFocusLoss: FocusLoss = FocusLoss.PAUSE,
    val resumeAfterFocus: Boolean = true,
    val pauseOnUnplug: Boolean = true,
    // Playback screen + notification
    val highlight: HighlightMode = HighlightMode.WORD,
    val controls: ControlsMode = ControlsMode.FULL,
    val showSentence: Boolean = true,
    val showProgress: Boolean = true,
    val skipUnit: SkipUnit = SkipUnit.SENTENCE,
    val rateStep: Double = ReadAloudRanges.RATE_STEP.default,
    // Behaviour
    val sleepMinutes: Int = ReadAloudRanges.SLEEP.default.toInt(),
    val stopOnScreenOff: Boolean = false,
    val initTimeoutMs: Int = ReadAloudRanges.INIT_TIMEOUT.default.toInt(),
    val retries: Int = ReadAloudRanges.RETRIES.default.toInt(),
) {
    /** The speaking rate for this text: the slow rate for a "read slowly" entry, the long-text rate past the threshold. */
    public fun rateFor(chars: Int, slow: Boolean = false): Double = when {
        slow -> slowRate
        longTextBoost && chars >= longTextChars -> maxOf(rate, longTextRate)
        else -> rate
    }

    public companion object {
        public val DEFAULT: ReadAloudPrefs = ReadAloudPrefs()

        /**
         * Reads every preference through [get] (`<prefix><name>` → the stored text, or null), clamping numbers into
         * their range and falling back to the default for unknown choices. Never throws.
         */
        public fun from(prefix: String, get: (String) -> String?): ReadAloudPrefs {
            val k = ReadAloudKeys(prefix)
            fun s(key: String, d: String) = get(key)?.trim()?.takeIf { it.isNotEmpty() } ?: d
            fun b(key: String, d: Boolean) = get(key)?.trim()?.toBooleanStrictOrNull() ?: d
            fun n(key: String, r: NumRange) = r.clamp(get(key)?.trim()?.toDoubleOrNull())
            fun i(key: String, r: NumRange) = n(key, r).let { Math.round(it).toInt() }
            val d = DEFAULT
            return ReadAloudPrefs(
                engine = s(k.engine, d.engine).takeUnless { it == "system" } ?: "",
                voice = s(k.voice, d.voice).takeUnless { it == "auto" } ?: "",
                language = s(k.language, d.language),
                preferOffline = b(k.preferOffline, d.preferOffline),
                allowNetworkVoices = b(k.allowNetworkVoices, d.allowNetworkVoices),
                minQuality = i(k.minQuality, ReadAloudRanges.QUALITY),
                rate = n(k.rate, ReadAloudRanges.RATE),
                pitch = n(k.pitch, ReadAloudRanges.PITCH),
                volume = n(k.volume, ReadAloudRanges.VOLUME),
                pan = n(k.pan, ReadAloudRanges.PAN),
                slowRate = n(k.slowRate, ReadAloudRanges.SLOW_RATE),
                longTextBoost = b(k.longTextBoost, d.longTextBoost),
                longTextChars = i(k.longTextChars, ReadAloudRanges.LONG_TEXT),
                longTextRate = n(k.longTextRate, ReadAloudRanges.LONG_RATE),
                startDelayMs = i(k.startDelay, ReadAloudRanges.START_DELAY),
                sentencePauseMs = i(k.sentencePause, ReadAloudRanges.SENTENCE_PAUSE),
                paragraphPauseMs = i(k.paragraphPause, ReadAloudRanges.PARAGRAPH_PAUSE),
                clausePauseMs = i(k.clausePause, ReadAloudRanges.CLAUSE_PAUSE),
                urls = enumOf(get(k.urls), d.urls) { it.id },
                emoji = enumOf(get(k.emoji), d.emoji) { it.id },
                numbers = enumOf(get(k.numbers), d.numbers) { it.id },
                skipBrackets = b(k.skipBrackets, d.skipBrackets),
                stripMarkdown = b(k.stripMarkdown, d.stripMarkdown),
                expandAbbreviations = b(k.expandAbbreviations, d.expandAbbreviations),
                spellCaps = b(k.spellCaps, d.spellCaps),
                dropHashSigns = b(k.dropHashSigns, d.dropHashSigns),
                joinHyphenatedLines = b(k.joinHyphenatedLines, d.joinHyphenatedLines),
                readPunctuation = b(k.readPunctuation, d.readPunctuation),
                spellOut = b(k.spellOut, d.spellOut),
                pronunciations = get(k.pronunciations) ?: d.pronunciations,
                maxChars = i(k.maxChars, ReadAloudRanges.MAX_CHARS),
                overLimit = enumOf(get(k.overLimit), d.overLimit) { it.id },
                chunk = enumOf(get(k.chunk), d.chunk) { it.id },
                maxUtterance = i(k.maxUtterance, ReadAloudRanges.MAX_UTTERANCE),
                queue = enumOf(get(k.queue), d.queue) { it.id },
                queueSize = i(k.queueSize, ReadAloudRanges.QUEUE_SIZE),
                history = i(k.history, ReadAloudRanges.HISTORY),
                repeat = enumOf(get(k.repeat), d.repeat) { it.id },
                repeatTimes = i(k.repeatTimes, ReadAloudRanges.REPEAT_TIMES),
                usage = enumOf(get(k.usage), d.usage) { it.id },
                focus = enumOf(get(k.focus), d.focus) { it.id },
                onFocusLoss = enumOf(get(k.onFocusLoss), d.onFocusLoss) { it.id },
                resumeAfterFocus = b(k.resumeAfterFocus, d.resumeAfterFocus),
                pauseOnUnplug = b(k.pauseOnUnplug, d.pauseOnUnplug),
                highlight = enumOf(get(k.highlight), d.highlight) { it.id },
                controls = enumOf(get(k.controls), d.controls) { it.id },
                showSentence = b(k.showSentence, d.showSentence),
                showProgress = b(k.showProgress, d.showProgress),
                skipUnit = enumOf(get(k.skipUnit), d.skipUnit) { it.id },
                rateStep = n(k.rateStep, ReadAloudRanges.RATE_STEP),
                sleepMinutes = i(k.sleep, ReadAloudRanges.SLEEP),
                stopOnScreenOff = b(k.stopOnScreenOff, d.stopOnScreenOff),
                initTimeoutMs = i(k.initTimeout, ReadAloudRanges.INIT_TIMEOUT),
                retries = i(k.retries, ReadAloudRanges.RETRIES),
            )
        }
    }
}

/** Every range in one place: the settings sliders and [ReadAloudPrefs.from] both read these. */
public object ReadAloudRanges {
    public val RATE: NumRange = NumRange(1.0, 0.1, 4.0, 0.05)
    public val PITCH: NumRange = NumRange(1.0, 0.25, 4.0, 0.05)
    public val VOLUME: NumRange = NumRange(100.0, 0.0, 100.0, 1.0)
    public val PAN: NumRange = NumRange(0.0, -1.0, 1.0, 0.05)
    public val SLOW_RATE: NumRange = NumRange(0.6, 0.1, 1.0, 0.05)
    public val LONG_TEXT: NumRange = NumRange(3000.0, 200.0, 50_000.0, 100.0)
    public val LONG_RATE: NumRange = NumRange(1.3, 0.5, 4.0, 0.05)
    public val START_DELAY: NumRange = NumRange(0.0, 0.0, 5000.0, 50.0)
    public val SENTENCE_PAUSE: NumRange = NumRange(150.0, 0.0, 3000.0, 25.0)
    public val PARAGRAPH_PAUSE: NumRange = NumRange(450.0, 0.0, 6000.0, 50.0)
    public val CLAUSE_PAUSE: NumRange = NumRange(0.0, 0.0, 1500.0, 25.0)
    public val MAX_CHARS: NumRange = NumRange(50_000.0, 100.0, 200_000.0, 100.0)
    public val MAX_UTTERANCE: NumRange = NumRange(600.0, 40.0, 3900.0, 10.0)
    public val QUEUE_SIZE: NumRange = NumRange(20.0, 1.0, 200.0, 1.0)
    public val HISTORY: NumRange = NumRange(25.0, 0.0, 500.0, 1.0)
    public val REPEAT_TIMES: NumRange = NumRange(2.0, 1.0, 20.0, 1.0)
    public val RATE_STEP: NumRange = NumRange(0.1, 0.05, 1.0, 0.05)
    public val SLEEP: NumRange = NumRange(0.0, 0.0, 240.0, 5.0)
    public val INIT_TIMEOUT: NumRange = NumRange(4000.0, 1000.0, 30_000.0, 500.0)
    public val RETRIES: NumRange = NumRange(1.0, 0.0, 5.0, 1.0)
    /** Minimum voice quality (Android Voice.QUALITY_*: 100 very low … 500 very high; 0 = any). */
    public val QUALITY: NumRange = NumRange(0.0, 0.0, 500.0, 100.0)
}

/** Setting keys under one prefix. */
public class ReadAloudKeys(public val prefix: String) {
    private fun k(n: String) = "$prefix$n"
    public val engine: String = k("engine"); public val voice: String = k("voice"); public val language: String = k("language")
    public val preferOffline: String = k("preferOffline"); public val allowNetworkVoices: String = k("networkVoices"); public val minQuality: String = k("minQuality")
    public val rate: String = k("rate"); public val pitch: String = k("pitch"); public val volume: String = k("volume"); public val pan: String = k("pan")
    public val slowRate: String = k("slowRate"); public val longTextBoost: String = k("longTextBoost"); public val longTextChars: String = k("longTextChars"); public val longTextRate: String = k("longTextRate")
    public val startDelay: String = k("startDelayMs"); public val sentencePause: String = k("sentencePauseMs"); public val paragraphPause: String = k("paragraphPauseMs"); public val clausePause: String = k("clausePauseMs")
    public val urls: String = k("urls"); public val emoji: String = k("emoji"); public val numbers: String = k("numbers"); public val skipBrackets: String = k("skipBrackets")
    public val stripMarkdown: String = k("stripMarkdown"); public val expandAbbreviations: String = k("abbreviations"); public val spellCaps: String = k("spellCaps")
    public val dropHashSigns: String = k("dropHashSigns"); public val joinHyphenatedLines: String = k("joinHyphens"); public val readPunctuation: String = k("readPunctuation")
    public val spellOut: String = k("spellOut"); public val pronunciations: String = k("pronunciations"); public val maxChars: String = k("maxChars"); public val overLimit: String = k("overLimit")
    public val chunk: String = k("chunk"); public val maxUtterance: String = k("maxUtterance")
    public val queue: String = k("queue"); public val queueSize: String = k("queueSize"); public val history: String = k("history"); public val repeat: String = k("repeat"); public val repeatTimes: String = k("repeatTimes")
    public val usage: String = k("usage"); public val focus: String = k("focus"); public val onFocusLoss: String = k("onFocusLoss"); public val resumeAfterFocus: String = k("resumeAfterFocus"); public val pauseOnUnplug: String = k("pauseOnUnplug")
    public val highlight: String = k("highlight"); public val controls: String = k("controls"); public val showSentence: String = k("showSentence"); public val showProgress: String = k("showProgress")
    public val skipUnit: String = k("skipUnit"); public val rateStep: String = k("rateStep")
    public val sleep: String = k("sleepMinutes"); public val stopOnScreenOff: String = k("stopOnScreenOff"); public val initTimeout: String = k("initTimeoutMs"); public val retries: String = k("retries")
}
