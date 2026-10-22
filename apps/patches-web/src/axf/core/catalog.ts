/**
 * Typed catalog models — the framework's own data files as one contract for every port.
 *
 *   catalog@1      framework/catalog/catalog.json      feature catalog: tabs → groups → items (+ suggestions)
 *   status         framework/catalog/status.json       id → { status, wave, module, notes }
 *   tracker@1      tracker.json                         catalog × status, flattened (what the tracker views show)
 *   library@1      framework/{android,libs,python}/<lib>/library.json   one installable library
 *   libraries@1    framework/catalog/libraries.json    every library@1, merged by id (framework/cli/libraries.mjs)
 *   boilerplate@1  framework/boilerplates/<id>/boilerplate.json
 *   boilerplates@1 framework/boilerplates/index.json
 *
 * Types + small, lenient parsers (unknown → typed, missing fields get the same defaults on every port) + the helpers the
 * consoles share: library install parameters (default text, wizard answer → JSON, validation) and `libraryCards`, the
 * catalog-driven list of framework libraries (catalog items that name a library, every library@1, every `lib-*` module
 * the tracker knows), so a new library appears by itself. Kotlin: `ai.amberx.axf.kernel.catalog` (same names, same
 * defaults); both replay spec/fixtures/catalog.json. Build Pilot keeps its own server-shaped `Catalog` (templates,
 * build options, …) and uses these for the parts that are framework files.
 */

/* ================================================================== catalog@1 */

export interface CatalogSuggestion { id: string; title: string }
/** A catalog item that names a framework library (modules tab): what the library pickers show for it. */
export interface CatalogLibraryRef { module: string; id?: string; label?: string; description?: string; features?: string[] }
export interface CatalogItem {
  id: string; title: string; note: string; tag: string; recommended: boolean; suggests: CatalogSuggestion[];
  /** Filled by the parser from the enclosing tab/group (not stored in catalog.json). */
  tab: string; group: string;
  library?: CatalogLibraryRef;
}
export interface CatalogGroup { id: string; label: string; items: CatalogItem[] }
export interface CatalogTab { id: string; label: string; groups: CatalogGroup[] }
export interface Catalog { frameworkVersion: string; generatedAt?: string; tabs: CatalogTab[] }

/* ================================================================== status + tracker@1 */

export type FeatureStatus = 'built' | 'partial' | 'placeholder' | 'planned';
export const FEATURE_STATUSES: FeatureStatus[] = ['built', 'partial', 'placeholder', 'planned'];
export interface StatusEntry { status: FeatureStatus; wave: number; module: string | null; notes: string }
export type StatusMap = Record<string, StatusEntry>;
export interface TrackerItem { id: string; tab: string; group: string; parent?: string; title: string; tag: string; status: FeatureStatus; wave: number; module: string | null; notes: string }
export interface TrackerTabSummary { built: number; partial: number; placeholder: number; planned: number; total: number; coverage: number }
export interface Tracker { frameworkVersion?: string; generatedAt: string; summary: Record<string, Record<string, number>>; items: TrackerItem[] }

/* ================================================================== library@1 + libraries@1 */

import type { LibraryParam, LibraryParamType } from './library';
export type { LibraryParam, LibraryParamType } from './library';
export interface LibraryInstall { gradle?: string; module?: string; import?: string; routes?: string[] }
export interface LibraryPort { status: string; dir?: string; note?: string; checkedAt?: string }
export interface LibraryPlaceholder { capability: string; note: string }
/** library@1: one installable library (the install wizard asks for `params`; `install` is the Android wiring). */
export interface LibraryDescriptor {
  id: string; module: string; name: string; description: string; features: string[]; dependsOn: string[]; manifestKey: string; params: LibraryParam[];
  install?: LibraryInstall; ports?: Record<string, LibraryPort>; placeholders?: LibraryPlaceholder[]; template?: string;
  /** UI-kit ports (console Explorer): which source it came from and what it covers. */
  port?: { source?: { kind: string; url?: string; coordinate?: string; path?: string }; version?: string; covers?: string[]; ported?: boolean };
}
export interface LibrariesIndex { generatedAt: string; items: LibraryDescriptor[] }

/* ================================================================== boilerplate@1 + boilerplates@1 */

export interface BoilerplateScreen { id: string; label: string; kind: string }
export type BoilerplateLibraryPick = string | { library: string; params?: Record<string, unknown> };
export interface BoilerplateScreenshot { file: string; screen?: string; caption?: string }
export interface Boilerplate {
  id: string; name: string; category: string; description: string; features: string[]; screens: BoilerplateScreen[]; modules: string[];
  libraries?: BoilerplateLibraryPick[]; defaults: Record<string, string>; status: string; source: string; screenshots?: BoilerplateScreenshot[];
}
export interface BoilerplateSummary { id: string; name: string; category: string; description: string; status: string; source: string; features?: number; screens?: number; modules?: string[]; libraries?: string[] }
export interface BoilerplateIndex { categories: { id: string; label: string }[]; items: BoilerplateSummary[] }

