// node --test deploy/lander/test/repair.test.mjs — the lander findings of the Nov 21 2026 audit (L2-01 … L2-12), one or
// more tests each: real git (a bare origin), a fake GitHub, an in-memory builds store. No network, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sh, repo, github, check, build, clock, onMain, statuses, base, one, byId, holds, pushMain } from './helpers.mjs';

const { tick, status, takeLock, readRulesAnswer } = await import('../run.mjs');
const G = await import('../git.mjs');
const { memoryStore } = await import('../store.mjs');
const L = await import('../lander-core.mjs');
const F = await import('../fix-session.mjs');

const merges = (gh) => gh.calls.filter((c) => c.startsWith('PUT')).length;
const cfg = (more = {}) => L.normConfig(more);

// ------------------------------------------------------------------ L2-01: a PR merged or closed by hand

test('L2-01: a PR merged by hand while a fix session "works on it" is seen on the next tick: recorded, landed, no retry', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let red = true; const gh = github(r, () => (red ? 'failure' : 'success'));
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  let fixes = 0;
  const opts = base(r, gh, store, now, { cfg: cfg({ flakyReruns: 0 }), fixSession: () => { fixes++; return { exit: 0, session: 'fixer' }; } });
  await tick(opts); now.add(3); await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.retry, 'fix'); assert.ok(b.failure.fix.at, 'a fix session is on it'); assert.equal(fixes, 1);
  // Brett merges the PR himself; CI on that head is green by then
  const pr = gh.mergeByHand(1); red = false; now.add(1);
  const out = await tick(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed', 'the build lands instead of waiting on the fix session for ever');
  assert.equal(merges(gh), 0, 'the lander merged nothing itself');
  assert.equal(b.failure, undefined);
  assert.deepEqual(b.landing.merged, [1]);
  assert.equal(b.landing.lastMerge.sha, pr.merge_commit_sha); assert.equal(b.landing.lastMerge.head, pr.head.sha); assert.equal(b.landing.lastMerge.byHand, true);
  assert.equal(b.landed.sha, pr.merge_commit_sha); assert.equal(b.landed.ci, 'success'); assert.equal(b.landed.pr, 1);
  assert.ok(out.actions.some((a) => /merged by hand/.test(a)));
  assert.ok(b.notes.some((n) => /merged by hand/.test(n.text)));
  now.add(120); await tick(opts);
  assert.equal(fixes, 1, 'no fix session after the merge');
});

test('L2-01: a hand merge of the first of two PRs: the lander goes on with the next group', async () => {
  const big = (n) => `${Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')}\n`;
  const r = repo({ 'claude/b-s1': { 'a.txt': big(60) }, 'claude/b-s2': { 'b.txt': big(60) } });
  let state = 'running'; const gh = github(r, () => state);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
  const opts = base(r, gh, store, now, { cfg: cfg({ sizeCapLines: 70 }) });
  await tick(opts);
  assert.equal(store.list[0].status, 'running-ci'); assert.equal(gh.prs.size, 1);
  gh.mergeByHand(1); state = 'success'; now.add(1);
  await tick(opts);
  const b = store.list[0];
  assert.equal(b.status, 'landed'); assert.deepEqual(b.landing.merged, [1, 2]);
  assert.equal(merges(gh), 1, 'only the second PR was the lander\'s to merge');
  assert.ok(onMain(r, 'a.txt') && onMain(r, 'b.txt'));
});

test('L2-01: merged by hand without green CI: recorded, but never called landed until CI is green on that merge', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'running'; const gh = github(r, () => state);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  gh.mergeByHand(1); state = 'failure'; now.add(1);
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'hand-merge'); assert.equal(b.failure.retry, 'hold'); assert.equal(b.failure.needsBrett, true);
  assert.match(b.failure.why, /merged by hand and CI is red/);
  assert.deepEqual(b.landing.merged, [1], 'the merge itself is recorded'); assert.equal(b.landing.lastMerge.ci, 'failure');
  assert.equal(b.landing.attempt, 1);
  now.add(60); await tick(opts);
  assert.equal(store.list[0].landing.attempt, 1, 'it fails once, not every tick');
  // main is fixed (CI re-run green on the merge): the build lands by itself
  state = 'success'; now.add(1);
  await tick(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed'); assert.equal(b.landed.ci, 'success');
});

test('L2-01: a PR closed without merging fails once and stops; reopened, the build goes on', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'running'; const gh = github(r, () => state);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const said = [];
  const opts = base(r, gh, store, now, { say: (ev, text) => said.push(text) });
  await tick(opts);
  gh.prs.get(1).state = 'closed'; now.add(1);
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'pr-closed'); assert.equal(b.failure.retry, 'hold');
  assert.match(b.failure.why, /PR #1 was closed without merging/); assert.equal(b.landing.attempt, 1);
  assert.equal(said.length, 1, 'said once');
  for (let i = 0; i < 5; i++) { now.add(30); const out = await tick(opts); assert.match(out.waiting, /stopped, needs Brett/); }
  b = store.list[0];
  assert.equal(b.landing.attempt, 1, 'no retry while it is closed'); assert.equal(said.length, 1); assert.equal(gh.prs.size, 1, 'no new PR behind the closed one');
  gh.prs.get(1).state = 'open'; state = 'success'; now.add(1);
  await tick(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed'); assert.deepEqual(b.landing.merged, [1]); assert.ok(onMain(r, 'a.txt'));
});

