// node --test deploy/lander/test-ci-stall.mjs
// The CI stall on the lander's one-part PRs (#915, #916, #917, Nov 24-25 2026), replayed from what GitHub recorded on
// their heads (fixtures/ci-stall: check runs, commit statuses, android.yml workflow runs; no tokens, no private data)
// through the lander's CI decision (ci-state.mjs) and its failure ladder, with a fake GitHub. No network, no model.
//
// What the recording shows: the full CI run started by itself on every head (a pull_request run, no dispatch needed),
// every required check reported under its own name, and two of them were red (the help coverage ratchet). The PRs sat
// because the landing run's attempt count was already used up by the PRs before them, so the first red CI on #916 and
// #917 stopped the build for Brett with no re-run and no fix session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repo, github, check, build, clock, base } from './test/helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const L = await import('./lander-core.mjs');
const C = await import('./ci-state.mjs');
const { tick } = await import('./run.mjs');
const { memoryStore } = await import('./store.mjs');

const cfg = L.normConfig(JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8')));
const workflow = readFileSync(join(HERE, '..', '..', '.github', 'workflows', cfg.workflow), 'utf8');
const fixture = (n) => JSON.parse(readFileSync(join(HERE, 'fixtures', 'ci-stall', `pr-${n}.json`), 'utf8'));
const PRS = [915, 916, 917];
const LIGHT = 'Light PR checks (full run happens once, in the merge queue)';
const min = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString();

/** A fake GitHub that serves the recorded heads, and records (or refuses) what the lander would send. */
function fakeGithub(fixtures, { refuse = '' } = {}) {
  const heads = new Map(); const sent = [];
  for (const f of fixtures) { for (const [sha, h] of Object.entries(f.heads)) heads.set(sha, h); heads.set(f.base.sha, { check_runs: f.base.check_runs, statuses: [], workflow_runs: [] }); }
  const of = (sha) => [...heads.entries()].find(([k]) => k.startsWith(sha))?.[1] || { check_runs: [], statuses: [], workflow_runs: [] };
  const gh = async (method, path) => {
    let m;
    if (method === 'GET' && (m = path.match(/\/commits\/([0-9a-f]+)\/check-runs\?per_page=(\d+)&page=(\d+)$/))) { const all = of(m[1]).check_runs; const per = Number(m[2]); return { total_count: all.length, check_runs: all.slice((Number(m[3]) - 1) * per, Number(m[3]) * per) }; }
    if (method === 'GET' && (m = path.match(/\/commits\/([0-9a-f]+)\/status(\?|$)/))) return { statuses: of(m[1]).statuses };
    if (method === 'GET' && (m = path.match(/\/actions\/runs\?head_sha=([0-9a-f]+)/))) return { workflow_runs: of(m[1]).workflow_runs };
    if (method === 'POST' && /\/dispatches$/.test(path)) { sent.push(path); if (refuse) { const e = new Error(refuse); e.status = 422; throw e; } return null; }
    throw new Error(`fake GitHub: ${method} ${path}`);
  };
  gh.sent = sent;
  return gh;
}
/** Every check run on a commit, the way run.mjs reads them (all pages). */
async function checksOf(gh, sha) {
  const runs = [];
  for (let page = 1; page <= 50; page++) { const r = await gh('GET', `/repos/o/r/commits/${sha}/check-runs?per_page=100&page=${page}`); runs.push(...r.check_runs); if (r.check_runs.length < 100) break; }
  return runs;
}
/** The decision on a PR's recorded head at the minute the lander took it. */
async function decide(f, { runs, landing = {}, at = f.lander.verdictAt, statusAt = f.lander.runningCiAt, withBase = true } = {}) {
  const gh = fakeGithub([f]);
  const head = f.pr.head.sha;
  const d = C.ciDecision({
    runs: runs || await checksOf(gh, head), statuses: (await gh('GET', `/repos/o/r/commits/${head}/status`)).statuses,
    baseRuns: withBase ? await checksOf(gh, f.base.sha) : null, baseSha: f.base.sha, reportable: C.checkNames?.(workflow) ?? null,
    head, landing, statusAt, at, cfg,
  });
  return { d, gh, head };
}
/** The failure record the ladder writes for a decision (what run.mjs's `fail` hands to L.failure). */
const ladder = (f, d, landing, extra = {}) => L.failure({ id: 'b', status: 'running-ci', landing }, d.fail.kind, { at: f.lander.verdictAt, status: 'running-ci', groupSize: 1, reruns: f.lander.rerunsBefore, fixes: f.lander.fixesBefore, head: f.pr.head.sha, pr: f.pr.number, ...d.fail.ctx, ...extra }, cfg);
/** The recorded check runs with the red ones green: the head once the cause (the help coverage ratchet) is fixed. */
const fixed = (runs) => runs.map((r) => (r.conclusion === 'failure' ? { ...r, conclusion: 'success' } : r));

// ------------------------------------------------------------------ the evidence, as recorded

test('the recording: the full run started by itself on every head, as a pull_request run, and no dispatch was ever sent', () => {
  for (const n of PRS) {
    const f = fixture(n); const h = f.heads[f.pr.head.sha];
    assert.ok(h, `#${n}: the PR head is recorded`);
    assert.deepEqual(h.workflow_runs.map((r) => [r.event, r.status, r.conclusion]), [['pull_request', 'completed', 'failure']], `#${n}: one android.yml run on the head, finished, red`);
    assert.equal(Object.values(f.heads).flatMap((x) => x.workflow_runs).filter((r) => r.event === 'workflow_dispatch').length, 0, `#${n}: no dispatched run on any head`);
    assert.equal(L.lightOnly(h.check_runs), false, `#${n}: not a light-only head (the light job was skipped, the full jobs ran)`);
    assert.equal(h.check_runs.find((r) => r.name === LIGHT)?.conclusion, 'skipped');
    assert.equal(h.statuses.length, 0, `#${n}: the jobs report check runs, no commit statuses`);
    assert.equal(f.pr.mergeable_state_while_open, 'unstable');
  }
});

test('the recording: every required name is a job of the workflow and reported on the head under that exact name', () => {
  for (const name of cfg.requiredChecks) assert.ok(workflow.includes(`name: ${name}\n`), `${cfg.workflow} has a job named "${name}"`);
  for (const n of PRS) {
    const f = fixture(n); const runs = f.heads[f.pr.head.sha].check_runs;
    for (const name of cfg.requiredChecks) assert.ok(runs.some((r) => r.name === name && r.status === 'completed'), `#${n}: "${name}" reported`);
    assert.deepEqual(L.ciOf(runs, { required: cfg.requiredChecks }).missing, [], `#${n}: nothing missing`);
  }
});

test('the recording: CI was red on the pinned head, on required checks, so `unstable` was the truth and not a stall', async () => {
  for (const n of PRS) {
    const f = fixture(n); const { d, gh } = await decide(f, { landing: { attempt: f.lander.attemptBefore } });
    assert.equal(d.state, 'failure', `#${n}`);
    assert.equal(d.fail.kind, 'ci-red');
    assert.deepEqual([...d.ci.failing].sort(), ['Build engine sweep (Node)', 'Web Dev Console (React/TS) + Python API']);
    for (const name of d.ci.failing) assert.ok(cfg.requiredChecks.includes(name), `"${name}" is a required check`);
    assert.equal(d.kick, null, 'nothing to dispatch: the run is there');
    assert.equal(gh.sent.length, 0);
    assert.match(f.lander.recorded, new RegExp(`CI is red on ${f.pr.head.sha.slice(0, 9)}`), 'and that is what the lander wrote at the time');
  }
});

test('an older head of the PR (its run cancelled by the next push) never decides: only the pinned head is read', async () => {
  for (const n of [916, 917]) {
    const f = fixture(n);
    const older = Object.entries(f.heads).find(([sha, h]) => sha !== f.pr.head.sha && h.workflow_runs.some((r) => r.conclusion === 'cancelled'));
    assert.ok(older, `#${n}: a cancelled run on an older head is in the recording`);
    const { d } = await decide(f, { landing: {} });
    assert.ok(d.ci.jobIds.every((id) => f.heads[f.pr.head.sha].check_runs.some((r) => r.id === id)), 'the failing jobs are the head\'s own');
  }
});

// ------------------------------------------------------------------ the stall, and the fix

test('#915: red on its own change, mid-ladder when it was merged by hand (a re-run was due, nothing was stuck)', async () => {
  const f = fixture(915); const landing = { attempt: f.lander.attemptBefore };
  const { d } = await decide(f, { landing });
  const fr = ladder(f, d, landing);
  assert.equal(fr.attempt, 4, 'the landing run had failed three times before: a step clash, a refused merge, a clash with main');
  assert.notEqual(fr.failure.retry, 'hold', 'not stopped: the ladder goes on by itself');
  assert.equal(fr.failure.retry, 'rerun', 'main was green under it, so the red may be flaky: one re-run first');
  assert.ok(Date.parse(fr.failure.notBefore) < Date.parse(f.pr.merged_at), 'the retry was due before the hand merge');
});

for (const n of [916, 917]) {
  test(`#${n}: the stall as it happened (the count of the PRs before it used up: stopped on its first red CI)`, async () => {
    const f = fixture(n); const landing = { attempt: f.lander.attemptBefore };
    const { d } = await decide(f, { landing });
    const fr = ladder(f, d, landing);
    assert.equal(fr.failure.retry, 'hold'); assert.equal(fr.failure.needsBrett, true);
    assert.match(fr.failure.stopped, new RegExp(`attempt ${f.lander.attemptBefore + 1} of 5`));
    assert.match(f.lander.recorded, /Stopped \(attempt \d of 5\): needs Brett/);
  });

  test(`#${n}: after the PR before it merged, its first red CI climbs the ladder instead of stopping the build`, async () => {
    const f = fixture(n);
    // the build as the PR before this one left it, then that PR's merge recorded the way run.mjs records it
    const before = { id: 'b', landing: { attempt: f.lander.attemptBefore, merged: [n - 2], fixes: { pr: n - 1, n: 1 } } };
    const landing = { ...before.landing, ...C.prMerged(before, { pr: n - 1, sha: f.base.sha, head: 'h', at: f.pr.created_at }) };
    const { d } = await decide(f, { landing });
    const fr = ladder(f, d, landing, { fixes: 0 });
    assert.equal(fr.attempt, 1, 'a new PR: its own count');
    assert.notEqual(fr.failure.retry, 'hold');
    assert.equal(fr.failure.retry, 'rerun', 'the ladder from its first rung: one re-run at once, then a fix session');
    assert.equal(fr.failure.notBefore, f.lander.verdictAt, 'no backoff before the first re-run');
    assert.match(fr.failure.why, new RegExp(`also red on main \\(${f.base.sha}\\)`), 'and the failure says the red came in with main, for the fix brief');
    const second = L.failure({ id: 'b', status: 'running-ci', landing: { ...landing, attempt: 1 } }, d.fail.kind, { at: f.lander.verdictAt, reruns: 1, fixes: 0, head: f.pr.head.sha, pr: n, ...d.fail.ctx }, cfg);
    assert.equal(second.failure.retry, 'fix', 'still red after the re-run: a fix session on the PR');
  });
}

for (const n of PRS) {
  test(`#${n}: green once the cause is fixed on the head, whatever mergeable_state says`, async () => {
    const f = fixture(n);
    const { d, gh } = await decide(f, { runs: fixed(f.heads[f.pr.head.sha].check_runs), landing: {} });
    assert.equal(f.pr.mergeable_state_while_open, 'unstable', 'GitHub\'s summary is not read: the check runs on the pinned head are');
    assert.equal(d.state, 'success'); assert.equal(d.fail, null); assert.equal(d.kick, null); assert.equal(d.waiting, '');
    assert.deepEqual(d.ci.missing, []);
    assert.equal(gh.sent.length, 0);
  });
}

test('a check that is not GitHub Actions (a review bot) and a skipped job never block; a red job that is not required still does', async () => {
  const f = fixture(916); const green = fixed(f.heads[f.pr.head.sha].check_runs);
  assert.ok(green.some((r) => r.app.slug !== 'github-actions'), 'the review bot\'s check is in the recording');
  const bot = green.map((r) => (r.app.slug !== 'github-actions' ? { ...r, conclusion: 'failure' } : r));
  assert.equal((await decide(f, { runs: bot })).d.state, 'success');
  const other = [...green, { id: 5, name: 'build-publish', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure', started_at: '2026-11-24T21:30:00Z', details_url: 'https://github.com/o/r/actions/runs/9/job/5' }];
  const { d } = await decide(f, { runs: other });
  assert.equal(d.state, 'failure', 'nothing is loosened: every Actions job on the head has to be green');
});

test('red checks are named apart: required ones first, the others marked as not required', async () => {
  const f = fixture(916);
  const other = [...f.heads[f.pr.head.sha].check_runs, { id: 5, name: 'build-publish', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure', started_at: '2026-11-24T21:30:00Z', details_url: 'https://github.com/o/r/actions/runs/9/job/5' }];
  const { d } = await decide(f, { runs: other });
  assert.match(d.fail.ctx.why, /not required: build-publish/);
  assert.deepEqual(d.fail.ctx.failingRequired.sort(), ['Build engine sweep (Node)', 'Web Dev Console (React/TS) + Python API']);
});

// ------------------------------------------------------------------ the dispatch side (not what stalled these PRs)

const light = (at) => [{ id: 1, name: 'CI scope (what changed)', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success', started_at: at }, { id: 2, name: LIGHT, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success', started_at: at }];

test('a light-only head under the real job names is seen as light-only: the full run is dispatched at once, once per head while its run can still show up', () => {
  const t0 = '2026-11-24T21:00:00Z'; const head = 'a'.repeat(40);
  const first = C.ciDecision({ runs: light(t0), head, landing: {}, statusAt: t0, at: t0, cfg });
  assert.equal(first.state, 'light-only'); assert.equal(first.kick.marker, 'fullKick');
  const next = C.ciDecision({ runs: light(t0), head, landing: { fullKick: { head, at: t0 } }, statusAt: t0, at: min(t0, 5), cfg });
  assert.equal(next.kick, null, 'five minutes on: the run may still be on its way');
});

test('a dispatch that produced no run on the head is sent again after a wait, a bounded number of times', () => {
  const t0 = '2026-11-24T21:00:00Z'; const head = 'a'.repeat(40); let landing = {}; let sends = 0; let last = null;
  for (let m = 0; m <= 600; m++) {
    last = C.ciDecision({ runs: light(t0), head, landing, statusAt: t0, at: min(t0, m), cfg });
    if (last.fail) break;
    if (last.kick) { sends++; landing = { ...landing, [last.kick.marker]: { head, at: min(t0, m) } }; }
  }
  assert.ok(sends >= 2, 'sent again');
  assert.ok(sends <= Math.ceil(cfg.ciTimeoutMin / C.rekickMinutes(cfg)) + 1, `bounded (${sends} sends)`);
  assert.equal(last.fail.kind, 'ci-timeout', 'and then it is a failure with attempt N, never an endless wait');
  // a run for this exact head showed up after the dispatch: the dispatch is done, nothing is sent again
  const ran = [...light(t0), { id: 3, name: 'Build engine sweep (Node)', app: { slug: 'github-actions' }, status: 'in_progress', conclusion: null, started_at: min(t0, 2) }];
  const seen = C.ciDecision({ runs: ran, head, landing: { fullKick: { head, at: t0 } }, statusAt: t0, at: min(t0, 90), cfg });
  assert.equal(seen.state, 'running'); assert.equal(seen.kick, null);
});

test('a head no CI ever starts on is a failure after the timeout, never an endless wait', () => {
  const t0 = '2026-11-24T21:00:00Z'; const head = 'b'.repeat(40);
  const d = C.ciDecision({ runs: [], head, landing: { ciKick: { head, at: min(t0, 10) } }, statusAt: t0, at: min(t0, cfg.ciTimeoutMin + 1), cfg });
  assert.equal(d.state, 'none'); assert.equal(d.fail?.kind, 'ci-timeout');
  assert.equal(L.failure({ id: 'b', status: 'running-ci', landing: {} }, d.fail.kind, { ...d.fail.ctx, at: t0 }, cfg).failure.retry, 'rerun', 'the existing retry: CI is started again, as attempt N');
});

test('a dispatch GitHub refuses is recorded with its error and tried again after the wait, not every minute', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' } });
  const gh0 = github(r, () => 'light'); let refused = 0;
  const gh = async (method, path, body) => { if (method === 'POST' && path.endsWith('/dispatches')) { refused++; const e = new Error('GitHub 422: Workflow does not have \'workflow_dispatch\' trigger'); e.status = 422; throw e; } return gh0(method, path, body); };
  Object.assign(gh, { text: gh0.text, logs: gh0.logs });
  const now = clock(); const store = memoryStore([build([['s1', 'claude/b-s1']])], { now });
  const opts = base(r, gh, store, now);
  const out = await tick(opts);
  assert.equal(refused, 1);
  assert.ok(out.actions.some((a) => /refused/.test(a) && /workflow_dispatch/.test(a)), 'the refusal and its error are in the tick\'s record');
  for (let i = 0; i < 5; i++) { now.add(1); await tick(opts); }
  assert.equal(refused, 1, 'not sent again every minute');
  now.add(C.rekickMinutes(cfg)); await tick(opts);
  assert.equal(refused, 2, 'sent again after the wait');
});

// ------------------------------------------------------------------ required names

test('a required name no job of the workflow can report is a named failure at once, not a wait', async () => {
  const f = fixture(916); const runs = fixed(f.heads[f.pr.head.sha].check_runs);
  const odd = { ...cfg, requiredChecks: [...cfg.requiredChecks, 'Web console (renamed job)'] };
  const d = C.ciDecision({ runs, reportable: C.checkNames(workflow), head: f.pr.head.sha, landing: {}, statusAt: f.lander.runningCiAt, at: min(f.lander.runningCiAt, 1), cfg: odd });
  assert.notEqual(d.state, 'success', 'never dropped to get a merge');
  assert.ok(d.fail, 'a failure in the first minute');
  assert.match(d.fail.ctx.why, /"Web console \(renamed job\)"/); assert.match(d.fail.ctx.why, new RegExp(cfg.workflow.replace('.', '\\.')));
  assert.deepEqual(d.fail.ctx.failing, ['Web console (renamed job)']);
});

test('a required name reported as a commit status counts like a check run; a skipped required job has reported; a neutral one is red', async () => {
  const f = fixture(916); const all = fixed(f.heads[f.pr.head.sha].check_runs);
  const name = 'Build engine sweep (Node)'; const without = all.filter((r) => r.name !== name);
  const call = (statuses, runs = without) => C.ciDecision({ runs, statuses, head: f.pr.head.sha, landing: {}, statusAt: f.lander.runningCiAt, at: f.lander.verdictAt, cfg });
  assert.equal(call([]).state, 'missing');
  assert.equal(call([{ context: name, state: 'success', updated_at: '2026-11-24T21:30:00Z' }]).state, 'success');
  assert.equal(call([{ context: name, state: 'pending', updated_at: '2026-11-24T21:30:00Z' }]).state, 'running');
  assert.equal(call([{ context: name, state: 'failure', updated_at: '2026-11-24T21:30:00Z' }]).state, 'failure');
  assert.equal(call([{ context: 'some other service', state: 'failure', updated_at: '2026-11-24T21:30:00Z' }], all).state, 'success', 'a status that is not a required name is not CI');
  const gradle = 'Gradle — framework modules, kernel tests, console APK';
  assert.equal(fixture(917).heads[fixture(917).pr.head.sha].check_runs.find((r) => r.name === gradle).conclusion, 'skipped', '#917: the CI scope skipped Gradle');
  assert.equal(call([], all.map((r) => (r.name === gradle ? { ...r, conclusion: 'skipped' } : r))).state, 'success', 'skipped by the CI scope: reported');
  assert.equal(call([], all.map((r) => (r.name === gradle ? { ...r, conclusion: 'neutral' } : r))).state, 'failure', 'neutral is not green');
});

// ------------------------------------------------------------------ the timeout clock

test('the CI timeout counts from the run on the current head, not from an older status change', async () => {
  const f = fixture(916); const head = f.pr.head.sha;
  const running = f.heads[head].check_runs.map((r) => (r.conclusion === 'failure' ? { ...r, status: 'in_progress', conclusion: null, completed_at: null } : r));
  const start = running.filter((r) => r.app.slug === 'github-actions').map((r) => r.started_at).sort()[0];
  // the build entered running-ci long before this head existed (a push to the PR: the build rules' own fix, a fixer)
  const stale = min(start, -(cfg.ciTimeoutMin - 5));
  const early = C.ciDecision({ runs: running, head, landing: {}, statusAt: stale, at: min(start, 30), cfg });
  assert.equal(early.state, 'running'); assert.equal(early.fail, null, '30 minutes into this head\'s run is not a timeout');
  assert.equal(early.since, start);
  const late = C.ciDecision({ runs: running, head, landing: {}, statusAt: stale, at: min(start, cfg.ciTimeoutMin + 1), cfg });
  assert.equal(late.fail.kind, 'ci-timeout');
  assert.equal(L.failure({ id: 'b', status: 'running-ci', landing: { attempt: 1 } }, 'ci-timeout', { ...late.fail.ctx, at: start }, cfg).attempt, 2, 'the existing failed / attempt N path');
});

// ------------------------------------------------------------------ end to end: the count is per PR

test('end to end: a build split into one PR per step gives every PR its own attempts (the stall of #916 and #917)', async () => {
  const r = repo({ 'claude/b-s1': { 'a.txt': 'a\n' }, 'claude/b-s2': { 'b.txt': 'b\n' } });
  const gh = github(r, () => [check('Build engine sweep (Node)', 'failure', { id: 7, details_url: 'https://github.com/o/r/actions/runs/42/job/7' })]);
  const now = clock();
  // the landing run so far: split, four failures behind it (as the build was when #915 went red)
  const store = memoryStore([build([['s1', 'claude/b-s1'], ['s2', 'claude/b-s2']], { landing: { split: true, attempt: 3 }, status: 'merging-pr' })], { now });
  const opts = base(r, gh, store, now, { cfg: L.normConfig({ flakyReruns: 0, maxFixes: 2 }) });
  await tick(opts);
  let b = store.list[0];
  assert.equal(b.status, 'failed'); assert.equal(b.landing.attempt, 4); assert.equal(b.failure.pr, 1);
  // PR 1 is merged by hand, red (as #915 was): main is red now, and PR 2 is red on its first CI run
  gh.mergeByHand(1);
  for (let i = 0; i < 4 && !(store.list[0].status === 'failed' && store.list[0].failure.pr === 2); i++) { now.add(1); await tick(opts); }
  b = store.list[0];
  assert.deepEqual(b.landing.merged, [1]);
  assert.equal(b.status, 'failed'); assert.equal(b.failure.pr, 2);
  assert.equal(b.landing.attempt, 1);
  assert.notEqual(b.failure.retry, 'hold', 'not stopped for Brett on the first red CI');
  assert.equal(b.failure.retry, 'fix');
});
