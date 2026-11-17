/*
 * settings-reset@1: the plan a reset shows before it asks (spec/PLUGIN-SETTINGS.md §4, Nov 17 2026). Pure: no DOM, no
 * runtime, no storage.
 *
 * Brett: "Reset asks in a confirm dialog with a switch to include assets and a scrollable table of changed assets."
 * `planSettingsReset(scope, includeAssets, state)` turns what is saved now into exactly what the confirm dialog lists
 * and what the action clears afterwards: the setting keys in the scope (console = the app's own settings, a plugin id =
 * that plugin's only), and, when the switch is on, the changed assets and skins in the scope. The asset rows come from
 * `changedAssets(state)`, the one source the settings panel's changed-assets table draws from too, so the dialog and the
 * panel never disagree. A plan for a plugin never names a console key or another plugin's; a plan for the console never
 * names a plugin's key.
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md); spec/fixtures/settings-reset.json is what it will replay.
 */
import type { SettingsGroup, SettingsTab, SettingValue } from '../settings';
import { isPluginId, pluginSettingsGroups } from './plugin-settings';

export const SETTINGS_RESET_CONTRACT = 'settings-reset@1';
/** The action that runs after the confirm, with `{ scope, includeAssets }`; `settings.reset.plan` returns the plan alone. */
export const SETTINGS_RESET_ACTION = 'settings.reset';
export const SETTINGS_RESET_PLAN_ACTION = 'settings.reset.plan';
/** The switch is off by default: a reset clears settings; assets only when asked. */
export const SETTINGS_RESET_INCLUDE_ASSETS_DEFAULT = false;
/** The dialog's table scrolls past this many rows (it never grows the dialog). */
export const SETTINGS_RESET_TABLE_ROWS = 8;

export type ResetScope = { kind: 'console' } | { kind: 'plugin'; id: string };
export const resetScopeKey = (s: ResetScope): string => (s.kind === 'console' ? 'console' : `plugin:${s.id}`);

/** `console` / `app` → the console; `plugin:<id>` or a bare plugin id → that plugin; anything else null. */
export function parseResetScope(v: unknown): ResetScope | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (o.kind === 'console' || o.kind === 'app') return { kind: 'console' };
    if (o.kind === 'plugin' && isPluginId(o.id)) return { kind: 'plugin', id: o.id };
    return null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === 'console' || s === 'app') return { kind: 'console' };
  const m = /^plugin:(.+)$/.exec(s);
  const id = m ? m[1] : s;
  return isPluginId(id) ? { kind: 'plugin', id } : null;
}

/* ---------------- what is saved ---------------- */

/** A look part as app-look@1 holds it (skin-rules.mjs normalizeLookPart). */
export interface LookPartLike { slots?: Record<string, string>; spacing?: string; hidden?: Record<string, boolean>; settings?: Record<string, unknown> }
export interface SkinStateLike { use?: boolean | string; inherit?: boolean; id?: string; overrides?: Record<string, string>; colorTheme?: string }
export interface ScopeStateLike { use?: string; id?: string; overrides?: Record<string, string>; colorTheme?: string }
/** The app's app-look@1 document, as far as a reset reads it. */
export interface AppLookLike { default?: LookPartLike; own?: LookPartLike; skin?: SkinStateLike; scopes?: Record<string, ScopeStateLike> }

export interface ResetState {
  /** every saved setting (SettingsRegistry.savedValues()) */
  values: Record<string, SettingValue>;
  /** registered groups and tabs (which keys belong to which plugin) */
  groups?: readonly SettingsGroup[];
  tabs?: readonly SettingsTab[];
  /** the app's app-look@1 document; null = none yet */
  look?: AppLookLike | null;
  /** when there is no look document: the active slot ids and the manifest defaults */
  active?: Record<string, string>;
  defaults?: Record<string, string>;
  /** display names for asset ids (type, id) → name; left out = the id */
  nameOf?: (type: string, id: string) => string | undefined;
}

/* ---------------- key ownership ---------------- */

/** Setting keys that hold look / asset state rather than a setting: never in the settings rows, cleared only with the switch. */
export const LOOK_KEY_PATTERNS: readonly RegExp[] = [
  /^axf\.hide\./, /^axf\.roll\.slot\./, /^axf\.widgets\.arrange\./, /^axf\.chrome\./, /^axf\.tokens\./,
  /^axf\.appearance\./, /^axf\.lock\.hubskin/, /^axf\.plugin\..+\.look$/,
];
/** The app-look@1 document itself: never cleared, restored through `applyResetToLook`. */
export const APP_LOOK_SETTING_KEY = 'axf.skin.look';
export const PLUGIN_LOOK_KEY = (pluginId: string) => `axf.plugin.${pluginId}.look`;
const PLUGIN_LOOK = /^axf\.plugin\.(.+)\.look$/;

