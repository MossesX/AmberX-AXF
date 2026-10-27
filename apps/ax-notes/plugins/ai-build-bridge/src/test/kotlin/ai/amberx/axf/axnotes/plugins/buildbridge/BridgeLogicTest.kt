package ai.amberx.axf.axnotes.plugins.buildbridge

import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.triggers.MatchEnv
import ai.amberx.axf.kernel.triggers.Observation
import ai.amberx.axf.kernel.triggers.TriggerMatcher
import ai.amberx.axf.kernel.triggers.TriggerValidation
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeLogicTest {
    private fun obj(vararg kv: Pair<String, String>) = JsonObject(kv.associate { it.first to JsonPrimitive(it.second) })
    private fun ev(seq: Long, kind: String, vararg kv: Pair<String, String>) = LiveEvent(seq, seq, kind, if (kv.isEmpty()) null else obj(*kv))
    private fun req(status: RequestStatus = RequestStatus.PENDING_APPROVAL, createdAt: Long = 0) =
        BuildRequest("br-1", "Dark mode", "Add dark mode", RequestSource.VOICE, createdAt, createdAt, status, sessionId = "s1")

    @Test fun notesTaggedBuildBecomeDrafts() {
        val tagged = JsonObject(mapOf("id" to JsonPrimitive("n1"), "title" to JsonPrimitive(""), "text" to JsonPrimitive("Add a share button #build please"), "tags" to JsonArray(emptyList())))
        val d = BuildIntents.fromNote(tagged)!!
        assertEquals("Add a share button please", d.body)
        assertEquals("Add a share button please", d.title)
        assertEquals("n1", d.noteId)
        assertEquals(RequestSource.NOTE, d.source)
        val byTag = JsonObject(mapOf("id" to JsonPrimitive("n2"), "title" to JsonPrimitive("Sync fix"), "text" to JsonPrimitive("Retry on 502"), "tags" to JsonArray(listOf(JsonPrimitive("#Build")))))
        assertEquals("Sync fix", BuildIntents.fromNote(byTag)!!.title)
        assertNull(BuildIntents.fromNote(obj("id" to "n3", "text" to "#buildings are tall")))
        assertNull(BuildIntents.fromNote(null))
        assertTrue(BuildIntents.isTagged(emptyList(), "#BUILD: x"))
    }

    @Test fun promptOnlyAsksToRecordTheRequest() {
        val p = BuildPrompt.of(BuildDraft("Share button", "Add a share button", RequestSource.NOTE, "n1"))
        assertTrue(p.contains("Do not build, edit code or start any step"))
        assertTrue(p.contains("approval"))
        assertTrue(p.contains("(note n1)"))
        assertTrue(p.endsWith("Add a share button"))
    }

    @Test fun onlyAdminsPass() {
        assertEquals(BridgeGate.DENIED, BridgeGate.check(Policies.fromPermissions(setOf("notes.write", "ai.mode.ai.build-request", "ai.build")), AiModes.BUILTINS))
        assertNull(BridgeGate.check(Policies.fromPermissions(setOf("*")), AiModes.BUILTINS))
        assertNull(BridgeGate.check(Policies.fromPermissions(setOf("ai.admin")), AiModes.BUILTINS))
        assertNotNull(BridgeGate.check(Policies.fromPermissions(setOf("*")), AiModes.BUILTINS.filter { it.id != AiModes.BUILD_REQUEST }))
    }

    @Test fun pollEvery15sTenTimesThenEveryMinute() {
        assertEquals((0 until 10).map { 15_000L }, (0 until 10).map { ApprovalPoll.delayMs(it) })
        assertEquals(60_000L, ApprovalPoll.delayMs(10))
        var r = req()
        val waits = ArrayList<Long>()
        var now = 1_000L
        repeat(12) { r = ApprovalPoll.afterPoll(r, now); waits += r.nextPollAt!! - now; now = r.nextPollAt!! }
        assertEquals(List(9) { 15_000L } + List(3) { 60_000L }, waits)
        assertEquals(12, r.polls)
    }

    @Test fun waitingTooLongExpiresAndOverRequestsStopPolling() {
        val old = ApprovalPoll.afterPoll(req(createdAt = 0), ApprovalPoll.APPROVAL_TTL_MS + 1)
        assertEquals(RequestStatus.EXPIRED, old.status)
        assertNull(old.nextPollAt)
        assertNull(ApprovalPoll.afterPoll(req(RequestStatus.REJECTED), 5).nextPollAt)
        val approved = ApprovalPoll.afterPoll(req(RequestStatus.APPROVED), ApprovalPoll.APPROVAL_TTL_MS + 1)
        assertEquals(RequestStatus.APPROVED, approved.status) // approved ones are watched longer
    }

    @Test fun dueIsTheEarliestActiveRequest() {
        val a = req().copy(id = "a", nextPollAt = 50)
        val b = req().copy(id = "b", nextPollAt = 20)
        val c = req(RequestStatus.FINISHED).copy(id = "c", nextPollAt = 1)
        assertEquals("b", ApprovalPoll.due(listOf(a, b, c))?.id)
        assertNull(ApprovalPoll.due(listOf(c)))
    }

    @Test fun approvalFlowFromWaitToFinished() {
        var r = req(RequestStatus.SUBMITTING)
        r = ApprovalEvents.fold(r, listOf(ev(1, LiveKinds.WAIT, "approvalUrl" to "https://hub.example/approve/abc", "approvalId" to "abc")), 10).request
        assertEquals(RequestStatus.PENDING_APPROVAL, r.status)
        assertEquals("https://hub.example/approve/abc", r.approvalUrl)
        assertEquals("abc", r.approvalId)
        r = ApprovalEvents.fold(r, listOf(ev(2, LiveKinds.RESUME), ev(3, "orchestrator.added", "buildId" to "share-button")), 20).request
        assertEquals(RequestStatus.APPROVED, r.status)
        assertEquals("share-button", r.buildId)
        val f = ApprovalEvents.fold(r, listOf(ev(3, "build.finished"), ev(4, "build.finished", "summary" to "All 4 steps done", "status" to "done")), 30)
        assertTrue(f.justFinished)
        assertEquals(RequestStatus.FINISHED, f.request.status)
        assertEquals("All 4 steps done", f.request.summary)
        assertEquals(4, f.request.lastSeq)
        assertFalse(ApprovalEvents.fold(f.request, listOf(ev(5, "build.finished")), 40).justFinished)
        val hook = RequestCodec.finishedHook(f.request)
        assertEquals("share-button", (hook["buildId"] as JsonPrimitive).content)
    }

    @Test fun rejectionsCloseAndUnsafeLinks() {
        assertEquals(RequestStatus.REJECTED, ApprovalEvents.apply(req(), ev(1, "approval", "state" to "rejected")).status)
        assertEquals(RequestStatus.CANCELLED, ApprovalEvents.apply(req(), ev(1, LiveKinds.CLOSE)).status)
        assertEquals(RequestStatus.APPROVED, ApprovalEvents.apply(req(RequestStatus.APPROVED), ev(1, LiveKinds.CLOSE)).status)
        assertEquals(RequestStatus.FAILED, ApprovalEvents.apply(req(), ev(1, "error", "message" to "boom")).status)
        assertNull(ApprovalEvents.apply(req(), ev(1, LiveKinds.WAIT, "url" to "javascript:alert(1)")).approvalUrl)
        assertEquals(RequestStatus.REJECTED, ApprovalEvents.apply(req(RequestStatus.REJECTED), ev(1, "approval.approved")).status) // over stays over
    }

    @Test fun sessionInfoGivesTheLink() {
        val info = LiveSessionInfo("s1", "agent.run", "x", LiveState.WAITING, "axhub", 0, 0, 1, meta = mapOf("approvalUrl" to "https://hub.example/a/1"))
        val r = ApprovalEvents.fromInfo(req(RequestStatus.SUBMITTING), info)
        assertEquals(RequestStatus.PENDING_APPROVAL, r.status)
        assertEquals("https://hub.example/a/1", r.approvalUrl)
        assertEquals(RequestStatus.CANCELLED, ApprovalEvents.fromInfo(req(), info.copy(state = LiveState.CLOSED)).status)
    }

    @Test fun codecRoundTripsAndKeepsActiveOnes() {
        val r = req().copy(approvalUrl = "https://h/a", nextPollAt = 99, polls = 3, lastSeq = 7, noteId = "n1")
        assertEquals(r, RequestCodec.fromJson(RequestCodec.toJson(r)))
        val many = (0 until 130).map { i -> req(if (i < 5) RequestStatus.PENDING_APPROVAL else RequestStatus.FINISHED, createdAt = i.toLong()).copy(id = "r$i") }
        val kept = RequestCodec.keep(many)
        assertEquals(RequestCodec.MAX_KEPT, kept.size)
        assertTrue((0 until 5).all { i -> kept.any { it.id == "r$i" } })
        assertEquals("r129", kept.first().id)
    }

    @Test fun triggersAreValidAndCaptureTheRequest() {
        val ts = BridgeTriggers.all(BuildBridgePlugin.ID)
        for (t in ts) assertTrue(t.id, TriggerValidation.validate(t.toJson()).ok)
        val fired = TriggerMatcher.match(ts, Observation("voice", 5_000, listOf("build a widget for my lists")), MatchEnv("home")).fired
        assertEquals(BridgeTriggers.ACTION_REQUEST, fired?.action)
        assertEquals("a widget for my lists", BridgeTriggers.textArg(fired?.args))
    }
}
