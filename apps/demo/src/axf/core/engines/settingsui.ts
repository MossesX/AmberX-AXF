/*
 * Settings interface engine (settings asset, settings-ui@1). Pure: no DOM, no runtime.
 *
 * The `settings` asset is the settings interface as data, so several apps load the same interface with the same
 * options: how the page is laid out (tabs on top / at the side / a list), its header, search and descriptions,
 * which tabs show in which order with which labels, what is left out (tabs, groups, panels, setting keys), and
 * extra groups of data-only options the asset brings with it (registered by the settings library while the asset
 * is active, module `asset:settings/<id>`). Anything it doesn't know is dropped, never a crash: an app with no
 * settings asset gets SETTINGS_UI_DEFAULTS, which is the page as it was before the type existed.
 *
 * Levels (Brett, Oct 28 2026): Simple / Basic / Developer / Administrator. Every tab, group, panel and setting has a
 * level and shows from it up; Administrator shows everything, always. The older names still load: Pro is read as
 * Administrator and Advanced as Developer (SETTINGS_LEVEL_MIGRATION), in assets, in group levels and in saved picks.
 * On top of the rank rule each level has a visible set (`visible`): ids added to that level (`show`) or taken out of
 * it (`hide`), per interface in the asset, and per user in the saved setting SETTINGS_VISIBLE_KEY (the level editor
 * writes it), merged with `withSettingsVisible`. Additive field: assets without it are unchanged.
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md); spec/fixtures/settings-ui.json is what it will replay.
 */
import type { SettingKind, SettingSpec, SettingsGroup, SettingsTab, SettingValue } from '../settings';

/* ---------------- levels ---------------- */

export type SettingsLevel = 'simple' | 'basic' | 'developer' | 'administrator';
/** In rank order: an item at a level shows at that level and every level after it. */
export const SETTINGS_LEVELS: readonly SettingsLevel[] = ['simple', 'basic', 'developer', 'administrator'];
export const SETTINGS_LEVEL_LABEL: Record<SettingsLevel, string> = { simple: 'Simple', basic: 'Basic', developer: 'Developer', administrator: 'Administrator' };
export const SETTINGS_LEVEL_HINT: Record<SettingsLevel, string> = {
  simple: 'A few big choices.',
  basic: 'The everyday settings.',
  developer: 'Developer settings: engines, assets, plumbing.',
  administrator: 'Every setting there is.',
};
/** Older level names (Oct 26 2026) → today's (Brett's pick, Oct 28 2026). */
export const SETTINGS_LEVEL_MIGRATION: Readonly<Record<string, SettingsLevel>> = { pro: 'administrator', advanced: 'developer' };
/** The level in a value: a current name, an older one migrated, else nothing. Case-insensitive, trimmed. */
export function settingsLevelOf(v: unknown): SettingsLevel | undefined {
  if (typeof v !== 'string') return undefined;
  const k = v.trim().toLowerCase();
  return SETTINGS_LEVELS.includes(k as SettingsLevel) ? (k as SettingsLevel) : SETTINGS_LEVEL_MIGRATION[k];
}
export const settingsLevelRank = (l: SettingsLevel): number => SETTINGS_LEVELS.indexOf(l);
/** The one level that always shows everything (no visible set of its own). */
export const SETTINGS_LEVEL_ALL: SettingsLevel = 'administrator';

/** One level's visible set: ids (tab, group, panel or setting key) shown there whatever their level, and ids taken out. */
export interface SettingsVisibleSet { show: string[]; hide: string[] }
/** Visible sets by level (never Administrator). */
export type SettingsVisible = Partial<Record<SettingsLevel, SettingsVisibleSet>>;

export type SettingsLayout = 'tabs-top' | 'tabs-side' | 'list';
export type SettingsHeader = 'full' | 'compact' | 'none';

export interface SettingsUiTab { id: string; label?: string; icon?: string; order?: number; description?: string; parent?: string; hidden?: boolean }
export interface SettingsUiGroup { id: string; label: string; icon?: string; tab: string; order?: number; description?: string; settings: SettingSpec[]; level?: SettingsLevel; collapsible?: boolean; collapsed?: boolean }

