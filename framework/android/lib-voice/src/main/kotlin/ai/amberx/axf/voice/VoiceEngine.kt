package ai.amberx.axf.voice

import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/*
 * Continuous speech engines (lib-voice 0.3.0). [SpeechInput] stays the one-shot recognizer behind
 * AxfVoice.ask; a VoiceEngine listens until stopped and streams what it hears, for dictation and
 * hands-free commands. Pure contract: no Android imports, so other ports can mirror it.
 */

/** Which engine family an engine belongs to. Stored in the `axf.voice.engine` setting by [id]. */
public enum class VoiceEngineKind(public val id: String, public val label: String) {
    /** On-device, open source, runs continuously on the mic (default). */
    VOSK("vosk", "Vosk (on-device)"),
    /** The phone's SpeechRecognizer restarted in a loop. Placeholder: not built. */
    ANDROID("android", "Phone recognizer"),
    /** A cloud speech service. Placeholder: not built. */
    CLOUD("cloud", "Cloud"),
    ;

    public companion object {
        public val DEFAULT: VoiceEngineKind = VOSK
        public fun of(id: String?): VoiceEngineKind = entries.firstOrNull { it.id == id } ?: DEFAULT
    }
}

/**
 * One result from a [VoiceEngine].
 *
 * @property text what was heard, trimmed (never blank).
 * @property confidence 0..1. Final results carry the engine's score (Vosk: mean word confidence);
 *   partial results carry [UNSCORED] because engines don't score them.
 * @property final true when the engine closed the utterance; false for live partial text that may still change.
 */
public data class VoiceResult(
    val text: String,
    val confidence: Float,
    val final: Boolean,
    val alternatives: List<String> = listOf(text),
    val atMs: Long = 0L,
) {
    public companion object {
        public const val UNSCORED: Float = 0f
    }
}

/** What an engine is doing. */
public sealed interface VoiceEngineState {
    public data object Idle : VoiceEngineState
    /** Loading or unpacking a model; [start] has been called. */
    public data object Loading : VoiceEngineState
    public data object Listening : VoiceEngineState
    public data class Failed(val message: String) : VoiceEngineState
}

/** Options for one [VoiceEngine.start]. */
public data class VoiceEngineOptions(
    /** BCP-47 tag, or null for the engine's default (Vosk: whatever model is installed). */
    val language: String? = null,
    /** 0..1, see [VoiceSensitivity]. Higher = accepts less certain speech. */
    val sensitivity: Float = VoiceSensitivity.DEFAULT,
    /** Use the platform AcousticEchoCanceler (and the voice-communication mic source) when available. */
    val echoCancellation: Boolean = true,
    /** Use the platform NoiseSuppressor when available. */
    val noiseSuppression: Boolean = true,
    /** Emit partial results while the person is talking. */
    val partials: Boolean = true,
)

/**
 * A continuous recognizer. One session at a time: [start] while listening restarts with the new
 * options. [results] is hot: collect it before (or while) calling [start], or use [dictate], which
 * does both in the right order.
 */
public interface VoiceEngine {
    public val kind: VoiceEngineKind
    /** False when this engine can't run on this phone or isn't built (placeholders). */
    public val available: Boolean
    public val state: StateFlow<VoiceEngineState>
    public val results: SharedFlow<VoiceResult>
    /** True when echo cancellation is actually running in the current session. */
    public val echoCancelActive: Boolean

    /** Starts listening. Returns false (and sets [state] to [VoiceEngineState.Failed]) when it can't. */
    public suspend fun start(options: VoiceEngineOptions = VoiceEngineOptions()): Boolean
    /** Stops listening; safe to call when idle. */
    public fun stop()
    /** Stops and frees the model; the engine can't be started again. */
    public fun close()
}

/** Thrown inside [dictate] when the engine refuses to start; never escapes it. */
internal class VoiceStartFailed(message: String) : Exception(message)