/* ================================================================== lenient readers (same defaults as the Kotlin JsonObject helpers) */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const objOrNull = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const prim = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined);
const str = (o: Obj, k: string, d = ''): string => prim(o[k]) ?? d;
const strOrNull = (o: Obj, k: string): string | null => prim(o[k]) ?? null;
const bool = (o: Obj, k: string, d = false): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d);
const int = (o: Obj, k: string, d: number): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? Math.trunc(o[k] as number) : d);
const num = (o: Obj, k: string): number | undefined => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : undefined);
const arr = (o: Obj, k: string): unknown[] => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);
const strList = (o: Obj, k: string): string[] => arr(o, k).map(prim).filter((x): x is string => x !== undefined);
const objList = (o: Obj, k: string): Obj[] => arr(o, k).map(objOrNull).filter((x): x is Obj => x !== null);
const strMap = (o: Obj, k: string): Record<string, string> => Object.fromEntries(Object.entries(obj(o[k])).map(([key, v]) => [key, prim(v)] as const).filter((e): e is [string, string] => e[1] !== undefined));

/** Unknown status text → a status (anything else reads as planned, like the tracker). */
export function parseFeatureStatus(s: unknown): FeatureStatus {
  const t = typeof s === 'string' ? s.toLowerCase() : '';
  return (FEATURE_STATUSES as string[]).includes(t) ? (t as FeatureStatus) : 'planned';
}

/* ================================================================== parsers */

function parseLibraryRef(v: unknown): CatalogLibraryRef | undefined {
  const o = objOrNull(v);
  if (!o || !str(o, 'module')) return undefined;
  const r: CatalogLibraryRef = { module: str(o, 'module') };
  if (strOrNull(o, 'id') !== null) r.id = str(o, 'id');
  if (strOrNull(o, 'label') !== null) r.label = str(o, 'label');
  if (strOrNull(o, 'description') !== null) r.description = str(o, 'description');
  if (Array.isArray(o.features)) r.features = strList(o, 'features');
  return r;
}

/** catalog.json → Catalog (each item gets its tab and group ids). */
export function parseCatalog(json: unknown): Catalog {
  const c = obj(json);
  const out: Catalog = {
    frameworkVersion: str(c, 'frameworkVersion', '0.2.0'),
    tabs: objList(c, 'tabs').map((t) => ({
      id: str(t, 'id'), label: str(t, 'label'),
      groups: objList(t, 'groups').map((g) => ({
        id: str(g, 'id'), label: str(g, 'label'),
        items: objList(g, 'items').map((i) => {
          const item: CatalogItem = {
            id: str(i, 'id'), title: str(i, 'title'), note: str(i, 'note'), tag: str(i, 'tag'), recommended: bool(i, 'recommended'),
            suggests: objList(i, 'suggests').map((s) => ({ id: str(s, 'id'), title: str(s, 'title') })), tab: str(t, 'id'), group: str(g, 'id'),
          };
          const lib = parseLibraryRef(i.library);
          if (lib) item.library = lib;
          return item;
        }),
      })),
    })),
  };
  if (strOrNull(c, 'generatedAt') !== null) out.generatedAt = str(c, 'generatedAt');
  return out;
}

/** Every catalog item, in catalog order. */
export const catalogItems = (c: Catalog): CatalogItem[] => c.tabs.flatMap((t) => t.groups.flatMap((g) => g.items));

/** status.json → StatusMap (`note` is read as `notes`; unknown status → planned). */
export function parseStatusMap(json: unknown): StatusMap {
  const out: StatusMap = {};
  for (const [id, v] of Object.entries(obj(json))) {
    const o = obj(v);
    out[id] = { status: parseFeatureStatus(o.status), wave: int(o, 'wave', 3), module: strOrNull(o, 'module'), notes: str(o, 'notes', str(o, 'note')) };
  }
  return out;
}

/** tracker.json → Tracker. */
export function parseTracker(json: unknown): Tracker {
  const t = obj(json);
  const summary: Tracker['summary'] = {};
  for (const [tab, v] of Object.entries(obj(t.summary))) summary[tab] = Object.fromEntries(Object.entries(obj(v)).filter(([, n]) => typeof n === 'number')) as Record<string, number>;
  const out: Tracker = {
    generatedAt: str(t, 'generatedAt'), summary,
    items: objList(t, 'items').map((i) => {
      const it: TrackerItem = { id: str(i, 'id'), tab: str(i, 'tab'), group: str(i, 'group'), title: str(i, 'title'), tag: str(i, 'tag'), status: parseFeatureStatus(i.status), wave: int(i, 'wave', 3), module: strOrNull(i, 'module'), notes: str(i, 'notes') };
      const parent = strOrNull(i, 'parent');
      if (parent !== null) it.parent = parent;
      return it;
    }),
  };
  if (strOrNull(t, 'frameworkVersion') !== null) out.frameworkVersion = str(t, 'frameworkVersion');
  return out;
}

