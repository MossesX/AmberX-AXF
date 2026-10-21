package ai.amberx.axf.lock

import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class MemorySecure(var broken: Boolean = false) : SecureStore {
    val map = LinkedHashMap<String, String>()
    override suspend fun get(key: String): AxfResult<String?> = if (broken) AxfResult.err(AxfFailure.Unavailable("down")) else AxfResult.ok(map[key])
    override suspend fun put(key: String, value: String): AxfResult<Unit> { if (broken) return AxfResult.err(AxfFailure.Unavailable("down")); map[key] = value; return AxfResult.ok(Unit) }
    override suspend fun remove(key: String): AxfResult<Unit> { map.remove(key); return AxfResult.ok(Unit) }
}

class LockGuardsTest {
    @Test fun persistedLockoutSurvivesARestart() {
        val kv = MemoryKeyValueStore()
        val a = PersistedLockout(kv, "k", Lockout(freeTries = 2, baseDelayMs = 1_000))
        a.onFailure(0); assertEquals(1, a.triesLeft)
        a.onFailure(0); assertNull(a.triesLeft)
        a.onFailure(0); assertEquals(1_000L, a.remainingMs(0))
        assertEquals("3:1000", kv.get("k")) // same format as before the harvest
        val b = PersistedLockout(kv, "k", Lockout(freeTries = 2, baseDelayMs = 1_000))
        assertEquals(1_000L, b.remainingMs(0))
        b.onFailure(0); assertEquals(2_000L, b.remainingMs(0)) // keeps doubling after a restart
        b.reset(); assertEquals("0:0", kv.get("k"))
    }

    @Test fun lockoutParsesOldAndDamagedValues() {
        assertEquals(Lockout.State(4, 99), PersistedLockout.parse("4:99"))
        assertEquals(Lockout.State(), PersistedLockout.parse(null))
        assertEquals(Lockout.State(), PersistedLockout.parse("junk"))
        assertEquals(Lockout.State(0, 5), PersistedLockout.parse("-3:5"))
        val noStore = PersistedLockout(null, "k", Lockout(freeTries = 1, baseDelayMs = 10))
        noStore.onFailure(0); noStore.onFailure(0)
        assertEquals(10L, noStore.remainingMs(0)) // still works in memory
    }

    @Test fun modeGuardRevertsToThePreviousChoice() = runBlocking {
        val g = LockModeGuard(); g.start(LockMode.BIOMETRIC)
        val noPin: suspend (LockMode) -> String? = { m -> LockModeGuard.problem(m, hasPin = false, biometricProblem = null, pinNeeded = "set a pin") }
        val d = g.onPicked(LockMode.PIN, noPin)
        assertIs<LockModeGuard.Decision.Revert>(d)
        assertEquals(LockMode.BIOMETRIC, d.back)
        assertEquals("set a pin", d.problem)
        // the write-back arrives again and is accepted without a check (no loop)
        assertEquals(LockModeGuard.Decision.Accept, g.onPicked(LockMode.BIOMETRIC) { "would refuse" })
        assertEquals(LockMode.BIOMETRIC, g.last)
    }

    @Test fun modeGuardRefusesASensorlessFingerprint() = runBlocking {
        val g = LockModeGuard(); g.start(LockMode.NONE)
        val d = g.onPicked(LockMode.BIOMETRIC) { m -> LockModeGuard.problem(m, true, "no sensor", "x") }
        assertIs<LockModeGuard.Decision.Revert>(d); assertEquals(LockMode.NONE, d.back)
        assertEquals(LockModeGuard.Decision.Accept, g.onPicked(LockMode.NONE) { null })
        assertEquals(LockModeGuard.Decision.Accept, g.onPicked(LockMode.PIN) { m -> LockModeGuard.problem(m, true, null, "x") })
        assertEquals(LockMode.PIN, g.last)
        assertNull(LockModeGuard.problem(LockMode.NONE, false, "no sensor", "x"))
    }

    @Test fun passphraseSecretNormalizesBothSides() = runBlocking {
        val secure = MemorySecure()
        val kind = SecretKind.passphrase({ it.lowercase().replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim() })
        val s = StoredSecret(secure, "code", kind)
        assertEquals(SecretState.Missing, s.state())
        assertTrue(s.check("ab")!!.startsWith("Use at least 6"))
        assertNull(s.save("Purple, Monkey!"))
        val hash = (s.state() as SecretState.Present).hash
        assertTrue(hash.startsWith("pbkdf2$"))
        assertTrue(s.matchesAny(listOf("nope", "purple monkey"), hash))
        assertFalse(s.matchesAny(listOf("", "?!"), hash)) // empty never matches
        assertFalse(s.matchesAny(listOf("a", "b", "c", "purple monkey"), hash)) // only the first 3 alternatives
        assertTrue(s.remove()); assertEquals(SecretState.Missing, s.state())
    }

    @Test fun storageErrorsAreNeverMissing() = runBlocking {
        assertEquals(SecretState.Error, StoredSecret(null, "k", SecretKind.PIN).state())
        assertEquals(SecretState.Error, StoredSecret(MemorySecure(broken = true), "k", SecretKind.PIN).state())
        assertEquals("Secure storage isn't available.", StoredSecret(null, "k", SecretKind.PIN).save("1234"))
        assertEquals("Use 4 to 12 digits.", SecretKind.PIN.problem("12a4"))
        assertNull(SecretKind.PIN.problem("123456789012"))
    }
}
