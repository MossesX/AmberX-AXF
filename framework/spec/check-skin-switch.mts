/**
 * skin-switch@1 (build skins-plugin-its-own-removable-console-plugin-and-screen-for-changing-skins-ga): the action
 * contract of the Skins screen and every other entry point. Replays spec/fixtures/skin-switch.json through the engine
 * (the chained sequence with its between-step edits, the scope views, scope parsing, command normalisation), then
 * checks the rules on the replay: scope precedence (plugin → ui → app → global), undo after restore at every scope,
 * back-to-skin clears only the overridden part, one undo only, refusals change nothing, the record round-trips through
 * the document rules, and the record Restore has always left still undoes.
 *   npx -y tsx framework/spec/check-skin-switch.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKIN_SWITCH_ACTIONS, SKIN_SWITCH_CONTRACT, SKIN_SWITCH_ERRORS, SKIN_SWITCH_HUB, SKIN_SWITCH_SCOPES, SKIN_COLOR_SLOT, composeLookAt, newAppLook, normalizeSkin, normalizeSkinSwitch, parseAppLook, parseSwitchScope, pickSkin, resolveLookSkin, restoreAppDefault, setInheritSkin, setLookSlot, setScopeOverride, setSkinColorTheme, setUseSkin, skinSwitch, skinSwitchState, snapshotLook, switchScopeOf, switchScopes, undoRestore, type AppLookDocument, type GlobalSkin, type SkinSwitchResult } from '../core/engines/skin';

const root = new URL('../', import.meta.url).pathname;
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const strip = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const fx = JSON.parse(readFileSync(join(root, 'spec/fixtures/skin-switch.json'), 'utf8'));
eq(fx.contract, SKIN_SWITCH_CONTRACT, 'contract');
eq(fx.actions, SKIN_SWITCH_ACTIONS, 'the four actions');
eq(fx.scopes, SKIN_SWITCH_SCOPES, 'the four scope kinds');
eq(fx.errors, SKIN_SWITCH_ERRORS, 'the error codes');
eq(fx.hub, SKIN_SWITCH_HUB, 'the hub scope string');
eq([...SKIN_SWITCH_ACTIONS], ['use', 'back-to-skin', 'restore-default', 'undo'], 'actions, in toolbar order');

/* ---- scopes and commands read the same way as the golden file ---- */
for (const [s, want] of Object.entries(fx.parse)) eq(parseSwitchScope(s), want, `parse "${s}"`);
eq(parseSwitchScope('hub'), parseSwitchScope('global'), 'hub and global are the same scope');
eq(parseSwitchScope('app:notes')!.key, 'app', 'app:<id> is the app level of that document');
eq(parseSwitchScope('plugin:ai.amberx.notes')!.key, 'plugin:ai.amberx.notes', 'a plugin scope key is the sub-scope key');
eq({ global: switchScopeOf('global', 'app'), app: switchScopeOf('app', 'app'), appNoId: switchScopeOf('app'), ui: switchScopeOf('ui:home', 'app'), plugin: switchScopeOf('plugin:notes'), junk: switchScopeOf('junk') }, fx.scopeOf, 'scopeOf');
for (const [name, c] of Object.entries(fx.normalize as Record<string, { command: unknown; errors: { code: string }[] }>)) {
  const input = { good: { action: 'use', scope: 'app:app', skin: 'windows', slot: 'ignored', at: '2026-11-13T00:00:00Z' }, back: { action: 'back-to-skin', scope: ' plugin:notes ', slot: 'button' }, noSkin: { action: 'use', scope: 'hub' }, badAll: { action: 'flip', scope: 'planet', skin: 'Bad Id', slot: 'Bad Slot' }, junk: 7 }[name];
  eq(strip(normalizeSkinSwitch(input)), c, `normalize ${name}`);
  ok(c.errors.every((e) => SKIN_SWITCH_ERRORS.includes(e.code as never)), `${name}: every problem has a listed code`);
}
ok(!('slot' in fx.normalize.good.command), 'use drops a slot');
eq(fx.normalize.badAll.errors.map((e: { code: string }) => e.code), ['bad-action', 'bad-scope', 'unknown-skin', 'bad-slot'], 'every problem is listed, in field order');

