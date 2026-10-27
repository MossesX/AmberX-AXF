package ai.amberx.axf.axnotes.capture

import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.DictationEndReason
import ai.amberx.axf.voice.DictationEvent
import ai.amberx.axf.voice.VoiceEngine
import ai.amberx.axf.voice.VoiceEngineState
import ai.amberx.axf.voice.VoiceResult
import ai.amberx.axf.voice.VoiceSensitivity
import ai.amberx.axf.voice.dictate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Starts / stops the app's microphone foreground service (MicService); a seam so the loop stays testable. */
interface MicForeground {
    fun start(): Boolean
    fun stop()
}

/**
 * [NoteCapture] on lib-voice: one engine (the user's pick, Vosk by default), shared by everything that listens.
 *
 * Who keeps the microphone on is a set of holders: `capture` (the Speak screen's Listen button), `hands-free`
 * (overlay / settings: listen in the background for triggers) and `dictation` (a note being dictated). While anyone
 * holds it the engine runs and the app's microphone foreground service keeps it alive in the background.
 *
 * Where a final utterance goes:
 *  - while a note is dictated: lib-voice's `VoiceEngine.dictate` stream (sensitivity floor + the user's stop phrases
 *    from Settings → Voice listening) feeds the [CaptureController]'s dictation; a stop phrase ends and saves the note;
 *  - otherwise: the [router] (the trigger host: lib-triggers' VoiceTriggerBridge on the kernel registry) when there is
 *    one, else the controller's own phrase matching (the `onFinal` handed to [start]).
 * `dictate` stops the engine when it ends, so the loop restarts it for the remaining holders.
 */
