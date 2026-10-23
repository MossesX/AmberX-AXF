package ai.amberx.axf.lock

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

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
 * Whether the app's screens may show: starts locked, opens on [unlock], locks again on [lockNow], after
 * the auto-lock delay away from the app ([onLeave] / [onReturn]) and, when [idleMinutes] says so, after
 * that long without use ([touch]). Pure Kotlin (coroutines only), so the arithmetic is unit-tested.
 *
 * Fails closed: [mode] null means the lock service is missing, which counts as a 0-minute delay and never
 * opens by itself. [firstStep] true is for apps whose own first step (Voice Vault's spoken code) always
 * comes first: then even mode NONE locks and never opens by itself. With [firstStep] false (AXHub) mode
 * NONE ("Nothing more") opens on return and leaving never locks.
 *
 * With a [scope] the gate also locks while the app is away (a timer, so secrets leave memory even if the
 * app is never reopened) and runs the idle check every [idleCheckMs].
 */
public class LockGate(
    private val mode: () -> LockMode?,
    private val autoLockMinutes: () -> Int,
    private val scope: CoroutineScope? = null,
    private val firstStep: Boolean = false,
    private val idleMinutes: () -> Int = { 0 },
    /** True once settings have loaded; the gate never opens by itself before (the lock mode is a saved setting). */
    private val ready: StateFlow<Boolean>? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val idleCheckMs: Long = 30_000,
) {
    private val _unlocked = MutableStateFlow(false)
    public val unlocked: StateFlow<Boolean> = _unlocked.asStateFlow()
    public val isUnlocked: Boolean get() = _unlocked.value

    private val listeners = mutableListOf<(String?) -> Unit>()
    private var leftAt = 0L
    private var away = false
    private var awayTimer: Job? = null
    private var lastActivity = clock()

    init {
        if (scope != null) scope.launch {
            while (isActive) { delay(idleCheckMs); checkIdle() }
        }
    }

    /** Called with the reason whenever an open gate locks (not when it was already locked). Returns a remover. */
    public fun onLock(fn: (String?) -> Unit): () -> Unit { listeners += fn; return { listeners -= fn } }

    public fun unlock() { _unlocked.value = true; touch() }

    /** Locks now. True when the gate was open (and [onLock] listeners ran). */
    public fun lockNow(reason: String? = null): Boolean {
        awayTimer?.cancel(); awayTimer = null
        val was = _unlocked.value
        _unlocked.value = false
        if (was) listeners.toList().forEach { it(reason) }
        return was
    }

    /** Waits until settings have loaded (no-op without [ready]). */
    public suspend fun awaitReady() { ready?.first { it } }

    /** Delay before locking after leaving, in ms; 0 = right away. Null mode (no lock service) = 0. */
    public fun delayMs(): Long {
        if (mode() == null) return 0
        return autoLockMinutes().coerceAtLeast(0) * 60_000L
    }

    /** True when leaving never locks: no first step and the second step is "Nothing more". */
    private fun opensFreely(): Boolean = !firstStep && mode() == LockMode.NONE

    /** The app went to the background. */
    public fun onLeave(now: Long = clock()) {
        leftAt = now; away = true
        awayTimer?.cancel(); awayTimer = null
        if (!_unlocked.value || opensFreely()) return
        val d = delayMs()
        if (d <= 0) lockNow(AWAY)
        else if (scope != null) awayTimer = scope.launch { delay(d); lockNow(AWAY) }
    }

    /** The app came back (call once settings have loaded too). Locks when away long enough; opens only in "Nothing more" mode without a first step. */
    public fun onReturn(now: Long = clock()) {
        awayTimer?.cancel(); awayTimer = null
        val wasAway = away
        away = false
        val m = mode()
        if (m != null && opensFreely() && (ready?.value ?: true)) { leftAt = 0; unlock(); return }
        if (wasAway && _unlocked.value && shouldLock(leftAt, now, delayMs())) lockNow(AWAY)
        leftAt = 0
        touch(now)
    }

    /** Something was used: resets the idle timer. */
    public fun touch(now: Long = clock()) { lastActivity = now }

    /** Locks when open, in the foreground and unused for longer than [idleMinutes] (0 = never). True when it locked. */
    public fun checkIdle(now: Long = clock()): Boolean {
        val minutes = idleMinutes()
        if (!_unlocked.value || away || minutes <= 0 || !idleExpired(lastActivity, now, minutes * 60_000L)) return false
        return lockNow(idleReason(minutes))
    }

    public companion object {
        public const val AWAY: String = "Locked while the app was away."
        public fun idleReason(minutes: Int): String = "Locked after $minutes min without use."
        /** Away for at least the delay (a 0 delay always locks). */
        public fun shouldLock(leftAt: Long, now: Long, delayMs: Long): Boolean = now - leftAt >= delayMs
        /** Unused for strictly longer than the idle limit. */
        public fun idleExpired(lastActivity: Long, now: Long, limitMs: Long): Boolean = now - lastActivity > limitMs
    }
}
