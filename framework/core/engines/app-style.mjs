/**
 * App style override (app-style@1, build app-style-override; Brett, Nov 3 2026: "Put a button in each app's settings
 * to override axHub's style, in design and colors." … "And the hook will reload axHub, and you can also save design
 * back to axHub."). axHub's look (the shared appearance@1 document, APPEARANCE-SOURCE.md) is the default style of every
 * app; each app may override two parts of it, on top of the generic inherit@1 rule (engines/inherit.mjs):
 *
 *   design   the style theme (radius, density, fonts, shadows, blur, motion) and its token overrides
 *   colors   the colour theme and its token overrides
 *
 * (a design package names both, so picking one in an inheriting app overrides both). Where an app's choice lives:
 * the same shared document, one look setting per app, so it follows the app to every device and the console's REST /
 * MCP / CLI can read and change it:
 *
 *   settings["axf.appearance.app.<app id>"] = { $axf: 'app-style@1', design?: true, colors?: true,
 *                                               own: { slots: { 'style-theme': id, … }, keys: { 'axf.tokens.style': {…}, … } },
 *                                               by?, at? }
 *
 * Inheriting part = the app shows axHub's values and never writes that part. Overriding part = the app keeps its own
 * values (`own`), never applies axHub's for it and never pushes it. Editing a value of an inheriting part switches the
 * part on (the "Overriding axHub" note), except in the style source itself (axHub's own pages), whose edits are
 * axHub's look. **Save to axHub** writes an app's own values of the chosen parts as the new default (owner only),
 * after keeping the previous one in a short history (`axf.appearance.history`) for **Restore previous axHub style**.
 *
 * Pure (no IO, no DOM): the runtime (core/runtime.ts) and the console's App style plugin (REST, MCP, CLI) share it.
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { normalizeParts, partsOf, normalizeFlags, overriding, autoOverride } from './inherit.mjs';

export const APP_STYLE_FRAME = 'app-style@1';
export const APP_STYLE_PREFIX = 'axf.appearance.app.';
export const APP_STYLE_HISTORY_KEY = 'axf.appearance.history';
export const APP_STYLE_HISTORY_MAX = 5;
/** The appearance engine's per-setting cap (engines/appearance.ts APPEARANCE_SETTING_MAX_BYTES). */
export const APP_STYLE_SETTING_MAX = 4 * 1024;
/** The design package's own overrides of its style / colour theme (engines/designpackage.ts DESIGN_OVERRIDES_KEY). */
export const APP_STYLE_PACKAGE_OVERRIDES = 'axf.appearance.overrides';
const PACKAGE = 'design-package';

export const APP_STYLE_PARTS = normalizeParts([
  { id: 'design', label: 'Design', detail: 'Style theme: corners, density, fonts, shadows, blur and motion', slots: ['style-theme', PACKAGE], keys: ['axf.tokens.style', 'axf.tokens.typography', 'axf.tokens.density', 'axf.tokens.sizing'] },
  { id: 'colors', label: 'Colours', detail: 'Colour theme', slots: ['color-theme', PACKAGE], keys: ['axf.tokens.theme'] },
]);
export const APP_STYLE_PART_IDS = APP_STYLE_PARTS.map((p) => p.id);

/** The apps whose own edits are axHub's look (they never override it). Open registry. */
const SOURCES = ['axhub-web'];
export function registerStyleSource(appId) { if (typeof appId === 'string' && appId && !SOURCES.includes(appId)) SOURCES.push(appId); }
export const isStyleSource = (appId) => SOURCES.includes(appId);

/** Apps that follow axHub's look (the Save to axHub confirm lists the ones that will change). Open registry. */
export const APP_STYLE_APPS = [
  { id: 'axf-console', label: 'Dev Console' },
  { id: 'axhub-web', label: 'axHub' },
  { id: 'molly', label: 'Molly' },
  { id: 'amberx-droid', label: 'AmberX' },
  { id: 'walkthrough-studio', label: 'Walkthrough Studio' },
];
export function registerStyleApp(id, label) {
  if (typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && !APP_STYLE_APPS.some((a) => a.id === id)) APP_STYLE_APPS.push({ id, label: typeof label === 'string' && label ? label : id });
}

export const appStyleKey = (appId) => `${APP_STYLE_PREFIX}${appId}`;
export const isAppStyleKey = (key) => typeof key === 'string' && (key.startsWith(APP_STYLE_PREFIX) || key === APP_STYLE_HISTORY_KEY);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const fits = (v) => { try { return JSON.stringify(v).length <= APP_STYLE_SETTING_MAX; } catch { return false; } };

