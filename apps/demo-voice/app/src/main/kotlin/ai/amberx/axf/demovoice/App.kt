package ai.amberx.axf.demovoice

import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.voice.VoiceModule
import ai.amberx.axf.devtools.DevtoolsModule
import ai.amberx.axf.devtools.PluginManagerModule
import ai.amberx.axf.logging.LoggingModule
import ai.amberx.axf.nav.NavModule
import ai.amberx.axf.network.NetworkModule
import ai.amberx.axf.data.DataModule
import ai.amberx.axf.settings.SettingsModule
import ai.amberx.axf.ui.windows.WindowsModule
import ai.amberx.axf.hub.HubModule
import ai.amberx.axf.hub.cookieCredentials

/**
 * AXF Demo — voice — builds the kernel from app/src/main/assets/axf (manifest + assets) and these modules.
 * AxfApplication adds the platform + assets modules itself; everything else is listed here so the app
 * decides exactly which libraries it ships (the Dev Console's library picker edits this list).
 */
class App : AxfApplication() {
    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), NavModule(), SettingsModule(), LoggingModule(), DevtoolsModule(), PluginManagerModule(), WindowsModule(),
        VoiceModule(this),
        AppModule(),
    ) + developerModules()

    /**
     * Developer app (manifest `developer: { hub }`, `axf init --developer`): look + settings from axHub's data server with
     * the hub session the waiting screen's sign-in leaves in the WebView cookie store; waits for the hub otherwise.
     * An ordinary app has no `developer` in its manifest and gets nothing here.
     */
    private fun developerModules(): List<AxfModule> = manifest().developer?.let { d -> listOf(HubModule(hub = d.hub, credentials = cookieCredentials { d.hub })) } ?: emptyList()
}
