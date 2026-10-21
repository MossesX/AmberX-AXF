package ai.amberx.axf.devtools

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.contract.PluginInfo
import ai.amberx.axf.kernel.contract.PluginLoader
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingScope
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.contract.SettingsTab
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.plugins.InventoryCounts
import ai.amberx.axf.kernel.plugins.PluginInventory
import ai.amberx.axf.kernel.plugins.PluginInventoryHost
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.serialization.json.JsonPrimitive

/**
 * Plugin Manager (Android port of the console's `plugin-manager` plugin; a framework module, so it outlives the console plugin).
 *
 * Every module and installed plugin in one place: health, what it needs and whether it's met (plugin-inventory@1,
 * `PluginInventoryEngine` = `core/engines/plugins.ts`), who provides it, who needs it, clashes, its routes and settings.
 * Views Cards / Table / Detail / Dependencies (graph) in layouts Studio / Mission control / Terminal / Catalog, like the
 * web console. Opened from the default context menu (long-press anywhere → Plugin Manager), the route `plugin-manager`,
 * the action `plugin-manager.open[:<id>]` or Settings → Plugins → Plugin Manager (sub-tab, never a top-level tab).
 *
 * Choices are settings with the same keys as the web plugin (`plugin-manager.layout|view|filter|sort|selected`) and
 * follow the UI-editor rule: saves are per key (last save wins) and the screen re-reads them when it opens or resumes
 * (`AxfRuntime.refreshFromSaved()` + the KV store). Enable / disable of plugin@1 plugins goes through `axf.plugins`
 * (the loader) when a platform provides it; compiled modules can't be switched off at runtime (shown, greyed).
 */
public class PluginManagerModule : BaseModule(ID, "Plugin Manager") {
    override val provides: List<Capability> = listOf(Capability("axf.plugin-manager", "Plugin inventory, dependencies, clashes, UI + settings launcher"), Capability(PluginInventoryHost.UI_EDITOR_PREFIX + "manager", "UI editor: manager"))
    override val dependsOn: List<String> = listOf("ai.amberx.axf.settings")

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.service(AxfRuntime::class)
        val kernel = ctx.service(AxfKernel::class)
        val store = ctx.service(KeyValueStore::class)
        ctx.services.register(PluginManagerService::class, PluginManagerService(kernel, store), "axf.plugin-manager")
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "Plugin Manager", icon = "package", module = id, group = "Plugins")))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(ACTION_OPEN, ActionMeta("Open the Plugin Manager", module = id)) { a, _ ->
            a.getOrNull(0)?.let { store?.put(KEY_SELECTED, it) }
            runtime?.navigate(ROUTE)
        })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(ACTION_WINDOW, ActionMeta("Plugin Manager in a window", module = id)) { a, _ ->
            a.getOrNull(0)?.let { store?.put(KEY_SELECTED, it) }
            runtime?.openDialog(DIALOG)
        })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("plugin-manager.layout", ActionMeta("Plugin Manager layout", module = id, params = true)) { a, _ -> a.getOrNull(0)?.takeIf { it in LAYOUTS.map { l -> l.first } }?.let { store?.put(KEY_LAYOUT, it) } })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("plugin-manager.view", ActionMeta("Plugin Manager view", module = id, params = true)) { a, _ -> a.getOrNull(0)?.takeIf { it in VIEWS.map { v -> v.first } }?.let { store?.put(KEY_VIEW, it) } })
        // The menu link is a runtime contribution (never written into a context-menu asset) and leaves with the module.
        runtime?.addContextItems(AxfRuntime.ContextContribution("$id.default", id, "default", 90, listOf(MenuItem("plugin-manager", "Plugin Manager", "package", action = ACTION_OPEN))))
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("plugin-manager.look", "Plugin Manager", "package", id, order = 45, tab = TAB.id, settings = listOf(
            SettingSpec("plugin-manager.open", "Open the Plugin Manager", SettingKind.ACTION, "Every plugin: health, enable / disable, its UI and settings, and its dependencies in detail. Also in the long-press menu anywhere.", target = ACTION_OPEN, icon = "package"),
            SettingSpec(KEY_LAYOUT, "Layout", SettingKind.CHOICE, "Studio, Mission control, Terminal or Catalog", JsonPrimitive("studio"), SettingScope.USER, options = LAYOUTS),
            SettingSpec(KEY_VIEW, "View", SettingKind.CHOICE, default = JsonPrimitive("grid"), scope = SettingScope.USER, options = VIEWS),
        ))))
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.plugin-manager"
        public const val ROUTE: String = "plugin-manager"
        public const val DIALOG: String = "plugin-manager.window"
        public const val ACTION_OPEN: String = "plugin-manager.open"
        public const val ACTION_WINDOW: String = "plugin-manager.window"
        /** Sub-tab of Settings → Plugins (web: `settingsTabs: [{ id: 'plugin-manager', parent: 'plugins' }]`). */
        public val TAB: SettingsTab = SettingsTab("plugin-manager", "Plugin Manager", "package", order = 5, parent = "plugins")
        public const val KEY_LAYOUT: String = "plugin-manager.layout"
        public const val KEY_VIEW: String = "plugin-manager.view"
        public const val KEY_FILTER: String = "plugin-manager.filter"
        public const val KEY_SORT: String = "plugin-manager.sort"
        public const val KEY_SELECTED: String = "plugin-manager.selected"
        public val LAYOUTS: List<Pair<String, String>> = listOf("studio" to "Studio", "mission" to "Mission control", "terminal" to "Terminal", "catalog" to "Catalog")
        public val VIEWS: List<Pair<String, String>> = listOf("grid" to "Cards", "table" to "Table", "detail" to "Detail", "graph" to "Dependencies")
        public val FILTERS: List<Pair<String, String>> = listOf("all" to "All", "enabled" to "Running", "off" to "Switched off", "problems" to "Needs attention", "editors" to "UI editors")
        public val SORTS: List<Pair<String, String>> = listOf("name" to "Name", "health" to "Health", "deps" to "Most used")
    }
}

/** What the screen reads: the live inventory and the saved choices (per key, last save wins). */
public class PluginManagerService(private val kernel: AxfKernel?, private val store: KeyValueStore?) {
    /** Modules from the kernel plus `plugins` (installed plugin@1s the screen collected from `PluginLoader.plugins`). */
    public fun inventory(plugins: List<PluginInfo> = emptyList()): PluginInventory {
        val k = kernel ?: return PluginInventory(emptyList(), emptyList(), InventoryCounts(0, 0, 0, 0, 0, 0))
        return PluginInventoryHost.inventory(k.modules.info(), plugins, k.extensions, { k.services.hasCapability(it) })
    }
    public fun loader(): PluginLoader? = kernel?.services?.get<PluginLoader>()
    /** Re-read a choice from the store (fresh on open / resume). */
    public fun choice(key: String, allowed: List<Pair<String, String>>, default: String): String = store?.get(key)?.takeIf { v -> allowed.any { it.first == v } } ?: default
    public fun selected(): String = store?.get(PluginManagerModule.KEY_SELECTED) ?: ""
    public fun save(key: String, value: String) { store?.put(key, value) }
    public fun refresh(): List<String> = kernel?.runtime?.refreshFromSaved() ?: emptyList()
}
