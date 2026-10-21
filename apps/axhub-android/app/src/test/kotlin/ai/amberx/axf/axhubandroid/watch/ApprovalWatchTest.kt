package ai.amberx.axf.axhubandroid.watch

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.work.JobEvent
import ai.amberx.axf.kernel.work.WorkEngine
import kotlinx.serialization.json.jsonObject
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The watcher's job spec is the one the framework fixture replays (spec/fixtures/work.json → specs.approvals), so the
 * 5-minute back-off while signed out, the one-time sign-in notice and the watching condition are pinned by the shared
 * scenarios on every port. Written without a compiler.
 */
class ApprovalWatchTest {
    @Test fun specIsTheFixtureJob() {
        val f = File("../../../framework/spec/fixtures/work.json").readText().parseJsonObject()!!
        val expected = f.getValue("specs").jsonObject.getValue("approvals").jsonObject
        assertEquals(expected, ApprovalWatch.spec.toJson())
        assertTrue(WorkEngine.validate(ApprovalWatch.spec.toJson()).ok)
    }

    @Test fun signedOutBacksOffFiveMinutesAndNoticesOnce() {
        val on = mapOf(ApprovalWatch.FLAG_WATCHING to true)
        var s = WorkEngine.initialState(ApprovalWatch.spec, 30_000)
        s = WorkEngine.reduce(ApprovalWatch.spec, s, JobEvent.Start(), on).state
        val first = WorkEngine.reduce(ApprovalWatch.spec, s, JobEvent.Outcome("signed-out"), on)
        assertEquals(300_000L, first.state.sleepMs)
        assertTrue(first.effects.any { it.toJson()["effect"].toString().contains("notice") })
        s = WorkEngine.reduce(ApprovalWatch.spec, first.state, JobEvent.Wake, on).state
        val second = WorkEngine.reduce(ApprovalWatch.spec, s, JobEvent.Outcome("not-admin"), on)
        assertEquals(300_000L, second.state.sleepMs)
        assertTrue(second.effects.none { it.toJson()["effect"].toString().contains("notice") })
        // watching off stops at the next wake, as the old service did at the top of its loop
        val off = WorkEngine.reduce(ApprovalWatch.spec, second.state, JobEvent.Wake, mapOf(ApprovalWatch.FLAG_WATCHING to false))
        assertEquals("condition:watching", off.state.stopReason)
    }
}
