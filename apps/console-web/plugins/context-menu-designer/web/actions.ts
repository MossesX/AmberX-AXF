/**
 * Context menu designer — the action catalog (pure, no React, no DOM; shared by the Actions window, the Filter dialog
 * and test.mts).
 *
 * Every action the app can run, with where it comes from: **Framework** (the runtime, the React layer and framework
 * libraries), **Plugins** (console plugins) or **Application** (the app's own code and libraries). The owner is the
 * action bus's `module` (set by `installLibraries` while a library registers; `axf.framework` for the runtime).
 * Actions that take arguments are listed bare (`id:` to fill in) and, where the app knows the arguments, expanded:
 * `nav:<view>` for every page, `dialog:<id>` for every dialog, `settings.open:<tab>` for every settings tab,
 * `swap:<type>:next|previous` for every asset type with more than one asset.
 */

export type ActionSource = 'plugins' | 'framework' | 'application';
export const SOURCES: { id: ActionSource; label: string; icon: string; note: string }[] = [
  { id: 'plugins', label: 'Plugins', icon: 'package', note: 'Actions console plugins add' },
  { id: 'framework', label: 'Framework', icon: 'layers', note: 'The runtime, its React layer and framework libraries' },
  { id: 'application', label: 'Application', icon: 'monitor', note: 'This app’s own actions and libraries' },
];

export const FRAMEWORK_MODULE = 'axf.framework';

/** What the catalog is built from (read off the runtime by the window; plain data here). */
export interface CatalogInput {
  actions: { id: string; meta: { label: string; requires?: string; stub?: boolean; params?: boolean; module?: string } }[];
  /** installed libraries and plugins: id, label and the views / dialogs / settings tabs they contribute */
  libraries: { id: string; label: string; views?: string[]; dialogs?: string[]; settingsTabs?: string[] }[];
  /** ids of console plugins (the rest of the libraries are framework or application) */
  pluginIds: string[];
  /** pages, dialogs and settings tabs the app has (from its search index) */
  views: { id: string; label: string; icon?: string; requires?: string }[];
  dialogs: { id: string; label: string; icon?: string }[];
  settingsTabs: { id: string; label: string; icon?: string }[];
  /** asset types with more than one asset (swap next / previous) */
  swapTypes: string[];
}

export interface ActionRow {
  /** what goes in the item's Action field */
  spec: string;
  /** the registered action id (`nav` for `nav:home`) */
  id: string;
  label: string;
  icon?: string;
  source: ActionSource;
  /** library / plugin id, `axf.framework` or '' (the app) */
  owner: string;
  ownerLabel: string;
  /** needs arguments you type (`spec` ends with `:`) */
  params: boolean;
  /** the framework's no-op stand-in: the app hasn't given it a handler */
  stub: boolean;
  requires?: string;
  /** expanded from a parameter action (nav, dialog, settings.open, swap) */
  expanded: boolean;
}

export interface ActionFilter {
  /** sources shown; all three by default */
  sources: ActionSource[];
  /** owners shown (library / plugin ids, `axf.framework`, '' = the app); empty = every owner */
  owners: string[];
  /** also list the ready-made `nav:` / `dialog:` / `settings.open:` / `swap:` entries */
  expanded: boolean;
  /** list actions that need arguments typed in */
  params: boolean;
  /** list the framework's stand-ins that do nothing in this app yet */
  stubs: boolean;
  /** only actions your role may run */
  allowedOnly: boolean;
  sort: 'source' | 'name' | 'id';
}

export const defaultFilter = (): ActionFilter => ({ sources: ['plugins', 'framework', 'application'], owners: [], expanded: true, params: true, stubs: false, allowedOnly: false, sort: 'source' });

/** A stored filter (setting value, JSON) back to a filter; anything unknown falls back to the default. */
export function normalizeFilter(raw: unknown): ActionFilter {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { v = null; } }
  const d = defaultFilter();
  if (!v || typeof v !== 'object') return d;
  const o = v as Record<string, unknown>;
  const ids = SOURCES.map((s) => s.id) as string[];
  const bool = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def);
  return {
    sources: Array.isArray(o.sources) ? (o.sources.filter((s) => ids.includes(s as string)) as ActionSource[]) : d.sources,
    owners: Array.isArray(o.owners) ? o.owners.filter((s): s is string => typeof s === 'string').slice(0, 200) : [],
    expanded: bool(o.expanded, d.expanded),
    params: bool(o.params, d.params),
    stubs: bool(o.stubs, d.stubs),
    allowedOnly: bool(o.allowedOnly, d.allowedOnly),
    sort: o.sort === 'name' || o.sort === 'id' ? o.sort : 'source',
  };
}

/** How many choices differ from the default (the Filter button's badge). */
export function filterChanges(f: ActionFilter): number {
  const d = defaultFilter();
  let n = 0;
  if (f.sources.length !== d.sources.length) n++;
  if (f.owners.length) n++;
  for (const k of ['expanded', 'params', 'stubs', 'allowedOnly', 'sort'] as const) if (f[k] !== d[k]) n++;
  return n;
}

/** Where a module belongs. */
export function sourceOf(module: string | undefined, pluginIds: ReadonlySet<string>): ActionSource {
  if (!module) return 'application';
  if (module === FRAMEWORK_MODULE || module === 'axf') return 'framework';
  if (pluginIds.has(module)) return 'plugins';
  // framework libraries (ai.amberx.axf.settings, .alerts, .mcp …); the console's own libraries are the app's
  if (module.startsWith('ai.amberx.axf.') && !module.startsWith('ai.amberx.axf.console.')) return 'framework';
  return 'application';
}

