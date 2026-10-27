package ai.amberx.axf.onboarding

/*
 * lib-onboarding — pure contracts (no Android types), so they unit-test on the JVM and other ports can mirror them.
 * Ported and generalised from Brett's ActiveX app (OnboardingScreens.kt + the "service stopped" state of its
 * accessibility service); nothing here is specific to that app.
 *
 * Library API level 1, version 0.1.0 (see OnboardingVersion).
 */

/** Version of this library's public contract. `API_LEVEL` is bumped only on an incompatible change. */
public object OnboardingVersion {
    public const val VERSION: String = "0.1.0"
    public const val API_LEVEL: Int = 1
}

/** What an app can ask for during first run. */
public enum class PermissionKind(public val id: String, public val icon: String, public val handOff: HandOff) {
    /** RECORD_AUDIO, runtime dialog. */
    MICROPHONE("microphone", "mic", HandOff.RUNTIME_DIALOG),
    /** CAMERA, runtime dialog. */
    CAMERA("camera", "camera", HandOff.RUNTIME_DIALOG),
    /** POST_NOTIFICATIONS on Android 13+ (always granted below 13), runtime dialog. */
    NOTIFICATIONS("notifications", "bell", HandOff.RUNTIME_DIALOG),
    /** SYSTEM_ALERT_WINDOW ("Draw over other apps"), system settings page for this app. */
    OVERLAY("overlay", "layers", HandOff.SYSTEM_SETTINGS),
    /** An accessibility service of this app, by class; guided hand-off to Settings → Accessibility. */
    ACCESSIBILITY("accessibility", "eye", HandOff.GUIDED_SETTINGS),
    /** Exemption from battery optimisation, system dialog. */
    BATTERY("battery", "power", HandOff.SYSTEM_SETTINGS);

    public companion object {
        public fun of(id: String?): PermissionKind? = entries.firstOrNull { it.id == id }
    }
}

/** How the grant is obtained. */
public enum class HandOff {
    /** An in-app runtime permission dialog. */
    RUNTIME_DIALOG,
    /** A system settings page opened for this app; the row re-checks when the app resumes. */
    SYSTEM_SETTINGS,
    /** A system settings page the user must navigate in; the flow shows a step-by-step guide first. */
    GUIDED_SETTINGS,
}

/**
 * One thing the app asks for. [why] is shown on the welcome screen and in the checklist row.
 * [required] items block "Continue"/"Finish" and, once revoked, put the app in a blocking recovery state;
 * optional ones only warn. For [PermissionKind.ACCESSIBILITY] set [serviceClass] (fully-qualified class name
 * of the app's AccessibilityService) — use [PermissionRequest.accessibility].
 */
public data class PermissionRequest(
    val kind: PermissionKind,
    val why: String,
    val required: Boolean = true,
    val label: String = defaultLabel(kind),
    val serviceClass: String? = null,
) {
    init {
        require(kind != PermissionKind.ACCESSIBILITY || !serviceClass.isNullOrBlank()) { "An accessibility request needs serviceClass" }
    }

    public companion object {
        public fun microphone(why: String, required: Boolean = true): PermissionRequest = PermissionRequest(PermissionKind.MICROPHONE, why, required)
        public fun camera(why: String, required: Boolean = true): PermissionRequest = PermissionRequest(PermissionKind.CAMERA, why, required)
        public fun notifications(why: String, required: Boolean = true): PermissionRequest = PermissionRequest(PermissionKind.NOTIFICATIONS, why, required)
        public fun overlay(why: String, required: Boolean = true): PermissionRequest = PermissionRequest(PermissionKind.OVERLAY, why, required)
        public fun battery(why: String, required: Boolean = false): PermissionRequest = PermissionRequest(PermissionKind.BATTERY, why, required)
        public fun accessibility(serviceClass: String, why: String, required: Boolean = true): PermissionRequest =
            PermissionRequest(PermissionKind.ACCESSIBILITY, why, required, serviceClass = serviceClass)

        public fun defaultLabel(kind: PermissionKind): String = when (kind) {
            PermissionKind.MICROPHONE -> "Microphone"
            PermissionKind.CAMERA -> "Camera"
            PermissionKind.NOTIFICATIONS -> "Notifications"
            PermissionKind.OVERLAY -> "Draw over other apps"
            PermissionKind.ACCESSIBILITY -> "Accessibility service"
            PermissionKind.BATTERY -> "Run in the background"
        }
    }
}