test('L2-01: a closed PR and a re-send (lander retry): the closed PR is given up and a new PR lands the steps', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let state = 'running'; const gh = github(r, () => state);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  gh.prs.get(1).state = 'closed'; now.add(1); await tick(opts);
  store.write('b', L.releaseHold(store.list[0], { at: now(), by: 'Brett' }));
  state = 'success'; now.add(1);
  await tick(opts);
  const b = store.list[0];
  assert.equal(b.status, 'landed'); assert.deepEqual(b.landing.closed, [1]); assert.deepEqual(b.landing.merged, [2]);
  assert.equal(gh.prs.get(2).head.ref, 'lander/b-2');
});

test('L2-01 / L2-02: a stopped build never holds the line, and its hand-merged PR is seen while another build lands', async () => {
  const r = repo({ 'claude/x-s1': { 'x.txt': 'x\n' }, 'claude/y-s1': { 'y.txt': 'y\n' } });
  let xState = 'running';
  const xHead = () => spawnSync('git', ['rev-parse', '-q', '--verify', 'refs/remotes/origin/lander/x'], { cwd: r.work, encoding: 'utf8' }).stdout.trim();
  const gh = github(r, (head) => (head === xHead() ? xState : 'success'));
  const now = clock(); const store = memoryStore([one('x', 'claude/x-s1', { completedAt: '2026-11-19T10:00:00Z' })], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  gh.prs.get(1).state = 'closed'; now.add(1); await tick(opts);
  assert.equal(byId(store, 'x').failure.retry, 'hold');
  // a second build finishes: it lands although the first one is still stopped
  store.list.push(one('y', 'claude/y-s1', { completedAt: '2026-11-19T11:00:00Z' }));
  now.add(1);
  let out = await tick(opts);
  assert.equal(out.build, 'y'); assert.deepEqual(out.others, ['x']);
  assert.equal(byId(store, 'y').status, 'landed'); assert.ok(onMain(r, 'y.txt'));
  assert.equal(byId(store, 'x').status, 'failed', 'the stopped build was left as it is');
  // a third build is in the line when Brett reopens and merges x's PR by hand: x is recorded on that same tick
  store.list.push(one('z', 'claude/y-s1', { completedAt: '2026-11-19T12:00:00Z', status: 'build-complete' }));
  gh.prs.get(1).state = 'open'; xState = 'success'; gh.mergeByHand(1); now.add(1);
  out = await tick(opts);
  assert.equal(out.build, 'z');
  assert.deepEqual(byId(store, 'x').landing.merged, [1]); assert.equal(byId(store, 'x').failure, undefined);
  assert.ok(out.actions.some((a) => /^x: PR #1 was merged by hand/.test(a)));
});

test('L2-01: a hand merge with no CI of its own lands once main is green with the merge in it; light checks alone are not CI', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let green = ''; let prHead = 'light';
  const gh = github(r, (head) => (head === green ? 'success' : prHead));
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  gh.mergeByHand(1); prHead = 'light'; now.add(1);
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.failure.kind, 'hand-merge', 'light PR checks on the merged head are not green CI'); assert.equal(b.landing.lastMerge.ci, 'none');
  assert.match(b.failure.why, /run\.mjs accept b --by/);
  // the fix for main lands on top; CI is green on main's newest commit, which holds the hand merge
  green = pushMain(r, { 'fix-main.txt': 'f\n' }, 'fix main'); now.add(5);
  await tick(opts);
  b = store.list[0];
  assert.equal(b.status, 'landed'); assert.equal(b.landed.ci, 'success');
});

test('L2-01: CI that never finishes on a hand merge is not waited for for ever', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r, () => 'running');
  const now = clock(Date.parse('2026-11-19T12:00:00Z')); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts); gh.mergeByHand(1); now.add(1);
  let out = await tick(opts);
  assert.match(out.waiting, /merged by hand: waiting for CI/); assert.equal(store.list[0].status, 'merging-pr');
  now.add(130); out = await tick(opts);
  const b = store.list[0];
  assert.equal(b.failure.kind, 'hand-merge'); assert.ok(L.isHeld(b)); assert.match(b.failure.why, /not finished after 120 min/);
  // Brett checked main himself: his word is recorded, signed, and the build lands
  assert.match(L.acceptHandMerge(b, { by: 'Brett' }).error, /needs --by <who> and --why/);
  assert.match(L.acceptHandMerge({ id: 'x', status: 'failed', failure: { kind: 'ci-red', retry: 'hold' } }, { by: 'Brett', why: 'looked' }).error, /not stopped on a hand merge/);
  store.write('b', L.acceptHandMerge(b, { by: 'Brett', why: 'main CI run 991 is green' }));
  now.add(1); await tick({ ...opts, gh: Object.assign(github(r, () => 'failure'), { prs: gh.prs }) });
  const done = store.list[0];
  assert.equal(done.status, 'landed'); assert.equal(done.landed.ci, 'success');
  assert.ok(done.notes.some((n) => /accepted as green by Brett: main CI run 991 is green/.test(n.text)));
});

// ------------------------------------------------------------------ L2-02: the ladder has a top

