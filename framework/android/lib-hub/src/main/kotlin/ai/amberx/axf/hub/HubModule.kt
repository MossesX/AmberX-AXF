package ai.amberx.axf.hub

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule

/**
 * lib-hub: an AXF app's connection to axHub as it exists today — hub address rules ([HubRules]), the approvals feed read
 * with the app's own hub session ([HubClient]), sign-out on the hub, a web view locked to the hub's origin
 * ([LockedWebView]), hub app downloads. The credential seam ([HubCredentials]) is the app's: AXHub hands over the hub
 * session cookie its in-app sign-in left in the WebView cookie store ([cookieCredentials]); nothing is stored here.
 * Registers [HubClient] (`axf.hub`). The hub protocol (AXPP), hub push and the admin API are named placeholders
 * ([placeholders]); AXPP is parked for Fable.
 *
 * Same constructor as the `fable/theme-from-hub` branch's HubModule (which also attaches the hub appearance source), so
 * the two merge into one class.
 */
public class HubModule(
    private val hub: String = HubOrigin.DEFAULT,
    private val appId: String? = null,
    private val credentials: HubCredentials = cookieCredentials { hub },
) : BaseModule(ID, "axHub") {
    override val provides: List<Capability> = listOf(
        Capability(CAPABILITY, "axHub connection: approvals feed, hub address rules, locked web view, hub downloads, credentials seam"),
    )
    public lateinit var client: HubClient
        private set

    override fun register(ctx: ModuleContext) {
        client = HubClient(HubSession.of(credentials))
        ctx.services.register(HubClient::class, client, CAPABILITY)
        ctx.services.register(HubModule::class, this)
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.hub"
        public const val CAPABILITY: String = "axf.hub"

        /** The parts of the hub contract that aren't built yet, so later work plugs in without renaming anything. */
        public fun placeholders(): List<PlaceholderModule> = HubRules.PLACEHOLDERS.map { (cap, note) ->
            val short = cap.removePrefix("axf.hub.")
            PlaceholderModule("ai.amberx.axf.hub.$short", LABELS[short] ?: short, listOf(Capability(cap, note)))
        }
        private val LABELS = mapOf("axpp" to "Hub protocol (AXPP)", "push" to "Hub push", "admin-api" to "Hub admin API")
    }
}
