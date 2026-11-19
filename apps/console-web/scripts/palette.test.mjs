// Command palette rules: node apps/console-web/scripts/palette.test.mjs
// What the Ctrl+K palette lists and what Enter does (src/control/palette-core.mjs): decisions and owner-only settings are
// never listed, destructive presses ask first, functions and buttons are pressed and everything else focused, the last
// picks come first, and the look is one of its three dialog assets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECIDING_RE, PALETTE_LOOKS, RECENT_MAX, destructive, listable, paletteLook, pushRecent, verbFor, withRecentFirst } from '../src/control/palette-core.mjs';

let n = 0;
const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const here = new URL('.', import.meta.url).pathname;

t('approve / deny / reject / veto are never listed, nor person-only commands', () => {
  for (const a of ['function:approvals.approve', 'function:approvals.deny', 'function:builds.reject', 'button:veto', 'function:gate.sign-off']) assert.equal(listable({ address: a, kind: 'function', label: a }), false, a);
  assert.equal(listable({ address: 'function:approvals.open', kind: 'function', label: 'Open approvals' }), true);
  assert.equal(listable({ address: 'function:x.run', kind: 'function', label: 'x' }, { personOnly: true }), false);
  assert.equal(listable({ address: 'function:dialog', kind: 'function', label: 'd', value: 'approvals.approve' }), false, 'the argument counts too');
  assert.ok(DECIDING_RE.test('approve'));
});

t('owner-only settings are never listed; ordinary ones are', () => {
  assert.equal(listable({ address: 'setting:axf.lock.hubskin', kind: 'setting', label: 'Lock' }, { ownerRaise: true }), false);
  assert.equal(listable({ address: 'setting:x', kind: 'setting', label: 'x' }, { personOnly: true }), false);
  assert.equal(listable({ address: 'setting:x', kind: 'setting', label: 'x' }, { locked: true }), false);
  assert.equal(listable({ address: 'setting:plan-studio-2.showDone', kind: 'setting', label: 'Show done' }), true);
  assert.equal(listable({ address: 'view:plan-studio-2', kind: 'view', label: 'Plan Studio 2.0' }), true);
});

t('destructive presses ask first; navigation never does', () => {
  assert.equal(destructive({ address: 'function:snapshots.delete', kind: 'function', label: 'Delete' }), true);
  assert.equal(destructive({ address: 'function:plan-studio-2.clear', kind: 'function', label: 'Clear' }), true);
  assert.equal(destructive({ address: 'function:x.go', kind: 'function', label: 'x' }, { destructive: true }), true);
  assert.equal(destructive({ address: 'function:plan-studio-2.open', kind: 'function', label: 'Open' }), false);
  assert.equal(destructive({ address: 'view:settings', kind: 'view', label: 'Settings' }), false);
});

t('Enter presses functions and buttons, focuses the rest', () => {
  assert.equal(verbFor({ kind: 'function' }), 'press'); assert.equal(verbFor({ kind: 'button' }), 'press');
  for (const k of ['view', 'tab', 'subtab', 'setting', 'plugin', 'row', 'step']) assert.equal(verbFor({ kind: k }), 'focus', k);
});

t('recent picks: newest first, no repeats, capped, listed before the ranking', () => {
  let r = [];
  for (let i = 0; i < RECENT_MAX + 3; i++) r = pushRecent(r, { address: `view:v${i}`, kind: 'view', label: `V${i}` });
  assert.equal(r.length, RECENT_MAX); assert.equal(r[0].address, `view:v${RECENT_MAX + 2}`);
  r = pushRecent(r, { address: 'view:v5', kind: 'view', label: 'V5' });
  assert.equal(r[0].address, 'view:v5'); assert.equal(r.filter((x) => x.address === 'view:v5').length, 1);
  const hits = [{ address: 'view:a', kind: 'view', label: 'A' }, { address: 'view:v5', kind: 'view', label: 'V5' }, { address: 'view:b', kind: 'view', label: 'B' }];
  const out = withRecentFirst(hits, r);
  assert.deepEqual(out.map((h) => h.address), ['view:v5', 'view:a', 'view:b']); assert.equal(out[0].recent, true); assert.equal(out[1].recent, undefined);
  assert.notEqual(pushRecent([], { address: 'function:d', kind: 'function', label: 'D', value: 'x' })[0].value, undefined, 'keeps the argument');
});

t('three looks, each a dialog asset of the console; an unknown pick falls back to the first', () => {
  assert.equal(PALETTE_LOOKS.length, 3);
  assert.equal(paletteLook('nope'), PALETTE_LOOKS[0]); assert.equal(paletteLook('command-palette-sheet'), 'command-palette-sheet');
  for (const id of PALETTE_LOOKS) {
    const a = JSON.parse(readFileSync(join(here, '../src/assets/dialog', `${id}.json`), 'utf8'));
    assert.equal(a.$axf, 'asset@1'); assert.equal(a.type, 'dialog'); assert.equal(a.id, id);
    for (const k of ['variant', 'width', 'backdrop', 'animation', 'header', 'closeOnBackdrop']) assert.ok(k in a.data, `${id}: ${k}`);
  }
});

t('one palette: Ctrl+K belongs to SearchPalette only, the banner carries its Search button', () => {
  const pal = readFileSync(join(here, '../src/control/SearchPalette.tsx'), 'utf8');
  assert.match(pal, /addEventListener\('keydown', onKey, true\)/); assert.match(pal, /attachToBanner\(/); assert.match(pal, /listable\(/);
  const menu = readFileSync(join(here, '../src/menuLibrary.tsx'), 'utf8');
  assert.doesNotMatch(menu, /e\.key\.toLowerCase\(\) !== 'k'/, 'no second Ctrl+K handler');
});

console.log(`palette: ${n} checks passed`);
