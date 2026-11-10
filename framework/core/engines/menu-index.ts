/*
 * Menu index (menu-index@1, build molly-one-shell s6, Nov 8 2026): one menu over every app in a shell.
 *
 * Brett, Nov 8 2026: "Molly's menus reach EVERYTHING from every app: every screen, plugin, action, setting. Grouped by
 * app and category, search/jump-to-anything, favorites and recents, sliding sub menus, three-dot overflow on small
 * screens." … "All Molly menus (application, context, navigation) are generated dynamically from the plugin/UI
 * registry … Keep menus slim with many nested sub menus."
 *
 * Input: the shell's surfaces (shell-surface@1, engines/shell-surface.ts), plus the user's favorites and recents
 * (qualified refs `<app>:<kind>:<id>`). Output: a tree the application menu, the nav and the context menu all draw:
 *
 *   roots: [Favorites?] [Recent?] then one group per app → its categories (nested as the items say) → items
 *
 * Slim: no level holds more than `maxPerLevel` entries (default 12). A bigger level is folded into letter-range sub
 * menus (`A–F`, `G–M`, …) so every list stays short on a phone; folding repeats until it fits. Every node has a stable
 * id (its path), so a sliding menu can jump to any item (`menuPath`). Search (`searchMenu`) scores with the search
 * engine's `scoreEntry` (engines/search.ts), so the shell's jump-to-anything ranks exactly like each app's own search,
 * with favorites and then recents breaking ties. `fitBar` decides which top-level entries a narrow bar keeps and which
 * go behind the three-dot overflow.
 *
 * Pure (no IO, no DOM). Kotlin twin deferred (Android on hold, spec/PORTING.md); fixture spec/fixtures/menu-index.json.
 */
import { scoreEntry } from './search';
import { categoryOf, qualify, type ShellSurface, type SurfaceItem } from './shell-surface';

export const MENU_INDEX_CONTRACT = 'menu-index@1';
export const MENU_INDEX_DEFAULTS = { maxPerLevel: 12, favorites: 50, recents: 20, searchLimit: 30 } as const;
export const FAVORITES_ID = 'favorites';
export const RECENTS_ID = 'recents';
/** Node id separator: a node's id is its path (`console/Builds/Merge queue`), an item's id its qualified ref. */
export const PATH_SEP = '/';

export interface MenuItemNode {
  kind: 'item';
  /** the qualified ref `<app>:<kind>:<id>` */
  id: string;
  label: string;
  app: string;
  itemKind: string;
  icon?: string;
  detail?: string;
  requires?: string;
  favorite?: boolean;
}
export interface MenuGroupNode {
  kind: 'group';
  /** the group's path (`console`, `console/Settings`, `console/Settings/A–F`) or `favorites` / `recents` */
  id: string;
  label: string;
  icon?: string;
  /** how many items are under it, at any depth */
  count: number;
  /** a letter-range sub menu made by folding a long level (`A–F`), not a category of its own */
  range?: true;
  children: MenuNode[];
}
export type MenuNode = MenuItemNode | MenuGroupNode;
export interface MenuIndex { $axf: typeof MENU_INDEX_CONTRACT; roots: MenuNode[]; total: number }

export interface MenuIndexOptions {
  favorites?: readonly string[];
  recents?: readonly string[];
  /** most entries on one level before it folds into sub menus (4..60, default 12) */
  maxPerLevel?: number;
  /** only these item kinds (e.g. a nav shows screens + plugins only); absent = every kind */
  kinds?: readonly string[];
  /** the app order (unlisted apps follow in surface order) */
  appOrder?: readonly string[];
  /** apps left out (a user hid them) */
  hiddenApps?: readonly string[];
  /** UAC: false = the item is left out */
  allowed?: (permission: string) => boolean;
}

const clampMax = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(4, Math.min(60, Math.round(n))) : MENU_INDEX_DEFAULTS.maxPerLevel);
const collator = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
const firstLetter = (s: string) => { const c = s.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase(); return c || '#'; };
const countOf = (n: MenuNode): number => (n.kind === 'item' ? 1 : n.count);

/** The surfaces in menu order: `appOrder` first, the rest as given; hidden apps dropped. */
export function orderSurfaces(surfaces: readonly ShellSurface[], appOrder: readonly string[] = [], hidden: readonly string[] = []): ShellSurface[] {
  const skip = new Set(hidden);
  const rank = (id: string) => { const i = appOrder.indexOf(id); return i < 0 ? appOrder.length : i; };
  return surfaces.map((s, i) => ({ s, i })).filter(({ s }) => !skip.has(s.app.id)).sort((a, b) => rank(a.s.app.id) - rank(b.s.app.id) || a.i - b.i).map(({ s }) => s);
}