test('L2-02: failing rules → fix → timeout → fix with the log → timeout → stopped for Brett; no third fix session, ever', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const fixes = []; const said = [];
  const opts = base(r, gh, store, now, {
    buildRules: () => ({ ok: false, failing: ['home-card'], fixed: [], detail: 'home-card: the build has no home card' }),
    fixSession: (job) => { fixes.push(job); return { exit: 0, session: `fixer-${job.n}` }; },
    say: (ev, text) => said.push(text),
  });
  await tick(opts);
  assert.equal(store.list[0].failure.kind, 'rules'); assert.equal(store.list[0].failure.retry, 'fix');
  now.add(3); await tick(opts);
  assert.equal(fixes.length, 1);
  now.add(30); let out = await tick(opts);
  assert.match(out.waiting, /fix session 1 \(fixer-1\) works on lander\/b/); assert.equal(fixes.length, 1, 'one session at a time');
  now.add(31); await tick(opts); // 61 minutes, nothing pushed
  let b = store.list[0];
  assert.equal(b.failure.kind, 'fix-timeout'); assert.equal(b.failure.retry, 'fix'); assert.equal(b.landing.attempt, 2);
  assert.deepEqual(b.failure.of.failing, ['home-card'], 'what was being fixed is kept');
  now.add(L.backoffMinutes(2) + 1); await tick(opts);
  assert.equal(fixes.length, 2); assert.equal(fixes[1].n, 2);
  assert.equal(fixes[1].log, 'home-card: the build has no home card', 'the second fix has the failing log attached');
  assert.equal(fixes[1].f.kind, 'fix-timeout');
  now.add(61); await tick(opts);
  b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.retry, 'hold'); assert.equal(b.failure.needsBrett, true);
  assert.match(b.failure.stopped, /2 fix sessions did not get it through/);
  assert.ok(said.some((t) => /stopped after attempt 3/.test(t) && /Needs Brett/.test(t)), 'the stop is posted');
  for (let i = 0; i < 6; i++) { now.add(120); out = await tick(opts); }
  assert.equal(fixes.length, 2, 'the same failed fix does not repeat for ever');
  assert.equal(store.list[0].landing.attempt, 3);
  assert.match(out.waiting, /stopped, needs Brett/); assert.match(out.waiting, /run\.mjs retry b/);
  // the systems check item: the exact failing check
  const st = await status(r.s, { store });
  assert.equal(st.escalations.length, 1);
  assert.equal(st.escalations[0].build, 'b'); assert.equal(st.escalations[0].pr, 1); assert.match(st.escalations[0].log, /Failing: home-card/);
  assert.deepEqual(st.failing, [], 'a stopped build is an escalation, not "retrying by itself"');
  // Brett re-sends it: a new landing run, a new fix session
  store.write('b', L.releaseHold(store.list[0], { at: now(), by: 'Brett' }));
  assert.equal(store.list[0].status, 'running-ci'); assert.equal(store.list[0].landing.attempt, 0); assert.equal(store.list[0].statusLog.at(-1).reset, true);
  now.add(1); await tick(opts); // the rules are read again: still failing, attempt 1 of the new run
  assert.equal(store.list[0].landing.attempt, 1); assert.equal(store.list[0].failure.retry, 'fix');
  now.add(3); await tick(opts);
  assert.equal(fixes.length, 3); assert.equal(fixes[2].n, 1);
});

test('L2-02: a fix session that does not start is retried on the next tick, and the status line says so', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r, () => 'failure'); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  let up = false; let tries = 0;
  const opts = base(r, gh, store, now, { cfg: cfg({ flakyReruns: 0, fixStartTries: 3 }), fixSession: () => { tries++; return up ? { exit: 0, session: 'fixer' } : { exit: 3, why: 'lenny: Quit · joey: Quit · 5 more can\'t either' }; } });
  await tick(opts); now.add(3);
  let out = await tick(opts);
  let b = store.list[0];
  assert.equal(tries, 1);
  assert.equal(out.waiting, 'fix session did not start: lenny: Quit · joey: Quit · 5 more can\'t either', 'never "a fix session works on it" when nothing runs');
  assert.equal(b.failure.fix, undefined, 'no fix clock starts for a session that never ran'); assert.equal(b.failure.fixStart.n, 1);
  assert.equal(b.landing.fixes ?? null, null, 'a start that failed is not one of the PR\'s fix sessions');
  now.add(1); out = await tick(opts);
  assert.equal(tries, 2, 'tried again one tick later, not after the 60-minute fix timeout');
  up = true; now.add(1); out = await tick(opts);
  b = store.list[0];
  assert.equal(tries, 3); assert.equal(b.failure.fix.session, 'fixer'); assert.equal(b.failure.fixStart, undefined); assert.deepEqual(b.landing.fixes, { pr: 1, n: 1 });
  assert.match(out.waiting, /fix session 1 \(fixer\) works on lander\/b/);
});

test('L2-02: a fix session that never starts costs an attempt after fixStartTries, and the ladder still ends', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r, () => 'failure'); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now, { cfg: cfg({ flakyReruns: 0, fixStartTries: 2, maxAttempts: 3 }), fixSession: () => ({ exit: 3, why: 'no account can take it' }) });
  for (let i = 0; i < 40 && !L.isHeld(store.list[0]); i++) { await tick(opts); now.add(31); }
  const b = store.list[0];
  assert.ok(L.isHeld(b), 'it stops'); assert.equal(b.failure.kind, 'fix-start'); assert.equal(b.failure.stopped, 'attempt 3 of 3');
  assert.match(b.failure.why, /did not start, 2 ticks running: no account can take it/);
  assert.equal(b.failure.of.kind, 'ci-red', 'the report still names what was red');
});

// ------------------------------------------------------------------ L2-03: fix sessions on Fable, this branch only