/** Every slot / key the parts cover. */
const ALL_SLOTS = [...new Set(APP_STYLE_PARTS.flatMap((p) => p.slots))];
const ALL_KEYS = [...new Set(APP_STYLE_PARTS.flatMap((p) => p.keys))];
export const appStyleSlotParts = (slot) => partsOf(APP_STYLE_PARTS, 'slot', slot);
export const appStyleKeyParts = (key) => partsOf(APP_STYLE_PARTS, 'key', key);

/** An app's saved choice, cleaned (anything malformed dropped; never throws). */
export function normalizeAppStyle(raw) {
  const r = isObj(raw) ? raw : {};
  const flags = normalizeFlags(r, APP_STYLE_PARTS);
  const own = { slots: {}, keys: {} };
  if (isObj(r.own)) {
    if (isObj(r.own.slots)) for (const s of ALL_SLOTS) { const v = r.own.slots[s]; if (typeof v === 'string' && ID.test(v)) own.slots[s] = v; }
    if (isObj(r.own.keys)) for (const k of ALL_KEYS) { const v = r.own.keys[k]; if (v !== undefined && v !== null) own.keys[k] = v; }
  }
  const out = { $axf: APP_STYLE_FRAME, ...flags, own };
  if (typeof r.by === 'string' && r.by) out.by = r.by.slice(0, 80);
  if (typeof r.at === 'string' && r.at) out.at = r.at.slice(0, 40);
  return out;
}

/** The app's choice as the document holds it. */
export const appStyleOf = (doc, appId) => normalizeAppStyle(doc?.settings?.[appStyleKey(appId)]);

/** The override flags of a choice (`{ design: true }` …). */
export const appStyleFlags = (style) => normalizeFlags(style, APP_STYLE_PARTS);

/** Is a slot / key held by this app (its part overrides)? The design package's own overrides are held when any part is. */
export function heldSlot(style, slot) { return overriding(appStyleFlags(style), appStyleSlotParts(slot)); }
export function heldKey(style, key) {
  const f = appStyleFlags(style);
  if (key === APP_STYLE_PACKAGE_OVERRIDES) return Object.keys(f).length > 0;
  return overriding(f, appStyleKeyParts(key));
}

/** The choice as written back: empty own lists and no override = null (the key is cleared). */
export function serializeAppStyle(style, by, at) {
  const s = normalizeAppStyle(style);
  const flags = appStyleFlags(s);
  const own = { slots: {}, keys: {} };
  // own values are kept only for parts that override (switching a part off forgets them)
  for (const [k, v] of Object.entries(s.own.slots)) if (heldSlot(s, k)) own.slots[k] = v;
  for (const [k, v] of Object.entries(s.own.keys)) if (heldKey(s, k)) own.keys[k] = v;
  if (!Object.keys(flags).length) return null;
  let out = { $axf: APP_STYLE_FRAME, ...flags, own, ...(by ? { by: String(by).slice(0, 80) } : {}), ...(at ? { at } : {}) };
  // too big for one look setting: token overrides go first (the themes are kept)
  if (!fits(out)) out = { ...out, own: { slots: own.slots, keys: {} } };
  return out;
}

/** Switch a part's override on (own = the app's current values of that part) or off (own forgotten). */
export function withPartOverride(style, part, on, current = {}) {
  const s = normalizeAppStyle(style);
  const p = APP_STYLE_PARTS.find((x) => x.id === part);
  if (!p) return s;
  const next = normalizeAppStyle({ ...s, [part]: on === true });
  if (!on) delete next[part];
  if (on) {
    for (const slot of p.slots) if (typeof current.slots?.[slot] === 'string' && current.slots[slot]) next.own.slots[slot] = current.slots[slot];
    for (const key of p.keys) if (current.keys?.[key] !== undefined && current.keys[key] !== null) next.own.keys[key] = current.keys[key];
  }
  return normalizeAppStyle(serializeAppStyle(next) ?? {});
}

/**
 * A local look change on its way to axHub, filtered by this app's choice (the runtime's pushAppearance). Slots and
 * keys of overriding parts stay in the app (recorded as its own values); an edit of an inheriting part switches the
 * part on first (unless the app is the style source); the palette goes only while the colours inherit.
 * Returns the change to push, the new choice and the parts switched on now.
 */
