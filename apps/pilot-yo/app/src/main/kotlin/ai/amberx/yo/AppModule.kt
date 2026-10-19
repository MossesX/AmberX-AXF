package ai.amberx.yo

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind

/** The app's own module: routes, action handlers, settings groups and dialogs plug in here. */
class AppModule : BaseModule("ai.amberx.yo", "Yo") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging")

    override fun register(ctx: ModuleContext) {
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("home", "Home", icon = "home", module = id)))
        // Override a standard action instead of leaving the framework stub:
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("help.about", ActionMeta("About")) { _, _ ->
            ctx.service(AxfRuntime::class)?.toast("Yo on AmberX AXF 0.2.0", ToastKind.INFO, "About")
        })
    }
}
