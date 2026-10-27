package ai.amberx.axf.axnotes.plugins.aichat

import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerSource
import ai.amberx.axf.kernel.triggers.TriggerKinds
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * ai-chat, pure part (no Android, no coroutines): the chat transcript reducer over live-session@1 events, read-aloud
 * text, reply → note drafts and the plugin's voice triggers as triggers@1 data. Unit-tested in src/test.
 */

enum class Role { USER, ASSISTANT, SYSTEM }

enum class InputMode { TEXT, VOICE }

data class ChatMessage(
    val id: String,
    val role: Role,
    val text: String,
    val at: Long,
    /** an assistant reply still arriving */
    val streaming: Boolean = false,
    val error: String? = null,
    /** when the reply was saved as a note */
    val savedAt: Long? = null,
)

data class ChatState(
    val sessionId: String? = null,
    val messages: List<ChatMessage> = emptyList(),
    val busy: Boolean = false,
    val status: String = "",
    /** last live-session seq folded in (replays skip what is already here) */
    val lastSeq: Long = 0,
    val input: InputMode = InputMode.TEXT,
    val readAloud: Boolean = false,
) {
    val streamingReply: ChatMessage? get() = messages.lastOrNull { it.role == Role.ASSISTANT && it.streaming }
    val lastReply: ChatMessage? get() = messages.lastOrNull { it.role == Role.ASSISTANT && !it.streaming && it.error == null && it.text.isNotBlank() }
}

sealed class ChatEvent {
    data class Sent(val id: String, val text: String, val at: Long) : ChatEvent()
    data class Opened(val sessionId: String) : ChatEvent()
    data class Stream(val event: LiveEvent) : ChatEvent()
    data class Stopped(val at: Long) : ChatEvent()
    data class Failed(val message: String, val at: Long) : ChatEvent()
    object Cleared : ChatEvent()
    data class Input(val mode: InputMode) : ChatEvent()
    data class ReadAloud(val on: Boolean) : ChatEvent()
    data class Saved(val messageId: String, val at: Long) : ChatEvent()
}

/** New state, plus text to read aloud when a reply just finished and read-aloud is on. */
data class ChatStep(val state: ChatState, val speak: String? = null)

object ChatReducer {
    const val MAX_MESSAGES: Int = 200
    const val THINKING: String = "Thinking…"

    fun reduce(s: ChatState, e: ChatEvent): ChatStep = when (e) {
        is ChatEvent.Sent -> {
            val text = e.text.trim()
            if (text.isEmpty()) ChatStep(s)
            else ChatStep(s.copy(
                messages = cap(finishAll(s.messages) + ChatMessage(e.id, Role.USER, text, e.at) + ChatMessage(e.id + "-r", Role.ASSISTANT, "", e.at, streaming = true)),
                busy = true, status = THINKING,
            ))
        }
        is ChatEvent.Opened -> ChatStep(s.copy(sessionId = e.sessionId))
        is ChatEvent.Stream -> stream(s, e.event)
        is ChatEvent.Stopped -> ChatStep(s.copy(messages = finishAll(s.messages, dropEmpty = true), busy = false, status = ""))
        is ChatEvent.Failed -> {
            val r = s.streamingReply
            val msgs = if (r != null) s.messages.map { if (it.id == r.id) it.copy(streaming = false, error = e.message) else it }
            else s.messages + ChatMessage("err-${e.at}", Role.SYSTEM, "", e.at, error = e.message)
            ChatStep(s.copy(messages = cap(msgs), busy = false, status = ""))
        }
        is ChatEvent.Cleared -> ChatStep(ChatState(input = s.input, readAloud = s.readAloud))
        is ChatEvent.Input -> ChatStep(s.copy(input = e.mode))
        is ChatEvent.ReadAloud -> ChatStep(s.copy(readAloud = e.on))
        is ChatEvent.Saved -> ChatStep(s.copy(messages = s.messages.map { if (it.id == e.messageId) it.copy(savedAt = e.at) else it }))
    }

    private fun stream(s: ChatState, ev: LiveEvent): ChatStep {
        if (ev.seq in 1..s.lastSeq) return ChatStep(s) // replayed: already folded in
        val seq = maxOf(s.lastSeq, ev.seq)
        val data = ev.data as? JsonObject
        val text = (data?.get("text") as? JsonPrimitive)?.takeIf { it.isString }?.content
        return when (ev.kind) {
            "text" -> {
                val r = s.streamingReply
                val msgs = if (r != null) s.messages.map { if (it.id == r.id) it.copy(text = it.text + (text ?: "")) else it }
                else s.messages + ChatMessage("r-${ev.seq}", Role.ASSISTANT, text ?: "", ev.at, streaming = true)
                ChatStep(s.copy(messages = cap(msgs), lastSeq = seq, busy = true, status = ""))
            }
            "status" -> ChatStep(s.copy(status = text ?: "", lastSeq = seq))
            "error" -> {
                val msg = (data?.get("message") as? JsonPrimitive)?.content ?: text ?: "The assistant reported an error"
                reduce(s.copy(lastSeq = seq), ChatEvent.Failed(msg, ev.at))
            }
            LiveKinds.TURN_START -> {
                val msgs = if (s.streamingReply != null) s.messages else s.messages + ChatMessage("r-${ev.seq}", Role.ASSISTANT, "", ev.at, streaming = true)
                ChatStep(s.copy(messages = cap(msgs), lastSeq = seq, busy = true, status = THINKING))
            }
            LiveKinds.TURN_END, LiveKinds.INTERRUPTED, "done" -> {
                val r = s.streamingReply
                val next = s.copy(messages = finishAll(s.messages, dropEmpty = true), lastSeq = seq, busy = false, status = if (ev.kind == LiveKinds.INTERRUPTED) "Interrupted" else "")
                val say = if (s.readAloud && r != null && r.text.isNotBlank()) ReadAloud.speakable(r.text).ifEmpty { null } else null
                ChatStep(next, say)
            }
            LiveKinds.WAIT -> ChatStep(s.copy(status = "Waiting for you", lastSeq = seq))
            LiveKinds.CLOSE -> ChatStep(s.copy(sessionId = null, messages = finishAll(s.messages, dropEmpty = true), busy = false, status = "", lastSeq = 0))
            else -> ChatStep(s.copy(lastSeq = seq))
        }
    }

