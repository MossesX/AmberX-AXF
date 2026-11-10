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
import { DESIGN_OVERRIDES_SETTING, FOLDED_PICK_TYPES, LEGACY_LOOK_KEY, LOOK_MIGRATED_KEY, LOOK_MIGRATION_VERSION, RETIRED_PACKAGE_TYPES, SKIN_SECTIONS, composeLook, foldLegacyPicks, isRetiredLookKey, legacyLookSettings, legacyPicks, legacyThemesInForce, lookMigrated, lookNeedsMigration, migrateLook, migrateLookSettings, newAppLook, normalizeAppLook, normalizeSkin, parseAppLook, parseLegacyLook, settingsNeedMigration, skinFromDesignPackage, skinSlots, type AppLookDocument, type SkinData } from '../core/engines/skin';

const root = new URL('../', import.meta.url).pathname;
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const strip = (o: unknown) => JSON.parse(JSON.stringify(o));

const fx = JSON.parse(readFileSync(join(root, 'spec/fixtures/look-migration.json'), 'utf8'));
eq(fx.version, LOOK_MIGRATION_VERSION, 'fixture version');
eq([LEGACY_LOOK_KEY, LOOK_MIGRATED_KEY], ['axf.legacy.look', 'axf.skin.migrated'], 'the stamp and the backup sit outside the appearance-setting prefixes');
eq(fx.keys, { legacy: LEGACY_LOOK_KEY, migrated: LOOK_MIGRATED_KEY, retired: ['axf.appearance.design', 'axf.appearance.package', 'axf.appearance.overrides', 'axf.appearance.interface', 'axf.look', 'axf.hub.appearance.follow'], retiredPrefixes: ['axf.look.'] }, 'the retired keys are the fixture\'s');
eq([...FOLDED_PICK_TYPES].sort(), [...Object.values(SKIN_SECTIONS), ...RETIRED_PACKAGE_TYPES, 'typography', 'density', 'sizing'].sort(), 'folded types = sections + bundles + scale');

const skinOf = (id: string): SkinData | null => (fx.skins[id] ? normalizeSkin(fx.skins[id]) : null);
const ctx = { skinOf, skinIds: Object.keys(fx.skins), has: () => true, now: '2026-11-10T00:00:00Z', by: 'app' };
/**
 * What the screen gets from this document alone: the app level, its skin when on, no shared document. `legacy` = the
 * picture before skins only, with the retired design-package precedence rule applied on top (what the runtime drew).
 */
