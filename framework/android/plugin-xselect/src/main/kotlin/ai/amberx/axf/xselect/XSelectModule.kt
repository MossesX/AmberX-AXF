package ai.amberx.axf.xselect

import android.content.ClipboardManager
import android.content.Context
import ai.amberx.axf.hub.HubClient
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.HubState
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.engine.BannerAttachment
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.readaloud.ReadAloud
import ai.amberx.axf.readaloud.ReadAloudKeys
import ai.amberx.axf.readaloud.ReadAloudSettings
import ai.amberx.axf.selection.SelectionMenuEntries
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.ui.AxfUiPoints
import ai.amberx.axf.ui.ViewContribution
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** What the X Select screen and the badges read: settings through Config, the last axHub check. */
public class XSelectService internal constructor(private val context: Context, private val config: () -> Config?, private val settings: () -> SettingsEngine?) {
    private val _hub = MutableStateFlow<Pair<String?, Int>>(null to 0)
    /** Last axHub status id (lib-hub HubFeedStatus) and the number of approvals waiting. */
    public val hub: StateFlow<Pair<String?, Int>> = _hub.asStateFlow()
    private val _checkedAt = MutableStateFlow(0L)
    public val checkedAt: StateFlow<Long> = _checkedAt.asStateFlow()

    public fun string(key: String): String? = settings()?.string(key) ?: config()?.string(key)
    public fun bool(key: String, default: Boolean): Boolean = string(key)?.toBooleanStrictOrNull() ?: default
    public fun number(key: String, default: Double): Double = string(key)?.toDoubleOrNull() ?: default
    public val hubBase: String get() = HubRules.normalize(string(XSelectSettings.HUB_ADDRESS)) ?: HubRules.DEFAULT

    public fun testVoice() { ReadAloud.read(context, string(XSelectSettings.SAMPLE)?.ifBlank { null } ?: XSelectSettings.DEFAULT_SAMPLE, "Test voice", source = "xselect.test", policy = ai.amberx.axf.readaloud.QueuePolicy.REPLACE) }

    /** Reads what's on the clipboard (the phone only lets the app read it while it's on screen). */
    public fun readClipboard(): Boolean {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
        val text = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return false
        ReadAloud.read(context, text, "Clipboard", source = "xselect.clipboard")
        return true
    }

    /** Puts every read-aloud setting back to its default (X Select's own switches stay). */
    public suspend fun resetVoice() {
        val e = settings() ?: return
        for (k in ReadAloudSettings.keys(XSelectSettings.PREFIX)) e.spec(k)?.let { e.set(k, it.default) }
    }

    /** Checks axHub now: lib-hub's last reading when it's fresh, else one feed call with the app's hub session. */
    public suspend fun checkHub(maxAgeMs: Long = 60_000) {
        val shared = HubState.feed.value
        val fresh = shared != null && System.currentTimeMillis() - HubState.lastCheck.value < maxAgeMs
        val f = if (fresh) shared!! else runCatching { HubClient().feed(hubBase) }.getOrElse { HubRules.unreachable(hubBase) }
        _hub.value = f.status.id to f.count
        _checkedAt.value = System.currentTimeMillis()
    }

    internal fun applyMenu() {
        val on = XSelectMenu.enabled(bool(XSelectSettings.ON, true), string(XSelectSettings.MAIN_LABEL) ?: "ReadAloud",
            bool(XSelectSettings.MENU_SLOW, false), bool(XSelectSettings.MENU_NEXT, false), bool(XSelectSettings.MENU_SPELL, false))
        SelectionMenuEntries.apply(context, XSelectMenu.ALL.map { XSelectMenu.PKG + it.alias }, on.map { XSelectMenu.PKG + it }.toSet())
    }
}

/**
 * X Select plugin (plugin@1 `ai.amberx.axf.plugin.xselect`): Read aloud next to Select all in every app's text menu.
 * Contributes the `xselect` view (settings-only screen), the Settings → Plugins → X Select sub-tab (13 groups),
 * actions `xselect.open|test|stop|toggle|clipboard|hub`, the axHub status badge and a Reading badge on the app's
 * banner (origin = this plugin, so disabling it removes both), and the runtime counter `xselect.reading`.
 * Needs ReadAloudModule(this, settingsPrefix = null) and SelectionModule() in the app's module list.
 */
public class XSelectModule(private val context: Context) : BaseModule(ID, "X Select") {
    override val provides: List<Capability> = listOf(Capability("axf.xselect", "Read aloud in every app's text selection menu"))
    override val dependsOn: List<String> = listOf("ai.amberx.axf.readaloud", "ai.amberx.axf.selection")
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.settings")
    public lateinit var service: XSelectService
        private set
    private var scope: CoroutineScope? = null
    private var hubJob: Job? = null
    private var runtime: AxfRuntime? = null

