package {{PACKAGE}}

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext

/** Registers {{CLASS}}Kit at the ui-kits extension point. Generated from the `{{TEMPLATE}}` library template. */
public class {{CLASS}}Module : BaseModule(ID, "{{LABEL}}") {
    override val provides: List<Capability> = listOf(Capability(ID, "{{DESCRIPTION}}"))
    override fun register(ctx: ModuleContext) { ctx.extensions.contribute(ExtensionPoints.UI_KITS, id, {{CLASS}}Kit) }
    public companion object { public const val ID: String = "{{MODULE_ID}}" }
}
