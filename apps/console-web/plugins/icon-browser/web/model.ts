/**
 * Icon Browser — pure model (no React, no DOM): constants, the icon record the server serves, filters + sorting, the
 * tree built from sets → categories → icons, the virtual grid window, drag payloads, and pack composition. Tested by
 * `test.mts` (npx -y tsx apps/console-web/plugins/icon-browser/test.mts).
 */

export const FOLDER = 'icon-browser';
export const ID = 'ai.amberx.axf.console.icon-browser';
export const VIEW = 'icon-browser';
export const MANAGER_VIEW = 'icon-manager';
/** what a dragged icon carries (drop targets: panes, tab groups, the manager's slots and preview) */
export const ICON_DROP_MIME = 'application/x-axf-icon+json';
/** tab kind the window engine renders for an opened icon (TabSpec.kind) */
export const ICON_TAB_KIND = 'icon-browser.icon';
export const ICON_GROUP_TITLE = 'Icons';

export type ViewMode = 'tree' | 'grid' | 'list';
export type TileSize = 'sm' | 'md' | 'lg';
export type SortKey = 'name' | 'set' | 'category' | 'pack';

export const VIEW_MODES: { id: ViewMode; label: string; icon: string }[] = [
  { id: 'tree', label: 'Tree', icon: 'layers' },
  { id: 'grid', label: 'Grid', icon: 'grid' },
  { id: 'list', label: 'List', icon: 'list' },
];
export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'set', label: 'Set' },
  { id: 'category', label: 'Category' },
  { id: 'pack', label: 'Pack' },
];

/** One icon as the server lists it (search / sets). */
export interface IconRecord { name: string; set: string; pack: string; category: string; tags: string[]; style: string; ref: string }

export interface LibrarySet { id: string; name: string; license: string; licenseUrl: string; homepage: string; npm: { name: string; version: string }; style: string; grid: number; stroke: number; count: number; packs: { id: string; file: string; count: number; category: string }[]; categories: Record<string, number> }
export interface Library { $axf: 'icon-library@1'; generatedAt: string; totalBytes: number; sets: LibrarySet[]; mine: { id: string; name: string; count: number; style: string }[] }

export interface Config {
  view: ViewMode; tile: TileSize; names: boolean; treeThumbs: boolean; sort: SortKey; set: string; category: string; style: string;
  panes: { library: boolean; composer: boolean; details: boolean }; openNewGroup: 'docked' | 'floating'; sections: Record<string, boolean>;
}
export const DEFAULT_CONFIG: Config = { view: 'grid', tile: 'md', names: true, treeThumbs: true, sort: 'name', set: '', category: '', style: '', panes: { library: true, composer: true, details: true }, openNewGroup: 'docked', sections: {} };