export interface SettingsUi {
  layout: SettingsLayout;
  header: SettingsHeader;
  /** a filter field over every tab's settings */
  search: boolean;
  /** tab and setting descriptions shown */
  descriptions: boolean;
  /** tab overrides + new tabs, in this order (tabs not named keep their own order, after these) */
  tabs: SettingsUiTab[];
  /** ids left out: tab ids, group ids, panel ids or setting keys */
  hide: string[];
  /** data-only option groups the asset brings */
  groups: SettingsUiGroup[];
  /** id of a toolbar asset drawn at the top of the settings page (its items, and the search field when it has
   *  `showSearch`); left out = no toolbar */
  toolbar?: string;
  /** Simple / Basic / Developer / Administrator (Oct 26 2026, renamed Oct 28 2026): a level toolbar on the settings
   *  page; every tab, group, panel and setting shows from its level up, Administrator shows all. Off = everything shows. */
  levels: boolean;
  /** level of anything `levelOf` doesn't name */
  defaultLevel: SettingsLevel;
  /** tab, group, panel or setting id → its level (older names migrated) */
  levelOf: Record<string, SettingsLevel>;
  /** per-level visible sets on top of the rank rule (the interface's own; a user's saved sets merge over them) */
  visible: SettingsVisible;
}

export const SETTINGS_LAYOUTS: readonly SettingsLayout[] = ['tabs-top', 'tabs-side', 'list'];
export const SETTINGS_HEADERS: readonly SettingsHeader[] = ['full', 'compact', 'none'];
/** Kinds an asset may declare: data only (no secrets, no asset slots, no actions or custom renderers). */
export const ASSET_SETTING_KINDS: readonly SettingKind[] = ['toggle', 'text', 'number', 'slider', 'choice', 'multi_choice', 'color', 'link', 'section'];
export const SETTINGS_UI_LIMITS = { tabs: 40, hide: 200, groups: 40, settings: 60, options: 50, text: 200, id: 120 } as const;

export const SETTINGS_UI_DEFAULTS: SettingsUi = { layout: 'tabs-top', header: 'full', search: false, descriptions: true, tabs: [], hide: [], groups: [], levels: false, defaultLevel: 'basic', levelOf: {}, visible: {} };
/** The level the settings page shows (per browser, like every setting). Older saved names are migrated on read. */
export const SETTINGS_LEVEL_KEY = 'axf.settings.level';
/** The user's own visible sets (JSON of SettingsVisible), merged over the interface's; the level editor writes it. */
export const SETTINGS_VISIBLE_KEY = 'axf.settings.visible';
/** Whether the level toolbar is shown on the settings page (default on; hideable from the toolbar's menu). */
export const SETTINGS_LEVEL_BAR_KEY = 'axf.settings.levelbar';
const level = settingsLevelOf;

const ID = /^[a-z0-9][a-z0-9._:-]*$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown): string | null => (typeof v === 'string' && v.length <= SETTINGS_UI_LIMITS.id && ID.test(v) ? v : null);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, SETTINGS_UI_LIMITS.text) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

function tabOf(raw: unknown): SettingsUiTab | null {
  if (!isObj(raw)) return null;
  const tid = id(raw.id);
  if (!tid) return null;
  const t: SettingsUiTab = { id: tid };
  const label = text(raw.label); if (label) t.label = label;
  const icon = id(raw.icon); if (icon) t.icon = icon;
  const order = num(raw.order); if (order !== undefined) t.order = order;
  const description = text(raw.description); if (description) t.description = description;
  const parent = id(raw.parent); if (parent && parent !== tid) t.parent = parent;
  if (raw.hidden === true) t.hidden = true;
  return t;
}

function defaultOf(kind: SettingKind, v: unknown): SettingValue | undefined {
  if (kind === 'toggle') return typeof v === 'boolean' ? v : undefined;
  if (kind === 'number' || kind === 'slider') return num(v);
  if (kind === 'multi_choice') return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).slice(0, SETTINGS_UI_LIMITS.options) : undefined;
  if (kind === 'section' || kind === 'link') return undefined;
  return typeof v === 'string' ? v.slice(0, SETTINGS_UI_LIMITS.text) : undefined;
}

