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
import { isSubScopeKey, resolveSkinChain, skinScopeChain, SKIN_SCOPE_APP, SKIN_SCOPE_DEFAULT, SKIN_SCOPE_GLOBAL } from './skin-coverage.mjs';
import { CHROME_INSTANCE_KEY, CHROME_SETTINGS_PICK_KEY, CHROME_TYPES, isChromeInstanceId, normalizeInstanceOverride } from './chrome-settings-rules.mjs';

export const APP_LOOK_FRAME = 'app-look@1';
/**
 * Backups (build console-look-becomes-default-axhub-skin, Nov 14 2026): before an app is moved onto the hub default
 * skin, what it drew (own picks, skin state, scopes) is kept in the document under `backups`, newest first, so Restore
 * from backup can bring it back. At most this many are kept; an older one falls off the end.
 */
export const LOOK_BACKUPS_MAX = 5;
export const APP_LOOK_PROJECT = 'shared';
export const APP_LOOK_MAX_BYTES = 64 * 1024;
export const appLookPath = (appId) => `settings/looks/${appId}.json`;
/** Slots a skin never sets. */
export const SKIN_NEVER = ['uac-policy', 'help', 'skin', 'design-package', 'interface'];
/** The section of a skin that is switched on its own: the colour theme slot. Kept as `colorTheme`, never in `overrides`. */
export const SKIN_COLOR_SLOT = 'color-theme';
/** The three per-level choices. */
export const SKIN_USES = ['on', 'off', 'inherit'];
/**
 * The skin's four sections → the asset type that holds a section's presets (skins only, Nov 10 2026, Brett: "remove all
 * the styling and theme and layout stuff … the new thing's going to override it"): colour, style, layout and behaviour
 * themes are no longer picked on their own; they are the sections of a skin. Same names as skin@2 (PR #430).
 */
export const SKIN_SECTIONS = { colors: 'color-theme', style: 'style-theme', layout: 'layout', behavior: 'behavior-theme' };
/** Section → the skin field that names its preset. */
export const SKIN_SECTION_FIELDS = { colors: 'colorTheme', style: 'styleTheme', layout: 'layoutTheme', behavior: 'behaviorTheme' };
/** The one section a user still swaps inside a skin (the theme switch, "Next colour theme"): the skin and its colour theme. */
export const SKIN_SWAPPABLE_SECTION = 'color-theme';
/**
 * The retired bundle types a skin replaced: a slot or setting naming one reads as the skin of the same id. A style
 * package (one matched set of controls) is not here yet: it becomes a skin when skin@2 lands (PR #430); until then it
 * stays a swappable set of control slots.
 */
export const RETIRED_PACKAGE_TYPES = ['design-package', 'appearance-package'];
/** The scale picks (density / sizing / typography): the skin's `assets` name them; they are never picked on their own. */
export const SKIN_SCALE_TYPES = ['typography', 'density', 'sizing'];
export const isSkinSectionType = (type) => Object.values(SKIN_SECTIONS).includes(type);
export const sectionOfType = (type) => Object.keys(SKIN_SECTIONS).find((s) => SKIN_SECTIONS[s] === type) ?? '';
/** Every slot a skin sets: its `assets` plus the four section presets (a named section wins over an `assets` entry of that type). */
export function skinSlotMap(skin) {
  const out = { ...(skin?.assets ?? {}) };
  for (const s of ['layout', 'colors', 'style', 'behavior']) { const v = skin?.[SKIN_SECTION_FIELDS[s]]; if (typeof v === 'string' && v) out[SKIN_SECTIONS[s]] = v; }
  return out;
}

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

/* ---------------- the skin's chrome block (skin@1 `chrome`, chrome-settings@1) ---------------- */

/**
 * How one chrome kind is set up under a skin (build console-look-becomes-default-axhub-skin, Nov 14 2026):
 * `chrome: { <kind>: { interface?, instances? } }` for the chrome-settings@1 kinds (tab-group, toolbar, banner,
 * nav-menu, app-menu, context-menu). `interface` = the settings interface the kind's dialog renders through
 * (`axf.chrome.settings.<kind>`); `instances` = field overrides per instance over the active asset
 * (`axf.chrome.<kind>.<instance>`, only the kind's CHROME_FIELDS, cleaned the way the dialog saves them). Kept: known
 * kinds, an id that passes, instances with at least one valid field. Plain JS so the build engine validates the same.
 */