export function filterLookChange(change, style, { isSource = false } = {}) {
  let s = normalizeAppStyle(style);
  const touched = [];
  for (const [slot, v] of Object.entries(change?.slots ?? {})) if (v !== null && v !== undefined && ALL_SLOTS.includes(slot)) touched.push({ kind: 'slot', name: slot });
  for (const [key, v] of Object.entries(change?.settings ?? {})) if (ALL_KEYS.includes(key) && v !== undefined) touched.push({ kind: 'key', name: key });
  const auto = autoOverride(APP_STYLE_PARTS, appStyleFlags(s), touched, { isSource });
  if (auto.switched.length) s = normalizeAppStyle({ ...s, ...auto.flags });
  const out = { ...change };
  let changed = auto.switched.length > 0;
  if (change?.slots) {
    const slots = { ...change.slots };
    for (const [slot, v] of Object.entries(change.slots)) {
      if (!heldSlot(s, slot)) continue;
      delete slots[slot];
      if (typeof v === 'string' && v) { if (s.own.slots[slot] !== v) { s.own.slots[slot] = v; changed = true; } }
      else if (slot in s.own.slots) { delete s.own.slots[slot]; changed = true; }
    }
    if (Object.keys(slots).length) out.slots = slots; else delete out.slots;
  }
  if (change?.settings) {
    const settings = { ...change.settings };
    for (const [key, v] of Object.entries(change.settings)) {
      if (!heldKey(s, key)) continue;
      delete settings[key];
      if (key === APP_STYLE_PACKAGE_OVERRIDES) continue; // the package's own bookkeeping: local while any part overrides
      if (v === null || v === undefined) { if (key in s.own.keys) { delete s.own.keys[key]; changed = true; } }
      else if (JSON.stringify(s.own.keys[key]) !== JSON.stringify(v)) { s.own.keys[key] = v; changed = true; }
    }
    if (Object.keys(settings).length) out.settings = settings; else delete out.settings;
  }
  if (out.palette && appStyleFlags(s).colors) delete out.palette;
  return { change: out, style: s, switched: auto.switched, changed };
}

/** Is a filtered change empty (nothing left to push)? */
export const emptyLookChange = (c) => !c || !['slots', 'settings', 'hidden', 'spacing', 'palette'].some((k) => c[k] !== undefined && (typeof c[k] !== 'object' || Object.keys(c[k]).length > 0));

/** axHub's values for every slot / key the parts cover (`resolve(slot)` = the slot in force under the document). */
export function hubStyleValues(doc, resolve = (slot) => doc?.slots?.[slot]) {
  const slots = {};
  const keys = {};
  for (const s of ALL_SLOTS) { const v = resolve(s); if (v) slots[s] = v; }
  for (const k of ALL_KEYS) { const v = doc?.settings?.[k]; if (v !== undefined && v !== null) keys[k] = v; }
  return { slots, keys };
}

/** The apps a Save to axHub of `parts` changes: every known app that inherits at least one of them. */
export function appsFollowing(doc, parts, apps = APP_STYLE_APPS) {
  const want = parts.filter((p) => APP_STYLE_PART_IDS.includes(p));
  return apps.filter((a) => isStyleSource(a.id) || want.some((p) => !appStyleFlags(appStyleOf(doc, a.id))[p]));
}

/** The saved history (newest last), cleaned. */
export function styleHistory(doc) {
  const raw = doc?.settings?.[APP_STYLE_HISTORY_KEY];
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((e) => isObj(e) && typeof e.at === 'string' && Array.isArray(e.parts)).map((e) => ({
    at: e.at, by: typeof e.by === 'string' ? e.by : '', app: typeof e.app === 'string' ? e.app : '',
    parts: e.parts.filter((p) => APP_STYLE_PART_IDS.includes(p)),
    slots: isObj(e.slots) ? Object.fromEntries(Object.entries(e.slots).filter(([k, v]) => ALL_SLOTS.includes(k) && (v === null || (typeof v === 'string' && ID.test(v))))) : {},
    keys: isObj(e.keys) ? Object.fromEntries(Object.entries(e.keys).filter(([k]) => ALL_KEYS.includes(k) || k === APP_STYLE_PACKAGE_OVERRIDES)) : {},
  }));
}

