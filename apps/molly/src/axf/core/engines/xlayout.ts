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
 * Layout modes (build molly-one-shell s5, Nov 8 2026; Brett: "User picks a layout mode. IDE-style is ONE option among
 * others. In the IDE layout, containers dock/split/float/resize, and each container can optionally be a tab group …
 * Save/switch named layouts."): `mode` is single | tabs | split | ide (absent = ide when `ide.on`, else single);
 * `ide.containers` says which panes are tab groups; `layouts` are the user's named layouts (mode, preset or tree,
 * containers, what is open in each container) and `active` the one in force. Opening something in a container, moving a
 * tab between containers and closing one are the pure `openInContainer` / `moveTab` / `closeTab`; the panes themselves
 * stay dock@1's (split, resize, float, dock back). The guest / embed parts below (merge `guest`, guestUrl,
 * guestUserAgent) go with Molly's frames in molly-one-shell s11: Molly mounts apps natively (shell-surface@1).
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
export const XLAYOUT_LIMITS = { apps: 12, items: 40, presets: 10, label: 80, url: 300, id: 48, layouts: 20, containers: 12, tabs: 40, ref: 260 } as const;
/** How the shell lays out what is open: one thing at a time, one tab group, two side by side, or the IDE (docked panes). */
export const LAYOUT_MODES = ['single', 'tabs', 'split', 'ide'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];
/** The dock-layout preset each mode starts from when a layout names none. */
export const LAYOUT_MODE_PRESET: Readonly<Record<LayoutMode, string>> = { single: 'single', tabs: 'single', split: 'two-columns', ide: 'ide' };

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
  /** which panes are tab groups (1-based pane numbers of the preset / tree); unlisted panes show one thing */
  containers: XContainer[];
}
/** One container (a pane of the preset): a tab group or not, and an optional name. */
export interface XContainer { pane: number; tabs: boolean; label?: string }
/** What is open in one container: shell refs (`<app>:<kind>:<id>`, shell-surface@1) in tab order, and the one in front. */
export interface XContainerOpen { tabs: string[]; active: number }
/** Containers' contents, by pane number (as a string key). */
export type XOpenMap = Record<string, XContainerOpen>;
/** A named layout the user saved: mode, preset or own tree, containers, what is open where. */
export interface XNamedLayout { id: string; label: string; mode: LayoutMode; preset: string; tree?: PresetPane; containers: XContainer[]; open: XOpenMap }
export interface XLayoutData {
  apps: XLayoutApp[];
  merge: Record<ChromeKind, MergeMode>;
  ide: XLayoutIde;
  toolbars: XToolbarSlot[];
  /** the layout mode in force when no named layout is active */
  mode: LayoutMode;
  /** the user's named layouts (≤ 20) */
  layouts: XNamedLayout[];
  /** the named layout in force (null = the asset's own mode + IDE block) */
  active: string | null;
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
  const out: XLayoutIde = { on: o.on === true, paneLimit: limit, preset, presets: presets.length ? presets : [...DEFAULT_PRESETS], containers: [] };
  const tree = parsePresetTree(o.tree);
  if (tree) { const leaves = countLeaves(tree); if (leaves >= 1 && leaves <= DOCK_LAYOUT_MAX_PANES) out.tree = tree; }
  out.containers = parseContainers(o.containers);
  return out;
}

/** Containers: pane 1..12 each once, `tabs` true / false (default false), optional label; sorted by pane. */
export function parseContainers(raw: unknown): XContainer[] {
  if (!Array.isArray(raw)) return [];
  const out: XContainer[] = []; const seen = new Set<number>();
  for (const v of raw) {
    if (!isObj(v) || out.length >= XLAYOUT_LIMITS.containers) continue;
    const pane = typeof v.pane === 'number' && Number.isInteger(v.pane) ? v.pane : NaN;
    if (!(pane >= 1 && pane <= DOCK_LAYOUT_MAX_PANES) || seen.has(pane)) continue;
    seen.add(pane);
    const c: XContainer = { pane, tabs: v.tabs === true };
    const label = str(v.label, XLAYOUT_LIMITS.label); if (label) c.label = label;
    out.push(c);
  }
  return out.sort((a, b) => a.pane - b.pane);
}

