/**
 * Icon map engine (icon-map@1, spec/ICON-MAP.md). Reference implementation; pure, no DOM.
 *
 *   foldIconMap(id, get)                  an icon-map asset with its `extends` chain folded (inherit@1, depth ≤ 4)
 *   buildIconRegistry(maps, runtime)      every spot: icon-map assets first (an asset entry wins), then run-time
 *                                         registrations (rt.registerIconSpot), the same id deduped and recorded
 *   registerIconSpot(registry, spot)      one more run-time spot (a new registry back; an asset entry is never replaced)
 *   iconCoverage(registry, chain, get)    which spots a place's packs reach (by spot / by name), which fall to the framework
 *   searchIconSpots(registry, query)      by text, app, area, kind, tag, dynamic
 *   spotTree(registry)                    app → area → spots, for the designer's tree
 *
 * Fixture: spec/fixtures/icon-pack.json (`coverage`, `registry`). Kotlin twin deferred (PORTING.md).
 */
import { ICON_MAP_LIMITS, normalizeIconMap, normalizeSpot, parseSpotId, SPOT_ID, SPOT_KINDS, type IconMapData, type IconSpot, type SpotKind } from './icon-rules.mjs';
import { resolveIcon, type IconChainLevel, type IconWin, type PackGetter } from './icon-pack';

export { normalizeIconMap, normalizeSpot, parseSpotId, SPOT_KINDS };
export type { IconMapData, IconSpot, SpotKind };

export const ICON_MAP_ENGINE = 'icon-map@1';
export const ICON_REGISTRY_MAX = 8000;

export type MapGetter = (id: string) => unknown | null | undefined;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const dataOf = (a: unknown): unknown => (isObj(a) && isObj(a.data) ? a.data : a);
const idOf = (a: unknown, fallback: string): string => (isObj(a) && typeof a.id === 'string' ? a.id : fallback);

/** A registered spot: the normalized entry plus where it came from. */
export interface RegisteredSpot extends IconSpot {
  app: string;
  area: string;
  slot: string;
  from: 'asset' | 'runtime';
  /** icon-map asset ids that list it (asset entries), or [] for a run-time registration */
  maps: string[];
}

export interface IconRegistry {
  spots: Record<string, RegisteredSpot>;
  /** ids registered more than once: `{ id, kept, dropped }` (kept = asset over runtime, else the first) */
  duplicates: { id: string; kept: 'asset' | 'runtime'; dropped: 'asset' | 'runtime'; map?: string }[];
  /** entries that were refused and why */
  problems: string[];
  /** icon-map asset ids folded in, in order */
  maps: string[];
}

export interface FoldedIconMap extends IconMapData { id: string; chain: string[]; broken: string[]; /** spot id → the map in the chain that declared it */ origin: Record<string, string> }

/* ---------------------------------------------------------------- fold */

/** The icon-map `id` with its `extends` chain folded: spots the child lacks come from the parent (child over parent). */
export function foldIconMap(id: string, get: MapGetter): FoldedIconMap | null {
  const root = get(id);
  if (!root) return null;
  const head = normalizeIconMap(dataOf(root));
  const out: FoldedIconMap = { ...head, id, chain: [id], broken: [], spots: { ...head.spots }, origin: Object.fromEntries(Object.keys(head.spots).map((s) => [s, id])) };
  let next = head.extends;
  const seen = new Set([id]);
  while (next) {
    if (seen.has(next) || out.chain.length >= ICON_MAP_LIMITS.extendsDepth) { out.broken.push(next); break; }
    const raw = get(next);
    if (!raw) { out.broken.push(next); break; }
    const parent = normalizeIconMap(dataOf(raw));
    seen.add(next);
    out.chain.push(next);
    for (const [s, v] of Object.entries(parent.spots)) if (!(s in out.spots)) { out.spots[s] = v; out.origin[s] = next; }
    next = parent.extends;
  }
  out.extends = '';
  return out;
}

/* ---------------------------------------------------------------- registry */

const emptyRegistry = (): IconRegistry => ({ spots: {}, duplicates: [], problems: [], maps: [] });

