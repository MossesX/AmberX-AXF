package ai.amberx.axf.ai

import ai.amberx.axf.ai.FakeHubTransport.Companion.ev
import ai.amberx.axf.ai.FakeHubTransport.Companion.replay
import ai.amberx.axf.kernel.ai.AiSessionRequest
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HubAiSessionClientTest {
    private val fast = AiLiveOptions(idleMinMs = 1, idleMaxMs = 2, retryMaxMs = 2)
    private val hub = FakeHubTransport()
    private val client = HubAiSessionClient(hub, options = fast)
    private val req = AiSessionRequest("ai.chat", "assistant.chat", "hello", "", true, false, "hello")

    @Test fun startCreatesAConversationSendsTheTurnAndReportsTheSession() = runBlocking {
        hub.onCall = { r ->
            when {
                r.method == "POST" && r.path.endsWith("/conversations") -> AiHubResponse(200, """{"conversation":{"id":"c1"}}""")
                r.method == "POST" && r.path.endsWith("/conversations/c1/messages") -> AiHubResponse(200, "event: start\n\n")
                r.path.endsWith("/sessions/c1") -> AiHubResponse(200, """{"session":{"id":"c1","kind":"assistant.chat","state":"running","host":"local","lastSeq":2}}""")
                else -> AiHubResponse(404)
            }
        }
        val info = (client.start(req) as AxfResult.Ok).value
        assertEquals("c1", info.id)
        assertEquals("axhub", info.host)
        assertEquals(LiveState.RUNNING, info.state)
        assertEquals("ai.chat", info.meta["mode"])
        val (turn, headersOnly) = hub.calls[1]
        assertTrue("a turn never waits for the reply", headersOnly)
        assertTrue(turn.body!!.contains("\"mode\":\"ai.chat\""))
    }

    @Test fun failuresAreTyped() = runBlocking {
        hub.onCall = { AiHubResponse(401, """{"detail":"sign in"}""") }
        val f = (client.start(req) as AxfResult.Err).failure
        assertTrue(f is AxfFailure.Denied && f.permission == AiWire.SIGN_IN)
        assertFalse(client.available())
        hub.onCall = { AiHubResponse(409, """{"detail":"busy"}""") }
        assertTrue((client.send("c1", "again") as AxfResult.Err).failure is AxfFailure.Invalid)
        assertTrue((client.send("../x", "again") as AxfResult.Err).failure is AxfFailure.Invalid)
        hub.onCall = { throw java.io.IOException("down") }
        assertTrue((client.list() as AxfResult.Err).failure is AxfFailure.Unavailable)
    }

    @Test fun listStreamStopClose() = runBlocking {
        hub.onCall = { r ->
            when {
                r.path.endsWith("/sessions") -> AiHubResponse(200, """{"items":[{"id":"a","state":"idle"},{"id":"b","state":"waiting"}]}""")
                r.path.contains("/events?since=2&follow=0") -> AiHubResponse(200, """{"events":[{"seq":3,"at":1,"kind":"text","data":{"text":"x"}}],"next":3,"gap":false,"reset":false,"more":false,"state":"idle"}""")
                r.path.endsWith("/stop") -> AiHubResponse(200, """{"stopped":true}""")
                r.path.endsWith("/a/close") -> AiHubResponse(200, """{"closed":true}""")
                r.path.endsWith("/z/close") -> AiHubResponse(200, """{"closed":false}""")
                else -> AiHubResponse(404)
            }
        }
        assertEquals(listOf("a", "b"), (client.list() as AxfResult.Ok).value.map { it.id })
        assertEquals(3L, (client.stream("a", 2) as AxfResult.Ok).value.next)
        assertTrue(client.stop("a").isOk)
        assertTrue(client.close("a").isOk)
        assertTrue((client.close("z") as AxfResult.Err).failure is AxfFailure.NotFound)
    }

    @Test fun followResumesAfterADroppedConnectionWithoutDuplicates() = runBlocking {
        hub.streams += FakeHubTransport.Script.Drop(replay(0, "running") + ev(1, "turn.start") + ev(2, "text", """{"text":"Hel"}"""))
        // the hub replays from since=2 but overlaps one old event: it must be dropped
        hub.streams += FakeHubTransport.Script.Lines(replay(2, "running") + ev(2, "text", """{"text":"Hel"}""") + ev(3, "text", """{"text":"lo"}""") + ev(4, "done"))
        hub.streams += FakeHubTransport.Script.Lines(replay(4, "idle"))
        hub.streams += FakeHubTransport.Script.Lines(replay(4, "running") + ev(5, LiveKinds.CLOSE))
        val items = withTimeout(5_000) { client.events("c1").toList() }
        val events = items.filterIsInstance<AiStreamItem.Event>().map { it.event.seq }
        assertEquals(listOf(1L, 2L, 3L, 4L, 5L), events)
        assertTrue(items.any { it is AiStreamItem.Reconnecting })
        assertTrue(items.any { it is AiStreamItem.Idle })
        assertTrue(items.last() is AiStreamItem.Ended)
        assertEquals(listOf("since=0", "since=2", "since=4", "since=4"), hub.streamPaths.map { Regex("since=\\d+").find(it)!!.value })
    }

    @Test fun followStopsOnSignOutAndOnAGoneSession() = runBlocking {
        hub.streams += FakeHubTransport.Script.Status(401, """{"detail":"sign in"}""")
        val a = withTimeout(5_000) { client.events("c1").toList() }
        assertTrue((a.last() as AiStreamItem.Failed).failure is AxfFailure.Denied)

        hub.streams += FakeHubTransport.Script.Status(503)
        hub.streams += FakeHubTransport.Script.Lines(listOf("event: session", """data: {"state":"none","lastSeq":0}""", ""))
        hub.streams += FakeHubTransport.Script.Lines(replay(0, "running") + ev(1, "text", """{"text":"x"}"""))
        hub.streams += FakeHubTransport.Script.Lines(listOf("event: session", """data: {"state":"none","lastSeq":0}""", ""))
        val b = withTimeout(5_000) { client.events("c2").toList() }
        assertTrue("503 retries", b.any { it is AiStreamItem.Reconnecting })
        assertTrue("before any event a missing session is waited for", b.any { it is AiStreamItem.Idle })
        assertTrue("after events a missing session was closed", b.last() is AiStreamItem.Ended)
    }

    @Test fun resetRestartsFromTheOldestKeptEvent() = runBlocking {
        hub.streams += FakeHubTransport.Script.Lines(replay(0, "idle", reset = true) + ev(1, "text") + ev(2, LiveKinds.CLOSE))
        val items = withTimeout(5_000) { client.events("c1", after = 99).toList() }
        assertTrue((items.first() as AiStreamItem.Replay).replay.reset)
        assertEquals(listOf(1L, 2L), items.filterIsInstance<AiStreamItem.Event>().map { it.event.seq })
    }

    @Test fun attachDetachesWithoutClosing() = runBlocking {
        hub.streams += FakeHubTransport.Script.Lines(replay(0, "running") + ev(1, "text", """{"text":"a"}"""))
        val got = CompletableDeferred<LiveEvent>()
        val d = (client.attach("c1", 0, { if (!got.isCompleted) got.complete(it) }) as AxfResult.Ok).value
        assertEquals(1L, withTimeout(5_000) { got.await() }.seq)
        d.detach()
        assertFalse("detaching never closes the session", hub.calls.any { it.first.path.endsWith("/close") })
    }
}
