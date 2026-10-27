package ai.amberx.axf.axnotes.capture

import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.TriggerDef
import ai.amberx.axf.axnotes.model.TriggerHit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/*
 * App-local seams. AX Notes codes against these small interfaces only. Since build step s13 each one runs on its library
 * when that library's module is installed (AppModule picks): NoteCapture → VoiceLoop (lib-voice), Speaker → SpeechSpeaker
 * (lib-speech), TriggerSink → StoreTriggerSink (lib-triggers + the kernel TriggerRegistry), NoteAi → HubNoteAi (lib-ai).
 * The stand-ins below stay as the fallbacks: without a library the app is still fully usable by hand (typed "what
 * you'd say" box, notes on screen instead of spoken).
 */

/**
 * Speech to text, continuous: [start] keeps listening and hands every final chunk to `onFinal` until [stop].
 *
 * Library-backed: VoiceLoop (lib-voice engine + dictate stream, MicService for the background).
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
 * Library-backed: SpeechSpeaker (lib-speech's reading queue; pause / skip / faster … are speech@1 triggers).
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
 * Library-backed: StoreTriggerSink (permanent triggers@1 records in lib-triggers' store, matched by its voice bridge;
 * the log goes to lib-overlay's pill).
 */
interface TriggerSink {
    fun register(defs: List<TriggerDef>, onHit: (TriggerHit) -> Unit)
    fun unregister()
}

/**
 * AI help: "summarize <category>" (and later note-sorter). Null answer = use the local fallback.
 *
 * Library-backed: HubNoteAi (lib-ai, mode ai.chat in a live session on axHub); plugin note-sorter adds categorize /
 * title / action items through its own hooks.
 */
interface NoteAi {
    val available: Boolean
    suspend fun summarize(label: String, notes: List<Note>): String?
}

// ---------------------------------------------------------------- stand-ins (used when a library isn't installed)

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
