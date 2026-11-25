// node --test deploy/lander/test/line.test.mjs — Nov 24 2026: a green PR merges as it is (the build's own PR is the PR:
// no second PR, no second CI run), the landing states and the merge line go to the builds store with one update command
// per change, and "merge together" lands every waiting build through one PR. Real git, a fake GitHub, a memory store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sh, repo, github, build, clock, onMain, statuses, base, one, byId, holds, pushMain } from './helpers.mjs';

const { tick, files, readControl, consoleTarget, defaultNotify, lineRows, status } = await import('../run.mjs');
const { memoryStore } = await import('../store.mjs');
const G = await import('../git.mjs');
const L = await import('../lander-core.mjs');

const merges = (gh) => gh.calls.filter((c) => c.startsWith('PUT')).length;
const hand = { at: '2026-11-24T00:30:00.000Z', by: 'Sully' };
/** The session's own PR on its branch, opened before the lander ever saw the build. */
const ownPr = (gh, branch) => gh('POST', '/repos/o/r/pulls', { title: 'the session\'s own PR', head: branch, base: 'main', body: '' });
const recorder = () => { const sent = []; const notify = (e) => { sent.push(e); return true; }; notify.sent = sent; return notify; };

// ------------------------------------------------------------------ the build's own PR, merged as it is

