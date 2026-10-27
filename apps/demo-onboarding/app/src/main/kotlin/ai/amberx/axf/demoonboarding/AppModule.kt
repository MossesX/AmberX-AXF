package ai.amberx.axf.demoonboarding

import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution

/** The app's own module: routes, action handlers, settings groups and dialogs plug in here. */
class AppModule : BaseModule("ai.amberx.axf.demoonboarding", "AXF Demo — onboarding") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.onboarding")

    override fun register(ctx: ModuleContext) {
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("home", "Onboarding", icon = "shield", module = id)))
        // About comes from lib-settings (name + version from axf.manifest.json, plus `app.about`). Override any standard
        // action by contributing it here, e.g. ActionContribution("help.about", ActionMeta("About")) { _, _ -> … }.
    }
}
