package ai.amberx.axf.axnotes.capture

import ai.amberx.axf.ai.AiService
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.TriggerDef
import ai.amberx.axf.axnotes.model.TriggerHit
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.speech.AxfSpeech
import ai.amberx.axf.triggers.AxfTriggers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/*
 * The app-local seams (Interfaces.kt) on the framework libraries. AppModule picks these when the library's service is
 * registered and falls back to the stand-ins in Interfaces.kt when it isn't, so the app runs with any of them missing.
 * NoteCapture → VoiceLoop.kt (lib-voice).
 */

/** [Speaker] on lib-speech (speech@1): read-backs and confirmations queue on the SpeechPlayer and obey Settings → Speech → Read aloud. */
class SpeechSpeaker(private val speech: AxfSpeech) : Speaker {
    private val _said = MutableStateFlow<String?>(null)
    override val said: StateFlow<String?> = _said.asStateFlow()
    /** Something is being (or about to be) spoken; the voice loop drops dictated words meanwhile. */
    val speaking: Boolean get() = speech.player.active
    override fun speak(text: String) { _said.value = text; runCatching { speech.read(text) } }
    override fun stop() { runCatching { speech.player.stop() } }
}

/**
 * [TriggerSink] on lib-triggers (triggers@1): the app's trigger data becomes permanent triggers in the trigger store
 * (user overrides for phrases' threshold, context and on/off persist there; the store mirrors them into the kernel
 * TriggerRegistry the voice bridge matches against). A fired AX Notes command comes back through [deliver].
 */
class StoreTriggerSink(private val triggers: AxfTriggers, private val module: String) : TriggerSink {
    private var defs: List<TriggerDef> = emptyList()
    private var onHit: ((TriggerHit) -> Unit)? = null

    override fun register(defs: List<TriggerDef>, onHit: (TriggerHit) -> Unit) {
        this.defs = defs
        this.onHit = onHit
        triggers.store.registerPermanent(module, TriggerData.toTriggers(defs, module))
        triggers.registerContext(CONTEXT_ANY_SCREEN, "AX Notes (any screen)")
    }

    override fun unregister() {
        triggers.store.unregisterPermanent(module)
        defs = emptyList(); onHit = null
    }

    /** True when [cmd] was one of the app's triggers (and was handed to the controller). */
    fun deliver(cmd: TriggerCommand): Boolean {
        if (cmd.action != TriggerData.ACTION) return false
        val hit = TriggerData.hit(cmd, defs) ?: return false
        onHit?.invoke(hit)
        return true
    }

    companion object { const val CONTEXT_ANY_SCREEN: String = "axnotes" }
}

/**
 * [NoteAi] on lib-ai (ai-modes@1): summaries run in mode `ai.chat` (what every hub account may use) in one live session
 * on axHub that the app keeps reusing (its id in the KV store; the session lives on the hub, the app only follows it).
 * The last reply is kept for the overlay's mini screen.
 */
class HubNoteAi(private val ai: AiService, private val kv: KeyValueStore?) : NoteAi {
    private val _reply = MutableStateFlow<String?>(null)
    val reply: StateFlow<String?> = _reply.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    override val available: Boolean get() = runCatching { ai.installed && ai.canUse(AiModes.CHAT) }.getOrDefault(false)

    override suspend fun summarize(label: String, notes: List<Note>): String? {
        val prompt = buildString {
            append("Summarize these notes (\"").append(label).append("\") in a few short sentences that read well aloud. ")
            append("Mention anything that looks like a to-do.\n\n")
            for (n in notes.sortedBy { it.createdAt }.takeLast(MAX_NOTES)) append("- ").append(n.title).append(": ").append(n.text.take(MAX_NOTE_CHARS)).append('\n')
        }
        return ask(prompt, label)
    }

    /** One turn in the app's session; null when the hub can't answer (signed out, offline, no rights). */
    suspend fun ask(prompt: String, title: String = "AX Notes"): String? {
        _busy.value = true
        try {
            val input = AiRequestInput(prompt, ChatContext(view = "ax-notes", title = title), requested = AiModes.CHAT, override = AiModes.CHAT, title = "AX Notes")
            val known = kv?.get(KEY_SESSION)
            val id = if (known != null && ai.send(known, input).isOk) known
                else ai.start(input).getOrNull()?.session?.id?.also { kv?.put(KEY_SESSION, it) } ?: return null
            val done = withTimeoutOrNull(TIMEOUT_MS) { ai.replies(id).first { it.finished || it.error.isNotEmpty() || it.done } } ?: return null
            val text = done.text.takeIf { done.error.isEmpty() && it.isNotBlank() } ?: return null
            _reply.value = text
            return text
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            return null
        } finally {
            _busy.value = false
        }
    }

    companion object {
        const val KEY_SESSION: String = "axnotes.ai.session"
        const val TIMEOUT_MS: Long = 90_000
        const val MAX_NOTES: Int = 60
        const val MAX_NOTE_CHARS: Int = 600
    }
}