class VoiceLoop(
    private val voice: AxfVoice,
    private val scope: CoroutineScope,
    private val foreground: MicForeground,
) : NoteCapture {
    /** The trigger host: gets every final utterance outside dictation. Null = the controller matches phrases itself. */
    fun interface Router { fun route(result: VoiceResult) }

    private val engine: VoiceEngine get() = voice.engine()

    private val _available = MutableStateFlow(false)
    override val available: StateFlow<Boolean> = _available.asStateFlow()
    private val _listening = MutableStateFlow(false)
    override val listening: StateFlow<Boolean> = _listening.asStateFlow()
    private val _partial = MutableStateFlow("")
    override val partial: StateFlow<String> = _partial.asStateFlow()
    /** The last final utterance and its confidence (overlay + mini screen). */
    private val _lastHeard = MutableStateFlow<VoiceResult?>(null)
    val lastHeard: StateFlow<VoiceResult?> = _lastHeard.asStateFlow()
    /** Why listening stopped or didn't start (no model, no mic permission…); null while fine. */
    private val _problem = MutableStateFlow<String?>(null)
    val problem: StateFlow<String?> = _problem.asStateFlow()
    private val _holders = MutableStateFlow<Set<String>>(emptySet())
    val holders: StateFlow<Set<String>> = _holders.asStateFlow()

    @Volatile var router: Router? = null
    /** True while the app is speaking: dictated words are dropped then, so read-backs don't end up in the note. */
    @Volatile var speaking: () -> Boolean = { false }

    private var onFinal: ((String) -> Unit)? = null
    private var controller: CaptureController? = null
    private var dictateJob: Job? = null
    private var collector: Job? = null

    init {
        refreshAvailable()
        scope.launch { engine.state.collect { s -> _listening.value = s is VoiceEngineState.Listening; if (s is VoiceEngineState.Failed) _problem.value = s.message } }
    }

    fun refreshAvailable() { _available.value = runCatching { engine.available }.getOrDefault(false) }

    /** Follows the controller: a dictation starting or ending switches the engine to the dictate stream and back. */
    fun attach(c: CaptureController) {
        controller = c
        scope.launch {
            var wasDictating = false
            c.state.collect { s ->
                val dictating = s is CaptureState.Dictating
                if (dictating && !wasDictating) beginDictation()
                if (!dictating && wasDictating) endDictation()
                wasDictating = dictating
            }
        }
    }

    // ---------------------------------------------------------------- NoteCapture

    override fun start(onFinal: (String) -> Unit) { this.onFinal = onFinal; hold(HOLD_CAPTURE) }
    override fun stop() { release(HOLD_CAPTURE) }

    // ---------------------------------------------------------------- holders

    val handsFree: Boolean get() = HOLD_HANDS_FREE in _holders.value

    fun setHandsFree(on: Boolean) { if (on) hold(HOLD_HANDS_FREE) else release(HOLD_HANDS_FREE) }

    fun hold(reason: String) {
        val before = _holders.value
        if (reason in before) return
        _holders.value = before + reason
        if (before.isEmpty()) foreground.start()
        if (dictateJob == null) startEngine()
    }

    fun release(reason: String) {
        val after = _holders.value - reason
        if (after.size == _holders.value.size) return
        _holders.value = after
        if (after.isEmpty()) { stopEngine(); foreground.stop() }
    }

    fun releaseAll() {
        dictateJob?.cancel(); dictateJob = null
        _holders.value = emptySet()
        stopEngine()
        foreground.stop()
    }

    private fun startEngine() {
        ensureCollector()
        scope.launch {
            if (!voice.ensureMic()) { _problem.value = "Microphone permission is off."; return@launch }
            refreshAvailable()
            if (!_available.value) { _problem.value = "The speech model isn't installed (Settings → Voice listening → Engine)."; return@launch }
            _problem.value = null
            if (!engine.start(voice.engineOptions())) _problem.value = (engine.state.value as? VoiceEngineState.Failed)?.message ?: "The voice engine didn't start."
        }
    }

    private fun stopEngine() { runCatching { engine.stop() }; _partial.value = "" }

    /** One collector for the engine's results, outside dictation (dictation has its own stream). */
    private fun ensureCollector() {
        if (collector?.isActive == true) return
        collector = scope.launch {
            engine.results.collect { r ->
                if (dictateJob != null) return@collect
                if (!r.final) { _partial.value = r.text; return@collect }
                _partial.value = ""
                if (r.text.isBlank()) return@collect
                _lastHeard.value = r
                val host = router
                if (host != null) host.route(r)
                else if (VoiceSensitivity.passes(r, voice.sensitivity)) onFinal?.invoke(r.text)
            }
        }
    }

    // ---------------------------------------------------------------- dictation

    private fun beginDictation() {
        if (!_available.value) refreshAvailable()
        if (!_available.value || dictateJob != null) return
        val c = controller ?: return
        _holders.value = _holders.value + HOLD_DICTATION
        foreground.start()
        dictateJob = scope.launch {
            try {
                voice.dictate(voice.endPhrases + c.endPhrases).collect { e ->
                    when (e) {
                        is DictationEvent.Partial -> _partial.value = e.preview
                        is DictationEvent.Segment -> if (!speaking()) { _lastHeard.value = VoiceResult(e.text, e.confidence, true); c.heard(e.text) }
                        is DictationEvent.Dropped -> {}
                        is DictationEvent.Ended -> when (e.reason) {
                            DictationEndReason.END_PHRASE -> c.finishDictation()
                            DictationEndReason.FAILED -> _problem.value = e.message ?: "Dictation stopped."
                        }
                    }
                }
            } finally {
                _partial.value = ""
                dictateJob = null
                afterDictation()
            }
        }
    }

    private fun endDictation() { dictateJob?.cancel() }

    private fun afterDictation() {
        val left = _holders.value - HOLD_DICTATION
        _holders.value = left
        if (left.isEmpty()) foreground.stop() else startEngine()
    }

    companion object {
        const val HOLD_CAPTURE: String = "capture"
        const val HOLD_HANDS_FREE: String = "hands-free"
        const val HOLD_DICTATION: String = "dictation"
    }
}