/** History with one more entry, trimmed (oldest first) to the cap and the per-setting size. */
function pushHistory(doc, entry) {
  let list = [...styleHistory(doc), entry].slice(-APP_STYLE_HISTORY_MAX);
  while (list.length > 1 && !fits(list)) list = list.slice(1);
  if (!fits(list)) list = [{ ...entry, keys: {} }]; // one entry still too big: keep its themes
  return list;
}

/**
 * Save an app's own values of `parts` to axHub as the new default. `own` = the values the app shows now
 * (`{ slots, keys }`); axHub's current values go into the history first. Returns the appearance change
 * to write: the themes (also recorded as the package's overrides, so a loaded design package doesn't beat them),
 * the token overrides, and the history entry that Restore takes back.
 */
export function saveToHubChange(doc, parts, own, { appId = '', by = '', at = new Date().toISOString() } = {}) {
  const want = parts.filter((p) => APP_STYLE_PART_IDS.includes(p));
  if (!want.length) throw new Error('nothing to save: pick design, colours or both');
  const slots = {};
  const settings = {};
  const prev = { slots: {}, keys: {} };
  const pkgOver = isObj(doc?.settings?.[APP_STYLE_PACKAGE_OVERRIDES]) ? { ...doc.settings[APP_STYLE_PACKAGE_OVERRIDES] } : {};
  prev.keys[APP_STYLE_PACKAGE_OVERRIDES] = doc?.settings?.[APP_STYLE_PACKAGE_OVERRIDES] ?? null;
  for (const id of want) {
    const p = APP_STYLE_PARTS.find((x) => x.id === id);
    for (const slot of p.slots) {
      if (slot === PACKAGE) continue; // the package stays axHub's; the theme beats it through the overrides
      const v = own.slots?.[slot];
      prev.slots[slot] = doc?.slots?.[slot] ?? null;
      if (typeof v === 'string' && ID.test(v)) { slots[slot] = v; pkgOver[slot] = v; }
    }
    for (const key of p.keys) {
      prev.keys[key] = doc?.settings?.[key] ?? null;
      settings[key] = own.keys?.[key] ?? null;
    }
  }
  settings[APP_STYLE_PACKAGE_OVERRIDES] = Object.keys(pkgOver).length ? pkgOver : null;
  settings[APP_STYLE_HISTORY_KEY] = pushHistory(doc, { at, by: String(by).slice(0, 80), app: appId, parts: want, slots: prev.slots, keys: prev.keys });
  const change = { slots, settings };
  if (!Object.keys(slots).length) delete change.slots;
  return { change, parts: want };
}

/** Take back the newest saved style: the change that restores it (and drops it from the history), or null when none. */
export function restorePreviousChange(doc) {
  const list = styleHistory(doc);
  const last = list[list.length - 1];
  if (!last) return null;
  const slots = {};
  for (const [k, v] of Object.entries(last.slots)) slots[k] = v ?? null;
  const settings = { ...last.keys };
  settings[APP_STYLE_HISTORY_KEY] = list.length > 1 ? list.slice(0, -1) : null;
  return { change: { slots, settings }, entry: last };
}

/**
 * One app's style as a settings screen or the API shows it: per part, whether it overrides, axHub's value and the
 * app's own beside it. `hub` = hubStyleValues(doc, …), `current` = the values the app shows now (the runtime's), or
 * the saved own values when the caller can't see the app (the server).
 */
export function appStyleView(doc, appId, hub, current) {
  const style = appStyleOf(doc, appId);
  const flags = appStyleFlags(style);
  return {
    $axf: APP_STYLE_FRAME,
    app: appId,
    source: isStyleSource(appId),
    parts: APP_STYLE_PARTS.map((p) => ({
      id: p.id, label: p.label, detail: p.detail, overriding: !!flags[p.id],
      values: [...p.slots.map((n) => ({ kind: 'slot', name: n })), ...p.keys.map((n) => ({ kind: 'key', name: n }))].map((v) => {
        const field = v.kind === 'slot' ? 'slots' : 'keys';
        const own = flags[p.id] ? (current?.[field]?.[v.name] ?? style.own[field][v.name]) : undefined;
        const axhub = hub?.[field]?.[v.name];
        return { ...v, axhub: axhub ?? null, own: own ?? null, from: flags[p.id] ? 'own' : 'axhub', differs: !!flags[p.id] && JSON.stringify(own ?? null) !== JSON.stringify(axhub ?? null) };
      }).filter((v) => v.axhub !== null || v.own !== null),
    })),
    history: styleHistory(doc).length,
    by: style.by ?? '',
    at: style.at ?? '',
  };
}
