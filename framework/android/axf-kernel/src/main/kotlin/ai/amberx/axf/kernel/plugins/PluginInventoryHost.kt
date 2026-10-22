package ai.amberx.axf.kernel.plugins

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.contract.PluginInfo
import ai.amberx.axf.kernel.contract.PluginState
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ExtensionRegistry
import ai.amberx.axf.kernel.module.ModuleInfo
import ai.amberx.axf.kernel.module.ModuleState
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution

/*
 * Android host adapter for the plugin inventory engine: every kernel module (compiled library) and every installed
 * plugin@1 (packs / modules from the loader) becomes a [PluginRecord], the same way the web adapter
 * (framework/react/pluginRecords.ts) turns `rt.libraries` into records:
 *   dependsOn / optionalDependsOn  → `plugin:<id>` in requires / optional
 *   provides (capabilities)       → `service:<id>`, also reported as live when the service registry has it
 *   routes / settings groups      → contributions `view:<route>`, `settings-group:<id>` (two modules, one id = clash)
 */
public object PluginInventoryHost {
    /** Kinds of values a module edits; a module declares them by providing `axf.ui-editor.<kind>` (open vocabulary: theme, style, layout, manager, builder). */
    public const val UI_EDITOR_PREFIX: String = "axf.ui-editor."

    public fun recordOf(m: ModuleInfo, extensions: ExtensionRegistry? = null, hasCapability: (String) -> Boolean = { false }, enabled: Boolean = true): PluginRecord {
        val editors = m.provides.filter { it.startsWith(UI_EDITOR_PREFIX) }.map { it.removePrefix(UI_EDITOR_PREFIX) }
        val services = m.provides.filter { !it.startsWith(UI_EDITOR_PREFIX) }
        val contributions = extensions?.let { ext ->
            ext.contributions(ExtensionPoints.ROUTES).filter { it.module == m.id }.map { "view:${(it.value as RouteContribution).route.id}" } +
                ext.contributions(ExtensionPoints.SETTINGS).filter { it.module == m.id }.map { "settings-group:${(it.value as SettingsContribution).group.id}" }
        } ?: emptyList()
        return PluginRecord(
            folder = m.id, id = m.id, name = m.label, version = m.version, apiLevel = m.apiLevel, targets = emptyList(),
            provides = services.map { "service:$it" } + contributions,
            requires = m.dependsOn.map { "plugin:$it" } + m.requires.map { "service:$it" },
            optional = emptyList(),
            uiEditor = editors,
            enabled = enabled && m.state != ModuleState.STOPPED,
            error = m.error ?: if (m.state == ModuleState.FAILED) "module failed" else null,
            services = services.filter(hasCapability),
        )
    }

    /** An installed plugin@1 (from the loader) as a record. */
    public fun recordOf(p: PluginInfo): PluginRecord = PluginRecord(
        folder = p.manifest.id, id = p.manifest.id, name = p.manifest.name, version = p.manifest.version, apiLevel = p.manifest.apiLevel,
        targets = p.manifest.targets,
        provides = p.manifest.provides, requires = p.manifest.requires,
        scopes = p.granted.map { it.name },
        enabled = p.state == PluginState.ENABLED,
        error = p.error ?: if (p.state == PluginState.FAILED) "plugin failed" else null,
    )

    /** The context an Android host resolves against: this kernel's API level, any target, the live service registry. */
    public fun context(modules: List<ModuleInfo>, hasCapability: (String) -> Boolean): InventoryContext = InventoryContext(
        apiLevels = (1..AxfVersion.API_LEVEL).toList(),
        target = null,
        live = modules.flatMap { m -> m.provides.filter { !it.startsWith(UI_EDITOR_PREFIX) && hasCapability(it) }.map { LiveService(it, m.id, m.state != ModuleState.STOPPED && m.state != ModuleState.FAILED) } },
    )

    /** The whole inventory of a kernel: modules first, then installed plugins, as the web console lists bundled plugins. */
    public fun inventory(modules: List<ModuleInfo>, plugins: List<PluginInfo> = emptyList(), extensions: ExtensionRegistry? = null, hasCapability: (String) -> Boolean = { false }, enabled: (String) -> Boolean = { true }): PluginInventory {
        val records = modules.map { recordOf(it, extensions, hasCapability, enabled(it.id)) } + plugins.map { recordOf(it) }
        return PluginInventoryEngine.build(records, context(modules, hasCapability))
    }
}
