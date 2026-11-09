/**
 * app-look@1 document rules (engines/skin.ts holds the skin@1 format and composing): plain JS, so the skins CLI, the
 * console server and the runtime change one app's look document the same way. Pure.
 *
 * Scopes (build skins-asset-types, Nov 2026): besides the app's own skin switch (`skin`), a document holds a skin state
 * per UI / screen and per plugin (`scopes["ui:<id>"]`, `scopes["plugin:<id>"]`, each `{ use: on | off | inherit, id,
 * overrides }`, default inherit) and a `skin.inherit` switch that lets the app follow the hub-wide skin (the global
 * level, kept on the shared appearance document). The chain for a place is plugin → ui → app → global; the child
 * overrides the parent (skin-coverage.mjs `resolveSkinChain`).
 */
import { isSubScopeKey, resolveSkinChain, skinScopeChain, SKIN_SCOPE_APP, SKIN_SCOPE_GLOBAL } from './skin-coverage.mjs';

export const APP_LOOK_FRAME = 'app-look@1';
export const APP_LOOK_PROJECT = 'shared';
export const APP_LOOK_MAX_BYTES = 64 * 1024;
export const appLookPath = (appId) => `settings/looks/${appId}.json`;
/** Slots a skin never sets. */
export const SKIN_NEVER = ['uac-policy', 'help', 'skin', 'design-package', 'interface'];
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
/** The app level: `use` (the Use skin switch), `inherit` (follow the hub-wide skin while off), the skin and its overrides. */
function normalizeSkinState(raw) {
  const d = isObj(raw) ? raw : {};
  return { use: d.use === true, inherit: d.inherit === true, id: typeof d.id === 'string' && ID.test(d.id) ? d.id : '', overrides: idMap(d.overrides, SKIN_NEVER) };
}
/** A UI / plugin level: on | off | inherit (default inherit), the skin and its overrides. */
export function normalizeScopeState(raw) {
  const d = isObj(raw) ? raw : {};
  return { use: SKIN_USES.includes(d.use) ? d.use : 'inherit', id: typeof d.id === 'string' && ID.test(d.id) ? d.id : '', overrides: idMap(d.overrides, SKIN_NEVER) };
}
function normalizeScopes(raw) {
  const out = {};
  if (isObj(raw)) for (const [k, v] of Object.entries(raw)) if (isSubScopeKey(k)) { const st = normalizeScopeState(v); if (st.use !== 'inherit' || st.id || Object.keys(st.overrides).length) out[k] = st; }
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
/** Pick a skin: a different one starts with no overrides. */
export function pickSkin(look, id) { return { ...look, skin: { ...look.skin, id, overrides: id === look.skin.id ? look.skin.overrides : {} } }; }
/** Per-item "Back to skin". */
export function backToSkin(look, slot) {
  const overrides = { ...look.skin.overrides };
  delete overrides[slot];
  return { ...look, skin: { ...look.skin, overrides } };
}
/** Slots where a pick beats the skin (the "overridden" dot). */
export function overriddenSlots(look) { return look?.skin.use ? Object.keys(look.skin.overrides) : []; }
/** Back to the snapshot. What it replaced is kept as the one undo. Every scope goes back to inherit. */
export function restoreAppDefault(look, at) {
  return { ...look, own: {}, skin: { use: false, inherit: false, id: look.skin.id, overrides: {} }, scopes: {}, undo: { own: look.own, skin: look.skin, scopes: look.scopes ?? {}, at } };
}
/** Undo the last Restore; a second undo does nothing. */
export function undoRestore(look) { return look.undo ? { ...look, own: look.undo.own, skin: look.undo.skin, scopes: look.undo.scopes ?? {}, undo: null } : look; }
/** A slot pick made from outside the app (control@1): skin on = an override of that part, skin off = the app's own. */
export function setLookSlot(look, slot, id) {
  if (look.skin.use) {
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
  if (key === SKIN_SCOPE_APP) return { use: look.skin.use ? 'on' : look.skin.inherit ? 'inherit' : 'off', id: look.skin.id, overrides: look.skin.overrides };
  return isSubScopeKey(key) ? (look.scopes?.[key] ?? { use: 'inherit', id: '', overrides: {} }) : null;
}

/** Set a sub scope's skin: `use` on | off | inherit, `id` the skin (kept when omitted). Inherit with nothing else drops the entry. */
export function setScopeSkin(look, key, use, id) {
  if (!isSubScopeKey(key)) throw new Error(`"${key}" is not a ui: or plugin: scope`);
  const cur = scopeState(look, key);
  const next = normalizeScopeState({ use, id: id ?? cur.id, overrides: id && id !== cur.id ? {} : cur.overrides });
  const scopes = { ...(look.scopes ?? {}) };
  if (next.use === 'inherit' && !next.id && !Object.keys(next.overrides).length) delete scopes[key]; else scopes[key] = next;
  return { ...look, scopes };
}

/** A slot override on a sub scope (null drops it). */
export function setScopeOverride(look, key, slot, id) {
  if (!isSubScopeKey(key)) throw new Error(`"${key}" is not a ui: or plugin: scope`);
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
 * (`global` = `{ id, overrides }` from the shared appearance document, or null). `{ id, overrides, from }`; an empty id
 * means no skin there.
 */
export function resolveLookSkin(look, global, scope) {
  const chain = skinScopeChain({ ...scope, app: look?.app ?? '' });
  return resolveSkinChain(chain, (key) => {
    if (key === SKIN_SCOPE_GLOBAL) return global?.id ? { use: 'on', id: global.id, overrides: global.overrides ?? {} } : { use: 'off', id: '', overrides: {} };
    return look ? scopeState(look, key) : { use: 'off', id: '', overrides: {} };
  });
}
