package {{APPLICATION_ID}}

import androidx.compose.runtime.Composable
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.settings.SettingsScreen
import ai.amberx.axf.ui.shell.AppShell
import {{APPLICATION_ID}}.views.HomeView

/**
 * The single activity. AxfActivity provides AxfRoot (theme, overlays, locals); the shell renders the active layout asset.
 * Every app ships the settings interface (lib-settings, with its Plugins tab) and the Plugin Manager (Brett's rule):
 * plugins never get a settings screen of their own; they add groups to Settings → Plugins.
 */
class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        AppShell(
            views = mapOf("home" to { HomeView() }, "settings" to { SettingsScreen() }, "plugin-manager" to { PluginManagerScreen() }),
            viewTitles = mapOf("settings" to "Settings", "plugin-manager" to "Plugin Manager"),
        )
    }
}