const VIEWS: ViewMode[] = ['tree', 'grid', 'list'];
const TILES: TileSize[] = ['sm', 'md', 'lg'];
const SORT_IDS: SortKey[] = ['name', 'set', 'category', 'pack'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function cleanConfig(raw: unknown): Config {
  const o = isObj(raw) ? raw : {};
  const panes = isObj(o.panes) ? o.panes : {};
  return {
    view: VIEWS.includes(o.view as ViewMode) ? (o.view as ViewMode) : DEFAULT_CONFIG.view,
    tile: TILES.includes(o.tile as TileSize) ? (o.tile as TileSize) : DEFAULT_CONFIG.tile,
    names: typeof o.names === 'boolean' ? o.names : DEFAULT_CONFIG.names,
    treeThumbs: typeof o.treeThumbs === 'boolean' ? o.treeThumbs : DEFAULT_CONFIG.treeThumbs,
    sort: SORT_IDS.includes(o.sort as SortKey) ? (o.sort as SortKey) : DEFAULT_CONFIG.sort,
    set: typeof o.set === 'string' ? o.set : '', category: typeof o.category === 'string' ? o.category : '', style: typeof o.style === 'string' ? o.style : '',
    panes: { library: panes.library !== false, composer: panes.composer !== false, details: panes.details !== false },
    openNewGroup: o.openNewGroup === 'floating' ? 'floating' : 'docked',
    sections: isObj(o.sections) ? Object.fromEntries(Object.entries(o.sections).map(([k, v]) => [k, v === true])) : {},
  };
}

export interface Filters { q: string; set: string; category: string; style: string }

/** Search (name, tags, category; every word must match) + set, category and style filters, then sorted. */
export function filterIcons(items: IconRecord[], f: Filters, sort: SortKey = 'name'): IconRecord[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = items.filter((i) => {
    if (f.set && i.set !== f.set) return false;
    if (f.category && i.category !== f.category) return false;
    if (f.style && i.style !== f.style) return false;
    if (!words.length) return true;
    const hay = `${i.name} ${i.tags.join(' ')} ${i.category}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return sortIcons(out, sort);
}

export function sortIcons(items: IconRecord[], sort: SortKey): IconRecord[] {
  const key = (i: IconRecord) => (sort === 'name' ? '' : String(i[sort] ?? ''));
  return [...items].sort((a, b) => { const ka = key(a), kb = key(b); return ka < kb ? -1 : ka > kb ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : a.set < b.set ? -1 : a.set > b.set ? 1 : 0; });
}

/** Distinct values of one field, sorted (empty dropped). */
export function values(items: IconRecord[], key: 'set' | 'category' | 'style' | 'pack'): string[] {
  return [...new Set(items.map((i) => i[key]).filter(Boolean))].sort();
}

/* ---------------- tree */

export interface TreeNode { id: string; label: string; kind: 'set' | 'category' | 'icon'; count: number; children?: TreeNode[]; icon?: IconRecord }

/** sets → categories (when the set has them) → icons; a filtered list keeps only the branches that still hold icons. */
export function buildTree(items: IconRecord[], setNames: Record<string, string> = {}): TreeNode[] {
  const bySet = new Map<string, IconRecord[]>();
  for (const i of items) { if (!bySet.has(i.set)) bySet.set(i.set, []); bySet.get(i.set)!.push(i); }
  const out: TreeNode[] = [];
  for (const [set, list] of [...bySet.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const cats = new Map<string, IconRecord[]>();
    for (const i of list) { const c = i.category || ''; if (!cats.has(c)) cats.set(c, []); cats.get(c)!.push(i); }
    const hasCats = [...cats.keys()].some(Boolean);
    const leaf = (i: IconRecord): TreeNode => ({ id: i.ref, label: i.name, kind: 'icon', count: 1, icon: i });
    const children: TreeNode[] = hasCats
      ? [...cats.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([c, xs]) => ({ id: `${set}/${c || 'other'}`, label: c || 'Other', kind: 'category' as const, count: xs.length, children: xs.map(leaf) }))
      : list.map(leaf);
    out.push({ id: set, label: setNames[set] ?? (set === 'mine' ? 'My packs' : set), kind: 'set', count: list.length, children });
  }
  return out;
}

/** The rows a tree draws: every node whose parents are open, with its depth. */
export function flattenTree(nodes: TreeNode[], open: Set<string>, depth = 0): { node: TreeNode; depth: number }[] {
  const out: { node: TreeNode; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.children && open.has(n.id)) out.push(...flattenTree(n.children, open, depth + 1));
  }
  return out;
}

/* ---------------- grid window (same maths as the Brand library's wall) */

export function gridWindow(o: { count: number; width: number; tile: number; gap: number; scrollTop: number; height: number; rowHeight: number; overscan?: number }) {
  const cols = Math.max(1, Math.floor((o.width + o.gap) / (o.tile + o.gap)));
  const rows = Math.ceil(o.count / cols);
  const over = o.overscan ?? 2;
  const first = Math.max(0, Math.floor(o.scrollTop / o.rowHeight) - over);
  const last = Math.min(rows, Math.ceil((o.scrollTop + o.height) / o.rowHeight) + over);
  return { cols, rows, first, last, start: first * cols, end: Math.min(o.count, last * cols), total: rows * o.rowHeight };
}

/* ---------------- drag payloads + packs */

export interface IconDrag { $axf: 'icon-drag@1'; icons: IconRecord[]; from?: string }
export const dragPayload = (icons: IconRecord[], from?: string): string => JSON.stringify({ $axf: 'icon-drag@1', icons: icons.slice(0, 500), ...(from ? { from } : {}) } satisfies IconDrag);
export function parseDrag(text: string): IconRecord[] {
  try { const o = JSON.parse(text); return o?.$axf === 'icon-drag@1' && Array.isArray(o.icons) ? o.icons.filter((i: IconRecord) => typeof i?.ref === 'string' && typeof i?.name === 'string') : []; } catch { return []; }
}

/** Add icons to a pack draft: one glyph per name; a second icon of the same name from another set gets `<name>-<set>`. */
export function addToDraft(draft: IconRecord[], icons: IconRecord[]): IconRecord[] {
  const out = [...draft];
  const refs = new Set(out.map((i) => i.ref));
  for (const i of icons) if (!refs.has(i.ref)) { refs.add(i.ref); out.push(i); }
  return out;
}

/** The glyph name an icon gets inside a composed pack (unique within it). */
export function glyphNameIn(draft: IconRecord[], i: IconRecord): string {
  const clash = draft.some((d) => d.name === i.name && d.ref !== i.ref && draft.indexOf(d) < draft.indexOf(i));
  return clash ? `${i.name}-${i.set}`.slice(0, 48) : i.name;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/** Small stable hash (djb2, base 36). */
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
