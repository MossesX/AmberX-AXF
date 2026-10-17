package {{PACKAGE}}

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext

/** {{LABEL}} — generated from the `{{TEMPLATE}}` library template. Contribute routes, actions, settings or services in register(). */
public class {{CLASS}}Module : BaseModule(ID, "{{LABEL}}") {
    override val provides: List<Capability> = listOf(Capability(ID, "{{DESCRIPTION}}"))
    override fun register(ctx: ModuleContext) { }
    public companion object { public const val ID: String = "{{MODULE_ID}}" }
}
