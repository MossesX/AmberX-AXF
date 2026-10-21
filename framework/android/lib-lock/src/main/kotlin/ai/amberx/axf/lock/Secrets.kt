package ai.amberx.axf.lock

import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * What kind of secret is kept: how typed or heard text is normalized before hashing, and what counts as
 * acceptable. Open: apps add their own kinds. Pure Kotlin.
 */
public open class SecretKind(
    public val id: String,
    /** Applied before hashing and before every check, so both sides always compare the same form. */
    public val normalize: (String) -> String,
    /** Null when the normalized value is acceptable, else a message for the user. */
    public val problem: (String) -> String?,
) {
    public companion object {
        /** 4–12 digits, compared exactly. */
        public val PIN: SecretKind = SecretKind("pin", { it }, { if (it.matches(Regex("\\d{4,12}"))) null else "Use 4 to 12 digits." })

        /**
         * A spoken (or typed) phrase such as an unlock code. [normalize] must be the same function on every
         * save and check (Voice Vault passes lib-voice's `SpokenText::code`), so punctuation and case never
         * matter; at least [minLength] characters after normalizing.
         */
        public fun passphrase(
            normalize: (String) -> String,
            minLength: Int = 6,
            tooShort: String = "Use at least $minLength letters or numbers (two or more words works best).",
        ): SecretKind = SecretKind("passphrase", normalize) { if (it.length < minLength) tooShort else null }
    }
}

/** What the secure store holds for a secret. [Error] is never "missing": callers must not offer a new secret then. */
public sealed interface SecretState {
    public data class Present(val hash: String) : SecretState
    public data object Missing : SecretState
    public data object Error : SecretState
}

/**
 * One secret kept only as a salted PBKDF2 hash ([PinHasher]) in the Keystore-backed secure store under [key].
 * Used for AppLock's PIN and apps' own codes (Voice Vault's spoken unlock code).
 */
public class StoredSecret(private val secure: SecureStore?, public val key: String, public val kind: SecretKind) {
    /** No secure store, or a read error, is [SecretState.Error]: fail closed. */
    public suspend fun state(): SecretState = when (val r = secure?.get(key)) {
        null -> SecretState.Error
        is AxfResult.Err -> SecretState.Error
        is AxfResult.Ok -> r.value?.let { SecretState.Present(it) } ?: SecretState.Missing
    }

    public suspend fun isSet(): Boolean = state() is SecretState.Present

    /** Null when [value] (normalized) is acceptable for this kind, else the message to show. */
    public fun check(value: String): String? = kind.problem(kind.normalize(value))

    /** Hashes and saves [value] (normalized first). Returns an error message or null. Callers decide who may change it. */
    public suspend fun save(value: String, failMessage: String = "Couldn't save it."): String? {
        val v = kind.normalize(value)
        kind.problem(v)?.let { return it }
        val s = secure ?: return "Secure storage isn't available."
        val hashed = withContext(Dispatchers.Default) { PinHasher.hash(v) }
        return if (s.put(key, hashed).isOk) null else failMessage
    }

    /** True when any of the first [max] distinct normalized [candidates] matches [hash]. Empty candidates never match. */
    public suspend fun matchesAny(candidates: List<String>, hash: String, max: Int = 3): Boolean = withContext(Dispatchers.Default) {
        candidates.map(kind.normalize).distinct().take(max).any { it.isNotEmpty() && PinHasher.verify(it, hash) }
    }

    public suspend fun remove(): Boolean = secure?.remove(key)?.isOk == true
}
