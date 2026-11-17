/**
 * toolbar-override@1 (Brett, Nov 17 2026, build settings-fix-part-2-blank-toolbars: "Make every toolbar blank and just
 * all it has is a settings hook. A little gear with a settings hook. That's it. Every toolbar, we'll edit them later.").
 *
 * Every toolbar draws the shared defaults until it is switched over on its own. One per-toolbar switch,
 * `axf.toolbar.<id>.override` (off by default), decides:
 *
 *   off   the toolbar uses the shared defaults and counts as NOT edited, whatever its own keys still hold
 *         (`toolbarGet` hides them, so a reader sees the defaults); nothing of its own is written while it is off
 *   on    the toolbar is editable: its own keys apply and `isToolbarEdited` says whether any holds a value
 *
 * Turning the switch off RESETS that toolbar to the defaults: its own keys are cleared (`setToolbarOverride` returns
 * the settings without them and lists what went). Turning it on changes nothing but the switch.
 *
 * A toolbar's own keys (`toolbarOwnKeys`): its chrome-settings@1 instance override `axf.chrome.toolbar.<id>` and its
 * picks `axf.chrome.toolbar.<id>.asset` / `.interface`, and every one-segment field under `axf.toolbar.<id>.<field>`
 * (`tapConfirm` today; a new field needs no code here). The switch itself is never one of them. `axf.toolbar.collapsed`
 * (the per-device fold map) is not a toolbar's key.
 *
 * Pure: `get` reads one setting, `saved` is the whole settings map; nothing here touches a runtime or a store, so the
 * React layer, the console API, the CLI and voice all call the same functions (and the Kotlin twin replays the same
 * cases, spec/PORTING.md). Unit test: spec/check-toolbar-override.mts.
 */

import { CHROME_INSTANCE_ASSET_KEY, CHROME_INSTANCE_INTERFACE_KEY, CHROME_INSTANCE_KEY, isChromeInstanceId } from './chrome-settings-rules.mjs';

export const TOOLBAR_OVERRIDE_CONTRACT = 'toolbar-override@1';
/** The prefix every per-toolbar key starts with (the same one tapconfirm.ts uses). */
export const TOOLBAR_KEY_PREFIX = 'axf.toolbar.';
/** The last segment of the switch key. */
export const TOOLBAR_OVERRIDE_FIELD = 'override';
/** The chrome kind a toolbar is under chrome-settings@1. */
export const TOOLBAR_CHROME_KIND = 'toolbar';

export type SettingGet = (key: string) => unknown;
export type SettingsMap = Record<string, unknown>;

export interface ToolbarOverrideState {
  id: string;
  /** The switch: true only when the stored value is exactly `true`. */
  override: boolean;
  /** On, and at least one own key holds a value. Off is never edited. */
  edited: boolean;
  /** The own keys that hold a value right now (listed even while off, so a reader can see what a reset would clear). */
  keys: string[];
}