function itemNode(app: string, it: SurfaceItem, favs: ReadonlySet<string>): MenuItemNode {
  const id = qualify(app, it);
  const n: MenuItemNode = { kind: 'item', id, label: it.label, app, itemKind: String(it.kind) };
  if (it.icon) n.icon = it.icon;
  if (it.detail) n.detail = it.detail;
  if (it.requires) n.requires = it.requires;
  if (favs.has(id)) n.favorite = true;
  return n;
}

/** Group then item order inside a level: groups first (by label), then items (by label, then ref). */
function sortLevel(nodes: MenuNode[]): MenuNode[] {
  return nodes.sort((a, b) => (a.kind === b.kind ? collator(a.label, b.label) || collator(a.id, b.id) : a.kind === 'group' ? -1 : 1));
}

/**
 * Fold a level that holds more than `max` entries into letter-range groups (`A–F`), keeping every range ≤ `max` and
 * never splitting one letter across two ranges unless that letter alone is over `max` (then it is split by count:
 * `S 1`, `S 2`). Repeats until the level fits. `pathId` is the level's own id; ranges get `<pathId>/<range>`.
 */
export function foldLevel(nodes: readonly MenuNode[], max: number, pathId: string): MenuNode[] {
  const m = clampMax(max);
  if (nodes.length <= m) return [...nodes];
  const sorted = [...nodes].sort((a, b) => collator(a.label, b.label) || collator(a.id, b.id));
  // buckets by first letter, in sorted order
  const buckets: { letter: string; nodes: MenuNode[] }[] = [];
  for (const n of sorted) {
    const l = firstLetter(n.label);
    const last = buckets[buckets.length - 1];
    if (last && last.letter === l) last.nodes.push(n); else buckets.push({ letter: l, nodes: [n] });
  }
  // pack whole letters into ranges of ≤ m entries; an over-full letter is split by count
  const ranges: { label: string; nodes: MenuNode[] }[] = [];
  let cur: { from: string; to: string; nodes: MenuNode[] } | null = null;
  const flush = () => { if (cur) { ranges.push({ label: cur.from === cur.to ? cur.from : `${cur.from}–${cur.to}`, nodes: cur.nodes }); cur = null; } };
  for (const b of buckets) {
    if (b.nodes.length > m) {
      flush();
      for (let i = 0, part = 1; i < b.nodes.length; i += m, part++) ranges.push({ label: `${b.letter} ${part}`, nodes: b.nodes.slice(i, i + m) });
      continue;
    }
    if (cur && cur.nodes.length + b.nodes.length > m) flush();
    if (!cur) cur = { from: b.letter, to: b.letter, nodes: [] };
    cur.to = b.letter; cur.nodes.push(...b.nodes);
  }
  flush();
  if (ranges.length <= m) return ranges.map((r) => rangeGroup(r.label, r.nodes, `${pathId}${PATH_SEP}${r.label}`));
  // still too many ranges: put them in chunks of ≤ m under outer ranges (`A–C`, …), ids nested under the outer one
  const outer: MenuNode[] = [];
  for (let i = 0; i < ranges.length; i += m) {
    const chunk = ranges.slice(i, i + m);
    const from = chunk[0]!.label.split(/[– ]/)[0]!, last = chunk[chunk.length - 1]!.label, to = last.includes('–') ? last.split('–')[1]! : last.split(' ')[0]!;
    const label = from === to ? `${from} (${i / m + 1})` : `${from}–${to}`;
    const id = `${pathId}${PATH_SEP}${label}`;
    outer.push(rangeGroup(label, chunk.map((r) => rangeGroup(r.label, r.nodes, `${id}${PATH_SEP}${r.label}`)), id));
  }
  return outer.length > m ? foldLevel(outer, m, pathId) : outer;
}
const rangeGroup = (label: string, children: MenuNode[], id: string): MenuGroupNode => ({ kind: 'group', id, label, range: true, count: children.reduce((a, n) => a + countOf(n), 0), children });

interface Draft { label: string; groups: Map<string, Draft>; items: MenuItemNode[]; /** made for an item's children (`parent`) */ parented?: boolean; /** that item, shown first */ lead?: MenuItemNode }
const newDraft = (label: string): Draft => ({ label, groups: new Map(), items: [] });

