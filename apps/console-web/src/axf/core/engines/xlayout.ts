/*
 * xLayout (xlayout@1) — Molly as ONE app (Brett, Nov 2 2026): the host-side layout model that makes several apps
 * (AmberX, axHub web, the Dev Console) look like one. The asset says
 *   - which apps the host frames (`apps`: id, label, url, namespace prefix);
 *   - how each kind of chrome is handled (`merge`: `host` = only the host's own; `merged` = one bar merged from every
 *     app's, the guests hide theirs and send them as data; `guest` = each app keeps its own);
 *   - the IDE switch (`ide`: on / off, the pane limit, the dock-layout@1 preset in force, the presets offered, an
 *     optional inline preset tree);
 *   - up to three plugin toolbar slots (`toolbars`: visible, location, items; each item opens in the main area, a
 *     floating window, or — IDE on — a pane).
 * Pure rules; the chrome merge itself is engines/chrome.ts (chrome@1), the pane tree is engines/dock.ts (dock@1). The
 * Toolbar designer is its own plugin reached through a capability service; this engine only holds what it saves.
 * Molly-only: standalone apps never load an xlayout asset and stay exactly as they are. Kotlin twin deferred
 * (spec/PORTING.md); fixture spec/fixtures/xlayout.json.
 */
import { DOCK_LAYOUT_MAX_PANES, normalizeDockRules, parsePresetTree, type PresetPane } from './dock';
import { embedTakeIds, embedUrlFull, userAgentSuffixFull } from './embed';

export const XLAYOUT_CONTRACT = 'xlayout@1';

/** The kinds of chrome a host can merge across the apps it frames (asset types, plus `widgets` = banner widgets). */
export const CHROME_KINDS = ['banner', 'app-menu', 'nav-menu', 'context-menu', 'toolbar', 'widgets'] as const;
export type ChromeKind = (typeof CHROME_KINDS)[number];
export const MERGE_MODES = ['host', 'merged', 'guest'] as const;
export type MergeMode = (typeof MERGE_MODES)[number];
/** What Molly does unless the asset says otherwise: one banner (the host's), everything else merged. */
export const DEFAULT_MERGE: Readonly<Record<ChromeKind, MergeMode>> = { banner: 'host', 'app-menu': 'merged', 'nav-menu': 'merged', 'context-menu': 'merged', toolbar: 'merged', widgets: 'merged' };

export const TOOLBAR_SLOT_COUNT = 3;
export const TOOLBAR_LOCATIONS = ['top', 'bottom', 'left', 'right'] as const;
export type ToolbarLocation = (typeof TOOLBAR_LOCATIONS)[number];
export const OPEN_TARGETS = ['main', 'floating', 'pane'] as const;
export type OpenTarget = (typeof OPEN_TARGETS)[number];
export const DEFAULT_PRESETS: readonly string[] = ['single', 'two-columns', 'two-rows', 'main-side', 'side-main', 'main-bottom', 'three-columns', 'top-two-below', 'grid-2x2', 'ide'];
export const XLAYOUT_LIMITS = { apps: 12, items: 40, presets: 10, label: 80, url: 300, id: 48 } as const;

const APP_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,159}$/;
const ICON_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ASSET_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** `<app>:<id>`: the app's own id of a menu item, nav entry, toolbar button or context item, namespaced by the host. */
export const NS_SEP = ':';