const visibleWith = (sk: (id: string) => SkinData | null) => (look: AppLookDocument, legacy = false) => {
  const skin = look.skin.use ? sk(look.skin.id) : null;
  const doc = composeLook(null, look, skin);
  const slots = Object.fromEntries(Object.entries(doc.slots ?? {}).filter(([t]) => !RETIRED_PACKAGE_TYPES.includes(t)));
  if (legacy) Object.assign(slots, legacyThemesInForce(doc.slots, doc.settings, sk));
  return { slots, spacing: doc.spacing ?? null, hidden: doc.hidden ?? {} };
};
const visible = visibleWith(skinOf);

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
  // look-preserving: the old picture (precedence rule included) is the new picture (no rule)
  eq(visible(r.look), visible(c.before, true), `${name}: the screen does not change`);
  // nothing lost
  for (const [t, id] of Object.entries(c.folded)) eq(r.look.legacy?.own?.slots?.[t], id, `${name}: ${t} backed up in legacy`);
  for (const [k, v] of Object.entries(legacyLookSettings(c.before))) eq(r.look.legacy?.settings?.[k], v, `${name}: ${k} backed up in legacy.settings`);
  eq(legacyLookSettings(r.look), {}, `${name}: no retired setting left in the document's parts`);
  eq(legacyPicks(r.look), c.kept, `${name}: only the kept picks are still the app's own`);
  eq(r.look.migrated?.kept ?? [], Object.keys(c.kept).sort(), `${name}: the stamp names the kept picks`);
  if (r.reason !== 'nothing') ok(Object.keys(c.folded).length + Object.keys(c.kept).length > 0, `${name}: something was folded or kept`);
  // round trip through the document rules keeps the stamp and the backup
  eq(strip(parseAppLook(JSON.stringify(r.look))), strip(r.look), `${name}: round trip keeps migrated + legacy`);
}
eq(fx.fold.skinOn.reason, 'skin-on', 'a skin in force: picks under it fold');
eq(fx.fold.skinOn.overrides, { 'behavior-theme': 'brisk' }, 'a section the skin leaves alone becomes an override');
eq(fx.fold.skinOn.look.skin.overrides, { toolbar: 'labeled-actions', 'behavior-theme': 'brisk' }, 'existing overrides are kept');
eq(fx.fold.skinOn.look.own.slots, { 'style-package': 'amber-signature' }, 'a style package is not folded yet (skin@2 makes it a skin)');
ok(!FOLDED_PICK_TYPES.includes('style-package'), 'style-package is not a folded type on this contract version');
// the retired precedence rule is written into the document once
eq(fx.fold.precedence.reason, 'nothing', 'precedence: no pick to fold');
eq(fx.fold.precedence.look.default.slots['color-theme'], 'hub-night', 'precedence: the package colour the screen showed is now the snapshot\'s');
eq(fx.fold.precedence.look.default.slots['style-theme'], 'hub', 'precedence: the recorded style override stays');
eq(fx.fold.precedence.look.legacy.settings, { [DESIGN_OVERRIDES_SETTING]: { 'style-theme': 'hub' } }, 'precedence: the override setting is backed up');
eq(fx.fold.precedence.look.default.settings, { 'axf.banners.group': 'a' }, 'precedence: other look settings stay');
eq(fx.fold.precedenceOwn.reason, 'package', 'precedence in own: the package the picks named is the skin');
eq(fx.fold.precedenceOwn.look.skin, { use: true, inherit: false, id: 'hub-default', overrides: { layout: 'focus-top', 'color-theme': 'coral-studio' } }, 'precedence in own: the shown colour and the snapshot layout the package would change are the skin\'s overrides');
eq(fx.fold.precedenceOwn.look.legacy.settings, { [DESIGN_OVERRIDES_SETTING]: { 'color-theme': 'coral-studio' }, 'axf.appearance.design': 'hub-default' }, 'precedence in own: both retired settings backed up');
eq(fx.fold.precedenceOwn.look.own.settings, {}, 'precedence in own: own settings cleaned');
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
const realSkinOf = (id: string) => realSkins.get(id) ?? null;
const realCtx = { skinOf: realSkinOf, skinIds: [...realSkins.keys()], has: () => true, now: '2026-11-10T00:00:00Z', by: 'axf-console' };
const realVisible = visibleWith(realSkinOf);
// the snapshot every app took on Nov 5: every slot the app showed (Hub Default's chrome, its own theme picks over the
// package), the package named, and the precedence setting that kept the picks
const hubDefault = { slots: { ...skinSlots(realSkins.get('hub-default')!), 'color-theme': 'arctic-daylight', 'style-theme': 'hub', layout: 'focus-top', 'design-package': 'hub-default', 'dock-layout': 'grid-2x2', 'style-package': 'amber-signature' }, spacing: 'tight', hidden: { 'nav-menu': false, toolbar: false }, settings: { [DESIGN_OVERRIDES_SETTING]: { 'style-theme': 'hub', 'color-theme': 'arctic-daylight' }, 'axf.banners.group': 'a' } };
const real: Record<string, AppLookDocument> = {
  console: { ...newAppLook('axf-console', hubDefault), own: { settings: { 'axf.widgets.arrange.banner': '{}' } }, skin: { use: true, inherit: false, id: 'enterprise-day', overrides: { layout: 'windows-explorer' } } },
  axhub: { ...newAppLook('axhub-web', hubDefault), own: { hidden: { toolbar: true } }, skin: { use: false, inherit: false, id: 'windows', overrides: {} } },
  molly: newAppLook('molly', hubDefault),
};
for (const [name, look] of Object.entries(real)) {
  const r = foldLegacyPicks(look, realCtx);
  eq(r.reason, 'nothing', `${name} today: nothing to fold`);
  eq(strip({ ...r.look, migrated: undefined, legacy: undefined, default: { ...r.look.default, settings: undefined } }), strip({ ...look, default: { ...look.default, settings: undefined } }), `${name} today: slots, skin and own picks untouched`);
  eq(r.look.default.slots, hubDefault.slots, `${name} today: the snapshot's themes were what the screen showed (the override named them)`);
  eq(r.look.default.settings, { 'axf.banners.group': 'a' }, `${name} today: the precedence setting left the snapshot`);
  eq(r.look.legacy?.settings, { [DESIGN_OVERRIDES_SETTING]: { 'style-theme': 'hub', 'color-theme': 'arctic-daylight' } }, `${name} today: and is backed up`);
  eq(realVisible(r.look), realVisible(look, true), `${name} today: same screen`);
  eq(strip(foldLegacyPicks(r.look, { ...realCtx, now: '2026-12-01T00:00:00Z' }).look), strip(r.look), `${name} today: a second run changes nothing`);
}
// a snapshot without the precedence setting showed the package's colour (hub-night), not its colour slot: the fold says so
const bare = newAppLook('molly', { ...hubDefault, settings: {} });
const rb = foldLegacyPicks(bare, realCtx);
eq(rb.look.default.slots['color-theme'], 'hub-night', 'bare snapshot: the package colour the screen showed');
eq(realVisible(rb.look), realVisible(bare, true), 'bare snapshot: same screen');
// a console that picked a colour theme over its skin with the old picker: the pick becomes the skin's colour override
// (the old picker recorded the override with the pick; a pick without one was never shown and is resolved away first)
const consolePicked = { ...real.console!, own: { ...real.console!.own, slots: { 'color-theme': 'aurora-night', 'style-theme': 'glass-orbit' }, settings: { ...real.console!.own.settings, [DESIGN_OVERRIDES_SETTING]: { 'color-theme': 'aurora-night', 'style-theme': 'glass-orbit' } } } };
const rp = foldLegacyPicks(consolePicked, realCtx);
eq(rp.reason, 'skin-on', 'console with old picks: folds under its skin');
eq(rp.look.own.slots, {}, 'console with old picks: own picks gone');
eq(rp.look.skin.overrides, { layout: 'windows-explorer' }, 'console with old picks: the skin draws its own sections, inert picks dropped');
eq(rp.look.legacy?.own?.slots, { 'color-theme': 'aurora-night', 'style-theme': 'glass-orbit' }, 'console with old picks: backed up');
eq(rp.look.own.settings, { 'axf.widgets.arrange.banner': '{}' }, 'console with old picks: the override setting left own');
eq(realVisible(rp.look), realVisible(consolePicked, true), 'console with old picks: same screen');
// a pick the old rule never showed (no override recorded) is resolved to what the screen showed, then backed up as that
const consoleSilent = { ...real.console!, own: { ...real.console!.own, slots: { 'color-theme': 'aurora-night' } } };
const rs = foldLegacyPicks(consoleSilent, realCtx);
eq(rs.look.legacy?.own?.slots, { 'color-theme': 'arctic-daylight' }, 'console with a silent pick: the shown value is what is kept');
eq(realVisible(rs.look), realVisible(consoleSilent, true), 'console with a silent pick: same screen');
// Molly that applied Hub Default with the old picker: the package is the skin
// (loading a package cleared the recorded override: the look document carries the null that beat the snapshot's value)
const mollyPkg = { ...real.molly!, own: { slots: { 'design-package': 'hub-default', ...Object.fromEntries(Object.entries(skinSlots(realSkins.get('hub-default')!)).filter(([t]) => t in hubDefault.slots)) }, spacing: 'tight', hidden: { toolbar: true }, settings: { [DESIGN_OVERRIDES_SETTING]: null } } };
const rm = foldLegacyPicks(mollyPkg, realCtx);
eq(rm.reason, 'package', 'molly with Hub Default applied: the package is the skin');
eq(rm.look.skin.id, 'hub-default', 'molly: skin id');
eq(realVisible(rm.look).slots['color-theme'], 'hub-night', 'molly: the package\'s colour theme stays');
eq(realVisible(rm.look), realVisible(mollyPkg, true), 'molly: same screen');
ok(normalizeAppLook(JSON.parse(JSON.stringify(rm.look)))?.migrated?.version === LOOK_MIGRATION_VERSION, 'molly: the stamp survives the document rules');

console.log(`check-look-migration: ${n} checks passed`);
