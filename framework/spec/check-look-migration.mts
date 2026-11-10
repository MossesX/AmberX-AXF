/**
 * look-migration@1 (skins only, build remove-the-old-theme-manager-style-and-layout-se): the one-run fold of the retired
 * theme / style / layout picks and settings into the active skin. Replays spec/fixtures/look-migration.json through the
 * engine, then checks the rules on every case: idempotent (a second run changes nothing), look-preserving (the composed
 * look before and after draws the same slots, spacing and chrome), nothing lost (every moved pick is in `legacy`, every
 * retired setting in the backup), and the hub's real document shapes fold to nothing but the stamp.
 *   npx -y tsx framework/spec/check-look-migration.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDED_PICK_TYPES, LEGACY_LOOK_KEY, LOOK_MIGRATED_KEY, LOOK_MIGRATION_VERSION, RETIRED_PACKAGE_TYPES, SKIN_SECTIONS, composeLook, foldLegacyPicks, isRetiredLookKey, legacyPicks, lookMigrated, lookNeedsMigration, migrateLook, migrateLookSettings, newAppLook, normalizeAppLook, normalizeSkin, parseAppLook, parseLegacyLook, settingsNeedMigration, skinFromDesignPackage, skinSlots, type AppLookDocument, type SkinData } from '../core/engines/skin';

const root = new URL('../', import.meta.url).pathname;
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const strip = (o: unknown) => JSON.parse(JSON.stringify(o));

const fx = JSON.parse(readFileSync(join(root, 'spec/fixtures/look-migration.json'), 'utf8'));
eq(fx.version, LOOK_MIGRATION_VERSION, 'fixture version');
eq(fx.keys, { legacy: LEGACY_LOOK_KEY, migrated: LOOK_MIGRATED_KEY, retired: ['axf.appearance.design', 'axf.appearance.package', 'axf.appearance.overrides', 'axf.appearance.interface', 'axf.look', 'axf.hub.appearance.follow'], retiredPrefixes: ['axf.look.'] }, 'the retired keys are the fixture\'s');
eq([...FOLDED_PICK_TYPES].sort(), [...Object.values(SKIN_SECTIONS), ...RETIRED_PACKAGE_TYPES, 'typography', 'density', 'sizing'].sort(), 'folded types = sections + bundles + scale');

const skinOf = (id: string): SkinData | null => (fx.skins[id] ? normalizeSkin(fx.skins[id]) : null);
const ctx = { skinOf, skinIds: Object.keys(fx.skins), has: () => true, now: '2026-11-10T00:00:00Z', by: 'app' };
const visible = (look: AppLookDocument) => {
  // what the screen gets from this document alone: the app level, its skin when on, no shared document
  const skin = look.skin.use ? skinOf(look.skin.id) : null;
  const doc = composeLook(null, look, skin);
  const slots = Object.fromEntries(Object.entries(doc.slots ?? {}).filter(([t]) => !RETIRED_PACKAGE_TYPES.includes(t)));
  return { slots, spacing: doc.spacing ?? null, hidden: doc.hidden ?? {} };
};

/* ---- the contract: same results as the golden file ---- */
for (const [name, c] of Object.entries(fx.fold as Record<string, { before: AppLookDocument; picks: Record<string, string>; needs: boolean; look: AppLookDocument; again: AppLookDocument; needsAfter: boolean; skin: string; folded: Record<string, string>; overrides: Record<string, string>; kept: Record<string, string>; reason: string }>)) {
  const cctx = { ...ctx, ...(name === 'designPick' ? { designPick: 'aurora' } : {}) };
  const r = foldLegacyPicks(c.before, cctx);
  eq(strip(r), strip({ look: c.look, skin: c.skin, folded: c.folded, overrides: c.overrides, kept: c.kept, reason: c.reason }), `${name}: fold matches the fixture`);
  eq(legacyPicks(c.before), c.picks, `${name}: picks`);
  eq(lookNeedsMigration(c.before), c.needs, `${name}: needs before`);
  // idempotent
  ok(lookMigrated(r.look), `${name}: stamped`);
  eq(lookNeedsMigration(r.look), false, `${name}: nothing left to fold`);
  eq(strip(foldLegacyPicks(r.look, { ...cctx, now: '2026-12-01T00:00:00Z' }).look), strip(c.again), `${name}: a second run matches the fixture`);
  eq(strip(foldLegacyPicks(r.look, { ...cctx, now: '2026-12-01T00:00:00Z' }).look), strip(r.look), `${name}: a second run changes nothing`);
  // look-preserving
  eq(visible(r.look), visible(c.before), `${name}: the screen does not change`);
  // nothing lost
  for (const [t, id] of Object.entries(c.folded)) eq(r.look.legacy?.own?.slots?.[t], id, `${name}: ${t} backed up in legacy`);
  eq(legacyPicks(r.look), c.kept, `${name}: only the kept picks are still the app's own`);
  eq(r.look.migrated?.kept ?? [], Object.keys(c.kept).sort(), `${name}: the stamp names the kept picks`);
  if (r.reason !== 'nothing') ok(Object.keys(c.folded).length + Object.keys(c.kept).length > 0, `${name}: something was folded or kept`);
  // round trip through the document rules keeps the stamp and the backup
  eq(strip(parseAppLook(JSON.stringify(r.look))), strip(r.look), `${name}: round trip keeps migrated + legacy`);
}
eq(fx.fold.skinOn.reason, 'skin-on', 'a skin in force: picks under it fold');
eq(fx.fold.skinOn.overrides, { 'behavior-theme': 'brisk' }, 'a section the skin leaves alone becomes an override');
eq(fx.fold.skinOn.look.skin.overrides, { toolbar: 'labeled-actions', 'behavior-theme': 'brisk' }, 'existing overrides are kept');
eq(fx.fold.package.reason, 'package', 'the applied package becomes the skin');
eq(fx.fold.package.look.skin, { use: true, inherit: false, id: 'hub-default', overrides: { 'color-theme': 'coral-studio' } }, 'the colour pick over the package is the skin\'s colour override');
eq(fx.fold.package.look.own.slots, {}, 'the package\'s slots are the skin\'s now');
eq(fx.fold.designPick.look.skin.id, 'aurora', 'the local note picks the skin');
eq(fx.fold.match.look.skin, { use: true, inherit: false, id: 'aurora', overrides: {} }, 'an exact match: the skin, no overrides');
eq(fx.fold.noSkin.reason, 'no-skin', 'no skin draws it: kept');
eq(fx.fold.noSkin.kept, { 'style-theme': 'glass-orbit' }, 'the kept pick is reported');
eq(fx.fold.noSkin.look.own.slots, { 'style-theme': 'glass-orbit' }, 'a kept pick stays the app\'s own');
ok(lookNeedsMigration({ ...fx.fold.noSkin.look, own: { slots: { 'style-theme': 'glass-orbit', 'color-theme': 'coral-studio' } } }), 'a new pick of another type folds again');
eq(fx.fold.unknownSkinOn.reason, 'no-skin', 'an unknown skin on reads as off');
eq(fx.fold.scale.look.skin.overrides, { density: 'spacious' }, 'a scale pick rides the skin as an override');
eq(fx.fold.nothing.look.migrated?.version, LOOK_MIGRATION_VERSION, 'a clean document is stamped only');
ok(!fx.fold.nothing.look.legacy, 'a clean document gets no legacy block');

