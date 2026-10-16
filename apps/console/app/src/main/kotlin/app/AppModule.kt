package ai.amberx.axf.console

import android.content.Context
import ai.amberx.axf.data.JsonDocumentStore
import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingScope
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.DialogContribution
import ai.amberx.axf.ui.kit.UnstyledKit
import ai.amberx.axf.console.views.LibraryPickerDialog
import ai.amberx.axf.console.views.SuggestionsDialog
import kotlinx.serialization.json.JsonPrimitive

/** The console's own module: routes for every screen, actions, settings, the two dialogs, the repo service, the second UI kit. */
class ConsoleModule(private val context: Context) : BaseModule(ID, "AXF Dev Console") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.data", "ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.devtools")

    override fun register(ctx: ModuleContext) {
        val repo = ConsoleRepo(context, ctx.service(JsonDocumentStore::class))
        repo.load()
        ctx.services.register(ConsoleRepo::class, repo, "axf.console.repo")
        val runtime = ctx.service(AxfRuntime::class)
        for (r in ROUTES) ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(r))
        ctx.extensions.contribute(ExtensionPoints.UI_KITS, id, UnstyledKit)
        ctx.extensions.contribute(ExtensionPoints.DIALOGS, id, DialogContribution("suggest", "Suggested features", "layers") { st -> SuggestionsDialog(st.props["item"] ?: "") })
        ctx.extensions.contribute(ExtensionPoints.DIALOGS, id, DialogContribution("libpicker", "Build a library", "box") { st -> LibraryPickerDialog(st.props["library"] ?: "") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("help.about", ActionMeta("About", module = id)) { _, _ -> runtime?.openDialog("about") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("help.docs", ActionMeta("Documentation", module = id)) { _, _ -> runtime?.toast("Docs: framework/android/README.md and framework/spec/PORTING.md in the repo.", ToastKind.INFO, "Documentation") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("console.exportPlan", ActionMeta("Export build plan", module = id)) { _, c -> (c.extras["clipboard"] as? (String) -> Unit)?.invoke(repo.exportPlan()); runtime?.toast("Build plan copied — paste it into Claude Code.", ToastKind.SUCCESS, "Exported") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("console.exportStatus", ActionMeta("Export status.json", module = id)) { _, c -> (c.extras["clipboard"] as? (String) -> Unit)?.invoke(repo.exportStatusJson()); runtime?.toast("status.json fragment copied.", ToastKind.SUCCESS, "Exported") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("console.syncGithub", ActionMeta("Sync tracker to GitHub", "dev.deploy", module = id)) { _, _ -> runtime?.toast("GitHub sync is a wave-2 capability (axf.github). Export status.json and commit it for now.", ToastKind.WARNING, "Not built") })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("console", "Dev Console", "terminal", id, order = 50, settings = listOf(
            SettingSpec("console.repo", "Framework repository", SettingKind.TEXT, "GitHub owner/repo the tracker syncs with", JsonPrimitive("MossesX/AmberX-AXF"), SettingScope.DEVICE),
            SettingSpec("console.github.token", "GitHub token", SettingKind.SECRET, "Stored in the Keystore-backed secure store", JsonPrimitive(""), SettingScope.DEVICE),
            SettingSpec("console.demos.dir", "Demo apps folder (on the build machine)", SettingKind.TEXT, default = JsonPrimitive("apps"), scope = SettingScope.DEVICE),
            SettingSpec("console.export.plan", "Export build plan for Claude Code", SettingKind.ACTION, target = "console.exportPlan", icon = "copy"),
            SettingSpec("console.export.status", "Export status.json", SettingKind.ACTION, target = "console.exportStatus", icon = "copy"),
        ))))
    }

    companion object {
        const val ID = "ai.amberx.axf.console"
        val ROUTES = listOf(
            RouteSpec("home", "Home", "home", module = ID, group = "Console"),
            RouteSpec("tracker", "Tracker", "list", module = ID, group = "Console"),
            RouteSpec("catalog", "Feature catalog", "layers", module = ID, group = "Console"),
            RouteSpec("libraries", "Libraries", "box", module = ID, group = "Console"),
            RouteSpec("demos", "Demo apps", "play", module = ID, group = "Console"),
            RouteSpec("modules", "Modules & packages", "grid", module = ID, group = "Console"),
            RouteSpec("boilerplates", "Boilerplates", "file", module = ID, group = "Console"),
            RouteSpec("assets", "Assets", "palette", module = ID, group = "Framework"),
            RouteSpec("components", "Components", "zap", module = ID, group = "Framework"),
            RouteSpec("designer", "Theme designer", "type", module = ID, group = "Framework"),
            RouteSpec("layouts", "Layouts", "layout", module = ID, group = "Framework"),
            RouteSpec("roles", "Roles", "shield", module = ID, group = "Framework"),
            RouteSpec("actions", "Actions", "terminal", module = ID, group = "Framework"),
        )
        val VERSION = AxfVersion.FRAMEWORK
    }
}
