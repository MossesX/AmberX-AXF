package ai.amberx.axf.lock

import android.content.Context
import android.content.ContextWrapper
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.SecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/** Second step after whatever the app uses first (a spoken code, a tap…). */
public enum class LockMode(public val id: String) { NONE("none"), BIOMETRIC("biometric"), PIN("pin");
    public companion object { public fun of(id: String?): LockMode = entries.firstOrNull { it.id == id } ?: NONE }
}

/** Outcome of one unlock attempt. */
public sealed interface LockResult {
    public data object Passed : LockResult
    public data object Cancelled : LockResult
    /** Wrong PIN; [triesLeft] before a lockout, or null once lockouts have begun. */
    public data class Wrong(val triesLeft: Int?) : LockResult
    public data class LockedOut(val remainingMs: Long) : LockResult
    public data class Unavailable(val reason: String) : LockResult
}

/**
 * The `axf.lock` service: which second step is on, PIN storage and checks (hash only, in the
 * Keystore-backed secure store), fingerprint/face through BiometricPrompt, failed-try lockout and
 * the auto-lock delay. Apps call [authenticate] after their own first step.
 */
public class AppLock internal constructor(private val secure: SecureStore?, private val kv: KeyValueStore?, private val defaultMode: LockMode = LockMode.NONE, private val config: () -> Config?) {
    private val lockout = Lockout().also { l -> kv?.get(LOCKOUT)?.split(':')?.let { p -> l.state = Lockout.State(p.getOrNull(0)?.toIntOrNull() ?: 0, p.getOrNull(1)?.toLongOrNull() ?: 0) } }

    /** The saved choice, or the module default until settings have loaded. Callers should wait for the app to be ready before trusting it. */
    public val mode: LockMode get() = LockMode.of(config()?.string(MODE) ?: defaultMode.id)
    /** Minutes until the app locks itself after being left; 0 = as soon as it goes to the background. */
    public val autoLockMinutes: Int get() = config()?.string(AUTO)?.toIntOrNull() ?: 0

    public suspend fun hasPin(): Boolean = secure?.get(PIN)?.getOrNull() != null

    /** Saves a new PIN (4–12 digits). When one exists, [current] must match it. Returns an error message or null. */
    public suspend fun setPin(pin: String, current: String? = null): String? {
        if (!pin.matches(Regex("\\d{4,12}"))) return "Use 4 to 12 digits."
        val s = secure ?: return "Secure storage isn't available."
        if (hasPin()) when (val r = checkPin(current ?: "")) { LockResult.Passed -> {} ; is LockResult.LockedOut -> return "Too many tries. Wait ${r.remainingMs / 1000 + 1} s."; else -> return "Current PIN is wrong." }
        val hashed = withContext(Dispatchers.Default) { PinHasher.hash(pin) }
        return if (s.put(PIN, hashed).isOk) null else "Couldn't save the PIN."
    }

    public suspend fun checkPin(pin: String, now: Long = System.currentTimeMillis()): LockResult {
        lockout.remainingMs(now).takeIf { it > 0 }?.let { return LockResult.LockedOut(it) }
        val stored = secure?.get(PIN)?.getOrNull() ?: return LockResult.Unavailable("No PIN set.")
        val ok = withContext(Dispatchers.Default) { PinHasher.verify(pin, stored) }
        if (ok) { lockout.onSuccess(); saveLockout(); return LockResult.Passed }
        lockout.onFailure(now); saveLockout()
        val left = 5 - lockout.state.failures
        return if (lockout.remainingMs(now) > 0) LockResult.LockedOut(lockout.remainingMs(now)) else LockResult.Wrong(left.takeIf { it > 0 })
    }

    /** Null when fingerprint/face can be used now, else why not. */
    public fun biometricProblem(context: Context): String? = when (BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG)) {
        BiometricManager.BIOMETRIC_SUCCESS -> null
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "No fingerprint or face is set up on this phone."
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE, BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "This phone has no usable fingerprint or face sensor."
        BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "A security update is needed before biometrics can be used."
        else -> "Biometrics aren't available right now."
    }

    /** Shows the system fingerprint/face sheet. */
    public suspend fun biometric(activity: FragmentActivity, title: String, subtitle: String? = null): LockResult = withContext(Dispatchers.Main) {
        biometricProblem(activity)?.let { return@withContext LockResult.Unavailable(it) }
        suspendCancellableCoroutine { cont ->
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { if (cont.isActive) cont.resume(LockResult.Passed) }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (!cont.isActive) return
                    cont.resume(when (errorCode) {
                        BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> LockResult.Cancelled
                        BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> LockResult.LockedOut(30_000)
                        else -> LockResult.Unavailable(errString.toString())
                    })
                }
                // A failed finger just lets the sheet try again; nothing to do here.
            })
            val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).apply { if (subtitle != null) setSubtitle(subtitle) }
                .setAllowedAuthenticators(BIOMETRIC_STRONG).setNegativeButtonText("Cancel").setConfirmationRequired(false).build()
            cont.invokeOnCancellation { runCatching { prompt.cancelAuthentication() } }
            prompt.authenticate(info)
        }
    }

    /**
     * Runs the configured second step. PIN mode needs [pinEntry]: the UI's way of asking for a PIN
     * (return null when the user cancels); it is called again after a wrong PIN.
     */
    public suspend fun authenticate(activity: FragmentActivity?, title: String, pinEntry: suspend (LockResult?) -> String?): LockResult = when (mode) {
        LockMode.NONE -> LockResult.Passed
        LockMode.BIOMETRIC -> activity?.let { biometric(it, title) } ?: LockResult.Unavailable("No activity to show the fingerprint sheet.")
        LockMode.PIN -> {
            if (!hasPin()) LockResult.Unavailable("No PIN set. Set one in Settings → App lock.") else {
                var last: LockResult? = null
                var out: LockResult = LockResult.Cancelled
                while (true) {
                    val pin = pinEntry(last) ?: break
                    val r = checkPin(pin)
                    if (r is LockResult.Wrong) { last = r; continue }
                    if (r !is LockResult.LockedOut) { out = r; break }
                    last = r
                }
                out
            }
        }
    }

    private fun saveLockout() { kv?.put(LOCKOUT, "${lockout.state.failures}:${lockout.state.lockedUntil}") }

    public companion object {
        public const val MODE: String = "axf.lock.mode"
        public const val AUTO: String = "axf.lock.autoLock"
        internal const val PIN: String = "axf.lock.pinHash"
        internal const val LOCKOUT: String = "axf.lock.lockout"
    }
}

/** The FragmentActivity hosting this context (BiometricPrompt needs one), or null. */
public fun Context.findFragmentActivity(): FragmentActivity? {
    var c: Context? = this
    while (c is ContextWrapper) { if (c is FragmentActivity) return c; c = c.baseContext }
    return null
}