/* ---- the local half ---- */
const s = fx.settings;
eq(strip(migrateLookSettings(s.values, '2026-11-10T00:00:00Z')), strip(s.first), 'settings fold matches the fixture');
eq(settingsNeedMigration(s.values), true, 'retired keys need the fold');
eq(s.first.clear, ['axf.appearance.design', 'axf.appearance.overrides', 'axf.hub.appearance.follow', 'axf.look', 'axf.look.sliders'], 'every retired key is cleared, sorted');
ok(!s.first.clear.includes('axf.tokens.theme') && !s.first.clear.includes('axf.skin.look') && !s.first.clear.includes('axf.hide.toolbar'), 'token overrides, the skin document and chrome hides are not retired');
eq(s.first.set[LOOK_MIGRATED_KEY], LOOK_MIGRATION_VERSION, 'the profile is stamped');
const backup = parseLegacyLook(s.first.set[LEGACY_LOOK_KEY]);
eq(backup?.settings, { 'axf.appearance.design': 'hub-default', 'axf.appearance.overrides': { 'color-theme': 'coral-studio' }, 'axf.hub.appearance.follow': false, 'axf.look': { space: 2 }, 'axf.look.sliders': 1 }, 'every retired value is in the backup');
eq(s.first.designPick, 'hub-default', 'the design note is the fold\'s hint');
eq(s.again.changed, false, 'a second run changes nothing');
eq(settingsNeedMigration(s.applied), false, 'stamped and clean');
eq(s.back.result.clear, ['axf.appearance.design', 'axf.appearance.interface'], 'keys that come back are folded again');
eq(s.back.backup.settings['axf.appearance.design'], 'hub-default', 'the first backup of a value is kept');
eq(s.back.backup.settings['axf.appearance.interface'], 'amber', 'a new key joins the backup');
eq(s.back.backup.at, '2026-11-10T00:00:00Z', 'the backup keeps its first date');
eq(s.junkBackup, null, 'junk backup reads as none');
eq(s.wrongFrame, null, 'wrong frame reads as none');
ok(isRetiredLookKey('axf.look.anything') && !isRetiredLookKey(LEGACY_LOOK_KEY) && !isRetiredLookKey(LOOK_MIGRATED_KEY) && !isRetiredLookKey('axf.lookout'), 'retired prefixes, never the stamp or the backup');

