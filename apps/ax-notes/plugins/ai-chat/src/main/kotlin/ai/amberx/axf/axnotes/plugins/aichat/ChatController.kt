package ai.amberx.axf.axnotes.plugins.aichat

import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.speech.SpeakOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Runs the chat: one ai.chat session on the AI session host (axHub), replies streamed in through `attach`, folded by
 * [ChatReducer]. Read-aloud goes through the speech@1 provider. Everything stays usable (with a clear message) when the
 * host, the speech provider or the app's note action is missing.
 */
internal class ChatController(private val host: PluginHost, private val scope: CoroutineScope, private val clock: () -> Long = System::currentTimeMillis) {
    private val _state = MutableStateFlow(ChatState(readAloud = host.setting(KEY_READ_ALOUD, false)))
    val state: StateFlow<ChatState> = _state.asStateFlow()
    private var attachJob: Job? = null
    private var counter = 0

    fun canSaveNotes(): Boolean = host.canSaveNotes()

    private fun apply(e: ChatEvent) {
        val step = synchronized(this) { ChatReducer.reduce(_state.value, e).also { _state.value = it.state } }
        step.speak?.let { say -> scope.launch { host.speech().speak(say, SpeakOptions(interrupt = true)) } }
    }

    fun setReadAloud(on: Boolean) { host.setSetting(KEY_READ_ALOUD, on); apply(ChatEvent.ReadAloud(on)); if (!on) scope.launch { host.speech().stop() } }
    fun setInput(mode: InputMode) = apply(ChatEvent.Input(mode))

    /** Sends a prompt: opens the session on first use, then adds turns to it. */
    fun send(prompt: String, context: ChatContext? = null) {
        val text = prompt.trim()
        if (text.isEmpty() || _state.value.busy) return
        val now = clock()
        // settings load after modules register: re-read the saved read-aloud choice on every turn
        host.setting(KEY_READ_ALOUD, _state.value.readAloud).let { if (it != _state.value.readAloud) apply(ChatEvent.ReadAloud(it)) }
        apply(ChatEvent.Sent("m-${now.toString(36)}-${counter++}", text, now))
        scope.launch {
            val ai = host.ai()
            if (!ai.available()) { apply(ChatEvent.Failed("The assistant isn't connected. Set up AI (axHub) in Settings, then try again.", clock())); return@launch }
            val sid = _state.value.sessionId
            val r: AxfResult<*> = if (sid != null) ai.send(sid, text, context) else open(text, context)
            r.onErr { apply(ChatEvent.Failed(message(it), clock())) }
        }
    }

    private suspend fun open(prompt: String, context: ChatContext?): AxfResult<Unit> {
        val built = AiModes.buildRequest(host.modes(), host.policy(), emptyList(), AiRequestInput(prompt, context, requested = AiModes.CHAT, title = prompt))
        val req = built.request ?: return AxfResult.err(AxfFailure.Denied("ai.chat", "Your role can't use the assistant."))
        val info = host.ai().start(req)
        return info.map { s -> apply(ChatEvent.Opened(s.id)); follow(s.id) }
    }

    /** Streams the session's events in until detached (detaching never ends the session). */
    private fun follow(id: String) {
        attachJob?.cancel()
        attachJob = scope.launch {
            host.ai().attach(id, _state.value.lastSeq, { ev -> apply(ChatEvent.Stream(ev)) }, { replay -> replay.events.forEach { apply(ChatEvent.Stream(it)) } })
                .onErr { apply(ChatEvent.Failed(message(it), clock())) }
        }
    }

    /** Stops the running reply (and any read-aloud); [close] also ends the session. */
    fun stop(close: Boolean = false) {
        val sid = _state.value.sessionId
        scope.launch {
            host.speech().stop()
            if (sid != null) { host.ai().stop(sid); if (close) host.ai().close(sid) }
        }
        if (close) { attachJob?.cancel(); attachJob = null }
        apply(ChatEvent.Stopped(clock()))
        if (close) apply(ChatEvent.Cleared)
    }

    fun clear() = stop(close = true)

    /** Saves a reply (default: the last one) as a note through the app. */
    fun save(replyId: String? = null): Boolean {
        val s = _state.value
        val reply = (replyId?.let { id -> s.messages.firstOrNull { it.id == id } } ?: s.lastReply) ?: return false
        if (reply.text.isBlank()) return false
        val ok = host.saveNote(ReplyNotes.draft(ReplyNotes.questionFor(s.messages, reply.id), reply.text))
        if (ok) apply(ChatEvent.Saved(reply.id, clock()))
        return ok
    }

    fun speak(text: String) { scope.launch { host.speech().speak(ReadAloud.speakable(text), SpeakOptions(interrupt = true)) } }

    fun detach() { attachJob?.cancel(); attachJob = null }

    private fun message(f: AxfFailure): String = when (f) {
        is AxfFailure.NotImplemented -> "The assistant isn't set up in this app yet (${f.capability})."
        is AxfFailure.Denied -> f.message
        else -> f.message
    }

    companion object {
        const val KEY_READ_ALOUD: String = "readAloud"
    }
}
