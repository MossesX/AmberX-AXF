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
import ai.amberx.axf.network.AxfHttp

/**
 * {{LABEL}} — generated from the `{{TEMPLATE}}` library template. Registers an HTTP client, its settings and a Sync action.
 * Apps add it with `axf install {{SLUG}}` (or list {{CLASS}}Module() in App.kt) and map the "{{ROUTE}}" view to {{CLASS}}Screen.
 */
public class {{CLASS}}Module : BaseModule(ID, "{{LABEL}}") {
    override val provides: List<Capability> = listOf(Capability(ID, "{{DESCRIPTION}}"))
    override val dependsOn: List<String> = listOf("ai.amberx.axf.network")

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("{{ROUTE}}", "{{LABEL}}", icon = "box", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("{{ROUTE}}.open", ActionMeta("Open {{LABEL}}", module = id)) { _, _ -> runtime?.navigate("{{ROUTE}}") })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("{{ROUTE}}", "{{LABEL}}", "box", id, order = 100, settings = listOf(
            SettingSpec("{{ROUTE}}.enabled", "Enable {{LABEL}}", SettingKind.TOGGLE, default = JsonPrimitive(true)),
            SettingSpec("{{ROUTE}}.baseUrl", "API base URL", SettingKind.TEXT, default = JsonPrimitive("{{P_BASE_URL}}")),
            SettingSpec("{{ROUTE}}.token", "API token", SettingKind.SECRET),
        ))))
        ctx.services.register({{CLASS}}Client::class, {{CLASS}}Client(ctx.service(AxfHttp::class)), "{{MODULE_ID}}.client")
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("{{ROUTE}}.sync", ActionMeta("Sync {{LABEL}}", module = id)) { _, _ -> runtime?.toast("Sync for {{LABEL}} is not implemented yet.") })
    }

    public companion object { public const val ID: String = "{{MODULE_ID}}" }
}
