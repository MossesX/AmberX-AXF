package ai.amberx.axf.patches

import androidx.compose.runtime.Composable
import ai.amberx.axf.hub.HubSignInView
import ai.amberx.axf.hub.WebAppHolder
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.patches.views.TabView

/**
 * The single activity. AxfActivity provides AxfRoot (theme, overlays, locals, the developer-app waiting screen); the
 * shell renders the active layout asset: Patches' banner, the tab row (nav-menu `patches-tabs` as top tabs) and the tab
 * in front. The web views live in [WebAppHolder] for the activity's life, so switching tabs keeps every app loaded.
 * Every app ships the settings interface (lib-settings registers the `settings` view itself) and the Plugin Manager.
 */
class MainActivity : AxfActivity() {
    private val patches get() = application as App
    /** One web view per tab; `patches` is the embed id the apps inside see (`AXF-Embed/patches`). */
    private val holder: WebAppHolder by lazy { WebAppHolder("patches") }

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
        AppShell(
            views = views,
            viewTitles = AppModule.TABS.associate { it.id to it.label } + mapOf("plugin-manager" to "Plugin Manager"),
            viewIcons = AppModule.TABS.associate { it.id to it.icon },
        )
    }
}