function place(reg: IconRegistry, spot: IconSpot, from: 'asset' | 'runtime', map = ''): void {
  const parts = parseSpotId(spot.id);
  if (!parts) { reg.problems.push(`${spot.id}: not a spot id (<app>:<area>/<slot>)`); return; }
  const have = reg.spots[spot.id];
  if (have) {
    if (have.from === 'runtime' && from === 'asset') {
      // an asset entry wins over a run-time one: it is the designed truth; the run-time registration keeps the id alive
      reg.duplicates.push({ id: spot.id, kept: 'asset', dropped: 'runtime', map });
      reg.spots[spot.id] = { ...spot, ...parts, from: 'asset', maps: [map] };
    } else {
      if (from === 'asset' && map && !have.maps.includes(map)) have.maps.push(map);
      reg.duplicates.push({ id: spot.id, kept: have.from, dropped: from, ...(map ? { map } : {}) });
      // a later entry may fill fields the first left empty (a run-time registration adds the file list, a map adds help)
      if (!have.glyph && spot.glyph) { have.glyph = spot.glyph; have.dynamic = spot.dynamic; }
      if (!have.label && spot.label) have.label = spot.label;
      if (!have.help && spot.help) have.help = spot.help;
      for (const t of spot.tags) if (!have.tags.includes(t) && have.tags.length < ICON_MAP_LIMITS.tags) have.tags.push(t);
    }
    return;
  }
  if (Object.keys(reg.spots).length >= ICON_REGISTRY_MAX) { reg.problems.push(`${spot.id}: registry full (${ICON_REGISTRY_MAX})`); return; }
  reg.spots[spot.id] = { ...spot, ...parts, from, maps: map ? [map] : [] };
}

/**
 * The registry from icon-map assets (each folded through `get` when it extends another) and run-time registrations.
 * Assets are read in the order given; a run-time spot never replaces an asset's entry.
 */
export function buildIconRegistry(maps: unknown[], runtime: unknown[] = [], get: MapGetter = () => null): IconRegistry {
  const reg = emptyRegistry();
  const ids = new Set(maps.map((m, i) => idOf(m, `map-${i}`)));
  const lookup: MapGetter = (id) => get(id) ?? maps.find((m) => idOf(m, '') === id);
  for (const [i, m] of maps.entries()) {
    const id = idOf(m, `map-${i}`);
    const folded = foldIconMap(id, (x) => (x === id ? m : lookup(x)));
    if (!folded) { reg.problems.push(`${id}: not an icon map`); continue; }
    reg.maps.push(id);
    for (const b of folded.broken) reg.problems.push(`${id}: extends "${b}" is missing, cyclic or too deep`);
    // a parent that is itself in the list places its own spots on its own turn (no duplicate); one outside the list contributes through the fold
    for (const s of Object.values(folded.spots)) { const from = folded.origin[s.id]; if (from === id || !ids.has(from)) place(reg, s, 'asset', from === id ? id : `${id}<${from}`); }
  }
  for (const r of runtime) {
    const id = isObj(r) && typeof r.id === 'string' ? r.id : '';
    if (!SPOT_ID.test(id)) { reg.problems.push(`${String(id || r)}: not a spot id (<app>:<area>/<slot>)`); continue; }
    place(reg, normalizeSpot(id, r), 'runtime');
  }
  return reg;
}

/** One more run-time registration; a new registry (the given one is not changed). */
export function registerIconSpot(registry: IconRegistry, raw: unknown): IconRegistry {
  const id = isObj(raw) && typeof raw.id === 'string' ? raw.id : typeof raw === 'string' ? raw : '';
  const reg: IconRegistry = { spots: { ...registry.spots }, duplicates: [...registry.duplicates], problems: [...registry.problems], maps: [...registry.maps] };
  for (const k of Object.keys(reg.spots)) reg.spots[k] = { ...reg.spots[k], tags: [...reg.spots[k].tags], maps: [...reg.spots[k].maps] };
  if (!SPOT_ID.test(id)) { reg.problems.push(`${String(id || raw)}: not a spot id (<app>:<area>/<slot>)`); return reg; }
  place(reg, normalizeSpot(id, isObj(raw) ? raw : {}), 'runtime');
  return reg;
}

