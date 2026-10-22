package ai.amberx.axf.hub

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.runtime.AxfRuntime

/**
 * lib-hub: an AXF app's connection to axHub.
 *
 * - **Developer apps:** its appearance (and later its other settings documents) come from axHub's data server through
 *   [HubAppearanceSource], which this module attaches to the runtime at start (`axf.appearance.source`). Off unless an
 *   app lists the module (Voice Vault, an offline vault, never does). [HubOrigin] (also allows localhost for dev) is
 *   the address rule for the appearance source and [HubSignInView].
 * - **Hub as it exists today:** hub address rules ([HubRules], https only), the approvals feed read with the app's own
 *   hub session ([HubClient], registered as `axf.hub`), sign-out on the hub, a web view locked to the hub's origin
 *   ([LockedWebView]), hub app downloads. Approvals, sessions and downloads always use [HubRules].
 *
 * The credential seam ([HubCredentials]) is the app's: AXHub and the Android console hand over the hub session cookie
 * their in-app sign-in left in the WebView cookie store ([cookieCredentials]); nothing is stored here. The hub protocol
 * (AXPP), hub push and the admin API are named placeholders ([placeholders]); AXPP is parked for Fable.
 */
public class HubModule(
    private val hub: String = HubOrigin.DEFAULT,
    private val appId: String? = null,
    private val credentials: HubCredentials = cookieCredentials { hub },
) : BaseModule(ID, "axHub") {
    override val provides: List<Capability> = listOf(
        Capability(CAPABILITY, "axHub connection: approvals feed, hub address rules, locked web view, hub downloads, data server documents (appearance@1 first), credentials seam"),
        Capability(APPEARANCE_CAPABILITY, "Appearance + settings from the axHub data server (developer apps)"),
    )
    public lateinit var source: HubAppearanceSource
        private set
    public lateinit var client: HubClient
        private set

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.require(AxfRuntime::class)
        source = HubAppearanceSource(hub, appId ?: runtime.manifest.appId, credentials)
        ctx.services.register(HubAppearanceSource::class, source, APPEARANCE_CAPABILITY)
        client = HubClient(HubSession.of(credentials))
        ctx.services.register(HubClient::class, client, CAPABILITY)
        ctx.services.register(HubModule::class, this)
        runtime.attachAppearanceSource(source)
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.hub"
        public const val CAPABILITY: String = "axf.hub"
        public const val APPEARANCE_CAPABILITY: String = "axf.appearance.source"

        /** The parts of the hub contract that aren't built yet, so later work plugs in without renaming anything. */
        public fun placeholders(): List<PlaceholderModule> = HubRules.PLACEHOLDERS.map { (cap, note) ->
            val short = cap.removePrefix("axf.hub.")
            PlaceholderModule("ai.amberx.axf.hub.$short", LABELS[short] ?: short, listOf(Capability(cap, note)))
        }
        private val LABELS = mapOf("axpp" to "Hub protocol (AXPP)", "push" to "Hub push", "admin-api" to "Hub admin API")
    }
}
