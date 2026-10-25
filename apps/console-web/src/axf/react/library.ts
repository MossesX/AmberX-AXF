/*
 * Web library contract — the web port's equivalent of an Android AxfModule. A library contributes views,
 * dialogs, tab renderers and actions; apps list their libraries and merge what they contribute into AppShell.
 * Libraries generated from framework/library-templates implement this.
 */
import type { AppMenuProvider, AxfRuntime, InstalledLibrary, NavItem, SettingsGroup, SettingsPanel, SettingsTab } from '../core';
import type { AppMenuContribution } from '../core/engines/appmenu';
import { embedSkipReason } from '../core/engines/embed';
import { isPlacement, placementKey, placementOptions, PLACEMENT_LABELS, primaryUi, type Placement } from '../core/engines/placement';
import type { MenuEntry } from '../core/engines/windows';
import type { ReactNode } from 'react';
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
  /** Kinds of values it edits (theme / style / layout / manager / builder): the UI-editor rule applies (last save wins, fresh on focus). */
  uiEditor?: string[];
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
  /**
   * Context-menu items, per target (`default` = the app-wide right-click / long-press menu). Added after the
   * context-menu asset's items and removed with the library, so a plugin's link never outlives the plugin.
   */
  contextMenu?: { id: string; target?: string; order?: number; items: MenuEntry[] }[];
  /**
   * Application-menu items (core/engines/appmenu.ts): items or whole submenus into a named top-level menu (created when
   * missing) or under an item path, with placement, UAC `requires`, badges, check marks and live lists (`provider`).
   * Removed with the library (`rt.removeAppMenuItems(id)`), so a disabled plugin's entries go with it.
   */
  appMenu?: Omit<AppMenuContribution, 'module'>[];
  /** Live lists for the application menu (`rt.registerAppMenuProvider`), keyed by provider id; removed with the library. */
  appMenuProviders?: Record<string, AppMenuProvider | AppMenuProvider['items']>;
  /** Banners the app shows at the top of the page, above app tabs (slot `app.frame.banners`; e.g. a systems check or "what's new"); each renders nothing when idle. */
  banners?: BannerDef[];
  /**
   * Inside a host app (embed@1, e.g. Patches): when this library isn't needed there, because the host already does its
   * job or hides what it draws (`skipWhen`: `embedded` | `take:<fn>` | `hidden:<type>`; see engines/embed.ts
   * embedSkipReason). It is then not installed on that page and is listed in `rt.skippedLibraries`; standalone it loads.
   */
  embed?: { skipWhen: string[] };
  /** Content for named extension points (slots) that views offer, e.g. `plan.top`; see components/Slots.tsx. */
  slots?: Record<string, SlotDef[]>;
  /** The model that built it (plugin@1 `builtWith`): shown as a badge wherever its info shows (components/ModelBadge.tsx). */
  builtWith?: { model: string; builtAt?: string };
  /**
   * Where its primary UI opens by default (engines/placement.ts: main / window / dialog / tab; plugin@1 `opens`, filled by
   * the build engine's default rules: main). Set = installLibraries adds an "Opens in" choice to its first settings tab
   * and the runtime opens that UI where the choice says. Unset or false = it opens the way it was declared.
   */
  opens?: Placement | false;
  /** Which UI moves (`view:<id>` / `dialog:<id>`); default its first page, else its first dialog. */
  opensUi?: string;
}

/** Content for a named slot; `props` are what the view passes to `<Slot name=… props=… />`. */
export interface SlotDef { id: string; order?: number; render: (props: Record<string, unknown>) => ReactNode }

