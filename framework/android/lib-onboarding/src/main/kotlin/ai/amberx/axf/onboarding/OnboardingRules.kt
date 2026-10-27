package ai.amberx.axf.onboarding

import ai.amberx.axf.kernel.platform.KeyValueStore

/**
 * Pure rules of the flow: spec → steps, rows, navigation and completion. Grants are a map of [GrantKey] → granted;
 * a missing key counts as not granted (fails closed).
 */
public object OnboardingRules {

    /** Grant-map key of a request: the kind id, plus the service class for accessibility services. */
    public fun key(request: PermissionRequest): GrantKey =
        if (request.serviceClass != null) "${request.kind.id}:${request.serviceClass}" else request.kind.id

    /**
     * The flow's steps, in order: Welcome → Checklist (when anything besides battery is asked) → one guide per
     * accessibility service → Finish. A spec that asks for nothing is just Welcome → Finish.
     */
    public fun steps(spec: OnboardingSpec): List<OnboardingStep> = buildList {
        add(OnboardingStep.Welcome)
        if (spec.checklist.isNotEmpty()) add(OnboardingStep.Checklist)
        spec.accessibility.forEach { add(OnboardingStep.AccessibilityGuide(it)) }
        add(OnboardingStep.Finish)
    }

    /** Position for the "n of total" header: 1-based index of [step] in [steps]; 0 when absent. */
    public fun position(spec: OnboardingSpec, step: OnboardingStep): Int = steps(spec).indexOf(step) + 1

    /** Where "Continue" goes from [step]: guides are reached only from their rows, so Checklist jumps to Finish. */
    public fun next(spec: OnboardingSpec, step: OnboardingStep): OnboardingStep? = when (step) {
        OnboardingStep.Welcome -> if (spec.checklist.isNotEmpty()) OnboardingStep.Checklist else OnboardingStep.Finish
        OnboardingStep.Checklist -> OnboardingStep.Finish
        is OnboardingStep.AccessibilityGuide -> OnboardingStep.Checklist
        OnboardingStep.Finish -> null
    }

    /** Where "Back" goes; null = leave the flow. */
    public fun back(spec: OnboardingSpec, step: OnboardingStep): OnboardingStep? = when (step) {
        OnboardingStep.Welcome -> null
        OnboardingStep.Checklist -> OnboardingStep.Welcome
        is OnboardingStep.AccessibilityGuide -> OnboardingStep.Checklist
        OnboardingStep.Finish -> if (spec.checklist.isNotEmpty()) OnboardingStep.Checklist else OnboardingStep.Welcome
    }

    /** Step for a saved id (process restore); unknown ids fall back to Welcome. */
    public fun stepOf(spec: OnboardingSpec, id: String?): OnboardingStep = steps(spec).firstOrNull { it.id == id } ?: OnboardingStep.Welcome

    public fun granted(request: PermissionRequest, grants: Map<GrantKey, Boolean>): Boolean = grants[key(request)] == true

    /** Checklist rows with live state. Ordered specs: a row is active once every *required* row above it is granted. */
    public fun rows(spec: OnboardingSpec, grants: Map<GrantKey, Boolean>): List<ChecklistRow> {
        var blocked = false
        return spec.checklist.mapIndexed { i, r ->
            val g = granted(r, grants)
            val row = ChecklistRow(i + 1, r, g, active = !spec.ordered || !blocked)
            if (r.required && !g) blocked = true
            row
        }
    }

    /** Required requests not granted (all kinds, battery included). */
    public fun missing(spec: OnboardingSpec, grants: Map<GrantKey, Boolean>): List<PermissionRequest> =
        spec.requests.filter { it.required && !granted(it, grants) }

    /** "Continue" on the checklist: every required checklist item is granted. */
    public fun canContinue(spec: OnboardingSpec, grants: Map<GrantKey, Boolean>): Boolean =
        spec.checklist.all { !it.required || granted(it, grants) }

    /** "Start" on the finish step: every required request (battery too, when required) is granted. */
    public fun canFinish(spec: OnboardingSpec, grants: Map<GrantKey, Boolean>): Boolean = missing(spec, grants).isEmpty()

    /** The guide a request's row opens, or null when its row acts directly. */
    public fun guideFor(request: PermissionRequest): OnboardingStep? =
        if (request.kind.handOff == HandOff.GUIDED_SETTINGS) OnboardingStep.AccessibilityGuide(request) else null

    /** Default accessibility guide (the ported wording, app name filled in). */
    public fun defaultGuide(appName: String): List<GuideStep> = listOf(
        GuideStep("Tap \"Open settings\" below", "Lands on Settings › Accessibility"),
        GuideStep("Find $appName under \"Installed apps\"", "Some phones (Samsung) list it under Accessibility › Installed apps"),
        GuideStep("Turn on \"Use $appName\" and tap Allow", "Android shows a full-screen warning first. Read it, then Allow."),
        GuideStep("Come back to $appName", "It's checked automatically, no need to tap anything here."),
    )

    /** "n of total" text for [step]. */
    public fun progressLabel(spec: OnboardingSpec, step: OnboardingStep): String =
        spec.wording.stepOf.replaceFirst("%d", position(spec, step).toString()).replaceFirst("%d", steps(spec).size.toString())
}

/**
 * Persists "onboarding done" per app in the kernel's [KeyValueStore] as the spec version that was completed
 * (key `axf.onboarding.<appId>.done`). Done = stored version ≥ spec version, so raising
 * [OnboardingSpec.version] asks again. A corrupt value counts as not done.
 */
public class OnboardingStore(private val kv: KeyValueStore) {
    public fun key(appId: String): String = "$PREFIX$appId.done"

    public fun completedVersion(appId: String): Int? = kv.get(key(appId))?.trim()?.toIntOrNull()

    public fun isDone(spec: OnboardingSpec): Boolean = isDone(completedVersion(spec.appId), spec.version)

    public fun markDone(spec: OnboardingSpec) { kv.put(key(spec.appId), spec.version.toString()) }

    public fun reset(appId: String) { kv.remove(key(appId)) }

    public companion object {
        public const val PREFIX: String = "axf.onboarding."

        /** Completion rule, pure: a stored version at least the spec's. */
        public fun isDone(stored: Int?, specVersion: Int): Boolean = stored != null && stored >= specVersion
    }
}