const REF = /^[a-z0-9][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}:[^\s\u0000-\u001f\u007f][^\u0000-\u001f\u007f]{0,199}$/;
/** What is open where: pane keys 1..12, refs `<app>:<kind>:<id>` (bad and repeated ones dropped, ≤ 40), `active` clamped. */
export function parseOpenMap(raw: unknown): XOpenMap {
  const out: XOpenMap = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const pane = Number(k);
    if (!Number.isInteger(pane) || pane < 1 || pane > DOCK_LAYOUT_MAX_PANES || !isObj(v) || !Array.isArray(v.tabs)) continue;
    const tabs = [...new Set(v.tabs.map((t) => str(t, XLAYOUT_LIMITS.ref)).filter((t) => REF.test(t)))].slice(0, XLAYOUT_LIMITS.tabs);
    if (!tabs.length) continue;
    const a = typeof v.active === 'number' && Number.isInteger(v.active) ? v.active : 0;
    out[String(pane)] = { tabs, active: Math.max(0, Math.min(tabs.length - 1, a)) };
  }
  return out;
}

const parseMode = (v: unknown): LayoutMode | null => ((LAYOUT_MODES as readonly unknown[]).includes(v) ? (v as LayoutMode) : null);

/** One named layout, checked; null without a usable id. Mode defaults to `ide`, preset to the mode's starter. */
export function parseNamedLayout(raw: unknown): XNamedLayout | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, XLAYOUT_LIMITS.id).toLowerCase();
  if (!ASSET_ID.test(id)) return null;
  const mode = parseMode(raw.mode) ?? 'ide';
  const preset0 = str(raw.preset, XLAYOUT_LIMITS.id);
  const out: XNamedLayout = { id, label: str(raw.label, XLAYOUT_LIMITS.label) || id, mode, preset: ASSET_ID.test(preset0) ? preset0 : LAYOUT_MODE_PRESET[mode], containers: parseContainers(raw.containers), open: parseOpenMap(raw.open) };
  const tree = parsePresetTree(raw.tree);
  if (tree) { const leaves = countLeaves(tree); if (leaves >= 1 && leaves <= DOCK_LAYOUT_MAX_PANES) out.tree = tree; }
  return out;
}

