package ai.amberx.axf.axnotes.plugins.automations

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
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.ui.AxfUiPoints
import ai.amberx.axf.ui.ViewContribution
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

/** What this plugin offers on `axf.workers`: the work@1 job spec and its body, for a background host to run. */
class AutomationsWorker(val spec: JobSpec, val run: suspend () -> String)

/**
 * Plugin ai-automations (plugin@1 `ai.amberx.axf.axnotes.ai-automations`, step s18 of build ax-notes): toggleable rules
 * — a voice phrase, a schedule (work@1 job), a new git push on a watched repo (polled through the AI/hub session until
 * axHub has a git feed), notes tagged #build or #ask, and "the orchestrator finished a build" → a read-back summary
 * note. Rule evaluation is pure ([AutomationEngine]); this module only feeds it signals and carries out firings.
 *
 * Hooks (JSON on the action bus): watches `axnotes.notes.saved` (the app) and `ai-build-bridge.finished` (the bridge);
 * hands #build notes to `ai-build-bridge.request` when that plugin is installed. Works with either one missing.
 */
class AutomationsPlugin : BaseModule(ID, "AI automations") {
    override val version: String = "0.1.0"
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.axnotes.ai-build-bridge")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var auto: AutomationsController? = null
    private var runtime: AxfRuntime? = null
    private val removers = ArrayList<() -> Unit>()

    override fun register(ctx: ModuleContext) {
        val host = PluginHost(ctx, PREFIX)
        runtime = ctx.service(AxfRuntime::class)
        val a = AutomationsController(host, scope, id, ctx.service(TriggerRegistry::class))
        auto = a
        ctx.services.register(AutomationsController::class, a, CAPABILITY)

        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "Automations", icon = "zap", module = id)))
        ctx.extensions.contribute(AxfUiPoints.VIEWS, id, ViewContribution(ROUTE, "Automations", "zap") { AutomationsScreen() })
        ctx.extensions.contribute(ExtensionPoints.WORKERS, id, AutomationsWorker(a.spec) { a.runOnce() })

        fun action(aid: String, label: String, params: Boolean = false, fn: (String?) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(aid, ActionMeta(label, module = id, params = params)) { _, c -> fn(c.payload) })
        action(AutomationTriggers.ACTION_OPEN, "Automations") { runtime?.navigate(ROUTE) }
        action(AutomationTriggers.ACTION_FIRE, "Run an automation (voice)", params = true) { p ->
            val args = PluginHost.parseObject(p)
            val rule = (args?.get("rule") as? JsonPrimitive)?.content ?: return@action
            a.signal(Signal.VoiceFired(rule, (args?.get("text") as? JsonPrimitive)?.content, System.currentTimeMillis()))
        }
        action(ACTION_CHECK, "Check automations now") { a.wake() }
        action(ACTION_PURGE, "Remove automations data") {
            val n = a.purge()
            runtime?.toast("Automations data removed ($n item${if (n == 1) "" else "s"}).", ToastKind.SUCCESS)
        }

        removers += host.watch(HostActions.NOTE_SAVED) { note ->
            val o = note ?: return@watch
            fun s(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
            val tags = (o["tags"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
            if (s("id").isNotEmpty()) a.signal(Signal.NoteSaved(s("id"), s("title"), s("text"), tags, System.currentTimeMillis()))
        }
        removers += host.watch(AutomationsController.HOOK_BUILD_FINISHED) { b ->
            fun s(k: String) = (b?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content
            a.signal(Signal.BuildDone(s("title") ?: "a build", s("buildId"), s("status") ?: "finished", s("summary"), System.currentTimeMillis()))
        }

        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup(TAB, "AI automations", "zap", id, order = 54, tab = TAB,
            description = "Rules that run by themselves: a phrase you say, a schedule, a new push on a watched repo, notes tagged #build or #ask, a finished build. Switch each rule on the Automations screen.", settings = listOf(
                SettingSpec(PREFIX + AutomationsController.KEY_ENABLED, "Automations on", SettingKind.TOGGLE, "Pause every rule at once", JsonPrimitive(true), icon = "zap"),
                SettingSpec("${PREFIX}open", "Open automations", SettingKind.ACTION, "Switch rules on and off, see what ran", target = AutomationTriggers.ACTION_OPEN, icon = "list"),
                SettingSpec("${PREFIX}check", "Check now", SettingKind.ACTION, target = ACTION_CHECK, icon = "refresh"),
                SettingSpec("${PREFIX}purge", "Remove plugin data", SettingKind.ACTION, "Deletes the rules and their memory stored on this phone (run before uninstalling)", target = ACTION_PURGE, icon = "trash"),
            ))))

        val item = MenuItem(ROUTE, "Automations", "zap", action = AutomationTriggers.ACTION_OPEN)
        ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("app-menu", "default", item))
        ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("nav-menu", "default", item))
        runtime?.addContextItems(AxfRuntime.ContextContribution("$id.default", id, "default", 64, listOf(item)))

        a.registerVoice()
    }

    override suspend fun start(ctx: ModuleContext) { auto?.wake() }

    override suspend fun stop(ctx: ModuleContext) {
        for (r in removers) r()
        removers.clear()
        ctx.service(TriggerRegistry::class)?.unregister(id)
        runtime?.removeContextItems(id)
    }

    companion object {
        const val ID: String = "ai.amberx.axf.axnotes.ai-automations"
        const val CAPABILITY: String = "axnotes.ai-automations"
        const val PREFIX: String = "ai-automations."
        const val TAB: String = "ai-automations"
        const val ROUTE: String = "ai-automations"
        const val ACTION_CHECK: String = "ai-automations.check"
        const val ACTION_PURGE: String = "ai-automations.purge"
    }
}
