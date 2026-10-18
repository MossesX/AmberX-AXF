package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.live.LIVE_SESSIONS_CAPABILITY
import ai.amberx.axf.kernel.live.LiveEventLog
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.live.LiveSessions
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.live.PlaceholderSessionHost
import ai.amberx.axf.kernel.live.SessionHosts
import ai.amberx.axf.kernel.result.AxfFailure
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.int
import kotlinx.serialization.json.boolean
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertSame

/** Replays spec/fixtures/live-session.json (generated from core/live-session.ts) against the kernel's live package. */
class LiveSessionConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/live-session.json").readText().parseJsonObject()!!

    @Test fun `states and reserved kinds match`() {
        assertEquals(f.getValue("states").jsonArray.map { it.jsonPrimitive.content }, LiveState.entries.map { it.id })
        assertEquals(f.getValue("kinds").jsonObject.values.map { it.jsonPrimitive.content }, LiveKinds.ALL)
    }

    @Test fun `state reducer matches the reference for every state and kind`() {
        for (t in f.getValue("transitions").jsonArray) {
            val o = t.jsonObject
            val from = LiveState.parse(o.getValue("state").jsonPrimitive.content)
            val kind = o.getValue("kind").jsonPrimitive.content
            assertEquals(o.getValue("next").jsonPrimitive.content, LiveSessions.reduce(from, kind).id, "${from.id} + $kind")
        }
    }

    @Test fun `event log appends, trims and replays like the reference`() {
        val spec = f.getValue("log").jsonObject
        val log = LiveEventLog(spec.getValue("limit").jsonPrimitive.int)
        var state = LiveState.IDLE
        val states = mutableListOf<String>()
        for (a in spec.getValue("appends").jsonArray) {
            val o = a.jsonObject
            val kind = o.getValue("kind").jsonPrimitive.content
            log.append(kind, o["data"], o.getValue("at").jsonPrimitive.long)
            state = LiveSessions.reduce(state, kind)
            states += state.id
        }
        assertEquals(spec.getValue("states").jsonArray.map { it.jsonPrimitive.content }, states)
        assertEquals(spec.getValue("lastSeq").jsonPrimitive.long, log.lastSeq)
        assertEquals(spec.getValue("firstSeq").jsonPrimitive.long, log.firstSeq)
        val kept = spec.getValue("kept").jsonArray.map { it.jsonObject }
        assertEquals(kept.map { it.getValue("seq").jsonPrimitive.long }, log.all().map { it.seq })
        assertEquals(kept.map { it["data"] }, log.all().map { it.data })

        for (r in f.getValue("replays").jsonArray) {
            val q = r.jsonObject
            val after = q.getValue("after").jsonPrimitive.long
            val max = q.getValue("max").jsonPrimitive.int
            val exp = q.getValue("result").jsonObject
            val got = log.since(after, max)
            val label = "since($after, $max)"
            assertEquals(exp.getValue("events").jsonArray.map { it.jsonObject.getValue("seq").jsonPrimitive.long }, got.events.map { it.seq }, label)
            assertEquals(exp.getValue("next").jsonPrimitive.long, got.next, "$label next")
            assertEquals(exp.getValue("gap").jsonPrimitive.boolean, got.gap, "$label gap")
            assertEquals(exp.getValue("reset").jsonPrimitive.boolean, got.reset, "$label reset")
            assertEquals(exp.getValue("more").jsonPrimitive.boolean, got.more, "$label more")
        }
    }

    @Test fun `placeholder host refuses and the kernel declares the capability`() = runTest {
        val r = PlaceholderSessionHost.info("x")
        assertIs<AxfFailure.NotImplemented>(r.failureOrNull())
        assertSame(PlaceholderSessionHost, SessionHosts().current())
        assertEquals(LIVE_SESSIONS_CAPABILITY, (r.failureOrNull() as AxfFailure.NotImplemented).capability)
    }
}