function settingOf(raw: unknown): SettingSpec | null {
  if (!isObj(raw)) return null;
  const key = id(raw.key);
  const label = text(raw.label);
  const kind = raw.kind as SettingKind;
  if (!key || !label || !ASSET_SETTING_KINDS.includes(kind)) return null;
  const s: SettingSpec = { key, label, kind };
  const description = text(raw.description); if (description) s.description = description;
  const icon = id(raw.icon); if (icon) s.icon = icon;
  if (kind === 'choice' || kind === 'multi_choice') {
    const opts = (Array.isArray(raw.options) ? raw.options : [])
      .filter(isObj).map((o) => ({ value: typeof o.value === 'string' ? o.value.slice(0, SETTINGS_UI_LIMITS.text) : '', label: text(o.label) ?? '' }))
      .filter((o) => o.value && o.label).slice(0, SETTINGS_UI_LIMITS.options);
    if (!opts.length) return null;
    s.options = opts;
  }
  if (kind === 'number' || kind === 'slider') {
    const min = num(raw.min), max = num(raw.max), step = num(raw.step);
    if (min !== undefined) s.min = min;
    if (max !== undefined && (min === undefined || max >= min)) s.max = max;
    if (step !== undefined && step > 0) s.step = step;
  }
  if (kind === 'link') { const target = text(raw.target); if (!target || !/^(https:\/\/|view:|settings:)/.test(target)) return null; s.target = target; }
  const d = defaultOf(kind, raw.default);
  if (d !== undefined) {
    if (kind === 'choice' && !s.options!.some((o) => o.value === d)) { /* a default that isn't an option is dropped */ }
    else if (kind === 'multi_choice') s.default = (d as string[]).filter((x) => s.options!.some((o) => o.value === x));
    else if ((kind === 'number' || kind === 'slider') && ((s.min !== undefined && (d as number) < s.min) || (s.max !== undefined && (d as number) > s.max))) { /* out of range: dropped */ }
    else s.default = d;
  }
  return s;
}

function groupOf(raw: unknown): SettingsUiGroup | null {
  if (!isObj(raw)) return null;
  const gid = id(raw.id), label = text(raw.label), tab = id(raw.tab);
  if (!gid || !label || !tab) return null;
  const seen = new Set<string>();
  const settings = (Array.isArray(raw.settings) ? raw.settings : []).map(settingOf)
    .filter((s): s is SettingSpec => !!s && !seen.has(s.key) && !!seen.add(s.key)).slice(0, SETTINGS_UI_LIMITS.settings);
  if (!settings.length) return null;
  const g: SettingsUiGroup = { id: gid, label, tab, settings };
  const icon = id(raw.icon); if (icon) g.icon = icon;
  const order = num(raw.order); if (order !== undefined) g.order = order;
  const description = text(raw.description); if (description) g.description = description;
  const lv = level(raw.level); if (lv) g.level = lv;
  if (raw.collapsible === true) g.collapsible = true;
  if (raw.collapsed === true) g.collapsed = true;
  return g;
}

const uniqueBy = <T>(list: T[], key: (x: T) => string): T[] => { const s = new Set<string>(); return list.filter((x) => !s.has(key(x)) && !!s.add(key(x))); };

/** Any settings asset data (or nothing) → a complete interface description. Unknown values fall back, bad entries drop. */
export function normalizeSettingsUi(raw: unknown): SettingsUi {
  const d = isObj(raw) ? raw : {};
  return {
    layout: pick(d.layout, SETTINGS_LAYOUTS, SETTINGS_UI_DEFAULTS.layout),
    header: pick(d.header, SETTINGS_HEADERS, SETTINGS_UI_DEFAULTS.header),
    search: bool(d.search, SETTINGS_UI_DEFAULTS.search),
    descriptions: bool(d.descriptions, SETTINGS_UI_DEFAULTS.descriptions),
    tabs: uniqueBy((Array.isArray(d.tabs) ? d.tabs : []).map(tabOf).filter((t): t is SettingsUiTab => !!t), (t) => t.id).slice(0, SETTINGS_UI_LIMITS.tabs),
    hide: uniqueBy((Array.isArray(d.hide) ? d.hide : []).map(id).filter((x): x is string => !!x), (x) => x).slice(0, SETTINGS_UI_LIMITS.hide),
    groups: uniqueBy((Array.isArray(d.groups) ? d.groups : []).map(groupOf).filter((g): g is SettingsUiGroup => !!g), (g) => g.id).slice(0, SETTINGS_UI_LIMITS.groups),
    ...(id(d.toolbar) ? { toolbar: id(d.toolbar)! } : {}),
    levels: bool(d.levels, SETTINGS_UI_DEFAULTS.levels),
    defaultLevel: level(d.defaultLevel) ?? SETTINGS_UI_DEFAULTS.defaultLevel,
    levelOf: Object.fromEntries(Object.entries(isObj(d.levelOf) ? d.levelOf : {}).filter(([k, v]) => id(k) && level(v)).slice(0, SETTINGS_UI_LIMITS.hide).map(([k, v]) => [k, level(v)!])) as Record<string, SettingsLevel>,
    visible: normalizeSettingsVisible(d.visible),
  };
}

