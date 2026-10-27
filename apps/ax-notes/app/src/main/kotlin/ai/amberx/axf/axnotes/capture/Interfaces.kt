package ai.amberx.axf.axnotes.capture

import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.TriggerDef
import ai.amberx.axf.axnotes.model.TriggerHit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/*
 * App-local seams. AX Notes codes against these small interfaces only; the parent build session wires each one to the
 * framework library being built alongside (ax-notes steps s4–s10). Until then the placeholders below keep the app
 * fully usable by hand (typed "what you'd say" box, notes on screen instead of spoken).
 */

/**
 * Speech to text, continuous: [start] keeps listening and hands every final chunk to `onFinal` until [stop].
 *
 * TODO(lib-voice, step s6: VoiceEngine + Vosk default + dictation stream): back this with lib-voice's dictation stream
 * (sensitivity, echo cancellation, arming phrase); [partial] = its live partial results.
 */
interface NoteCapture {
    val available: StateFlow<Boolean>
    val listening: StateFlow<Boolean>
    /** Words heard so far in the current utterance (live preview only). */
    val partial: StateFlow<String>
    fun start(onFinal: (String) -> Unit)
    fun stop()
}

/**
 * Text to speech for read-backs and confirmations.
 *
 * TODO(lib-speech, step s8: SpeechProvider + Android TTS default, speech@1): back this with lib-speech's playback queue
 * (pause / skip / faster / slower / repeat become triggers there).
 */
interface Speaker {
    /** The last thing said (screens show it, so the placeholder is still useful). */
    val said: StateFlow<String?>
    fun speak(text: String)
    fun stop()
}

/**
 * Where the app's voice triggers are registered so they're heard outside the capture screen too (background,
 * overlay). The app passes its trigger data in; a hit comes back through `onHit`.
 *
 * TODO(lib-triggers + kernel triggers@1, steps s4/s7): register these as triggers@1 records (permanent, phrases
 * user-replaceable, per-trigger threshold, works-in context) through the shared registry; lib-overlay (s2/s3) shows hits.
 */
interface TriggerSink {
    fun register(defs: List<TriggerDef>, onHit: (TriggerHit) -> Unit)
    fun unregister()
}

/**
 * AI help: "summarize <category>" (and later note-sorter). Null answer = use the local fallback.
 *
 * TODO(lib-ai, steps s5/s10: mode registry + always-live axHub client on assistant@1 / live-session@1, UAC gating):
 * back this with a lib-ai mode; plugin note-sorter (s14) adds categorize / title / action items.
 */
interface NoteAi {
    val available: Boolean
    suspend fun summarize(label: String, notes: List<Note>): String?
}

// ---------------------------------------------------------------- placeholders (until the libraries are wired)

/** No speech engine yet: the capture screen offers a typed box that goes through the same flow. */
class NoCapture : NoteCapture {
    override val available: StateFlow<Boolean> = MutableStateFlow(false).asStateFlow()
    override val listening: StateFlow<Boolean> = MutableStateFlow(false).asStateFlow()
    override val partial: StateFlow<String> = MutableStateFlow("").asStateFlow()
    override fun start(onFinal: (String) -> Unit) {}
    override fun stop() {}
}

/** Keeps what would be said so the screens can show it. */
class ScreenSpeaker : Speaker {
    private val _said = MutableStateFlow<String?>(null)
    override val said: StateFlow<String?> = _said.asStateFlow()
    override fun speak(text: String) { _said.value = text }
    override fun stop() {}
}

/** Nothing registered outside the app; the capture screen matches what it hears itself. */
class LocalTriggerSink : TriggerSink {
    var defs: List<TriggerDef> = emptyList()
        private set
    override fun register(defs: List<TriggerDef>, onHit: (TriggerHit) -> Unit) { this.defs = defs }
    override fun unregister() { defs = emptyList() }
}

class NoAi : NoteAi {
    override val available: Boolean = false
    override suspend fun summarize(label: String, notes: List<Note>): String? = null
}
