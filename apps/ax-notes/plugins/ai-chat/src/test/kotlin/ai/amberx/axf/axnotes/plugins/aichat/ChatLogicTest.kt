package ai.amberx.axf.axnotes.plugins.aichat

import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.triggers.MatchEnv
import ai.amberx.axf.kernel.triggers.Observation
import ai.amberx.axf.kernel.triggers.TriggerMatcher
import ai.amberx.axf.kernel.triggers.TriggerValidation
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatLogicTest {
    private fun text(seq: Long, t: String) = ChatEvent.Stream(LiveEvent(seq, seq, "text", JsonObject(mapOf("text" to JsonPrimitive(t)))))
    private fun kind(seq: Long, k: String) = ChatEvent.Stream(LiveEvent(seq, seq, k))
    private fun run(s: ChatState, vararg es: ChatEvent): ChatStep { var step = ChatStep(s); for (e in es) step = ChatReducer.reduce(step.state, e); return step }

    @Test fun streamsAReplyIntoOneMessage() {
        val s = run(ChatState(), ChatEvent.Sent("m1", "  hello  ", 1), ChatEvent.Opened("s1"), kind(1, LiveKinds.TURN_START), text(2, "Hi "), text(3, "there")).state
        assertEquals("s1", s.sessionId)
        assertEquals(listOf(Role.USER, Role.ASSISTANT), s.messages.map { it.role })
        assertEquals("hello", s.messages[0].text)
        assertEquals("Hi there", s.messages[1].text)
        assertTrue(s.busy && s.messages[1].streaming)
        val done = run(s, kind(4, LiveKinds.TURN_END)).state
        assertFalse(done.busy)
        assertEquals("Hi there", done.lastReply?.text)
    }

    @Test fun replayedEventsAreNotFoldedTwice() {
        val s = run(ChatState(), ChatEvent.Sent("m1", "q", 1), text(5, "A"), text(5, "A"), text(4, "B")).state
        assertEquals("A", s.messages.last().text)
        assertEquals(5, s.lastSeq)
    }

    @Test fun readAloudOnlyWhenOnAndAReplyFinished() {
        val off = run(ChatState(), ChatEvent.Sent("m", "q", 1), text(1, "**Yes**, see [docs](http://x)"), kind(2, LiveKinds.TURN_END))
        assertNull(off.speak)
        val on = run(ChatState(readAloud = true), ChatEvent.Sent("m", "q", 1), text(1, "**Yes**, see [docs](http://x)"), kind(2, LiveKinds.TURN_END))
        assertEquals("Yes, see docs", on.speak)
    }

    @Test fun stopKeepsPartialTextAndDropsEmptyPlaceholder() {
        val partial = run(ChatState(), ChatEvent.Sent("m", "q", 1), text(1, "half"), ChatEvent.Stopped(2)).state
        assertEquals("half", partial.messages.last().text)
        assertFalse(partial.busy)
        val empty = run(ChatState(), ChatEvent.Sent("m", "q", 1), ChatEvent.Stopped(2)).state
        assertEquals(1, empty.messages.size)
    }

    @Test fun errorsLandOnTheReply() {
        val s = run(ChatState(), ChatEvent.Sent("m", "q", 1), ChatEvent.Stream(LiveEvent(1, 1, "error", JsonObject(mapOf("message" to JsonPrimitive("quota")))))).state
        assertEquals("quota", s.messages.last().error)
        assertFalse(s.busy)
        val noReply = ChatReducer.reduce(ChatState(), ChatEvent.Failed("offline", 3)).state
        assertEquals(Role.SYSTEM, noReply.messages.single().role)
    }

    @Test fun closeAndClearForgetTheSession() {
        val s = run(ChatState(readAloud = true), ChatEvent.Sent("m", "q", 1), ChatEvent.Opened("s1"), text(1, "a"), kind(2, LiveKinds.CLOSE)).state
        assertNull(s.sessionId)
        val cleared = ChatReducer.reduce(s, ChatEvent.Cleared).state
        assertTrue(cleared.messages.isEmpty() && cleared.readAloud)
    }

    @Test fun blankPromptsAreIgnoredAndHistoryIsCapped() {
        assertTrue(ChatReducer.reduce(ChatState(), ChatEvent.Sent("m", "   ", 1)).state.messages.isEmpty())
        var s = ChatState()
        repeat(150) { s = run(s, ChatEvent.Sent("m$it", "q$it", it.toLong()), ChatEvent.Stopped(it.toLong())).state }
        assertEquals(ChatReducer.MAX_MESSAGES, s.messages.size + 50) // 150 prompts, every empty reply dropped → 150 kept
        repeat(100) { s = run(s, ChatEvent.Sent("n$it", "q", 1), text(1000L + 2 * it, "r"), kind(1001L + 2 * it, LiveKinds.TURN_END)).state }
        assertEquals(ChatReducer.MAX_MESSAGES, s.messages.size)
    }

    @Test fun speakableStripsMarkdownAndCode() {
        assertEquals("Title. Do this. (code omitted) then go", ReadAloud.speakable("# Title\n\n- Do this.\n\n```kotlin\nval x = 1\n```\nthen `go`"))
        assertEquals("open a link now", ReadAloud.speakable("open https://example.com now"))
        val long = ReadAloud.speakable("Sentence one. ".repeat(200))
        assertTrue(long.length <= ReadAloud.MAX_CHARS + 40 && long.endsWith("The rest is on screen."))
    }

    @Test fun replyNotesCarryTheQuestion() {
        val msgs = listOf(ChatMessage("u", Role.USER, "What is AXF?", 1), ChatMessage("r", Role.ASSISTANT, "A framework.", 2))
        assertEquals("What is AXF?", ReplyNotes.questionFor(msgs, "r"))
        val d = ReplyNotes.draft("What is AXF?", "A framework.")
        assertEquals("Claude: What is AXF?", (d["title"] as JsonPrimitive).content)
        assertEquals("Q: What is AXF?\n\nA framework.", (d["text"] as JsonPrimitive).content)
        assertEquals("ai", (d["source"] as JsonPrimitive).content)
        assertTrue((ReplyNotes.draft(null, "x".repeat(100))["title"] as JsonPrimitive).content.endsWith("…"))
    }

    @Test fun triggersAreValidDataAndMatch() {
        val ts = ChatTriggers.all(AiChatPlugin.ID)
        for (t in ts) assertTrue(t.id, TriggerValidation.validate(t.toJson()).ok)
        val ask = TriggerMatcher.match(ts, Observation("voice", 10_000, listOf("ask Claude what's on my list")), MatchEnv("home"))
        assertEquals(ChatTriggers.ACTION_ASK, ask.fired?.action)
        assertEquals("what s on my list", ChatTriggers.textArg(ask.fired?.args))
        assertNull(TriggerMatcher.match(ts, Observation("voice", 10_000, listOf("stop")), MatchEnv("home")).fired)
        assertEquals(ChatTriggers.ACTION_STOP, TriggerMatcher.match(ts, Observation("voice", 10_000, listOf("stop")), MatchEnv(ChatTriggers.CONTEXT)).fired?.action)
        assertTrue(ChatTriggers.flag(TriggerMatcher.match(ts, Observation("voice", 10_000, listOf("chat mode")), MatchEnv("home")).fired?.args, "voice"))
    }

    @Test fun policyGivesChatToEveryoneAndEverythingToAdmins() {
        val user = Policies.fromPermissions(setOf("notes.read"))
        assertFalse(user.admin)
        assertTrue(AiModes.allowed(AiModes.BUILTINS.first { it.id == AiModes.CHAT }, user))
        assertFalse(AiModes.allowed(AiModes.BUILTINS.first { it.id == AiModes.BUILD_REQUEST }, user))
        assertTrue(Policies.fromPermissions(setOf("*")).admin)
        assertEquals(listOf(AiModes.CHAT, "ai.read-codebase"), Policies.fromPermissions(setOf("ai.mode.ai.read-codebase")).allowedModes)
    }
}