/* ---------------- visible sets ---------------- */

const idList = (v: unknown): string[] => uniqueBy((Array.isArray(v) ? v : []).map(id).filter((x): x is string => !!x), (x) => x).slice(0, SETTINGS_UI_LIMITS.hide);

/**
 * Visible sets from an asset field or a saved setting: an object keyed by level (older names migrated, Administrator
 * dropped: it shows all), each `{ show, hide }` of ids (a bare list = show). A JSON string is parsed first (settings
 * hold strings). Anything else = no sets. Levels with nothing in them are left out.
 */
export function normalizeSettingsVisible(raw: unknown): SettingsVisible {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return {}; } }
  if (!isObj(v)) return {};
  const out: SettingsVisible = {};
  for (const [k, set] of Object.entries(v)) {
    const lv = level(k);
    if (!lv || lv === SETTINGS_LEVEL_ALL) continue;
    const show = Array.isArray(set) ? idList(set) : isObj(set) ? idList(set.show) : [];
    const hide = isObj(set) ? idList(set.hide).filter((x) => !show.includes(x)) : [];
    if (!show.length && !hide.length) continue;
    const prev = out[lv];
    out[lv] = prev ? { show: uniqueBy([...prev.show, ...show], (x) => x), hide: uniqueBy([...prev.hide, ...hide], (x) => x).filter((x) => !show.includes(x)) } : { show, hide };
  }
  return out;
}

/** `over` on top of `base`, per level: what `over` shows is shown, what it hides is hidden, the rest stays as `base` has it. */
export function mergeSettingsVisible(base: SettingsVisible, over: SettingsVisible): SettingsVisible {
  const out: SettingsVisible = {};
  for (const lv of SETTINGS_LEVELS) {
    const b = base[lv], o = over[lv];
    if (!b && !o) continue;
    const show = uniqueBy([...(b?.show ?? []).filter((x) => !o?.hide.includes(x)), ...(o?.show ?? [])], (x) => x);
    const hide = uniqueBy([...(b?.hide ?? []).filter((x) => !o?.show.includes(x)), ...(o?.hide ?? [])], (x) => x);
    if (show.length || hide.length) out[lv] = { show, hide };
  }
  return out;
}

/** The interface with the user's saved visible sets (SETTINGS_VISIBLE_KEY) merged over its own. */
export function withSettingsVisible(ui: SettingsUi, stored: unknown): SettingsUi {
  const over = normalizeSettingsVisible(stored);
  return Object.keys(over).length ? { ...ui, visible: mergeSettingsVisible(ui.visible, over) } : ui;
}

/**
 * The level editor's one move: make `ids` visible (or not) at `level`, written as the smallest change to the user's
 * saved sets (`stored`) given the interface they sit on (`base`, the asset's own sets + ranks): an id the rank rule
 * already shows is only ever listed under `hide`; one it doesn't, only under `show`. Returns the sets to save.
 */
