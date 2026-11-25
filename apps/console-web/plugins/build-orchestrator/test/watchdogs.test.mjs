/**
 * The build watchdog (build-watchdogs@1): the host (watchdog.mjs: registry, one pass, the caught log, alerts, settings)
 * and the stale-status watch (stale-status@1: the decision table and one pass on fake sources). No network, no store:
 *   node apps/console-web/plugins/build-orchestrator/test/watchdogs.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-watchdogs-'));
process.env.AXF_WATCHDOGS_DIR = tmp;
process.env.AXF_WATCHDOG_NOTIFY_LOG = join(tmp, 'alerts.jsonl');
process.env.AXF_WATCHDOG_CRON = 'off';

const H = await import('../watchdog.mjs');
const C = await import('../watchdog/stale-core.mjs');
const S = await import('../watchdog/stale.mjs');
const CI = await import('../watchdog/stuck-ci-core.mjs');
const P2 = await import('../../../../../framework/core/pipeline-status.mjs');
const LC = await import('../../../../../deploy/lander/lander-core.mjs');
const LS = await import('../../../../../deploy/lander/store.mjs');

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n${e.stack}`); process.exitCode = 1; } };
const NOW = Date.parse('2026-11-21T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const done = [{ id: 's1', done: true, doneAt: ago(5000) }];
const build = (o) => ({ id: 'b1', title: 'Build one', status: 'landing', branch: 'claude/b1', pr: '#10', steps: done, attempts: [], notes: [], ...o });
const SET = C.normSettings({});
const alerts = () => (existsSync(process.env.AXF_WATCHDOG_NOTIFY_LOG) ? readFileSync(process.env.AXF_WATCHDOG_NOTIFY_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

console.log('stale-status@1: the decision table');
await t('inside its limit, another flow, deleted: not stale', () => {
  assert.equal(C.decide(build({ steps: [{ id: 's1', done: true, doneAt: ago(30) }] }), { pr: { state: 'open' } }, { now: NOW, settings: SET }).stale, false);
  assert.equal(C.decide(build({ flow: 'pipeline-2' }), { pr: { state: 'open' } }, { now: NOW, settings: SET }).action, 'none');
  assert.equal(C.decide(build({ deleted: true }), {}, { now: NOW, settings: SET }).action, 'none');
  assert.equal(C.decide(build({ status: 'running' }), {}, { now: NOW, settings: SET }).action, 'none');
});
await t('movement is real progress, not updatedAt', () => {
  const b = build({ updatedAt: ago(1) });
  assert.equal(C.decide(b, { pr: { state: 'open' } }, { now: NOW, settings: SET }).stale, true, 'a bulk store write does not reset the clock');
  assert.equal(C.movedAt(build({ steps: [], updatedAt: ago(7) })), NOW - 7 * 60000, 'no mark at all: updatedAt');
});
await t('a live session, an attempt in flight, the cooldown and an unreadable PR all wait', () => {
  const f = { pr: { state: 'open' } };
  assert.equal(C.decide(build({}), { ...f, live: true }, { now: NOW, settings: SET }).action, 'wait');
  assert.equal(C.decide(build({ status: 'fixing', failure: { kind: 'ci-red', at: ago(500) }, attempts: [{ n: 1, result: 'started', startedAt: ago(10) }] }), f, { now: NOW, settings: { ...SET, limits: { ...SET.limits, fixing: 5 } } }).action, 'wait');
  assert.equal(C.decide(build({}), f, { now: NOW, settings: SET, pushedAt: ago(200) }).action, 'fail', 'cooldown over');
  assert.equal(C.decide(build({ steps: done }), f, { now: NOW, settings: { ...SET, cooldownMin: 300 }, pushedAt: ago(200) }).action, 'wait');
  const blind = C.decide(build({}), { pr: null }, { now: NOW, settings: SET });
  assert.equal(blind.action, 'wait'); assert.match(blind.why, /could not be read/);
});
await t('merged and the build never heard: record the merge', () => {
  const d = C.decide(build({}), { pr: { state: 'merged', mergedAt: ago(300), mergeCommit: 'a'.repeat(40) } }, { now: NOW, settings: SET });
  assert.equal(d.action, 'record-merge'); assert.equal(d.pr, 10); assert.equal(d.sha, 'a'.repeat(40));
  assert.equal(C.decide(build({}), { pr: { state: 'merged', mergedAt: ago(300), mergeCommit: '' } }, { now: NOW, settings: SET }).action, 'wait', 'no merge commit: nothing to record yet');
});
await t('merged: CI green lands, red is a ci-red failure, pending waits then escalates', () => {
  const b = build({ mergedAt: ago(300), landed: { pr: 10, sha: 'a'.repeat(40), mergedAt: ago(300) } });
  const f = { pr: { state: 'merged' } };
  assert.equal(C.decide(b, { ...f, ci: 'success' }, { now: NOW, settings: SET }).action, 'land');
  const red = C.decide(b, { ...f, ci: 'failure' }, { now: NOW, settings: SET });
  assert.equal(red.action, 'fail'); assert.equal(red.kind, 'ci-red'); assert.equal(red.head, 'a'.repeat(40));
  assert.equal(C.decide(b, { ...f, ci: 'pending' }, { now: NOW, settings: { ...SET, ciWaitMin: 600 } }).action, 'wait');
  assert.equal(C.decide(b, { ...f, ci: 'none' }, { now: NOW, settings: SET }).action, 'escalate');
  assert.equal(C.decide(b, { ...f, ci: null }, { now: NOW, settings: SET }).action, 'wait', 'CI unreadable: wait');
});
await t('merged, CI on the merge commit red or missing, main green now: landed with the proof named', () => {
  const b = build({ mergedAt: ago(300), landed: { pr: 10, sha: 'a'.repeat(40), mergedAt: ago(300) } });
  for (const ci of ['failure', 'none']) {
    const d = C.decide(b, { pr: { state: 'merged' }, ci, mainCi: 'success', mainHead: 'b'.repeat(40) }, { now: NOW, settings: SET });
    assert.equal(d.action, 'land'); assert.equal(d.via, 'main'); assert.equal(d.mainHead, 'b'.repeat(40));
  }
  assert.equal(C.decide(b, { pr: { state: 'merged' }, ci: 'failure', mainCi: 'failure', mainHead: 'b'.repeat(40) }, { now: NOW, settings: SET }).action, 'fail');
});
await t('merged, CI on the merge commit red or missing, CI on main still running or unreadable: wait for main`s result', () => {
  const b = build({ mergedAt: ago(300), landed: { pr: 10, sha: 'a'.repeat(40), mergedAt: ago(300) } });
  for (const ci of ['failure', 'none', 'pending']) for (const mainCi of ['pending', 'none', null, undefined]) {
    const d = C.decide(b, { pr: { state: 'merged' }, ci, mainCi, mainHead: 'b'.repeat(40) }, { now: NOW, settings: SET });
    assert.equal(d.action, 'wait', `${ci} / ${mainCi}`); assert.match(d.why, /that result decides/);
  }
  assert.equal(C.decide(b, { pr: { state: 'merged' }, ci: 'failure', mainCi: 'pending', mainHead: 'a'.repeat(40) }, { now: NOW, settings: SET }).action, 'fail', 'the merge commit IS main`s newest: its own red CI decides');
  assert.equal(C.decide(b, { pr: { state: 'merged' }, ci: 'none' }, { now: NOW, settings: SET }).action, 'escalate', 'main unknown altogether: no rung left');
});
await t('fixing: the ladder`s next rung, its escalation, and no failure at all', () => {
  const b = build({ status: 'fixing', failure: { kind: 'ci-red', at: ago(500), why: 'CI is red' } });
  const f = { pr: { state: 'open' } };
  const d = C.decide(b, f, { now: NOW, settings: SET, next: { strategy: 'fix', fixStrategy: 'targeted' } });
  assert.equal(d.action, 'ladder'); assert.equal(d.rung, 'fix:targeted');
  assert.equal(C.decide(b, f, { now: NOW, settings: SET, next: { strategy: 'fresh-session' } }).rung, 'fresh-session');
  // the rung as a step: what failed, what to do differently, what done means; the model never invented
  const st = C.rungStep({ ...b, pipeline: { model: 'Fable' } }, { rung: 'fresh-session', model: '' }, { n: 3 });
  assert.match(st.text, /^Land this build \(watchdog, attempt 3: fresh-session\)\. CI is red \(CI is red\)\. Start from `git status`/); assert.match(st.text, /Merge origin\/main into claude\/b1, get every check green and push; the PR is #10\.$/);
  assert.equal(st.model, 'Fable'); assert.equal(C.rungStep(b, { rung: 'switch-model', model: 'Opus' }).model, 'Opus'); assert.equal(C.rungStep(b, { rung: 'retry', model: 'nonsense' }).model, 'Opus');
  assert.match(C.rungStep({ ...b, pr: '' }, { rung: 'retry' }).text, /push, then open the PR\.$/);
  assert.equal(C.decide(b, f, { now: NOW, settings: SET, next: { escalate: true, reason: 'every rung used' } }).action, 'escalate');
  assert.equal(C.decide(b, f, { now: NOW, settings: SET, next: { inFlight: true } }).action, 'wait');
  assert.equal(C.decide(build({ status: 'fixing' }), f, { now: NOW, settings: SET }).action, 'to-landing');
  assert.equal(C.decide(build({ status: 'fixing', steps: [{ id: 's1' }], updatedAt: ago(500) }), f, { now: NOW, settings: SET }).action, 'requeue');
});
await t('landing with the PR open, closed or missing: a failure the ladder answers', () => {
  assert.equal(C.decide(build({}), { pr: { state: 'open' } }, { now: NOW, settings: SET }).kind, 'stalled');
  assert.equal(C.decide(build({}), { pr: { state: 'closed' } }, { now: NOW, settings: SET }).kind, 'push-fail');
  assert.equal(C.decide(build({ pr: '' }), {}, { now: NOW, settings: SET }).kind, 'push-fail');
  assert.equal(C.decide(build({ status: 'merging' }), { pr: { state: 'open' } }, { now: NOW, settings: SET }).action, 'fail', 'merging is watched the same way');
});
await t('pick: the longest-standing first, maxPerPass, one launch at a time', () => {
  const ds = [{ id: 'a', stale: true, action: 'ladder', minutes: 50 }, { id: 'b', stale: true, action: 'fail', minutes: 90 }, { id: 'c', stale: true, action: 'land', minutes: 10 }, { id: 'd', stale: true, action: 'wait', minutes: 999 }, { id: 'e', stale: true, action: 'record-merge', minutes: 5 }];
  const p = C.pick(ds, { ...SET, maxPerPass: 2, maxLaunchPerPass: 1 });
  assert.deepEqual(p.act.map((d) => d.id), ['b', 'c']); assert.deepEqual(p.held.map((h) => h.id), ['a', 'e']);
  assert.equal(C.pick(ds, { ...SET, maxLaunchPerPass: 0 }).act.some((d) => C.LAUNCHES.includes(d.action)), false, '0 launches: bookkeeping only');
});
await t('settings: limits per status, clamped, an added status is watched', () => {
  const s = C.normSettings({ limits: { fixing: 5, waiting: 15 }, maxPerPass: 9999, cooldownMin: -3 });
  assert.equal(s.limits.fixing, 5); assert.equal(s.limits.waiting, 15); assert.equal(s.limits.landing, 90); assert.equal(s.maxPerPass, 100); assert.equal(s.cooldownMin, 0);
  assert.equal(C.watched({ id: 'x', status: 'waiting' }, s), true);
});

console.log('the stale watch: one pass on fake sources');
const fakeStore = { builds: [
  build({ id: 'merged', pr: '#11' }),
  build({ id: 'green', pr: '#12', mergedAt: ago(300), landed: { pr: 12, sha: 'c'.repeat(40), mergedAt: ago(300) } }),
  build({ id: 'fix-a', pr: '#13', status: 'fixing', failure: { kind: 'ci-red', at: ago(900), why: 'CI is red' } }),
  build({ id: 'fix-b', pr: '#14', status: 'fixing', failure: { kind: 'ci-red', at: ago(800), why: 'CI is red' } }),
  build({ id: 'fresh', pr: '#15', steps: [{ id: 's1', done: true, doneAt: ago(10) }] }),
  build({ id: 'p2', pr: '#16', flow: 'pipeline-2' }),
] };
const sources = {
  loadStore: () => fakeStore,
  prFacts: (bs) => ({ mainHead: 'd'.repeat(40), errors: [], ...Object.fromEntries(bs.map((b) => [b.id, { pr: b.id === 'merged' ? { state: 'merged', mergedAt: ago(200), mergeCommit: 'e'.repeat(40) } : { state: b.mergedAt ? 'merged' : 'open' }, live: false }])) }),
  ciOn: (sha) => (sha === 'c'.repeat(40) ? 'success' : 'none'),
  landerLive: () => false,
  nextRung: () => ({ strategy: 'fix', fixStrategy: 'targeted' }),
};
await t('scan decides for the late builds only and changes nothing', async () => {
  const sc = await S.scan({ now: NOW, sources });
  assert.equal(sc.watching, 5, 'the Pipeline 2.0 build is not watched');
  assert.deepEqual(Object.fromEntries(sc.decisions.map((d) => [d.id, d.action])), { merged: 'record-merge', green: 'land', 'fix-a': 'ladder', 'fix-b': 'ladder' });
  assert.equal(existsSync(join(tmp, 'watchdogs-stale.json')), false);
});
const applied = [];
const apply = Object.fromEntries(C.ACTIONS.map((a) => [a, (d) => { applied.push(`${d.id}:${a}`); return d.id === 'green' ? { ok: false, note: 'refused by the guard' } : { ok: true, note: 'ok' }; }]));
await t('run applies, caps launches at one per pass and remembers every push', async () => {
  const r = await S.run({ now: NOW, sources, apply });
  assert.deepEqual(applied.sort(), ['fix-a:ladder', 'green:land', 'merged:record-merge']);
  assert.equal(r.catches.length, 3); assert.equal(r.catches.find((c) => c.build === 'green').ok, false);
  assert.ok(r.skipped.some((s) => s.id === 'fix-b' && /one launch at a time/.test(s.why)));
  assert.ok(r.catches.every((c) => c.watch === 'stale' && c.cause && c.note));
  const mem = JSON.parse(readFileSync(join(tmp, 'watchdogs-stale.json'), 'utf8'));
  assert.deepEqual(Object.keys(mem.pushes).sort(), ['fix-a', 'green', 'merged']); assert.equal(mem.lastScan.stale.length, 4);
});
await t('a second pass leaves what it just pushed alone (cooldown) and takes the next in line', async () => {
  applied.length = 0;
  const r = await S.run({ now: Date.now(), sources, apply });
  assert.deepEqual(applied, ['fix-b:ladder']);
  assert.ok(r.skipped.some((s) => s.id === 'fix-a' && /pushed less than/.test(s.why)));
});
console.log('stuck-ci@1: lander PRs standing in CI');
const HEAD = 'a'.repeat(40);
const p2 = (o = {}) => ({ id: 'refresh', title: 'Refresh fix', flow: 'pipeline-2', status: 'running-ci', statusAt: ago(20), steps: [{ id: 's7', status: 'in-pr', prNumber: 915 }], landing: { split: true }, notes: [], ...o });
const stopped = (o = {}) => p2({ status: 'failed', failedFrom: 'running-ci', attempt: 5, statusAt: ago(40), landing: { split: true, attempt: 5 }, failure: { kind: 'ci-red', status: 'running-ci', why: 'CI is red on aaaaaaaaa (Build engine sweep (Node))', head: HEAD, pr: 915, at: ago(40), attempt: 5, retry: 'hold', notBefore: '', needsBrett: true, stopped: 'attempt 5 of 5', resume: 'rerun', failing: ['Build engine sweep (Node)'] }, ...o });
const open = (o = {}) => ({ state: 'open', head: HEAD, branch: 'lander/refresh-7', mergeable: true, ...o });
const ci = (v, o = {}) => ({ ci: v, failing: v === 'failure' ? ['Build engine sweep (Node)'] : [], missing: [], runIds: v === 'failure' ? [42] : [], jobIds: v === 'failure' ? [7] : [], runningMin: null, ...o });
const facts = (o = {}) => ({ inFlight: { pr: 915, steps: ['s7'] }, pr: open(), ci: ci('success'), fixTimeoutMin: 60, ...o });
const act = (b, f, ctx = {}) => CI.decide(b, f, { now: NOW, settings: SET, ...ctx });
await t('watched: Pipeline 2.0 in running-ci, failed there, or stopped by the lander; inside the limit is not stale', () => {
  assert.equal(SET.limits['running-ci'], 15); assert.ok(S.SETTINGS_SCHEMA['limit.running-ci'].min <= 10 && S.SETTINGS_SCHEMA['limit.running-ci'].default === 15);
  assert.ok(CI.watched(p2(), SET)); assert.ok(CI.watched(stopped(), SET));
  assert.ok(CI.watched(stopped({ failure: { ...stopped().failure, status: 'pr-pulling-main', kind: 'clash-main' } }), SET), 'stopped in another landing phase');
  assert.equal(CI.watched(p2({ status: 'building' }), SET), false); assert.equal(CI.watched(p2({ flow: '' }), SET), false);
  assert.equal(CI.watched(p2({ status: 'failed', failedFrom: 'pr-pulling-main', failure: { kind: 'infra', status: 'pr-pulling-main', retry: 'same' } }), SET), false, 'the lander retries that one itself');
  assert.equal(CI.watched(p2(), { ...SET, limits: { ...SET.limits, 'running-ci': 0 } }), false, 'limit 0: the lane is off');
  assert.equal(act(p2({ statusAt: ago(10) }), facts()).stale, false);
  assert.equal(C.watched(p2(), SET), false, 'the builds@1 table still leaves Pipeline 2.0 alone');
});
await t('green: merged when the rules passed or the lander stopped; the lander gets its tick for the rules', () => {
  assert.equal(act(p2(), facts()).action, 'wait', 'rules not run yet');
  const m = act(p2({ landing: { split: true, rules: { head: HEAD, ok: true } } }), facts());
  assert.equal(m.action, 'merge-pr'); assert.equal(m.head, HEAD); assert.equal(m.pr, 915); assert.equal(m.branch, 'lander/refresh-7');
  assert.equal(act(p2({ landing: { green: { head: HEAD, at: ago(18) } } }), facts()).action, 'merge-pr');
  assert.equal(act(p2({ landing: { green: { head: 'b'.repeat(40) } } }), facts()).action, 'wait', 'green on another head proves nothing');
  const held = act(stopped(), facts()); assert.equal(held.action, 'merge-pr'); assert.match(held.why, /attempt 5 of 5/);
  assert.equal(act(stopped({ failure: { ...stopped().failure, retry: 'rerun', notBefore: ago(-5) } }), facts()).action, 'wait', 'failed with its own retry: the lander picks it up');
});
await t('pending: a running check waits, a stuck one and a CI that never started get a fresh run, twice per head at most', () => {
  assert.equal(act(p2(), facts({ ci: ci('running', { runningMin: 20 }) })).action, 'wait');
  const r = act(p2({ statusAt: ago(70) }), facts({ ci: ci('running', { runningMin: 61 }) }));
  assert.equal(r.action, 'rerun-ci'); assert.equal(r.n, 1); assert.equal(r.branch, 'lander/refresh-7');
  assert.equal(act(p2(), facts({ ci: ci('none') })).action, 'rerun-ci');
  assert.equal(act(p2(), facts({ ci: ci('missing', { missing: ['Build engine sweep (Node)'] }) })).action, 'rerun-ci');
  assert.equal(act(p2(), facts({ ci: ci('light') })).action, 'rerun-ci');
  assert.equal(act(p2({ landing: { ciKick: { head: HEAD, at: ago(5) } } }), facts({ ci: ci('none') })).action, 'wait', 'the lander just started it');
  assert.equal(act(p2(), facts({ ci: ci('none') }), { memory: { pr: 915, fixes: 0, reruns: { head: HEAD, n: 1, at: ago(20) } } }).action, 'wait', 'a fresh run gets its time');
  assert.equal(act(p2({ statusAt: ago(200) }), facts({ ci: ci('none') }), { memory: { pr: 915, fixes: 0, reruns: { head: HEAD, n: 1, at: ago(90) } } }).n, 2);
  assert.equal(act(p2({ statusAt: ago(300) }), facts({ ci: ci('none') }), { memory: { pr: 915, fixes: 0, reruns: { head: HEAD, n: 2, at: ago(90) } } }).action, 'wait', 'two fresh runs per head');
  assert.equal(act(stopped(), facts({ ci: ci('running', { runningMin: 10 }) })).action, 'wait', 'a stopped build whose CI runs again waits for it');
});
await t('red: the lander keeps its own retries; stopped = one Fable fix session, then a one-part PR is marked for removal', () => {
  const red = facts({ ci: ci('failure') });
  assert.equal(act(p2(), red).action, 'wait', "the lander's tick records it");
  assert.match(act(stopped({ failure: { ...stopped().failure, retry: 'fix', notBefore: ago(-8) } }), red).why, /retries by itself \(fix/);
  const f = act(stopped(), red);
  assert.equal(f.action, 'fix'); assert.equal(f.kind, 'ci-red'); assert.equal(f.rung, 'fix:Fable'); assert.equal(f.n, 1); assert.deepEqual(f.jobIds, [7]); assert.match(f.why, /Fable fix session/);
  assert.ok(C.LAUNCHES.includes('fix'), 'a fix is a launch: capped per pass');
  const again = act(stopped(), red, { memory: { pr: 915, fixes: 1 } });
  assert.equal(again.action, 'mark-removal'); assert.deepEqual(again.steps, ['s7']); assert.match(again.why, /part s7\) failed again after its fix session/);
  assert.equal(act(stopped(), red, { memory: { pr: 914, fixes: 1 } }).action, 'fix', 'the count is per PR: a new PR in flight starts clean');
  assert.equal(act(stopped({ landing: { attempt: 5 } }), facts({ inFlight: { pr: 915, steps: ['s1', 's2'] }, ci: ci('failure') }), { memory: { pr: 915, fixes: 1 } }).action, 'wait', 'a PR of several steps is not removed: the lander splits those');
  assert.equal(act(stopped(), red, { settings: { ...SET, ciFixes: 0 } }).action, 'mark-removal', 'ciFixes 0: no fix session of the watch');
  // a conflict with main and failing gate rules are red too
  const clash = act(stopped({ failure: { ...stopped().failure, kind: 'clash-main', status: 'pr-pulling-main' } }), facts({ pr: open({ mergeable: false }) }));
  assert.equal(clash.action, 'fix'); assert.equal(clash.kind, 'clash-main');
  assert.equal(act(stopped({ landing: { rules: { head: HEAD, ok: false, failing: ['one-builds-store'] } } }), facts()).kind, 'rules');
});
await t('never blind, never twice: unread PR or CI, a fix in flight, a cooldown, a mark already set, a stop that is Brett`s', () => {
  const red = facts({ ci: ci('failure') });
  assert.match(act(p2(), facts({ pr: null })).why, /could not be read/); assert.match(act(p2(), facts({ ci: null })).why, /could not be read/);
  assert.match(act(p2(), facts({ pr: open({ state: 'merged' }) })).why, /lander records it/);
  assert.match(act(p2(), facts({ inFlight: null })).why, /no PR in flight/);
  assert.equal(act(stopped(), red, { pushedAt: ago(5) }).action, 'wait');
  assert.match(act(p2({ status: 'failed', failedFrom: 'running-ci', failure: { kind: 'ci-red', status: 'running-ci', retry: 'fix', fix: { at: ago(30), session: 'axf-lander-fix-pr915-1', n: 1 } } }), red).why, /fix session axf-lander-fix-pr915-1 is working/);
  assert.match(act(stopped({ landing: { removal: { pr: 915, steps: ['s7'], at: ago(10) } } }), red, { memory: { pr: 915, fixes: 1 } }).why, /marked for removal/);
  assert.equal(act(stopped({ statusAt: ago(40), landing: { removal: { pr: 915, steps: ['s7'], at: ago(90) } } }), red, { memory: { pr: 915, fixes: 1 } }).action, 'mark-removal', 're-sent since the mark: looked at again');
  for (const kind of ['pr-closed', 'hand-merge']) assert.match(act(stopped({ failure: { ...stopped().failure, kind } }), red).why, /Brett's to answer/);
});
await t('a fix is the lander`s own retry, due now, on a fresh attempt count; the removal mark survives the store', () => {
  const b = stopped(); const d = act(b, facts({ ci: ci('failure') }));
  const store = LS.memoryStore([b], { by: 'watchdog' });
  const w = store.write(b.id, { attempt: 1, failure: CI.fixFailure(b, d, ago(0)), landing: { attempt: 0 }, note: 'Watchdog: fix' });
  assert.ok(w.ok, w.why);
  const after = { ...w.build, failure: P2.normLandFailure(w.build.failure), landing: P2.normLanding(w.build.landing) };
  assert.equal(after.status, 'failed'); assert.equal(after.attempt, 1); assert.equal(after.failure.retry, 'fix'); assert.equal(after.failure.kind, 'ci-red'); assert.deepEqual(after.failure.jobIds, [7]);
  assert.equal(LC.isHeld(after), false, 'the hold is released'); assert.ok(LC.retryDue(after, ago(0)), 'due on the next lander tick'); assert.equal(LC.landingAttempt(after), 0);
  assert.equal(P2.gaveUp(after), false, 'the status contract lets it out of failed again');
  assert.equal(LC.retryStatus(after.failure), 'running-ci');
  const clash = stopped({ failure: { ...stopped().failure, kind: 'clash-main', status: 'pr-pulling-main', why: 'merging main conflicts in code (a.ts)' } });
  const cf = CI.fixFailure(clash, act(clash, facts({ pr: open({ mergeable: false }) })), ago(0));
  assert.equal(cf.kind, 'clash-main'); assert.equal(cf.status, 'pr-pulling-main'); assert.match(cf.why, /conflicts in code/);
  const m = store.write(b.id, { landing: { removal: { pr: 915, steps: ['s7'], at: ago(0), by: 'watchdog', why: 'CI is red' } } });
  assert.deepEqual(P2.normLanding(m.build.landing).removal, { pr: 915, steps: ['s7'], at: ago(0), by: 'watchdog', why: 'CI is red' });
  assert.ok(LC.groupState(m.build).inFlight, 'the mark removes nothing by itself');
});
await t('the checks of a head, read by the lander`s rules: the newest run per name decides how long CI has been running', () => {
  const run = (name, o = {}) => ({ name, status: 'completed', conclusion: 'success', started_at: ago(50), app: { slug: 'github-actions' }, ...o });
  const cfg = { requiredChecks: ['tests'] };
  assert.equal(S.ciFactsOf(LC, [run('tests')], cfg, NOW).ci, 'success');
  assert.deepEqual(S.ciFactsOf(LC, [run('lint')], cfg, NOW).missing, ['tests']);
  const stuck = S.ciFactsOf(LC, [run('tests', { status: 'in_progress', conclusion: null, started_at: ago(70) }), run('lint')], cfg, NOW);
  assert.equal(stuck.ci, 'running'); assert.equal(stuck.runningMin, 70);
  const rerun = S.ciFactsOf(LC, [run('tests', { status: 'in_progress', conclusion: null, started_at: ago(70) }), run('tests', { status: 'in_progress', conclusion: null, started_at: ago(4), id: 2 })], cfg, NOW);
  assert.equal(rerun.runningMin, 4, 'a fresh run replaces the stuck one');
  assert.equal(S.ciFactsOf(LC, [run('Light PR checks (full run happens once, in the merge queue)'), run('scope')], cfg, NOW).ci, 'light');
  const red = S.ciFactsOf(LC, [run('tests', { id: 7, conclusion: 'failure', details_url: 'https://github.com/o/r/actions/runs/42/job/7' })], cfg, NOW);
  assert.deepEqual([red.ci, red.runIds, red.jobIds], ['failure', [42], [7]]);
});
const ciStore = { builds: [
  p2({ id: 'ci-green', landing: { split: true, rules: { head: HEAD, ok: true } } }),
  stopped({ id: 'ci-red' }),
  stopped({ id: 'ci-red-2', steps: [{ id: 's8', status: 'in-pr', prNumber: 916 }], statusAt: ago(30) }),
  p2({ id: 'ci-none', steps: [{ id: 's9', status: 'in-pr', prNumber: 917 }] }),
  p2({ id: 'ci-running', steps: [{ id: 's10', status: 'in-pr', prNumber: 918 }] }),
  p2({ id: 'ci-young', statusAt: ago(3) }),
] };
const ciSources = {
  loadStore: () => ciStore, prFacts: () => ({ errors: [] }), ciOn: () => null, landerLive: () => false, nextRung: () => null,
  ciFacts: (bs) => ({ errors: [], ...Object.fromEntries(bs.map((b) => [b.id, facts({ inFlight: { pr: b.steps[0].prNumber, steps: [b.steps[0].id] }, ci: b.id === 'ci-green' ? ci('success') : b.id === 'ci-none' ? ci('none') : b.id === 'ci-running' ? ci('running', { runningMin: 12 }) : ci('failure') })])) }),
};
await t('one pass: merged, CI restarted, one fix handed over (one launch a pass), every catch its own alert', async () => {
  const sc = await S.scan({ now: NOW, sources: ciSources, settings: SET });
  assert.equal(sc.watching, 6, 'running-ci is watched now'); assert.equal(sc.decisions.length, 5, 'only the late ones have their checks read');
  const did = []; const told = [];
  const ap = Object.fromEntries(C.ACTIONS.map((a) => [a, (d) => { did.push(`${d.id}:${a}`); return d.id === 'ci-none' ? { ok: false, note: 'GitHub 422' } : { ok: true, note: 'ok', ...(a === 'mark-removal' ? { gaveUp: true } : {}) }; }]));
  const before = alerts().length;
  const r = await S.run({ now: NOW, sources: ciSources, apply: ap, settings: SET, notify: async (a) => { told.push(a); return true; } });
  assert.deepEqual(did.sort(), ['ci-green:merge-pr', 'ci-none:rerun-ci', 'ci-red:fix']);
  assert.ok(r.skipped.some((x) => x.id === 'ci-red-2' && /one launch at a time/.test(x.why))); assert.ok(r.skipped.some((x) => x.id === 'ci-running' && /CI is running/.test(x.why)));
  assert.equal(told.length, 3, 'one alert per catch, the one that could not be done too');
  assert.ok(r.catches.every((c) => c.notified && c.pr), 'told already: the watchdog`s batch does not tell it again');
  const g = told.find((a) => a.meta.build === 'ci-green'); assert.equal(g.title, 'PR #915 stuck in CI: merged it'); assert.equal(g.severity, 'info'); assert.match(g.key, /^watchdog:stuck-ci:ci-green:915:merge-pr:/);
  const bad = told.find((a) => a.meta.build === 'ci-none'); assert.equal(bad.severity, 'error'); assert.match(bad.title, /could not restart CI/); assert.match(bad.body, /Not done: GitHub 422/);
  assert.equal(alerts().length, before, 'the injected notify took them');
  const mem = JSON.parse(readFileSync(join(tmp, 'watchdogs-stale.json'), 'utf8'));
  assert.deepEqual(mem.ci['ci-red'], { pr: 915, fixes: 1 }); assert.equal(mem.ci['ci-none'].reruns.n, 1); assert.deepEqual(mem.ci['ci-green'], { pr: 915, fixes: 0 });
  assert.ok(mem.lastScan.stale.some((x) => x.id === 'ci-running' && x.action === 'wait'));
});
await t('the next passes: the cooldown holds, then the second stopped PR gets its fix and a part that fails again is marked', async () => {
  const did = []; const told = [];
  const ap = Object.fromEntries(C.ACTIONS.map((a) => [a, (d) => { did.push(`${d.id}:${a}`); return { ok: true, note: 'ok', ...(a === 'mark-removal' ? { gaveUp: true } : {}) }; }]));
  const soon = await S.run({ now: Date.now() + 60000, sources: ciSources, apply: ap, settings: SET, notify: async () => true });
  assert.deepEqual(did, ['ci-red-2:fix']); assert.ok(soon.skipped.some((x) => x.id === 'ci-red' && /pushed less than 15 min ago/.test(x.why)));
  did.length = 0;
  // 20 minutes on, the fix session of ci-red has pushed and the lander stopped on it again (still red): the second failure
  const later = Date.now() + 20 * 60000;
  ciStore.builds = ciStore.builds.filter((b) => b.id === 'ci-red').map((b) => ({ ...b, statusAt: new Date(later - 16 * 60000).toISOString() }));
  const r = await S.run({ now: later, sources: ciSources, apply: ap, settings: SET, notify: async (a) => { told.push(a); return true; } });
  assert.deepEqual(did, ['ci-red:mark-removal']);
  assert.equal(r.catches[0].gaveUp, true); assert.equal(told[0].severity, 'error'); assert.equal(told[0].title, 'PR #915 stuck in CI: marked the part for removal');
  assert.match(told[0].body, /Nothing was removed\. Remove the part, or re-send the build: node deploy\/lander\/run\.mjs retry ci-red/);
  assert.equal(told[0].meta.kind, 'marked-removal');
});
await t('with no notify handed in, the alert goes the watchdog`s own way', async () => {
  const before = alerts().length;
  ciStore.builds = [p2({ id: 'ci-own', landing: { green: { head: HEAD, at: ago(18) } } })];
  const own = { ...ciSources, ciFacts: (bs) => ({ errors: [], ...Object.fromEntries(bs.map((b) => [b.id, facts()])) }) };
  const r = await S.run({ now: NOW, sources: own, apply: { 'merge-pr': () => ({ ok: true, note: 'PR #915 merged' }) }, settings: SET });
  assert.equal(r.catches.length, 1); assert.ok(r.catches[0].notified);
  const a = alerts().slice(before); assert.equal(a.length, 1); assert.equal(a[0].source, 'watchdog'); assert.equal(a[0].title, 'PR #915 stuck in CI: merged it'); assert.equal('catches' in a[0], false);
});

await t('settings: flat keys, unknown refused, saved and read back', async () => {
  await assert.rejects(() => S.saveSettings({ nope: 1 }), /unknown setting/);
  const s = await S.saveSettings({ 'limit.fixing': 15, maxLaunchPerPass: 0 }, { by: 'test' });
  assert.equal(s['limit.fixing'], 15); assert.equal((await S.loadSettings()).limits.fixing, 15); assert.equal((await S.loadSettings()).maxLaunchPerPass, 0);
  // the stuck-CI lane's settings ride the same flat map
  assert.deepEqual([s['limit.running-ci'], s.ciStuckMin, s.ciFixes], [15, 45, 1]);
  const c = await S.saveSettings({ 'limit.running-ci': 10, ciStuckMin: 60, ciFixes: 2 }, { by: 'test' });
  assert.deepEqual([c['limit.running-ci'], c.ciStuckMin, c.ciFixes], [10, 60, 2]); assert.equal((await S.loadSettings()).limits['running-ci'], 10);
  assert.equal(c['limit.fixing'], 15, 'the other settings stay');
});

console.log('watchdog.mjs: the host');
const runs = { a: 0, b: 0 };
const mk = (id, extra = {}) => ({ id, label: `Watch ${id}`, what: 'a test watch', schema: { enabled: { type: 'boolean', default: true, title: 'On' }, intervalMin: { type: 'integer', min: 1, max: 60, default: 1, title: 'Every' } },
  cfg: { enabled: true, intervalMin: 1 }, settings() { return this.cfg; }, set(p) { Object.assign(this.cfg, p); return this.cfg; },
  run: ({ only }) => { runs[id] += 1; return { watching: 3, catches: [{ build: only || `${id}-build`, title: `Title ${id}`, status: 'fixing', cause: 'stuck', action: 'retry', note: 'did it' }], skipped: [], errors: [] }; }, ...extra });
const wa = mk('wa'); const wb = mk('wb', { run: () => { throw new Error('boom'); } });
runs.wa = 0; runs.wb = 0;
H.register(wa); H.register(wb);
const mine = (r) => r.ran.filter((x) => ['wa', 'wb'].includes(x.id));
await t('the registry: built-in watches plus registered ones; a bad watch is refused', () => {
  assert.deepEqual(H.watchIds(), ['sessions', 'stale', 'rows', 'wa', 'wb']);
  assert.throws(() => H.register({ id: 'Bad Id', run() {} }), /needs an id/); assert.throws(() => H.register({ id: 'norun' }), /run\(\)/);
});
await t('one pass: each watch runs, a throwing watch never stops the next, catches reach the one log', async () => {
  const r = await H.pass({ only: 'wb', force: true });
  assert.equal(mine(r)[0].errors[0], 'boom');
  const r2 = await H.pass({ only: 'wa', force: true, by: 'test' });
  assert.equal(r2.catches.length, 1); assert.equal(r2.catches[0].$axf, 'watchdog-catch@1'); assert.equal(r2.catches[0].watch, 'wa');
  const log = await H.caught({ watch: 'wa' });
  assert.equal(log.length, 1); assert.equal(log[0].build, 'wa-build'); assert.ok(log[0].notified, 'the alert went out and the record says so');
  assert.equal((await H.caught({ build: 'nope' })).length, 0);
});
await t('due: a watch that just ran is not run again inside its interval; off is off; force runs anyway', async () => {
  const before = runs.wa;
  const r = await H.pass({ only: 'wa' });
  assert.equal(runs.wa, before); assert.match(r.notRun[0].why, /next run due/);
  wa.cfg.enabled = false;
  assert.match((await H.pass({ only: 'wa', now: Date.now() + 5 * 60000 })).notRun[0].why, /this watch is off/);
  await H.pass({ only: 'wa', force: true }); assert.equal(runs.wa, before + 1);
  wa.cfg.enabled = true;
});
await t('alerts: one FYI per pass, one each, none; a give-up always alerts', () => {
  const cs = [{ watch: 'wa', build: 'x', title: 'X', cause: 'c', action: 'retry', ok: true }, { watch: 'wb', build: 'y', title: 'Y', cause: 'c', action: 'requeue', ok: true }, { watch: 'wb', build: 'z', title: 'Z', cause: 'c', action: 'escalate', ok: true, gaveUp: true }];
  const batch = H.alertsFor(cs, { alerts: 'batch', at: 't' });
  assert.equal(batch.length, 2); assert.match(batch[0].title, /caught 2/); assert.equal(batch[1].severity, 'error'); assert.match(batch[1].link, /focus:watchdog\?build=z/);
  assert.equal(H.alertsFor(cs, { alerts: 'each' }).length, 3);
  assert.equal(H.alertsFor(cs, { alerts: 'off' }).length, 1, 'off still tells about a give-up');
  assert.equal(H.alertsFor(cs.map((c) => ({ ...c, notified: 't' })), { alerts: 'each' }).length, 0, 'what a watch already sent is not sent again');
  assert.equal(H.alertsFor([{ ...cs[0], ok: false }], { alerts: 'each' }).length, 0, 'a push that did not work is not announced as a fix');
});
await t('settings: one flat map over every watch; each key checked; the master switch stops every watch', async () => {
  const all = await H.allSettings();
  assert.equal(all.values.enabled, true); assert.equal(all.values['wa.intervalMin'], 1); assert.equal(all.schema['stale.limit.fixing'].watch, 'stale'); assert.ok('sessions.maxRetries' in all.values); assert.ok('rows.intervalMin' in all.values);
  await assert.rejects(() => H.setSettings({ 'wa.nope': 1 }), /no watchdog setting/);
  await assert.rejects(() => H.setSettings({ 'wa.intervalMin': 999 }), /whole number from 1 to 60/);
  await assert.rejects(() => H.setSettings({ alerts: 'loud' }), /one of batch, each, off/);
  const s = await H.setSettings({ 'wa.intervalMin': '7', alerts: 'each', enabled: 'off' }, { by: 'test' });
  assert.equal(s.values['wa.intervalMin'], 7); assert.equal(wa.cfg.intervalMin, 7); assert.equal(s.values.alerts, 'each'); assert.equal(s.values.enabled, false);
  assert.match((await H.pass({ only: 'wa', now: Date.now() + 60 * 60000 })).notRun[0].why, /the watchdog is off/);
  await H.setSettings({ enabled: true, 'wa.intervalMin': 1 });
});
await t('a requested pass runs on the next cron minute, for that watch and build, even when not due', async () => {
  const before = runs.wa;
  await H.requestPass({ by: 'console', watch: 'wa', build: 'asked-build' });
  assert.equal((await H.status()).request.build, 'asked-build');
  const r = await H.cronPass();
  assert.equal(runs.wa, before + 1); assert.equal(r.asked.by, 'console'); assert.equal(r.catches[0].build, 'asked-build');
  assert.equal((await H.status()).request, null);
});
await t('the cron file written by the deploy script (the line alone) counts as current', async () => {
  const cron = await import('../watchdog/cron.mjs');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = join(tmp, 'cron.d'); mkdirSync(dir, { recursive: true });
  const keep = { d: process.env.AXF_CRON_DIR, w: process.env.AXF_WATCHDOG_CRON };
  process.env.AXF_CRON_DIR = dir; delete process.env.AXF_WATCHDOG_CRON;
  try {
    assert.equal(cron.status().installed, false);
    writeFileSync(join(dir, cron.NAME), `${cron.render().split('\n').filter((l) => l && !l.startsWith('#')).join('\n')}\n`);
    assert.equal(cron.status().current, true, 'the schedule line alone');
    writeFileSync(join(dir, cron.NAME), '*/5 * * * * root echo old\n'); assert.equal(cron.status().current, false, 'another schedule is out of date');
    writeFileSync(join(dir, 'axf-stale-watchdog'), 'old\n');
    const r = cron.install(); assert.ok(r.installed); assert.deepEqual(r.retired, ['axf-stale-watchdog']); assert.equal(cron.status().current, true);
  } finally { if (keep.d === undefined) delete process.env.AXF_CRON_DIR; else process.env.AXF_CRON_DIR = keep.d; if (keep.w !== undefined) process.env.AXF_WATCHDOG_CRON = keep.w; }
});
await t('status: per watch on/off, last run, caught, last error; stale without a pass', async () => {
  const s = await H.status();
  const a = s.watches.find((w) => w.id === 'wa'); const b = s.watches.find((w) => w.id === 'wb');
  assert.equal(s.stale, false); assert.ok(a.lastRun && a.caught >= 2 && a.enabled); assert.equal(b.lastError, 'boom');
  assert.ok(s.caught.length >= 2); assert.equal(s.caught[0].watch, 'wa');
  assert.equal((await H.status({ now: Date.now() + 30 * 60000 })).stale, true, 'no heartbeat for half an hour while on');
  // a cron minute with nothing due still beats: alive is judged on the heartbeat, not on a watch happening to be due
  const before = (await H.status()).lastPass;
  const idle = await H.pass({ only: 'wa' });
  assert.equal(idle.ran.length, 0); const after = await H.status();
  assert.equal(after.lastPass, before, 'lastPass is the last time a watch ran'); assert.ok(after.lastTick >= before && after.stale === false);
  assert.ok(alerts().length >= 2, 'alerts were written');
});
await t('cron: the console container cannot see /etc/cron.d, so status takes the host`s own record of the schedule file', async () => {
  const { mkdtempSync: mk } = await import('node:fs');
  const dir = mk(join(tmpdir(), 'axf-wd-cron2-'));
  const keep = { d: process.env.AXF_CRON_DIR, w: process.env.AXF_WATCHDOG_CRON, c: process.env.AXF_WATCHDOG_IN_CONSOLE };
  const cron = await import('../watchdog/cron.mjs');
  try {
    // the host: the schedule file is there, and the cron's own minute records it with the heartbeat
    process.env.AXF_CRON_DIR = dir; delete process.env.AXF_WATCHDOG_CRON; delete process.env.AXF_WATCHDOG_IN_CONSOLE;
    assert.ok(cron.install().installed);
    await H.pass({ only: 'wa', by: 'cron' });
    const onHost = await H.status(); assert.equal(onHost.cron.installed, true); assert.equal(onHost.cron.source, undefined, 'read straight from the file');
    // the console container: no schedule file in sight
    process.env.AXF_CRON_DIR = join(dir, 'not-here'); process.env.AXF_WATCHDOG_IN_CONSOLE = '1';
    assert.equal(cron.status().installed, false);
    const inConsole = await H.status();
    assert.deepEqual([inConsole.cron.installed, inConsole.cron.current, inConsole.cron.source], [true, true, 'host']);
    // a pass asked for from the console never overwrites the host's record
    await H.pass({ only: 'wa', by: 'cron' }); assert.equal((await H.status()).cron.installed, true);
    // the record ages out with the heartbeat: a cron that is really gone shows as not installed
    assert.equal((await H.status({ now: Date.now() + 30 * 60000 })).cron.installed, false);
  } finally {
    for (const [k, v] of [['AXF_CRON_DIR', keep.d], ['AXF_WATCHDOG_CRON', keep.w], ['AXF_WATCHDOG_IN_CONSOLE', keep.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
});
await t('scan: every watch`s dry run in one answer; a watch without one says so', async () => {
  wa.scan = () => ({ watching: 2, items: [{ build: 'x', cause: 'stuck', action: 'retry' }] });
  const sc = await H.scan({ only: 'wa' }); assert.equal(sc.items.length, 1); assert.equal(sc.items[0].watch, 'wa');
  assert.match((await H.scan({ only: 'wb' })).watches[0].note, /no dry run/);
});

rmSync(tmp, { recursive: true, force: true });
console.log(process.exitCode ? 'watchdogs: FAILED' : `watchdogs: ${n} checks passed`);
process.exit(process.exitCode ?? 0);