    private fun finishAll(msgs: List<ChatMessage>, dropEmpty: Boolean = false): List<ChatMessage> =
        msgs.mapNotNull { m -> if (!m.streaming) m else if (dropEmpty && m.text.isBlank()) null else m.copy(streaming = false) }

    private fun cap(msgs: List<ChatMessage>): List<ChatMessage> = if (msgs.size <= MAX_MESSAGES) msgs else msgs.takeLast(MAX_MESSAGES)
}

/** Markdown → something a speech engine can say. */
object ReadAloud {
    const val MAX_CHARS: Int = 1500
    private val fence = Regex("```[\\s\\S]*?(```|$)")
    private val link = Regex("\\[([^\\]]*)]\\([^)]*\\)")
    private val bareUrl = Regex("https?://\\S+")
    private val heading = Regex("(?m)^[ \\t]{0,3}#{1,6}[ \\t]*")
    private val bullet = Regex("(?m)^[ \\t]*([-*+]|\\d+[.)])[ \\t]+")
    private val marks = Regex("[*_`~>|]+")
    private val spaces = Regex("[ \\t]+")
    private val blank = Regex("\\n\\s*\\n+")

    fun speakable(markdown: String): String {
        var t = markdown.replace(fence, " (code omitted) ")
        t = t.replace(link, "$1").replace(bareUrl, "a link").replace(heading, "").replace(bullet, "").replace(marks, "")
        t = t.replace(blank, ". ").replace('\n', ' ').replace(spaces, " ").replace(Regex("\\.\\s*\\.+"), ".").trim()
        if (t.length <= MAX_CHARS) return t
        val cut = t.substring(0, MAX_CHARS)
        val end = maxOf(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "))
        return (if (end > MAX_CHARS / 2) cut.substring(0, end + 1) else cut).trim() + " … The rest is on screen."
    }
}

/** A reply as a note draft: the JSON the app's `axnotes.notes.save` action takes. */
object ReplyNotes {
    val TAGS: List<String> = listOf("claude", "ai-chat")

    /** The user message right before [replyId], if any. */
    fun questionFor(messages: List<ChatMessage>, replyId: String): String? {
        val i = messages.indexOfFirst { it.id == replyId }
        if (i <= 0) return null
        return messages.subList(0, i).lastOrNull { it.role == Role.USER }?.text
    }

    fun draft(question: String?, reply: String): JsonObject {
        val q = question?.trim()?.takeIf { it.isNotEmpty() }
        val head = (q ?: reply).lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: "Claude"
        val title = "Claude: " + (if (head.length > 60) head.take(59).trimEnd() + "…" else head)
        val text = if (q != null) "Q: $q\n\n${reply.trim()}" else reply.trim()
        return JsonObject(linkedMapOf(
            "title" to JsonPrimitive(title), "text" to JsonPrimitive(text),
            "tags" to JsonArray(TAGS.map { JsonPrimitive(it) }), "source" to JsonPrimitive("ai"),
        ))
    }
}

/** The plugin's voice triggers (triggers@1 data). "stop" alone only works while the chat is the trigger context. */
object ChatTriggers {
    const val CONTEXT: String = "ai-chat"
    const val ACTION_OPEN: String = "ai-chat.open"
    const val ACTION_ASK: String = "ai-chat.ask"
    const val ACTION_SAY: String = "ai-chat.say"
    const val ACTION_STOP: String = "ai-chat.stop"
    const val ACTION_SAVE: String = "ai-chat.save"

    fun all(module: String): List<Trigger> = listOf(
        Trigger("ai-chat.ask", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Ask Claude", listOf("ask claude <text>", "hey claude <text>", "ask the assistant <text>"), ACTION_ASK),
        Trigger("ai-chat.mode", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Chat mode", listOf("chat mode", "start chat", "talk to claude"), ACTION_OPEN, args = JsonObject(mapOf("voice" to JsonPrimitive(true)))),
        Trigger("ai-chat.stop", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Stop the reply", listOf("stop", "stop talking", "be quiet"), ACTION_STOP, worksIn = listOf(CONTEXT)),
        Trigger("ai-chat.stop-anywhere", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Stop Claude", listOf("stop claude", "end chat"), ACTION_STOP, args = JsonObject(mapOf("close" to JsonPrimitive(true)))),
        Trigger("ai-chat.save", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Save the reply as a note", listOf("save that reply", "save reply as note"), ACTION_SAVE, worksIn = listOf(CONTEXT)),
    )

    /** `{text}` / `{prompt}` from a trigger's args payload. */
    fun textArg(args: JsonObject?): String? =
        listOf("text", "prompt").firstNotNullOfOrNull { k -> (args?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.takeIf { it.isNotEmpty() } }

    fun flag(args: JsonObject?, key: String): Boolean = (args?.get(key) as? JsonPrimitive)?.content == "true"
}
