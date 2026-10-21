package ai.amberx.axf.hub

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.runtime.AxfRuntime

/**
 * lib-hub — makes an Android app a **developer app**: its appearance (and later its other settings documents)
 * come from axHub's data server through [HubAppearanceSource], which this module attaches to the runtime at
 * start. Off unless an app lists the module (Voice Vault, an offline vault, never does). The credential seam
 * ([HubCredentials]) is the app's: AXHub and the Android console hand over the hub session cookie their in-app
 * sign-in left in the WebView cookie store; nothing is stored here.
 */
public class HubModule(
    private val hub: String = HubOrigin.DEFAULT,
    private val appId: String? = null,
    private val credentials: HubCredentials,
) : BaseModule(ID, "axHub") {
    override val provides: List<Capability> = listOf(
        Capability("axf.hub", "axHub connection: data server documents (appearance@1 first), credentials seam"),
        Capability("axf.appearance.source", "Appearance + settings from the axHub data server (developer apps)"),
    )
    public lateinit var source: HubAppearanceSource
        private set

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.require(AxfRuntime::class)
        source = HubAppearanceSource(hub, appId ?: runtime.manifest.appId, credentials)
        ctx.services.register(HubAppearanceSource::class, source, "axf.appearance.source")
        ctx.services.register(HubModule::class, this, "axf.hub")
        runtime.attachAppearanceSource(source)
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.hub"
    }
}