/** Build every row: registered actions plus the expanded parameter actions. */
export function buildCatalog(input: CatalogInput): ActionRow[] {
  const plugins = new Set(input.pluginIds);
  const libLabel = new Map(input.libraries.map((l) => [l.id, l.label]));
  const label = (owner: string) => (owner === FRAMEWORK_MODULE || owner === 'axf' ? 'Framework' : owner ? libLabel.get(owner) ?? owner : 'This app');
  const ownerOf = (kind: 'views' | 'dialogs' | 'settingsTabs', id: string): string => input.libraries.find((l) => l[kind]?.includes(id))?.id ?? '';
  const rows: ActionRow[] = [];
  const seen = new Set<string>();
  const push = (r: ActionRow) => { if (!seen.has(r.spec)) { seen.add(r.spec); rows.push(r); } };
  const byId = new Map(input.actions.map((a) => [a.id, a]));

  for (const { id, meta } of input.actions) {
    const owner = meta.module ?? '';
    push({
      spec: meta.params ? `${id}:` : id, id, label: meta.label || id, source: sourceOf(owner, plugins), owner, ownerLabel: label(owner),
      params: !!meta.params, stub: !!meta.stub, ...(meta.requires ? { requires: meta.requires } : {}), expanded: false,
    });
  }
  const expand = (action: string, spec: string, text: string, owner: string, icon?: string, requires?: string) => {
    const a = byId.get(action);
    if (!a) return;
    const req = requires ?? a.meta.requires;
    push({ spec, id: action, label: text, ...(icon ? { icon } : {}), source: sourceOf(owner, plugins), owner, ownerLabel: label(owner), params: false, stub: !!a.meta.stub, ...(req ? { requires: req } : {}), expanded: true });
  };
  for (const v of input.views) expand('nav', `nav:${v.id}`, `Go to ${v.label}`, ownerOf('views', v.id), v.icon, v.requires);
  for (const d of input.dialogs) expand('dialog', `dialog:${d.id}`, `Open ${d.label}`, ownerOf('dialogs', d.id), d.icon);
  for (const t of input.settingsTabs) expand('settings.open', `settings.open:${t.id}`, `Settings › ${t.label}`, ownerOf('settingsTabs', t.id), t.icon ?? 'settings');
  for (const t of input.swapTypes) {
    expand('swap', `swap:${t}:next`, `Next ${t.replace(/-/g, ' ')}`, FRAMEWORK_MODULE, 'chevron-right');
    expand('swap', `swap:${t}:previous`, `Previous ${t.replace(/-/g, ' ')}`, FRAMEWORK_MODULE, 'chevron-left');
  }
  return rows;
}

/** Owners in the catalog, per source, with how many actions each (the Filter dialog's owner list). */
export function owners(rows: ActionRow[]): { owner: string; label: string; source: ActionSource; count: number }[] {
  const m = new Map<string, { owner: string; label: string; source: ActionSource; count: number }>();
  for (const r of rows) {
    const e = m.get(r.owner) ?? { owner: r.owner, label: r.ownerLabel, source: r.source, count: 0 };
    e.count++;
    m.set(r.owner, e);
  }
  return [...m.values()].sort((a, b) => a.source.localeCompare(b.source) || a.label.localeCompare(b.label));
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Rows the filter and the search words keep, sorted. `can` = may the role run it (allowedOnly). */
export function filterRows(rows: ActionRow[], f: ActionFilter, query: string, can: (perm: string) => boolean = () => true): ActionRow[] {
  const q = words(query);
  const order = SOURCES.map((s) => s.id);
  const out = rows.filter((r) => {
    if (!f.sources.includes(r.source)) return false;
    if (f.owners.length && !f.owners.includes(r.owner)) return false;
    if (r.expanded && !f.expanded) return false;
    if (r.params && !f.params) return false;
    if (r.stub && !f.stubs) return false;
    if (f.allowedOnly && r.requires && !can(r.requires)) return false;
    if (!q.length) return true;
    const hay = `${r.label} ${r.spec} ${r.ownerLabel}`.toLowerCase();
    return q.every((w) => hay.includes(w));
  });
  const name = (a: ActionRow, b: ActionRow) => a.label.localeCompare(b.label);
  if (f.sort === 'name') return out.sort(name);
  if (f.sort === 'id') return out.sort((a, b) => a.spec.localeCompare(b.spec));
  return out.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source) || a.ownerLabel.localeCompare(b.ownerLabel) || Number(a.expanded) - Number(b.expanded) || name(a, b));
}

/** Rows grouped under "<source> › <owner>" headings, in order. */
export function groupRows(rows: ActionRow[]): { key: string; source: ActionSource; label: string; rows: ActionRow[] }[] {
  const out: { key: string; source: ActionSource; label: string; rows: ActionRow[] }[] = [];
  for (const r of rows) {
    const key = `${r.source}|${r.owner}`;
    let g = out.find((x) => x.key === key);
    if (!g) { g = { key, source: r.source, label: r.ownerLabel, rows: [] }; out.push(g); }
    g.rows.push(r);
  }
  return out;
}
