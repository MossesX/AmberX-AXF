package ai.amberx.axf.console

import androidx.compose.runtime.Composable
import ai.amberx.axf.accounts.AccountScreen
import ai.amberx.axf.admin.AdminScreen
import ai.amberx.axf.billing.SubscriptionScreen
import ai.amberx.axf.console.views.BoilerplatesView
import ai.amberx.axf.console.views.CatalogView
import ai.amberx.axf.console.views.ConsoleInspector
import ai.amberx.axf.console.views.DemosView
import ai.amberx.axf.console.views.HomeView
import ai.amberx.axf.console.views.LibrariesView
import ai.amberx.axf.console.views.ModulesView
import ai.amberx.axf.console.views.TrackerView
import ai.amberx.axf.devtools.DevtoolsScreen
import ai.amberx.axf.devtools.PluginManagerScreen
import ai.amberx.axf.logging.LogsScreen
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.profile.ProfileScreen
import ai.amberx.axf.settings.SettingsScreen
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.ui.studio.ActionConsole
import ai.amberx.axf.ui.studio.AssetGallery
import ai.amberx.axf.ui.studio.ComponentGallery
import ai.amberx.axf.ui.studio.LayoutGallery
import ai.amberx.axf.ui.studio.RolePanel
import ai.amberx.axf.ui.studio.ThemeDesigner

class MainActivity : AxfActivity() {
    @Composable
    override fun Content() {
        AppShell(
            views = mapOf(
                "home" to { HomeView() }, "tracker" to { TrackerView() }, "catalog" to { CatalogView() }, "libraries" to { LibrariesView() },
                "demos" to { DemosView() }, "modules" to { ModulesView() }, "boilerplates" to { BoilerplatesView() },
                "assets" to { AssetGallery() }, "components" to { ComponentGallery() }, "designer" to { ThemeDesigner() }, "layouts" to { LayoutGallery() },
                "roles" to { RolePanel() }, "actions" to { ActionConsole() }, "devtools" to { DevtoolsScreen() },
                "settings" to { SettingsScreen() }, "logs" to { LogsScreen() }, "plugin-manager" to { PluginManagerScreen() },
                "account" to { AccountScreen() }, "profile" to { ProfileScreen() }, "subscription" to { SubscriptionScreen() }, "admin" to { AdminScreen() },
            ),
            viewTitles = ConsoleModule.ROUTES.associate { it.id to it.label } + mapOf("devtools" to "Developer tools", "settings" to "Settings", "logs" to "Logs", "plugin-manager" to "Plugin Manager", "account" to "Account", "profile" to "Profile", "subscription" to "Subscription", "admin" to "Administration"),
            inspector = { ConsoleInspector() },
        )
    }
}