    override fun register(ctx: ModuleContext) {
        val app = context.applicationContext
        service = XSelectService(app, { ctx.service(Config::class) }, { ctx.service(SettingsEngine::class) })
        ctx.services.register(XSelectService::class, service, "axf.xselect")
        ReadAloud.configure(XSelectSettings.PREFIX, "X Select", app.packageManager.getLaunchIntentForPackage(app.packageName)) { key -> service.string(key) }
        runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "X Select", icon = "mic", module = id)))
        ctx.extensions.contribute(AxfUiPoints.VIEWS, id, ViewContribution(ROUTE, "X Select", "mic") { XSelectScreen() })
        for (g in XSelectSettings.groups(id)) ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(g))
        fun action(name: String, label: String, run: () -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("xselect.$name", ActionMeta(label, module = id)) { _, _ -> run() })
        action("open", "Open X Select") { runtime?.navigate(ROUTE) }
        action("test", "Test the read-aloud voice") { service.testVoice() }
        action("stop", "Stop reading aloud") { ReadAloud.stop(app) }
        action("toggle", "Pause or resume reading aloud") { ReadAloud.toggle(app) }
        action("clipboard", "Read the clipboard aloud") { if (!service.readClipboard()) runtime?.toast("The clipboard is empty.", ToastKind.INFO, "X Select") }
        action("hub", "Check axHub now") { scope?.launch { service.checkHub(0); badges() } }
    }

    override suspend fun start(ctx: ModuleContext) {
        val s = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).also { scope = it }
        service.applyMenu()
        badges()
        ctx.service(SettingsEngine::class)?.onChange { key, _ ->
            if (key.startsWith("xselect.menu") || key == XSelectSettings.ON) service.applyMenu()
            if (key.startsWith("xselect.hub") || key == XSelectSettings.READING_BADGE) { badges(); if (key == XSelectSettings.HUB_EVERY || key == XSelectSettings.HUB_BADGE || key == XSelectSettings.HUB_ADDRESS) pollHub(s) }
        }
        pollHub(s)
        s.launch {
            ReadAloud.state.map { Triple(it.active, it.paused, it.rate to it.queue.position) }.distinctUntilChanged().collect { (active, _, _) ->
                runtime?.setBadge(COUNTER, if (active) 1 else 0)
                badges()
            }
        }
    }

    private fun pollHub(s: CoroutineScope) {
        hubJob?.cancel()
        if (!service.bool(XSelectSettings.HUB_BADGE, true)) return
        hubJob = s.launch {
            while (true) {
                service.checkHub()
                badges()
                val minutes = service.number(XSelectSettings.HUB_EVERY, 5.0).coerceIn(1.0, 60.0)
                delay((minutes * 60_000).toLong())
            }
        }
    }

    /** Registers the badge assets with what they should say now and attaches / detaches them on the app's banner. */
    private fun badges() {
        val rt = runtime ?: return
        val side = service.string(XSelectSettings.HUB_SIDE)?.takeIf { it in listOf("left", "center", "right") } ?: "right"
        if (service.bool(XSelectSettings.HUB_BADGE, true)) {
            val (status, waiting) = service.hub.value
            val v = XSelectBadge.hub(status, waiting, service.bool(XSelectSettings.HUB_COMPACT, false))
            rt.replaceAsset(badge(HUB_BADGE, "axHub status", v, "xselect.open"), id)
            rt.attachToBanner(BannerAttachment("badge", HUB_BADGE, side, 40.0, id))
        } else rt.detachFromBanner("badge:$HUB_BADGE")
        val st = ReadAloud.state.value
        val item = st.queue.current
        if (item != null && service.bool(XSelectSettings.READING_BADGE, true)) {
            rt.replaceAsset(badge(READING_BADGE, "Reading aloud", XSelectBadge.reading(st.paused, st.rate, st.queue.position, item.utterances.size), "xselect.toggle"), id)
            rt.attachToBanner(BannerAttachment("badge", READING_BADGE, side, 41.0, id))
        } else rt.detachFromBanner("badge:$READING_BADGE")
    }

    private fun badge(assetId: String, name: String, v: HubBadgeView, link: String) = buildJsonObject {
        put("\$axf", "asset@1"); put("type", "badge"); put("id", assetId); put("name", name); put("version", "1.0.0")
        put("description", "X Select plugin badge (drawn at run time)"); put("author", "X Select")
        putJsonArray("tags") { add(JsonPrimitive("badge")); add(JsonPrimitive("xselect")) }
        put("data", buildJsonObject { put("icon", v.icon); put("label", v.label); put("tone", v.tone); put("shape", "pill"); put("tooltip", v.tooltip); put("link", link) })
    }

    override suspend fun stop(ctx: ModuleContext) {
        runtime?.detachAll(id)
        runtime?.setBadge(COUNTER, 0)
        scope?.cancel(); scope = null
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.plugin.xselect"
        public const val ROUTE: String = "xselect"
        public const val COUNTER: String = "xselect.reading"
        public const val HUB_BADGE: String = "xselect-hub"
        public const val READING_BADGE: String = "xselect-reading"
        /** Read-aloud keys under X Select's prefix (same names the settings groups use). */
        public val KEYS: ReadAloudKeys = ReadAloudKeys(XSelectSettings.PREFIX)
    }
}