export function setSettingsVisible(base: SettingsUi, stored: unknown, at: SettingsLevel, ids: readonly string[], visible: boolean, levelOfId: (id: string) => SettingsLevel = (i) => settingsItemLevel(base, i)): SettingsVisible {
  const saved = normalizeSettingsVisible(stored);
  if (at === SETTINGS_LEVEL_ALL) return saved;
  const cur = saved[at] ?? { show: [], hide: [] };
  let show = [...cur.show], hide = [...cur.hide];
  for (const i of ids) {
    if (!id(i)) continue;
    const byRank = settingsLevelRank(levelOfId(i)) <= settingsLevelRank(at);
    const own = base.visible[at];
    const byAsset = own?.hide.includes(i) ? false : own?.show.includes(i) ? true : byRank;
    show = show.filter((x) => x !== i); hide = hide.filter((x) => x !== i);
    if (visible && !byAsset) show.push(i);
    if (!visible && byAsset) hide.push(i);
  }
  const next = { ...saved };
  if (show.length || hide.length) next[at] = { show, hide }; else delete next[at];
  return next;
}

/** The level of a tab, group, panel or setting: what the asset names, a group's own `level` (older names migrated), else the default. */
export function settingsItemLevel(ui: SettingsUi, itemId: string, own?: string): SettingsLevel {
  return ui.levelOf[itemId] ?? level(own) ?? ui.defaultLevel;
}

/** The visible set's word on an item at a level: true (shown), false (taken out) or nothing (the rank rule decides). */
export function settingsVisibleAt(ui: SettingsUi, itemId: string, at: SettingsLevel): boolean | undefined {
  const v = ui.visible[at];
  return v?.hide.includes(itemId) ? false : v?.show.includes(itemId) ? true : undefined;
}

/** Is this item shown at the picked level? Always when the interface has no levels, always at Administrator, else the
 *  level's visible set, else from its level up. */
export function shownAtLevel(ui: SettingsUi, itemId: string, at: SettingsLevel, own?: string): boolean {
  if (!ui.levels || at === SETTINGS_LEVEL_ALL) return true;
  return settingsVisibleAt(ui, itemId, at) ?? settingsLevelRank(settingsItemLevel(ui, itemId, own)) <= settingsLevelRank(at);
}

/** The picked level, checked (older names migrated; falls back to the interface's default level). */
export function settingsLevel(ui: SettingsUi, stored: unknown): SettingsLevel {
  return level(stored) ?? ui.defaultLevel;
}

/** Problems with a settings asset's data (for validators and editors); empty when every entry survives normalizing. */
export function settingsUiErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['data must be an object'];
  const n = normalizeSettingsUi(raw);
  const errors: string[] = [];
  const count = (k: 'tabs' | 'hide' | 'groups') => (Array.isArray(raw[k]) ? (raw[k] as unknown[]).length : 0);
  if ('tabs' in raw && !Array.isArray(raw.tabs)) errors.push('data.tabs must be a list');
  if ('hide' in raw && !Array.isArray(raw.hide)) errors.push('data.hide must be a list');
  if ('groups' in raw && !Array.isArray(raw.groups)) errors.push('data.groups must be a list');
  if ('toolbar' in raw && !n.toolbar) errors.push('data.toolbar must be a toolbar asset id');
  if (count('tabs') !== n.tabs.length) errors.push(`data.tabs: ${count('tabs') - n.tabs.length} entr${count('tabs') - n.tabs.length === 1 ? 'y' : 'ies'} dropped (bad id, duplicate or over ${SETTINGS_UI_LIMITS.tabs})`);
  if (count('hide') !== n.hide.length) errors.push(`data.hide: ${count('hide') - n.hide.length} entr${count('hide') - n.hide.length === 1 ? 'y' : 'ies'} dropped (bad id, duplicate or over ${SETTINGS_UI_LIMITS.hide})`);
  if (count('groups') !== n.groups.length) errors.push(`data.groups: ${count('groups') - n.groups.length} group(s) dropped (needs id, label, tab and at least one valid setting)`);
  (Array.isArray(raw.groups) ? raw.groups : []).forEach((g, i) => {
    const kept = n.groups.find((x) => isObj(g) && x.id === g.id);
    const given = isObj(g) && Array.isArray(g.settings) ? g.settings.length : 0;
    if (kept && kept.settings.length !== given) errors.push(`data.groups[${i}].settings: ${given - kept.settings.length} setting(s) dropped (needs key, label and a data-only kind: ${ASSET_SETTING_KINDS.join(', ')})`);
  });
  return errors;
}

/** True when the asset leaves this id (tab, group, panel or setting key) out. */
export function settingsShown(ui: SettingsUi, itemId: string): boolean {
  return !ui.hide.includes(itemId);
}

