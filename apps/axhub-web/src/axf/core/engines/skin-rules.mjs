/**
 * app-look@1 document rules (engines/skin.ts holds the skin@1 format and composing): plain JS, so the skins CLI, the
 * console server and the runtime change one app's look document the same way. Pure.
 *
 * Scopes (build skins-asset-types, Nov 2026): besides the app's own skin switch (`skin`), a document holds a skin state
 * per UI / screen and per plugin (`scopes["ui:<id>"]`, `scopes["plugin:<id>"]`, each `{ use: on | off | inherit, id,
 * overrides }`, default inherit) and a `skin.inherit` switch that lets the app follow the hub-wide skin (the global
 * level, kept on the shared appearance document). The chain for a place is plugin → ui → app → global; the child
 * overrides the parent (skin-coverage.mjs `resolveSkinChain`).
 *
 * The colour theme inside a skin (Brett, Nov 9 2026: "The skins have the color theme in them. You can change the color
 * theme without changing the skin."): a skin owns every section of the look and names its own colour theme; the user
 * may switch that one section on its own. The pick is the level's `colorTheme` field (app, `ui:` / `plugin:` scope, the
 * hub-wide skin), never an entry in `overrides` and never a new skin: the skin id, the skin asset and every other
 * section stay as they are, and no skin is created, copied or forked. Absent = the skin's own colour theme. Picking a
 * different skin starts from that skin's own colours. A document saved before the rule kept the pick as
 * `overrides["color-theme"]`; reading it moves it to `colorTheme` (`normalizeAppLook`).
 */
import { isSubScopeKey, resolveSkinChain, skinScopeChain, SKIN_SCOPE_APP, SKIN_SCOPE_GLOBAL } from './skin-coverage.mjs';

