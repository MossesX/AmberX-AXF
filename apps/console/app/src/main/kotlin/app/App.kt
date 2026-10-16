package ai.amberx.axf.console

import ai.amberx.axf.accounts.AccountsModule
import ai.amberx.axf.admin.AdminModule
import ai.amberx.axf.billing.BillingModule
import ai.amberx.axf.data.DataModule
import ai.amberx.axf.devtools.DevtoolsModule
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.logging.LoggingModule
import ai.amberx.axf.nav.NavModule
import ai.amberx.axf.network.NetworkModule
import ai.amberx.axf.platform.AndroidPlatformModule
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.profile.ProfileModule
import ai.amberx.axf.settings.SettingsModule

/** AXF Dev Console — the first app on the Android port; it builds the framework while tracking it. */
class App : AxfApplication() {
    override fun modules(): List<AxfModule> = listOf(
        DataModule(this), NetworkModule(), NavModule(), SettingsModule(), LoggingModule(), DevtoolsModule(),
        AccountsModule(), ProfileModule(), BillingModule(), AdminModule(),
        ConsoleModule(this),
    ) + AndroidPlatformModule.placeholders()
}