export interface XLayoutApp {
  /** the app's id in the host (also its namespace prefix and the first part of a deep link `#/<id>/…`) */
  id: string;
  label: string;
  /** the app's own address (https) */
  url: string;
  icon?: string;
}
export interface XToolbarItem {
  id: string;
  label: string;
  icon?: string;
  /** the app whose item this is (absent = the host's own action) */
  app?: string;
  /** host action id, or the app's item id (namespaced `<app>:<id>` when `app` is set) */
  action: string;
  open: OpenTarget;
}
export interface XToolbarSlot {
  /** 1..3 */
  slot: number;
  visible: boolean;
  location: ToolbarLocation;
  label: string;
  items: XToolbarItem[];
}
export interface XLayoutIde {
  on: boolean;
  paneLimit: number;
  /** the dock-layout@1 preset in force */
  preset: string;
  /** the presets offered in the layout picker, in order (dock-layout ids) */
  presets: string[];
  /** a preset tree of its own (the Toolbar designer / layout editor saves one); wins over `preset` when present */
  tree?: PresetPane;
}
export interface XLayoutData {
  apps: XLayoutApp[];
  merge: Record<ChromeKind, MergeMode>;
  ide: XLayoutIde;
  toolbars: XToolbarSlot[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
const httpsUrl = (v: unknown): string | null => { const s = str(v, XLAYOUT_LIMITS.url); try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.toString().replace(/\/$/, '') : null; } catch { return null; } };

/** Parsed apps: valid ids (lower-case `[a-z0-9-]`), https urls, no repeats, at most 12; bad entries dropped. */
export function parseApps(raw: unknown): XLayoutApp[] {
  if (!Array.isArray(raw)) return [];
  const out: XLayoutApp[] = []; const seen = new Set<string>();
  for (const v of raw) {
    if (out.length >= XLAYOUT_LIMITS.apps || !isObj(v)) continue;
    const id = str(v.id, XLAYOUT_LIMITS.id).toLowerCase();
    const url = httpsUrl(v.url);
    if (!APP_ID.test(id) || seen.has(id) || !url) continue;
    seen.add(id);
    const app: XLayoutApp = { id, label: str(v.label, XLAYOUT_LIMITS.label) || id, url };
    const icon = str(v.icon, 40); if (icon && ICON_ID.test(icon)) app.icon = icon;
    out.push(app);
  }
  return out;
}

/** The merge mode of every chrome kind, defaults filled, unknown kinds and values ignored. */
export function parseMerge(raw: unknown): Record<ChromeKind, MergeMode> {
  const out = { ...DEFAULT_MERGE } as Record<ChromeKind, MergeMode>;
  if (!isObj(raw)) return out;
  for (const k of CHROME_KINDS) { const v = raw[k]; if (typeof v === 'string' && (MERGE_MODES as readonly string[]).includes(v)) out[k] = v as MergeMode; }
  return out;
}

/** The IDE block with defaults: off, pane limit from the dock rules, preset `ide`, the ten starters offered. */
export function parseIde(raw: unknown): XLayoutIde {
  const o = isObj(raw) ? raw : {};
  const limit = normalizeDockRules({ paneLimit: typeof o.paneLimit === 'number' ? o.paneLimit : undefined }).paneLimit;
  const presets: string[] = [];
  for (const p of Array.isArray(o.presets) ? o.presets : DEFAULT_PRESETS) { const s = str(p, XLAYOUT_LIMITS.id); if (ASSET_ID.test(s) && !presets.includes(s) && presets.length < XLAYOUT_LIMITS.presets) presets.push(s); }
  const preset0 = str(o.preset, XLAYOUT_LIMITS.id);
  const preset = ASSET_ID.test(preset0) ? preset0 : (presets.includes('ide') ? 'ide' : presets[0] ?? 'single');
  const out: XLayoutIde = { on: o.on === true, paneLimit: limit, preset, presets: presets.length ? presets : [...DEFAULT_PRESETS] };
  const tree = parsePresetTree(o.tree);
  if (tree) { const leaves = countLeaves(tree); if (leaves >= 1 && leaves <= DOCK_LAYOUT_MAX_PANES) out.tree = tree; }
  return out;
}
const countLeaves = (p: PresetPane): number => (p.kind === 'leaf' ? 1 : p.children.reduce((a, c) => a + countLeaves(c), 0));

/** One toolbar item, checked; null when it has no usable id, label or action. `open` falls back to `main`. */
export function parseToolbarItem(raw: unknown, apps: readonly string[]): XToolbarItem | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 160), label = str(raw.label, XLAYOUT_LIMITS.label), action = str(raw.action, 200);
  if (!ITEM_ID.test(id) || !label || !ITEM_ID.test(action)) return null;
  const out: XToolbarItem = { id, label, action, open: (OPEN_TARGETS as readonly string[]).includes(raw.open as string) ? (raw.open as OpenTarget) : 'main' };
  const icon = str(raw.icon, 40); if (icon && ICON_ID.test(icon)) out.icon = icon;
  const app = str(raw.app, XLAYOUT_LIMITS.id).toLowerCase();
  if (app) { if (!apps.includes(app)) return null; out.app = app; out.action = nsId(app, stripNs(action, app)); }
  return out;
}

