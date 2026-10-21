package ai.amberx.axf.patches

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import ai.amberx.axf.hub.HubSignInView
import ai.amberx.axf.hub.WebAppHolder
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.patches.views.BannerStrip
import ai.amberx.axf.patches.views.TabView

/**
 * The single activity. AxfActivity provides AxfRoot (theme, overlays, locals, the developer-app waiting screen); the
 * shell renders the active layout asset: Patches' banner, the tab row (nav-menu `patches-tabs` as top tabs) and the tab
 * in front. The web views live in [WebAppHolder] for the activity's life, so switching tabs keeps every app loaded.
 * Every app ships the settings interface (lib-settings registers the `settings` view itself) and the Plugin Manager.
 * Above it all sits the [BannerStrip]: the Dev Console's plugin banners, on screen whichever tab is in front.
 */
class MainActivity : AxfActivity() {
    private val patches get() = application as App
    /**
     * One web view per tab; `patches` is the embed id the apps inside see (`AXF-Embed/patches`), and Patches takes their
     * settings and notifications over (`AXF-Embed-Take/settings+notifications`): their own settings hooks disappear, and
     * what they ask for arrives here (the combined settings, the phone's notifications).
     */
    private val holder: WebAppHolder by lazy { WebAppHolder("patches", takes = AppModule.TAKES) }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        // Patches serves the phone's notifications: ask once for the permission (Android 13+), then start watching.
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 7)
        }
        openFrom(intent)
    }

    override fun onResume() {
        super.onResume()
        // Foreground services may only start while the app is in front.
        patches.appModule.syncWatch()
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        openFrom(intent)
    }

    /** A tapped notification names the tab to show (approvals → axHub, console alerts → Console). */
    private fun openFrom(intent: android.content.Intent?) {
        val tab = intent?.getStringExtra(ai.amberx.axf.patches.watch.PatchesAlerts.EXTRA_TAB) ?: return
        if (AppModule.TABS.any { it.id == tab }) runCatching { patches.kernel.runtime.navigate(tab) }
    }

    /** The waiting screen's "Sign in on the hub": the hub's own sign-in page; the session it leaves is every tab's session. */
    override val hubSignIn: @Composable (done: () -> Unit) -> Unit = { done -> HubSignInView(patches.appModule.hub, done = done) }

    override fun onDestroy() {
        if (isFinishing) holder.destroy()
        super.onDestroy()
    }

    @Composable
    override fun Content() {
        val module = patches.appModule
        val views = mutableMapOf<String, @Composable () -> Unit>("plugin-manager" to { PluginManagerScreen() })
        for (t in AppModule.TABS) views[t.id] = { TabView(holder, module, t.id) }
        // The combined settings (Patches · Console · Pilot · axHub) replaces the settings screen lib-settings registers.
        views["settings"] = { ai.amberx.axf.patches.views.CombinedSettings(holder, module) }
        // The column takes the status bar, so AppShell's own status-bar padding (same insets, now consumed) adds nothing.
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars)) {
            BannerStrip(holder, module)
            AppShell(
                views = views,
                modifier = Modifier.weight(1f),
                viewTitles = AppModule.TABS.associate { it.id to it.label } + mapOf("plugin-manager" to "Plugin Manager", "settings" to "Settings"),
                viewIcons = AppModule.TABS.associate { it.id to it.icon },
            )
        }
    }
}
