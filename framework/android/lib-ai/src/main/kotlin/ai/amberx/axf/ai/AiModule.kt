package ai.amberx.axf.ai

import ai.amberx.axf.hub.HubCredentials
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.kernel.ai.AI_SESSION_CAPABILITY
import ai.amberx.axf.kernel.ai.AiModeRegistry
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.ai.ModelOption
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.SessionProvider
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.runtime.AxfRuntime
import okhttp3.OkHttpClient

/**
 * lib-ai: AI sessions for any AXF app, always live on axHub.
 *
 * Registers [HubAiSessionClient] under `axf.ai.session` (replacing the kernel's placeholder) and [AiService]
 * (`axf.ai`): the kernel's mode registry, mode resolution with per-trigger overrides, UAC gating (the hub account's
 * answer when known, else the runtime's role + the signed-in principal), the model choice and the AI settings group
 * (mode, model, read replies aloud). Closing the app never closes a session: [stop] only detaches.
 *
 * @param assistant where the assistant lives behind axHub's wall (https, host only)
 * @param credentials the hub session (default: lib-hub's WebView cookie store read for the assistant's origin — the
 *   `axhub_session` cookie the wall checks, left there by signing in through the wall in a LockedWebView/HubSignInView)
 */
public class AiModule(
    private val assistant: String = AiWire.DEFAULT_ASSISTANT,
    private val credentials: HubCredentials? = null,
    private val prefix: String = AiWire.DEFAULT_PREFIX,
    private val models: List<ModelOption> = emptyList(),
    private val live: AiLiveOptions = AiLiveOptions(),
    private val transport: AiHubTransport? = null,
) : BaseModule(ID, "AI sessions") {
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.hub", "ai.amberx.axf.network", "ai.amberx.axf.settings")
    override val provides: List<Capability> = listOf(
        Capability(AI_SESSION_CAPABILITY, "AI sessions on axHub (live: they survive the app closing; replay on reattach)"),
        Capability(CAPABILITY, "AI service: modes, UAC gating, model choice, settings"),
    )

    public lateinit var client: HubAiSessionClient
        private set
    public lateinit var service: AiService
        private set

    override fun register(ctx: ModuleContext) {
        val http = runCatching { ctx.service(ai.amberx.axf.network.AxfHttp::class)?.client }.getOrNull() ?: OkHttpClient()
        val t = transport ?: OkHttpAiHubTransport(assistant, credentials ?: cookieCredentials { assistant }, http)
        client = HubAiSessionClient(t, prefix, live)
        ctx.services.register(AiSessionClient::class, client, AI_SESSION_CAPABILITY)
        ctx.services.register(HubAiSessionClient::class, client)

        val registry = ctx.service(AiModeRegistry::class) ?: AiModeRegistry().also { ctx.services.register(AiModeRegistry::class, it, "axf.ai.modes") }
        val runtime = ctx.service(AxfRuntime::class)
        val session = ctx.service(SessionProvider::class)
        val kv = ctx.service(KeyValueStore::class)
        val policy = AiPolicies.local({ runtime?.permissions() ?: emptySet() }, { session?.current?.principal?.takeUnless { it.isAnonymous } })
        service = AiService(registry, { client }, policy, AiSettings(ctx.service(Config::class), kv), AiCursors(kv), { models })
        ctx.services.register(AiService::class, service, CAPABILITY)
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(AiSettings.group(registry.list(), id)))
    }

    /** Learn what the hub account allows (best effort; offline keeps the local UAC view). */
    override suspend fun start(ctx: ModuleContext) { if (::service.isInitialized) service.refreshAccount() }

    // stop(): nothing to close — sessions belong to the hub; collectors detach with their scopes.

    public companion object {
        public const val ID: String = "ai.amberx.axf.ai"
        public const val CAPABILITY: String = "axf.ai"
    }
}
