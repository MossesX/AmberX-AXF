package ai.amberx.axf.patches

import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.devtools.DevtoolsModule
import ai.amberx.axf.devtools.PluginManagerModule
import ai.amberx.axf.logging.LoggingModule
import ai.amberx.axf.nav.NavModule
import ai.amberx.axf.network.NetworkModule
import ai.amberx.axf.data.DataModule
import ai.amberx.axf.settings.SettingsModule
import ai.amberx.axf.ui.windows.WindowsModule
import ai.amberx.axf.hub.HubModule
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.cookieCredentials

/**
 * Patches — one banner, three tabs: the Dev Console, Build Pilot and axHub, each a web app in its own tab (embed@1 host).
 * Builds the kernel from app/src/main/assets/axf (manifest + assets) and these modules. AxfApplication adds the
 * platform + assets modules itself; everything else is listed here so the app decides exactly which libraries it ships.
 */
class App : AxfApplication() {
    /** The hub's address: manifest `developer.hub` (https host only), else lib-hub's default. */
    val hub: String by lazy { manifest().developer?.hub?.let { HubRules.normalize(it) } ?: HubRules.DEFAULT }
    val appModule: AppModule by lazy { AppModule(this, hubAddress = { hub }) }

    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), NavModule(), SettingsModule(), LoggingModule(), DevtoolsModule(), PluginManagerModule(), WindowsModule(),
        appModule,
    ) + developerModules() + AppModule.placeholders()

    /**
     * Developer app (manifest `developer: { hub }`, `axf init --developer`): look + settings from axHub's data server with
     * the hub session the waiting screen's sign-in leaves in the WebView cookie store — the same cookie store every tab's
     * web view uses, so one sign-in is the session of the console, Pilot and the hub alike. Waits for the hub otherwise.
     */
    private fun developerModules(): List<AxfModule> = manifest().developer?.let { d -> listOf(HubModule(hub = d.hub, credentials = cookieCredentials { d.hub })) } ?: emptyList()
}