export const isLookKey = (key: string): boolean => key === APP_LOOK_SETTING_KEY || LOOK_KEY_PATTERNS.some((p) => p.test(key));

/** Every plugin the registry knows: the `plugin` of its tabs. */
export function knownPlugins(tabs: readonly SettingsTab[] = []): string[] {
  const out: string[] = [];
  for (const t of tabs) if (t.plugin && isPluginId(t.plugin) && !out.includes(t.plugin)) out.push(t.plugin);
  return out;
}

/**
 * The plugin a saved key belongs to: a key registered in one of the plugin's groups, the plugin's look key, or a key
 * under the plugin's own prefix (`<id>.`); null = the console's.
 */
export function keyOwner(key: string, state: Pick<ResetState, 'groups' | 'tabs'>): string | null {
  const look = PLUGIN_LOOK.exec(key);
  if (look) return look[1] ?? null;
  const plugins = knownPlugins(state.tabs);
  for (const id of plugins) {
    if (pluginSettingsGroups(id, state.tabs, state.groups).some((g) => g.settings.some((s) => s.key === key))) return id;
  }
  for (const id of plugins) if (key.startsWith(`${id}.`)) return id;
  return null;
}

const inScope = (owner: string | null, scope: ResetScope): boolean => (scope.kind === 'console' ? owner === null : owner === scope.id);

/* ---------------- rows ---------------- */

export interface ResetSettingRow {
  key: string;
  /** the registered label, when the key is registered */
  label?: string;
  /** the registered group id */
  group?: string;
  current: SettingValue;
  /** the registered default, null when none */
  default: SettingValue | null;
}

export type ChangedAssetKind = 'slot' | 'hidden' | 'spacing' | 'skin' | 'skin-override' | 'scope-skin' | 'scope-override' | 'plugin-look' | 'look-setting';

/** One row of the changed-assets table (the settings panel's and the confirm dialog's). */
export interface ChangedAssetRow {
  kind: ChangedAssetKind;
  /** the asset type / slot, the skin scope key, or the setting key */
  type: string;
  label: string;
  current: string;
  default: string;
  /** `console` or `plugin:<id>` */
  scope: string;
}

