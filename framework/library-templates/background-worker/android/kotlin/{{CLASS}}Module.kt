package {{PACKAGE}}

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.serialization.json.JsonPrimitive
import ai.amberx.axf.kernel.contract.WorkRegistry

/**
 * {{LABEL}} — generated from the `{{TEMPLATE}}` library template. Registers a worker with the work registry plus a Run-now action.
 * Apps add it with `axf install {{SLUG}}` (or list {{CLASS}}Module() in App.kt) and map the "{{ROUTE}}" view to {{CLASS}}Screen.
 */
public class {{CLASS}}Module : BaseModule(ID, "{{LABEL}}") {
    override val provides: List<Capability> = listOf(Capability(ID, "{{DESCRIPTION}}"))
    override val dependsOn: List<String> = listOf()

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("{{ROUTE}}", "{{LABEL}}", icon = "box", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("{{ROUTE}}.open", ActionMeta("Open {{LABEL}}", module = id)) { _, _ -> runtime?.navigate("{{ROUTE}}") })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("{{ROUTE}}", "{{LABEL}}", "box", id, order = 100, settings = listOf(
            SettingSpec("{{ROUTE}}.enabled", "Enable {{LABEL}}", SettingKind.TOGGLE, default = JsonPrimitive(true)),
            SettingSpec("{{ROUTE}}.interval", "Run every (minutes)", SettingKind.NUMBER, default = JsonPrimitive({{P_INTERVAL}})),
        ))))
        ctx.service(WorkRegistry::class)?.register("{{ROUTE}}.run", {{CLASS}}Worker())
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("{{ROUTE}}.runNow", ActionMeta("Run {{LABEL}} now", module = id)) { _, _ -> runtime?.toast("{{LABEL}} queued — the scheduler is a placeholder until lib-work ships.") })
    }

    public companion object { public const val ID: String = "{{MODULE_ID}}" }
}