test('L2-03: the fix brief names the PR, the branch, the failing checks and their log, and forbids main', () => {
  const f = { kind: 'ci-red', why: 'CI is red on abc123 (Build engine sweep (Node))', failing: ['Build engine sweep (Node)'] };
  const t = F.fixBrief({ build: 'b', title: 'Build B', pr: 867, branch: 'lander/b', f, log: 'not ok 12 - store keeps the write\n  expected: 2', n: 2, of: 2 });
  assert.match(t, /PR #867/); assert.match(t, /`lander\/b`/); assert.match(t, /Failing checks: Build engine sweep \(Node\)/);
  assert.match(t, /not ok 12 - store keeps the write/); assert.match(t, /Fix session 2 of 2, on Fable/);
  assert.match(t, /Push to this branch only: `git push origin HEAD:lander\/b`/); assert.match(t, /Never push to main/); assert.match(t, /Never open, merge or close a PR/);
  assert.ok(!/HEAD:main|push (it )?to main\b(?! )/.test(t.replace(/Never push to main/g, '')), 'nothing in the brief sends anything to main');
  const clash = F.fixBrief({ build: 'b', pr: 3, branch: 'lander/b', f: { kind: 'clash-main', why: 'merging main into lander/b conflicts in code (x.mjs)' } });
  assert.match(clash, /git merge origin\/main/); assert.match(clash, /never rebase/);
  const again = F.fixBrief({ build: 'b', pr: 3, branch: 'lander/b', f: { kind: 'fix-timeout', why: 'pushed nothing', of: { kind: 'rules', why: 'build rules fail at the gate (home-card)', failing: ['home-card'] } } });
  assert.match(again, /build rules fail at the gate \(home-card\)/); assert.match(again, /A fix session before this one pushed nothing/);
  assert.equal(F.FIX_MODEL, 'fable'); assert.equal(F.fixName(867, 2), 'lander-fix-pr867-2');
  assert.ok(!F.fixName(867, 2).includes('--') && !/^build-/.test(F.fixName(867, 2)), 'not a build launch name: the dispatch gate has nothing to judge');
});

test('L2-03: the fix session starts through the headless launcher on Fable, in a worktree of the PR branch, never through the agent roster', () => {
  const r = repo({ 'lander/b': { 'a.txt': 'a\n' } });
  const launcher = join(r.dir, 'launcher.sh'); const seen = join(r.dir, 'seen.txt'); const trees = join(r.dir, 'trees');
  writeFileSync(launcher, `#!/usr/bin/env bash\n{ echo "cwd=$(pwd)"; echo "args=$*"; echo "build=\${AXF_BUILD_ID:-none}"; echo "model=$AXF_MODEL"; echo "job=$AXF_AGENT_JOB"; echo "head=$(git rev-parse HEAD)"; } > "${seen}"\necho "started axf-lander-fix-pr5-1--gina in $(pwd)"\n`);
  chmodSync(launcher, 0o755); mkdirSync(trees);
  const triageDir = join(r.dir, 'triage');
  const env = { ...process.env, AXF_PIPELINE_WORKTREES: trees, AXF_BUILD_ID: 'some-build', AXF_DISPATCH_TOKEN: 'x', AXF_MODEL_TRIAGE_DIR: triageDir, AXF_CLAUDE_SETTINGS_FILE: join(r.dir, 'no-settings.json') };
  const start = F.defaultFixSession(r.s, { env, launcher });
  const git = G.makeGit(r.work);
  const job = start({ git, b: { id: 'b', title: 'Build B' }, f: { kind: 'ci-red', why: 'CI is red', failing: ['tests'] }, branch: 'lander/b', pr: 5, log: 'boom', n: 1, of: 2 });
  assert.equal(job.exit, 0); assert.equal(job.session, 'axf-lander-fix-pr5-1--gina'); assert.equal(job.model, 'fable');
  const out = readFileSync(seen, 'utf8');
  assert.match(out, new RegExp(`cwd=.*${join('trees', 'lander-fix-b')}`)); assert.match(out, /--name lander-fix-pr5-1 /); assert.match(out, /--model claude-fable-5-2/);
  assert.match(out, /build=none/, 'no build id on the launch: it is not a build'); assert.match(out, /model=fable/); assert.match(out, /job=land-build/);
  assert.match(out, new RegExp(`head=${sh(r.work, 'rev-parse', 'origin/lander/b')}`), 'the worktree is at the PR branch\'s head');
  const brief = readFileSync(join(r.s.dataDir, 'fix', 'lander-fix-pr5-1.md'), 'utf8');
  assert.match(brief, /Push to this branch only/); assert.match(brief, /boom/);
  // the model is the VPS triage gate's (model-triage@1, lane lander-fix), and the decision is in its log
  const logged = readFileSync(join(triageDir, 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(logged.length, 1); assert.equal(logged[0].lane, 'lander-fix'); assert.equal(logged[0].rule, 'ci-fix'); assert.equal(logged[0].model, 'Fable'); assert.equal(logged[0].name, 'lander-fix-pr5-1'); assert.equal(logged[0].build, 'b');
  assert.equal(F.fixModel({ kind: 'clash-main', text: 'main conflicts with the PR' }, { env }).key, 'fable', 'a merge clash is Fable work by the gate\'s rule');
  writeFileSync(join(triageDir, 'config.json'), JSON.stringify({ rules: [{ id: 'ci-fix', model: 'opus' }] }));
  assert.equal(F.fixModel({ kind: 'ci-red', text: 'CI is red' }, { env }).key, 'opus', 'the rule is Brett\'s to change: the lander follows the gate');
  assert.ok(!readFileSync(new URL('../run.mjs', import.meta.url), 'utf8').includes('agent-job.mjs'), 'the lander no longer calls the agent roster');
  // a launcher that refuses: not started, with its last line as the reason
  writeFileSync(launcher, '#!/usr/bin/env bash\necho "claude-headless: every account is at its limit" >&2\nexit 3\n');
  const no = start({ git, b: { id: 'b' }, f: { kind: 'ci-red' }, branch: 'lander/b', pr: 5 });
  assert.equal(no.exit, 3); assert.match(no.why, /every account is at its limit/);
  assert.equal(start({ git, b: { id: 'b' }, f: {}, branch: 'lander/nope', pr: 6 }).why, 'lander/nope is not on GitHub');
});

test('L2-03: the land-build job type is Fable and never pushes to main', () => {
  const j = JSON.parse(readFileSync(new URL('../../../framework/assets/job-type/land-build.json', import.meta.url), 'utf8'));
  assert.equal(j.data.model, 'fable');
  const text = `${j.description}\n${j.data.brief}`;
  assert.ok(!/HEAD:main/.test(text), 'no push to main in the brief');
  assert.match(text, /[Nn]ever push to main/); assert.match(j.data.brief, /HEAD:\{\{branch\}\}/);
  assert.notEqual(j.data.trigger?.event, 'build.finished', 'a finished build is the lander\'s, not an agent\'s to push');
});

// ------------------------------------------------------------------ L2-04: never an untested head; a green PR merges as it is

test('L2-04: a tick that starts at merging-main and finds main moved merges the green PR as it is (Nov 24 2026: no pull, no CI again)', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const asked = []; let hold = true; const gh = github(r, (h) => { asked.push(h); return hold ? 'running' : 'success'; });
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  const first = sh(r.work, 'rev-parse', 'origin/lander/b');
  store.write('b', { status: 'merging-main', landing: { green: { head: first, at: now() } } }); // the tick before died right after CI went green
  pushMain(r, { 'other.txt': 'other\n' });
  hold = false; now.add(1); asked.length = 0;
  await tick(opts);
  const b = store.list[0];
  assert.equal(b.status, 'landed'); assert.equal(merges(gh), 1);
  assert.ok(!statuses(b).includes('failed'), 'main moving is not a failure and costs no attempt'); assert.equal(b.landing.attempt ?? 0, 0);
  assert.equal(b.landing.lastMerge.head, first, 'the head CI went green on is the head that merged: main was not pulled in');
  assert.deepEqual(asked, [], 'CI was not read or run again');
  assert.deepEqual(statuses(b).slice(-2), ['merging-main', 'landed']);
  assert.ok(onMain(r, 'a.txt') && onMain(r, 'other.txt'));
});

test('L2-04: a PR head that changed after CI went green is never merged untested: CI runs on the new head first', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const asked = []; const gh = github(r, (h) => { asked.push(h); return 'success'; });
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  let pushed = '';
  // someone pushes to the PR branch while the build rules run: after CI went green, before the merge
  const buildRules = () => {
    if (!pushed) {
      sh(r.work, 'fetch', '-q', 'origin'); sh(r.work, 'checkout', '-q', '--detach', 'origin/lander/b');
      writeFileSync(join(r.work, 'late.txt'), 'late\n'); sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '-m', 'a late push'); sh(r.work, 'push', '-q', 'origin', 'HEAD:lander/b');
      pushed = sh(r.work, 'rev-parse', 'HEAD'); sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
    }
    return { ok: true, failing: [], fixed: [] };
  };
  await tick(base(r, gh, store, now, { buildRules }));
  const b = store.list[0];
  assert.equal(b.status, 'landed'); assert.equal(merges(gh), 1);
  assert.equal(b.landing.lastMerge.head, pushed, 'the merge is pinned to the head that was tested last');
  assert.ok(asked.includes(pushed), 'CI was read on the pushed head before it merged');
  assert.ok(!statuses(b).includes('failed'));
});

