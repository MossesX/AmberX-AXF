package ai.amberx.axf.axnotes

import androidx.compose.runtime.Composable
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.axnotes.views.*

/**
 * The single activity. AxfActivity provides AxfRoot (theme, overlays, locals); the shell renders the active layout asset.
 * Every app ships the settings interface (lib-settings registers the `settings` view itself, with its Plugins tab) and
 * the Plugin Manager (Brett's rule): plugins never get a settings screen of their own; they add groups to Settings → Plugins.
 * Apps holding secrets set `android.secureWindow: true` in axf.manifest.json (FLAG_SECURE + WebView debugging off).
 */
class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        AppShell(
            views = mapOf(
                Selection.ROUTE_HOME to { HomeView() },
                Selection.ROUTE_EDITOR to { EditorView() },
                Selection.ROUTE_CAPTURE to { CaptureView() },
                "todos" to { TodosView() },
                "plugin-manager" to { PluginManagerScreen() },
            ),
            viewTitles = mapOf("plugin-manager" to "Plugin Manager"),
        )
    }
}