/* ---- the sequence: same results as the golden file ---- */
const skins: Record<string, ReturnType<typeof normalizeSkin>> = Object.fromEntries(Object.entries(fx.skins).map(([id, s]) => [id, normalizeSkin(s)]));
const skinOf = (id: string) => skins[id] ?? null;
const frozenSkins = JSON.stringify(fx.skins);
const ctx = { has: (id: string) => id in fx.skins, now: '2026-11-13T00:00:00Z' };
const look0 = newAppLook('app', snapshotLook(fx.shared));
eq(look0, fx.snapshot, 'the starting document is the snapshot');
const edits: Record<string, (look: AppLookDocument, ...args: string[]) => AppLookDocument> = {
  setLookSlot: (look, slot, id) => setLookSlot(look, slot!, id!),
  setSkinColorTheme: (look, id, key) => setSkinColorTheme(look, id!, key),
  setScopeOverride: (look, key, slot, id) => setScopeOverride(look, key!, slot!, id!),
  setInheritSkin: (look, on) => setInheritSkin(look, on === 'true'),
};
type Step = { name: string; edit?: { fn: string; args: string[] }[]; global?: GlobalSkin | null; command: Record<string, unknown>; before: { look: AppLookDocument; global: GlobalSkin | null }; result: SkinSwitchResult; view: unknown; roundTrip: unknown };
const steps = fx.sequence as Step[];
const by: Record<string, Step> = {};
let cur: { look: AppLookDocument; global: GlobalSkin | null } = { look: look0, global: null };
for (const s of steps) {
  let look = cur.look;
  for (const e of s.edit ?? []) look = edits[e.fn]!(look, ...e.args);
  const before = { look, global: s.global === undefined ? cur.global : s.global };
  eq(strip(before), strip(s.before), `${s.name}: the state before matches the fixture`);
  const r = skinSwitch(before, s.command, ctx);
  eq(strip(r), strip(s.result), `${s.name}: the result matches the fixture`);
  const scope = parseSwitchScope(s.command.scope)?.scope ?? '';
  eq(strip(scope ? skinSwitchState(r.look, r.global, scope, ctx) : null), strip(s.view), `${s.name}: the view matches the fixture`);
  eq(strip(parseAppLook(JSON.stringify(r.look))), strip(r.look), `${s.name}: the document round-trips with its undo record`);
  if (!r.ok) { eq(r.changed, { look: false, global: false }, `${s.name}: a refused command changes nothing`); eq(strip(r.look), strip(before.look), `${s.name}: refused: same document`); eq(strip(r.global), strip(before.global), `${s.name}: refused: same hub-wide skin`); ok(SKIN_SWITCH_ERRORS.includes(r.error as never), `${s.name}: a listed error code`); eq(r.undo, null, `${s.name}: refused: no record`); }
  if (r.ok && r.changed.look && s.command.action !== 'undo') {
    ok(r.undo && r.look!.undo === r.undo, `${s.name}: the record left is the document's undo`);
    eq(r.undo!.at, ctx.now, `${s.name}: the record is stamped now`);
    eq(r.undo!.action, s.command.action, `${s.name}: the record names the action`);
    eq(r.undo!.scope, scope.startsWith('app') ? 'app:app' : scope, `${s.name}: the record names the scope`);
    eq(strip({ own: r.undo!.own, skin: r.undo!.skin, scopes: r.undo!.scopes }), strip({ own: before.look.own, skin: before.look.skin, scopes: before.look.scopes }), `${s.name}: the record is the look before`);
    if (scope === 'hub') eq(strip(r.undo!.global), strip(before.global), `${s.name}: a hub record keeps the hub-wide skin before`); else ok(!('global' in r.undo!), `${s.name}: only a hub record carries global`);
    // the older reader (Restore's undo) gives the same look back
    eq(strip({ ...undoRestore(r.look!), undo: null }), strip({ ...before.look, undo: null }), `${s.name}: undoRestore reads the record too`);
  }
  if (r.ok && !r.changed.look) { ok(r.look === before.look, `${s.name}: nothing changed: the same document`); eq(r.undo, null, `${s.name}: nothing changed: no record`); }
  if (r.ok) { ok(!(SKIN_COLOR_SLOT in r.look!.skin.overrides) && Object.values(r.look!.scopes).every((st) => !(SKIN_COLOR_SLOT in st.overrides)) && !(r.global && SKIN_COLOR_SLOT in (r.global.overrides ?? {})), `${s.name}: the colour theme is never an override`); }
  cur = { look: r.look!, global: r.global };
  by[s.name] = { ...s, before, result: r };
}
eq(JSON.stringify(fx.skins), frozenSkins, "the skins' own data is never written to");