test('L2-04: main moving while the build rules run changes nothing: the tested head merges as it is, the rules run once', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  // main moves while the build rules run (they can take 20 minutes): after the tick's fetch, before the merge
  let moved = ''; let ran = 0;
  const other = join(r.dir, 'other'); sh(r.dir, 'clone', '-q', r.origin, other);
  for (const [k, v] of [['user.name', 'o'], ['user.email', 'o@o']]) sh(other, 'config', k, v);
  const buildRules = () => {
    if (!ran++) { writeFileSync(join(other, 'late.txt'), 'late\n'); sh(other, 'add', '-A'); sh(other, 'commit', '-q', '-m', 'lands late'); sh(other, 'push', '-q', 'origin', 'HEAD:main'); moved = sh(other, 'rev-parse', 'HEAD'); }
    return { ok: true, failing: [], fixed: [] };
  };
  await tick(base(r, gh, store, now, { buildRules }));
  const b = store.list[0];
  assert.equal(b.status, 'landed');
  assert.ok(!holds(r, b.landing.lastMerge.head, moved), 'main was not pulled into the PR');
  assert.equal(merges(gh), 1, 'one merge, on the tested head'); assert.equal(ran, 1, 'the rules ran once');
  assert.ok(onMain(r, 'a.txt') && onMain(r, 'late.txt'));
});