export function normalizeSkinChrome(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [type, v] of Object.entries(raw)) {
    if (!CHROME_TYPES.includes(type) || !isObj(v)) continue;
    const kind = {};
    if (typeof v.interface === 'string' && ID.test(v.interface)) kind.interface = v.interface;
    if (isObj(v.instances)) {
      const instances = {};
      for (const [inst, fields] of Object.entries(v.instances)) {
        if (!isChromeInstanceId(inst)) continue;
        const n = normalizeInstanceOverride(type, fields);
        if (Object.keys(n).length) instances[inst] = n;
      }
      if (Object.keys(instances).length) kind.instances = instances;
    }
    if (Object.keys(kind).length) out[type] = kind;
  }
  return out;
}

/** Validation messages for a skin's `chrome` block (the TS engine and the build engine push the same lines). */
export function skinChromeErrors(raw) {
  if (raw === undefined) return [];
  if (!isObj(raw)) return ['data.chrome must be an object (chrome kind → { interface, instances })'];
  const out = [];
  for (const [type, v] of Object.entries(raw)) {
    if (!CHROME_TYPES.includes(type)) { out.push(`data.chrome.${type}: not a chrome kind (${CHROME_TYPES.join(', ')})`); continue; }
    if (!isObj(v)) { out.push(`data.chrome.${type} must be an object`); continue; }
    if ('interface' in v && (typeof v.interface !== 'string' || !ID.test(v.interface))) out.push(`data.chrome.${type}.interface must be a settings asset id`);
    if ('instances' in v) {
      if (!isObj(v.instances)) out.push(`data.chrome.${type}.instances must be an object (instance → fields)`);
      else for (const [inst, fields] of Object.entries(v.instances)) {
        if (!isChromeInstanceId(inst)) out.push(`data.chrome.${type}.instances: "${inst}" is not an instance id`);
        else if (!isObj(fields) || !Object.keys(normalizeInstanceOverride(type, fields)).length) out.push(`data.chrome.${type}.instances.${inst}: no valid ${type} field (chrome-settings@1)`);
      }
    }
  }
  return out;
}

/** The settings a skin's chrome block puts in force: the interface pick per kind, the field overrides per instance. */
export function skinChromeSettings(chrome) {
  const out = {};
  for (const [type, kind] of Object.entries(chrome ?? {})) {
    if (kind.interface) out[CHROME_SETTINGS_PICK_KEY(type)] = kind.interface;
    for (const [inst, fields] of Object.entries(kind.instances ?? {})) out[CHROME_INSTANCE_KEY(type, inst)] = { ...fields };
  }
  return out;
}

/** The hidden-assets@1 list of a look part (`hiddenAssets`): the field and its cap, as in engines/hidden-assets.ts. */
const HIDDEN_ASSETS_FIELD = 'hiddenAssets';
const HIDDEN_ASSETS_MAX = 500;

/**
 * Keep what a look holds: slots, spacing, chrome, look settings and the hidden pieces (hidden-assets@1). The hidden list is
 * carried through every writer as saved (entries with a kind and an id, newest 500); engines/hidden-assets.ts checks the
 * kinds and ids when it reads. An empty list is not written, so a document with nothing hidden stays as it was.
 */
