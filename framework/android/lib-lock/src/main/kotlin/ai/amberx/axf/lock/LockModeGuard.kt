package ai.amberx.axf.lock

/**
 * Settings → App lock can't pick a second step that would lock the user out: PIN needs a saved PIN and
 * fingerprint/face needs a working sensor. A bad pick goes back to the previous choice, never to a weaker
 * one. Pure; [LockModule] wires it to the settings engine (from Voice Vault's `guardLockMode`, now for
 * every app with lib-lock).
 */
public class LockModeGuard(initial: LockMode? = null) {
    public sealed interface Decision {
        public data object Accept : Decision
        /** Put the setting back to [back] and tell the user [problem]. */
        public data class Revert(val back: LockMode, val problem: String) : Decision
    }

    /** The last accepted choice. */
    public var last: LockMode? = initial
        private set
    private var reverting: LockMode? = null

    /** Called once settings have loaded. */
    public fun start(current: LockMode) { last = current; reverting = null }

    /**
     * A new pick of [mode]. [problemOf] says why a mode can't be used (null = fine). The value written back by a
     * [Decision.Revert] arrives here again and is accepted without a check, so a revert can never loop.
     */
    public suspend fun onPicked(mode: LockMode, problemOf: suspend (LockMode) -> String?): Decision {
        if (reverting != null && mode == reverting) { reverting = null; last = mode; return Decision.Accept }
        reverting = null
        val problem = problemOf(mode)
        if (problem == null) { last = mode; return Decision.Accept }
        val back = last ?: LockMode.NONE
        reverting = back
        return Decision.Revert(back, problem)
    }

    public companion object {
        public const val NO_CONTEXT: String = "Can't check the fingerprint sensor here."

        /** Why [mode] can't be used: PIN without a saved PIN, biometric with a sensor problem. NONE is always fine. */
        public fun problem(mode: LockMode, hasPin: Boolean, biometricProblem: String?, pinNeeded: String): String? = when (mode) {
            LockMode.PIN -> if (hasPin) null else pinNeeded
            LockMode.BIOMETRIC -> biometricProblem
            LockMode.NONE -> null
        }
    }
}
