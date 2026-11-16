#!/usr/bin/env node
// build-id@1 — internal build names are at most 40 characters (vps.build_start / build_land / build_stop / build_clean
// accept only ^[a-z0-9][a-z0-9-]{0,39}$). Pure core and the framework stores' id makers; the orchestrator's own id
// makers and CLIs are checked by the plugin (its build-id.test.mjs).
//   node framework/spec/check-build-id.mjs
import assert from 'node:assert/strict';
import * as id from '../core/build-id.mjs';
import * as store from '../plan/builds-store-core.mjs';
import * as pending from '../plan/pending-core.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LONG = 'One to-do notes and tasks plugin in the console, take it out of AmberX';
const TITLES = [
  LONG, 'axhub-raise-per-project-memory-file-cap-from-500-to-750', 'Internal build names: 40 characters max', 'x', '', '   ', '!!!',
  'Ünïcödé títle with àccents and a very long tail that goes on and on and on', 'a-'.repeat(60), 'supercalifragilisticexpialidocious-antidisestablishmentarianism',
  'The the the the the the the the the the the the the the the', '--leading and trailing dashes--', 'UPPER CASE 123 456 789 000 111 222 333 444',
  'Fix PR #557: professional skins (light & dark) — every skin ships both', 'x.android.modules', '0123456789012345678901234567890123456789012345',
];

t('pattern: the shared RE is the vps tools\' pattern', () => { assert.equal(String(id.BUILD_ID_RE), String(RE)); assert.equal(id.BUILD_ID_MAX, 40); });
t('shortBuildId: every title gives a valid name', () => { for (const s of TITLES) assert.match(id.shortBuildId(s), RE, JSON.stringify(s)); });
t('shortBuildId: random titles always give a valid name', () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz ABC-_.:/0123456789éü  ';
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 2000; i++) { const len = Math.floor(rnd() * 160); let s = ''; for (let k = 0; k < len; k++) s += chars[Math.floor(rnd() * chars.length)]; assert.match(id.shortBuildId(s), RE, JSON.stringify(s)); }
});
t('shortBuildId: short titles are the plain slug; long ones keep key words and cut at a dash', () => {
  assert.equal(id.shortBuildId('Internal build names: 40 characters max'), 'internal-build-names-40-characters-max');
  assert.equal(id.shortBuildId(LONG), 'one-to-do-notes-tasks-plugin-console');
  assert.equal(id.shortBuildId('axhub-raise-per-project-memory-file-cap-from-500-to-750'), 'axhub-raise-per-project-memory-file-cap');
  assert.equal(id.shortBuildId('The the the the'), 'the-the-the-the', 'filler is dropped only when the slug is too long');
  assert.equal(id.shortBuildId('0123456789012345678901234567890123456789012345'), '0123456789012345678901234567890123456789', 'one word over 40 is cut mid-word');
  assert.equal(id.shortBuildId(''), 'build'); assert.equal(id.shortBuildId('!!!'), 'build');
});
t('uniqueBuildId: a collision gets -2, -3 and still fits 40', () => {
  const taken = new Set();
  const a = id.uniqueBuildId(LONG, taken); taken.add(a);
  const b = id.uniqueBuildId(`${LONG} again`, taken); taken.add(b);
  const c = id.uniqueBuildId(LONG, taken); taken.add(c);
  assert.equal(a, 'one-to-do-notes-tasks-plugin-console'); assert.equal(b, 'one-to-do-notes-tasks-plugin-console-2'); assert.equal(c, 'one-to-do-notes-tasks-plugin-console-3');
  const full = 'aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhhh';
  const d = id.uniqueBuildId(full, new Set([full])); assert.match(d, RE); assert.ok(d.endsWith('-2')); assert.ok(d.length <= 40);
  const many = new Set(); for (let i = 0; i < 150; i++) { const x = id.uniqueBuildId(full, many); assert.match(x, RE); assert.ok(!many.has(x)); many.add(x); }
  assert.equal(id.uniqueBuildId('alpha', (x) => x === 'alpha'), 'alpha-2', 'a predicate works as `taken`');
});
t('planAliases: long and dotted ids get a valid alias that collides with nothing', () => {
  const builds = [{ id: 'one-to-do-notes-tasks-plugin-console' }, { id: 'one-to-do-notes-and-tasks-plugin-in-the-console-take-it-out-of-amberx' }, { id: 'x.android.modules' }, { id: 'ok-id' }, { id: 'had-one-already-but-it-is-a-very-long-identifier-now', alias: 'had-one' }];
  const p = id.planAliases(builds);
  assert.deepEqual(p.map((x) => x.id), ['one-to-do-notes-and-tasks-plugin-in-the-console-take-it-out-of-amberx', 'x.android.modules']);
  assert.equal(p[0].alias, 'one-to-do-notes-tasks-plugin-console-2'); assert.equal(p[1].alias, 'x-android-modules');
  for (const x of p) assert.match(x.alias, RE);
});

// ---------------- the stores' id makers
t('builds store: normBuild with no id makes a valid one; the title is kept whole; alias kept only when valid', () => {
  const b = store.normBuild({ title: LONG }); assert.match(b.id, RE); assert.equal(b.title, LONG);
  assert.equal(store.normBuild({ id: 'a-very-long-old-identifier-made-before-the-forty-character-rule', alias: 'old-id', title: 't' }).alias, 'old-id');
  assert.equal(store.normBuild({ id: 'x', alias: 'Not Valid!', title: 't' }).alias, undefined);
  assert.equal(store.normBuild({ id: 'same', alias: 'same', title: 't' }).alias, undefined, 'an alias equal to the id is dropped');
});
t('builds store: findBuild answers to the alias', () => {
  const s = store.normalizeStore({ builds: [{ id: 'one-to-do-notes-and-tasks-plugin-in-the-console-take-it-out-of-amberx', alias: 'one-to-do-notes-tasks-plugin-console', title: LONG }] });
  assert.equal(store.findBuild(s, 'one-to-do-notes-tasks-plugin-console')?.title, LONG);
  assert.equal(store.findBuild(s, 'one-to-do-notes-and-tasks-plugin-in-the-console-take-it-out-of-amberx')?.title, LONG);
});
t('pending list: add from a long title → valid id; the same title twice gets a suffix', () => {
  const one = pending.apply(pending.normalizeState({ items: [] }), { action: 'add', title: LONG });
  assert.match(one.item.id, RE); assert.equal(one.item.title, LONG);
  const two = pending.apply(one.state, { action: 'add', title: LONG });
  assert.equal(two.item.id, `${one.item.id}-2`); assert.match(two.item.id, RE); assert.equal(two.item.title, LONG);
});

console.log(`build-id: ${n} checks passed`);
