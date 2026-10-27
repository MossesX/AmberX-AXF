package ai.amberx.axf.axnotes

import androidx.compose.runtime.Composable
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.onboarding.OnboardingGate
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.axnotes.views.*

/**
 * The single activity. AxfActivity provides AxfRoot (theme, overlays, locals); the shell renders the active layout asset.
 * lib-onboarding's gate runs the first-run permissions flow (AppModule.ONBOARDING: microphone, notifications, overlay,
 * battery) before the app, and a recovery banner / screen when a required permission is revoked later.
 * `settings` is AX Notes' own settings view (library groups by tab + Plugins sub-tabs, lib-settings' full view under
 * "All settings"); plugins never get a settings screen of their own, they add groups that show as their sub-tab.
 * Apps holding secrets set `android.secureWindow: true` in axf.manifest.json (FLAG_SECURE + WebView debugging off).
 */
class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        OnboardingGate(AppModule.ONBOARDING) {
            AppShell(
                views = mapOf(
                    Selection.ROUTE_HOME to { HomeView() },
                    Selection.ROUTE_EDITOR to { EditorView() },
                    Selection.ROUTE_CAPTURE to { CaptureView() },
                    Selection.ROUTE_LISTS to { ListsView() },
                    Selection.ROUTE_LIST to { ListView() },
                    Selection.ROUTE_TODO to { TodoItemView() },
                    ROUTE_SETTINGS to { SettingsView() },
                    "plugin-manager" to { PluginManagerScreen() },
                ),
                viewTitles = mapOf("plugin-manager" to "Plugin Manager", ROUTE_SETTINGS to "Settings"),
            )
        }
    }

    private companion object { const val ROUTE_SETTINGS = "settings" }
}
