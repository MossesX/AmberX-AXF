#!/usr/bin/env node
/** Bugs board self-test: the bugs@1 core (changes, merge, optimizer, handoffs, board groups) and the CLI on a temp file. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as c from './web/bugs-core.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log(`ok ${n} ${name}`); };
const AT = '2026-11-04T12:00:00.000Z';
const B = (id, extra = {}) => ({ id, title: id.replace(/-/g, ' '), status: 'pending', live: 'pending', profile: 'current', profiles: ['current'], steps: 4, done: 1, files: [], text: '', updatedAt: AT, ...extra });
const builds = [
  B('terminal-tabs-left', { title: 'Terminal tabs on the left', text: 'console-terminal settings opens tab', files: ['apps/console-web/plugins/console-terminal/web/ui.tsx'], agent: 'paulie' }),
  B('main-area-tabs', { title: 'Main area tab group', text: 'windows size positions float dock resize', live: 'running', agent: 'lenny' }),
  B('hotfix-build-manager', { status: 'built', live: 'built', pr: '#307' }), // theme-ok: a PR number, not a colour
  B('land-round-2', { live: 'queued', queuePos: 2 }),
];
const add = (f, bug) => c.apply(f, { action: 'add', bug }, { at: AT, by: 'brett' }).file;

ok('add: confirmed, unassigned, on top, with history', () => {
  let f = c.emptyFile();
  f = add(f, { title: 'One' }); f = add(f, { title: 'Two', severity: 'urgent' });
  const [top] = c.sorted(c.live(f));
  assert.equal(top.title, 'Two'); assert.equal(top.status, 'confirmed'); assert.equal(top.build, ''); assert.equal(top.history[0].what, 'added');
  assert.deepEqual(c.validate(f), []);
  assert.throws(() => c.apply(f, { action: 'add', bug: {} }), /title/);
});

ok('move: into a queued/running build only; status follows; recorded', () => {
  let f = add(c.emptyFile(), { id: 'b-x', title: 'Windows forget their size' });
  const r = c.apply(f, { action: 'move', id: 'b-x', build: 'main-area-tabs' }, { at: AT, builds });
  assert.equal(r.file.bugs[0].status, 'in-build'); assert.deepEqual(r.moved, [{ bug: 'b-x', from: '', to: 'main-area-tabs' }]);
  assert.throws(() => c.apply(r.file, { action: 'move', id: 'b-x', build: 'hotfix-build-manager' }, { builds }), /queued or running/);
  f = c.apply(r.file, { action: 'move', id: 'b-x', build: '' }, { at: AT, builds }).file;
  assert.equal(f.bugs[0].status, 'confirmed');
});

ok('reorder: by ids and by before', () => {
  let f = c.emptyFile(); for (const t of ['a', 'b', 'c']) f = add(f, { id: t, title: t });
  f = c.apply(f, { action: 'reorder', ids: ['a', 'b', 'c'] }).file;
  assert.deepEqual(c.sorted(c.live(f)).map((x) => x.id), ['a', 'b', 'c']);
  f = c.apply(f, { action: 'reorder', id: 'c', before: 'a' }).file;
  assert.deepEqual(c.sorted(c.live(f)).map((x) => x.id), ['c', 'a', 'b']);
  f = c.apply(f, { action: 'reorder', id: 'c', before: '' }).file;
  assert.deepEqual(c.sorted(c.live(f)).map((x) => x.id), ['a', 'b', 'c']);
});

ok('merge: newer bug wins, tombstones stay, settings by settingsAt', () => {
  const a = add(c.emptyFile(), { id: 'b1', title: 'old' });
  const b = c.apply(a, { action: 'update', id: 'b1', patch: { title: 'new' } }, { at: '2026-11-04T13:00:00Z' }).file;
  const del = c.apply(a, { action: 'remove', id: 'b1' }, { at: '2026-11-04T14:00:00Z' }).file;
  assert.equal(c.mergeFiles(a, b).bugs[0].title, 'new');
  assert.equal(c.mergeFiles(b, a).bugs[0].title, 'new');
  assert.equal(c.live(c.mergeFiles(b, del)).length, 0);
  const s = c.apply(a, { action: 'settings', values: { autoOptimize: true, maxPerBuild: 99 } }, { at: AT }).file;
  assert.equal(c.mergeFiles(a, s).settings.autoOptimize, true); assert.equal(s.settings.maxPerBuild, 20);
});

ok('optimizer: words/area/files, never into built builds, per-build cap, preview + undo', () => {
  let f = c.emptyFile();
  f = add(f, { id: 'b-wording', title: "Terminal 'Opens in' description wording", app: 'console-web', area: 'console-terminal', tags: ['terminal'] });
  f = add(f, { id: 'b-size', title: "Windows don't remember their size", area: 'windows', tags: ['resize'] });
  f = add(f, { id: 'b-nope', title: 'Zebra quokka' });
  const p = c.optimize(f, builds, { profile: 'current', now: Date.parse(AT) });
  assert.deepEqual(p.moves.map((m) => [m.bug, m.to]).sort(), [['b-size', 'main-area-tabs'], ['b-wording', 'terminal-tabs-left']]);
  assert.deepEqual(p.unclear, ['b-nope']);
  assert.ok(!p.moves.some((m) => m.to === 'hotfix-build-manager'));
  const capped = c.optimize(c.apply(f, { action: 'settings', values: { maxPerBuild: 1 } }).file, [builds[1]], { now: Date.parse(AT) });
  assert.ok(capped.moves.length <= 1);
  const r = c.apply(f, { action: 'apply-moves', moves: p.moves }, { at: AT, builds });
  assert.equal(c.live(r.file).filter((b) => b.build).length, 2);
  const u = c.apply(r.file, { action: 'undo' }, { at: AT });
  assert.equal(c.live(u.file).filter((b) => b.build).length, 0);
  assert.throws(() => c.apply(u.file, { action: 'undo' }), /nothing to undo/);
});

ok('optimizer: skips other profiles and stale builds unless asked', () => {
  const f = add(c.emptyFile(), { id: 'b', title: 'windows size resize' });
  const other = [B('w', { title: 'windows size resize', profile: 'angel', profiles: ['angel'] })];
  assert.equal(c.optimize(f, other, { profile: 'current', now: Date.parse(AT) }).moves.length, 0);
  const stale = [B('w', { title: 'windows size resize', updatedAt: '2026-01-01T00:00:00Z' })];
  assert.equal(c.optimize(f, stale, { profile: 'current', now: Date.parse(AT) }).moves.length, 0);
  assert.equal(c.optimize(c.apply(f, { action: 'settings', values: { scope: 'all' } }).file, other, { profile: 'current', now: Date.parse(AT) }).moves.length, 1);
});

ok('handoff: accept, bounce + reroute, ask Brett, forced, no agent', () => {
  const agents = { paulie: { id: 'paulie', name: 'Ping Paulie', works: true }, lenny: { id: 'lenny', name: "Landin' Lenny", works: true } };
  const agentOf = (id) => agents[builds.find((b) => b.id === id)?.agent] ?? null;
  const bug = c.normBug({ id: 'b1', title: 'Size bug', area: 'windows' });
  const st = c.normSettings({});
  const h1 = c.handoff({ bug, to: 'main-area-tabs', builds, bugs: [], settings: st, agentOf, candidates: () => [], at: AT });
  assert.equal(h1.accepted, true); assert.equal(h1.to, 'main-area-tabs');
  assert.match(h1.lines[0].text, /@Landin' Lenny/); assert.equal(h1.lines[1].from, 'lenny');
  // full build: Lenny bounces, Boss reroutes to Paulie, Paulie takes it
  const full = [1, 2, 3].map((i) => c.normBug({ id: `f${i}`, title: 'x', build: 'main-area-tabs', status: 'in-build' }));
  const h2 = c.handoff({ bug, to: 'main-area-tabs', builds, bugs: full, settings: st, agentOf, candidates: (ex) => [{ build: 'terminal-tabs-left' }].filter((x) => !ex.includes(x.build)), at: AT });
  assert.equal(h2.accepted, true); assert.equal(h2.to, 'terminal-tabs-left'); assert.deepEqual(h2.tried, ['main-area-tabs', 'terminal-tabs-left']);
  assert.ok(h2.lines.some((l) => l.from === 'boss' && /Ping Paulie/.test(l.text)));
  // ask mode: no reroute, Brett picks
  const h3 = c.handoff({ bug, to: 'main-area-tabs', builds, bugs: full, settings: c.normSettings({ whenBounced: 'ask' }), agentOf, candidates: () => [{ build: 'terminal-tabs-left' }], at: AT });
  assert.equal(h3.accepted, false); assert.equal(h3.needsBrett, true); assert.deepEqual(h3.candidates, ['terminal-tabs-left']);
  // Brett's drag stands even into a full build
  const h4 = c.handoff({ bug, to: 'main-area-tabs', builds, bugs: full, settings: st, agentOf, candidates: () => [], at: AT, force: true });
  assert.equal(h4.accepted, true); assert.equal(h4.lines[1].from, 'lenny');
  // no agent on the build: parked, no reply
  const h5 = c.handoff({ bug, to: 'land-round-2', builds, bugs: [], settings: st, agentOf, candidates: () => [], at: AT });
  assert.equal(h5.accepted, true); assert.equal(h5.lines.length, 1);
  // clean tone has no cussing
  const h6 = c.handoff({ bug, to: 'main-area-tabs', builds, bugs: full, settings: c.normSettings({ tone: 'clean', whenBounced: 'ask' }), agentOf, candidates: () => [], at: AT });
  assert.ok(h6.lines.every((l) => !/shit|damn/i.test(l.text)));
});

ok('decide: busy, broke and finishing agents bounce', () => {
  const st = c.normSettings({});
  assert.equal(c.decide(builds[1], [], st, { name: 'L', works: false, statusLabel: 'Off duty' }).ok, false);
  assert.equal(c.decide(builds[1], [], st, { name: 'L', works: true, broke: true }).ok, false);
  assert.equal(c.decide({ ...builds[1], finishing: true }, [], st, null).ok, false);
  assert.equal(c.decide(builds[1], [], st, { name: 'L', works: true }).ok, true);
});

ok('groups + chip: builds first, then Unassigned/Fixed; chip shows live state', () => {
  let f = add(c.emptyFile(), { id: 'u', title: 'loose' });
  f = add(f, { id: 'm', title: 'in build' }); f = c.apply(f, { action: 'move', id: 'm', build: 'main-area-tabs' }, { builds }).file;
  f = add(f, { id: 'x', title: 'done' }); f = c.apply(f, { action: 'fix', id: 'x', pr: '#1' }).file; // theme-ok: a PR number
  assert.deepEqual(c.groups(f, builds, { status: 'all' }).map((g) => g.label), ['Main area tab group', 'Unassigned', 'Fixed']);
  assert.deepEqual(c.groups(f, builds).map((g) => g.key), ['main-area-tabs', '~unassigned']);
  assert.match(c.chip({ ...builds[1], agentName: 'Lenny' }).text, /Running · Lenny · step 2\/4/);
  assert.match(c.chip(builds[3]).text, /#2 in line/);
  assert.match(c.chip(builds[2]).text, /awaiting merge #307/); // theme-ok: a PR number
});

ok('CLI: seed, list, move, settings, validate on a temp file (no side effects)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bugs-'));
  writeFileSync(join(dir, 'store.json'), JSON.stringify({ $axf: 'builds@1', rev: 0, builds: [] }));
  const envx = { ...process.env, AXF_BUGS_FILE: join(dir, 'bugs.json'), AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUGS_SIDE: '0', AXF_BUGS_LIVE: '0' };
  const cli = fileURLToPath(new URL('./bugs.mjs', import.meta.url));
  const run = (...a) => { const r = spawnSync(process.execPath, [cli, ...a, '--json'], { env: envx, encoding: 'utf8' }); const out = r.stdout.trim().split('\n').pop(); return JSON.parse(out || '{}'); };
  try {
    assert.equal(run('seed').added.length, 8);
    assert.equal(run('seed').added.length, 0);
    const v = run('list');
    assert.equal(v.ok, true); assert.equal(v.banner.open, 8);
    assert.ok(v.groups.some((g) => g.build === 'hotfix-build-manager' && g.items.length === 2));
    assert.equal(run('settings', 'maxPerBuild=2').settings.maxPerBuild, 2);
    const a = run('add', 'A test bug', '--app', 'console-web');
    assert.equal(a.ok, true);
    assert.equal(run('validate').ok, true);
    assert.equal(run('move', a.bug.id, 'no-such-build').ok, false);
    const j = JSON.parse(readFileSync(join(dir, 'bugs.json'), 'utf8'));
    assert.equal(j.$axf, 'bugs@1'); assert.equal(j.bugs.length, 9);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n${n} passed`);
