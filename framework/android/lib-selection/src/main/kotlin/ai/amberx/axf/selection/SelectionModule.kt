package ai.amberx.axf.selection

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext

/**
 * lib-selection: entries in Android's text selection menu for any plugin (`android.process-text`). Nothing to
 * configure; listing the module shows the capability in the Plugin Manager so plugins can require it.
 */
public class SelectionModule : BaseModule(ID, "Text selection menu") {
    override val provides: List<Capability> = listOf(Capability("android.process-text", "Entries in every app's text selection menu (ACTION_PROCESS_TEXT)"))
    override fun register(ctx: ModuleContext) { ctx.services.register(SelectionModule::class, this, "android.process-text") }
    public companion object { public const val ID: String = "ai.amberx.axf.selection" }
}
