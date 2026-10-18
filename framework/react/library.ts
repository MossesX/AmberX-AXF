/*
 * Web library contract — the web port's equivalent of an Android AxfModule. A library contributes views,
 * dialogs, tab renderers and actions; apps list their libraries and merge what they contribute into AppShell.
 * Libraries generated from framework/library-templates implement this.
 */
import type { AxfRuntime, NavItem, SettingsGroup, SettingsPanel, SettingsTab } from '../core';
import type { ViewMap } from './AppShell';
import type { DialogMap } from './components/Overlays';
import type { TabRenderers } from './windows/WindowHost';

export interface AxfWebLibrary {
  /** same id as the library's Android module, e.g. ai.amberx.axf.gps.tracker */
  id: string;
  label: string;
  version: string;
  template?: string;
  dependsOn?: string[];
  provides?: string[];
  /** register actions, terminal lines, services on window.AXF… — called once, in dependency order */
  register?(rt: AxfRuntime): void;
  views?: ViewMap;
  dialogs?: DialogMap;
  tabs?: TabRenderers;
  /** Nav entries for this library's views, shown as their own section after the nav-menu asset's sections. */
  nav?: { label?: string; items: NavItem[] };
  /** Settings tabs this library adds (the settings library declares the standard ones). */
  settingsTabs?: SettingsTab[];
  /** Settings groups (schema → generated controls) for any tab. */
  settings?: SettingsGroup[];
  /** Custom settings UI for any tab; `render` returns React content. */
  settingsPanels?: SettingsPanel[];
}

/** Dependency order (dependencies first); unknown dependencies are reported, cycles keep listed order. */
export function orderLibraries(libs: AxfWebLibrary[]): { ordered: AxfWebLibrary[]; missing: string[] } {
  const byId = new Map(libs.map((l) => [l.id, l]));
  const out: AxfWebLibrary[] = [];
  const seen = new Set<string>();
  const missing = new Set<string>();
  const visit = (l: AxfWebLibrary, stack: Set<string>) => {
    if (seen.has(l.id) || stack.has(l.id)) return;
    stack.add(l.id);
    for (const d of l.dependsOn ?? []) { const dep = byId.get(d); if (dep) visit(dep, stack); else missing.add(d); }
    seen.add(l.id);
    out.push(l);
  };
  for (const l of libs) visit(l, new Set());
  return { ordered: out, missing: [...missing] };
}

/** Register every library with the runtime and merge their views / dialogs / tab renderers for AppShell. */
export function installLibraries(rt: AxfRuntime, libs: AxfWebLibrary[]): { views: ViewMap; dialogs: DialogMap; tabs: TabRenderers; missing: string[] } {
  const { ordered, missing } = orderLibraries(libs);
  const views: ViewMap = {};
  const dialogs: DialogMap = {};
  const tabs: TabRenderers = {};
  for (const l of ordered) {
    l.register?.(rt);
    Object.assign(views, l.views ?? {});
    Object.assign(dialogs, l.dialogs ?? {});
    Object.assign(tabs, l.tabs ?? {});
    if (l.nav?.items.length) rt.setNavSection({ id: l.id, ...l.nav });
    for (const t of l.settingsTabs ?? []) rt.settings.addTab(t);
    for (const g of l.settings ?? []) rt.settings.addGroup({ module: l.id, ...g });
    for (const p of l.settingsPanels ?? []) rt.settings.addPanel({ module: l.id, ...p });
    if (!rt.libraries.some((x) => x.id === l.id)) rt.libraries.push({ id: l.id, label: l.label, version: l.version, ...(l.template ? { template: l.template } : {}) });
    rt.terminal.log('libraries', `${l.label} ${l.version} registered`);
  }
  for (const m of missing) rt.terminal.warn('libraries', `missing dependency: ${m}`);
  return { views, dialogs, tabs, missing };
}
