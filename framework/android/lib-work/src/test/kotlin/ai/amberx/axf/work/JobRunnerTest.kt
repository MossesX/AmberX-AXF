package ai.amberx.axf.work

import ai.amberx.axf.kernel.work.DelayRule
import ai.amberx.axf.kernel.work.IntervalBounds
import ai.amberx.axf.kernel.work.JobEvent
import ai.amberx.axf.kernel.work.JobPhase
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.JobState
import ai.amberx.axf.kernel.work.OutcomeRule
import ai.amberx.axf.kernel.work.RunCondition
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The runner carries out the state machine's effects with virtual time: the body runs on `run`, a `sleep` waits exactly
 * what the engine said, notices reach the host once per spell, conditions stop the loop, check-now interrupts a sleep.
 * Written without a compiler (CI runs :lib-work:testDebugUnitTest).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class JobRunnerTest {
    private val spec = JobSpec(
        id = "test.poll", kind = "poll",
        interval = IntervalBounds(30_000, 15_000, 300_000),
        outcomes = mapOf(
            "ok" to OutcomeRule(DelayRule.Interval, endsSpell = true),
            "signed-out" to OutcomeRule(DelayRule.Fixed(300_000), notice = "sign-in"),
        ),
        conditions = listOf(RunCondition("watching")),
        foreground = true, restartOnBoot = true,
    )

    private class Log : JobRunner.Host {
        val lines = mutableListOf<String>()
        var last: JobState? = null
        override fun onState(runner: JobRunner, state: JobState) { last = state }
        override fun onStatus(runner: JobRunner, outcome: String) { lines += "status $outcome" }
        override fun onNotice(runner: JobRunner, id: String, outcome: String) { lines += "notice $id $outcome" }
        override fun onNoticesCleared(runner: JobRunner) { lines += "clear" }
        override fun onStopped(runner: JobRunner, reason: String) { lines += "stop $reason" }
    }

    @Test fun runsTheBodySleepsWhatTheEngineSaysAndNoticesOncePerSpell() = runTest {
        val outcomes = ArrayDeque(listOf("signed-out", "signed-out", "ok", "ok"))
        val log = Log()
        var watching = true
        val runner = JobRunner(spec, { mapOf("watching" to watching) }, { outcomes.removeFirst() }, this, log, intervalMs = 60_000, sleep = { ms -> log.lines += "sleep $ms"; delay(ms) })
        runner.dispatch(JobEvent.Start())
        runCurrent()
        assertEquals(listOf("notice sign-in signed-out", "status signed-out", "sleep 300000"), log.lines)
        assertEquals(JobPhase.SLEEPING, runner.state.value.phase)
        advanceTimeBy(300_000); runCurrent()
        assertEquals(listOf("status signed-out", "sleep 300000"), log.lines.drop(3))
        advanceTimeBy(300_000); runCurrent()
        assertEquals(listOf("clear", "status ok", "sleep 60000"), log.lines.drop(5))
        assertEquals(3, runner.state.value.runs)
        // watching turned off: the next wake stops the loop instead of running the body
        watching = false
        advanceTimeBy(60_000); runCurrent()
        assertEquals("stop condition:watching", log.lines.last())
        assertEquals(JobPhase.STOPPED, runner.state.value.phase)
        assertEquals(1, outcomes.size)
        assertFalse(runner.isActive)
    }

    @Test fun checkNowInterruptsASleepAndStopCancelsTheBody() = runTest {
        var runs = 0
        val log = Log()
        val runner = JobRunner(spec, { mapOf("watching" to true) }, { runs++; "ok" }, this, log, sleep = { ms -> delay(ms) })
        runner.dispatch(JobEvent.Start()); runCurrent()
        assertEquals(1, runs)
        assertEquals(30_000L, runner.state.value.sleepMs)
        runner.dispatch(JobEvent.CheckNow); runCurrent()
        assertEquals(2, runs)
        // the interrupted sleep never wakes: one sleep is pending, not two
        advanceTimeBy(30_000); runCurrent()
        assertEquals(3, runs)
        runner.dispatch(JobEvent.Stop); runCurrent()
        assertEquals("stop stopped", log.lines.last())
        advanceUntilIdle()
        assertEquals(3, runs)
        assertTrue(log.lines.count { it.startsWith("stop") } == 1)
    }

    @Test fun aThrowingBodyBecomesTheErrorOutcomeAndTheLoopGoesOn() = runTest {
        var calls = 0
        val log = Log()
        val runner = JobRunner(spec, { mapOf("watching" to true) }, { calls++; if (calls == 1) throw IllegalStateException("boom") else "ok" }, this, log, sleep = { delay(it) })
        runner.dispatch(JobEvent.Start()); runCurrent()
        assertEquals("error", runner.state.value.lastOutcome)
        assertEquals(30_000L, runner.state.value.sleepMs) // no rule for "error": the fallback is the interval
        advanceTimeBy(30_000); runCurrent()
        assertEquals("ok", runner.state.value.lastOutcome)
        assertEquals(2, calls)
        runner.dispatch(JobEvent.Stop); runCurrent() // leave no sleep behind for runTest
    }

    @Test fun hostRefusedStopsWithoutRunning() = runTest {
        var runs = 0
        val log = Log()
        val runner = JobRunner(spec, { mapOf("watching" to true) }, { runs++; "ok" }, this, log)
        runner.dispatch(JobEvent.HostRefused); runCurrent()
        assertEquals(listOf("stop host-refused"), log.lines)
        assertEquals(0, runs)
    }
}