/* ---- scope precedence: plugin → ui → app → global ---- */
{
  const place = { app: 'app', ui: 'home', plugin: 'notes' };
  const a = by.useApp!.result;
  eq(resolveLookSkin(a.look, a.global, place), { id: 'windows', overrides: {}, from: 'app' }, 'use at the app: the app skin everywhere in the app');
  const p = by.usePlugin!.result;
  eq(resolveLookSkin(p.look, p.global, place), { id: 'aurora', overrides: {}, from: 'plugin:notes' }, 'use at the plugin: the plugin skin inside the plugin');
  eq(resolveLookSkin(p.look, p.global, { app: 'app', ui: 'home' }), { id: 'windows', overrides: {}, from: 'app' }, 'outside the plugin the app skin holds');
  eq(composeLookAt(fx.shared, p.look, skinOf, place).doc.slots!['color-theme'], 'aurora-night', 'drawn inside the plugin: the plugin skin');
  eq(composeLookAt(fx.shared, p.look, skinOf).doc.slots!['color-theme'], 'windows-light', 'drawn at the app: the app skin');
  const h = by.useHub!.result;
  eq(h.global, { id: 'aurora', overrides: {} }, 'use at the hub: the hub-wide skin');
  eq(resolveLookSkin(h.look, h.global, { app: 'app', ui: 'home' }), { id: 'windows', overrides: {}, from: 'app' }, 'an app with its own skin ignores the hub-wide one');
  eq(resolveLookSkin(h.look, h.global, place).from, 'plugin:notes', 'and the plugin keeps its own');
  const following = setInheritSkin(look0, true);
  eq(resolveLookSkin(following, h.global, place), { id: 'aurora', overrides: {}, from: 'global' }, 'an app that follows takes the hub-wide skin');
  eq(fx.views.following.inForce.from, 'global', 'view: following = the global level decided');
  eq(fx.views.followingNoHub.inForce, { id: '', overrides: {}, from: 'global' }, 'view: following with no hub-wide skin = none');
  eq(fx.views.plugin.inForce.from, 'plugin:notes', 'view: the plugin decided inside the plugin');
  eq(fx.views.ui.inForce.from, 'app', 'view: a UI that inherits shows the app skin');
  eq(fx.views.ui.state, { use: 'inherit', id: '', overrides: {} }, 'view: and says it inherits');
  eq(fx.views.hub.inForce, { id: 'aurora', overrides: {}, from: 'global' }, 'view: the hub');
  eq(fx.views.app, fx.views.appBare, 'app:<id> and app read the same');
  eq(fx.views.otherApp, null, 'another app\'s scope is not in this document');
  eq(fx.views.badScope, null, 'a junk scope has no view');
  eq(fx.views.noDocument, null, 'no document: no app view');
  eq(fx.views.noDocumentHub.scope, 'hub', 'no document: the hub still reads');
  eq(fx.views.unknownInForce.known, false, 'a skin the app lacks is marked');
  for (const [k, v] of Object.entries(fx.views as Record<string, { contract?: string; canUndo?: boolean; overridden?: string[] } | null>)) if (v) { eq(v.contract, SKIN_SWITCH_CONTRACT, `view ${k}: contract`); ok(Array.isArray(v.overridden), `view ${k}: overridden list`); }
  eq(switchScopes(p.look), ['hub', 'app:app', 'plugin:notes'], 'the scopes a document names');
  eq(fx.scopesOf, { bare: ['hub', 'app:app'], withPlugin: ['hub', 'app:app', 'plugin:notes'], none: ['hub'] }, 'scopesOf = fixture');
}