export const APP_LOOK_FRAME = 'app-look@1';
export const APP_LOOK_PROJECT = 'shared';
export const APP_LOOK_MAX_BYTES = 64 * 1024;
export const appLookPath = (appId) => `settings/looks/${appId}.json`;
/** Slots a skin never sets. */
export const SKIN_NEVER = ['uac-policy', 'help', 'skin', 'design-package', 'interface'];
/** The section of a skin that is switched on its own: the colour theme slot. Kept as `colorTheme`, never in `overrides`. */
export const SKIN_COLOR_SLOT = 'color-theme';
/** The three per-level choices. */
export const SKIN_USES = ['on', 'off', 'inherit'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const SPACINGS = ['tight', 'compact', 'regular'];

function idMap(raw, never = []) {
  const out = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (ID.test(k) && typeof v === 'string' && ID.test(v) && !never.includes(k)) out[k] = v;
  return out;
}
function boolMap(raw) {
  const out = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v;
  return out;
}

/** What `overrides` never holds: the slots a skin never sets, and the colour theme (its own field). */
const NOT_OVERRIDES = [...SKIN_NEVER, SKIN_COLOR_SLOT];
/** A level's colour theme pick: `colorTheme`, or the `color-theme` override of a document saved before the rule ('' = the skin's own). */
function colorPick(d) {
  if (typeof d.colorTheme === 'string' && ID.test(d.colorTheme)) return d.colorTheme;
  const old = isObj(d.overrides) ? d.overrides[SKIN_COLOR_SLOT] : '';
  return typeof old === 'string' && ID.test(old) ? old : '';
}
/** `state` with the pick on it; a state without one carries no `colorTheme` field at all. */
function withColor(state, pick) {
  const { colorTheme: _own, ...rest } = state;
  return pick ? { ...rest, colorTheme: pick } : rest;
}

/** Keep what a look holds: slots, spacing, chrome and look settings. */
export function normalizeLookPart(raw) {
  const d = isObj(raw) ? raw : {};
  const out = {};
  if (isObj(d.slots)) out.slots = idMap(d.slots);
  if (SPACINGS.includes(d.spacing)) out.spacing = d.spacing;
  if (isObj(d.hidden)) out.hidden = boolMap(d.hidden);
  if (isObj(d.settings)) out.settings = { ...d.settings };
  return out;
}
/** The app level: `use` (the Use skin switch), `inherit` (follow the hub-wide skin while off), the skin, its overrides and the colour theme picked inside it. */
function normalizeSkinState(raw) {
  const d = isObj(raw) ? raw : {};
  return withColor({ use: d.use === true, inherit: d.inherit === true, id: typeof d.id === 'string' && ID.test(d.id) ? d.id : '', overrides: idMap(d.overrides, NOT_OVERRIDES) }, colorPick(d));
}
/** A UI / plugin level: on | off | inherit (default inherit), the skin, its overrides and the colour theme picked inside it. */
export function normalizeScopeState(raw) {
  const d = isObj(raw) ? raw : {};
  return withColor({ use: SKIN_USES.includes(d.use) ? d.use : 'inherit', id: typeof d.id === 'string' && ID.test(d.id) ? d.id : '', overrides: idMap(d.overrides, NOT_OVERRIDES) }, colorPick(d));
}
/** A sub scope that says nothing: it inherits and is not kept in the document. */
const emptyScope = (st) => st.use === 'inherit' && !st.id && !Object.keys(st.overrides).length && !st.colorTheme;
function normalizeScopes(raw) {
  const out = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (isSubScopeKey(k)) { const st = normalizeScopeState(v); if (!emptyScope(st)) out[k] = st; }
  return out;
}

/** A new app-look: `snapshot` as the default, nothing picked, no skin, every scope inheriting. */
export function newAppLook(app, snapshot) {
  return { $axf: APP_LOOK_FRAME, app, default: normalizeLookPart(snapshot), own: {}, skin: { use: false, inherit: false, id: '', overrides: {} }, scopes: {}, undo: null };
}

export function normalizeAppLook(raw) {
  if (!isObj(raw) || raw.$axf !== APP_LOOK_FRAME || typeof raw.app !== 'string' || !isObj(raw.default)) return null;
  const out = newAppLook(raw.app, raw.default);
  out.own = normalizeLookPart(raw.own);
  out.skin = normalizeSkinState(raw.skin);
  out.scopes = normalizeScopes(raw.scopes);
  if (isObj(raw.undo)) out.undo = { own: normalizeLookPart(raw.undo.own), skin: normalizeSkinState(raw.undo.skin), scopes: normalizeScopes(raw.undo.scopes), at: String(raw.undo.at ?? '') };
  if (typeof raw.updatedBy === 'string') out.updatedBy = raw.updatedBy;
  if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt;
  return out;
}

export function parseAppLook(text) {
  if (!text || text.length > APP_LOOK_MAX_BYTES) return null;
  try { return normalizeAppLook(JSON.parse(text)); } catch { return null; }
}

/** Use skin on / off. Off keeps the picked skin and its overrides, so on again is the same look. */
export function setUseSkin(look, on) { return { ...look, skin: { ...look.skin, use: on } }; }
/** Follow the hub-wide skin while Use skin is off (Brett: "a switch to do it, but by default they're all their own"). */
export function setInheritSkin(look, on) { return { ...look, skin: { ...look.skin, inherit: on } }; }
/** Pick a skin: a different one starts with no overrides and its own colour theme; the same one keeps both. */
export function pickSkin(look, id) { return id === look.skin.id ? look : { ...look, skin: { ...withColor(look.skin, ''), id, overrides: {} } }; }
/**
 * Switch the colour theme inside the skin: `id` = a colour theme, '' / null = the skin's own. `key` = `app` (default)
 * or a `ui:` / `plugin:` scope. Only the level's `colorTheme` changes: the skin, its id and every other pick stay, and
 * nothing is created.
 */
export function setSkinColorTheme(look, id, key = SKIN_SCOPE_APP) {
  const pick = typeof id === 'string' && ID.test(id) ? id : '';
  if (key === SKIN_SCOPE_APP) return { ...look, skin: withColor(look.skin, pick) };
  if (!isSubScopeKey(key)) throw new Error(`"${key}" is not a ui: or plugin: scope`);
  const next = withColor(scopeState(look, key), pick);
  const scopes = { ...(look.scopes ?? {}) };
  if (emptyScope(next)) delete scopes[key]; else scopes[key] = next;
  return { ...look, scopes };
}
/** The colour theme picked inside the skin at a level ('' = the skin's own). */
export function skinColorTheme(look, key = SKIN_SCOPE_APP) {
  return (key === SKIN_SCOPE_APP ? look?.skin : look?.scopes?.[key])?.colorTheme ?? '';
}
/** Per-item "Back to skin" (the colour theme slot = back to the skin's own colours). */
export function backToSkin(look, slot) {
  if (slot === SKIN_COLOR_SLOT) return setSkinColorTheme(look, '');
  const overrides = { ...look.skin.overrides };
  delete overrides[slot];
  return { ...look, skin: { ...look.skin, overrides } };
}
/** Slots where a pick beats the skin (the "overridden" dot). Never the colour theme: switching it is not an override. */
export function overriddenSlots(look) { return look?.skin.use ? Object.keys(look.skin.overrides) : []; }
/** Back to the snapshot. What it replaced is kept as the one undo. Every scope goes back to inherit. */
export function restoreAppDefault(look, at) {
  return { ...look, own: {}, skin: { use: false, inherit: false, id: look.skin.id, overrides: {} }, scopes: {}, undo: { own: look.own, skin: look.skin, scopes: look.scopes ?? {}, at } };
}
/** Undo the last Restore; a second undo does nothing. */
export function undoRestore(look) { return look.undo ? { ...look, own: look.undo.own, skin: look.undo.skin, scopes: look.undo.scopes ?? {}, undo: null } : look; }
/**
 * A slot pick made from outside the app (control@1). A skin in force at the app level (Use skin on, or the app follows
 * the hub-wide skin `global`): the colour theme is switched inside the skin, any other slot is an override of that
 * part. No skin: the app's own.
 */
export function setLookSlot(look, slot, id, global = null) {
  if (look.skin.use || (look.skin.inherit && !!global?.id)) {
    if (slot === SKIN_COLOR_SLOT) return setSkinColorTheme(look, id);
    const overrides = { ...look.skin.overrides };
    if (id === null) delete overrides[slot]; else overrides[slot] = id;
    return { ...look, skin: { ...look.skin, overrides } };
  }
  const slots = { ...look.own.slots };
  if (id === null) delete slots[slot]; else slots[slot] = id;
  return { ...look, own: { ...look.own, slots } };
}

/* ---------------- scopes: a skin per UI / plugin, the hub-wide skin ---------------- */

/** The state of one scope key in a document (`app` = the app level, `ui:` / `plugin:` = a sub scope; `global` is not in the document). */
export function scopeState(look, key) {
  if (key === SKIN_SCOPE_APP) return withColor({ use: look.skin.use ? 'on' : look.skin.inherit ? 'inherit' : 'off', id: look.skin.id, overrides: look.skin.overrides }, look.skin.colorTheme);
  return isSubScopeKey(key) ? (look.scopes?.[key] ?? { use: 'inherit', id: '', overrides: {} }) : null;
}

/** Set a sub scope's skin: `use` on | off | inherit, `id` the skin (kept when omitted; a different one starts with no overrides and its own colour theme). Inherit with nothing else drops the entry. */
export function setScopeSkin(look, key, use, id) {
  if (!isSubScopeKey(key)) throw new Error(`"${key}" is not a ui: or plugin: scope`);
  const cur = scopeState(look, key);
  const other = !!id && id !== cur.id;
  const next = normalizeScopeState({ use, id: id ?? cur.id, overrides: other ? {} : cur.overrides, colorTheme: other ? '' : cur.colorTheme });
  const scopes = { ...(look.scopes ?? {}) };
  if (emptyScope(next)) delete scopes[key]; else scopes[key] = next;
  return { ...look, scopes };
}

/** A slot override on a sub scope (null drops it). The colour theme slot is the scope's colour theme, not an override. */
export function setScopeOverride(look, key, slot, id) {
  if (!isSubScopeKey(key)) throw new Error(`"${key}" is not a ui: or plugin: scope`);
  if (slot === SKIN_COLOR_SLOT) return setSkinColorTheme(look, id, key);
  const cur = scopeState(look, key);
  const overrides = { ...cur.overrides };
  if (id === null) delete overrides[slot]; else overrides[slot] = id;
  return { ...look, scopes: { ...(look.scopes ?? {}), [key]: { ...cur, overrides } } };
}

/** Every sub scope the document names, with its state. */
export function scopeEntries(look) {
  return Object.entries(look?.scopes ?? {}).map(([key, state]) => ({ key, ...state }));
}

/**
 * The skin in force at a place: the chain plugin → ui → app → global over this document and the hub-wide skin
 * (`global` = `{ id, overrides, colorTheme? }` from the shared appearance document, or null). `{ id, overrides, from }`,
 * plus `colorTheme` when a level picked one inside the skin; an empty id means no skin there.
 */
export function resolveLookSkin(look, global, scope) {
  const chain = skinScopeChain({ ...scope, app: look?.app ?? '' });
  return resolveSkinChain(chain, (key) => {
    if (key === SKIN_SCOPE_GLOBAL) return global?.id ? withColor({ use: 'on', id: global.id, overrides: global.overrides ?? {} }, global.colorTheme) : { use: 'off', id: '', overrides: {} };
    return look ? scopeState(look, key) : { use: 'off', id: '', overrides: {} };
  });
}