/** Exactly three slots (1..3), each with defaults: slot 1 top and visible, 2 and 3 hidden at the bottom / right; bad items dropped, ≤ 40 each. */
export function parseToolbars(raw: unknown, apps: readonly string[]): XToolbarSlot[] {
  const defaults: XToolbarSlot[] = [
    { slot: 1, visible: true, location: 'top', label: 'Toolbar 1', items: [] },
    { slot: 2, visible: false, location: 'bottom', label: 'Toolbar 2', items: [] },
    { slot: 3, visible: false, location: 'right', label: 'Toolbar 3', items: [] },
  ];
  if (!Array.isArray(raw)) return defaults;
  for (const v of raw) {
    if (!isObj(v)) continue;
    const n = typeof v.slot === 'number' && Number.isInteger(v.slot) ? v.slot : NaN;
    const d = defaults[n - 1]; if (!d) continue;
    if (typeof v.visible === 'boolean') d.visible = v.visible;
    if (typeof v.location === 'string' && (TOOLBAR_LOCATIONS as readonly string[]).includes(v.location)) d.location = v.location as ToolbarLocation;
    const label = str(v.label, XLAYOUT_LIMITS.label); if (label) d.label = label;
    if (Array.isArray(v.items)) {
      const seen = new Set<string>();
      d.items = v.items.map((i) => parseToolbarItem(i, apps)).filter((i): i is XToolbarItem => !!i && !seen.has(i.id) && (seen.add(i.id), true)).slice(0, XLAYOUT_LIMITS.items);
    }
  }
  return defaults;
}

/** An xlayout asset's data with every field present and checked (nothing valid = no apps, defaults everywhere). */
export function normalizeXLayout(raw: unknown): XLayoutData {
  const o = isObj(raw) ? raw : {};
  const apps = parseApps(o.apps);
  return { apps, merge: parseMerge(o.merge), ide: parseIde(o.ide), toolbars: parseToolbars(o.toolbars, apps.map((a) => a.id)) };
}

