package ai.amberx.axf.lock

import ai.amberx.axf.kernel.platform.KeyValueStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Salted PBKDF2-HMAC-SHA256 for PINs and spoken codes (pure JVM, no Android imports).
 * Stored form: `pbkdf2$<iterations>$<salt b64>$<hash b64>`; comparison is constant-time.
 */
public object PinHasher {
    public const val ITERATIONS: Int = 120_000
    private const val SALT_BYTES = 16
    private const val KEY_BITS = 256
    private val rng = SecureRandom()

    public fun hash(secret: String, iterations: Int = ITERATIONS): String {
        val salt = ByteArray(SALT_BYTES).also(rng::nextBytes)
        val b64 = Base64.getEncoder()
        return "pbkdf2$$iterations$${b64.encodeToString(salt)}$${b64.encodeToString(derive(secret, salt, iterations))}"
    }

    public fun verify(secret: String, stored: String?): Boolean {
        val parts = stored?.split('$') ?: return false
        if (parts.size != 4 || parts[0] != "pbkdf2") return false
        val iterations = parts[1].toIntOrNull()?.takeIf { it in 1_000..10_000_000 } ?: return false
        return runCatching {
            val dec = Base64.getDecoder()
            MessageDigest.isEqual(derive(secret, dec.decode(parts[2]), iterations), dec.decode(parts[3]))
        }.getOrDefault(false)
    }

    private fun derive(secret: String, salt: ByteArray, iterations: Int): ByteArray {
        val chars = secret.toCharArray()
        val spec = PBEKeySpec(chars, salt, iterations, KEY_BITS)
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded }
        finally { spec.clearPassword(); chars.fill('\u0000') }
    }
}

/**
 * Failed-attempt lockout: after [freeTries] misses, each further miss locks for a doubling delay
 * (30 s, 60 s, 120 s … up to [maxDelayMs]). Pure; [PersistedLockout] keeps [state] across restarts.
 */
public class Lockout(public val freeTries: Int = 5, private val baseDelayMs: Long = 30_000, private val maxDelayMs: Long = 15 * 60_000L) {
    public data class State(val failures: Int = 0, val lockedUntil: Long = 0)
    public var state: State = State()

    public fun remainingMs(now: Long): Long = (state.lockedUntil - now).coerceAtLeast(0)
    public fun onSuccess() { state = State() }
    public fun onFailure(now: Long) {
        val f = state.failures + 1
        val over = f - freeTries
        val until = if (over > 0) now + minOf(maxDelayMs, baseDelayMs shl minOf(over - 1, 20)) else 0
        state = State(f, until)
    }
}

/**
 * A [Lockout] saved in the kernel's key-value store under [key] after every change, so killing the app
 * never resets the count. Stored form `failures:lockedUntil` (the format AppLock and Voice Vault used
 * before, so saved lockouts carry over). A damaged value reads as no failures; without a store the
 * lockout still works for the life of the process.
 */
public class PersistedLockout(private val kv: KeyValueStore?, public val key: String, private val lockout: Lockout = Lockout()) {
    init { lockout.state = parse(kv?.get(key)) }

    public val state: Lockout.State get() = lockout.state
    public val failures: Int get() = lockout.state.failures
    /** Tries left before the first lockout, or null once lockouts have begun. */
    public val triesLeft: Int? get() = (lockout.freeTries - lockout.state.failures).takeIf { it > 0 }

    public fun remainingMs(now: Long): Long = lockout.remainingMs(now)
    public fun onFailure(now: Long) { lockout.onFailure(now); save() }
    public fun onSuccess() { lockout.onSuccess(); save() }
    /** Clears the count (a successful unlock, or erasing what it protected). */
    public fun reset(): Unit = onSuccess()

    private fun save() { kv?.put(key, format(lockout.state)) }

    public companion object {
        public fun format(s: Lockout.State): String = "${s.failures}:${s.lockedUntil}"
        public fun parse(raw: String?): Lockout.State {
            val p = raw?.split(':') ?: return Lockout.State()
            return Lockout.State((p.getOrNull(0)?.toIntOrNull() ?: 0).coerceAtLeast(0), p.getOrNull(1)?.toLongOrNull() ?: 0)
        }
    }
}
