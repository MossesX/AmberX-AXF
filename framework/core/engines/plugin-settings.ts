/*
 * plugin-settings@1: which settings interface a page renders through (spec/PLUGIN-SETTINGS.md, Nov 17 2026). Pure: no
 * DOM, no runtime.
 *
 * Every settings interface (a `settings` asset, settings-ui@1) has one owner: the app's own page (scope app, the Dev
 * Console's is settings/console), one plugin (scope plugin, owner = its plugin id, asset id plugin-<owner>) or one chrome
 * type (scope chrome, chrome-settings@1). Interfaces are never shared across owners: a plugin page resolves to the
 * plugin's own asset, else to a default generated from the plugin's registered settings tabs and groups, and never to
 * the app's interface; an app page resolves to the app's pick (when its scope is app), else the framework default, and
 * never to a plugin's.
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md); spec/fixtures/plugin-settings.json is what it will replay.
 */
import type { SettingsGroup, SettingsTab } from '../settings';
import { SETTINGS_UI_DEFAULTS, SETTINGS_UI_LIMITS, normalizeSettingsUi, settingsScopeOf, type SettingsLevel, type SettingsScope, type SettingsUi } from './settingsui';

export const PLUGIN_SETTINGS_CONTRACT = 'plugin-settings@1';
/** Asset id prefix of a plugin's own interface: settings/plugin-<owner slug>. */
export const PLUGIN_SETTINGS_PREFIX = 'plugin-';
/** The key the resolved interface is read under (console control `setting:axf.settings.interface`, with `owner`). */
export const SETTINGS_INTERFACE_KEY = 'axf.settings.interface';
/** The level every generated key starts at (the plugin's keys are the interface's keys from the first render). */
export const GENERATED_LEVEL: SettingsLevel = 'basic';

/** Who a page belongs to. Chrome dialogs are chrome-settings@1 and never come here. */
export type SettingsOwner = { kind: 'app' } | { kind: 'plugin'; id: string };
export type SettingsInterfaceSource = 'asset' | 'generated' | 'default';

/** A settings asset as the registry holds it (only the id and the data matter here). */
export interface SettingsAssetLike { id: string; data: unknown }

export interface ResolveSettingsEnv {
  /** every `settings` asset the app has */
  assets: readonly SettingsAssetLike[];
  /** the app's active `settings` asset id (the slot pick; the Dev Console's is `console`) */
  appPick?: string | null;
  /** registered settings tabs (all of them; the engine keeps the owner's) */
  tabs?: readonly SettingsTab[];
  /** registered settings groups (all of them; the engine keeps the owner's) */
  groups?: readonly SettingsGroup[];
}

export interface ResolvedSettingsInterface {
  /** the asset id the interface has (a generated one carries the id a save would give it) */
  id: string;
  source: SettingsInterfaceSource;
  owner: SettingsOwner;
  ui: SettingsUi;
}

const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ASSET_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Is this a plugin id as plugin.json allows it? */
export const isPluginId = (v: unknown): v is string => typeof v === 'string' && PLUGIN_ID.test(v);