/** What's wrong with an xlayout asset's data (empty = fine). The validator and the build engine share this list. */
export function xlayoutErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['data must be an object'];
  const errors: string[] = [];
  if (!Array.isArray(raw.apps)) errors.push('data.apps must be a list of { id, label, url }');
  else {
    const ids = new Set<string>();
    raw.apps.forEach((a, i) => {
      if (!isObj(a)) { errors.push(`data.apps[${i}] must be an object`); return; }
      const id = str(a.id, XLAYOUT_LIMITS.id).toLowerCase();
      if (!APP_ID.test(id)) errors.push(`data.apps[${i}].id must match ${APP_ID.source}`);
      else if (ids.has(id)) errors.push(`data.apps[${i}].id "${id}" repeats`); else ids.add(id);
      if (!str(a.label, XLAYOUT_LIMITS.label)) errors.push(`data.apps[${i}].label is required`);
      if (!httpsUrl(a.url)) errors.push(`data.apps[${i}].url must be an https address`);
    });
    if (raw.apps.length > XLAYOUT_LIMITS.apps) errors.push(`data.apps has ${raw.apps.length} apps; at most ${XLAYOUT_LIMITS.apps}`);
  }
  if (raw.merge !== undefined) {
    if (!isObj(raw.merge)) errors.push('data.merge must be an object of chrome kind → host | merged | guest');
    else for (const [k, v] of Object.entries(raw.merge)) {
      if (!(CHROME_KINDS as readonly string[]).includes(k)) errors.push(`data.merge.${k} is not a chrome kind (${CHROME_KINDS.join(', ')})`);
      else if (!(MERGE_MODES as readonly string[]).includes(v as string)) errors.push(`data.merge.${k} must be one of: ${MERGE_MODES.join(', ')}`);
    }
  }
  if (raw.ide !== undefined) {
    if (!isObj(raw.ide)) errors.push('data.ide must be an object');
    else {
      const ide = raw.ide;
      if (ide.on !== undefined && typeof ide.on !== 'boolean') errors.push('data.ide.on must be true or false');
      if (ide.paneLimit !== undefined && (!Number.isInteger(ide.paneLimit) || (ide.paneLimit as number) < 1 || (ide.paneLimit as number) > 64)) errors.push('data.ide.paneLimit must be a whole number 1..64');
      if (ide.preset !== undefined && !ASSET_ID.test(str(ide.preset, XLAYOUT_LIMITS.id))) errors.push('data.ide.preset must be a dock-layout asset id');
      if (ide.presets !== undefined) {
        if (!Array.isArray(ide.presets)) errors.push('data.ide.presets must be a list of dock-layout asset ids');
        else { ide.presets.forEach((p, i) => { if (!ASSET_ID.test(str(p, XLAYOUT_LIMITS.id))) errors.push(`data.ide.presets[${i}] must be a dock-layout asset id`); }); if (ide.presets.length > XLAYOUT_LIMITS.presets) errors.push(`data.ide.presets has ${ide.presets.length}; at most ${XLAYOUT_LIMITS.presets}`); }
      }
      if (ide.tree !== undefined && !parsePresetTree(ide.tree)) errors.push('data.ide.tree must be a preset tree (leaf { pane } or split { vertical, children, weights })');
    }
  }
  if (raw.toolbars !== undefined) {
    if (!Array.isArray(raw.toolbars)) errors.push('data.toolbars must be a list of slots { slot 1..3, visible, location, items }');
    else {
      const appIds = parseApps(raw.apps).map((a) => a.id);
      const slots = new Set<number>();
      raw.toolbars.forEach((t, i) => {
        if (!isObj(t)) { errors.push(`data.toolbars[${i}] must be an object`); return; }
        if (!Number.isInteger(t.slot) || (t.slot as number) < 1 || (t.slot as number) > TOOLBAR_SLOT_COUNT) errors.push(`data.toolbars[${i}].slot must be 1..${TOOLBAR_SLOT_COUNT}`);
        else if (slots.has(t.slot as number)) errors.push(`data.toolbars[${i}].slot ${t.slot} repeats`); else slots.add(t.slot as number);
        if (t.visible !== undefined && typeof t.visible !== 'boolean') errors.push(`data.toolbars[${i}].visible must be true or false`);
        if (t.location !== undefined && !(TOOLBAR_LOCATIONS as readonly string[]).includes(t.location as string)) errors.push(`data.toolbars[${i}].location must be one of: ${TOOLBAR_LOCATIONS.join(', ')}`);
        if (t.items !== undefined) {
          if (!Array.isArray(t.items)) errors.push(`data.toolbars[${i}].items must be a list`);
          else t.items.forEach((it, j) => {
            if (!isObj(it)) { errors.push(`data.toolbars[${i}].items[${j}] must be an object`); return; }
            if (!ITEM_ID.test(str(it.id, 160))) errors.push(`data.toolbars[${i}].items[${j}].id is required`);
            if (!str(it.label, XLAYOUT_LIMITS.label)) errors.push(`data.toolbars[${i}].items[${j}].label is required`);
            if (!ITEM_ID.test(str(it.action, 200))) errors.push(`data.toolbars[${i}].items[${j}].action is required`);
            if (it.open !== undefined && !(OPEN_TARGETS as readonly string[]).includes(it.open as string)) errors.push(`data.toolbars[${i}].items[${j}].open must be one of: ${OPEN_TARGETS.join(', ')}`);
            if (it.app !== undefined && !appIds.includes(str(it.app, XLAYOUT_LIMITS.id).toLowerCase())) errors.push(`data.toolbars[${i}].items[${j}].app "${String(it.app)}" is not one of data.apps`);
          });
        }
      });
    }
  }
  return errors;
}

