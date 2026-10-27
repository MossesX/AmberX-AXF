package ai.amberx.axf.onboarding

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Why a request needs fixing after onboarding. */
public enum class RecoveryReason {
    /** The user (or the system) took the permission back, or switched the accessibility service off. */
    REVOKED,
    /** The service is still switched on in settings but its process was stopped (battery optimisation, update, force stop). */
    SERVICE_STOPPED,
}

/** One problem: which request, why, and whether the app can work without it. */
public data class RecoveryIssue(val request: PermissionRequest, val reason: RecoveryReason) {
    public val blocking: Boolean get() = request.required
}

/**
 * The app's health against its spec. [Ok] = nothing to fix; [NeedsAttention] lists issues, blocking ones
 * (required requests) first. Apps show [RecoveryBanner] for any issue and [RecoveryScreen] when [blocking].
 */
public sealed class RecoveryState {
    public data object Ok : RecoveryState()
    public data class NeedsAttention(val issues: List<RecoveryIssue>) : RecoveryState() {
        public val blocking: Boolean get() = issues.any { it.blocking }
        public val stopped: Boolean get() = issues.any { it.reason == RecoveryReason.SERVICE_STOPPED }
    }

    public val isOk: Boolean get() = this is Ok

    public companion object {
        /**
         * Pure rule. [grants] = live grant map; [alive] = heartbeat per accessibility service class (null / absent =
         * unknown, never reported as stopped: after a process restart the system rebinds the service by itself).
         * Battery exemption lost is reported like any revoked request. Nothing is checked before onboarding is done.
         */
        public fun evaluate(spec: OnboardingSpec, onboardingDone: Boolean, grants: Map<GrantKey, Boolean>, alive: Map<String, Boolean?> = emptyMap()): RecoveryState {
            if (!onboardingDone) return Ok
            val issues = spec.requests.mapNotNull { r ->
                when {
                    !OnboardingRules.granted(r, grants) -> RecoveryIssue(r, RecoveryReason.REVOKED)
                    r.kind == PermissionKind.ACCESSIBILITY && r.serviceClass?.let { alive[it] } == false -> RecoveryIssue(r, RecoveryReason.SERVICE_STOPPED)
                    else -> null
                }
            }.sortedByDescending { it.blocking }
            return if (issues.isEmpty()) Ok else NeedsAttention(issues)
        }
    }
}

/**
 * Process-wide liveness of an app's long-running services (generalises ActiveX's `alive` flag). The service calls
 * [up] in `onServiceConnected` / `onCreate` and [down] in `onDestroy` / `onUnbind`; the recovery checker reads [alive].
 * A service never seen is unknown (absent), not stopped.
 */
public object ServiceHeartbeat {
    private val _alive = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    public val alive: StateFlow<Map<String, Boolean>> = _alive.asStateFlow()

    public fun up(serviceClass: String) { _alive.value = _alive.value + (serviceClass to true) }
    public fun down(serviceClass: String) { _alive.value = _alive.value + (serviceClass to false) }
    public fun forget(serviceClass: String) { _alive.value = _alive.value - serviceClass }
    public fun isAlive(serviceClass: String): Boolean? = _alive.value[serviceClass]
}

/** Words of the recovery banner/screen, per app. */
public data class RecoveryWording(
    val bannerRevoked: String = "Some permissions were turned off",
    val bannerStopped: String = "A background service stopped",
    val fixLabel: String = "Fix",
    val screenTitle: String = "Something stopped working",
    val screenMessage: String = "Android turned off something this app needs. Your data is still saved; nothing can run until it's back on.",
    val statusTitle: String = "Status",
    val causesTitle: String = "Why this happens",
    val causes: List<GuideStep> = listOf(
        GuideStep("Battery optimisation stopped it", "Most common. Exempt the app and it stops happening."),
        GuideStep("The app was updated", "Android turns accessibility services off after some updates."),
        GuideStep("Force-stopped or restarted", "Swiping the app away from Recents does this on some phones."),
    ),
    val onLabel: String = "on",
    val offLabel: String = "off",
    val stoppedLabel: String = "stopped",
    val batteryFixLabel: String = "Fix battery optimisation too",
)