/** Named layouts: bad ones and repeated ids dropped, at most 20. */
export function parseLayouts(raw: unknown): XNamedLayout[] {
  if (!Array.isArray(raw)) return [];
  const out: XNamedLayout[] = []; const seen = new Set<string>();
  for (const v of raw) { if (out.length >= XLAYOUT_LIMITS.layouts) break; const l = parseNamedLayout(v); if (l && !seen.has(l.id)) { seen.add(l.id); out.push(l); } }
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
  const ide = parseIde(o.ide);
  const mode = parseMode(o.mode) ?? (ide.on ? 'ide' : 'single');
  ide.on = mode === 'ide';
  const layouts = parseLayouts(o.layouts);
  const act = str(o.active, XLAYOUT_LIMITS.id).toLowerCase();
  return { apps, merge: parseMerge(o.merge), ide, toolbars: parseToolbars(o.toolbars, apps.map((a) => a.id)), mode, layouts, active: layouts.some((l) => l.id === act) ? act : null };
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
      if (ide.containers !== undefined) errors.push(...containerErrors(ide.containers, 'data.ide.containers'));
    }
  }
  if (raw.mode !== undefined && !parseMode(raw.mode)) errors.push(`data.mode must be one of: ${LAYOUT_MODES.join(', ')}`);
  if (raw.layouts !== undefined) {
    if (!Array.isArray(raw.layouts)) errors.push('data.layouts must be a list of { id, label, mode, preset?, tree?, containers?, open? }');
    else {
      if (raw.layouts.length > XLAYOUT_LIMITS.layouts) errors.push(`data.layouts has ${raw.layouts.length}; at most ${XLAYOUT_LIMITS.layouts}`);
      const ids = new Set<string>();
      raw.layouts.forEach((l, i) => {
        if (!isObj(l)) { errors.push(`data.layouts[${i}] must be an object`); return; }
        const id = str(l.id, XLAYOUT_LIMITS.id).toLowerCase();
        if (!ASSET_ID.test(id)) errors.push(`data.layouts[${i}].id must match ${ASSET_ID.source}`);
        else if (ids.has(id)) errors.push(`data.layouts[${i}].id "${id}" repeats`); else ids.add(id);
        if (l.mode !== undefined && !parseMode(l.mode)) errors.push(`data.layouts[${i}].mode must be one of: ${LAYOUT_MODES.join(', ')}`);
        if (l.preset !== undefined && !ASSET_ID.test(str(l.preset, XLAYOUT_LIMITS.id))) errors.push(`data.layouts[${i}].preset must be a dock-layout asset id`);
        if (l.tree !== undefined && !parsePresetTree(l.tree)) errors.push(`data.layouts[${i}].tree must be a preset tree`);
        if (l.containers !== undefined) errors.push(...containerErrors(l.containers, `data.layouts[${i}].containers`));
        if (l.open !== undefined && !isObj(l.open)) errors.push(`data.layouts[${i}].open must be an object of pane → { tabs, active }`);
      });
    }
  }
  if (raw.active !== undefined && raw.active !== null) {
    const act = str(raw.active, XLAYOUT_LIMITS.id).toLowerCase();
    if (!parseLayouts(raw.layouts).some((l) => l.id === act)) errors.push(`data.active "${String(raw.active)}" is not one of data.layouts`);
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

function containerErrors(raw: unknown, path: string): string[] {
  if (!Array.isArray(raw)) return [`${path} must be a list of { pane, tabs, label? }`];
  const e: string[] = []; const seen = new Set<number>();
  raw.forEach((c, i) => {
    if (!isObj(c)) { e.push(`${path}[${i}] must be an object`); return; }
    if (!Number.isInteger(c.pane) || (c.pane as number) < 1 || (c.pane as number) > DOCK_LAYOUT_MAX_PANES) e.push(`${path}[${i}].pane must be 1..${DOCK_LAYOUT_MAX_PANES}`);
    else if (seen.has(c.pane as number)) e.push(`${path}[${i}].pane ${c.pane} repeats`); else seen.add(c.pane as number);
    if (c.tabs !== undefined && typeof c.tabs !== 'boolean') e.push(`${path}[${i}].tabs must be true or false`);
  });
  if (raw.length > XLAYOUT_LIMITS.containers) e.push(`${path} has ${raw.length}; at most ${XLAYOUT_LIMITS.containers}`);
  return e;
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

/* ---------- layout modes, containers, named layouts (molly-one-shell s5) ---------- */

/** What is in force: the active named layout, else the asset's own mode with its IDE block. */
export interface XEffectiveLayout { id: string | null; label: string; mode: LayoutMode; preset: string; tree?: PresetPane; containers: XContainer[]; open: XOpenMap }
export function effectiveLayout(data: Pick<XLayoutData, 'mode' | 'ide' | 'layouts' | 'active'>): XEffectiveLayout {
  const named = data.active ? data.layouts.find((l) => l.id === data.active) : undefined;
  if (named) { const out: XEffectiveLayout = { id: named.id, label: named.label, mode: named.mode, preset: named.preset, containers: named.containers, open: named.open }; if (named.tree) out.tree = named.tree; return out; }
  const preset = data.mode === 'ide' ? data.ide.preset : LAYOUT_MODE_PRESET[data.mode];
  const out: XEffectiveLayout = { id: null, label: 'Default', mode: data.mode, preset, containers: data.ide.containers, open: {} };
  if (data.mode === 'ide' && data.ide.tree) out.tree = data.ide.tree;
  return out;
}

/** Whether a pane is a tab group: `tabs` mode = pane 1 always; `single` = never; `split` / `ide` = as its container says. */
export function containerIsTabs(layout: Pick<XEffectiveLayout, 'mode' | 'containers'>, pane: number): boolean {
  if (layout.mode === 'single') return false;
  if (layout.mode === 'tabs') return pane === 1;
  return layout.containers.some((c) => c.pane === pane && c.tabs);
}

/** The containers with `pane` switched to a tab group or back (the user's per-container switch). */
export function setContainerTabs(containers: readonly XContainer[], pane: number, tabs: boolean): XContainer[] {
  if (!(Number.isInteger(pane) && pane >= 1 && pane <= DOCK_LAYOUT_MAX_PANES)) return [...containers];
  const has = containers.some((c) => c.pane === pane);
  const out = has ? containers.map((c) => (c.pane === pane ? { ...c, tabs } : c)) : [...containers, { pane, tabs }];
  return out.sort((a, b) => a.pane - b.pane);
}

const okRef = (ref: string) => typeof ref === 'string' && REF.test(ref);

/**
 * Open `ref` in container `pane` (a drop from a menu, a pick, a voice command). A tab group gains it as a new tab right
 * after the one in front (or brings it to the front when it is already there); any other container shows only it.
 * At most 40 tabs: the oldest tab that isn't in front goes.
 */
export function openInContainer(open: XOpenMap, pane: number, ref: string, tabs: boolean): XOpenMap {
  if (!okRef(ref) || !(Number.isInteger(pane) && pane >= 1 && pane <= DOCK_LAYOUT_MAX_PANES)) return { ...open };
  const key = String(pane);
  const cur = open[key];
  if (!tabs || !cur) return { ...open, [key]: { tabs: [ref], active: 0 } };
  const at = cur.tabs.indexOf(ref);
  if (at >= 0) return { ...open, [key]: { tabs: [...cur.tabs], active: at } };
  const list = [...cur.tabs]; list.splice(cur.active + 1, 0, ref);
  let active = cur.active + 1;
  while (list.length > XLAYOUT_LIMITS.tabs) { const drop = active === 0 ? 1 : 0; list.splice(drop, 1); if (drop < active) active--; }
  return { ...open, [key]: { tabs: list, active } };
}

/** Close `ref` in `pane`; the tab to its left comes to the front (or the next one); an empty container is dropped. */
export function closeTab(open: XOpenMap, pane: number, ref: string): XOpenMap {
  const key = String(pane), cur = open[key];
  if (!cur) return { ...open };
  const at = cur.tabs.indexOf(ref);
  if (at < 0) return { ...open };
  const tabs = cur.tabs.filter((t) => t !== ref);
  const out = { ...open };
  if (!tabs.length) { delete out[key]; return out; }
  const active = at < cur.active ? cur.active - 1 : at === cur.active ? Math.max(0, at - 1) : cur.active;
  out[key] = { tabs, active: Math.min(active, tabs.length - 1) };
  return out;
}

/**
 * Move a tab from one container to another (a tab dragged between containers), at `index` in the target (default:
 * after its front tab). Into a container that isn't a tab group it replaces what is there. Same container = reorder.
 */
export function moveTab(open: XOpenMap, from: number, to: number, ref: string, toTabs: boolean, index?: number): XOpenMap {
  const src = open[String(from)];
  if (!src || !src.tabs.includes(ref) || !(Number.isInteger(to) && to >= 1 && to <= DOCK_LAYOUT_MAX_PANES)) return { ...open };
  if (from === to) {
    const tabs = src.tabs.filter((t) => t !== ref);
    const at = Math.max(0, Math.min(tabs.length, typeof index === 'number' && Number.isInteger(index) ? index : tabs.length));
    tabs.splice(at, 0, ref);
    return { ...open, [String(from)]: { tabs, active: at } };
  }
  const without = closeTab(open, from, ref);
  if (!toTabs) return { ...without, [String(to)]: { tabs: [ref], active: 0 } };
  const dst = without[String(to)];
  if (!dst) return { ...without, [String(to)]: { tabs: [ref], active: 0 } };
  const tabs = dst.tabs.filter((t) => t !== ref);
  const at = Math.max(0, Math.min(tabs.length, typeof index === 'number' && Number.isInteger(index) ? index : dst.active + 1));
  tabs.splice(at, 0, ref);
  return { ...without, [String(to)]: { tabs: tabs.slice(0, XLAYOUT_LIMITS.tabs), active: Math.min(at, XLAYOUT_LIMITS.tabs - 1) } };
}

/** Save (add or replace by id) a named layout; it becomes the active one. Over 20, the oldest other layout goes. */
export function saveLayout(data: XLayoutData, layout: unknown): XLayoutData {
  const l = parseNamedLayout(layout);
  if (!l) return data;
  const rest = data.layouts.filter((x) => x.id !== l.id);
  const at = data.layouts.findIndex((x) => x.id === l.id);
  const layouts = at >= 0 ? data.layouts.map((x) => (x.id === l.id ? l : x)) : [...rest, l];
  while (layouts.length > XLAYOUT_LIMITS.layouts) layouts.splice(layouts.findIndex((x) => x.id !== l.id), 1);
  return { ...data, layouts, active: l.id };
}

/** Switch to a named layout (null = the asset's own); an unknown id changes nothing. */
export function switchLayout(data: XLayoutData, id: string | null): XLayoutData {
  if (id === null) return { ...data, active: null };
  return data.layouts.some((l) => l.id === id) ? { ...data, active: id } : data;
}

/** Remove a named layout; when it was active, the asset's own layout is in force again. */
export function removeLayout(data: XLayoutData, id: string): XLayoutData {
  if (!data.layouts.some((l) => l.id === id)) return data;
  return { ...data, layouts: data.layouts.filter((l) => l.id !== id), active: data.active === id ? null : data.active };
}

/** Set the mode in force (no named layout active afterwards: picking a mode is a fresh start). */
export function setLayoutMode(data: XLayoutData, mode: LayoutMode): XLayoutData {
  if (!parseMode(mode)) return data;
  return { ...data, mode, ide: { ...data.ide, on: mode === 'ide' }, active: null };
}

/** The current state as a named layout to save (`id`, `label`, with what is open where). */
export function snapshotLayout(data: XLayoutData, id: string, label: string, open: XOpenMap): XNamedLayout | null {
  const eff = effectiveLayout(data);
  return parseNamedLayout({ id, label, mode: eff.mode, preset: eff.preset, tree: eff.tree, containers: eff.containers, open });
}
