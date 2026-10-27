package ai.amberx.axf.voice

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map

/** How hands-free listening is armed. */
public data class ArmingConfig(
    /** Phrases that arm the listener ("hey notes"). Matched as whole words after [PhraseMatcher.normalize]. */
    val phrases: List<String> = listOf(DEFAULT_PHRASE),
    /** True = every utterance passes; the arming phrase is optional (and stripped when said). */
    val alwaysArmed: Boolean = false,
    /** How long the listener stays armed after the arming phrase (or the last command). 0 = only the rest of that utterance. */
    val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    /** Each passed utterance restarts the timeout, so a run of commands needs one arming phrase. */
    val extendOnUse: Boolean = true,
) {
    public companion object {
        public const val DEFAULT_PHRASE: String = "hey notes"
        public const val DEFAULT_TIMEOUT_MS: Long = 8_000L
        public const val MAX_TIMEOUT_MS: Long = 120_000L

        /** "hey notes, ok notes" → ["hey notes", "ok notes"] (comma or newline separated, blanks dropped). */
        public fun parsePhrases(stored: String?): List<String> =
            stored.orEmpty().split(',', '\n').map { PhraseMatcher.normalize(it) }.filter { it.isNotEmpty() }.distinct()
    }
}

/** What [VoiceArming.onHeard] decided about one utterance. */
public sealed interface ArmingDecision {
    /** Not armed and no arming phrase: drop it. */
    public data object Ignored : ArmingDecision
    /** The arming phrase alone: now armed until [untilMs] (Long.MAX_VALUE when always armed). */
    public data class Armed(val untilMs: Long) : ArmingDecision
    /** Act on [text] (normalized; the arming phrase removed). */
    public data class Pass(val text: String, val untilMs: Long) : ArmingDecision
}

/**
 * Arming state machine (pure Kotlin; time comes in as `nowMs`). Disarmed → arming phrase → Armed
 * until the timeout → Disarmed. With [ArmingConfig.alwaysArmed] it never disarms. Feed it final
 * results only. Not thread-safe: call it from one collector.
 */
public class VoiceArming(config: ArmingConfig = ArmingConfig()) {
    public var config: ArmingConfig = config
        set(value) { field = value; if (value.alwaysArmed) armedUntil = null }
    private var armedUntil: Long? = null

    public fun isArmed(nowMs: Long): Boolean = config.alwaysArmed || (armedUntil?.let { nowMs < it } ?: false)

    /** Milliseconds left armed; null when always armed, 0 when disarmed. */
    public fun remainingMs(nowMs: Long): Long? = if (config.alwaysArmed) null else ((armedUntil ?: nowMs) - nowMs).coerceAtLeast(0L)

    /** Arms by hand (a button or another trigger) as if the phrase was said. */
    public fun arm(nowMs: Long): Long { val until = untilFrom(nowMs); armedUntil = until; return until }

    public fun disarm() { armedUntil = null }

    public fun onHeard(text: String, nowMs: Long): ArmingDecision {
        val heard = PhraseMatcher.normalize(text)
        if (heard.isEmpty()) return ArmingDecision.Ignored
        val rest = afterArmingPhrase(heard)
        if (rest != null) {
            val until = arm(nowMs)
            return if (rest.isEmpty()) ArmingDecision.Armed(if (config.alwaysArmed) Long.MAX_VALUE else until)
                else ArmingDecision.Pass(rest, if (config.alwaysArmed) Long.MAX_VALUE else until)
        }
        if (config.alwaysArmed) return ArmingDecision.Pass(heard, Long.MAX_VALUE)
        val until = armedUntil
        if (until == null || nowMs >= until) { armedUntil = null; return ArmingDecision.Ignored }
        val next = if (config.extendOnUse) untilFrom(nowMs) else until
        armedUntil = next
        return ArmingDecision.Pass(heard, next)
    }

    /** Words after the last arming phrase in [heard] ("" when it was the phrase alone), or null when none was said. */
    internal fun afterArmingPhrase(heard: String): String? {
        val words = heard.split(' ')
        var best: Int? = null
        for (raw in config.phrases) {
            val p = PhraseMatcher.normalize(raw).split(' ').filter { it.isNotEmpty() }
            if (p.isEmpty() || p.size > words.size) continue
            for (i in words.size - p.size downTo 0) {
                if (words.subList(i, i + p.size) == p) { val end = i + p.size; if (best == null || end > best) best = end; break }
            }
        }
        return best?.let { words.drop(it).joinToString(" ").trim() }
    }

    private fun untilFrom(nowMs: Long): Long = nowMs + config.timeoutMs.coerceIn(0L, ArmingConfig.MAX_TIMEOUT_MS)
}

/**
 * Hands-free commands from an engine's [VoiceEngine.results]: final results above the sensitivity
 * floor go through [arming]; only [ArmingDecision.Armed] and [ArmingDecision.Pass] come out. Match the
 * passed text with [VoiceCommands.match].
 */
public fun Flow<VoiceResult>.armedBy(arming: VoiceArming, sensitivity: Float, nowMs: () -> Long = { System.currentTimeMillis() }): Flow<ArmingDecision> =
    filter { it.final && VoiceSensitivity.passes(it, sensitivity) }
        .map { arming.onHeard(it.text, nowMs()) }
        .filter { it !is ArmingDecision.Ignored }