function finish(d: Draft, id: string, max: number, icon?: string): MenuGroupNode {
  // an item with a group of its own children (a settings tab and its settings) goes first inside that group
  const leads: MenuItemNode[] = [];
  for (const it of d.items) { const g = d.groups.get(it.label); if (g && g.parented) { g.lead = it; leads.push(it); } }
  const kids: MenuNode[] = [];
  for (const [label, g] of d.groups) kids.push(finish(g, `${id}${PATH_SEP}${label}`, max));
  kids.push(...d.items.filter((it) => !leads.includes(it)));
  const sorted = sortLevel(kids);
  if (d.lead) sorted.unshift(d.lead);
  const node: MenuGroupNode = { kind: 'group', id, label: d.label, count: sorted.reduce((a, n) => a + countOf(n), 0), children: foldLevel(sorted, max, id) };
  if (icon) node.icon = icon;
  return node;
}

/** The item's category path, with an item that sits under another (its `parent`) placed in a group named after that parent. */
function pathFor(it: SurfaceItem, byId: ReadonlyMap<string, SurfaceItem>): string[] {
  if (it.category?.length) return [...it.category];
  const base = categoryOf(it);
  const parent = it.parent ? byId.get(it.parent) : undefined;
  return parent ? [...base, parent.label] : base;
}

/** The menu tree over every surface (see the header). Empty groups are left out. */
export function buildMenuIndex(surfaces: readonly ShellSurface[], opts: MenuIndexOptions = {}): MenuIndex {
  const max = clampMax(opts.maxPerLevel);
  const favs = new Set(opts.favorites ?? []);
  const kinds = opts.kinds ? new Set(opts.kinds) : null;
  const allowed = opts.allowed ?? (() => true);
  const byRef = new Map<string, MenuItemNode>();
  const roots: MenuNode[] = [];
  for (const s of orderSurfaces(surfaces, opts.appOrder, opts.hiddenApps)) {
    const app = newDraft(s.app.label);
    // parents are looked up among the app's own items, by id (any kind but the item's own setting rows)
    const byId = new Map<string, SurfaceItem>();
    for (const it of s.items) if (!byId.has(it.id) || it.kind === 'settings') byId.set(it.id, it);
    for (const it of s.items) {
      if (kinds && !kinds.has(String(it.kind))) continue;
      if (it.requires && !allowed(it.requires)) continue;
      const node = itemNode(s.app.id, it, favs);
      byRef.set(node.id, node);
      let d = app;
      const path = pathFor(it, byId), parented = !it.category?.length && !!it.parent && byId.has(it.parent);
      path.forEach((part, i) => { let g = d.groups.get(part); if (!g) { g = newDraft(part); d.groups.set(part, g); } if (parented && i === path.length - 1) g.parented = true; d = g; });
      d.items.push(node);
    }
    if (app.groups.size || app.items.length) roots.push(finish(app, s.app.id, max, s.app.icon));
  }
  const total = byRef.size;
  const pick = (refs: readonly string[], limit: number) => { const out: MenuItemNode[] = []; const seen = new Set<string>(); for (const r of refs) { const n = byRef.get(r); if (n && !seen.has(r) && out.length < limit) { seen.add(r); out.push(n); } } return out; };
  const recents = pick(opts.recents ?? [], MENU_INDEX_DEFAULTS.recents);
  const favorites = pick(opts.favorites ?? [], MENU_INDEX_DEFAULTS.favorites);
  const head: MenuNode[] = [];
  if (favorites.length) head.push({ kind: 'group', id: FAVORITES_ID, label: 'Favorites', icon: 'star', count: favorites.length, children: foldLevel(favorites, max, FAVORITES_ID) });
  if (recents.length) head.push({ kind: 'group', id: RECENTS_ID, label: 'Recent', icon: 'clock', count: recents.length, children: recents.slice(0, max) });
  return { $axf: MENU_INDEX_CONTRACT, roots: [...head, ...roots], total };
}

/* ---------- walking ---------- */

/** The node ids from a root down to the node with `id` (a group path or an item ref), skipping Favorites / Recent; null when absent. */
export function menuPath(index: Pick<MenuIndex, 'roots'>, id: string): string[] | null {
  const walk = (nodes: readonly MenuNode[], trail: string[]): string[] | null => {
    for (const n of nodes) {
      if (n.id === FAVORITES_ID || n.id === RECENTS_ID) continue;
      if (n.id === id) return [...trail, n.id];
      if (n.kind === 'group') { const r = walk(n.children, [...trail, n.id]); if (r) return r; }
    }
    return null;
  };
  return walk(index.roots, []);
}

/** The node with `id` (first match, Favorites / Recent last), or null. */
export function menuNode(index: Pick<MenuIndex, 'roots'>, id: string): MenuNode | null {
  let hit: MenuNode | null = null;
  const walk = (nodes: readonly MenuNode[]) => { for (const n of nodes) { if (hit) return; if (n.id === id) { hit = n; return; } if (n.kind === 'group') walk(n.children); } };
  walk(index.roots.filter((r) => r.id !== FAVORITES_ID && r.id !== RECENTS_ID));
  if (!hit) walk(index.roots);
  return hit;
}