test('PR 900 / 901: a hand build with its own green PR is merged on that PR, as it is, after main moved by a status sync', async () => {
  const r = repo({ 'claude/idle-fix': { 'fix.txt': 'fixed\n' } });
  const asked = []; const gh = github(r, (h) => { asked.push(h); return 'success'; });
  const pr = await ownPr(gh, 'claude/idle-fix');
  const head = sh(r.work, 'rev-parse', 'origin/claude/idle-fix');
  // main moved underneath: only the builds store's own status sync, [skip ci]
  mkdirSync(join(r.work, '_claude/builds'), { recursive: true });
  pushMain(r, { '_claude/builds/live.json': '{"rev":2}\n' }, 'Builds live: 206 build change(s) [skip ci]');
  const now = clock();
  const store = memoryStore([one('idle-fix', 'claude/idle-fix', { flow: 'pipeline-2', hand, branch: 'claude/idle-fix' })], { now });
  const out = await tick(base(r, gh, store, now));
  const b = store.list[0];
  assert.equal(out.error, ''); assert.equal(b.status, 'landed');
  assert.equal(gh.prs.size, 1, 'no second PR was opened');
  assert.equal(b.steps[0].prNumber, pr.number, 'the build\'s step is in its own PR'); assert.equal(b.pr, String(pr.number));
  assert.ok(!gh.calls.some((c) => c.startsWith('POST /pulls') && c !== 'POST /pulls') && gh.calls.filter((c) => c === 'POST /pulls').length === 1, 'the only PR ever opened is the session\'s');
  assert.ok(!gh.calls.some((c) => /dispatches|rerun/.test(c)), 'CI was not started again');
  assert.deepEqual([...new Set(asked)], [head], 'CI was read on the PR head as it was');
  assert.equal(b.landing.lastMerge.head, head, 'merged as it is: nothing was pulled into it');
  assert.equal(merges(gh), 1);
  assert.ok(sh(r.work, 'branch', '-r').split('\n').every((l) => !/origin\/lander\//.test(l)), 'no lander branch was made');
  assert.ok(out.actions.some((a) => /is the build's own .*no second PR/.test(a)));
  assert.ok(onMain(r, 'fix.txt'));
  assert.ok(!statuses(b).includes('failed'));
});

test('the build\'s own PR after real code landed on main: still merged as it is, first try', async () => {
  const r = repo({ 'claude/own': { 'own.txt': 'own\n' } });
  const gh = github(r); await ownPr(gh, 'claude/own');
  const head = sh(r.work, 'rev-parse', 'origin/claude/own');
  const moved = pushMain(r, { 'other.txt': 'someone else\n' });
  const now = clock(); const store = memoryStore([one('own', 'claude/own')], { now });
  await tick(base(r, gh, store, now));
  const b = store.list[0];
  assert.equal(b.status, 'landed'); assert.equal(b.landing.lastMerge.head, head); assert.ok(!holds(r, head, moved));
  assert.equal(gh.prs.size, 1); assert.equal(merges(gh), 1);
});

test('the build\'s own PR that GitHub refuses to merge: main is pulled into its branch, CI runs again, it merges; still one PR', async () => {
  const r = repo({ 'claude/own': { 'ops.log': 'from the build\n', 'own.txt': 'own\n' } });
  const asked = []; const gh = github(r, (h) => { asked.push(h); return 'success'; });
  await ownPr(gh, 'claude/own');
  const first = sh(r.work, 'rev-parse', 'origin/claude/own');
  const moved = pushMain(r, { 'ops.log': 'from main\n' });
  const now = clock(); const store = memoryStore([one('own', 'claude/own')], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'merge'); assert.equal(b.failure.retry, 'pull-main');
  assert.equal(sh(r.work, 'rev-parse', 'origin/claude/own'), first, 'it was tried as it was first');
  await tick(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed');
  assert.ok(holds(r, b.landing.lastMerge.head, moved), 'main went into the PR only after the refused merge');
  assert.ok(asked.includes(b.landing.lastMerge.head), 'CI was read on the new head');
  assert.equal(gh.prs.size, 1, 'never a second PR');
});

test('a build whose steps sit on several branches has no PR of its own: the lander makes its one PR, as before', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/b-s2': { 'b.txt': 'b\n' } });
  const gh = github(r); await ownPr(gh, 'claude/b-s1');
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
  await tick(base(r, gh, store, now));
  const b = store.list[0];
  assert.equal(b.status, 'landed'); assert.equal(gh.prs.get(b.steps[0].prNumber).head.ref, 'lander/b');
  assert.ok(onMain(r, 'a.txt') && onMain(r, 'b.txt'));
});

test('a draft PR of the build\'s own is marked ready and used; one that can\'t be is left alone and the lander opens its own', async () => {
  const r = repo({ 'claude/d': { 'd.txt': 'd\n' } });
  const inner = github(r); const pr = await ownPr(inner, 'claude/d'); pr.draft = true; pr.node_id = 'PR_node1';
  let ready = 0;
  const gh = Object.assign(async (m, p, body) => { if (m === 'POST' && p === '/graphql') { assert.equal(body.variables.id, 'PR_node1'); ready += 1; pr.draft = false; return { data: {} }; } return inner(m, p, body); }, inner);
  const now = clock(); const store = memoryStore([one('d', 'claude/d')], { now });
  await tick(base(r, gh, store, now));
  assert.equal(store.list[0].status, 'landed'); assert.equal(ready, 1); assert.equal(inner.prs.size, 1);

  const r2 = repo({ 'claude/d': { 'd.txt': 'd\n' } });
  const gh2 = github(r2); const pr2 = await ownPr(gh2, 'claude/d'); pr2.draft = true; // the fake has no /graphql: it throws
  const store2 = memoryStore([one('d', 'claude/d')], { now });
  await tick(base(r2, gh2, store2, now));
  assert.equal(store2.list[0].status, 'landed'); assert.equal(gh2.prs.size, 2, 'the lander\'s own PR landed it');
});

// ------------------------------------------------------------------ landing states and the update command

test('every landing state is written to the store and followed by ONE update command: merging, running-ci, landed', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let ci = 'running'; const gh = github(r, () => ci);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']], { rev: 4 })], { now });
  const notify = recorder();
  const opts = base(r, gh, store, now, { notify });
  await tick(opts);
  assert.equal(L.landingState(store.list[0]), 'running-ci');
  assert.deepEqual(notify.sent.map((e) => e.state), ['waiting-to-merge', 'merging', 'running-ci'], 'one command per change of state: its place in the line, then the three merging phases as one state, then CI');
  for (const e of notify.sent) { assert.equal(e.build, 'b'); assert.ok(e.at); assert.equal(typeof e.rev, 'number'); assert.deepEqual(Object.keys(e).sort(), ['at', 'build', 'rev', 'state'], 'the command carries no step data'); }
  // a tick that changes nothing sends nothing
  now.add(1); await tick(opts);
  assert.equal(notify.sent.length, 3);
  ci = 'success'; now.add(1); await tick(opts);
  assert.equal(store.list[0].status, 'landed');
  assert.deepEqual(notify.sent.map((e) => e.state), ['waiting-to-merge', 'merging', 'running-ci', 'merging', 'landed']);
});

test('a red run is `failed` with the landing run\'s attempt N in the store and in the command', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r, () => 'failure');
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const notify = recorder();
  await tick(base(r, gh, store, now, { notify }));
  const b = store.list[0];
  assert.equal(L.landingState(b), 'failed'); assert.equal(b.landing.attempt, 1);
  assert.deepEqual(notify.sent.at(-1), { build: 'b', state: 'failed', rev: 0, at: notify.sent.at(-1).at, attempt: 1 });
});

test('the update command never blocks or fails a landing: a console that is down, slow or throwing changes nothing', async () => {
  for (const notify of [() => { throw new Error('console down'); }, async () => { throw new Error('ECONNREFUSED'); }, () => new Promise((res) => setTimeout(() => res(false), 30))]) {
    const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
    const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
    const out = await tick(base(r, gh, store, now, { notify }));
    assert.equal(out.error, ''); assert.equal(store.list[0].status, 'landed');
  }
});

test('the default command: POST <console>/api/builds/updated with the console token, from the env file beside the data folder', async () => {
  const r = repo({});
  mkdirSync(r.s.dataDir, { recursive: true });
  writeFileSync(join(dirname(r.s.dataDir), 'env'), 'AXF_TOKEN=tok-123\nGITHUB_TOKEN=nope\nDOMAIN=console.example.test\n');
  assert.deepEqual(consoleTarget(r.s, {}), { base: 'https://console.example.test', token: 'tok-123' });
  assert.deepEqual(consoleTarget(r.s, { AXF_CONSOLE_URL: 'http://127.0.0.1:8765/', AXF_TOKEN: 'other' }), { base: 'http://127.0.0.1:8765', token: 'other' });
  const calls = [];
  const fetch = async (url, o) => { calls.push({ url, method: o.method, auth: o.headers.Authorization, body: JSON.parse(o.body) }); return { ok: true }; };
  const event = { build: 'b', state: 'merging', rev: 7, at: '2026-11-24T02:00:00.000Z' };
  assert.equal(await defaultNotify(r.s, { fetch, env: {} })(event), true);
  assert.deepEqual(calls, [{ url: 'https://console.example.test/api/builds/updated', method: 'POST', auth: 'Bearer tok-123', body: event }]);
  assert.equal(await defaultNotify(r.s, { fetch: async () => { throw new Error('down'); }, env: {} })(event), false, 'a console that is down is a quiet false');
  assert.equal(await defaultNotify(r.s, { fetch, env: { AXF_LANDER_NOTIFY: 'off' } })(event), false);
  const bare = repo({});
  assert.equal(await defaultNotify(bare.s, { fetch, env: {} })(event), false, 'no console known: nothing is sent');
  assert.equal(calls.length, 1);
});

// ------------------------------------------------------------------ the merge line in the store

test('the merge line, pure: places, the build each one waits for, and the words for it', () => {
  const at = (m) => `2026-11-24T01:${String(m).padStart(2, '0')}:00.000Z`;
  const a = one('a', 'claude/a', { status: 'running-ci', updatedAt: at(9), number: 41, steps: [{ id: 's1', status: 'in-pr', prNumber: 5, branch: 'claude/a' }] });
  const b = one('b', 'claude/b', { updatedAt: at(1), number: 42 });
  const c = one('c', 'claude/c', { updatedAt: at(2) });
  const stopped = one('h', 'claude/h', { status: 'failed', failure: { status: 'running-ci', retry: 'hold', kind: 'ci-red' }, updatedAt: at(0) });
  const line = L.mergeLine([c, stopped, b, a]);
  assert.deepEqual(line.get('a'), { position: 1, waitingFor: null });
  assert.deepEqual(line.get('b'), { position: 2, waitingFor: { buildId: 'a', id: 'a', number: '41', title: 'Build a' } });
  assert.deepEqual(line.get('c'), { position: 3, waitingFor: { buildId: 'b', id: 'b', number: '42', title: 'Build b' } });
  assert.equal(line.has('h'), false, 'a build that stopped for Brett has no place in the line');
  assert.equal(L.lineText(line.get('a')), '1st to merge');
  assert.equal(L.lineText(line.get('b')), '2nd to merge, waiting for build 41');
  assert.equal(L.lineText({ position: 3, waitingFor: { id: 'b', number: null } }), '3rd to merge, waiting for b', 'no build number yet: the build id');
  assert.equal(L.lineText({ position: 2, waitingFor: 'a' }), '2nd to merge, waiting for a');
  assert.ok(L.sameLine({ position: 2, waitingFor: { buildId: 'a', number: '41', title: 'x' } }, { position: 2, waitingFor: { buildId: 'a', id: 'a', number: '', title: 'y' } }), 'the same place whatever shape the store kept it in');
  assert.ok(!L.sameLine({ position: 2, waitingFor: 'a' }, { position: 2, waitingFor: { id: 'b' } }));
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(L.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  assert.deepEqual(['build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed', 'building'].map((status) => L.landingState({ status })), ['waiting-to-merge', 'merging', 'merging', 'running-ci', 'merging', 'landed', '']);
  assert.equal(L.landingState({ status: 'failed', failure: { status: 'running-ci' } }), 'failed');
  assert.equal(L.landingState({ status: 'failed', failure: { status: 'building' } }), '', 'a build that failed while building is not the lander\'s');
  // builds that share one PR (merge together) share one place
  const t1 = one('t1', 'claude/t1', { status: 'running-ci', updatedAt: at(3), steps: [{ id: 's1', status: 'in-pr', prNumber: 9, branch: 'claude/t1' }] });
  const t2 = one('t2', 'claude/t2', { status: 'running-ci', updatedAt: at(4), steps: [{ id: 's1', status: 'in-pr', prNumber: 9, branch: 'claude/t2' }] });
  const shared = L.mergeLine([t1, t2, b]);
  assert.deepEqual([shared.get('t1'), shared.get('t2')], [{ position: 1, waitingFor: null }, { position: 1, waitingFor: null }]);
  assert.deepEqual(lineRows([t1, t2, b]).map((x) => [x.build, x.position, x.together ?? 0]), [['t1', 1, 9], ['t2', 1, 9], ['b', 2, 0]]);
  assert.equal(shared.get('b').position, 2); assert.equal(shared.get('b').waitingFor.id, 't2');
});

test('the lander writes each waiting build\'s place and the build it waits for into the store, and moves the line up as builds land', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  let ci = 'running'; const gh = github(r, () => ci);
  const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z', number: 41 }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z', number: 42 }), one('c', 'claude/c', { updatedAt: '2026-11-19T11:02:00.000Z', number: 43 })], { now });
  const notify = recorder();
  const opts = base(r, gh, store, now, { notify, cfg: L.normConfig({ landsPerTick: 1 }) });
  await tick(opts);
  assert.deepEqual(byId(store, 'a').mergeLine, { position: 1, waitingFor: null });
  assert.deepEqual(byId(store, 'b').mergeLine, { position: 2, waitingFor: { buildId: 'a', id: 'a', number: '41', title: 'Build a' } });
  assert.deepEqual(byId(store, 'c').mergeLine, { position: 3, waitingFor: { buildId: 'b', id: 'b', number: '42', title: 'Build b' } });
  assert.equal(L.landingState(byId(store, 'b')), 'waiting-to-merge');
  assert.deepEqual(notify.sent.filter((e) => e.build !== 'a').map((e) => [e.build, e.state]), [['b', 'waiting-to-merge'], ['c', 'waiting-to-merge']], 'each waiting build\'s place is one command');
  assert.deepEqual(lineRows(store.read()).map((x) => x.text), ['1st to merge', '2nd to merge, waiting for build 41', '3rd to merge, waiting for build 42']);
  // nothing moved: nothing is written, nothing is sent
  const before = notify.sent.length; const log = byId(store, 'b').updatedAt;
  now.add(1); await tick(opts);
  assert.equal(notify.sent.length, before); assert.equal(byId(store, 'b').updatedAt, log, 'an unchanged place is not written again');
  // a lands: it leaves the line, b is now first, c waits for b
  ci = 'success'; now.add(1); await tick(opts);
  assert.equal(byId(store, 'a').status, 'landed'); assert.equal(byId(store, 'a').mergeLine, undefined, 'a landed build has no place in the line');
  assert.equal(byId(store, 'a').landing.mergeLine, undefined); assert.equal(byId(store, 'a').landing.state, 'landed'); assert.equal(byId(store, 'b').landing.state, 'waiting-to-merge');
  assert.deepEqual(byId(store, 'b').mergeLine, { position: 1, waitingFor: null });
  assert.deepEqual(byId(store, 'c').mergeLine, { position: 2, waitingFor: { buildId: 'b', id: 'b', number: '42', title: 'Build b' } });
  const st = await status(r.s, { store });
  assert.deepEqual(st.line.map((x) => [x.build, x.position, x.state]), [['b', 1, 'waiting-to-merge'], ['c', 2, 'waiting-to-merge']]);
});