const PARAM_TYPES: LibraryParamType[] = ['text', 'list', 'bool', 'number', 'choice'];
export function parseLibraryParam(json: unknown): LibraryParam {
  const o = obj(json);
  const type = str(o, 'type', 'text');
  const p: LibraryParam = { key: str(o, 'key'), label: str(o, 'label'), type: (PARAM_TYPES as string[]).includes(type) ? (type as LibraryParamType) : 'text' };
  if (bool(o, 'required')) p.required = true;
  if (o.default !== undefined && o.default !== null) p.default = o.default;
  if (strOrNull(o, 'help') !== null) p.help = str(o, 'help');
  if (Array.isArray(o.choices)) p.choices = strList(o, 'choices');
  const min = num(o, 'min'); if (min !== undefined) p.min = min;
  const max = num(o, 'max'); if (max !== undefined) p.max = max;
  return p;
}

/** library.json (library@1) → LibraryDescriptor. `manifestKey` defaults to `libraries.<module without lib->`. */
export function parseLibrary(json: unknown): LibraryDescriptor {
  const o = obj(json);
  const module = str(o, 'module');
  const lib: LibraryDescriptor = {
    id: str(o, 'id'), module, name: str(o, 'name'), description: str(o, 'description'), features: strList(o, 'features'), dependsOn: strList(o, 'dependsOn'),
    manifestKey: str(o, 'manifestKey', `libraries.${module.replace(/^lib-/, '')}`), params: objList(o, 'params').map(parseLibraryParam),
  };
  const ins = objOrNull(o.install);
  if (ins) {
    const install: LibraryInstall = {};
    for (const k of ['gradle', 'module', 'import'] as const) if (strOrNull(ins, k) !== null) install[k] = str(ins, k);
    if (Array.isArray(ins.routes)) install.routes = strList(ins, 'routes');
    lib.install = install;
  }
  const ports = objOrNull(o.ports);
  if (ports) {
    lib.ports = {};
    for (const [k, v] of Object.entries(ports)) {
      const p = obj(v);
      const port: LibraryPort = { status: str(p, 'status') };
      for (const f of ['dir', 'note', 'checkedAt'] as const) if (strOrNull(p, f) !== null) port[f] = str(p, f);
      lib.ports[k] = port;
    }
  }
  if (Array.isArray(o.placeholders)) lib.placeholders = objList(o, 'placeholders').map((p) => ({ capability: str(p, 'capability'), note: str(p, 'note') }));
  if (strOrNull(o, 'template') !== null) lib.template = str(o, 'template');
  if (objOrNull(o.port)) lib.port = o.port as LibraryDescriptor['port'];
  return lib;
}

/** libraries.json (libraries@1) → LibrariesIndex. A bare `{ items }` (the console API's answer) reads the same. */
export function parseLibrariesIndex(json: unknown): LibrariesIndex {
  const o = obj(json);
  return { generatedAt: str(o, 'generatedAt'), items: objList(o, 'items').map(parseLibrary) };
}

/** boilerplate.json (boilerplate@1) → Boilerplate (category starter, screen kind custom, status planned, source amberx by default). */
export function parseBoilerplate(json: unknown): Boilerplate {
  const o = obj(json);
  const b: Boilerplate = {
    id: str(o, 'id'), name: str(o, 'name'), category: str(o, 'category', 'starter'), description: str(o, 'description'), features: strList(o, 'features'),
    screens: objList(o, 'screens').map((s) => ({ id: str(s, 'id'), label: str(s, 'label'), kind: str(s, 'kind', 'custom') })), modules: strList(o, 'modules'),
    defaults: strMap(o, 'defaults'), status: str(o, 'status', 'planned'), source: str(o, 'source', 'amberx'),
  };
  const libs = arr(o, 'libraries').flatMap((l): BoilerplateLibraryPick[] => {
    if (typeof l === 'string') return [l];
    const lo = objOrNull(l);
    if (!lo || !str(lo, 'library')) return [];
    const params = objOrNull(lo.params);
    return [params ? { library: str(lo, 'library'), params } : { library: str(lo, 'library') }];
  });
  if (libs.length) b.libraries = libs;
  const shots = objList(o, 'screenshots').filter((s) => str(s, 'file')).map((s) => {
    const r: BoilerplateScreenshot = { file: str(s, 'file') };
    if (strOrNull(s, 'screen') !== null) r.screen = str(s, 'screen');
    if (strOrNull(s, 'caption') !== null) r.caption = str(s, 'caption');
    return r;
  });
  if (shots.length) b.screenshots = shots;
  return b;
}

