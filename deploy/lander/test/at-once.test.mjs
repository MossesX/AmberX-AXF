// node --test deploy/lander/test/at-once.test.mjs — a clean green PR never waits a timer cycle: the next build in the
// line is worked in the tick the one ahead of it lands, and a green, mergeable PR lands while the build at the front
// still waits. One merge at a time, each pinned to the head CI went green on (real git, a fake GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sh, repo, github, clock, onMain, statuses, base, one, byId } from './helpers.mjs';

const { tick, MAX_BUILDS_PER_TICK } = await import('../run.mjs');
const { memoryStore } = await import('../store.mjs');

const merges = (gh) => gh.calls.filter((c) => c.startsWith('PUT'));
const ownPr = (gh, branch) => gh('POST', '/repos/o/r/pulls', { title: 'the session\'s own PR', head: branch, base: 'main', body: '' });
const at = (n) => `2026-11-19T11:0${n}:00.000Z`;

test('the build at the front lands and the next ones in the line land in the same tick, in order, one merge each', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  const gh = github(r); const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: at(0) }), one('b', 'claude/b', { updatedAt: at(1) }), one('c', 'claude/c', { updatedAt: at(2) })], { now });
  const out = await tick(base(r, gh, store, now));
  assert.equal(out.error, '');
  assert.deepEqual(['a', 'b', 'c'].map((id) => byId(store, id).status), ['landed', 'landed', 'landed']);
  assert.deepEqual(out.landed, ['a', 'b', 'c'], 'in the line\'s order');
  assert.deepEqual([out.build, out.status, out.others], ['a', 'landed', ['b', 'c']], 'the tick still reports the build it started on');
  assert.deepEqual(merges(gh), ['PUT /pulls/1/merge', 'PUT /pulls/2/merge', 'PUT /pulls/3/merge'], 'one merge per build, one after the other');
  assert.ok(out.actions.includes('landed') && out.actions.includes('b: landed') && out.actions.includes('c: landed'), 'the other builds\' actions carry their id');
  for (const id of ['b', 'c']) assert.deepEqual(statuses(byId(store, id)), ['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed'], `${id} went through every phase`);
  // each later build was put together on main as it was after the merge before it
  assert.ok(sh(r.work, 'ls-tree', '--name-only', 'origin/main^2', 'a.txt', 'b.txt').includes('b.txt'), 'c\'s PR head holds what landed before it');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) assert.ok(onMain(r, f));
});

test('the next build is worked in the same tick but merges only on its own green CI; the line stops at the first build that waits', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/b': { 'b.txt': 'b\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  let aHead = ''; const gh = github(r, (head) => (head === aHead ? 'success' : 'running')); const now = clock();
  const store = memoryStore([one('a', 'claude/a', { updatedAt: at(0) }), one('b', 'claude/b', { updatedAt: at(1) }), one('c', 'claude/c', { updatedAt: at(2) })], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  aHead = sh(r.work, 'rev-parse', 'origin/lander/a'); now.add(1);
  const out = await tick(opts);
  assert.deepEqual(out.landed, ['a']);
  assert.deepEqual(['a', 'b', 'c'].map((id) => byId(store, id).status), ['landed', 'running-ci', 'build-complete'], 'b is started at once, c is not: one landing at a time');
  assert.equal(out.waiting, 'b: CI is running', 'what the tick waits for names the build');
  assert.equal(merges(gh).length, 1); assert.ok(!onMain(r, 'b.txt'));
});

test('a build\'s own PR that is green and mergeable lands while the build at the front waits for CI', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/own': { 'own.txt': 'own\n' }, 'claude/c': { 'c.txt': 'c\n' } });
  const ownHead = sh(r.work, 'rev-parse', 'origin/claude/own');
  const gh = github(r, (head) => (head === ownHead ? 'success' : 'running')); const now = clock();
  await ownPr(gh, 'claude/own');
  const store = memoryStore([one('a', 'claude/a', { updatedAt: at(0) }), one('own', 'claude/own', { updatedAt: at(1) }), one('c', 'claude/c', { updatedAt: at(2) })], { now });
  const out = await tick(base(r, gh, store, now));
  assert.equal(out.error, '');
  assert.deepEqual(['a', 'own', 'c'].map((id) => byId(store, id).status), ['running-ci', 'landed', 'build-complete'], 'the green PR landed; a build with no PR yet is not started beside the one at the front');
  assert.deepEqual(out.landed, ['own']); assert.equal(out.build, 'a'); assert.equal(out.waiting, 'CI is running', 'the front build\'s own wait is still what the tick reports');
  assert.deepEqual(merges(gh), ['PUT /pulls/1/merge'], 'one merge: the build\'s own PR, no second PR for it');
  const own = byId(store, 'own');
  assert.equal(own.landing.lastMerge.head, ownHead, 'pinned to the head CI went green on'); assert.equal(sh(r.work, 'rev-parse', 'origin/main^2'), ownHead);
  assert.equal(own.landed.ci, 'success'); assert.ok(onMain(r, 'own.txt') && !onMain(r, 'a.txt'));
  assert.ok(out.actions.includes('own: landed'));
  // the build at the front is where it was, and lands on its own green CI as it is
  assert.equal(byId(store, 'a').mergeLine.position, 1);
});

