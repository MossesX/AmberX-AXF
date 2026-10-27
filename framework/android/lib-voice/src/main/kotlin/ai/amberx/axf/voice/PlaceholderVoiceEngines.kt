package ai.amberx.axf.voice

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A declared-but-unbuilt engine: never available, [start] fails with [note] and nothing is ever
 * heard. The real engine later replaces the subclass without any caller changing.
 */
public open class PlaceholderVoiceEngine(
    override val kind: VoiceEngineKind,
    /** The library.json placeholder capability, e.g. `axf.voice.engine.android`. */
    public val capability: String,
    public val note: String,
) : VoiceEngine {
    override val available: Boolean get() = false
    private val _state = MutableStateFlow<VoiceEngineState>(VoiceEngineState.Idle)
    override val state: StateFlow<VoiceEngineState> = _state.asStateFlow()
    override val results: SharedFlow<VoiceResult> = MutableSharedFlow<VoiceResult>().asSharedFlow()
    override val echoCancelActive: Boolean get() = false

    override suspend fun start(options: VoiceEngineOptions): Boolean {
        _state.value = VoiceEngineState.Failed(note)
        return false
    }
    override fun stop() { _state.value = VoiceEngineState.Idle }
    override fun close() { stop() }
}

/** Placeholder: the phone's SpeechRecognizer restarted in a loop (beeps and gaps between utterances on most phones). Not built. */
public class AndroidRecognizerVoiceEngine : PlaceholderVoiceEngine(
    VoiceEngineKind.ANDROID, "axf.voice.engine.android",
    "The phone-recognizer engine isn't built yet. Use Vosk (Settings → Voice listening → Engine).",
)

/** Placeholder: streaming cloud speech-to-text through a provider the app configures. Not built. */
public class CloudVoiceEngine(public val provider: String? = null) : PlaceholderVoiceEngine(
    VoiceEngineKind.CLOUD, "axf.voice.engine.cloud",
    "The cloud speech engine isn't built yet. Use Vosk (Settings → Voice listening → Engine).",
)
