package ai.amberx.axf.axhubandroid

import android.content.Context
import ai.amberx.axf.axhubandroid.views.hubAreas
import ai.amberx.axf.axhubandroid.watch.ApprovalWatch
import ai.amberx.axf.axhubandroid.watch.hubPrefs
import ai.amberx.axf.hub.HubClient
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.HubState
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
import ai.amberx.axf.lock.LockMode
import ai.amberx.axf.settings.SettingsEngine
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonPrimitive

/**
 * App lock for AXHub: starts locked, opens only after Settings → Unlock's step (or right away when that is
 * "Nothing more"), and locks again after the chosen time away.
 */
class AppLockGate {
    private val _unlocked = MutableStateFlow(false)
    val unlocked: StateFlow<Boolean> = _unlocked.asStateFlow()
    private var leftAt = 0L
    internal var lock: AppLock? = null
    internal var settings: SettingsEngine? = null
    internal var base: String? = null

    fun unlock() { _unlocked.value = true }
    fun lockNow() { _unlocked.value = false }
    fun onLeave(now: Long = System.currentTimeMillis()) { leftAt = now }
    /** Called once settings have loaded (app ready) and on every return to the app. */
    fun onReturn(now: Long = System.currentTimeMillis()) {
        val l = lock ?: return // no lock service: stay locked (fail closed); "Sign out and reset" is the way out
        if (l.mode == LockMode.NONE) { unlock(); return }
        if (leftAt > 0 && now - leftAt >= l.autoLockMinutes * 60_000L) lockNow()
        leftAt = 0
    }
    /** "Sign out and reset": the hub session goes first, then the lock is turned off. */
    suspend fun resetAfterSignOut() {
        val done = CompletableDeferred<Unit>()
        base?.let { runCatching { HubClient.Default.signOut(it) } } // ends the session on the hub too, not just on this phone
        WebViewHubSession.clear { done.complete(Unit) }
        done.await()
        HubState.signedOut(base ?: HubRules.DEFAULT)
        settings?.set(AppLock.MODE, JsonPrimitive(LockMode.NONE.id))
        unlock()
    }
}

/**
 * AXHub's own module: approvals (home), the hub's pages in the app, the AXHub settings group, and the
 * planned hub areas as routes. The watcher's settings are mirrored into [WatchPrefs] so the framework's work
 * service and boot receiver can read them without the kernel.
 */
class AppModule(private val context: Context) : BaseModule("ai.amberx.axf.axhubandroid", "AXHub") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.lock")
    val gate: AppLockGate = AppLockGate()
    private val prefs = hubPrefs(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        gate.lock = ctx.service(AppLock::class)
        gate.settings = ctx.service(SettingsEngine::class)
        gate.base = prefs.base
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
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("help.about", ActionMeta("About")) { _, _ ->
            runtime?.toast("AXHub on AmberX AXF 0.2.0. Approve and manage your axHub from this phone.", ToastKind.INFO, "About")
        })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("axhub", "AXHub", "shield", id, order = 25, description = "Your hub and how approvals reach this phone.", settings = listOf(
            SettingSpec(K_BASE, "Hub address", SettingKind.TEXT, "https only, no path", JsonPrimitive(HubRules.DEFAULT), icon = "link"),
            SettingSpec(K_INTERVAL, "Check every", SettingKind.CHOICE, default = JsonPrimitive("30"), options = listOf("15" to "15 s", "30" to "30 s", "60" to "1 min", "300" to "5 min"), icon = "clock"),
            SettingSpec(K_FULL, "Full-screen alerts", SettingKind.TOGGLE, "Pop the approval up like an alarm when Android allows it", JsonPrimitive(true), icon = "bell"),
            SettingSpec("axhub.signoutAction", "Sign out of the hub", SettingKind.ACTION, target = "axhub.signout", icon = "logout"),
            SettingSpec("axhub.lockAction", "Lock now", SettingKind.ACTION, target = "axhub.lock", icon = "lock"),
        ))))

        ctx.service(SettingsEngine::class)?.onChange { key, value -> mirror(key, (value as? JsonPrimitive)?.content, runtime) }
    }

    override suspend fun start(ctx: ModuleContext) {
        val s = ctx.service(SettingsEngine::class) ?: return
        listOf(K_BASE, K_INTERVAL, K_FULL).forEach { k -> mirror(k, s.string(k), null) }
    }

    private fun mirror(key: String, v: String?, runtime: AxfRuntime?) {
        when (key) {
            K_BASE -> {
                val ok = HubRules.normalize(v)
                if (ok == null) { if (v != null && runtime != null) runtime.toast("Hub address must be https with no path; kept ${prefs.base}.", ToastKind.WARNING, "AXHub") }
                else if (ok != prefs.base) { prefs.base = ok; gate.base = ok; if (prefs.watching) ApprovalWatch.start(context, checkNow = true) }
            }
            K_INTERVAL -> v?.toIntOrNull()?.let { prefs.intervalSec = it; ApprovalWatch.setInterval(context, prefs.intervalSec) }
            K_FULL -> v?.toBooleanStrictOrNull()?.let { prefs.fullScreen = it }
        }
    }

    companion object {
        const val K_BASE = "axhub.base"
        const val K_INTERVAL = "axhub.interval"
        const val K_FULL = "axhub.fullScreen"

        /** Capabilities the app will fill as the hub grows; declared now so later work plugs in without reshuffling. */
        fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.axhubandroid.adminapi", "Hub admin API client", listOf(Capability("axhub.admin-api", "Services, jobs, vault names, users, projects (hub step 4)"))),
            PlaceholderModule("ai.amberx.axf.axhubandroid.push", "Hub push", listOf(Capability("axhub.push", "Instant approval alerts pushed by the hub instead of checking"))),
            PlaceholderModule("ai.amberx.axf.axhubandroid.agent", "Device agent", listOf(Capability("axhub.agent", "This phone as a hub device over AXPP (hub step 6)"))),
        )
    }
}
