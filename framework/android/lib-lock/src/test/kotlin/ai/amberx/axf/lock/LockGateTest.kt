package ai.amberx.axf.lock

import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LockGateTest {
    private var mode: LockMode? = LockMode.BIOMETRIC
    private var minutes = 0
    private var idle = 0

    private fun gate(firstStep: Boolean = false, ready: MutableStateFlow<Boolean>? = null) =
        LockGate({ mode }, { minutes }, scope = null, firstStep = firstStep, idleMinutes = { idle }, ready = ready, clock = { 0L })

    @Test fun startsLocked() {
        assertFalse(gate().isUnlocked)
    }

    @Test fun locksRightAwayWithZeroDelay() {
        val g = gate(); g.unlock()
        var reason: String? = null
        g.onLock { reason = it }
        g.onLeave(1_000)
        assertFalse(g.isUnlocked)
        assertEquals(LockGate.AWAY, reason)
    }

    @Test fun keepsOpenInsideTheDelayAndLocksAfter() {
        minutes = 5
        val g = gate(); g.unlock()
        g.onLeave(0); g.onReturn(5 * 60_000L - 1)
        assertTrue(g.isUnlocked)
        g.onLeave(0); g.onReturn(5 * 60_000L)
        assertFalse(g.isUnlocked)
    }

    @Test fun missingLockServiceFailsClosed() {
        mode = null; minutes = 15
        val g = gate()
        g.onReturn(0)
        assertFalse(g.isUnlocked) // never opens by itself
        g.unlock(); g.onLeave(0)
        assertFalse(g.isUnlocked) // and a 0 delay applies
        assertEquals(0L, g.delayMs())
    }

    @Test fun nothingMoreOpensWithoutAFirstStep() {
        mode = LockMode.NONE
        val g = gate()
        g.onReturn(0)
        assertTrue(g.isUnlocked)
        g.onLeave(0)
        assertTrue(g.isUnlocked) // leaving never locks in "Nothing more"
    }

    @Test fun nothingMoreStillLocksBehindAFirstStep() {
        mode = LockMode.NONE
        val g = gate(firstStep = true)
        g.onReturn(0)
        assertFalse(g.isUnlocked)
        g.unlock(); g.onLeave(0)
        assertFalse(g.isUnlocked)
    }

    @Test fun nothingMoreWaitsForSettings() {
        mode = LockMode.NONE
        val ready = MutableStateFlow(false)
        val g = gate(ready = ready)
        g.onReturn(0)
        assertFalse(g.isUnlocked)
        ready.value = true
        g.onReturn(0)
        assertTrue(g.isUnlocked)
    }

    @Test fun idleLocksOnlyInTheForeground() {
        idle = 5
        val g = gate(); g.unlock(); g.touch(0)
        assertFalse(g.checkIdle(5 * 60_000L)) // exactly the limit: still open
        assertTrue(g.checkIdle(5 * 60_000L + 1))
        assertFalse(g.isUnlocked)
        idle = 0
        g.unlock(); g.touch(0)
        assertFalse(g.checkIdle(Long.MAX_VALUE / 2)) // 0 = never
        idle = 1; minutes = 60
        g.onLeave(0)
        assertFalse(g.checkIdle(10 * 60_000L)) // away: the away delay decides, not idle
    }

    @Test fun lockNowReportsOnlyWhenOpen() {
        val g = gate()
        var calls = 0
        g.onLock { calls++ }
        assertFalse(g.lockNow())
        g.unlock()
        assertTrue(g.lockNow("x"))
        assertEquals(1, calls)
    }

    @Test fun arithmetic() {
        assertTrue(LockGate.shouldLock(0, 0, 0))
        assertFalse(LockGate.shouldLock(100, 159_999 + 100, 160_000))
        assertTrue(LockGate.shouldLock(100, 160_100, 160_000))
        assertFalse(LockGate.idleExpired(0, 60_000, 60_000))
        assertTrue(LockGate.idleExpired(0, 60_001, 60_000))
        assertEquals("Locked after 5 min without use.", LockGate.idleReason(5))
    }
}
