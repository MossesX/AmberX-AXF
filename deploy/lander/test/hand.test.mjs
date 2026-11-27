// node --test deploy/lander/test/hand.test.mjs — the lander lands a hand build like any other build, and a step branch
// that is not on GitHub no longer stops a landing (real git, a fake GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sh, repo, github, build, clock, onMain, statuses, base, one } from './helpers.mjs';

const { tick } = await import('../run.mjs');
const { memoryStore } = await import('../store.mjs');
const L = await import('../lander-core.mjs');

const hand = { at: '2026-11-23T20:00:00.000Z', by: 'Earl the Ear' };

test('a hand build at build-complete is picked up and landed on green CI: one PR, main pulled in, merged, landed', async () => {
  const r = repo({ 'claude/hand-one': { 'docs.txt': 'a line\n' } });
  const gh = github(r); const now = clock();
  const store = memoryStore([one('hand-one', 'claude/hand-one', { flow: 'pipeline-2', hand, branch: 'claude/hand-one' })], { now });
  const out = await tick(base(r, gh, store, now));
  assert.equal(out.error, ''); assert.equal(out.build, 'hand-one');
  const b = store.list[0];
  assert.equal(b.status, 'landed');
  assert.deepEqual(statuses(b), ['merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed']);
  assert.deepEqual([gh.prs.size, gh.prs.get(1).head.ref, b.steps[0].status, b.steps[0].prNumber], [1, 'lander/hand-one', 'in-pr', 1], 'its one step is in the lander\'s one PR');
  assert.ok(onMain(r, 'docs.txt'), 'its change is on main');
  assert.equal(b.landed?.ci, 'success', 'landed with the merge evidence');
  assert.deepEqual(b.hand, hand, 'the tag stays on the record');
});

test('a hand build waits while CI is red or running and is merged only once it is green', async () => {
  const r = repo({ 'claude/hand-two': { 'x.txt': 'x\n' } });
  let ci = 'running'; const gh = github(r, () => ci); const now = clock();
  const store = memoryStore([one('hand-two', 'claude/hand-two', { flow: 'pipeline-2', hand })], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  assert.equal(store.list[0].status, 'running-ci'); assert.ok(!onMain(r, 'x.txt'), 'nothing merges while CI runs');
  ci = 'success'; now.add(2);
  await tick(opts);
  assert.equal(store.list[0].status, 'landed'); assert.ok(onMain(r, 'x.txt'));
});

test('hand builds and orchestrator builds share the one merge line: the one already landing first, then the oldest', () => {
  const b1 = { ...one('plan-a', 'claude/plan-a--s1'), status: 'running-ci', updatedAt: '2026-11-23T20:10:00.000Z' };
  const h1 = one('hand-one', 'claude/hand-one', { hand, updatedAt: '2026-11-23T20:05:00.000Z' });
  const h2 = one('hand-two', 'claude/hand-two', { hand, updatedAt: '2026-11-23T20:01:00.000Z' });
  const pick = L.pickBuild([h1, b1, h2]);
  assert.deepEqual([pick.build.id, pick.others], ['plan-a', ['hand-two', 'hand-one']]);
});

test('a step that committed nothing is left out of the PR; the rest of the build still lands (Nov 23 2026: s10 of ten)', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/b-s2': { 'b.txt': 'b\n' } });
  // s3's session found nothing to change: its branch exists in the host's checkout at main, and was never pushed
  sh(r.work, 'branch', 'claude/b-s3', 'origin/main');
  const gh = github(r); const now = clock();
  const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2'], ['s3', 'claude/b-s3']])], { now });
  const out = await tick(base(r, gh, store, now));
  assert.equal(out.error, '');
  const b = store.list[0];
  assert.equal(b.status, 'landed');
  assert.ok(onMain(r, 'a.txt') && onMain(r, 'b.txt'));
  assert.deepEqual(b.steps.map((s) => s.status), ['in-pr', 'in-pr', 'in-pr'], 'every step is accounted for in the PR');
});

test('a step that committed but never pushed is pushed by the lander from the host\'s checkout', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  sh(r.work, 'checkout', '-q', '-B', 'claude/b-s2', 'origin/main');
  writeFileSync(join(r.work, 'late.txt'), 'late\n'); sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '-m', 's2 work, never pushed');
  sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
  const gh = github(r); const now = clock();
  const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
  await tick(base(r, gh, store, now));
  assert.equal(store.list[0].status, 'landed');
  assert.ok(onMain(r, 'late.txt'), 'the unpushed step\'s work is on main');
});

test('a step branch that exists nowhere still stops the landing, and says which', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r); const now = clock();
  const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-gone']])], { now });
  await tick(base(r, gh, store, now));
  const b = store.list[0];
  assert.equal(b.status, 'failed');
  assert.match(b.failure.why, /claude\/b-gone is not on GitHub/);
});
