package {{PACKAGE}}

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext

/**
 * {{LABEL}} — scaffolded by `axf new-module`. Starts life as a placeholder: its capabilities resolve to
 * typed NotImplemented answers until the real implementation registers services for them.
 */
public class {{CLASS_NAME}} : BaseModule("{{MODULE_ID}}", "{{LABEL}}") {
    override val provides: List<Capability> = listOf({{CAPABILITIES}})
    override val dependsOn: List<String> = listOf({{DEPENDS_ON}})
    override val placeholder: Boolean get() = true

    override fun register(ctx: ModuleContext) {
        // Contribute routes, actions, settings groups, dialogs here (see ai.amberx.axf.kernel.module.ExtensionPoints).
    }
}
