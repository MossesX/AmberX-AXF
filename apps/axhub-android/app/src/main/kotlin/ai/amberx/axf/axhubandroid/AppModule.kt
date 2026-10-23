package ai.amberx.axf.axhubandroid

import android.content.Context
import ai.amberx.axf.axhubandroid.views.hubAreas
import ai.amberx.axf.axhubandroid.watch.ApprovalWatch
import ai.amberx.axf.axhubandroid.watch.AutoApprove
import ai.amberx.axf.axhubandroid.watch.AutoApprovePrefs
import ai.amberx.axf.axhubandroid.watch.hubPrefs
import ai.amberx.axf.hub.HubClient
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.HubState
import ai.amberx.axf.hub.WatchPrefs
import ai.amberx.axf.hub.WebViewHubSession
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.lock.AppLock
import ai.amberx.axf.lock.LockGate
import ai.amberx.axf.lock.LockMode
import ai.amberx.axf.lock.lockGate
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.settings.SettingsEngine
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * "Sign out and reset" (the escape on AXHub's locked screen): the hub session goes first, on the hub and on this
 * phone, and only then is the lock turned off, so nothing it protected is exposed.
 */
class HubReset(private val prefs: WatchPrefs) {
    internal var settings: SettingsEngine? = null
    internal var gate: LockGate? = null

    suspend fun signOutAndReset() {
        val done = CompletableDeferred<Unit>()
        runCatching { HubClient.Default.signOut(prefs.base) } // ends the session on the hub too, not just on this phone
        WebViewHubSession.clear { done.complete(Unit) }
        done.await()
        HubState.signedOut(prefs.base)
        settings?.set(AppLock.MODE, JsonPrimitive(LockMode.NONE.id))
        gate?.unlock()
    }
}

/**
 * AXHub's own module: approvals (home), the hub's pages in the app, the AXHub settings group, and the
 * planned hub areas as routes. The watcher's settings are mirrored into [WatchPrefs] so the framework's work
 * service and boot receiver can read them without the kernel.
 */
class AppModule(private val context: Context) : BaseModule("ai.amberx.axf.axhubandroid", "AXHub") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.lock")
    private val prefs = hubPrefs(context)
    private val auto = AutoApprovePrefs(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    /** App lock (lib-lock): starts locked; "Nothing more" opens it; a missing lock service keeps it shut (fails closed). */
    lateinit var gate: LockGate
        private set
    val reset: HubReset = HubReset(prefs)

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        gate = lockGate(ctx.service(AppLock::class), scope, ready = (context as AxfApplication).ready)
        reset.gate = gate
        reset.settings = ctx.service(SettingsEngine::class)
        val routes = listOf(RouteSpec("home", "Approvals", icon = "shield", module = id), RouteSpec("hub", "Hub", icon = "external", module = id), RouteSpec("apps", "Apps", icon = "download", module = id)) +
            hubAreas.map { RouteSpec(it.route, it.title, icon = it.icon, module = id, group = "Manage") }
        routes.forEach { ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(it)) }

        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("axhub.signout", ActionMeta("Sign out of the hub", module = id)) { _, _ ->
            scope.launch {
                val ended = runCatching { HubClient.Default.signOut(prefs.base) }.getOrDefault(false)
                WebViewHubSession.clear {
                    HubState.signedOut(prefs.base)
                    runtime?.toast(if (ended) "Signed out of the hub." else "Signed out on this phone (the hub couldn't be reached to end the session there).", ToastKind.INFO, "AXHub")
                }
            }
        })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("axhub.lock", ActionMeta("Lock AXHub", module = id)) { _, _ -> gate.lockNow() })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("axhub", "AXHub", "shield", id, order = 25, description = "Your hub and how approvals reach this phone.", settings = listOf(
            SettingSpec(K_BASE, "Hub address", SettingKind.TEXT, "https only, no path", JsonPrimitive(HubRules.DEFAULT), icon = "link"),
            SettingSpec(K_INTERVAL, "Check every", SettingKind.CHOICE, default = JsonPrimitive("30"), options = listOf("15" to "15 s", "30" to "30 s", "60" to "1 min", "300" to "5 min"), icon = "clock"),
            SettingSpec(K_FULL, "Full-screen alerts", SettingKind.TOGGLE, "Pop the approval up like an alarm when Android allows it", JsonPrimitive(true), icon = "bell"),
            SettingSpec(K_AUTO_ALL, "Approve everything except vps.run", SettingKind.TOGGLE, "Every approval request is approved from this phone as soon as it arrives, except vps.run (root shell on the VPS), which still needs your tap. You get the waiting alert, then an \"approved\" one with the alarm sound", JsonPrimitive(false), icon = "check"),
            SettingSpec(K_AUTO, "Auto-approve listed tools", SettingKind.TOGGLE, "Approve matching calls from this phone without asking; the alert says \"Auto-approval approved\"", JsonPrimitive(false), icon = "check"),
            SettingSpec(K_AUTO_TOOLS, "Auto-approve tools", SettingKind.TEXT, "Comma-separated: vps.logs, github.* (a whole service) or * (everything). Empty = nothing", JsonPrimitive(""), icon = "list"),
            SettingSpec("axhub.signoutAction", "Sign out of the hub", SettingKind.ACTION, target = "axhub.signout", icon = "logout"),
            SettingSpec("axhub.lockAction", "Lock now", SettingKind.ACTION, target = "axhub.lock", icon = "lock"),
        ))))

        ctx.service(SettingsEngine::class)?.onChange { key, value -> mirror(key, (value as? JsonPrimitive)?.content, runtime) }
    }

    override suspend fun start(ctx: ModuleContext) {
        val s = ctx.service(SettingsEngine::class) ?: return
        listOf(K_BASE, K_INTERVAL, K_FULL, K_AUTO_ALL, K_AUTO, K_AUTO_TOOLS).forEach { k -> mirror(k, s.string(k), null) }
    }

    private fun mirror(key: String, v: String?, runtime: AxfRuntime?) {
        when (key) {
            K_BASE -> {
                val ok = HubRules.normalize(v)
                if (ok == null) { if (v != null && runtime != null) runtime.toast("Hub address must be https with no path; kept ${prefs.base}.", ToastKind.WARNING, "AXHub") }
                else if (ok != prefs.base) { prefs.base = ok; if (prefs.watching) ApprovalWatch.start(context, checkNow = true) }
            }
            K_INTERVAL -> v?.toIntOrNull()?.let { prefs.intervalSec = it; ApprovalWatch.setInterval(context, prefs.intervalSec) }
            K_FULL -> v?.toBooleanStrictOrNull()?.let { prefs.fullScreen = it }
            K_AUTO -> v?.toBooleanStrictOrNull()?.let {
                val was = auto.on
                auto.on = it
                if (it && !was && runtime != null) runtime.toast(
                    if (AutoApprove.patterns(auto.tools).isEmpty()) "Auto-approve is on, but no tools are listed yet, so nothing is approved."
                    else "Auto-approve is on: matching calls are approved without asking.",
                    ToastKind.WARNING, "AXHub",
                )
            }
            K_AUTO_TOOLS -> auto.tools = v.orEmpty()
            K_AUTO_ALL -> v?.toBooleanStrictOrNull()?.let {
                val was = auto.all
                auto.all = it
                if (it && !was && runtime != null) runtime.toast("Every approval except vps.run is now approved from this phone without asking.", ToastKind.WARNING, "AXHub")
            }
        }
    }

    companion object {
        const val K_BASE = "axhub.base"
        const val K_INTERVAL = "axhub.interval"
        const val K_FULL = "axhub.fullScreen"
        const val K_AUTO = "axhub.autoApprove"
        const val K_AUTO_TOOLS = "axhub.autoApproveTools"
        const val K_AUTO_ALL = "axhub.autoApproveAll"

        /** Capabilities the app will fill as the hub grows; declared now so later work plugs in without reshuffling. */
        fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.axhubandroid.adminapi", "Hub admin API client", listOf(Capability("axhub.admin-api", "Services, jobs, vault names, users, projects (hub step 4)"))),
            PlaceholderModule("ai.amberx.axf.axhubandroid.push", "Hub push", listOf(Capability("axhub.push", "Instant approval alerts pushed by the hub instead of checking"))),
            PlaceholderModule("ai.amberx.axf.axhubandroid.agent", "Device agent", listOf(Capability("axhub.agent", "This phone as a hub device over AXPP (hub step 6)"))),
        )
    }
}
