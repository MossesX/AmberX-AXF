package ai.amberx.axf.axhubandroid

import android.content.Intent
import android.os.Bundle
import androidx.compose.runtime.Composable
import ai.amberx.axf.axhubandroid.views.ApprovalsView
import ai.amberx.axf.axhubandroid.views.AppsView
import ai.amberx.axf.axhubandroid.views.HubAreaView
import ai.amberx.axf.axhubandroid.views.HubPageView
import ai.amberx.axf.axhubandroid.views.hubAreas
import ai.amberx.axf.axhubandroid.watch.Alerts
import ai.amberx.axf.axhubandroid.watch.hubPrefs
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.HubState
import ai.amberx.axf.hub.LockedWebView
import ai.amberx.axf.lock.GateWording
import ai.amberx.axf.lock.Gated
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.ui.shell.AppShell
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The single activity. A tapped approval alert lands here and opens that approval's hub page. Screens stay
 * out of screenshots/recents and WebView debugging is off (`android.secureWindow` in axf.manifest.json, applied
 * by AxfActivity), and the activity never shows over the lock screen, so an approval can't be made from a
 * locked phone. Every view, the app's and the libraries' (settings, PIN), sits behind the app lock.
 */
class MainActivity : AxfActivity() {
    private val axhub get() = application as App
    private val gate get() = axhub.appModule.gate
    private val wording = GateWording(
        title = "AXHub is locked", message = "Unlock to see approvals and your hub.",
        biometricTitle = "Unlock AXHub", biometricSubtitle = "Your hub admin session is in this app",
        pinTitle = "Enter your AXHub PIN", noPin = "No PIN is set for AXHub.",
        noLock = "The lock isn't available, so AXHub stays locked. Use Sign out and reset below.",
        resetMessage = "Sign out of the hub on this phone and turn the lock off. You'll sign in to the hub again.",
        resetButton = "Sign out and reset", resetConfirm = "Yes, sign out and reset",
    )

    override fun onCreate(savedInstanceState: Bundle?) {
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

    /**
     * The waiting screen's "Sign in on the hub": the hub's sign-in page in the app's own locked web view; done once it
     * leaves /auth/login. Order of the two gates: the developer-app waiting screen (AxfRoot) sits outside the app and
     * shows only the hub's status, so it needs no unlock; this web view carries the hub session cookie (a signed-in
     * session would land on the approvals page), so it sits behind the app lock like every view in AppShell's viewGuard.
     */
    override val hubSignIn: @Composable (done: () -> Unit) -> Unit = { done ->
        val base = hubPrefs(this).base
        Gated(gate, wording, onReset = { axhub.appModule.reset.signOutAndReset() }) {
            LockedWebView(base, HubRules.loginUrl(base), onPage = { url -> if (!url.contains("/auth/login") && !url.contains("/auth/first")) done() })
        }
    }

    private fun handle(i: Intent?) {
        // Reopened from recents: the old alert's extras come back with it; don't act on them twice.
        if (i == null || (i.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        val base = hubPrefs(this).base
        val id = i.getStringExtra(Alerts.EXTRA_APPROVAL)
        when {
            id != null -> HubRules.approvalUrl(base, id)?.let { HubState.open(it); kernel.runtime.navigate("hub") }
            i.getBooleanExtra(Alerts.EXTRA_OPEN_LIST, false) -> kernel.runtime.navigate("home")
        }
        i.removeExtra(Alerts.EXTRA_APPROVAL); i.removeExtra(Alerts.EXTRA_OPEN_LIST)
    }

    @Composable
    override fun Content() {
        // settings and lock-pin come from lib-settings / lib-lock; viewGuard locks them too.
        val views = mutableMapOf<String, @Composable () -> Unit>(
            "home" to { ApprovalsView() },
            "hub" to { HubPageView() },
            "apps" to { AppsView() },
        )
        hubAreas.forEach { a -> views[a.route] = { HubAreaView(a) } }
        AppShell(views = views, viewGuard = { _, content -> Gated(gate, wording, onReset = { axhub.appModule.reset.signOutAndReset() }) { content() } })
    }
}
