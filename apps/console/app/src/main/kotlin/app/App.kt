package ai.amberx.axf.console

import ai.amberx.axf.accounts.AccountsModule
import ai.amberx.axf.admin.AdminModule
import ai.amberx.axf.billing.BillingModule
import ai.amberx.axf.data.DataModule
import ai.amberx.axf.devtools.DevtoolsModule
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

/** AXF Dev Console — the first app on the Android port; it builds the framework while tracking it. */
class App : AxfApplication() {
    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), NavModule(), SettingsModule(), LoggingModule(), DevtoolsModule(), WindowsModule(),
        AccountsModule(), ProfileModule(), BillingModule(), AdminModule(), BrowserModule(), McpModule(),
        ConsoleModule(this),
    ) + AndroidPlatformModule.placeholders()
}
