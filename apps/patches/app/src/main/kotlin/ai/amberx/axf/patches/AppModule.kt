package ai.amberx.axf.patches

import android.content.Context
import android.content.Intent
import android.net.Uri
import ai.amberx.axf.hub.HubRules
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
import ai.amberx.axf.settings.SettingsEngine
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.put

/**
 * One tab of Patches: the app it shows and where. `origins` = the places its web view may render: the app's own origin
 * plus the hub's, for the sign-in wall's round trip (console and Pilot sit behind axHub's wall).
 */
data class PatchTab(val id: String, val label: String, val icon: String, val settingKey: String, val defaultUrl: String)

/** The combined settings' state: the app's tab in front and, once, a tab inside that app's own settings to open. */

/**
 * Patches' own module: the three tab routes, the Patches settings group (hub address + each tab's address, reload,
 * open in the phone's browser) and the actions behind the settings. The tab views themselves are in [views.TabView].
 */
class AppModule(private val context: Context, private val hubAddress: () -> String) : BaseModule("ai.amberx.axf.patches", "Patches") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings", "ai.amberx.axf.logging", "ai.amberx.axf.hub")
    private var settings: SettingsEngine? = null
    private var runtime: AxfRuntime? = null
    /** Reload ticks per tab (a view reloads when its tick changes). */
    val reloads = kotlinx.coroutines.flow.MutableStateFlow<Map<String, Long>>(emptyMap())
    /** Settings → Patches → "Banners above every tab" (default off: the apps show their own banners): the Dev Console's plugin banners in [views.BannerStrip]. */
    val bannersShown = kotlinx.coroutines.flow.MutableStateFlow(true)
    /** Sends JSON into a tab's web view (`AxfEmbedGuest.receive`); set by the activity, which holds the web views. */
    var sendToTab: ((tab: String, json: String) -> Unit)? = null
    /** The menus the apps in the tabs sent (embed@1 take `app-menu`), shown in Patches' own application menu. */
    private val guestMenus = linkedMapOf<String, List<ai.amberx.axf.kernel.engine.EmbedMenu>>()
    /** Patches' own app-menu asset as shipped, the base the apps' menus are added to. */
    private var baseMenu: kotlinx.serialization.json.JsonObject? = null

    /** Settings → Patches → Notifications: Patches serves the phone's notifications for the Console, Pilot and axHub. */
    val notify = kotlinx.coroutines.flow.MutableStateFlow(true)

    override fun register(ctx: ModuleContext) {
        runtime = ctx.service(AxfRuntime::class)
        settings = ctx.service(SettingsEngine::class)
        settings?.let { s ->
            bannersShown.value = s.bool(BANNERS_KEY, false)
            notify.value = s.bool(NOTIFY_KEY, true)
            s.onChange { key, _ ->
                if (key == BANNERS_KEY) bannersShown.value = s.bool(BANNERS_KEY, false)
                if (key == NOTIFY_KEY) { notify.value = s.bool(NOTIFY_KEY, true); syncWatch() }
                if (key == "patches.console") syncWatch()
            }
        }
        for (t in TABS) ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(t.id, t.label, icon = t.icon, module = id)))

        // The settings hook is lib-settings' own app.settings (Patches' settings only); in the context menu too.
        runtime?.addContextItems(AxfRuntime.ContextContribution("patches.ctx", id, "default", 1, listOf(
            ai.amberx.axf.kernel.asset.MenuItem("patches.settings", "Settings", "settings", "app.settings"),
            ai.amberx.axf.kernel.asset.MenuItem("patches.reload", "Reload the tab in front", "refresh", "patches.reload"),
        )))
        runtime?.addContextItems(AxfRuntime.ContextContribution("patches.ctx.tab", id, "nav-item", 1, listOf(
            ai.amberx.axf.kernel.asset.MenuItem("patches.settings", "Settings", "settings", "app.settings"),
        )))
        // embed@1 app-menu: an item of a tab app's menu, picked in Patches' menu, runs in that app (it runs only what it sent).
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("patches.menu", ActionMeta("Run an item of a tab app's menu", module = id)) { args, _ ->
            val tab = args.getOrNull(0)?.takeIf { t -> TABS.any { it.id == t } } ?: return@ActionContribution
            val json = args.getOrNull(1)?.let { ai.amberx.axf.kernel.engine.EmbedTakes.run(it) } ?: return@ActionContribution
            runtime?.navigate(tab)
            sendToTab?.invoke(tab, json)
        })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("patches.reload", ActionMeta("Reload the tab in front", module = id)) { _, _ ->
            val tab = runtime?.state?.value?.view ?: return@ActionContribution
            reloads.value = reloads.value + (tab to System.currentTimeMillis())
        })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("patches.open", ActionMeta("Open the tab in front in the browser", module = id)) { _, _ ->
            val tab = runtime?.state?.value?.view ?: return@ActionContribution
            val url = url(tab) ?: return@ActionContribution
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onFailure { runtime?.toast("No browser could open $url.", ToastKind.WARNING, "Patches") }
        })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("patches", "Patches", "layers", id, order = 20, description = "The apps in the tabs. Addresses are https, host only; the hub's address comes from the app itself.", settings =
            TABS.filter { it.settingKey.isNotEmpty() }.map { t -> SettingSpec(t.settingKey, "${t.label} address", SettingKind.TEXT, "https only, no path", JsonPrimitive(t.defaultUrl), icon = t.icon) } + listOf(
                SettingSpec(NOTIFY_KEY, "Serve all notifications", SettingKind.TOGGLE, "Patches shows the phone's notifications for the Console, Pilot and axHub: approvals waiting on the hub, the console's alerts (builds, CI, deploys, systems check) and what the apps send while open. The AXHub app stays quiet while Patches is installed.", JsonPrimitive(true), icon = "bell"),
                SettingSpec(BANNERS_KEY, "Banners above every tab", SettingKind.TOGGLE, "The Dev Console's banners (codebase changes, builds, GitHub activity, approvals, systems check, keys, What's new), on screen whichever tab is open", JsonPrimitive(false), icon = "bell"),
                SettingSpec("patches.reloadAction", "Reload the tab in front", SettingKind.ACTION, target = "patches.reload", icon = "refresh"),
                SettingSpec("patches.openAction", "Open the tab in front in the browser", SettingKind.ACTION, target = "patches.open", icon = "external"),
            ))))
    }

    /**
     * The background watcher (lib-work) runs outside the kernel, so what it needs is mirrored into its own preferences:
     * on/off, the hub and the console's address. Started or stopped to match "Serve all notifications".
     */
    fun syncWatch() {
        val prefs = ai.amberx.axf.patches.watch.patchesPrefs(context)
        if (prefs.base != hub) prefs.base = hub
        url("console")?.let { HubRules.origin(it) }?.let { ai.amberx.axf.patches.watch.PatchesWatch.setConsole(context, it) }
        ai.amberx.axf.patches.watch.PatchesWatch.setNotify(context, notify.value)
        runCatching { if (notify.value) ai.amberx.axf.patches.watch.PatchesWatch.start(context) else ai.amberx.axf.patches.watch.PatchesWatch.stop(context) }
    }

    /** What an app in a tab sent Patches through its bridge (embed@1): open its settings here, or show its notification. */
    fun onMessage(tab: String, m: ai.amberx.axf.kernel.engine.EmbedMessage) {
        when (m) {
            is ai.amberx.axf.kernel.engine.EmbedMessage.OpenSettings -> Unit // not taken: each app opens its own settings
            is ai.amberx.axf.kernel.engine.EmbedMessage.Notify -> if (notify.value) ai.amberx.axf.patches.watch.PatchesAlerts.fromApp(context, tab, TABS.firstOrNull { it.id == tab }?.label ?: tab, m)
            is ai.amberx.axf.kernel.engine.EmbedMessage.Menu -> showGuestMenu(tab, m.menus)
            else -> Unit
        }
    }

    /**
     * Patches' application menu = its own menus + one menu per app in a tab, holding that app's menus as submenus
     * (Brett, Oct 22 2026: "all app menus are inherited by Patches' menu and the apps in tabs hide theirs"). Items run
     * `patches.menu:<tab>:<item id>`; check marks and counts go into the label (the Android menu has no badges yet).
     */
    private fun showGuestMenu(tab: String, menus: List<ai.amberx.axf.kernel.engine.EmbedMenu>) {
        val rt = runtime ?: return
        if (TABS.none { it.id == tab }) return
        val base = baseMenu ?: rt.registry.get("app-menu", MENU_ID)?.toJson()?.also { baseMenu = it } ?: return
        if (menus.isEmpty()) guestMenus.remove(tab) else guestMenus[tab] = menus
        // levels under the app's menu: its menus are level 0, so items nest to level 3 (app-menu maxDepth 4)
        fun item(it: ai.amberx.axf.kernel.engine.EmbedMenuItem, level: Int): kotlinx.serialization.json.JsonObject? {
            if (it.separator) return kotlinx.serialization.json.buildJsonObject { put("id", "g.${it.id}"); put("separator", true) }
            if (it.locked) return null
            val kids = if (level >= 3) null else it.items?.mapNotNull { k -> item(k, level + 1) }
            if (it.items != null && kids.isNullOrEmpty()) return null
            val label = (if (it.check == true) "✓ " else "") + it.label + (it.count?.let { n -> " ($n)" } ?: "")
            return kotlinx.serialization.json.buildJsonObject {
                put("id", "g.${it.id}"); put("label", label)
                it.icon?.let { i -> put("icon", i) }
                if (kids != null) put("items", kotlinx.serialization.json.JsonArray(kids)) else put("action", "patches.menu:$tab:${it.id}")
            }
        }
        val added = TABS.mapNotNull { t ->
            val ms = guestMenus[t.id] ?: return@mapNotNull null
            val subs = ms.mapNotNull { m ->
                val items = m.items.mapNotNull { item(it, 1) }
                if (items.none { (it["separator"] as? JsonPrimitive)?.content != "true" }) null
                else kotlinx.serialization.json.buildJsonObject { put("id", "g.${m.id}"); put("label", m.label); put("items", kotlinx.serialization.json.JsonArray(items)) }
            }
            if (subs.isEmpty()) null else kotlinx.serialization.json.buildJsonObject { put("id", "app-${t.id}"); put("label", t.label); put("items", kotlinx.serialization.json.JsonArray(subs)) }
        }
        val data = base["data"] as? kotlinx.serialization.json.JsonObject ?: return
        val own = (data["menus"] as? kotlinx.serialization.json.JsonArray)?.toList() ?: emptyList()
        val next = kotlinx.serialization.json.JsonObject(base + ("data" to kotlinx.serialization.json.JsonObject(data + ("menus" to kotlinx.serialization.json.JsonArray(own + added)))))
        rt.replaceAsset(next, id)
    }

    /** The hub's address (manifest `developer.hub`, else lib-hub's default). */
    val hub: String get() = hubAddress()

    /** The page a tab starts on: its saved address (https host only; a bad one falls back to the default), the hub for the hub tab. */
    fun url(tab: String): String? {
        val t = TABS.firstOrNull { it.id == tab } ?: return null
        if (t.settingKey.isEmpty()) return HubRules.appsUrl(hub)
        val saved = settings?.string(t.settingKey)
        return (HubRules.normalize(saved) ?: HubRules.normalize(t.defaultUrl))?.let { "$it/" }
    }

    /** Where a tab's web view may render: the app's origin and the hub's (sign-in wall). */
    fun origins(tab: String): List<String> = listOfNotNull(url(tab)?.let { HubRules.origin(it) }, hub).distinct()

    companion object {
        const val BANNERS_KEY: String = "patches.strip"
        const val NOTIFY_KEY: String = "patches.notify"

        /** What Patches takes over from the apps in its tabs (embed@1): their notifications and app menu (never their settings). */
        val TAKES: List<String> = listOf("notifications", "app-menu")
        /** Patches' own app-menu asset (assets/axf/assets/app-menu/patches.json). */
        const val MENU_ID: String = "patches"

        /** The tabs, in order. The hub tab has no address setting: it is the app's own hub. */
        val TABS: List<PatchTab> = listOf(
            PatchTab("console", "Console", "terminal", "patches.console", "https://console.amberxai.com"),
            PatchTab("pilot", "Pilot", "rocket", "patches.pilot", "https://pilot.amberxai.com"),
            PatchTab("axhub", "axHub", "layers", "", ""),
        )

        /** Capabilities Patches will fill as it grows; declared now so later work plugs in without reshuffling. */
        fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.patches.native", "Native tabs", listOf(Capability("patches.native-tabs", "The Console and AXHub Android apps as native modules in Patches' tabs, Build Pilot's Android app once it exists"))),
            PlaceholderModule("ai.amberx.axf.patches.web", "Patches on the web", listOf(Capability("patches.web", "The same wrapper as a web app (frames instead of web views)"))),
            PlaceholderModule("ai.amberx.axf.patches.bridge", "Tab bridge", listOf(Capability("patches.bridge", "Messages between the host and the apps in its tabs (approval counts on tab badges, theme changes, deep links)"))),
        )
    }
}