/* ---- back-to-skin clears only the overridden part ---- */
{
  const s = by.backSlot!;
  const b = s.before.look; const a = s.result.look!;
  eq(b.skin.overrides, { button: 'terminal', dialog: 'app-dialog' }, 'before: two overrides at the app');
  eq(a.skin.overrides, { dialog: 'app-dialog' }, 'back on one slot: only that override goes');
  eq(a.skin.colorTheme, 'plum-noir', 'the colour theme pick stays');
  eq([a.skin.use, a.skin.id, a.skin.inherit], [b.skin.use, b.skin.id, b.skin.inherit], 'Use skin and the skin stay');
  eq(a.scopes, b.scopes, 'no scope moves');
  eq(a.own, b.own, "the app's own look does not move");
  eq(s.result.global, s.before.global, 'the hub-wide skin does not move');
  eq(s.view, { ...(s.view as object), overridden: ['dialog'] }, 'the overridden dot list shows what is left');
  const c = by.backColour!;
  ok(!('colorTheme' in c.result.look!.skin), 'back on the colour slot: the skin\'s own colours');
  eq(c.result.look!.skin.overrides, c.before.look.skin.overrides, 'and the overrides stay');
  const pa = by.backPluginAll!;
  eq(pa.result.look!.scopes['plugin:notes'], { use: 'on', id: 'aurora', overrides: {} }, 'back at a plugin with no slot: its overrides go, its skin stays on');
  eq(pa.result.look!.scopes['ui:home'], pa.before.look.scopes['ui:home'], 'another scope keeps its override');
  eq(pa.result.look!.skin, pa.before.look.skin, 'the app level does not move');
  const hs = by.backHubSlot!;
  eq(hs.result.global, { id: 'aurora', overrides: {}, colorTheme: 'harbor' }, 'back at the hub on one slot: that override goes, the colour pick stays');
  eq(strip({ ...hs.result.look, undo: null }), strip({ ...hs.before.look, undo: null }), 'a hub back leaves the document alone (but for the record)');
  const ha = by.backHubAll!;
  eq(ha.result.global, { id: 'aurora', overrides: {} }, 'back at the hub with no slot: overrides and colour pick go, the skin stays');
  const aa = by.backAppAll!;
  eq(aa.result.look!.skin, { use: true, inherit: false, id: 'windows', overrides: {} }, 'back at the app with no slot: every override goes, the skin stays on');
  eq(aa.result.look!.scopes, aa.before.look.scopes, 'the scopes stay');
}