/** A plugin id as an asset-id slug (lower-case, runs of anything else become one dash, 40 chars). */
export function pluginSlug(pluginId: string): string {
  const s = String(pluginId ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'plugin';
}

/** The asset id of a plugin's own interface: plugin-<slug>. */
export const pluginSettingsId = (pluginId: string): string => `${PLUGIN_SETTINGS_PREFIX}${pluginSlug(pluginId)}`;

/** The owner as one word, for addresses and settings: `app` or `plugin:<id>`. */
export const settingsOwnerKey = (o: SettingsOwner): string => (o.kind === 'app' ? 'app' : `plugin:${o.id}`);

/** `app` / `plugin:<id>` (also a bare plugin id, or `console` for the app) → owner; anything else null. */
export function parseSettingsOwner(v: unknown): SettingsOwner | null {
  if (isObj(v)) {
    if (v.kind === 'app') return { kind: 'app' };
    if (v.kind === 'plugin' && isPluginId(v.id)) return { kind: 'plugin', id: v.id };
    return null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === 'app' || s === 'console') return { kind: 'app' };
  const m = /^plugin:(.+)$/.exec(s);
  const id = m ? m[1] : s;
  return isPluginId(id) ? { kind: 'plugin', id } : null;
}

/** The id an owner's interface has: the plugin's `plugin-<slug>`, or the app's pick (the framework's `standard` when none). */
export function settingsInterfaceId(owner: SettingsOwner, appPick?: string | null): string {
  return owner.kind === 'plugin' ? pluginSettingsId(owner.id) : (typeof appPick === 'string' && ASSET_ID.test(appPick) ? appPick : 'standard');
}

/** Who an asset belongs to, from its data: the app, a plugin (its owner), a chrome type, or null for a plugin interface with no owner. */
export function settingsOwnerOf(data: unknown): SettingsOwner | { kind: 'chrome'; for: string } | null {
  const s = settingsScopeOf(data);
  if (s.scope === 'app') return { kind: 'app' };
  if (s.scope === 'chrome') return s.for ? { kind: 'chrome', for: s.for } : null;
  return s.owner ? { kind: 'plugin', id: s.owner } : null;
}

/** Is this asset the plugin's own interface (scope plugin, owner = the plugin, id = plugin-<slug>)? */
export function isPluginSettingsAsset(asset: SettingsAssetLike, pluginId: string): boolean {
  const o = settingsOwnerOf(asset.data);
  return o?.kind === 'plugin' && o.id === pluginId && asset.id === pluginSettingsId(pluginId);
}

/** The plugin's registered tabs: those marked with its id (`plugin`), its own tab id, or sub-tabs of it. Order kept. */
export function pluginSettingsTabs(pluginId: string, tabs: readonly SettingsTab[] = []): SettingsTab[] {
  const own = tabs.filter((t) => t.plugin === pluginId || t.id === pluginId);
  const ids = new Set(own.map((t) => t.id));
  const subs = tabs.filter((t) => !ids.has(t.id) && t.parent && ids.has(t.parent));
  return [...own, ...subs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || tabs.indexOf(a) - tabs.indexOf(b));
}

/** The plugin's registered groups: those on one of its tabs. Order kept. */
export function pluginSettingsGroups(pluginId: string, tabs: readonly SettingsTab[] = [], groups: readonly SettingsGroup[] = []): SettingsGroup[] {
  const ids = new Set(pluginSettingsTabs(pluginId, tabs).map((t) => t.id));
  return groups.filter((g) => g.tab && ids.has(g.tab)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || groups.indexOf(a) - groups.indexOf(b));
}

/**
 * The default interface a plugin gets when it has no asset of its own, as asset data (so a save writes it as
 * settings/plugin-<slug> unchanged): scope plugin + owner, a short list page, the level toolbar on, and `levelOf`
 * naming every tab id, group id and setting key the plugin registered at `basic`; its tabs in their registered order.
 */
export function generatedPluginSettings(pluginId: string, tabs: readonly SettingsTab[] = [], groups: readonly SettingsGroup[] = []): Record<string, unknown> {
  const own = pluginSettingsTabs(pluginId, tabs);
  const ownGroups = pluginSettingsGroups(pluginId, tabs, groups);
  const levelOf: Record<string, SettingsLevel> = {};
  for (const t of own) levelOf[t.id] = GENERATED_LEVEL;
  for (const g of ownGroups) {
    levelOf[g.id] = GENERATED_LEVEL;
    for (const s of g.settings) levelOf[s.key] = GENERATED_LEVEL;
  }
  const keys = Object.keys(levelOf).slice(0, SETTINGS_UI_LIMITS.hide);
  return {
    scope: 'plugin' satisfies SettingsScope,
    owner: pluginId,
    layout: 'list',
    header: 'compact',
    search: false,
    descriptions: true,
    tabs: own.slice(0, SETTINGS_UI_LIMITS.tabs).map((t) => ({ id: t.id, ...(t.parent ? { parent: t.parent } : {}) })),
    hide: [],
    groups: [],
    levels: true,
    defaultLevel: GENERATED_LEVEL,
    levelOf: Object.fromEntries(keys.map((k) => [k, levelOf[k]])),
    visible: {},
  };
}

/**
 * Which interface a page renders through. A plugin page: its own asset, else a generated default; never the app's,
 * never another plugin's, never a chrome interface. An app page: the app's pick when its scope is app, else the
 * framework default; never a plugin's.
 */
export function resolveSettingsInterface(owner: SettingsOwner, env: ResolveSettingsEnv): ResolvedSettingsInterface {
  if (owner.kind === 'plugin') {
    const id = pluginSettingsId(owner.id);
    const own = env.assets.find((a) => isPluginSettingsAsset(a, owner.id));
    if (own) return { id, source: 'asset', owner, ui: normalizeSettingsUi(own.data) };
    return { id, source: 'generated', owner, ui: normalizeSettingsUi(generatedPluginSettings(owner.id, env.tabs, env.groups)) };
  }
  const pick = typeof env.appPick === 'string' ? env.assets.find((a) => a.id === env.appPick) : undefined;
  if (pick && settingsOwnerOf(pick.data)?.kind === 'app') return { id: pick.id, source: 'asset', owner, ui: normalizeSettingsUi(pick.data) };
  return { id: 'standard', source: 'default', owner, ui: { ...SETTINGS_UI_DEFAULTS } };
}

/** Does this owner render through its own interface and nobody else's? (What "every page has the correct default" checks.) */
export function settingsInterfaceIsOwn(r: ResolvedSettingsInterface): boolean {
  if (r.owner.kind === 'plugin') return r.ui.scope === 'plugin' && r.ui.owner === r.owner.id && r.id === pluginSettingsId(r.owner.id);
  return r.ui.scope === 'app';
}

/**
 * Problems with an app's settings assets under plugin-settings@1: a plugin interface whose id is not plugin-<owner slug>,
 * a plugin-* id whose scope is not plugin, a plugin interface with no owner, two assets for one plugin, or an app pick
 * that is not an app interface.
 */
export function pluginSettingsErrors(assets: readonly SettingsAssetLike[], appPick?: string | null): string[] {
  const errors: string[] = [];
  const byOwner = new Map<string, string[]>();
  for (const a of assets) {
    const s = settingsScopeOf(a.data);
    const isPluginId = a.id.startsWith(PLUGIN_SETTINGS_PREFIX);
    if (s.scope === 'plugin') {
      if (!s.owner) { errors.push(`settings/${a.id}: scope plugin with no owner (data.owner = the plugin id)`); continue; }
      const want = pluginSettingsId(s.owner);
      if (a.id !== want) errors.push(`settings/${a.id}: a plugin interface for "${s.owner}" must have the id ${want}`);
      byOwner.set(s.owner, [...(byOwner.get(s.owner) ?? []), a.id]);
    } else if (isPluginId) {
      errors.push(`settings/${a.id}: the plugin- id is reserved for plugin interfaces (data.scope = plugin, data.owner = the plugin id); this one is scope ${s.scope}`);
    }
  }
  for (const [owner, ids] of byOwner) if (ids.length > 1) errors.push(`plugin "${owner}" has ${ids.length} interfaces (${ids.join(', ')}); one per plugin`);
  if (typeof appPick === 'string') {
    const pick = assets.find((a) => a.id === appPick);
    if (pick && settingsScopeOf(pick.data).scope !== 'app') errors.push(`settings/${appPick}: the app's settings pick must be an app interface (scope app); this one is scope ${settingsScopeOf(pick.data).scope}`);
  }
  return errors;
}