/** Every item in the index once (Favorites / Recent duplicates skipped), in tree order. */
export function menuItems(index: Pick<MenuIndex, 'roots'>): MenuItemNode[] {
  const out: MenuItemNode[] = []; const seen = new Set<string>();
  const walk = (nodes: readonly MenuNode[]) => { for (const n of nodes) { if (n.kind === 'item') { if (!seen.has(n.id)) { seen.add(n.id); out.push(n); } } else walk(n.children); } };
  walk(index.roots.filter((r) => r.id !== FAVORITES_ID && r.id !== RECENTS_ID));
  return out;
}

/* ---------- search / jump ---------- */

export interface MenuHit { id: string; label: string; app: string; itemKind: string; icon?: string; /** the group labels it sits under, app first */ path: string[]; score: number; favorite: boolean; recent: boolean }

/** Jump-to-anything: every item whose label, path, kind or detail matches every query word, best first (favorites, then recents, break ties). */
export function searchMenu(index: Pick<MenuIndex, 'roots'>, query: string, opts: { recents?: readonly string[]; limit?: number } = {}): MenuHit[] {
  const recents = opts.recents ?? [];
  const hits: MenuHit[] = [];
  const seen = new Set<string>();
  const walk = (nodes: readonly MenuNode[], path: string[]) => {
    for (const n of nodes) {
      if (n.kind === 'group') { walk(n.children, n.range ? path : [...path, n.label]); continue; }
      if (seen.has(n.id)) continue;
      const score = scoreEntry({ label: n.label, detail: [...path, n.detail ?? ''].join(' '), kind: n.itemKind }, query);
      if (score <= 0) continue;
      seen.add(n.id);
      const h: MenuHit = { id: n.id, label: n.label, app: n.app, itemKind: n.itemKind, path, score, favorite: !!n.favorite, recent: recents.includes(n.id) };
      if (n.icon) h.icon = n.icon;
      hits.push(h);
    }
  };
  walk(index.roots.filter((r) => r.id !== FAVORITES_ID && r.id !== RECENTS_ID), []);
  const rank = (h: MenuHit) => (h.favorite ? 2 : 0) + (h.recent ? 1 : 0);
  hits.sort((a, b) => b.score - a.score || rank(b) - rank(a) || collator(a.label, b.label) || collator(a.id, b.id));
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? Math.floor(opts.limit) : MENU_INDEX_DEFAULTS.searchLimit;
  return hits.slice(0, limit);
}

/* ---------- favorites and recents (pure list updates the shell saves) ---------- */

/** Add `ref` to the favorites (at the end) or take it out when it is there. At most `max` (default 50): the oldest go. */
export function toggleFavorite(list: readonly string[], ref: string, max: number = MENU_INDEX_DEFAULTS.favorites): string[] {
  if (!ref) return [...list];
  if (list.includes(ref)) return list.filter((r) => r !== ref);
  const out = [...list, ref];
  return out.slice(Math.max(0, out.length - max));
}

/** Put `ref` at the front of the recents (moved there if it was already in), at most `max` (default 20). */
export function pushRecent(list: readonly string[], ref: string, max: number = MENU_INDEX_DEFAULTS.recents): string[] {
  if (!ref) return [...list];
  return [ref, ...list.filter((r) => r !== ref)].slice(0, max);
}

/** Refs no surface has any more (an app or plugin was removed): drop them from a saved list. */
export function pruneRefs(list: readonly string[], index: Pick<MenuIndex, 'roots'>): string[] {
  const live = new Set(menuItems(index).map((n) => n.id));
  return list.filter((r) => live.has(r));
}

/* ---------- three-dot overflow on a narrow bar ---------- */

/**
 * How many of a bar's entries fit before the three-dot button: entries are kept in order while their widths (plus
 * `gap` between them) fit in `available`; once one doesn't, the rest go to the overflow and room is kept for the
 * three-dot button (`moreWidth`). All in the same unit (CSS px). Returns the count kept (0..widths.length).
 */
export function fitBar(widths: readonly number[], available: number, moreWidth: number, gap = 0): number {
  const w = widths.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const total = w.reduce((a, x) => a + x, 0) + gap * Math.max(0, w.length - 1);
  if (total <= available) return w.length;
  let used = moreWidth, kept = 0;
  for (const x of w) { const next = used + gap + x; if (next > available) break; used = next; kept++; }
  return kept;
}
