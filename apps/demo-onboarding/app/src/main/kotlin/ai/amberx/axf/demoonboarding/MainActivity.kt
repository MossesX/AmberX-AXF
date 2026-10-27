package ai.amberx.axf.demoonboarding

import androidx.compose.runtime.Composable
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.onboarding.OnboardingGate
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.demoonboarding.views.HomeView

/**
 * The single activity. OnboardingGate shows lib-onboarding's flow until it is done, then the app with a recovery
 * banner (and the recovery screen while a required permission is off). lib-onboarding contributes `onboarding-status`.
 */
class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        OnboardingGate(DemoOnboarding.spec) {
            AppShell(
                views = mapOf("home" to { HomeView() }, "plugin-manager" to { PluginManagerScreen() }),
                viewTitles = mapOf("plugin-manager" to "Plugin Manager"),
            )
        }
    }
}