/** Spots in registry order (sorted by id for stable output). */
export function listIconSpots(registry: IconRegistry): RegisteredSpot[] {
  return Object.values(registry.spots).sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------------------------------------------------------------- coverage */

export interface SpotCoverage { id: string; kind: SpotKind; dynamic: boolean; by: IconWin; scope: string; pack: string; name: string }
export interface IconCoverage {
  total: number;
  /** spots a pack in the chain draws (by spot or by name, or an override) */
  covered: number;
  /** spots that fall to the framework glyph */
  framework: number;
  /** dynamic spots: counted in `total`, reported apart (their name is known only at run time) */
  dynamic: number;
  by: Record<IconWin, number>;
  /** ids of the static spots no pack reaches */
  missing: string[];
  perApp: Record<string, { total: number; covered: number; missing: number; dynamic: number }>;
  spots: SpotCoverage[];
}

/**
 * How far a place's packs reach: every registered spot resolved through `chain`. A dynamic spot is resolved with no
 * name (only a per-spot entry or an override can reach it) and reported under `dynamic`, never as missing.
 */
export function iconCoverage(registry: IconRegistry, chain: IconChainLevel[], get: PackGetter): IconCoverage {
  const out: IconCoverage = { total: 0, covered: 0, framework: 0, dynamic: 0, by: { override: 0, spot: 0, name: 0, framework: 0 }, missing: [], perApp: {}, spots: [] };
  for (const s of listIconSpots(registry)) {
    const r = resolveIcon(s.id, s.glyph, chain, get);
    const app = (out.perApp[s.app] ??= { total: 0, covered: 0, missing: 0, dynamic: 0 });
    out.total++; app.total++;
    out.by[r.by]++;
    out.spots.push({ id: s.id, kind: s.kind, dynamic: s.dynamic, by: r.by, scope: r.scope, pack: r.pack, name: r.name });
    if (r.by !== 'framework') { out.covered++; app.covered++; continue; }
    if (s.dynamic) { out.dynamic++; app.dynamic++; continue; }
    out.framework++; app.missing++;
    out.missing.push(s.id);
  }
  return out;
}

/* ---------------------------------------------------------------- search and tree */

export interface SpotQuery { q?: string; app?: string; area?: string; kind?: SpotKind | ''; tag?: string; dynamic?: boolean; limit?: number }

/** Spots matching every given part of the query; `q` matches id, glyph, label, tags (case-insensitive, words AND-ed). */
export function searchIconSpots(registry: IconRegistry, query: SpotQuery = {}): RegisteredSpot[] {
  const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(query.limit ?? 500, ICON_REGISTRY_MAX));
  const out: RegisteredSpot[] = [];
  for (const s of listIconSpots(registry)) {
    if (query.app && s.app !== query.app) continue;
    if (query.area && s.area !== query.area) continue;
    if (query.kind && s.kind !== query.kind) continue;
    if (query.tag && !s.tags.includes(query.tag)) continue;
    if (query.dynamic !== undefined && s.dynamic !== query.dynamic) continue;
    if (words.length) {
      const hay = `${s.id} ${s.glyph} ${s.label} ${s.tags.join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export interface SpotTreeArea { area: string; spots: RegisteredSpot[]; dynamic: number }
export interface SpotTreeApp { app: string; areas: SpotTreeArea[]; total: number }

/** app → area → spots, each level sorted, for the designer's spot tree. */
export function spotTree(registry: IconRegistry): SpotTreeApp[] {
  const apps = new Map<string, Map<string, RegisteredSpot[]>>();
  for (const s of listIconSpots(registry)) {
    const areas = apps.get(s.app) ?? new Map<string, RegisteredSpot[]>();
    apps.set(s.app, areas);
    const list = areas.get(s.area) ?? [];
    areas.set(s.area, list);
    list.push(s);
  }
  return [...apps.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([app, areas]) => {
    const list = [...areas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([area, spots]) => ({ area, spots, dynamic: spots.filter((s) => s.dynamic).length }));
    return { app, areas: list, total: list.reduce((n, a) => n + a.spots.length, 0) };
  });
}

/** The distinct glyph names static spots ask for (what a per-name pack must cover to reach them all). */
export function spotGlyphNames(registry: IconRegistry): string[] {
  return [...new Set(listIconSpots(registry).map((s) => s.glyph).filter(Boolean))].sort();
}
