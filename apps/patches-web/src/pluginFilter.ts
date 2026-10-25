/**
 * Plugins per app: search, filters and sort (pure, tested by plugin-filter.test.mts). The grid lists every plugin
 * Patches knows; by default the ones not installed in any app in the tabs go to the bottom (Gizmo, Oct 25 2026).
 */

export type FilterCell = { installed: boolean | null; canChange: boolean; switch?: boolean };
export type FilterRow = { id: string; folder: string; name: string; version: string; model: string; sources: string[]; banner?: boolean; cells: Record<string, FilterCell> };

/** Per app: any = no filter, yes = installed there, no = not installed there. */
export type AppRule = 'any' | 'yes' | 'no';
export type Show = 'all' | 'installed' | 'nowhere' | 'changed';
export type SortKey = 'name' | 'apps' | 'model' | 'source' | 'id';

export interface PluginFilter {
  text: string;
  /** which fields the text searches */
  fields: { name: boolean; id: boolean; folder: boolean; version: boolean };
  show: Show;
  apps: Record<string, AppRule>;
  /** empty = every model ('' = unrecorded) */
  models: string[];
  /** empty = every source (patches / installed / catalog) */
  sources: string[];
  banners: 'any' | 'only' | 'none';
  changeableOnly: boolean;
  sort: SortKey;
  desc: boolean;
  /** plugins not installed in any app in the tabs go to the bottom */
  nowhereLast: boolean;
}

export const DEFAULT_FILTER: PluginFilter = {
  text: '',
  fields: { name: true, id: true, folder: true, version: false },
  show: 'all',
  apps: {},
  models: [],
  sources: [],
  banners: 'any',
  changeableOnly: false,
  sort: 'name',
  desc: false,
  nowhereLast: true,
};

/** Apps whose cells count as "installed somewhere" (Patches' own list is not an app). */
const realApps = (r: FilterRow) => Object.keys(r.cells).filter((a) => a !== 'patches');

export const installedCount = (r: FilterRow) => realApps(r).filter((a) => r.cells[a]?.installed === true).length;
export const installedNowhere = (r: FilterRow) => installedCount(r) === 0;

/** source kind of a row source tag (`patches`, `installed:<app>`, `catalog`) */
export const sourceKind = (s: string) => (s.startsWith('installed:') ? 'installed' : s);

/** How many choices differ from the defaults (the Advanced button's badge). */
export function changedFromDefault(f: PluginFilter): number {
  let n = 0;
  if (f.text) n++;
  if (JSON.stringify(f.fields) !== JSON.stringify(DEFAULT_FILTER.fields)) n++;
  if (f.show !== 'all') n++;
  n += Object.values(f.apps).filter((v) => v !== 'any').length;
  if (f.models.length) n++;
  if (f.sources.length) n++;
  if (f.banners !== 'any') n++;
  if (f.changeableOnly) n++;
  if (f.sort !== 'name' || f.desc) n++;
  if (!f.nowhereLast) n++;
  return n;
}

export function matches(r: FilterRow, f: PluginFilter, changed: (r: FilterRow) => boolean = () => false): boolean {
  const q = f.text.trim().toLowerCase();
  if (q) {
    const hay = [f.fields.name && r.name, f.fields.id && r.id, f.fields.folder && r.folder, f.fields.version && r.version].filter(Boolean).join(' ').toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (f.show === 'installed' && installedNowhere(r)) return false;
  if (f.show === 'nowhere' && !installedNowhere(r)) return false;
  if (f.show === 'changed' && !changed(r)) return false;
  for (const [app, rule] of Object.entries(f.apps)) {
    if (rule === 'any') continue;
    const c = r.cells[app];
    if (!c) return false;
    if (rule === 'yes' && c.installed !== true) return false;
    if (rule === 'no' && c.installed !== false) return false;
  }
  if (f.models.length && !f.models.includes(r.model || '')) return false;
  if (f.sources.length && !r.sources.some((s) => f.sources.includes(sourceKind(s)))) return false;
  if (f.banners === 'only' && !r.banner) return false;
  if (f.banners === 'none' && r.banner) return false;
  if (f.changeableOnly && !Object.values(r.cells).some((c) => c.canChange)) return false;
  return true;
}

const SOURCE_ORDER: Record<string, number> = { installed: 0, patches: 1, catalog: 2 };

function compare(a: FilterRow, b: FilterRow, key: SortKey): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
  switch (key) {
    case 'apps': return installedCount(b) - installedCount(a) || byName;
    case 'model': return (a.model || '~').localeCompare(b.model || '~') || byName;
    case 'source': {
      const rank = (r: FilterRow) => Math.min(...r.sources.map((s) => SOURCE_ORDER[sourceKind(s)] ?? 9), 9);
      return rank(a) - rank(b) || byName;
    }
    case 'id': return a.id.localeCompare(b.id);
    default: return byName;
  }
}

/** Filter, sort, then (by default) move the plugins installed nowhere to the bottom, keeping the sort inside each part. */
export function arrange<R extends FilterRow>(rows: R[], f: PluginFilter, changed?: (r: FilterRow) => boolean): R[] {
  const out = rows.filter((r) => matches(r, f, changed)).sort((a, b) => (f.desc ? -1 : 1) * compare(a, b, f.sort));
  if (!f.nowhereLast) return out;
  return [...out.filter((r) => !installedNowhere(r)), ...out.filter(installedNowhere)];
}

/** Every model the rows carry ('' = unrecorded), sorted. */
export const modelsOf = (rows: FilterRow[]) => [...new Set(rows.map((r) => r.model || ''))].sort();

/** Read a saved filter (per browser), dropping anything that isn't the right shape. */
export function readFilter(raw: unknown): PluginFilter {
  const f: PluginFilter = { ...DEFAULT_FILTER, fields: { ...DEFAULT_FILTER.fields }, apps: {} };
  if (!raw || typeof raw !== 'object') return f;
  const o = raw as Record<string, unknown>;
  if (typeof o.text === 'string') f.text = o.text.slice(0, 200);
  if (o.fields && typeof o.fields === 'object') for (const k of Object.keys(f.fields) as (keyof PluginFilter['fields'])[]) { const v = (o.fields as Record<string, unknown>)[k]; if (typeof v === 'boolean') f.fields[k] = v; }
  if (['all', 'installed', 'nowhere', 'changed'].includes(o.show as string)) f.show = o.show as Show;
  if (o.apps && typeof o.apps === 'object') for (const [k, v] of Object.entries(o.apps as Record<string, unknown>)) if (v === 'yes' || v === 'no') f.apps[k] = v;
  if (Array.isArray(o.models)) f.models = o.models.filter((m): m is string => typeof m === 'string').slice(0, 20);
  if (Array.isArray(o.sources)) f.sources = o.sources.filter((s): s is string => s === 'patches' || s === 'installed' || s === 'catalog');
  if (o.banners === 'only' || o.banners === 'none') f.banners = o.banners;
  if (typeof o.changeableOnly === 'boolean') f.changeableOnly = o.changeableOnly;
  if (['name', 'apps', 'model', 'source', 'id'].includes(o.sort as string)) f.sort = o.sort as SortKey;
  if (typeof o.desc === 'boolean') f.desc = o.desc;
  if (typeof o.nowhereLast === 'boolean') f.nowhereLast = o.nowhereLast;
  return f;
}