/* ---- undo after restore, at every scope ---- */
{
  const r = by.restoreApp!;
  eq(r.result.look!.skin, { use: false, inherit: false, id: 'windows', overrides: {} }, 'restore at the app: Use skin off, the pick kept');
  eq([r.result.look!.own, r.result.look!.scopes], [{}, {}], 'restore at the app: the snapshot, every scope inheriting');
  eq(r.result.undo!.action, 'restore-default', 'the record says Restore');
  eq(strip(r.result.look), strip({ ...restoreAppDefault(r.before.look, ctx.now), undo: r.result.undo }), 'restore at the app = restoreAppDefault with the richer record');
  const u = by.undoRestoreApp!;
  eq(strip({ ...u.result.look, undo: null }), strip({ ...r.before.look, undo: null }), 'undo after restore: the look before, exactly');
  eq(u.result.look!.undo, null, 'and no record left');
  eq(u.result.changed, { look: true, global: false }, 'undo at the app touches the document only');
  eq(by.undoAgain!.result.error, 'nothing-to-undo', 'a second undo does nothing');
  const rh = by.restoreHub!;
  eq(rh.result.global, null, 'restore at the hub: no hub-wide skin');
  eq(rh.result.undo!.global, { id: 'aurora', overrides: {} }, 'the record keeps the hub-wide skin before');
  eq(rh.result.changed, { look: true, global: true }, 'the document is saved for the record, the shared document for the skin');
  const uh = by.undoRestoreHub!;
  eq(uh.result.global, rh.before.global, 'undo after a hub restore: the hub-wide skin is back');
  eq(uh.result.changed.global, true, 'and the shared document moves');
  eq(strip({ ...uh.result.look, undo: null }), strip({ ...rh.before.look, undo: null }), 'the document is as before');
  const rp = by.restorePlugin!;
  ok(!('plugin:notes' in rp.result.look!.scopes), 'restore at a plugin: the scope entry goes (inherit)');
  eq(rp.result.look!.skin, rp.before.look.skin, 'the app skin does not move');
  eq(rp.result.look!.scopes['ui:home'], rp.before.look.scopes['ui:home'], 'another scope does not move');
  eq((rp.view as { inForce: { from: string } }).inForce.from, 'app', 'the plugin now shows the app skin');
  const up = by.undoRestorePlugin!;
  eq(up.result.look!.scopes, rp.before.look.scopes, 'undo after a plugin restore: the scope is back');
  const ru = by.restoreUi!;
  ok(!('ui:home' in ru.result.look!.scopes), 'restore at a UI: its entry goes');
  // undo after use: the previous skin comes back
  eq(by.useOtherApp!.result.look!.skin.id, 'aurora', 'use another skin at the app');
  eq(by.undoUse!.result.look!.skin.id, 'windows', 'undo: the previous skin');
  // the record Restore left before skin-switch@1 (no action, no scope) still undoes
  eq(fx.legacyUndo.ok, true, 'an older record undoes');
  eq(fx.legacyUndo.look.skin, { use: true, inherit: false, id: 'windows', overrides: {} }, 'and brings the skin back');
  eq(fx.legacyUndo.look.undo, null, 'one undo only');
  const legacyDoc = restoreAppDefault(by.useApp!.result.look!, '2026-11-12T00:00:00Z');
  eq(strip(skinSwitch({ look: legacyDoc, global: null }, { action: 'undo', scope: 'app:app' }, ctx)), strip(fx.legacyUndo), 'legacyUndo = fixture');
  eq(skinSwitchState(legacyDoc, null, 'app:app')!.undo, { action: 'restore-default', scope: 'app:app', at: '2026-11-12T00:00:00Z' }, 'an older record reads as Restore at the app');
}

