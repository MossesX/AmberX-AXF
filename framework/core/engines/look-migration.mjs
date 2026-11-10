/**
 * look-migration@1: the skins-only fold (build remove-the-old-theme-manager-style-and-layout-se, Fable, Nov 10 2026).
 *
 * Brett: "We need to remove all the styling and theme and layout stuff. Remove it all because the new thing's going to
 * override it." The new thing is the skin. From here on nothing picks a colour, style, layout or behaviour theme, a
 * design or style package, or a scale asset (density, sizing, typography) on its own: those are the sections and
 * `assets` of a skin, and only the colour theme is still swapped inside a skin (`SKIN_SWAPPABLE_SECTION`).
 *
 * What a profile may still carry from before, and where it goes:
 *
 *   app-look@1 `own.slots[<folded type>]`     the old pickers' picks over the snapshot. With a skin on they were inert
 *                                             (the skin's slots win): moved to `legacy.own`. With no skin: the picked
 *                                             package (or the local `axf.appearance.design` note) becomes the skin, and
 *                                             every pick that differs from that skin becomes a skin-level override, so
 *                                             the screen does not change. No package and no skin that gives the same
 *                                             screen: the picks stay the app's own (reported `kept`), still the only
 *                                             way to see them, and the pickers that made them are gone.
 *   local settings `axf.appearance.design`, `axf.appearance.package`, `axf.appearance.overrides`,
 *   `axf.appearance.interface`, `axf.look`, `axf.look.*`, `axf.hub.appearance.follow`
 *                                             backed up into `axf.legacy.look` (look-migration@1 frame), then cleared.
 *
 * Rules: idempotent (a second run changes nothing: the document carries `migrated.version`, the settings carry
 * `axf.look.migrated`), look-preserving (a skin is adopted only when adopting it draws the same screen), and nothing
 * is lost (the first backup of a value is kept; a later run adds keys, never overwrites). Pure: no DOM, no runtime;
 * the runtime calls `migrateLook` once per profile on load (`AxfRuntime.migrateLook`). Kotlin twin deferred
 * (spec/PORTING.md). Fixture `spec/fixtures/look-migration.json`, check `spec/check-look-migration.mts`.
 */
import { RETIRED_PACKAGE_TYPES, SKIN_SCALE_TYPES, SKIN_SECTIONS, normalizeLookPart, skinSlotMap } from './skin-rules.mjs';

export const LOOK_MIGRATION_FRAME = 'look-migration@1';
/** Bump when a later fold must run again on documents and profiles already stamped. */
export const LOOK_MIGRATION_VERSION = 1;
/** Local backup of the retired settings (a JSON string: `{ $axf, version, at, settings }`). */
export const LEGACY_LOOK_KEY = 'axf.legacy.look';
/** Local one-run stamp (the version that ran). */
export const LOOK_MIGRATED_KEY = 'axf.look.migrated';
/** Retired local settings: read once by the fold, backed up, cleared, never written again. */
export const RETIRED_LOOK_KEYS = ['axf.appearance.design', 'axf.appearance.package', 'axf.appearance.overrides', 'axf.appearance.interface', 'axf.look', 'axf.hub.appearance.follow'];
/** Retired key prefixes (`axf.look.sliders`, …). The stamp and the backup are not retired keys. */
export const RETIRED_LOOK_PREFIXES = ['axf.look.'];
/** Slot types a look no longer picks on its own: the four sections, the retired bundles and the scale assets. */
export const FOLDED_PICK_TYPES = [...Object.values(SKIN_SECTIONS), ...RETIRED_PACKAGE_TYPES, ...SKIN_SCALE_TYPES];
/** Which retired setting names a package (first one wins). */
const PACKAGE_KEYS = ['axf.appearance.design', 'axf.appearance.package'];

const ID = /^[a-z0-9][a-z0-9-]*$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const isRetiredLookKey = (key) => key !== LEGACY_LOOK_KEY && key !== LOOK_MIGRATED_KEY && (RETIRED_LOOK_KEYS.includes(key) || RETIRED_LOOK_PREFIXES.some((p) => key.startsWith(p)));
export const isFoldedPickType = (type) => FOLDED_PICK_TYPES.includes(type);

/** The picks a look still makes on its own: `own.slots` entries of a folded type. */
export function legacyPicks(look) {
  const out = {};
  for (const [t, id] of Object.entries(look?.own?.slots ?? {})) if (isFoldedPickType(t)) out[t] = id;
  return out;
}