/** A banner contributed by a library or plugin; lower `order` shows first. */
export interface BannerDef {
  id: string;
  order?: number;
  render: () => ReactNode;
  /** name and icon in Banner settings (right-click a banner → Banner settings; components/BannerSettings.tsx) */
  label?: string;
  icon?: string;
  /** its plugin's settings tab, opened from its Banner settings tab */
  settingsTab?: string;
  /** icon its BannerIcon shows while working (default refresh); the person can pick another in Banner settings */
  workIcon?: string;
  /** how it moves while working (default spin) */
  workAnim?: 'spin' | 'pulse' | 'bounce' | 'blink' | 'off';
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

/** What the runtime remembers about an installed library (`rt.libraries`): declarations + the UI it offers. */
export function installedLibraryRecord(l: AxfWebLibrary): InstalledLibrary {
  const tabs = (l.settingsTabs ?? []).map((t) => ({ id: t.id, label: t.label }));
  const tabIds = new Set(tabs.map((t) => t.id));
  const views = Object.entries(l.views ?? {}).map(([id, v]) => ({ id, title: v.title, icon: v.icon }));
  const dialogs = Object.entries(l.dialogs ?? {}).map(([id, d]) => ({ id, title: String((d as { title?: unknown }).title ?? id) }));
  return {
    id: l.id, label: l.label, version: l.version,
    ...(l.template ? { template: l.template } : {}),
    ...(l.dependsOn?.length ? { dependsOn: [...l.dependsOn] } : {}),
    ...(l.provides?.length ? { provides: [...l.provides] } : {}),
    ...(l.uiEditor?.length ? { uiEditor: [...l.uiEditor] } : {}),
    ...(l.builtWith?.model ? { builtWith: { ...l.builtWith } } : {}),
    ...(isPlacement(l.opens) ? { opens: l.opens } : {}),
    contributes: [...views.map((v) => `view:${v.id}`), ...dialogs.map((d) => `dialog:${d.id}`), ...tabs.map((t) => `settings-tab:${t.id}`)],
    ui: {
      views, dialogs, settingsTabs: tabs,
      settingsCount: (l.settingsPanels ?? []).filter((x) => tabIds.has(x.tab)).length + (l.settings ?? []).filter((g) => tabIds.has(g.tab ?? '')).length,
      contextItems: (l.contextMenu ?? []).reduce((n, c) => n + c.items.filter((i) => !i.separator).length, 0),
      appMenuItems: (l.appMenu ?? []).reduce((n, c) => n + c.items.filter((i) => !i.separator).length, 0),
    },
  };
}

/** Register every library with the runtime and merge their views / dialogs / tab renderers for AppShell. */
export function installLibraries(rt: AxfRuntime, libs: AxfWebLibrary[]): { views: ViewMap; dialogs: DialogMap; tabs: TabRenderers; banners: BannerDef[]; slots: Record<string, SlotDef[]>; missing: string[] } {
  const { ordered, missing } = orderLibraries(libs);
  const views: ViewMap = {};
  const dialogs: DialogMap = {};
  const tabs: TabRenderers = {};
  const banners: BannerDef[] = [];
  const slots: Record<string, SlotDef[]> = {};
  const skipped: { id: string; label: string; version: string; reason: string }[] = [];
  for (const l of ordered) {
    const why = embedSkipReason(rt.embedded, l.embed?.skipWhen);
    if (why) { skipped.push({ id: l.id, label: l.label, version: l.version, reason: why }); continue; }
    rt.actions.withModule(l.id, () => l.register?.(rt));
    Object.assign(views, l.views ?? {});
    Object.assign(dialogs, l.dialogs ?? {});
    Object.assign(tabs, l.tabs ?? {});
    for (const b of l.banners ?? []) if (!banners.some((x) => x.id === b.id)) banners.push(b);
    for (const [name, defs] of Object.entries(l.slots ?? {})) for (const d of defs) { const list = (slots[name] ??= []); if (!list.some((x) => x.id === d.id)) list.push(d); }
    if (l.nav?.items.length) rt.setNavSection({ id: l.id, ...l.nav });
    for (const c of l.contextMenu ?? []) rt.addContextItems({ ...c, module: l.id });
    for (const [id, p] of Object.entries(l.appMenuProviders ?? {})) rt.registerAppMenuProvider(id, typeof p === 'function' ? { items: p, module: l.id } : { module: l.id, ...p });
    for (const c of l.appMenu ?? []) rt.addAppMenuItems({ ...c, module: l.id });
    for (const t of l.settingsTabs ?? []) rt.settings.addTab({ module: l.id, ...t });
    for (const g of l.settings ?? []) rt.settings.addGroup({ module: l.id, ...g });
    for (const p of l.settingsPanels ?? []) rt.settings.addPanel({ module: l.id, ...p });
    placeLibrary(rt, l);
    if (!rt.libraries.some((x) => x.id === l.id)) rt.libraries.push(installedLibraryRecord(l));
    rt.terminal.log('libraries', `${l.label} ${l.version} registered`);
  }
  for (const m of missing) rt.terminal.warn('libraries', `missing dependency: ${m}`);
  rt.noteSkippedLibraries(skipped);
  banners.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  for (const list of Object.values(slots)) list.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return { views, dialogs, tabs, banners, slots, missing };
}

/**
 * Placement (engines/placement.ts; Brett, Oct 23 2026): a library with `opens` gets its primary UI placed and an
 * "Opens in" choice in its first settings tab (main area / floating window / dialog / tab group). The runtime reads the
 * choice on every open, so changing it applies at once.
 */
function placeLibrary(rt: AxfRuntime, l: AxfWebLibrary) {
  if (!isPlacement(l.opens)) return;
  const provides = [...Object.keys(l.views ?? {}).map((v) => `view:${v}`), ...Object.keys(l.dialogs ?? {}).map((d) => `dialog:${d}`)];
  const ui = primaryUi(provides, l.opensUi);
  if (!ui || !provides.includes(`${ui.kind}:${ui.id}`)) return;
  const title = ui.kind === 'view' ? l.views?.[ui.id]?.title : l.dialogs?.[ui.id]?.title;
  rt.setPlacement(l.id, ui, l.opens, title ?? l.label);
  const tab = l.settingsTabs?.[0]?.id;
  if (!tab) return;
  rt.settings.addGroup({
    id: `${l.id}.placement`, label: 'Opens in', icon: 'layout', module: l.id, order: 1, tab,
    description: `Where ${title ?? l.label} opens. Default: ${PLACEMENT_LABELS[l.opens].toLowerCase()}.`,
    settings: [{ key: placementKey(l.id), label: 'Open it in', kind: 'choice', default: l.opens, options: placementOptions() }],
  });
}