/* ---- one record, same skin keeps its picks, refusals ---- */
{
  const picked = setSkinColorTheme(setLookSlot(by.useApp!.result.look!, 'button', 'terminal'), 'plum-noir');
  const same = skinSwitch({ look: picked, global: null }, { action: 'use', scope: 'app:app', skin: 'windows' }, ctx);
  ok(same.ok && !same.changed.look, 'use of the skin already on changes nothing');
  const other = skinSwitch({ look: picked, global: null }, { action: 'use', scope: 'app:app', skin: 'aurora' }, ctx);
  eq(other.look!.skin, { use: true, inherit: false, id: 'aurora', overrides: {} }, 'another skin starts clean: no overrides, its own colours');
  const back = skinSwitch({ look: other.look!, global: null }, { action: 'use', scope: 'app:app', skin: 'windows' }, ctx);
  eq(back.look!.skin, { use: true, inherit: false, id: 'windows', overrides: {} }, 'and back to the first starts clean too (use is a pick, undo is the way back)');
  const undone = skinSwitch({ look: other.look!, global: null }, { action: 'undo', scope: 'app:app' }, ctx);
  eq(undone.look!.skin, picked.skin, 'undo brings the overrides and the colour pick back with the skin');
  ok(Object.keys(other.look!).filter((k) => k === 'undo').length === 1 && other.look!.undo && !('undo' in other.look!.undo), 'one record, never a chain');
  const offApp = setUseSkin(by.useApp!.result.look!, false);
  const useOff = skinSwitch({ look: offApp, global: null }, { action: 'use', scope: 'app:app', skin: 'windows' }, ctx);
  eq(useOff.look!.skin.use, true, 'use turns Use skin on');
  const hubSame = skinSwitch({ look: look0, global: { id: 'aurora', overrides: { button: 'x' }, colorTheme: 'harbor' } }, { action: 'use', scope: 'hub', skin: 'aurora' }, ctx);
  ok(hubSame.ok && !hubSame.changed.global && !hubSame.changed.look, 'use of the hub-wide skin already on changes nothing');
  const hubOther = skinSwitch({ look: look0, global: { id: 'aurora', overrides: { button: 'x' }, colorTheme: 'harbor' } }, { action: 'use', scope: 'hub', skin: 'windows' }, ctx);
  eq(hubOther.global, { id: 'windows', overrides: {} }, 'another hub-wide skin starts clean');
  eq(hubOther.undo!.global, { id: 'aurora', overrides: { button: 'x' }, colorTheme: 'harbor' }, 'the record keeps the one before, picks included');
  eq(fx.noDocument.error, 'no-document', 'no document: refused');
  eq(skinSwitch({ look: look0, global: null }, { action: 'use', scope: 'app:app', skin: 'nope' }, ctx).error, 'unknown-skin', 'a skin the app lacks is refused');
  eq(skinSwitch({ look: look0, global: null }, { action: 'use', scope: 'app:app', skin: 'nope' }).ok, true, 'without a registry every id is taken (the caller checks)');
  eq(skinSwitch({ look: look0, global: null }, { action: 'use', scope: 'app:other', skin: 'windows' }, ctx).error, 'other-app', "another app's scope is refused");
  eq(skinSwitch({ look: look0, global: null }, { action: 'back-to-skin', scope: 'ui:home' }, ctx).changed, { look: false, global: false }, 'back at a scope with nothing: no change');
  eq(skinSwitch({ look: look0, global: null }, { action: 'restore-default', scope: 'hub' }, ctx).changed, { look: false, global: false }, 'restore at a hub with no skin: no change');
  eq(skinSwitch({ look: look0, global: null }, { action: 'back-to-skin', scope: 'app:app', slot: 'Bad Slot' }, ctx).error, 'bad-slot', 'a junk slot is refused');
  // a hub record from an app that follows: undo puts the hub-wide skin back and leaves the document's picks alone
  const following = setSkinColorTheme(setInheritSkin(look0, true), 'plum-noir');
  const hubOff = skinSwitch({ look: following, global: { id: 'aurora', overrides: {} } }, { action: 'restore-default', scope: 'hub' }, ctx);
  eq(resolveLookSkin(hubOff.look, hubOff.global, null).id, '', 'the following app shows no skin after a hub restore');
  const hubBack = skinSwitch({ look: hubOff.look, global: hubOff.global }, { action: 'undo', scope: 'hub' }, ctx);
  eq(hubBack.global, { id: 'aurora', overrides: {} }, 'undo: the hub-wide skin is back');
  eq(hubBack.look!.skin.colorTheme, 'plum-noir', "the app's own pick inside it was never touched");
}

/* ---- wired into CI ---- */
ok(readFileSync(join(root, '../.github/workflows/android.yml'), 'utf8').includes('framework/spec/check-skin-switch.mts'), 'CI runs this check');

console.log(`check-skin-switch: ${n} checks passed`);