export function normalizeLookPart(raw) {
  const d = isObj(raw) ? raw : {};
  const out = {};
  if (isObj(d.slots)) out.slots = idMap(d.slots);
  if (SPACINGS.includes(d.spacing)) out.spacing = d.spacing;
  if (isObj(d.hidden)) out.hidden = boolMap(d.hidden);
  if (isObj(d.settings)) out.settings = { ...d.settings };
  if (Array.isArray(d[HIDDEN_ASSETS_FIELD])) {
    const list = d[HIDDEN_ASSETS_FIELD].filter((e) => isObj(e) && typeof e.kind === 'string' && typeof e.id === 'string').slice(-HIDDEN_ASSETS_MAX).map((e) => ({ ...e }));
    if (list.length) out[HIDDEN_ASSETS_FIELD] = list;
  }
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

/**
 * One backup record: `{ id, at, by, reason, own, skin, scopes }`, what the app drew before a move (the same three parts
 * the undo record keeps). `id` names it for Restore from backup (defaults to `at`); a record without a time is dropped.
 */
export function normalizeLookBackup(raw) {
  if (!isObj(raw)) return null;
  const at = String(raw.at ?? '');
  if (!at) return null;
  return { id: String(raw.id || at), at, by: String(raw.by ?? ''), reason: String(raw.reason ?? '').slice(0, 200), own: normalizeLookPart(raw.own), skin: normalizeSkinState(raw.skin), scopes: normalizeScopes(raw.scopes) };
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
  if (isObj(raw.undo)) {
    out.undo = { own: normalizeLookPart(raw.undo.own), skin: normalizeSkinState(raw.undo.skin), scopes: normalizeScopes(raw.undo.scopes), at: String(raw.undo.at ?? '') };
    // skin-switch@1: the action and scope that left the record (the Undo label), and the hub-wide skin before a hub switch
    if (typeof raw.undo.action === 'string' && raw.undo.action) out.undo.action = raw.undo.action;
    if (typeof raw.undo.scope === 'string' && raw.undo.scope) out.undo.scope = raw.undo.scope;
    if (out.undo.scope === 'hub' && 'global' in raw.undo) {
      const g = raw.undo.global;
      out.undo.global = isObj(g) && typeof g.id === 'string' && ID.test(g.id) ? withColor({ id: g.id, overrides: idMap(g.overrides, [SKIN_COLOR_SLOT]) }, colorPick(g)) : null;
    }
  }
  // skins only (look-migration@1): the one-run stamp and the backup of what the fold moved; kept through every writer
  if (isObj(raw.migrated) && Number.isFinite(Number(raw.migrated.version))) {
    out.migrated = { version: Math.max(0, Math.floor(Number(raw.migrated.version))), at: String(raw.migrated.at ?? ''), by: String(raw.migrated.by ?? '') };
    const kept = Array.isArray(raw.migrated.kept) ? raw.migrated.kept.filter((t) => typeof t === 'string' && ID.test(t)) : [];
    if (kept.length) out.migrated.kept = kept;
  }
  if (isObj(raw.legacy)) {
    const legacy = { at: String(raw.legacy.at ?? '') };
    if (isObj(raw.legacy.own)) legacy.own = normalizeLookPart(raw.legacy.own);
    if (isObj(raw.legacy.settings)) legacy.settings = { ...raw.legacy.settings };
    out.legacy = legacy;
  }
  // the per-app backups taken before a move onto the hub default skin: kept through every writer, newest first, capped
  if (Array.isArray(raw.backups)) {
    const backups = raw.backups.map(normalizeLookBackup).filter(Boolean).slice(0, LOOK_BACKUPS_MAX);
    if (backups.length) out.backups = backups;
  }
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
/**
 * The look drawn while an app takes its skin from axHub only (Settings → Appearance → "Get my skin only from axHub"):
 * the hub-wide skin, with the colour theme axHub picked inside it, over the app's default snapshot. The app's own picks,
 * its Use skin switch, skin, overrides and colour theme pick, and every UI / plugin scope are left out of what is drawn;
 * they stay in the stored document (this only builds the document to compose), so switching back shows them again.
 * The undo and migration stamps ride along unchanged. null stays null.
 */
export function hubOnlyLook(look) {
  if (!look) return look;
  return { ...look, own: {}, skin: { use: false, inherit: true, id: '', overrides: {} }, scopes: {} };
}
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

/* ---------------- the hub default skin: adopt it, back up, restore from backup ---------------- */

/** The three parts a backup (and the undo record) keeps. */
const partsOf = (look) => ({ own: look.own, skin: look.skin, scopes: look.scopes ?? {} });
const sameParts = (a, b) => JSON.stringify(partsOf(a)) === JSON.stringify(partsOf(b));

/**
 * Keep what the app draws now as a backup: `{ id, at, by, reason, own, skin, scopes }` at the head of `backups`,
 * capped at LOOK_BACKUPS_MAX (the oldest falls off). `meta` = `{ at, by?, reason?, id? }` (`id` defaults to `at`).
 * A backup identical to the newest one is not added twice.
 */
export function backupLook(look, meta) {
  const at = String(meta?.at ?? '');
  if (!at) throw new Error('backupLook needs the time (at)');
  const rec = normalizeLookBackup({ id: meta?.id, at, by: meta?.by, reason: meta?.reason, ...partsOf(look) });
  const cur = look.backups ?? [];
  if (cur[0] && sameParts(cur[0], rec)) return look;
  return { ...look, backups: [rec, ...cur].slice(0, LOOK_BACKUPS_MAX) };
}

/** The backup named `id`, or the newest when `id` is empty; null when there is none. */
export function lookBackup(look, id = '') {
  const all = look?.backups ?? [];
  return (id ? all.find((b) => b.id === id) : all[0]) ?? null;
}

/**
 * Move the app onto the hub default skin (Brett, Nov 14 2026: "make all the apps inherit it right now"), keeping only
 * what was edited: a backup of what it drew is taken first; then Use skin goes off (the picked skin id stays, so Use
 * skin on brings it back), the overrides and colour pick made under that skin become the app's own picks (they were
 * edits: skin-axhub-override rule), Follow goes off, every UI / plugin scope goes back to inherit, and one undo is left
 * (`adopt-default`). Own picks stay as they are: they are the edits drawn over the floor. An app that already stands on
 * the floor with nothing to move is returned unchanged (no backup, no undo).
 */
export function adoptHubDefault(look, meta) {
  const at = String(meta?.at ?? '');
  if (!at) throw new Error('adoptHubDefault needs the time (at)');
  const skin = look.skin;
  const moving = skin.use || skin.inherit || Object.keys(look.scopes ?? {}).length > 0;
  if (!moving) return look;
  const slots = { ...(look.own.slots ?? {}) };
  if (skin.use) {
    Object.assign(slots, skin.overrides);
    if (skin.colorTheme) slots[SKIN_COLOR_SLOT] = skin.colorTheme;
  }
  const own = Object.keys(slots).length ? { ...look.own, slots } : look.own;
  const backed = backupLook(look, { at, by: meta?.by, reason: meta?.reason ?? 'before the hub default skin', id: meta?.id });
  return { ...backed, own, skin: { use: false, inherit: false, id: skin.id, overrides: {} }, scopes: {}, undo: { ...partsOf(look), at, action: 'adopt-default', scope: `app:${look.app}` } };
}

/**
 * Restore from backup: the backup named `id` (the newest when empty) puts its own picks, skin state and scopes back;
 * the list of backups is kept and one undo is left (`restore-backup`). No such backup = unchanged.
 */
export function restoreLookBackup(look, id, at) {
  const b = lookBackup(look, id);
  if (!b) return look;
  const stamp = String(at ?? '');
  if (!stamp) throw new Error('restoreLookBackup needs the time (at)');
  return { ...look, own: b.own, skin: b.skin, scopes: b.scopes ?? {}, undo: { ...partsOf(look), at: stamp, action: 'restore-backup', scope: `app:${look.app}` } };
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
 * The skin in force at a place: the chain plugin → ui → app → global → default over this document, the hub-wide skin
 * (`global` = `{ id, overrides, colorTheme? }` from the shared appearance document, or null) and the hub default skin
 * (`hubDefault`, same shape, the `defaultSkin` pointer of that document, or null). `{ id, overrides, from }`, plus
 * `colorTheme` when a level picked one inside the skin; an empty id means no skin there.
 *
 * Resolve order with a hub default (Brett, Nov 14 2026: "make all the apps inherit it right now"):
 *   default  the hub default skin, always on: the floor every app stands on
 *   app      Use skin on = the app's own skin, as before. Use skin off and not following = nothing picked here: the
 *            app inherits the floor (`from: 'default'`), never the hub-wide skin (that still takes Follow); its own
 *            picks are the edits drawn over the floor (composeLookAt), not part of `overrides`. The colour theme kept
 *            beside its switched-off skin stays with that skin and does not leak onto the floor.
 *   global   the hub-wide skin while the app follows it; with none to follow, the floor
 *   ui / plugin  as before: on = its own skin, inherit = the parent, off = no skin inside it (an explicit choice, so
 *            it stands below the floor on the app's saved look)
 * Without a hub default nothing changes: an app with Use skin off draws its own saved look (`from: 'app'`).
 */
export function resolveLookSkin(look, global, scope, hubDefault = null) {
  const chain = skinScopeChain({ ...scope, app: look?.app ?? '' });
  const floor = !!(hubDefault && typeof hubDefault.id === 'string' && ID.test(hubDefault.id));
  const pointer = (p) => withColor({ use: 'on', id: p.id, overrides: p.overrides ?? {} }, p.colorTheme);
  const off = () => ({ use: 'off', id: '', overrides: {} });
  const follows = !!look?.skin?.inherit;
  return resolveSkinChain(chain, (key) => {
    if (key === SKIN_SCOPE_DEFAULT) return floor ? pointer(hubDefault) : off();
    if (key === SKIN_SCOPE_GLOBAL) {
      if (global?.id && (follows || !floor)) return pointer(global);
      return floor ? { use: 'inherit' } : off();
    }
    // no look document yet: with a floor every level of the app inherits it; without one, nothing is drawn (as before)
    if (!look) return floor ? { use: 'inherit' } : off();
    const st = scopeState(look, key);
    if (key === SKIN_SCOPE_APP && st.use === 'off' && floor) return { use: 'inherit' };
    return st;
  });
}
