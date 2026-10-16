package ai.amberx.axf.browser

import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.int
import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.contract.Corner
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.contract.TabSpec
import ai.amberx.axf.kernel.contract.WindowManager
import ai.amberx.axf.kernel.contract.WindowSettings
import ai.amberx.axf.kernel.contract.WindowType
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.manifest.AxfManifest
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import kotlinx.serialization.json.JsonPrimitive

/** One item the browser can list: which pane it sits in, how it renders when compared (`kind` + `payload`). */
public data class BrowserItem(val id: String, val name: String, val pane: Int, val subtitle: String = "", val status: String = "", val kind: String, val payload: String, val icon: String? = null, val swap: (() -> Unit)? = null)

/** Supplies the items of one tab group. Apps contribute these through `ExtensionPoints.COMMANDS`-style registration on the module (`register(groupId, provider)`). */
public fun interface BrowserItemProvider { public fun items(): List<BrowserItem> }

/** The library's configuration, read from `axf.manifest.json → libraries.browser` (written by the install wizard) with code defaults. */
public data class BrowserConfig(
    val tabGroups: List<String> = listOf("library-browser"),
    val itemKinds: List<String> = listOf("kit-preview", "library-info"),
    val defaultWindowType: WindowType = WindowType.FLOATING,
    val toolbarDefault: String = "forced",
    val allowGridView: Boolean = true,
    val compareLimit: Int = 6,
    val panes: List<String> = listOf("Hot-swappable", "Third-party / existing"),
    val minimizeCorner: Corner = Corner.BOTTOM_RIGHT,
) {
    public companion object {
        public fun fromManifest(m: AxfManifest): BrowserConfig {
            val o = m.raw.obj("libraries")?.obj("browser") ?: return BrowserConfig()
            return BrowserConfig(
                tabGroups = o.strList("tabGroups").ifEmpty { listOf("library-browser") },
                itemKinds = o.strList("itemKinds").ifEmpty { listOf("kit-preview", "library-info") },
                defaultWindowType = WindowType.entries.firstOrNull { it.name.equals(o.str("defaultWindowType", "floating"), true) } ?: WindowType.FLOATING,
                toolbarDefault = o.str("toolbarDefault", "forced"), allowGridView = o.bool("allowGridView", true), compareLimit = o.int("compareLimit", 6),
                panes = o.strList("panes").ifEmpty { listOf("Hot-swappable", "Third-party / existing") },
                minimizeCorner = Corner.entries.firstOrNull { it.name.equals(o.str("minimizeCorner", "bottom-right").replace('-', '_'), true) } ?: Corner.BOTTOM_RIGHT,
            )
        }
    }
}

/**
 * The library browser as a reusable library: one route + Compare action per tab group declared in the
 * manifest; item providers registered by the app; windows opened per the configured type/toolbar/corner.
 * Installed through `axf install browser` (CLI) or the console's install wizard, which write the manifest block.
 */
public class BrowserModule : BaseModule(ID, "Library browser") {
    override val provides: List<Capability> = listOf(Capability("axf.browser", "Floating tab-group browser with compare"))
    override val dependsOn: List<String> = listOf("ai.amberx.axf.ui.windows")
    private val providers = LinkedHashMap<String, BrowserItemProvider>()
    public lateinit var config: BrowserConfig
        private set
    public val selections: MutableMap<String, Set<String>> = LinkedHashMap()

    public fun register(groupId: String, provider: BrowserItemProvider) { providers[groupId] = provider }
    public fun items(groupId: String): List<BrowserItem> = providers[groupId]?.items() ?: emptyList()
    public fun groups(): List<String> = config.tabGroups

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        config = runtime?.manifest?.let(BrowserConfig::fromManifest) ?: BrowserConfig()
        val wm = ctx.service(WindowManager::class)
        wm?.windowDefaults = { WindowSettings(config.minimizeCorner) }
        ctx.services.register(BrowserModule::class, this, "axf.browser")
        for (g in config.tabGroups) ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("browser-$g", g.replace('-', ' ').replaceFirstChar(Char::uppercase), icon = "layers", module = id, group = "Browser")))
        // `browser.compare <groupId>` — the group defaults to the first configured one.
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("browser.compare", ActionMeta("Compare selection", module = id)) { a, _ -> compare(wm, runtime, a.getOrNull(0) ?: config.tabGroups.first()) })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("browser", "Library browser", "layers", id, order = 60, settings = listOf(
            SettingSpec("axf.browser.windowType", "Compare windows open as", SettingKind.CHOICE, default = JsonPrimitive(config.defaultWindowType.name.lowercase()), options = listOf("floating" to "Floating", "dock" to "Dock", "element" to "Element")),
            SettingSpec("axf.browser.grid", "Allow grid view", SettingKind.TOGGLE, default = JsonPrimitive(config.allowGridView)),
            SettingSpec("axf.browser.limit", "Max items per compare", SettingKind.SLIDER, default = JsonPrimitive(config.compareLimit), min = 1.0, max = 12.0, step = 1.0),
        ))))
    }

    /** Open every selected item of a group as a tab in one window (type/toolbar per config). */
    public fun compare(wm: WindowManager?, runtime: AxfRuntime?, groupId: String) {
        if (wm == null) { runtime?.toast("Windows engine not installed.", ToastKind.WARNING); return }
        val sel = selections[groupId] ?: emptySet()
        val tabs = items(groupId).filter { it.id in sel }.take(config.compareLimit).map { TabSpec("cmp-${it.id}-${System.nanoTime().toString(36)}", it.name, it.kind, it.payload, it.icon) }
        if (tabs.isEmpty()) { runtime?.toast("Select at least one item to compare.", ToastKind.WARNING); return }
        val wid = wm.openFloating(tabs, "Compare: ${tabs.size}", config.defaultWindowType, 400f, 520f)
        if (config.toolbarDefault == "off") wm.setToolbar(wid, false) else if (config.toolbarDefault == "on") wm.setToolbar(wid, true)
    }

    public companion object { public const val ID: String = "ai.amberx.axf.browser" }
}