test('L2-04: a PR head that is not the head CI went green on is never merged', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const asked = []; let hold = true; const gh = github(r, (h) => { asked.push(h); return hold ? 'running' : 'success'; });
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  await tick(opts);
  const green = sh(r.work, 'rev-parse', 'origin/lander/b');
  store.write('b', { status: 'merging-main', landing: { green: { head: green, at: now() } } });
  // someone pushes to the PR branch after CI went green
  sh(r.work, 'checkout', '-q', '--detach', 'origin/lander/b'); writeFileSync(join(r.work, 'sneak.txt'), 's\n');
  sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '-m', 'late push'); sh(r.work, 'push', '-q', 'origin', 'HEAD:lander/b'); sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
  const pushed = sh(r.work, 'rev-parse', 'origin/lander/b');
  now.add(1); asked.length = 0;
  const out = await tick(opts);
  assert.equal(merges(gh), 0, 'not merged: CI has not passed on this head'); assert.equal(store.list[0].status, 'running-ci'); assert.equal(out.waiting, 'CI is running');
  assert.deepEqual(asked, [pushed]);
  hold = false; now.add(1); await tick(opts);
  assert.equal(store.list[0].status, 'landed'); assert.equal(store.list[0].landing.lastMerge.head, pushed);
});

test('L2-04: main that cannot be read again right before the merge = no merge', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const real = G.makeGit(r.work); let fetches = 0;
  // the tick's first fetch works; the one right before the merge does not
  const git = (args, o) => (args[0] === 'fetch' && args.some((a) => a.startsWith('+refs/heads/main:')) && args.some((a) => a.startsWith('+refs/heads/lander/')) && ++fetches ? { code: 1, out: '', err: 'fatal: unable to access origin' } : real(args, o));
  await tick(base(r, gh, store, now, { git }));
  const b = store.list[0];
  assert.equal(fetches, 1); assert.equal(merges(gh), 0); assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'infra'); assert.match(b.failure.why, /nothing merges blind/);
});

// ------------------------------------------------------------------ L2-05: the build-rules gate fails closed

test('L2-05: build rules that could not run are tried once more, then fail as infra: the PR never merges on them', async () => {
  for (const answer of [null, undefined, { error: 'the rules runner timed out after 20 min', tail: 'checking home-card…' }, {}, { ok: 'yes' }, 'crash']) {
    const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
    const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
    let runs = 0;
    const opts = base(r, gh, store, now, { buildRules: () => { runs++; if (answer === 'crash') throw new Error('runner exploded'); return answer; } });
    let out = await tick(opts);
    let b = store.list[0];
    assert.equal(b.status, 'running-ci', `${JSON.stringify(answer)}: not merged, not failed yet`); assert.equal(merges(gh), 0);
    assert.equal(b.landing.rules.ok, false); assert.equal(b.landing.rules.tries, 1); assert.equal(out.waiting, 'the build rules run again');
    now.add(1); out = await tick(opts);
    b = store.list[0];
    assert.equal(runs, 2, 'one retry'); assert.equal(merges(gh), 0, 'the gate did not open');
    assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'infra'); assert.match(b.failure.why, /build rules could not run/);
    if (answer?.tail) assert.match(b.failure.why, /Last lines: checking home-card…/, 'the runner\'s last lines are in the failure');
    assert.ok(!onMain(r, 'a.txt'));
    // the retry runs the rules again (never reads the error back), and a pass then lands it
    now.add(L.backoffMinutes(1) + 1);
    await tick({ ...opts, buildRules: () => { runs++; return { ok: true, failing: [], fixed: [] }; } });
    assert.equal(store.list[0].status, 'landed'); assert.equal(runs, 3);
  }
});

test('L2-05: only "no provider installed" and the off switch skip the gate', async () => {
  for (const skipped of ['no build-rules provider installed', 'switched off (AXF_LANDER_BUILD_RULES=off)']) {
    const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
    const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
    const out = await tick(base(r, gh, store, now, { buildRules: () => ({ skipped }) }));
    assert.equal(store.list[0].status, 'landed');
    assert.ok(out.actions.some((a) => a.includes(`build rules skipped: ${skipped}`)), 'a skip is said, with its reason');
  }
});

