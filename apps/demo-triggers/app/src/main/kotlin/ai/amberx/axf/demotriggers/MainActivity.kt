package ai.amberx.axf.demotriggers

import androidx.compose.runtime.Composable
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.demotriggers.views.HomeView

/** The single activity: the walkthrough (home); lib-triggers contributes its own `triggers` view to the shell. */
class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        AppShell(
            views = mapOf("home" to { HomeView() }, "plugin-manager" to { PluginManagerScreen() }),
            viewTitles = mapOf("plugin-manager" to "Plugin Manager"),
        )
    }
}
