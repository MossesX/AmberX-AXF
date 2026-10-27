package ai.amberx.axf.demoonboarding

import ai.amberx.axf.onboarding.OnboardingSpec
import ai.amberx.axf.onboarding.OnboardingWording
import ai.amberx.axf.onboarding.PermissionRequest

/**
 * The demo's one onboarding spec (lib-onboarding): what it asks for, in order, and why. The manifest declares the
 * matching permissions (the library declares none). Raise [OnboardingSpec.version] to ask again after adding one.
 */
object DemoOnboarding {
    val spec = OnboardingSpec(
        appId = "demo-onboarding",
        appName = "Onboarding demo",
        requests = listOf(
            PermissionRequest.microphone("Required: shows how a required permission blocks Continue and, once revoked, the app."),
            PermissionRequest.notifications("Optional: a missing optional permission only warns.", required = false),
            PermissionRequest.overlay("Optional: a settings-page permission, re-checked when you come back.", required = false),
            PermissionRequest.battery("Asked on the last step: keeps background work alive."),
        ),
        wording = OnboardingWording(
            headline = "Onboarding, end to end.",
            intro = "This demo walks through lib-onboarding's first-run flow: why each permission is needed, a live checklist, then a last step.",
        ),
    )
}
