package ai.amberx.axf.axnotes.plugins.buildbridge

import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.MenuContribution
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.ui.AxfUiPoints
import ai.amberx.axf.ui.ViewContribution
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Plugin ai-build-bridge (plugin@1 `ai.amberx.axf.axnotes.ai-build-bridge`, step s17 of build ax-notes): a note tagged
 * #build or a spoken "build …" becomes a build request for Brett's Build Orchestrator, in mode ai.build-request. The
 * axHub session adds it to the orchestrator only after Brett approves it (approval link shown here + push through the
 * AXHub app); the request sits in a pending-approval state polled every 15 s for the first 10 tries, then every
 * minute. The plugin never builds or edits code. Admins only (UAC): everyone else sees "Admins only".
 *
 * Hooks (JSON on the action bus, so neither side imports the other): watches the app's `axnotes.notes.saved`; dispatches
 * `ai-build-bridge.finished` when the orchestrator reports the build done (ai-automations reads it back as a note).
 */
class BuildBridgePlugin : BaseModule(ID, "AI build bridge") {
    override val version: String = "0.1.0"
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.settings")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var bridge: BridgeController? = null
    private var runtime: AxfRuntime? = null
    private var triggers: TriggerRegistry? = null
    private val removers = ArrayList<() -> Unit>()

    override fun register(ctx: ModuleContext) {
        val host = PluginHost(ctx, PREFIX)
        val b = BridgeController(host, scope)
        bridge = b
        runtime = ctx.service(AxfRuntime::class)
        ctx.services.register(BridgeController::class, b, CAPABILITY)

        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "Build requests", icon = "hammer", requires = PERMISSION, module = id)))
        ctx.extensions.contribute(AxfUiPoints.VIEWS, id, ViewContribution(ROUTE, "Build requests", "hammer") { BuildBridgeScreen() })

        fun action(aid: String, label: String, params: Boolean = false, fn: (JsonObject?) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(aid, ActionMeta(label, module = id, params = params)) { _, a -> fn(PluginHost.parseObject(a.payload)) })
        action(BridgeTriggers.ACTION_OPEN, "Build requests") { runtime?.navigate(ROUTE) }
        // payload: a trigger's {text}, or {text, title?, noteId?, source?} from another plugin (ai-automations)
        action(BridgeTriggers.ACTION_REQUEST, "Send a build request", params = true) { p ->
            val text = BridgeTriggers.textArg(p)
            val draft = text?.let { BuildIntents.fromVoice(it) }
            if (draft == null) { runtime?.toast("Say what to build after \"build\".", ToastKind.WARNING); return@action }
            val title = (p?.get("title") as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }
            val noteId = (p?.get("noteId") as? JsonPrimitive)?.content?.takeIf { it.isNotBlank() }
            val source = RequestSource.of((p?.get("source") as? JsonPrimitive)?.content ?: RequestSource.VOICE.wire)
            val err = b.submit(draft.copy(title = title ?: draft.title, noteId = noteId, source = source))
            runtime?.toast(err ?: "Build request sent. Approve it in axHub.", if (err == null) ToastKind.SUCCESS else ToastKind.WARNING)
        }
        // the hook other plugins watch; handled here as a no-op so dispatching it never reports "no handler"
        action(BridgeController.HOOK_FINISHED, "Build finished (hook)", params = true) { }
        action(ACTION_PURGE, "Remove build bridge data") {
            b.clearAll()
            val n = host.purge()
            runtime?.toast("Build bridge data removed ($n item${if (n == 1) "" else "s"}).", ToastKind.SUCCESS)
        }

        // notes tagged #build (setting, on by default; a note is never sent twice)
        removers += host.watch(HOOK_NOTE_SAVED) { note ->
            if (!host.setting(KEY_FROM_NOTES, true)) return@watch
            BuildIntents.fromNote(note)?.let { d -> if (b.denied() == null) b.submit(d) }
        }

        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup(TAB, "AI build bridge", "hammer", id, order = 52, tab = TAB,
            description = "Turns notes tagged #build and \"build …\" into build requests for the Build Orchestrator. Each one waits for Brett's approval in axHub. Admins only.", settings = listOf(
                SettingSpec(PREFIX + KEY_FROM_NOTES, "Send notes tagged #build", SettingKind.TOGGLE, "A note tagged #build becomes a build request (approval still needed)", JsonPrimitive(true), icon = "tag", requires = PERMISSION),
                SettingSpec("${PREFIX}open", "Open build requests", SettingKind.ACTION, target = BridgeTriggers.ACTION_OPEN, icon = "hammer", requires = PERMISSION),
                SettingSpec("${PREFIX}purge", "Remove plugin data", SettingKind.ACTION, "Deletes the request list stored on this phone (run before uninstalling)", target = ACTION_PURGE, icon = "trash"),
            ))))

        val item = MenuItem(ROUTE, "Build requests", "hammer", action = BridgeTriggers.ACTION_OPEN, requires = PERMISSION)
        ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("app-menu", "default", item))
        ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("nav-menu", "default", item))
        runtime?.addContextItems(AxfRuntime.ContextContribution("$id.default", id, "default", 62, listOf(item)))

        triggers = ctx.service(TriggerRegistry::class)
        triggers?.register(id, BridgeTriggers.all(id))
    }

    /** Picks up requests still waiting from the last run. */
    override suspend fun start(ctx: ModuleContext) { bridge?.wake() }

    override suspend fun stop(ctx: ModuleContext) {
        for (r in removers) r()
        removers.clear()
        triggers?.unregister(id)
        runtime?.removeContextItems(id)
    }

    companion object {
        const val ID: String = "ai.amberx.axf.axnotes.ai-build-bridge"
        const val CAPABILITY: String = "axnotes.ai-build-bridge"
        const val PREFIX: String = "ai-build-bridge."
        const val TAB: String = "ai-build-bridge"
        const val ROUTE: String = "ai-build-bridge"
        const val ACTION_PURGE: String = "ai-build-bridge.purge"
        const val KEY_FROM_NOTES: String = "fromNotes"
        const val HOOK_NOTE_SAVED: String = HostActions.NOTE_SAVED
        /** Admins hold `*` or `ai.admin`; menus, the route and settings ask for it (the controller checks the full policy). */
        const val PERMISSION: String = "ai.admin"
    }
}
