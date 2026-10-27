package ai.amberx.axf.ai

import ai.amberx.axf.kernel.ai.AiSessionRequest
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.result.AxfFailure
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiWireTest {
    private val req = AiSessionRequest("ai.read-codebase", "assistant.read", "read it", "m-fast", true, false, "read it", ChatContext(view = "notes", extra = JsonObject(mapOf("appId" to JsonPrimitive("ax-notes")))), "notes.read")

    @Test fun paths() {
        assertEquals("/api/plugins/ai-assistant/sessions/c1/events?since=7&follow=1", AiWire.events("c1", 7, true))
        assertEquals("/api/plugins/ai-assistant/sessions/c1/events?since=0&follow=0&limit=2000", AiWire.events("c1", -3, false, 9999))
        assertEquals("/x/conversations/c1/messages", AiWire.messages("c1", "/x"))
        assertTrue(AiWire.isSessionId("c_abc-1"))
        assertFalse(AiWire.isSessionId("../etc"))
        assertFalse(AiWire.isSessionId("a/b"))
        assertFalse(AiWire.isSessionId(""))
    }

    @Test fun bodies() {
        val conv = AiWire.parseObject(AiWire.conversationBody(req))!!
        assertEquals("read it", (conv["title"] as JsonPrimitive).content)
        assertEquals("m-fast", ((conv["settings"] as JsonObject)["model"] as JsonPrimitive).content)
        val turn = AiWire.parseObject(AiWire.turnBody("read it", req.context, req))!!
        assertEquals("read it", (turn["content"] as JsonPrimitive).content)
        assertEquals("ai.read-codebase", (turn["mode"] as JsonPrimitive).content)
        assertEquals("true", (turn["readOnly"] as JsonPrimitive).content)
        val extra = (turn["context"] as JsonObject)["extra"] as JsonObject
        assertEquals("ai.read-codebase", (extra["aiMode"] as JsonPrimitive).content)
        assertEquals("ax-notes", (extra["appId"] as JsonPrimitive).content)
        assertEquals("notes.read", (extra["triggerId"] as JsonPrimitive).content)
        val plain = AiWire.parseObject(AiWire.turnBody("hi", null))!!
        assertNull(plain["mode"])
        assertNull(AiWire.parseObject(AiWire.conversationBody(req.copy(model = "")))!!["settings"])
    }

    @Test fun parsing() {
        val info = AiWire.sessionInfo(AiWire.parseObject("""{"id":"c1","kind":"assistant.chat","title":"T","state":"running","host":"local","createdAt":1,"updatedAt":2,"lastSeq":9,"viewers":1,"meta":{"owner":"bea","turnSeq":4}}"""), "axhub")!!
        assertEquals(LiveState.RUNNING, info.state)
        assertEquals("axhub", info.host)
        assertEquals("local", info.meta["via"])
        assertEquals("4", info.meta["turnSeq"])
        assertEquals(9L, info.lastSeq)
        assertNull(AiWire.sessionInfo(AiWire.parseObject("""{"id":"../x"}"""), "axhub"))
        val page = AiWire.replayPage(AiWire.parseObject("""{"events":[{"seq":3,"at":5,"kind":"text","data":{"text":"a"}},{"seq":0,"kind":"bad"}],"next":3,"gap":true,"reset":false,"more":true}""")!!)
        assertEquals(1, page.events.size)
        assertEquals(5L, page.events[0].at)
        assertTrue(page.gap && page.more)
        assertEquals("c9", AiWire.conversationId(AiWire.parseObject("""{"conversation":{"id":"c9"}}""")!!))
        val acct = AiWire.account(AiWire.parseObject("""{"user":{"name":"bea"},"admin":false,"can":{"assistant.models":true,"assistant.tools":false}}""")!!)
        assertEquals("bea", acct.user)
        assertEquals(listOf("assistant.models"), acct.perms)
        assertNull(acct.allowedModes)
    }

    @Test fun failures() {
        assertTrue(AiWire.failure(302, "") is AxfFailure.Denied)
        assertEquals(AiWire.SIGN_IN, (AiWire.failure(401, "{}") as AxfFailure.Denied).permission)
        assertEquals("nope", AiWire.failure(403, """{"detail":"nope"}""").message)
        assertTrue(AiWire.failure(404, "", "session", "c1") is AxfFailure.NotFound)
        assertTrue(AiWire.failure(409, "") is AxfFailure.Invalid)
        assertTrue(AiWire.failure(503, "").retryable)
        assertEquals(10_000L, (AiWire.failure(429, "") as AxfFailure.Unavailable).retryAfterMs)
        assertTrue(AiWire.isFinal(AiWire.failure(401, "")))
        assertFalse(AiWire.isFinal(AiWire.failure(502, "")))
    }

    @Test fun sseLines() {
        val p = AiWire.SseLines()
        assertNull(p.feed(": keep-alive"))
        assertNull(p.feed(""))
        assertNull(p.feed("id: 4"))
        assertNull(p.feed("event: text"))
        assertNull(p.feed("data: {\"text\":\"hi\"}\r"))
        val f = p.feed("")!!
        assertEquals(4L, f.id)
        assertEquals("text", f.event)
        assertEquals(4L, AiWire.frameEvent(f)!!.seq)
        p.feed("event: done"); p.feed("data: {}")
        assertEquals("done", p.flush()!!.event)
    }
}