/* ---- both halves in one call ---- */
eq(strip(migrateLook(fx.fold.designPick.before, { 'axf.appearance.design': 'aurora', 'axf.look': 1 }, ctx)), strip({ ...fx.combined, again: undefined }), 'migrateLook matches the fixture');
eq(fx.combined.report.reason, 'package', 'the local note drives the fold when the document has no package pick');
eq(fx.combined.again.lookChanged, false, 'again: no document change');
eq(fx.combined.again.settingsChanged, false, 'again: no settings change');
eq(strip(migrateLook(null, { 'axf.look': 1 }, ctx).report), { skin: '', folded: {}, overrides: {}, kept: {}, reason: 'no-document' }, 'no document yet: settings only');

/* ---- the hub's real document shapes against the real skins and packages ---- */
const assets = (type: string) => readdirSync(join(root, 'assets', type)).map((f) => JSON.parse(readFileSync(join(root, 'assets', type, f), 'utf8')));
const realSkins = new Map<string, SkinData>();
for (const a of assets('skin')) realSkins.set(a.id, normalizeSkin(a.data));
for (const a of assets('design-package')) if (!realSkins.has(a.id)) realSkins.set(a.id, skinFromDesignPackage(a.data));
const realCtx = { skinOf: (id: string) => realSkins.get(id) ?? null, skinIds: [...realSkins.keys()], has: () => true, now: '2026-11-10T00:00:00Z', by: 'axf-console' };
const hubDefault = { slots: { 'behavior-theme': 'standard', 'color-theme': 'arctic-daylight', density: 'compact', 'design-package': 'hub-default', 'dock-layout': 'grid-2x2', layout: 'focus-top', sizing: 'compact', 'style-package': 'amber-signature', 'style-theme': 'hub', 'theme-switch': 'fresh-day-night', typography: 'compact', button: 'rounded-solid', toolbar: 'standard-icons' }, spacing: 'tight', hidden: { 'nav-menu': false, toolbar: false } };
const real: Record<string, AppLookDocument> = {
  console: { ...newAppLook('axf-console', hubDefault), own: { settings: { 'axf.banners.group': 'a' } }, skin: { use: true, inherit: false, id: 'enterprise-day', overrides: { layout: 'windows-explorer' } } },
  axhub: { ...newAppLook('axhub-web', hubDefault), own: { hidden: { toolbar: true } }, skin: { use: false, inherit: false, id: 'windows', overrides: {} } },
  molly: newAppLook('molly', hubDefault),
};
for (const [name, look] of Object.entries(real)) {
  const r = foldLegacyPicks(look, realCtx);
  eq(r.reason, 'nothing', `${name} today: nothing to fold`);
  eq(strip({ ...r.look, migrated: undefined }), strip(look), `${name} today: only the stamp is added`);
  eq(visible(r.look), visible(look), `${name} today: same screen`);
}
// a console that picked a colour theme over its skin with the old picker: the pick becomes the skin's colour override
const consolePicked = { ...real.console!, own: { ...real.console!.own, slots: { 'color-theme': 'aurora-night', 'style-theme': 'glass-orbit' } } };
const rp = foldLegacyPicks(consolePicked, realCtx);
eq(rp.reason, 'skin-on', 'console with old picks: folds under its skin');
eq(rp.look.own.slots, {}, 'console with old picks: own picks gone');
eq(rp.look.skin.overrides, { layout: 'windows-explorer' }, 'console with old picks: the skin draws its own sections, inert picks dropped');
eq(rp.look.legacy?.own?.slots, { 'color-theme': 'aurora-night', 'style-theme': 'glass-orbit' }, 'console with old picks: backed up');
// Molly that applied Hub Default with the old picker: the package is the skin
const mollyPkg = { ...real.molly!, own: { slots: { 'design-package': 'hub-default', ...Object.fromEntries(Object.entries(skinSlots(realSkins.get('hub-default')!)).filter(([t]) => t in hubDefault.slots)) }, spacing: 'tight', hidden: { toolbar: true } } };
const rm = foldLegacyPicks(mollyPkg, realCtx);
eq(rm.reason, 'package', 'molly with Hub Default applied: the package is the skin');
eq(rm.look.skin.id, 'hub-default', 'molly: skin id');
eq(visible(rm.look).slots['color-theme'], 'hub-night', 'molly: the package\'s colour theme stays');
ok(normalizeAppLook(JSON.parse(JSON.stringify(rm.look)))?.migrated?.version === LOOK_MIGRATION_VERSION, 'molly: the stamp survives the document rules');

console.log(`check-look-migration: ${n} checks passed`);
