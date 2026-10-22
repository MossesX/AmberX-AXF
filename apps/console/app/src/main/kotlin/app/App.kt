package ai.amberx.axf.console

import ai.amberx.axf.accounts.AccountsModule
import ai.amberx.axf.admin.AdminModule
import ai.amberx.axf.billing.BillingModule
import ai.amberx.axf.data.DataModule
import ai.amberx.axf.devtools.DevtoolsModule
import ai.amberx.axf.devtools.PluginManagerModule
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.logging.LoggingModule
import ai.amberx.axf.mcp.McpModule
import ai.amberx.axf.nav.NavModule
import ai.amberx.axf.network.NetworkModule
import ai.amberx.axf.platform.AndroidPlatformModule
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.browser.BrowserModule
import ai.amberx.axf.profile.ProfileModule
import ai.amberx.axf.settings.SettingsModule
import ai.amberx.axf.ui.windows.WindowsModule
import ai.amberx.axf.hub.HubModule
import ai.amberx.axf.hub.HubOrigin
import ai.amberx.axf.hub.cookieCredentials

/** AXF Dev Console — the first app on the Android port; it builds the framework while tracking it. */
class App : AxfApplication() {
    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), NavModule(), SettingsModule(), LoggingModule(), DevtoolsModule(), PluginManagerModule(), WindowsModule(),
        AccountsModule(), ProfileModule(), BillingModule(), AdminModule(), BrowserModule(), McpModule(),
        // Developer app (decision Oct 20 2026): look + settings from axHub's data server with the hub session the
        // in-app sign-in (waiting screen → Sign in on the hub) leaves in the WebView cookie store; waits for the hub otherwise.
        HubModule(hub = HubOrigin.DEFAULT, credentials = cookieCredentials { HubOrigin.DEFAULT }),
        ConsoleModule(this),
    ) + AndroidPlatformModule.placeholders()
}
