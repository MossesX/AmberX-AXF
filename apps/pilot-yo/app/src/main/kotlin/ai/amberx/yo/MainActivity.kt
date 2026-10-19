package ai.amberx.yo

import androidx.compose.runtime.Composable
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.yo.views.*

/** The single activity. AxfActivity provides AxfRoot (theme, overlays, locals); the shell renders the active layout asset. */
class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        AppShell(views = mapOf("home" to { HomeView() }, "editor" to { EditorView() }, "todos" to { TodosView() }, "settings" to { SettingsView() }))
    }
}
