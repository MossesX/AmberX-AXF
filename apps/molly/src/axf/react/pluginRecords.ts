/**
 * Web host adapter for the plugin inventory engine (core/engines/plugins.ts, plugin-inventory@1).
 *
 * Any AXF web app can feed its installed libraries (`rt.libraries`, filled by `installLibraries`) to the engine and get
 * the Plugin Manager's model: dependencies (`dependsOn` → `plugin:<id>`, `provides` → `service:<capability>`), dependents,
 * health and clashes. The Dev Console adds what its server knows (enabled flags, server parts, env, data folders) on top;
 * Android does the same from `ModuleRegistry.info()` (`PluginInventoryModule`).
 */
import type { AxfRuntime, InstalledLibrary } from '../core';
import { buildPluginInventory, pluginRecord, type InventoryContext, type PluginInventory, type PluginRecord } from '../core/engines/plugins';

/** One installed library as an inventory record. `folder` = its id (web apps have no folders). */
export function pluginRecordOfLibrary(l: InstalledLibrary, extra: Partial<PluginRecord> = {}): PluginRecord {
  return pluginRecord({
    folder: l.id,
    id: l.id,
    name: l.label,
    version: l.version,
    apiLevel: 1,
    targets: [],
    provides: [...(l.provides ?? []).map((p) => (p.includes(':') ? p : `service:${p}`)), ...(l.contributes ?? [])],
    requires: (l.dependsOn ?? []).map((d) => `plugin:${d}`),
    uiEditor: l.uiEditor ?? [],
    services: (l.provides ?? []).filter((p) => !p.includes(':')),
    ...extra,
  });
}

export function pluginRecordsFromRuntime(rt: AxfRuntime): PluginRecord[] {
  return rt.libraries.map((l) => pluginRecordOfLibrary(l));
}

/** The inventory of everything installed in this runtime (no host server involved). */
export function runtimeInventory(rt: AxfRuntime, ctx: Partial<InventoryContext> = {}): PluginInventory {
  return buildPluginInventory(pluginRecordsFromRuntime(rt), { apiLevels: [1], target: null, live: [], ...ctx });
}