/** Has this version of the fold run on the document? */
export const lookMigrated = (look) => (look?.migrated?.version ?? 0) >= LOOK_MIGRATION_VERSION;
/** Does the document need the fold (not stamped, or a pick of a folded type is back that the stamp did not keep)? */
export const lookNeedsMigration = (look) => !!look && (!lookMigrated(look) || Object.keys(legacyPicks(look)).some((t) => !(look.migrated?.kept ?? []).includes(t)));
/** Do a profile's saved settings need the fold (not stamped, or a retired key is back)? */
export function settingsNeedMigration(values) {
  const v = values ?? {};
  if (Number(v[LOOK_MIGRATED_KEY] ?? 0) < LOOK_MIGRATION_VERSION) return true;
  return Object.keys(v).some((k) => isRetiredLookKey(k) && v[k] !== null && v[k] !== undefined);
}

/** The backup a profile holds, or null. */
export function parseLegacyLook(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return null; } }
  if (!isObj(o) || o.$axf !== LOOK_MIGRATION_FRAME || !isObj(o.settings)) return null;
  return { $axf: LOOK_MIGRATION_FRAME, version: Math.max(0, Math.floor(Number(o.version) || 0)), at: String(o.at ?? ''), settings: { ...o.settings } };
}

/**
 * The local half: back up every retired setting into `axf.legacy.look` (first value kept, new keys added), clear
 * them, stamp the profile. `values` = the profile's saved values. Returns what to set and clear, plus the package the
 * retired `axf.appearance.design` / `axf.appearance.package` named (the fold's hint when the look has no package pick).
 */
export function migrateLookSettings(values, now) {
  const v = values ?? {};
  const retired = Object.keys(v).filter((k) => isRetiredLookKey(k) && v[k] !== null && v[k] !== undefined).sort();
  const designPick = PACKAGE_KEYS.map((k) => v[k]).find((x) => typeof x === 'string' && ID.test(x)) ?? '';
  const stamped = Number(v[LOOK_MIGRATED_KEY] ?? 0) >= LOOK_MIGRATION_VERSION;
  if (!retired.length && stamped) return { changed: false, set: {}, clear: [], designPick, backup: parseLegacyLook(v[LEGACY_LOOK_KEY]) };
  const prev = parseLegacyLook(v[LEGACY_LOOK_KEY]);
  const backup = { $axf: LOOK_MIGRATION_FRAME, version: LOOK_MIGRATION_VERSION, at: prev?.at || now, settings: { ...(prev?.settings ?? {}) } };
  for (const k of retired) if (!Object.hasOwn(backup.settings, k)) backup.settings[k] = v[k];
  const set = { [LOOK_MIGRATED_KEY]: LOOK_MIGRATION_VERSION };
  if (Object.keys(backup.settings).length) set[LEGACY_LOOK_KEY] = JSON.stringify(backup);
  return { changed: true, set, clear: retired, designPick, backup };
}

/** Would skin `skin` (its slots and extras) draw the same screen as the look does today, once the differing own picks are overrides? */
function adoptable(look, skin, has) {
  const effective = { ...look.default.slots, ...look.own.slots };
  const ownSlots = look.own.slots ?? {};
  for (const [t, id] of Object.entries(skinSlotMap(skin))) {
    if (!has(t, id)) continue; // an id this app lacks keeps the app's default: no change on screen
    if (effective[t] === id || t in ownSlots) continue; // the skin's, or an explicit pick that becomes an override
    if (effective[t] === undefined) continue; // nothing picked there: the skin's asset is the first pick
    return false; // a snapshot value the skin would change
  }
  const x = skin.extras ?? {};
  const spacing = look.own.spacing ?? look.default.spacing;
  if (x.spacing && spacing && x.spacing !== spacing) return false;
  const hidden = { ...look.default.hidden, ...look.own.hidden };
  for (const [t, on] of Object.entries(x.hidden ?? {})) if (t in hidden && hidden[t] !== on) return false;
  const settings = { ...look.default.settings, ...look.own.settings };
  for (const [k, val] of Object.entries(x.settings ?? {})) if (k in settings && !same(settings[k], val)) return false;
  return true;
}

/**
 * The document half. `ctx`: `skinOf(id)` the skin's data (a skin or a design package read as one; null = unknown),
 * `skinIds` every usable skin, `has(type, id)` the app's registry, `designPick` the package the local note named,
 * `now`, `by` (app id). Returns the new document (stamped; `legacy` filled when something moved) and a report:
 * `skin` the skin now in force, `folded` the picks moved, `overrides` the picks kept as skin overrides, `kept` the picks
 * left as the app's own, `reason` one of nothing | skin-on | package | match | no-skin.
 */