const KIND_LABEL: Record<ChangedAssetKind, string> = {
  slot: 'Asset', hidden: 'Hidden chrome', spacing: 'Spacing', skin: 'Skin', 'skin-override': 'Skin override',
  'scope-skin': 'Skin at a scope', 'scope-override': 'Override at a scope', 'plugin-look': 'Plugin look', 'look-setting': 'Look setting',
};
const words = (s: string): string => s.replace(/[-_.]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const onOff = (v: boolean | undefined): string => (v ? 'hidden' : 'shown');

function scopeOfKey(key: string): string {
  const m = /^plugin:(.+)$/.exec(key);
  return m ? `plugin:${m[1]}` : 'console';
}

/**
 * Every asset or skin that differs from the app's default, as table rows: slot picks, hidden chrome, spacing, the app
 * skin and its overrides, every ui: / plugin: scope, every plugin look and every saved look setting. Sorted by scope
 * (console first), then kind, then type.
 */
export function changedAssets(state: ResetState): ChangedAssetRow[] {
  const rows: ChangedAssetRow[] = [];
  const name = (type: string, id: string): string => (id ? state.nameOf?.(type, id) ?? id : 'none');
  const look = state.look ?? null;
  const def = look?.default ?? {};
  const own = look?.own ?? {};
  const slots = look ? own.slots ?? {} : Object.fromEntries(Object.entries(state.active ?? {}).filter(([t, id]) => (state.defaults ?? {})[t] !== id));
  const defSlots = look ? def.slots ?? {} : state.defaults ?? {};
  for (const [type, id] of Object.entries(slots)) {
    if (defSlots[type] === id) continue;
    rows.push({ kind: 'slot', type, label: words(type), current: name(type, id), default: name(type, defSlots[type] ?? ''), scope: 'console' });
  }
  for (const [type, hidden] of Object.entries(own.hidden ?? {})) {
    if (!!def.hidden?.[type] === !!hidden) continue;
    rows.push({ kind: 'hidden', type, label: words(type), current: onOff(hidden), default: onOff(def.hidden?.[type]), scope: 'console' });
  }
  if (own.spacing && own.spacing !== def.spacing) rows.push({ kind: 'spacing', type: 'spacing', label: 'Spacing', current: own.spacing, default: def.spacing ?? 'default', scope: 'console' });
  for (const [key, v] of Object.entries(own.settings ?? {})) {
    if (JSON.stringify(def.settings?.[key]) === JSON.stringify(v)) continue;
    rows.push({ kind: 'look-setting', type: key, label: key, current: String(v), default: def.settings && key in def.settings ? String(def.settings[key]) : 'default', scope: 'console' });
  }
  const skin = look?.skin;
  if (skin && (skin.use === true || skin.use === 'on')) rows.push({ kind: 'skin', type: 'skin', label: 'Skin', current: name('skin', skin.id ?? ''), default: 'off', scope: 'console' });
  else if (skin?.inherit) rows.push({ kind: 'skin', type: 'skin', label: 'Skin', current: 'follows axHub', default: 'off', scope: 'console' });
  if (skin && (skin.use === true || skin.use === 'on' || skin.inherit)) {
    for (const [type, id] of Object.entries(skin.overrides ?? {})) rows.push({ kind: 'skin-override', type, label: words(type), current: name(type, id), default: 'from the skin', scope: 'console' });
    if (skin.colorTheme) rows.push({ kind: 'skin-override', type: 'color-theme', label: 'Colour theme', current: name('color-theme', skin.colorTheme), default: 'from the skin', scope: 'console' });
  }
  for (const [key, sc] of Object.entries(look?.scopes ?? {})) {
    const scope = scopeOfKey(key);
    if (sc.use && sc.use !== 'inherit') rows.push({ kind: 'scope-skin', type: key, label: `Skin at ${key}`, current: sc.use === 'off' ? 'off' : name('skin', sc.id ?? ''), default: 'inherit', scope });
    for (const [type, id] of Object.entries(sc.overrides ?? {})) rows.push({ kind: 'scope-override', type: `${key}/${type}`, label: `${words(type)} at ${key}`, current: name(type, id), default: 'inherit', scope });
    if (sc.colorTheme) rows.push({ kind: 'scope-override', type: `${key}/color-theme`, label: `Colour theme at ${key}`, current: name('color-theme', sc.colorTheme), default: 'inherit', scope });
  }
  for (const [key, v] of Object.entries(state.values)) {
    if (v === null || v === undefined || key === APP_LOOK_SETTING_KEY) continue;
    const pl = PLUGIN_LOOK.exec(key);
    if (pl) { rows.push({ kind: 'plugin-look', type: key, label: `${words(pl[1] ?? '')} look`, current: 'overridden', default: 'theme', scope: `plugin:${pl[1] ?? ''}` }); continue; }
    if (LOOK_KEY_PATTERNS.some((p) => p.test(key))) rows.push({ kind: 'look-setting', type: key, label: key, current: typeof v === 'string' ? v : JSON.stringify(v), default: 'default', scope: 'console' });
  }
  const kinds = Object.keys(KIND_LABEL);
  return rows.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'console' ? -1 : b.scope === 'console' ? 1 : a.scope.localeCompare(b.scope)) || kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.type.localeCompare(b.type));
}

/** The changed-asset rows in one scope. */
export const changedAssetsIn = (scope: ResetScope, state: ResetState): ChangedAssetRow[] => changedAssets(state).filter((r) => r.scope === resetScopeKey(scope));

