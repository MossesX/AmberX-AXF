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
 * Kotlin twin deferred (Android on hold, spec/PORTING.md); spec/fixtures/settings-ui.json is what it will replay.
 */
import type { SettingKind, SettingSpec, SettingsGroup, SettingsTab, SettingValue } from '../settings';
import { LOOK_LEVELS, lookLevelRank, type LookLevel } from './looktokens';

export type SettingsLayout = 'tabs-top' | 'tabs-side' | 'list';
export type SettingsHeader = 'full' | 'compact' | 'none';

export interface SettingsUiTab { id: string; label?: string; icon?: string; order?: number; description?: string; parent?: string; hidden?: boolean }
export interface SettingsUiGroup { id: string; label: string; icon?: string; tab: string; order?: number; description?: string; settings: SettingSpec[]; level?: LookLevel; collapsible?: boolean; collapsed?: boolean }

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
  /** Simple / Basic / Pro / Advanced (Oct 26 2026): a level switch on the settings page; every tab, group, panel and
   *  setting shows from its level up. Off = everything shows, as before. */
  levels: boolean;
  /** level of anything `levelOf` doesn't name */
  defaultLevel: LookLevel;
  /** tab, group, panel or setting id → its level */
  levelOf: Record<string, LookLevel>;
}

export const SETTINGS_LAYOUTS: readonly SettingsLayout[] = ['tabs-top', 'tabs-side', 'list'];
export const SETTINGS_HEADERS: readonly SettingsHeader[] = ['full', 'compact', 'none'];
/** Kinds an asset may declare: data only (no secrets, no asset slots, no actions or custom renderers). */
export const ASSET_SETTING_KINDS: readonly SettingKind[] = ['toggle', 'text', 'number', 'slider', 'choice', 'multi_choice', 'color', 'link', 'section'];
export const SETTINGS_UI_LIMITS = { tabs: 40, hide: 200, groups: 40, settings: 60, options: 50, text: 200, id: 120 } as const;

export const SETTINGS_UI_DEFAULTS: SettingsUi = { layout: 'tabs-top', header: 'full', search: false, descriptions: true, tabs: [], hide: [], groups: [], levels: false, defaultLevel: 'basic', levelOf: {} };
/** The level the settings page shows (per browser, like every setting). */
export const SETTINGS_LEVEL_KEY = 'axf.settings.level';
const level = (v: unknown): LookLevel | undefined => (LOOK_LEVELS.includes(v as LookLevel) ? (v as LookLevel) : undefined);

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
    levelOf: Object.fromEntries(Object.entries(isObj(d.levelOf) ? d.levelOf : {}).filter(([k, v]) => id(k) && level(v)).slice(0, SETTINGS_UI_LIMITS.hide)) as Record<string, LookLevel>,
  };
}

/** The level of a tab, group, panel or setting: what the asset names, a group's own `level`, else the default. */
export function settingsItemLevel(ui: SettingsUi, itemId: string, own?: LookLevel): LookLevel {
  return ui.levelOf[itemId] ?? own ?? ui.defaultLevel;
}

/** Is this item shown at the picked level? (always, when the interface has no levels) */
export function shownAtLevel(ui: SettingsUi, itemId: string, at: LookLevel, own?: LookLevel): boolean {
  return !ui.levels || lookLevelRank(settingsItemLevel(ui, itemId, own)) <= lookLevelRank(at);
}

/** The picked level, checked (falls back to the interface's default level). */
export function settingsLevel(ui: SettingsUi, stored: unknown): LookLevel {
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

/** A group with the asset's hidden setting keys taken out (null when nothing is left, or the group itself is hidden). */
export function filterSettingsGroup(group: SettingsGroup, ui: SettingsUi, at?: LookLevel): SettingsGroup | null {
  if (!settingsShown(ui, group.id)) return null;
  const own = (group as SettingsGroup & { level?: LookLevel }).level;
  if (at && !shownAtLevel(ui, group.id, at, own)) return null;
  const settings = group.settings.filter((s) => settingsShown(ui, s.key) && (!at || !ui.levelOf[s.key] || shownAtLevel(ui, s.key, at)));
  return settings.length ? (settings.length === group.settings.length ? group : { ...group, settings }) : null;
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
