package {{APPLICATION_ID}}

import androidx.compose.runtime.Composable
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.ui.shell.AppShell
import {{APPLICATION_ID}}.views.HomeView

/** The single activity. AxfActivity provides AxfRoot (theme, overlays, locals); the shell renders the active layout asset. */
class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        AppShell(views = mapOf("home" to { HomeView() }))
    }
}