/** The saved setting keys a reset of this scope clears, as rows (look keys left out: they are assets). Sorted by key. */
export function settingsToClear(scope: ResetScope, state: ResetState): ResetSettingRow[] {
  const specs = new Map<string, { label: string; group: string; default: SettingValue | null }>();
  for (const g of state.groups ?? []) for (const s of g.settings) if (!specs.has(s.key)) specs.set(s.key, { label: s.label, group: g.id, default: s.default ?? null });
  const rows: ResetSettingRow[] = [];
  for (const [key, v] of Object.entries(state.values)) {
    if (v === null || v === undefined || isLookKey(key)) continue;
    if (!inScope(keyOwner(key, state), scope)) continue;
    const sp = specs.get(key);
    rows.push({ key, ...(sp ? { label: sp.label, group: sp.group } : {}), current: v, default: sp?.default ?? null });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/* ---------------- the plan ---------------- */

export interface ResetApply {
  /** setting keys to clear (settings, plus the scope's look keys when assets are included) */
  clear: string[];
  /** what to do with the app-look@1 document: restore the console's default (own picks, skin, ui: scopes), drop the plugin's scope, or nothing */
  look: 'restore' | 'drop-scope' | null;
  /** the skin scope keys dropped from the document */
  scopes: string[];
}

export interface ResetPlan {
  contract: typeof SETTINGS_RESET_CONTRACT;
  scope: ResetScope;
  includeAssets: boolean;
  /** the setting keys the reset clears */
  settings: ResetSettingRow[];
  /** the changed assets in the scope: listed always (the dialog shows them greyed while the switch is off), cleared only with the switch */
  assets: ChangedAssetRow[];
  /** what the action does after the confirm */
  apply: ResetApply;
  /** nothing to do: the dialog says so and its confirm is disabled */
  empty: boolean;
  /** one line for the dialog: "3 settings · 2 assets" */
  summary: string;
  /** the table scrolls past this many rows */
  tableRows: number;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The plan for a reset: what the confirm dialog lists and what the action does once confirmed. */
export function planSettingsReset(scope: ResetScope, includeAssets: boolean, state: ResetState): ResetPlan {
  const settings = settingsToClear(scope, state);
  const assets = changedAssetsIn(scope, state);
  const clear = settings.map((r) => r.key);
  let look: ResetApply['look'] = null;
  const scopes: string[] = [];
  if (includeAssets) {
    for (const [key, v] of Object.entries(state.values)) {
      if (v === null || v === undefined || key === APP_LOOK_SETTING_KEY || !LOOK_KEY_PATTERNS.some((p) => p.test(key))) continue;
      if (inScope(keyOwner(key, state), scope)) clear.push(key);
    }
    const scopeKeys = Object.keys(state.look?.scopes ?? {});
    if (scope.kind === 'console') {
      scopes.push(...scopeKeys.filter((k) => !k.startsWith('plugin:')));
      if (state.look && (Object.keys(state.look.own ?? {}).length || state.look.skin?.use === true || state.look.skin?.use === 'on' || state.look.skin?.inherit || scopes.length)) look = 'restore';
      else if (!state.look && assets.length) look = 'restore';
    } else {
      const own = `plugin:${scope.id}`;
      if (scopeKeys.includes(own)) { scopes.push(own); look = 'drop-scope'; }
    }
  }
  const empty = !clear.length && !look;
  const parts = [count(settings.length, 'setting')];
  if (assets.length) parts.push(`${count(assets.length, 'asset')}${includeAssets ? '' : ' kept'}`);
  return { contract: SETTINGS_RESET_CONTRACT, scope, includeAssets, settings, assets, apply: { clear: [...new Set(clear)].sort(), look, scopes }, empty, summary: empty ? 'Nothing to reset' : parts.join(' · '), tableRows: SETTINGS_RESET_TABLE_ROWS };
}

/**
 * The app-look@1 document after the plan: the console's reset puts own picks back to the snapshot, turns the skin off and
 * drops ui: scopes but keeps every plugin's scope (those are the plugins' own); a plugin's reset drops only its scope.
 * What was replaced is kept as the one undo (`at` = when). Unchanged when the plan touches no look.
 */
export function applyResetToLook<T extends AppLookLike & { undo?: unknown }>(look: T, plan: ResetPlan, at: string): T {
  if (!plan.apply.look) return look;
  const scopes = { ...(look.scopes ?? {}) };
  for (const k of plan.apply.scopes) delete scopes[k];
  const undo = { own: look.own ?? {}, skin: look.skin ?? {}, scopes: look.scopes ?? {}, at, action: SETTINGS_RESET_ACTION, scope: resetScopeKey(plan.scope) };
  if (plan.apply.look === 'drop-scope') return { ...look, scopes, undo };
  return { ...look, own: {}, skin: { use: false, inherit: false, id: look.skin?.id ?? '', overrides: {} }, scopes, undo };
}

/** Problems with a reset request (the API's 400s): a bad scope, a non-boolean switch. */
export function resetRequestErrors(raw: unknown): string[] {
  const errors: string[] = [];
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return ['request must be an object { scope, includeAssets? }'];
  if (!parseResetScope(o.scope ?? 'console')) errors.push('scope must be "console" or a plugin id ("plugin:<id>")');
  if ('includeAssets' in o && typeof o.includeAssets !== 'boolean') errors.push('includeAssets must be true or false');
  return errors;
}
