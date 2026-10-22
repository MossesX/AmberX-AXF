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

/**
 * One tab of Patches: the app it shows and where. `origins` = the places its web view may render: the app's own origin
 * plus the hub's, for the sign-in wall's round trip (console and Pilot sit behind axHub's wall).
 */
data class PatchTab(val id: String, val label: String, val icon: String, val settingKey: String, val defaultUrl: String)

/** The combined settings' state: the app's tab in front and, once, a tab inside that app's own settings to open. */
data class SettingsRequest(val app: String, val tab: String? = null, val at: Long = 0L)

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
    /** Settings → Patches → "Banners above every tab" (default on): the Dev Console's plugin banners in [views.BannerStrip]. */
    val bannersShown = kotlinx.coroutines.flow.MutableStateFlow(true)
    /**
     * The combined Settings (Patches · Console · Pilot · axHub): which app's tab is in front, and a tab inside that app's
     * own settings to open (asked by the app itself, e.g. the console's "Set up a provider"). [views.CombinedSettings].
     */
    val settingsApp = kotlinx.coroutines.flow.MutableStateFlow(SettingsRequest("patches"))
    /** Settings → Patches → Notifications: Patches serves the phone's notifications for the Console, Pilot and axHub. */
    val notify = kotlinx.coroutines.flow.MutableStateFlow(true)

    /** Open the combined settings on [app]'s tab (and [tab] inside it). */
    fun openSettings(app: String, tab: String? = null) {
        settingsApp.value = SettingsRequest(if (SETTINGS_APPS.any { it.first == app }) app else "patches", tab, System.currentTimeMillis())
        runtime?.navigate("settings")
    }

    override fun register(ctx: ModuleContext) {
        runtime = ctx.service(AxfRuntime::class)
        settings = ctx.service(SettingsEngine::class)
        settings?.let { s ->
            bannersShown.value = s.bool(BANNERS_KEY, true)
            notify.value = s.bool(NOTIFY_KEY, true)
            s.onChange { key, _ ->
                if (key == BANNERS_KEY) bannersShown.value = s.bool(BANNERS_KEY, true)
                if (key == NOTIFY_KEY) { notify.value = s.bool(NOTIFY_KEY, true); syncWatch() }
                if (key == "patches.console") syncWatch()
            }
        }
        for (t in TABS) ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(t.id, t.label, icon = t.icon, module = id)))

        // The settings hook (Brett, Oct 21 2026): app.settings and patches.settings:<app>[:<tab>] open the combined settings.
        // Registered after lib-settings (this module depends on it), so Patches' app.settings is the one that runs.
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("app.settings", ActionMeta("Settings", module = id)) { _, _ -> openSettings(settingsApp.value.app) })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("patches.settings", ActionMeta("Settings for an app", module = id)) { args, _ -> openSettings(args.getOrNull(0) ?: "patches", args.getOrNull(1)) })
        // …and in the context menu, everywhere Patches draws one (a tab's menu opens that app's settings).
        runtime?.addContextItems(AxfRuntime.ContextContribution("patches.ctx", id, "default", 1, listOf(
            ai.amberx.axf.kernel.asset.MenuItem("patches.settings", "Settings", "settings", "app.settings"),
            ai.amberx.axf.kernel.asset.MenuItem("patches.reload", "Reload the tab in front", "refresh", "patches.reload"),
        )))
        runtime?.addContextItems(AxfRuntime.ContextContribution("patches.ctx.tab", id, "nav-item", 1, listOf(
            ai.amberx.axf.kernel.asset.MenuItem("patches.settings.tab", "Settings for this app", "settings", "patches.settings:{payload}"),
            ai.amberx.axf.kernel.asset.MenuItem("patches.settings", "Settings", "settings", "app.settings"),
        )))
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
                SettingSpec(BANNERS_KEY, "Banners above every tab", SettingKind.TOGGLE, "The Dev Console's banners (codebase changes, builds, GitHub activity, approvals, systems check, keys, What's new), on screen whichever tab is open", JsonPrimitive(true), icon = "bell"),
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
            is ai.amberx.axf.kernel.engine.EmbedMessage.OpenSettings -> openSettings(tab, m.tab)
            is ai.amberx.axf.kernel.engine.EmbedMessage.Notify -> if (notify.value) ai.amberx.axf.patches.watch.PatchesAlerts.fromApp(context, tab, TABS.firstOrNull { it.id == tab }?.label ?: tab, m)
            else -> Unit
        }
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

    /** An app's own settings page for the combined settings (embed@1 page mode: the page alone, no chrome). */
    fun settingsUrl(tab: String): String? {
        val t = TABS.firstOrNull { it.id == tab } ?: return null
        val page = if (t.settingKey.isEmpty()) "$hub/auth/account" else url(tab) ?: return null
        return ai.amberx.axf.kernel.engine.EmbedTakes.embedUrl(ai.amberx.axf.kernel.asset.AssetTypeRegistry.builtin(), page, "patches", take = TAKES, page = "settings")
    }

    /** Where a tab's web view may render: the app's origin and the hub's (sign-in wall). */
    fun origins(tab: String): List<String> = listOfNotNull(url(tab)?.let { HubRules.origin(it) }, hub).distinct()

    companion object {
        const val BANNERS_KEY: String = "patches.banners"
        const val NOTIFY_KEY: String = "patches.notify"

        /** The combined settings' tabs, in order: Patches itself, then one per app (id → label, icon). */
        val SETTINGS_APPS: List<Triple<String, String, String>> = listOf(Triple("patches", "Patches", "layers"), Triple("console", "Console", "terminal"), Triple("pilot", "Pilot", "rocket"), Triple("axhub", "axHub", "shield"))

        /** What Patches takes over from the apps in its tabs (embed@1): their settings and their notifications. */
        val TAKES: List<String> = listOf("settings", "notifications")

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
