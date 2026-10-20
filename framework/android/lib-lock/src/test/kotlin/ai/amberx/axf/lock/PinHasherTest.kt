package ai.amberx.axf.lock

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PinHasherTest {
    @Test fun hashesAndVerifies() {
        val h = PinHasher.hash("4821", iterations = 2_000)
        assertTrue(h.startsWith("pbkdf2\$2000\$"))
        assertTrue(PinHasher.verify("4821", h))
        assertFalse(PinHasher.verify("4822", h))
        assertNotEquals(h, PinHasher.hash("4821", iterations = 2_000)) // salted
        assertFalse(PinHasher.verify("4821", "garbage"))
        assertFalse(PinHasher.verify("4821", null))
        assertFalse(PinHasher.verify("4821", "pbkdf2\$1\$AAAA\$AAAA")) // iteration floor
    }

    @Test fun lockoutDoubles() {
        val l = Lockout(freeTries = 3, baseDelayMs = 1_000)
        repeat(3) { l.onFailure(0) }
        assertEquals(0L, l.remainingMs(0))
        l.onFailure(0); assertEquals(1_000L, l.remainingMs(0))
        l.onFailure(0); assertEquals(2_000L, l.remainingMs(0))
        l.onSuccess(); assertEquals(0, l.state.failures)
    }
}
