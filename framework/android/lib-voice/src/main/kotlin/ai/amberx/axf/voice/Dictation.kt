package ai.amberx.axf.voice

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.flow.transformWhile

/** A stop phrase found at the end of an utterance. [before] is the original text ahead of it (trimmed, may be empty). */
public data class EndPhraseMatch(val phrase: String, val before: String)

/**
 * Stop-phrase detection for dictation (pure Kotlin). A stop phrase ends the dictation only when it is
 * the last words of a final utterance ("buy milk end note"), so "the end note of the song, then more"
 * keeps going. Words compare after [PhraseMatcher.normalize]; the text kept keeps its original case.
 */
public object EndPhrases {
    public val DEFAULT: List<String> = listOf("end note")

    /** "end note, stop dictation" → ["end note", "stop dictation"]; blank → [DEFAULT]. */
    public fun parse(stored: String?): List<String> =
        ArmingConfig.parsePhrases(stored).ifEmpty { DEFAULT }

    /** The longest of [phrases] that [text] ends with, or null. */
    public fun find(text: String, phrases: List<String>): EndPhraseMatch? {
        val tokens = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val norm = tokens.map { PhraseMatcher.normalize(it) }
        // a token that was only punctuation ("end note.") normalizes to "": skip those at the tail
        val idx = norm.indices.filter { norm[it].isNotEmpty() }
        val words = idx.flatMap { i -> norm[i].split(' ').map { it to i } }
        var best: EndPhraseMatch? = null
        var bestLen = 0
        for (raw in phrases) {
            val p = PhraseMatcher.normalize(raw).split(' ').filter { it.isNotEmpty() }
            if (p.isEmpty() || p.size > words.size || p.size <= bestLen) continue
            val tail = words.subList(words.size - p.size, words.size)
            if (tail.map { it.first } != p) continue
            val firstToken = tail.first().second
            // the phrase must start on a token boundary ("weekend note" never matches "end note")
            if (words.size > p.size && words[words.size - p.size - 1].second == firstToken) continue
            best = EndPhraseMatch(p.joinToString(" "), tokens.take(firstToken).joinToString(" ").trim())
            bestLen = p.size
        }
        return best
    }
}

/** What one final utterance did to a dictation. */
public data class DictationStep(val added: String, val transcript: String, val ended: Boolean, val endPhrase: String? = null)

/**
 * Builds a dictation transcript from final utterances until a stop phrase (pure Kotlin). After it has
 * ended, further text is ignored.
 */
public class DictationAssembler(public val endPhrases: List<String> = EndPhrases.DEFAULT) {
    private val parts = mutableListOf<String>()
    public val segments: List<String> get() = parts.toList()
    public val transcript: String get() = parts.joinToString(" ")
    public var ended: Boolean = false
        private set

    public fun accept(finalText: String): DictationStep {
        if (ended) return DictationStep("", transcript, true)
        val text = finalText.trim()
        val hit = EndPhrases.find(text, endPhrases)
        val added = hit?.before ?: text
        if (added.isNotEmpty()) parts += added
        if (hit != null) ended = true
        return DictationStep(added, transcript, ended, hit?.phrase)
    }

    /** Transcript plus the live partial, for showing while the person talks. */
    public fun preview(partial: String): String = listOf(transcript, partial.trim()).filter { it.isNotEmpty() }.joinToString(" ")
}

public enum class DictationEndReason { END_PHRASE, FAILED }

/** Events from [dictate]. */
public sealed interface DictationEvent {
    /** Live text: [transcript] so far plus the words being spoken. */
    public data class Partial(val preview: String, val partial: String) : DictationEvent
    /** A final utterance was added. */
    public data class Segment(val text: String, val transcript: String, val confidence: Float) : DictationEvent
    /** A final utterance below the sensitivity floor was dropped. */
    public data class Dropped(val text: String, val confidence: Float) : DictationEvent
    /** Last event: the dictation is over and the engine is stopped. */
    public data class Ended(val transcript: String, val reason: DictationEndReason, val endPhrase: String? = null, val message: String? = null) : DictationEvent
}

/**
 * Dictation stream: starts the engine, keeps listening across pauses and emits [DictationEvent]s until
 * a stop phrase ("end note") or until the collector cancels; the engine is stopped either way.
 * Final utterances below the [VoiceEngineOptions.sensitivity] floor are dropped.
 */
public fun VoiceEngine.dictate(options: VoiceEngineOptions = VoiceEngineOptions(), endPhrases: List<String> = EndPhrases.DEFAULT): Flow<DictationEvent> = flow {
    val engine = this@dictate
    val assembler = DictationAssembler(endPhrases.ifEmpty { EndPhrases.DEFAULT })
    try {
        engine.results
            .onSubscription {
                if (!engine.start(options)) {
                    val s = engine.state.value
                    throw VoiceStartFailed(if (s is VoiceEngineState.Failed) s.message else "The ${engine.kind.label} engine didn't start.")
                }
            }
            .transformWhile<VoiceResult, DictationEvent> { r ->
                when {
                    !r.final -> { emit(DictationEvent.Partial(assembler.preview(r.text), r.text)); true }
                    !VoiceSensitivity.passes(r, options.sensitivity) -> { emit(DictationEvent.Dropped(r.text, r.confidence)); true }
                    else -> {
                        val step = assembler.accept(r.text)
                        if (step.added.isNotEmpty()) emit(DictationEvent.Segment(step.added, step.transcript, r.confidence))
                        if (step.ended) emit(DictationEvent.Ended(step.transcript, DictationEndReason.END_PHRASE, step.endPhrase))
                        !step.ended
                    }
                }
            }
            .collect { emit(it) }
    } catch (e: VoiceStartFailed) {
        emit(DictationEvent.Ended(assembler.transcript, DictationEndReason.FAILED, message = e.message))
    } finally {
        engine.stop()
    }
}