export function foldLegacyPicks(look, ctx) {
  const skinOf = ctx?.skinOf ?? (() => null);
  const has = ctx?.has ?? (() => true);
  const now = ctx?.now ?? '';
  const picks = legacyPicks(look);
  const stamp = { version: LOOK_MIGRATION_VERSION, at: now, by: String(ctx?.by ?? '') };
  const legacy = (own) => {
    const prev = look.legacy;
    const slots = { ...(prev?.own?.slots ?? {}) };
    for (const [t, id] of Object.entries(own)) if (!Object.hasOwn(slots, t)) slots[t] = id;
    return { ...(prev ?? {}), at: prev?.at || now, own: normalizeLookPart({ ...(prev?.own ?? {}), slots }) };
  };
  const report = { skin: look.skin.use ? look.skin.id : '', folded: {}, overrides: {}, kept: {}, reason: 'nothing' };
  // already stamped at this version and nothing new to fold (kept picks included): the document is left exactly as it is
  if (!lookNeedsMigration(look)) return { look, ...report, kept: picks };
  if (!Object.keys(picks).length) return { look: { ...look, migrated: stamp }, ...report };
  /**
   * Move the folded picks under skin `id` (its data `skin`): a pick of a type the skin draws is inert while the skin is
   * on (dropped) unless `keepDiffering` says a differing pick becomes an override (adopting a skin must not change the
   * screen); a section or scale pick of a type the skin leaves alone becomes an override too (it still shows, and it
   * now reads through the skin); a bundle pick is a label only (its members are separate slots), so it is dropped.
   */
  const fold = (id, skin, keepDiffering) => {
    const inSkin = skinSlotMap(skin);
    const overrides = id === look.skin.id ? { ...look.skin.overrides } : {};
    const ownSlots = { ...(look.own.slots ?? {}) };
    const moved = {};
    for (const [t, pick] of Object.entries(ownSlots)) {
      if (t in inSkin) {
        if (keepDiffering && pick !== inSkin[t] && has(t, pick)) { overrides[t] = pick; if (isFoldedPickType(t)) moved[t] = pick; }
        delete ownSlots[t];
      } else if (isFoldedPickType(t)) {
        if (!RETIRED_PACKAGE_TYPES.includes(t) && has(t, pick)) { overrides[t] = pick; moved[t] = pick; }
        delete ownSlots[t];
      }
    }
    return { ownSlots, overrides, moved };
  };
  if (look.skin.use) {
    const skin = skinOf(look.skin.id);
    if (!skin) return { look: { ...look, migrated: { ...stamp, kept: Object.keys(picks).sort() } }, ...report, kept: picks, reason: 'no-skin' }; // unknown skin reads as off: nothing to fold onto
    const f = fold(look.skin.id, skin, false);
    const next = { ...look, own: { ...look.own, slots: f.ownSlots }, skin: { ...look.skin, overrides: f.overrides }, legacy: legacy(picks), migrated: stamp };
    return { look: next, skin: look.skin.id, folded: picks, overrides: f.moved, kept: {}, reason: 'skin-on' };
  }
  const candidates = [picks['design-package'], picks['appearance-package'], ctx?.designPick].filter((id) => typeof id === 'string' && ID.test(id));
  let chosen = '';
  let reason = 'no-skin';
  for (const id of candidates) { const s = skinOf(id); if (s && adoptable(look, s, has)) { chosen = id; reason = 'package'; break; } }
  if (!chosen) for (const id of ctx?.skinIds ?? []) { const s = skinOf(id); if (s && adoptable(look, s, has)) { chosen = id; reason = 'match'; break; } }
  if (!chosen) {
    // nothing draws this screen but the app's own picks: they stay (the pickers are gone; a skin pick replaces them);
    // the stamp names them, so the next load does not try again, while a new pick of another type still folds
    return { look: { ...look, migrated: { ...stamp, kept: Object.keys(picks).sort() } }, ...report, kept: picks, reason };
  }
  const f = fold(chosen, skinOf(chosen), true);
  const next = { ...look, own: { ...look.own, slots: f.ownSlots }, skin: { ...look.skin, use: true, id: chosen, overrides: f.overrides }, legacy: legacy(picks), migrated: stamp };
  return { look: next, skin: chosen, folded: picks, overrides: f.moved, kept: {}, reason };
}

/**
 * One call for a profile on load: the document (may be null while the store has none) and the saved settings.
 * Returns `look` (the document to save when `lookChanged`), `settings` (`set` / `clear`, apply when `settingsChanged`)
 * and the report. Running it again on its own output changes nothing.
 */
export function migrateLook(look, values, ctx) {
  const now = ctx?.now ?? new Date().toISOString();
  const local = migrateLookSettings(values, now);
  const designPick = ctx?.designPick || local.designPick || '';
  let out = look;
  let report = { skin: look?.skin?.use ? look.skin.id : '', folded: {}, overrides: {}, kept: {}, reason: look ? 'nothing' : 'no-document' };
  if (look && lookNeedsMigration(look)) {
    const r = foldLegacyPicks(look, { ...ctx, now, designPick });
    out = r.look;
    report = { skin: r.skin, folded: r.folded, overrides: r.overrides, kept: r.kept, reason: r.reason };
  }
  return { look: out, lookChanged: out !== look, settings: { set: local.set, clear: local.clear }, settingsChanged: local.changed, retired: local.clear, backup: local.backup ?? null, report };
}