test('L2-05: the runner\'s answer is pass, fail or could-not-run; a crash, a timeout or no JSON is never a pass', () => {
  const ok = readRulesAnswer({ status: 0, stdout: JSON.stringify({ ok: true, runs: [{ id: 'a', result: 'pass' }, { id: 'b', result: 'fixed' }], commit: { sha: 'abc' } }) });
  assert.deepEqual(ok, { ok: true, failing: [], fixed: ['b'], detail: '', commit: 'abc' });
  const bad = readRulesAnswer({ status: 1, stdout: JSON.stringify({ ok: false, runs: [{ id: 'home-card', result: 'fail', detail: 'no card' }] }) });
  assert.equal(bad.ok, false); assert.deepEqual(bad.failing, ['home-card']); assert.equal(bad.detail, 'home-card: no card');
  assert.match(readRulesAnswer({ status: 1, stdout: 'TypeError: x is not a function', stderr: 'at runner.mjs:10' }).error, /printed no JSON \(exit 1\)/);
  assert.match(readRulesAnswer({ status: 1, stdout: '', stderr: 'boom\nat runner.mjs:10' }).tail, /boom \| at runner\.mjs:10/);
  assert.match(readRulesAnswer({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' }, stdout: '' }).error, /timed out after 20 min/);
  assert.match(readRulesAnswer({ status: 0, stdout: '{}' }).error, /no verdict/);
  assert.match(readRulesAnswer({ status: 0, stdout: 'null' }).error, /no verdict/);
  assert.equal(readRulesAnswer({ status: 0, stdout: JSON.stringify({ ok: false, runs: [] }) }).ok, false, 'not ok with no rule named is still a fail');
});

// ------------------------------------------------------------------ L2-06: every check, every page

test('L2-06: a red check on the second page of check runs is seen', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const runs = Array.from({ length: 230 }, (_, i) => check(`job ${i}`, i === 217 ? 'failure' : 'success', { id: i + 1 }));
  const gh = github(r, () => runs);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  await tick(base(r, gh, store, now));
  const b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.failure.kind, 'ci-red'); assert.deepEqual(b.failure.failing, ['job 217']); assert.deepEqual(b.failure.jobIds, [218]);
  assert.equal(merges(gh), 0);
  assert.deepEqual(gh.calls.filter((c) => c.includes('/check-runs')).map((c) => c.match(/page=(\d+)$/)[1]).slice(0, 3), ['1', '2', '3'], 'every page was read (the red head first; main is read after it, to say whether the red is main\'s)');
});

test('L2-06: green waits for every required check; the full run is started once when one never reports', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  let runs = [check('Build engine sweep (Node)')];
  const gh = github(r, () => runs);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now, { cfg: cfg({ requiredChecks: ['Build engine sweep (Node)', 'Web Dev Console (React/TS) + Python API', 'Gradle — framework modules, kernel tests, console APK'] }) });
  let out = await tick(opts);
  assert.equal(store.list[0].status, 'running-ci'); assert.equal(merges(gh), 0, 'one workflow done is not green');
  assert.match(out.waiting, /waiting for required checks: Web Dev Console \(React\/TS\) \+ Python API, Gradle/);
  now.add(11); await tick(opts); now.add(1); await tick(opts);
  assert.equal(gh.calls.filter((c) => c.includes('/dispatches')).length, 1, 'the full run is started once per head');
  runs = [...runs, check('Web Dev Console (React/TS) + Python API'), check('Gradle — framework modules, kernel tests, console APK', 'skipped')];
  now.add(1); await tick(opts);
  assert.equal(store.list[0].status, 'landed', 'all three reported (one skipped by the CI scope): green');
  // never reporting is a CI timeout, not a silent wait
  const r2 = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh2 = github(r2, () => [check('Build engine sweep (Node)')]); const now2 = clock(); const store2 = memoryStore([build([['s1', 'claude/b-s1']])], { now: now2 });
  const opts2 = base(r2, gh2, store2, now2, { cfg: cfg({ requiredChecks: ['Gradle'] }) });
  await tick(opts2); now2.add(121); await tick(opts2);
  assert.equal(store2.list[0].failure.kind, 'ci-timeout'); assert.match(store2.list[0].failure.why, /required checks never reported in 120 min: Gradle/);
});

test('L2-06: a neutral check is not green', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh = github(r, () => [check('tests'), check('lint', 'neutral', { id: 2 })]);
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  await tick(base(r, gh, store, now));
  assert.equal(store.list[0].status, 'failed'); assert.deepEqual(store.list[0].failure.failing, ['lint (neutral)']); assert.equal(merges(gh), 0);
});

test('L2-06: the shipped config names the full run\'s jobs as they are in the workflow', () => {
  const c = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  const yml = readFileSync(new URL('../../../.github/workflows/android.yml', import.meta.url), 'utf8');
  assert.ok(c.requiredChecks.length >= 3);
  for (const n of c.requiredChecks) assert.ok(yml.includes(`name: ${n}\n`), `android.yml has a job named "${n}"`);
  assert.deepEqual(L.normConfig(c).requiredChecks, c.requiredChecks);
  assert.deepEqual(L.normConfig({ requiredChecks: 'a, b | c' }).requiredChecks, ['a, b', 'c'], 'names hold commas: `|` separates them on the command line');
});

// ------------------------------------------------------------------ L2-08: the real pair, and no split for good

test('L2-08: a clash between step 2 and step 3 is reported as those two, not "step 1 and step 3"', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/b-s2': { 'shared.txt': 'one\nTWO by s2\nthree\n' }, 'claude/b-s3': { 'shared.txt': 'one\nTWO by s3\nthree\n' } });
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2'], ['s3', 'claude/b-s3']])], { now });
  await tick(base(r, gh, store, now));
  const b = store.list[0];
  assert.equal(b.failure.kind, 'clash-steps');
  assert.match(b.failure.why, /^claude\/b-s2 and claude\/b-s3 conflict in code \(shared\.txt\)/);
});