test('a store that does not keep `mergeLine` costs one write a tick and never a failure', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' } });
  const gh = github(r, () => 'running'); const now = clock();
  const inner = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' })], { now });
  let lineWrites = 0;
  const drop = (x) => { if (x) { delete x.mergeLine; if (x.landing) delete x.landing.mergeLine; } return x; };
  const store = { read: () => inner.read().map(drop), write: (id, ch) => { if (ch.mergeLine !== undefined) lineWrites += 1; const res = inner.write(id, ch); for (const x of inner.list) drop(x); return { ...res, build: drop(res.build) }; } };
  const logs = [];
  const out = await tick(base(r, gh, store, now, { log: (l) => logs.push(l) }));
  assert.equal(out.error, ''); assert.equal(lineWrites, 1, 'asked once, not once per build');
  assert.ok(logs.some((l) => /does not keep `mergeLine`/.test(l)));
});

// ------------------------------------------------------------------ merge together

const askTogether = (r) => G.writeJson(files(r.s).control, { mergeTogether: { at: '2026-11-24T02:00:00.000Z', by: 'Brett' } });

test('merge together: every waiting build in ONE PR, CI once, one merge, all landed', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  let ci = 'running'; const asked = []; const gh = github(r, (h) => { asked.push(h); return ci; });
  const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' }), one('c', 'claude/c', { updatedAt: '2026-11-19T11:02:00.000Z' })], { now });
  const notify = recorder();
  const opts = base(r, gh, store, now, { notify });
  askTogether(r);
  let out = await tick(opts);
  assert.equal(out.error, '');
  assert.equal(gh.prs.size, 1, 'one PR for the three builds'); assert.equal(gh.prs.get(1).head.ref, 'lander/together-a'); assert.match(gh.prs.get(1).title, /Merge together: 3 builds \(a, b, c\)/);
  for (const id of ['a', 'b', 'c']) { const x = byId(store, id); assert.equal(x.status, 'running-ci', `${id} shows the PR's phase`); assert.equal(x.steps[0].prNumber, 1); assert.deepEqual(x.mergeLine, { position: 1, waitingFor: null }); assert.deepEqual(x.landing.mergeLine, x.mergeLine, 'and in the landing record, where pipeline-status@1 reads it'); assert.equal(x.landing.state, 'running-ci'); }
  assert.equal(readControl(r.s).mergeTogether, undefined, 'the request is used up');
  assert.equal(out.build, 'a');
  ci = 'success'; now.add(1); asked.length = 0;
  out = await tick(opts);
  assert.equal(out.error, '');
  for (const id of ['a', 'b', 'c']) { const x = byId(store, id); assert.equal(x.status, 'landed', `${id} landed`); assert.equal(x.landed?.pr, 1); assert.equal(x.landed?.ci, 'success'); assert.equal(x.mergeLine, undefined); }
  assert.equal(merges(gh), 1, 'one merge'); assert.equal(new Set(asked).size, 1, 'CI ran on one head, once');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) assert.ok(onMain(r, f));
  assert.deepEqual(['a', 'b', 'c'].map((id) => notify.sent.filter((e) => e.build === id).at(-1).state), ['landed', 'landed', 'landed']);
});