/** A boilerplate's library ids (string picks and `{ library }` picks alike). */
export const boilerplateLibraryIds = (b: Boilerplate): string[] => (b.libraries ?? []).map((l) => (typeof l === 'string' ? l : l.library));

/** boilerplates/index.json (boilerplates@1) → BoilerplateIndex. */
export function parseBoilerplateIndex(json: unknown): BoilerplateIndex {
  const o = obj(json);
  return {
    categories: objList(o, 'categories').map((c) => ({ id: str(c, 'id'), label: str(c, 'label') })),
    items: objList(o, 'items').map((i) => {
      const s: BoilerplateSummary = { id: str(i, 'id'), name: str(i, 'name'), category: str(i, 'category', 'starter'), description: str(i, 'description'), status: str(i, 'status', 'planned'), source: str(i, 'source', 'amberx') };
      const f = num(i, 'features'); if (f !== undefined) s.features = f;
      const sc = num(i, 'screens'); if (sc !== undefined) s.screens = sc;
      if (Array.isArray(i.modules)) s.modules = strList(i, 'modules');
      if (Array.isArray(i.libraries)) s.libraries = strList(i, 'libraries');
      return s;
    }),
  };
}

/* ================================================================== library install parameters (both consoles' wizards)
 * One source: library@1 parameters live in core/library.ts (= Kotlin kernel.library.LibraryParams, fixture
 * library-params.json); re-exported here so catalog users keep one import. */

export { paramDefaultText, paramToJson, paramError } from './library';

/* ================================================================== catalog-driven library list */

/** One framework library as the library pickers show it. `id` is the short slug (`voice` for lib-voice). */
export interface LibraryCard {
  id: string; module: string; packageName: string; label: string; description: string; features: string[];
  /** a library@1 exists for it (the install wizard can add it to an app) */
  installable: boolean;
  /** where the card came from first: a catalog item that names it, a library@1, or only the tracker's module field */
  source: 'catalog' | 'library' | 'tracker';
}

const slugOf = (pkg: string) => pkg.replace(/^lib-/, '');
const moduleIdOf = (pkg: string) => `ai.amberx.axf.${slugOf(pkg).replace(/-/g, '.')}`;
const pushAll = (into: string[], more: string[]) => { for (const f of more) if (!into.includes(f)) into.push(f); };

/**
 * Every framework library, from the data (no hard-coded list): (1) catalog items with a `library` ref, in catalog
 * order; (2) every library@1 (merged into its catalog card, else a new card: name, description, features); (3) every
 * `lib-*` module the tracker names that is still missing, with the tracker items of that module as its features.
 */
export function libraryCards(catalog: Catalog, libraries: LibraryDescriptor[], tracker?: Tracker | null): LibraryCard[] {
  const cards: LibraryCard[] = [];
  const byPkg = new Map<string, LibraryCard>();
  for (const item of catalogItems(catalog)) {
    const ref = item.library;
    if (!ref || byPkg.has(ref.module)) continue;
    const [head, ...rest] = item.title.split(' — ');
    const card: LibraryCard = {
      id: slugOf(ref.module), module: ref.id ?? (item.note.startsWith('ai.amberx.axf.') ? item.note : moduleIdOf(ref.module)), packageName: ref.module,
      label: ref.label ?? head ?? ref.module, description: ref.description ?? rest.join(' — '), features: [...new Set(ref.features ?? [])], installable: false, source: 'catalog',
    };
    cards.push(card); byPkg.set(ref.module, card);
  }
  for (const lib of libraries) {
    if (!lib.module) continue;
    const have = byPkg.get(lib.module);
    if (have) { have.installable = true; have.module = lib.id || have.module; pushAll(have.features, lib.features); continue; }
    const card: LibraryCard = { id: slugOf(lib.module), module: lib.id || moduleIdOf(lib.module), packageName: lib.module, label: lib.name || lib.module, description: lib.description, features: [...new Set(lib.features)], installable: true, source: 'library' };
    cards.push(card); byPkg.set(lib.module, card);
  }
  for (const t of tracker?.items ?? []) {
    const pkg = t.module;
    if (!pkg || !/^lib-[a-z0-9][a-z0-9-]*$/.test(pkg)) continue;
    let card = byPkg.get(pkg);
    if (!card) { card = { id: slugOf(pkg), module: moduleIdOf(pkg), packageName: pkg, label: pkg, description: '', features: [], installable: false, source: 'tracker' }; cards.push(card); byPkg.set(pkg, card); }
    if (card.source === 'tracker') pushAll(card.features, [t.id]);
  }
  return cards;
}
