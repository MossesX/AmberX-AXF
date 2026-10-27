package ai.amberx.axf.demoonboarding.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.demoonboarding.DemoOnboarding
import ai.amberx.axf.onboarding.OnboardingModule
import ai.amberx.axf.onboarding.OnboardingRules
import ai.amberx.axf.onboarding.OnboardingService
import ai.amberx.axf.onboarding.RecoveryBanner
import ai.amberx.axf.onboarding.RecoveryIssue
import ai.amberx.axf.onboarding.RecoveryReason
import ai.amberx.axf.onboarding.RecoveryState
import ai.amberx.axf.onboarding.rememberGrants
import ai.amberx.axf.onboarding.rememberRecoveryState
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf

/** What's behind the gate: the live grants, the recovery state (with a banner preview) and "run setup again". */
@Composable
fun HomeView() {
    val spec = DemoOnboarding.spec
    val runtime = LocalAxfRuntime.current
    val service = rememberService<OnboardingService>()
    val grants = rememberGrants(spec)
    val recovery = rememberRecoveryState(spec, onboardingDone = true)
    var preview by remember { mutableStateOf(false) }
    val sample = remember(spec) { RecoveryState.NeedsAttention(listOf(RecoveryIssue(spec.requests.first(), RecoveryReason.REVOKED))) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = "What this shows", icon = "info") {
            AxfText("You just went through lib-onboarding's first-run flow (OnboardingGate). It is shown once per spec version; the app is behind it. Turn the microphone off in Android settings and come back: the gate shows the recovery screen, then a banner.")
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Live permissions", icon = "shield") {
            AxfText("Re-checked every time you come back to the app.", muted = true)
            spec.requests.forEach { r ->
                val on = grants[OnboardingRules.key(r)] == true
                AxfText("${if (on) "✓" else "✗"}  ${r.label}${if (r.required) " (required)" else " (optional)"}", color = if (on) Axf.colors.success else if (r.required) Axf.colors.danger else Axf.colors.warning)
            }
            AxfText(if (recovery.isOk) "Recovery state: Ok." else "Recovery state: needs attention.", muted = true)
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Recovery banner", icon = "alert") {
            AxfSwitch(preview, { preview = it }, Modifier.fillMaxWidth(), label = "Preview the banner", description = "As if the microphone had been turned off after setup.")
            if (preview) RecoveryBanner(sample, onFix = { runtime.navigate(OnboardingModule.ROUTE_STATUS) })
            else RecoveryBanner(recovery, onFix = { runtime.navigate(OnboardingModule.ROUTE_STATUS) })
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Run setup again", { service?.reset() }, tone = ButtonTone.PRIMARY, icon = "refresh", enabled = service != null)
            AxfButton("Setup status", { runtime.navigate(OnboardingModule.ROUTE_STATUS) }, tone = ButtonTone.GHOST, icon = "check-circle")
        }
    }
}
