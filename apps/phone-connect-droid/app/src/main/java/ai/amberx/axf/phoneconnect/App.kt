package ai.amberx.axf.phoneconnect

import ai.amberx.axf.data.DataModule
import ai.amberx.axf.hub.HubModule
import ai.amberx.axf.hub.HubOrigin
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.network.NetworkModule
import ai.amberx.axf.platform.AndroidPlatformModule
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.settings.SettingsModule

/**
 * Phone Connect. The look comes from axHub with the hub session the sign-in page leaves in the WebView cookie store,
 * so a skin or theme change in the console reaches the overlay live (Axf.colors / type / space / shapes), no new APK.
 */
class App : AxfApplication() {
    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), SettingsModule(),
        HubModule(hub = HubOrigin.DEFAULT, credentials = cookieCredentials { HubOrigin.DEFAULT }),
    ) + AndroidPlatformModule.placeholders()

    override fun onCreate() {
        super.onCreate()
        Wiring.install()
    }
}
