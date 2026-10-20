package ai.amberx.axf.axhubandroid

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.compose.runtime.Composable
import ai.amberx.axf.axhubandroid.hub.HubAddress
import ai.amberx.axf.axhubandroid.hub.HubState
import ai.amberx.axf.axhubandroid.hub.WatchPrefs
import ai.amberx.axf.axhubandroid.views.ApprovalsView
import ai.amberx.axf.axhubandroid.views.Gated
import ai.amberx.axf.axhubandroid.views.HubAreaView
import ai.amberx.axf.axhubandroid.views.HubPageView
import ai.amberx.axf.axhubandroid.views.SettingsView
import ai.amberx.axf.axhubandroid.views.hubAreas
import ai.amberx.axf.axhubandroid.watch.Alerts
import ai.amberx.axf.lock.PinSetupScreen
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.ui.shell.AppShell
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The single activity. A tapped approval alert lands here and opens that approval's hub page. Screens stay
 * out of screenshots/recents (FLAG_SECURE), and the activity never shows over the lock screen, so an
 * approval can't be made from a locked phone.
 */
class MainActivity : AxfActivity() {
    private val axhub get() = application as App
    private val gate get() = axhub.appModule.gate

    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
        Alerts.channels(this)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handle(intent) }

    override fun onStart() {
        super.onStart()
        // The lock mode is a saved setting: decide only once settings have loaded.
        axhub.appScope.launch { axhub.ready.first { it }; gate.onReturn() }
    }

    override fun onStop() { gate.onLeave(); super.onStop() }

    private fun handle(i: Intent?) {
        val base = WatchPrefs(this).base
        val id = i?.getStringExtra(Alerts.EXTRA_APPROVAL)
        when {
            id != null -> HubAddress.approval(base, id)?.let { HubState.open(it); kernel.runtime.navigate("hub") }
            i?.getBooleanExtra(Alerts.EXTRA_OPEN_LIST, false) == true -> kernel.runtime.navigate("home")
        }
    }

    @Composable
    override fun Content() {
        val views = mutableMapOf<String, @Composable () -> Unit>(
            "home" to { Gated(gate) { ApprovalsView() } },
            "hub" to { Gated(gate) { HubPageView() } },
            "settings" to { Gated(gate) { SettingsView() } },
            "lock-pin" to { Gated(gate) { PinSetupScreen() } },
        )
        hubAreas.forEach { a -> views[a.route] = { Gated(gate) { HubAreaView(a) } } }
        AppShell(views = views)
    }
}