test('nothing passes the front build unless it is clean: CI not green, GitHub not saying mergeable, a failed build, an emergency build ahead', async () => {
  const setup = async ({ ci = 'success', mergeable = true, extra = {}, front = {} } = {}) => {
    const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/own': { 'own.txt': 'own\n' } });
    const ownHead = sh(r.work, 'rev-parse', 'origin/claude/own');
    const gh = github(r, (head) => (head === ownHead ? ci : 'running')); const now = clock();
    const pr = await ownPr(gh, 'claude/own'); pr.mergeable = mergeable;
    const store = memoryStore([one('a', 'claude/a', { updatedAt: at(0), ...front }), one('own', 'claude/own', { updatedAt: at(1), ...extra })], { now });
    const out = await tick(base(r, gh, store, now));
    return { out, gh, store };
  };
  for (const [name, o] of [['CI running', { ci: 'running' }], ['CI red', { ci: 'failure' }], ['only light checks', { ci: 'light' }], ['mergeable not known yet', { mergeable: null }], ['conflicts with main', { mergeable: false }],
    ['an emergency build at the front', { front: { emergency: { at: at(0), by: 'Brett' } } }]]) {
    const { out, gh, store } = await setup(o);
    assert.equal(byId(store, 'own').status, 'build-complete', `${name}: not touched`);
    assert.deepEqual([out.landed, merges(gh).length, byId(store, 'a').status], [[], 0, 'running-ci'], name);
  }
});

test('a green PR that passes the front build still goes through the gate: failing build rules stop it, and the front build is untouched', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/own': { 'own.txt': 'own\n' } });
  const ownHead = sh(r.work, 'rev-parse', 'origin/claude/own');
  const gh = github(r, (head) => (head === ownHead ? 'success' : 'running')); const now = clock();
  await ownPr(gh, 'claude/own');
  const store = memoryStore([one('a', 'claude/a', { updatedAt: at(0) }), one('own', 'claude/own', { updatedAt: at(1) })], { now });
  const out = await tick(base(r, gh, store, now, { buildRules: ({ id }) => (id === 'own' ? { ok: false, failing: ['no-secrets'], fixed: [], detail: 'no-secrets: a key in own.txt' } : { ok: true, failing: [], fixed: [] }) }));
  const own = byId(store, 'own');
  assert.equal(own.status, 'failed'); assert.equal(own.failure.kind, 'rules'); assert.equal(merges(gh).length, 0, 'never merged past the gate');
  assert.equal(byId(store, 'a').status, 'running-ci'); assert.equal(out.waiting, 'CI is running'); assert.deepEqual(out.landed, []);
});

test('a head pushed after CI went green is never merged by the pass: the merge stays pinned to the tested head', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/own': { 'own.txt': 'own\n' } });
  const ownHead = sh(r.work, 'rev-parse', 'origin/claude/own');
  const gh = github(r, (head) => (head === ownHead ? 'success' : 'running')); const now = clock();
  await ownPr(gh, 'claude/own');
  const store = memoryStore([one('a', 'claude/a', { updatedAt: at(0) }), one('own', 'claude/own', { updatedAt: at(1) })], { now });
  // someone pushes to the PR while the gate's rules run on the green head
  const buildRules = ({ id }) => {
    if (id === 'own') { sh(r.work, 'checkout', '-q', '--detach', 'origin/claude/own'); writeFileSync(join(r.work, 'late.txt'), 'late\n'); sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '-m', 'late'); sh(r.work, 'push', '-q', 'origin', 'HEAD:claude/own'); sh(r.work, 'checkout', '-q', '--detach', 'origin/main'); }
    return { ok: true, failing: [], fixed: [] };
  };
  const out = await tick(base(r, gh, store, now, { buildRules }));
  assert.equal(merges(gh).length, 0, 'the untested head did not merge'); assert.deepEqual(out.landed, []);
  assert.equal(byId(store, 'own').status, 'running-ci', 'CI runs on the new head first'); assert.ok(!onMain(r, 'late.txt') && !onMain(r, 'own.txt'));
});

test('several green PRs behind a waiting build land in one tick, one merge after the other', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/p': { 'p.txt': 'p\n' }, 'claude/q': { 'q.txt': 'q\n' } });
  const green = new Set([sh(r.work, 'rev-parse', 'origin/claude/p'), sh(r.work, 'rev-parse', 'origin/claude/q')]);
  const gh = github(r, (head) => (green.has(head) ? 'success' : 'running')); const now = clock();
  await ownPr(gh, 'claude/p'); await ownPr(gh, 'claude/q');
  const store = memoryStore([one('a', 'claude/a', { updatedAt: at(0) }), one('p', 'claude/p', { updatedAt: at(1) }), one('q', 'claude/q', { updatedAt: at(2) })], { now });
  const out = await tick(base(r, gh, store, now));
  assert.deepEqual(out.landed, ['p', 'q']); assert.deepEqual(merges(gh), ['PUT /pulls/1/merge', 'PUT /pulls/2/merge']);
  assert.equal(byId(store, 'a').status, 'running-ci'); assert.ok(onMain(r, 'p.txt') && onMain(r, 'q.txt'));
  assert.ok(MAX_BUILDS_PER_TICK >= 3);
});

test('--only and --dry-run work on one build: nothing behind it is touched', async () => {
  const r = repo({ 'claude/a': { 'a.txt': 'a\n' }, 'claude/p': { 'p.txt': 'p\n' } });
  const gh = github(r); const now = clock();
  await ownPr(gh, 'claude/p');
  const list = () => [one('a', 'claude/a', { updatedAt: at(0) }), one('p', 'claude/p', { updatedAt: at(1) })];
  const dry = await tick(base(r, gh, memoryStore(list(), { now }), now, { dry: true }));
  assert.deepEqual(dry.landed, []); assert.equal(merges(gh).length, 0);
  const store = memoryStore(list(), { now });
  const out = await tick(base(r, gh, store, now, { only: 'a' }));
  assert.deepEqual([out.landed, byId(store, 'p').status, merges(gh).length], [['a'], 'build-complete', 1]);
});