/** One line of the accessibility hand-off guide. */
public data class GuideStep(val title: String, val detail: String)

/** All the words of the flow, per app. Defaults are neutral; apps set at least [headline] and [intro]. */
public data class OnboardingWording(
    val headline: String = "A few things before we start",
    val intro: String = "This app needs some access to work. Here is exactly what and why.",
    val startLabel: String = "Set it up",
    val startHint: String = "About 1 minute · you can change any of this later",
    val checklistTitle: String = "Permissions",
    val checklistIntro: String = "Each one opens a system prompt. The next lights up when the previous one is done.",
    /** Optional note under the checklist (e.g. the accessibility warning Google shows). */
    val checklistNote: String? = null,
    val continueLabel: String = "Continue",
    val skipHint: String = "Optional items can be skipped; what they enable stays off.",
    val guideTitle: String = "Accessibility",
    val guideIntro: String = "Android makes you do this one in system settings. Here's the path, then come back and we'll confirm it's on.",
    /** Null = [OnboardingRules.defaultGuide] with the app name filled in. */
    val guide: List<GuideStep>? = null,
    val openSettingsLabel: String = "Open settings",
    val finishTitle: String = "Last thing",
    val batteryDetail: String = "Without this, Android may stop the app in the background after a few minutes.",
    val doneTitle: String = "You're all set",
    val doneMessage: String = "Everything is ready.",
    val finishLabel: String = "Start",
    val allowLabel: String = "Allow",
    val enableLabel: String = "Enable",
    val grantedLabel: String = "Done",
    val stepOf: String = "%d of %d",
)

/**
 * What an app declares: who it is, what it asks for (in order) and the words. [version] lets an app ask again
 * after it adds a requirement: onboarding counts as done only when the stored version is ≥ [version].
 * [ordered] = each row lights up only after the required rows above it are granted (the ported behaviour).
 */
public data class OnboardingSpec(
    val appId: String,
    val appName: String,
    val requests: List<PermissionRequest>,
    val wording: OnboardingWording = OnboardingWording(),
    val version: Int = 1,
    val ordered: Boolean = true,
) {
    init {
        require(appId.isNotBlank()) { "appId is required" }
        require(version >= 1) { "version starts at 1" }
        require(requests.map { it.kind to it.serviceClass }.toSet().size == requests.size) { "Duplicate permission request" }
    }

    /** Requests shown in the checklist (battery is asked on the finish step, as in the ported flow). */
    public val checklist: List<PermissionRequest> get() = requests.filter { it.kind != PermissionKind.BATTERY }
    public val battery: PermissionRequest? get() = requests.firstOrNull { it.kind == PermissionKind.BATTERY }
    public val accessibility: List<PermissionRequest> get() = requests.filter { it.kind == PermissionKind.ACCESSIBILITY }
}

/** The screens of the flow, in order. */
public sealed class OnboardingStep(public val id: String) {
    public data object Welcome : OnboardingStep("welcome")
    public data object Checklist : OnboardingStep("checklist")
    /** Guided hand-off for one accessibility service. Reached from its checklist row, not by "Continue". */
    public data class AccessibilityGuide(val request: PermissionRequest) : OnboardingStep("accessibility:${request.serviceClass}")
    /** Battery exemption (when asked for) + "You're all set". */
    public data object Finish : OnboardingStep("finish")
}

/**
 * Key for the grant map: one per request (two accessibility services are two keys).
 * Use [OnboardingRules.key] to build it.
 */
public typealias GrantKey = String

/** Live state of one checklist row. */
public data class ChecklistRow(
    val number: Int,
    val request: PermissionRequest,
    val granted: Boolean,
    /** Can be acted on now (ordered flows: every required row above is granted). */
    val active: Boolean,
)