/**
 * The app's registered tabs → the tabs the page shows: asset overrides applied (label, icon, description, parent),
 * new tabs the asset names with a label added, hidden ones left out, then ordered: the asset's tabs first in its
 * order (an explicit `order` wins), every other tab after them by its own order.
 */
export function arrangeSettingsTabs(tabs: readonly SettingsTab[], ui: SettingsUi): SettingsTab[] {
  const byId = new Map(tabs.map((t) => [t.id, { ...t }]));
  ui.tabs.forEach((o) => {
    const t = byId.get(o.id);
    if (t) {
      if (o.label) t.label = o.label;
      if (o.icon) t.icon = o.icon;
      if (o.description) t.description = o.description;
      if (o.parent) t.parent = o.parent;
    } else if (o.label) {
      byId.set(o.id, { id: o.id, label: o.label, icon: o.icon ?? 'settings', order: o.order ?? 100, ...(o.description ? { description: o.description } : {}), ...(o.parent ? { parent: o.parent } : {}), module: 'asset:settings' });
    }
  });
  const rank = new Map(ui.tabs.map((o, i) => [o.id, o.order ?? i - SETTINGS_UI_LIMITS.tabs * 10]));
  const hidden = new Set([...ui.hide, ...ui.tabs.filter((o) => o.hidden).map((o) => o.id)]);
  return [...byId.values()]
    .filter((t) => !hidden.has(t.id) && !(t.parent && hidden.has(t.parent)))
    .map((t, i) => ({ t, i, r: rank.has(t.id) ? rank.get(t.id)! : t.order }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x, i) => ({ ...x.t, order: i + 1 }));
}

/** Is a setting inside a group shown at the level? Its own word (visible set, then a level named for it) wins; a setting
 *  with neither follows its group. */
export function settingShownAtLevel(ui: SettingsUi, key: string, at: SettingsLevel, groupShown: boolean): boolean {
  if (!ui.levels || at === SETTINGS_LEVEL_ALL) return true;
  const v = settingsVisibleAt(ui, key, at);
  if (v !== undefined) return v;
  return ui.levelOf[key] ? shownAtLevel(ui, key, at) : groupShown;
}

/**
 * A group split by the asset and the level: `shown` = what the page shows (the asset's hidden keys out; at a level,
 * what that level has), `rest` = the settings the level leaves out (shown greyed in "More settings"). Either is null
 * when empty. Without a level, `rest` is always null.
 */
export function splitSettingsGroup(group: SettingsGroup, ui: SettingsUi, at?: SettingsLevel): { shown: SettingsGroup | null; rest: SettingsGroup | null } {
  if (!settingsShown(ui, group.id)) return { shown: null, rest: null };
  const kept = group.settings.filter((s) => settingsShown(ui, s.key));
  const pack = (list: SettingSpec[]): SettingsGroup | null => (list.length ? (list.length === group.settings.length ? group : { ...group, settings: list }) : null);
  if (!at) return { shown: pack(kept), rest: null };
  const own = (group as SettingsGroup & { level?: string }).level;
  const groupShown = shownAtLevel(ui, group.id, at, own);
  const shown = kept.filter((s) => settingShownAtLevel(ui, s.key, at, groupShown));
  return { shown: pack(shown), rest: pack(kept.filter((s) => !shown.includes(s))) };
}

/** A group with the asset's hidden setting keys taken out, and at a level only what that level shows (null when nothing is left). */
export function filterSettingsGroup(group: SettingsGroup, ui: SettingsUi, at?: SettingsLevel): SettingsGroup | null {
  return splitSettingsGroup(group, ui, at).shown;
}

/** The asset's own option groups as settings groups for the registry, owned by `asset:settings/<id>`. */
export function settingsUiGroups(ui: SettingsUi, assetId: string): SettingsGroup[] {
  const module = `asset:settings/${assetId}`;
  return ui.groups.map((g) => ({ ...g, module, settings: g.settings.map((s) => ({ ...s })) }));
}

/** Search: does a setting match the query (label, key, description, option labels; every word must hit)? */
export function settingMatches(spec: SettingSpec, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [spec.label, spec.key, spec.description ?? '', ...(spec.options ?? []).map((o) => o.label)].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
