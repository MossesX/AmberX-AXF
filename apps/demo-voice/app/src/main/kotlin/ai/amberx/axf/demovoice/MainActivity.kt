package ai.amberx.axf.demovoice

import androidx.compose.runtime.Composable
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.voice.VoiceModule
import ai.amberx.axf.voice.VoiceTriggersScreen
import ai.amberx.axf.demovoice.views.HandsFreeView
import ai.amberx.axf.demovoice.views.HomeView

/** The single activity: Dictation (home), Hands-free, lib-voice's Voice triggers screen and the Plugin Manager. */
class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        AppShell(
            views = mapOf(
                "home" to { HomeView() },
                AppModule.HANDS_FREE_ROUTE to { HandsFreeView() },
                VoiceModule.ROUTE to { VoiceTriggersScreen() },
                "plugin-manager" to { PluginManagerScreen() },
            ),
            viewTitles = mapOf("plugin-manager" to "Plugin Manager"),
        )
    }
}