export interface ToolbarOverrideChange {
  /** The settings after the change. */
  saved: SettingsMap;
  /** Keys the change cleared (only when switching off). */
  cleared: string[];
  state: ToolbarOverrideState;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A stored value that counts as "holds a value": not undefined / null, not an empty object or string. */
const holds = (v: unknown): boolean => {
  if (v === undefined || v === null || v === '') return false;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
};

/** Is this a toolbar id the contract accepts (the chrome instance id rules)? */
export const isToolbarId = (id: unknown): id is string => isChromeInstanceId(id);

/** `axf.toolbar.<id>.override` */
export const toolbarOverrideKey = (id: string): string => `${TOOLBAR_KEY_PREFIX}${id}.${TOOLBAR_OVERRIDE_FIELD}`;

/** The switch for one toolbar: on only when the stored value is exactly `true`. Off by default. */
export function isToolbarOverrideOn(get: SettingGet, id: string): boolean {
  return isToolbarId(id) && get(toolbarOverrideKey(id)) === true;
}

/** Is `key` one of this toolbar's own keys (never the switch, never another toolbar's)? */
export function isToolbarOwnKey(id: string, key: string): boolean {
  if (!isToolbarId(id) || typeof key !== 'string') return false;
  if (key === CHROME_INSTANCE_KEY(TOOLBAR_CHROME_KIND, id) || key === CHROME_INSTANCE_ASSET_KEY(TOOLBAR_CHROME_KIND, id) || key === CHROME_INSTANCE_INTERFACE_KEY(TOOLBAR_CHROME_KIND, id)) return true;
  const prefix = `${TOOLBAR_KEY_PREFIX}${id}.`;
  if (!key.startsWith(prefix)) return false;
  const field = key.slice(prefix.length);
  return field.length > 0 && !field.includes('.') && field !== TOOLBAR_OVERRIDE_FIELD;
}

/** The own keys of one toolbar that hold a value in `saved`, in a stable order (chrome keys first, then fields A–Z). */
export function toolbarOwnKeys(saved: unknown, id: string): string[] {
  if (!isObj(saved) || !isToolbarId(id)) return [];
  const chrome = [CHROME_INSTANCE_KEY(TOOLBAR_CHROME_KIND, id), CHROME_INSTANCE_ASSET_KEY(TOOLBAR_CHROME_KIND, id), CHROME_INSTANCE_INTERFACE_KEY(TOOLBAR_CHROME_KIND, id)].filter((k) => holds(saved[k]));
  const fields = Object.keys(saved).filter((k) => k.startsWith(TOOLBAR_KEY_PREFIX) && isToolbarOwnKey(id, k) && holds(saved[k])).sort();
  return [...chrome, ...fields];
}

/** Edited = the switch is on AND at least one own key holds a value. Off is never edited (the defaults are in use). */
export function isToolbarEdited(saved: unknown, id: string): boolean {
  if (!isObj(saved)) return false;
  return isToolbarOverrideOn((k) => saved[k], id) && toolbarOwnKeys(saved, id).length > 0;
}

/** The readable state of one toolbar under the contract. */
export function toolbarOverrideState(saved: unknown, id: string): ToolbarOverrideState {
  const map = isObj(saved) ? saved : {};
  const override = isToolbarOverrideOn((k) => map[k], id);
  const keys = toolbarOwnKeys(map, id);
  return { id, override, edited: override && keys.length > 0, keys };
}

/**
 * Switch a toolbar's override. Pure: returns the settings after the change.
 *   on   → the switch is stored as `true`; nothing else moves
 *   off  → the switch key and every own key are removed (reset to the shared defaults); `cleared` lists them
 * An id outside the rules changes nothing.
 */
export function setToolbarOverride(saved: unknown, id: string, on: boolean): ToolbarOverrideChange {
  const map: SettingsMap = isObj(saved) ? { ...saved } : {};
  if (!isToolbarId(id)) return { saved: map, cleared: [], state: toolbarOverrideState(map, id) };
  const key = toolbarOverrideKey(id);
  if (on) {
    map[key] = true;
    return { saved: map, cleared: [], state: toolbarOverrideState(map, id) };
  }
  const cleared = Object.keys(map).filter((k) => k === key || isToolbarOwnKey(id, k));
  for (const k of cleared) delete map[k];
  return { saved: map, cleared, state: toolbarOverrideState(map, id) };
}

/** Turning the switch off and the reset are one move; this names it for callers that only want the reset. */
export const resetToolbar = (saved: unknown, id: string): ToolbarOverrideChange => setToolbarOverride(saved, id, false);

/**
 * Read one setting the way a toolbar should see it: an own key of a toolbar whose switch is off reads as `undefined`
 * (the default applies), everything else as stored. Wrap a runtime's getter with it so no reader needs the rule.
 */
export function toolbarGet(get: SettingGet, id: string, key: string): unknown {
  if (isToolbarOwnKey(id, key) && !isToolbarOverrideOn(get, id)) return undefined;
  return get(key);
}

/** A getter that applies `toolbarGet` for one toolbar to every read. */
export const toolbarGetter = (get: SettingGet, id: string): SettingGet => (key) => toolbarGet(get, id, key);

/**
 * Every toolbar the settings know about: ids with a switch key or any own key, each with its state, sorted by id.
 * The readable list behind "which toolbars are edited" (API, CLI, voice).
 */
export function toolbarOverrideList(saved: unknown): ToolbarOverrideState[] {
  if (!isObj(saved)) return [];
  const ids = new Set<string>();
  const chromePrefix = `${CHROME_INSTANCE_KEY(TOOLBAR_CHROME_KIND, '')}`;
  for (const key of Object.keys(saved)) {
    if (key.startsWith(chromePrefix)) {
      let rest = key.slice(chromePrefix.length);
      for (const suffix of ['.asset', '.interface']) if (rest.endsWith(suffix)) rest = rest.slice(0, -suffix.length);
      if (isToolbarId(rest)) ids.add(rest);
    } else if (key.startsWith(TOOLBAR_KEY_PREFIX)) {
      const rest = key.slice(TOOLBAR_KEY_PREFIX.length);
      const at = rest.lastIndexOf('.');
      if (at <= 0) continue; // `axf.toolbar.collapsed` and the like: not a toolbar's key
      const id = rest.slice(0, at);
      if (isToolbarId(id) && (rest.slice(at + 1) === TOOLBAR_OVERRIDE_FIELD || isToolbarOwnKey(id, key))) ids.add(id);
    }
  }
  return [...ids].sort().map((id) => toolbarOverrideState(saved, id)).filter((s) => s.override || s.keys.length);
}