test('merge together: a build that clashes is named, left out and lands by itself after the others', async () => {
  const r = repo({ 'claude/a': { 'shared.txt': 'one\nTWO from a\nthree\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'shared.txt': 'one\nTWO from c\nthree\n' } });
  const gh = github(r); const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' }), one('c', 'claude/c', { updatedAt: '2026-11-19T11:02:00.000Z' })], { now });
  const opts = base(r, gh, store, now, { cfg: L.normConfig({ landsPerTick: 1 }) });
  askTogether(r);
  const out = await tick(opts);
  assert.equal(out.error, '');
  assert.equal(byId(store, 'a').status, 'landed'); assert.equal(byId(store, 'b').status, 'landed');
  assert.match(gh.prs.get(1).title, /Merge together: 2 builds \(a, b\)/);
  const c = byId(store, 'c');
  assert.equal(c.status, 'build-complete', 'the clashing build was not touched');
  assert.ok(c.notes.some((n) => /left out of merge together: claude\/a and claude\/c conflict in code \(shared\.txt\)/.test(n.text)), 'and the record says which branch it clashes with');
  assert.ok(out.actions.some((a) => /c is left out/.test(a)));
  assert.deepEqual(c.mergeLine, { position: 1, waitingFor: null }, 'it is now first in the line, by itself');
  // one at a time from here: its own PR, and the clash with what just landed goes the usual way (a fix session)
  now.add(1); await tick(opts);
  assert.equal(gh.prs.size, 2); assert.equal(gh.prs.get(2).head.ref, 'lander/c');
  assert.equal(byId(store, 'c').failure.kind, 'clash-main');
});

test('merge together waits for a build that is already landing, and with fewer than two waiting it is dropped', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  let ci = 'running'; const gh = github(r, () => ci); const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' }), one('c', 'claude/c', { updatedAt: '2026-11-19T11:02:00.000Z' })], { now });
  const opts = base(r, gh, store, now, { cfg: L.normConfig({ landsPerTick: 1 }) });
  await tick(opts); // a is landing by itself, CI running
  askTogether(r); now.add(1);
  await tick(opts);
  assert.equal(gh.prs.size, 1, 'a is not pulled out of its own landing'); assert.ok(readControl(r.s).mergeTogether, 'the request waits');
  ci = 'success'; now.add(1); await tick(opts);
  assert.equal(byId(store, 'a').status, 'landed');
  now.add(1); await tick(opts); // now b and c go together
  assert.equal(gh.prs.get(2).head.ref, 'lander/together-b');
  assert.deepEqual([byId(store, 'b').status, byId(store, 'c').status], ['landed', 'landed']); assert.equal(merges(gh), 2);
  // one build alone: nothing to combine
  const r2 = repo({ 'claude/x': { 'x.txt': 'x\n' } });
  const gh2 = github(r2); const store2 = memoryStore([one('x', 'claude/x')], { now });
  askTogether(r2);
  const out2 = await tick(base(r2, gh2, store2, now, { cfg: L.normConfig({ landsPerTick: 1 }) }));
  assert.equal(store2.list[0].status, 'landed'); assert.equal(gh2.prs.get(1).head.ref, 'lander/x'); assert.equal(readControl(r2.s).mergeTogether, undefined);
  assert.ok(out2.actions.some((a) => /fewer than two builds/.test(a)));
});

test('merge together that stops for Brett is undone: the PR is closed and the other builds land one at a time', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' } });
  let ci = 'failure'; const gh = github(r, () => ci); const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' })], { now });
  const cfg = L.normConfig({ flakyReruns: 0, maxFixes: 0 }); // the ladder's top at once: red CI stops the PR
  const opts = base(r, gh, store, now, { cfg });
  askTogether(r);
  const out = await tick(opts);
  const a = byId(store, 'a'); let b = byId(store, 'b');
  assert.ok(L.isHeld(a), 'the build that carried the PR stopped for Brett'); assert.equal(gh.prs.get(1).state, 'closed');
  assert.equal(b.status, 'merging-pr'); assert.deepEqual(b.landing.closed, [1]);
  assert.ok(b.notes.some((n) => /merge together \(PR #1\) was undone/.test(n.text)));
  assert.ok(out.actions.some((x) => /undone/.test(x)));
  ci = 'success'; now.add(1);
  await tick(opts);
  b = byId(store, 'b');
  assert.equal(b.status, 'landed', 'the other build landed by itself'); assert.equal(gh.prs.get(b.steps[0].prNumber).head.ref, 'lander/b-2');
  assert.ok(onMain(r, 'b.txt') && !onMain(r, 'a.txt'));
  assert.ok(existsSync(r.work));
});

test('merge together for the builds the press named only: the rest of the line stays one at a time', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  const gh = github(r); const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' }), one('c', 'claude/c', { updatedAt: '2026-11-19T11:02:00.000Z' })], { now });
  G.writeJson(files(r.s).control, { mergeTogether: { at: '2026-11-24T02:00:00.000Z', by: 'Brett', builds: ['a', 'c'] } });
  await tick(base(r, gh, store, now, { cfg: L.normConfig({ landsPerTick: 1 }) }));
  assert.match(gh.prs.get(1).title, /Merge together: 2 builds \(a, c\)/);
  assert.deepEqual(['a', 'b', 'c'].map((id) => byId(store, id).status), ['landed', 'build-complete', 'landed']);
});

test('clean green PRs land at once: when the build in front lands, the next one takes its turn in the same tick, one merge after the other', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  const gh = github(r); const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' }), one('c', 'claude/c', { updatedAt: '2026-11-19T11:02:00.000Z' })], { now });
  const out = await tick(base(r, gh, store, now));
  assert.equal(out.error, ''); assert.equal(out.build, 'a'); assert.deepEqual(out.landed, ['a', 'b', 'c'], 'all three in one tick, in line order');
  for (const id of ['a', 'b', 'c']) { assert.equal(byId(store, id).status, 'landed'); assert.ok(onMain(r, `${id}.txt`)); assert.equal(byId(store, id).mergeLine, undefined); }
  const merges = gh.calls.filter((c) => c.startsWith('PUT'));
  assert.deepEqual(merges, ['PUT /pulls/1/merge', 'PUT /pulls/2/merge', 'PUT /pulls/3/merge'], 'one merge after the other, never two at once');
  // each merge was pinned to the head CI went green on (the fake GitHub asserts the sha), and each build has its own evidence
  for (const id of ['a', 'b', 'c']) { const b = byId(store, id); assert.equal(b.landing.lastMerge.head.length, 40); assert.ok(b.landing.lastMerge.sha); }
  assert.equal(new Set(['a', 'b', 'c'].map((id) => byId(store, id).landing.lastMerge.head)).size, 3);
});

test('the pass ends at the first build that does not land now: it has started its work, the ones behind it wait their turn', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  // b's CI is still running; a and c are green
  let hold = true;
  const headOfB = () => { try { sh(r.work, 'fetch', '-q', 'origin'); return sh(r.work, 'rev-parse', 'origin/lander/b'); } catch { return ''; } };
  const gh = github(r, (head) => (hold && head === headOfB() ? 'running' : 'success'));
  const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' }), one('c', 'claude/c', { updatedAt: '2026-11-19T11:02:00.000Z' })], { now });
  const opts = base(r, gh, store, now);
  let out = await tick(opts);
  assert.deepEqual(out.landed, ['a']); assert.deepEqual(out.next, { build: 'b', status: 'running-ci' }); assert.match(out.waiting, /CI is running/);
  assert.equal(byId(store, 'b').status, 'running-ci', 'b did not wait a timer cycle to start: its PR is up and CI is being watched');
  assert.equal(byId(store, 'c').status, 'build-complete', 'c is behind b: one at a time, the line is not jumped');
  assert.deepEqual(byId(store, 'c').mergeLine?.waitingFor?.id, 'b');
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT')).length, 1);
  // b goes green: b and then c land in the next tick
  hold = false; now.add(1);
  out = await tick(opts);
  assert.deepEqual(out.landed, ['b', 'c']); assert.ok(onMain(r, 'b.txt') && onMain(r, 'c.txt'));
});

test('landsPerTick 1 is the old pace: one build a tick', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' } });
  const gh = github(r); const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: '2026-11-19T11:00:00.000Z' }), one('b', 'claude/b', { updatedAt: '2026-11-19T11:01:00.000Z' })], { now });
  const out = await tick(base(r, gh, store, now, { cfg: L.normConfig({ landsPerTick: 1 }) }));
  assert.deepEqual(out.landed, ['a']); assert.equal(out.next, undefined); assert.equal(byId(store, 'b').status, 'build-complete');
});