/* ---------- namespacing: an app's ids inside the host ---------- */

/** `<app>:<id>` — the host's name for an app's item. */
export const nsId = (app: string, id: string) => `${app}${NS_SEP}${id}`;
/** The app and the app's own id behind a host id, or null when it isn't namespaced to a known app. */
export function splitNs(nsid: string, apps: readonly string[]): { app: string; id: string } | null {
  const at = nsid.indexOf(NS_SEP);
  if (at <= 0) return null;
  const app = nsid.slice(0, at), id = nsid.slice(at + 1);
  return apps.includes(app) && id ? { app, id } : null;
}
/** The app's own id, whether or not it was already namespaced to `app`. */
export const stripNs = (id: string, app: string) => (id.startsWith(`${app}${NS_SEP}`) ? id.slice(app.length + 1) : id);

/* ---------- what the host does with the chrome ---------- */

/** Where an item opens right now: `pane` only while the IDE switch is on, else it floats. */
export function openTargetFor(item: Pick<XToolbarItem, 'open'>, ideOn: boolean): OpenTarget {
  return item.open === 'pane' && !ideOn ? 'floating' : item.open;
}

/** The chrome kinds the guests hide (the host shows them, merged or its own), as embed@1 hideable types (`widgets` rides on the banner). */
export function guestHidden(data: Pick<XLayoutData, 'merge'>): string[] {
  const kinds = CHROME_KINDS.filter((k) => data.merge[k] !== 'guest');
  return kinds.filter((k) => k !== 'widgets');
}

/** The embed@1 functions the host takes over from its guests: the merged kinds (the guests send them as data, the host runs picks back). */
export function guestTakes(data: Pick<XLayoutData, 'merge'>): string[] {
  const known = new Set(embedTakeIds());
  return CHROME_KINDS.filter((k) => data.merge[k] === 'merged' && known.has(k));
}

/** A guest's frame address: its own URL with the full embed@1 marker (host `molly`, hidden chrome, functions taken). */
export function guestUrl(data: Pick<XLayoutData, 'merge'>, app: XLayoutApp, host = 'molly', route = ''): string {
  const url = route ? `${app.url}/#/${route.replace(/^#?\/?/, '')}` : app.url;
  return embedUrlFull(url, host, { hidden: guestHidden(data), takes: guestTakes(data) });
}

/** The user-agent suffix a native host's web views would carry for the same marker (Android: the Molly shell, later). */
export function guestUserAgent(data: Pick<XLayoutData, 'merge'>, host = 'molly'): string {
  return userAgentSuffixFull(host, guestHidden(data), guestTakes(data));
}

/** The toolbar slots to draw: visible ones, in slot order; `location` filters to one edge. */
export function visibleToolbars(data: Pick<XLayoutData, 'toolbars'>, location?: ToolbarLocation): XToolbarSlot[] {
  return data.toolbars.filter((t) => t.visible && (!location || t.location === location)).sort((a, b) => a.slot - b.slot);
}

/** The dock-layout presets the layout picker offers: the asset's list, kept to the ones that exist (`available`), in the asset's order. */
export function idePresets(data: Pick<XLayoutData, 'ide'>, available: readonly string[]): string[] {
  const have = new Set(available);
  return data.ide.presets.filter((p) => have.has(p));
}

/** The dock rules an xlayout puts in force (the pane limit; the rest are the dock engine's defaults). */
export function dockRulesOf(data: Pick<XLayoutData, 'ide'>) { return normalizeDockRules({ paneLimit: data.ide.paneLimit }); }
