package ai.amberx.axf.voicevault

import android.os.Bundle
import android.view.WindowManager
import androidx.compose.runtime.Composable
import ai.amberx.axf.lock.PinSetupScreen
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.voice.VoiceTriggersScreen
import ai.amberx.axf.voicevault.views.HomeView
import ai.amberx.axf.voicevault.views.SettingsView
import ai.amberx.axf.voicevault.views.UnlockCodeView
import ai.amberx.axf.voicevault.views.UnlockedOnly
import ai.amberx.axf.voicevault.views.VaultListView

/**
 * The single activity. Screens are kept out of screenshots and the recents preview (FLAG_SECURE),
 * the vault session hears about foreground/background for auto-lock, and every screen but Voice
 * needs the vault unlocked.
 */
class MainActivity : AxfActivity() {
    private val session get() = (application as App).appModule.session

    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
        session.attach(this)
    }

    override fun onStart() { super.onStart(); session.onForeground() }
    override fun onStop() { session.onBackground(); super.onStop() }
    override fun onDestroy() { session.detach(this); super.onDestroy() }

    @Composable
    override fun Content() {
        AppShell(views = mapOf(
            "home" to { HomeView() },
            "vault" to { UnlockedOnly { VaultListView() } },
            "voice-triggers" to { UnlockedOnly { VoiceTriggersScreen() } },
            "unlock-code" to { UnlockedOnly { UnlockCodeView() } },
            "lock-pin" to { UnlockedOnly { PinSetupScreen() } },
            "settings" to { UnlockedOnly { SettingsView() } },
        ))
    }
}
