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

    override fun register(ctx: ModuleContext) {
        runtime = ctx.service(AxfRuntime::class)
        settings = ctx.service(SettingsEngine::class)
        settings?.let { s ->
            bannersShown.value = s.bool(BANNERS_KEY, true)
            s.onChange { key, _ -> if (key == BANNERS_KEY) bannersShown.value = s.bool(BANNERS_KEY, true) }
        }
        for (t in TABS) ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(t.id, t.label, icon = t.icon, module = id)))

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
                SettingSpec(BANNERS_KEY, "Banners above every tab", SettingKind.TOGGLE, "The Dev Console's banners (codebase changes, builds, GitHub activity, approvals, systems check, keys, What's new), on screen whichever tab is open", JsonPrimitive(true), icon = "bell"),
                SettingSpec("patches.reloadAction", "Reload the tab in front", SettingKind.ACTION, target = "patches.reload", icon = "refresh"),
                SettingSpec("patches.openAction", "Open the tab in front in the browser", SettingKind.ACTION, target = "patches.open", icon = "external"),
            ))))
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
        const val BANNERS_KEY: String = "patches.banners"

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