test('L2-08: red CI on a combined PR splits only after the fixes, and only when the failing log names one step\'s files', async () => {
  const steps = { 'claude/b-s1': { 'src/a.mjs': 'a\n' }, 'claude/b-s2': { 'src/b.mjs': 'b\n' } };
  const run = async (logText) => {
    const r = repo(steps);
    const gh = github(r, () => 'failure'); gh.logs[7] = logText;
    const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
    let fixes = 0;
    const opts = base(r, gh, store, now, { cfg: cfg({ flakyReruns: 0, maxFixes: 1, maxAttempts: 10 }), fixSession: () => { fixes++; return { exit: 0, session: 'f' }; } });
    await tick(opts);
    assert.equal(store.list[0].failure.retry, 'fix', 'first a fix on the PR as it is');
    now.add(3); await tick(opts); assert.equal(fixes, 1);
    // the fix pushes, CI is still red on the new head
    sh(r.work, 'checkout', '-q', '--detach', 'origin/lander/b'); writeFileSync(join(r.work, 'try.txt'), 't\n'); sh(r.work, 'add', '-A'); sh(r.work, 'commit', '-q', '-m', 'try'); sh(r.work, 'push', '-q', 'origin', 'HEAD:lander/b'); sh(r.work, 'checkout', '-q', '--detach', 'origin/main');
    now.add(1); await tick(opts);
    return { b: store.list[0], gh, fixes };
  };
  const tied = await run('not ok 3 - src/b.mjs:1 expected b');
  assert.equal(tied.b.failure.retry, 'split'); assert.equal(tied.b.failure.tiedStep, 's2');
  const loose = await run('not ok 3 - integration: the two halves disagree');
  assert.equal(loose.b.failure.retry, 'hold', 'steps that only work together are not split apart'); assert.equal(loose.b.failure.needsBrett, true);
  assert.equal(loose.gh.prs.get(1).state, 'open', 'the PR stays whole');
});

// ------------------------------------------------------------------ L2-10: clean up after a landing

test('L2-10: after landed the merged step branches and their worktrees are gone; unmerged work is kept', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/b-s2': { 'b.txt': 'b\n' }, 'claude/other': { 'o.txt': 'o\n' } });
  const wt1 = join(r.dir, 'b--s1'); const wt2 = join(r.dir, 'b--s2');
  sh(r.work, 'worktree', 'add', '-q', wt1, 'claude/b-s1'); sh(r.work, 'worktree', 'add', '-q', wt2, 'claude/b-s2');
  writeFileSync(join(wt1, '.axf-brief.md'), 'brief\n'); // session leftovers do not keep a worktree
  // step 2's worktree has a commit that was never pushed: it must survive
  writeFileSync(join(wt2, 'unpushed.txt'), 'u\n'); sh(wt2, 'add', '-A'); sh(wt2, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'not pushed');
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']])], { now });
  const out = await tick(base(r, gh, store, now));
  assert.equal(store.list[0].status, 'landed');
  const remote = sh(r.work, 'ls-remote', '--heads', 'origin');
  assert.ok(!remote.includes('refs/heads/claude/b-s1'), 'the merged step branch is gone from GitHub');
  assert.ok(!remote.includes('refs/heads/lander/b'), 'and the PR branch');
  assert.ok(!existsSync(wt1), 'its worktree is removed');
  assert.equal(spawnSync('git', ['rev-parse', '-q', '--verify', 'refs/heads/claude/b-s1'], { cwd: r.work }).status, 1, 'and the local branch');
  assert.ok(existsSync(join(wt2, 'unpushed.txt')), 'a worktree with a commit main lacks is kept');
  assert.ok(remote.includes('refs/heads/claude/b-s2'), 'and so is its branch');
  assert.ok(remote.includes('refs/heads/claude/other'), 'a branch of another build is never touched');
  assert.ok(remote.includes('refs/heads/main'));
  assert.ok(out.actions.some((a) => /cleaned up: 1 step branch\(es\), 1 worktree\(s\)/.test(a)));
  assert.ok(!sh(r.work, 'worktree', 'list').includes('b--s1'));
});

test('L2-10: cleanup never touches main, the checkout the lander runs in, or a branch that is not on main; it can be switched off', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/open': { 'x.txt': 'x\n' } });
  const git = G.makeGit(r.work);
  const c = G.cleanupLanded({ s: r.s, git, branches: ['main', 'claude/open', 'HEAD', ''] });
  assert.deepEqual(c.branches, []); assert.deepEqual(c.kept, [{ branch: 'claude/open', why: 'it has commits main lacks' }]);
  assert.ok(sh(r.work, 'ls-remote', '--heads', 'origin').includes('refs/heads/main'));
  const gh = github(r); const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  await tick(base(r, gh, store, now, { cfg: cfg({ cleanup: false }) }));
  assert.equal(store.list[0].status, 'landed');
  assert.ok(sh(r.work, 'ls-remote', '--heads', 'origin').includes('refs/heads/claude/b-s1'), 'cleanup: false leaves the step branches');
});

// ------------------------------------------------------------------ L2-12: the lock

test('L2-12: a killed tick\'s lock is dropped at once; a running tick\'s lock holds however old it is', () => {
  const r = repo({});
  mkdirSync(r.s.dataDir, { recursive: true });
  const f = join(r.s.dataDir, 'lander.lock');
  const mine = takeLock(f);
  assert.ok(mine.ok); assert.equal(JSON.parse(readFileSync(f, 'utf8')).pid, process.pid, 'the lock names its tick');
  assert.equal(takeLock(f).ok, false, 'a second tick does nothing');
  const old = new Date(Date.now() - 3 * 3600e3); utimesSync(f, old, old);
  assert.equal(takeLock(f).ok, false, 'three hours old, but its tick still runs: not stolen');
  mine.release(); assert.ok(!existsSync(f));
  // a tick that was killed: its pid is gone
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(f, JSON.stringify({ pid: Number(dead), at: new Date().toISOString() }));
  const next = takeLock(f);
  assert.ok(next.ok, 'no 30-minute wait behind a dead tick'); next.release();
  // a lock from before pids: only its age counts
  writeFileSync(f, ''); assert.equal(takeLock(f).ok, false);
  utimesSync(f, old, old); const late = takeLock(f); assert.ok(late.ok); late.release();
});
