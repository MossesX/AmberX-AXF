#!/usr/bin/env node
/**
 * check-build-pipeline-fill — build-pipeline@1 step dependencies, claims and the fill planner (spec/BUILD-PARALLEL.md):
 * one build at a time, every free slot filled by it, main locked while its run is active (spec/BUILD-SPLIT.md).
 * Replays fixtures/build-pipeline-fill.json: every `in` must answer its `out`. Pure (nothing written without --write).
 *
 *   node framework/spec/check-build-pipeline-fill.mjs            check
 *   node framework/spec/check-build-pipeline-fill.mjs --write    regenerate the expected outputs from the reference engine
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '../core/build-pipeline.mjs';
import * as sp from '../core/build-split.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'framework/spec/fixtures/build-pipeline-fill.json');
const write = process.argv.includes('--write');
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
const NOW = Date.parse(fx.now);
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ids = (steps) => steps.map((s) => s.id);
const strip = (r) => { const { build, step, ...rest } = r; return { ...rest, ...(step ? { step: step.id } : {}), ...(build ? { steps: build.steps.map((s) => ({ id: s.id, claim: s.claim ?? null, note: s.note ?? '' })) } : {}) }; };

const out = { ready: {}, claims: {}, fill: {} };
for (const [k, c] of Object.entries(fx.in.ready)) out.ready[k] = { ready: ids(p.readySteps(c.build, { now: Date.parse(c.now ?? fx.now), model: c.model ?? '' })), expired: p.expiredClaims(c.build, Date.parse(c.now ?? fx.now)).map((x) => x.step.id), depends: Object.fromEntries(c.build.steps.map((s) => [s.id, p.dependsOn(c.build, s)])) };
for (const [k, c] of Object.entries(fx.in.claims)) {
  let b = c.build; const steps = [];
  for (const op of c.ops) {
    const r = op.op === 'claim' ? p.claimStep(b, op.step, { ...op.args, now: Date.parse(op.at ?? fx.now) }) : p.releaseStep(b, op.step, { ...op.args, now: Date.parse(op.at ?? fx.now) });
    if (r.ok && r.build) b = r.build;
    steps.push({ op: op.op, step: op.step, result: strip(r) });
  }
  out.claims[k] = steps;
}
for (const [k, c] of Object.entries(fx.in.fill)) { const r = p.planFill({ ...c, now: Date.parse(c.now ?? fx.now) }); out.fill[k] = { launches: r.launches, waits: r.waits, free: r.free, blocked: r.blocked, active: r.active, started: r.started, lock: r.lock }; }

if (write) {
  writeFileSync(FIX, `${JSON.stringify({ ...fx, out }, null, 1)}\n`);
  console.log(`wrote ${FIX}`);
} else {
  for (const sec of ['ready', 'claims', 'fill']) for (const k of Object.keys(fx.in[sec])) t(`${sec}.${k}`, () => assert.deepEqual(out[sec][k], fx.out[sec][k]));
}

// ---- invariants the fixtures alone do not state
t('an old build (no after anywhere) has exactly one ready step: the first open one', () => {
  const b = { steps: [{ id: 's1', model: 'Opus', done: true }, { id: 's2', model: 'Opus' }, { id: 's3', model: 'Opus' }] };
  assert.deepEqual(ids(p.readySteps(b, { now: NOW })), ['s2']);
});
t('normAfter keeps absent and [] apart', () => { assert.equal(p.normAfter(undefined), undefined); assert.deepEqual(p.normAfter([]), []); assert.deepEqual(p.normAfter(['s2', 's2', 's1'], { self: 's1' }), ['s2']); });
t('a claim never outranks the pin; a downgrade is allowed and recorded', () => {
  const b = { id: 'b', steps: [{ id: 's1', model: 'Opus', after: [] }, { id: 's2', model: 'Fable', after: [] }] };
  assert.match(p.claimStep(b, 's1', { runId: 'r', model: 'Fable', now: NOW }).why, /pinned to Opus/);
  assert.equal(p.claimStep(b, 's2', { runId: 'r', model: 'Opus', now: NOW }).claim.model, 'Opus');
});
t('claim TTL: live before expiresAt, dead after; at least a minute', () => {
  const c = p.normClaim({ runId: 'r', at: fx.now }); assert.equal(c.expiresAt, new Date(NOW + p.CLAIM_TTL_MS).toISOString());
  assert.equal(p.claimLive(c, NOW + p.CLAIM_TTL_MS - 1), true); assert.equal(p.claimLive(c, NOW + p.CLAIM_TTL_MS), false);
  assert.equal(Date.parse(p.claimStep({ steps: [{ id: 's1', model: 'Opus' }] }, 's1', { runId: 'r', now: NOW, ttlMs: 5 }).claim.expiresAt) - NOW, 60e3);
});
t('planFill never launches without a free slot, and every launch names an account that fits its model', () => {
  for (const c of Object.values(fx.in.fill)) {
    const r = p.planFill({ ...c, now: NOW });
    const free = Math.min(Number(c.slots?.free) || 0, c.slots?.hard?.max ? Number(c.slots.hard.free) || 0 : Infinity);
    assert.ok(r.launches.length <= free);
    for (const l of r.launches) { const a = c.accounts.find((x) => x.name === l.account); assert.ok(a, l.account); if (l.model === 'Fable') assert.equal(a.fable, true); }
    const perAcc = {}; for (const l of r.launches) perAcc[l.account] = (perAcc[l.account] ?? 0) + 1;
    for (const [name, k] of Object.entries(perAcc)) assert.ok(k <= c.accounts.find((x) => x.name === name).free, `${name} over its free slots`);
  }
});
const ACC = [{ name: 'a', kind: 'subscription', usable: true, fable: true, free: 4, running: 0, parallel: 4, order: 0 }];
const SLOTS = { free: 6, used: 0, cap: 6 };
t('dependsOn is read like after; parallel: never is never a parallel launch', () => {
  const b = { id: 'b', status: 'running', steps: [{ id: 's1', model: 'Opus', done: true }, { id: 's2', model: 'Opus' }, { id: 's3', model: 'Opus', dependsOn: ['s1'] }, { id: 's4', model: 'Opus', after: ['s1'], parallel: 'never' }] };
  assert.deepEqual(p.dependsOn(b, b.steps[2]), ['s1']); assert.equal(p.isParallelStep(b.steps[2]), true); assert.equal(p.isParallelStep(b.steps[3]), false); assert.equal(p.isParallelStep(b.steps[1]), false);
  assert.deepEqual(ids(p.readySteps(b, { now: NOW })), ['s2', 's3', 's4'], 'ready is about dependencies; parallel is the planner\'s business');
  const r = p.planFill({ slots: SLOTS, accounts: ACC, running: [b], now: NOW });
  assert.deepEqual(r.launches.map((l) => l.step), ['s3'], 's2 is the main session\'s, s4 never runs in parallel');
});
t('a file clash holds a step back: in readySteps against a live claim, in claimStep, and in the planner against the session\'s step', () => {
  const claim = p.normClaim({ runId: 'main', at: fx.now, model: 'Opus' });
  const b = { id: 'b', status: 'running', steps: [{ id: 's1', model: 'Opus', done: true }, { id: 's2', model: 'Opus', files: ['a.mjs'], claim }, { id: 's3', model: 'Opus', after: ['s1'], files: ['a.mjs', 'b.mjs'] }, { id: 's4', model: 'Opus', after: ['s1'], files: ['c.mjs'] }] };
  assert.deepEqual(ids(p.readySteps(b, { now: NOW })), ['s4']); assert.deepEqual(ids(p.readySteps(b, { now: NOW, files: false })), ['s3', 's4']);
  assert.deepEqual(p.fileClashes(b, b.steps[2], { now: NOW }), [{ step: 's2', files: ['a.mjs'] }]);
  assert.match(p.claimStep(b, 's3', { runId: 'r2', now: NOW }).why, /s3 files clash with s2 \(a\.mjs\)/);
  assert.equal(p.claimStep(b, 's3', { runId: 'main', now: NOW }).ok, true, 'the run that holds the clashing step may take it');
  const open = { ...b, steps: b.steps.map((s) => (s.id === 's2' ? { ...s, claim: undefined } : s)) }; // no claim: the main session is on s2
  const r = p.planFill({ slots: SLOTS, accounts: ACC, running: [open], now: NOW });
  assert.deepEqual(r.launches.map((l) => l.step), ['s4']); assert.deepEqual(r.waits.map((w) => [w.step, w.why]), [['s3', 'files clash with s2 (a.mjs)']]);
  const two = { id: 'b', status: 'running', steps: [{ id: 's1', model: 'Opus', done: true }, { id: 's2', model: 'Opus', after: [], files: ['x'] }, { id: 's3', model: 'Opus', after: [], files: ['x'] }, { id: 's4', model: 'Opus', after: [], files: ['x'] }] };
  assert.deepEqual(p.planFill({ slots: SLOTS, accounts: ACC, running: [two], now: NOW }).launches.map((l) => l.step), [], 'the main session is on s2; s3 and s4 both touch x');
});
t('per-build caps: pipeline.maxParallel and pipeline.budgetUsd hold the build; a build that cannot start does not hold the line up', () => {
  const steps = [{ id: 's1', model: 'Opus', done: true }, { id: 's2', model: 'Opus', after: [] }, { id: 's3', model: 'Opus', after: [] }, { id: 's4', model: 'Opus', after: [] }];
  const r = p.planFill({ slots: SLOTS, accounts: ACC, running: [{ id: 'b', status: 'running', pipeline: { maxParallel: 1 }, steps }], now: NOW });
  assert.deepEqual(r.launches.map((l) => l.step), ['s3']); assert.match(r.waits[0].why, /parallel cap \(1\)/);
  const api = [{ name: 'api', kind: 'api', usable: true, fable: true, free: 4, running: 0, parallel: 4, api: { usable: true } }];
  const q = [{ id: 'cheap', status: 'queued', pipeline: { route: 'api', budgetUsd: 5, spentUsd: 4.5 }, steps: [{ id: 's1', model: 'Opus' }] }, { id: 'other', status: 'queued', pipeline: { route: 'api' }, steps: [{ id: 's1', model: 'Opus' }] }];
  const r2 = p.planFill({ slots: SLOTS, accounts: api, queue: q, settings: { budget: { capUsd: 100, spentUsd: 0, perLaunchUsd: 1 } }, now: NOW });
  assert.deepEqual(r2.launches.map((l) => l.id), ['other']); assert.match(r2.waits[0].why, /build budget cap reached \(\$4\.50 of \$5\.00\)/);
  assert.deepEqual(p.normPipeline({ maxParallel: 99, budgetUsd: '2.345', spentUsd: -1 }), { ...p.emptyPipeline(), maxParallel: 12, budgetUsd: 2.35 }, 'caps in shape');
});
t('one build at a time: nothing starts beside a running build, from the Queue or from Pending', () => {
  const running = [{ id: 'r', status: 'running', steps: [{ id: 's1', model: 'Opus', files: ['shared.mjs'] }] }];
  const queue = [{ id: 'q', status: 'queued', steps: [{ id: 's1', model: 'Opus', files: ['q.mjs'] }] }];
  const pending = [{ id: 'unsplit', status: 'pending', steps: [] }, { id: 'clear', status: 'pending', steps: [{ id: 's1', model: 'Opus', files: ['own.mjs'] }] }];
  const r = p.planFill({ slots: SLOTS, accounts: ACC, running, queue, pending, settings: { autoQueuePending: true }, now: NOW });
  assert.deepEqual(r.launches, []); assert.deepEqual(r.active, ['r']); assert.equal(r.started, '');
  assert.deepEqual(r.waits.map((w) => [w.id, w.why]), [['q', 'one build at a time: r is building'], ['unsplit', 'one build at a time: r is building'], ['clear', 'one build at a time: r is building']]);
  assert.equal(r.blocked, 'one build at a time: r is building');
  const idle = p.planFill({ slots: SLOTS, accounts: ACC, queue: [...queue, { id: 'q2', status: 'queued', steps: [{ id: 's1', model: 'Opus' }] }], pending, settings: { autoQueuePending: true }, now: NOW });
  assert.deepEqual(idle.launches.map((l) => l.id), ['q'], 'exactly one build starts, whatever the slots say'); assert.equal(idle.started, 'q');
  assert.deepEqual(idle.waits.map((w) => w.why), ['one build at a time: q starts first', 'one build at a time: q starts first', 'one build at a time: q starts first']);
  const auto = p.planFill({ slots: SLOTS, accounts: ACC, pending, settings: { autoQueuePending: true }, now: NOW });
  assert.deepEqual(auto.launches.map((l) => [l.kind, l.id]), [['pending', 'clear']]); assert.deepEqual(auto.waits.map((w) => [w.id, w.why]), [['unsplit', 'no steps yet: waiting for the split']]);
});
t('never more than one build started in a round, on any fixture', () => {
  for (const c of Object.values(fx.in.fill)) {
    const r = p.planFill({ ...c, now: NOW });
    const startedIds = [...new Set(r.launches.filter((l) => !r.active.includes(l.id)).map((l) => l.id))];
    assert.ok(startedIds.length <= p.BUILDS_AT_ONCE); assert.deepEqual(startedIds, r.started ? [r.started] : []);
    if (r.active.length) assert.equal(r.started, '', 'nothing starts beside a build that holds the line');
  }
});
const SHA = 'a'.repeat(40);
const splitBuild = (id, run, parts, extra = {}) => ({ id, status: run === 'queued' ? 'queued' : 'running', splitId: `${id}.r1`, steps: parts.flatMap((x) => x.steps.map((sid) => ({ id: sid, model: x.model ?? 'Opus' }))),
  split: { id: `${id}.r1`, run, base: extra.base ?? '', parts: parts.map((x, i) => ({ id: `p${i + 1}`, status: 'waiting', branch: `claude/${id}--r1-p${i + 1}`, base: extra.base ?? '', slot: '', session: '', ...x })) } });
t('a split build starts part by part: every free slot, one base, main locked first', () => {
  const b = splitBuild('sp', 'queued', [{ steps: ['s1'] }, { steps: ['s2', 's3'], model: 'Fable' }, { steps: ['s4'] }]);
  const r = p.planFill({ slots: SLOTS, accounts: ACC, queue: [b, { id: 'next', status: 'queued', steps: [{ id: 's1', model: 'Opus' }] }], now: NOW });
  assert.deepEqual(r.launches.map((l) => [l.kind, l.id, l.part, l.step, l.model, l.branch]), [['part', 'sp', 'p1', 's1', 'Opus', 'claude/sp--r1-p1'], ['part', 'sp', 'p2', 's2', 'Fable', 'claude/sp--r1-p2'], ['part', 'sp', 'p3', 's4', 'Opus', 'claude/sp--r1-p3']]);
  assert.deepEqual(r.lock, { build: 'sp', splitId: 'sp.r1', held: false, base: '' }, 'the dispatcher takes the main lock before any part is launched');
  assert.equal(r.started, 'sp'); assert.deepEqual(r.waits, [{ id: 'next', why: 'one build at a time: sp starts first' }]);
  // running: main is locked at SHA; the parts not yet in a slot start on that one base, the Queue waits
  const live = splitBuild('sp', 'building', [{ steps: ['s1'], status: 'building', slot: 'a1', session: 'axf-sp--r1-p1' }, { steps: ['s2'] }, { steps: ['s3'], status: 'rebuilding' }, { steps: ['s4'], status: 'done' }], { base: SHA });
  const lock = { $axf: 'main-lock@1', build: 'sp', splitId: 'sp.r1', base: SHA, lockedAt: fx.now, by: 'dispatcher' };
  const r2 = p.planFill({ slots: SLOTS, accounts: ACC, running: [live], queue: [{ id: 'next', status: 'queued', steps: [{ id: 's1', model: 'Opus' }] }], mainLock: lock, now: NOW });
  assert.deepEqual(r2.launches.map((l) => [l.part, l.base]), [['p2', SHA], ['p3', SHA]]); assert.deepEqual(r2.lock, { build: 'sp', splitId: 'sp.r1', held: true, base: SHA });
  assert.deepEqual(r2.active, ['sp']); assert.deepEqual(r2.waits, [{ id: 'next', why: 'one build at a time: sp is building' }]);
  // no lock: no part starts without its base
  const r3 = p.planFill({ slots: SLOTS, accounts: ACC, running: [live], now: NOW });
  assert.deepEqual(r3.launches, []); assert.match(r3.waits[0].why, /main is not locked for this run/);
});
t('main stays locked through combining, CI and the merge: the next build waits until the run is finished or failed', () => {
  const next = [{ id: 'next', status: 'queued', steps: [{ id: 's1', model: 'Opus' }] }];
  const lock = { build: 'sp', splitId: 'sp.r1', base: SHA, lockedAt: fx.now };
  for (const run of ['combining', 'ci', 'merging', 'merged', 'live']) {
    const landing = { ...splitBuild('sp', run, [{ steps: ['s1'], status: 'done' }], { base: SHA }), status: 'landing' };
    const r = p.planFill({ slots: SLOTS, accounts: ACC, running: [landing], queue: next, mainLock: lock, now: NOW });
    assert.deepEqual(r.launches, []); assert.equal(r.waits[0].why, `one build at a time: sp is ${run}`);
  }
  const lockedOnly = p.planFill({ slots: SLOTS, accounts: ACC, queue: next, mainLock: lock, now: NOW });
  assert.deepEqual(lockedOnly.launches, []); assert.equal(lockedOnly.waits[0].why, 'one build at a time: main is locked by sp (sp.r1)');
  for (const run of ['finished', 'failed']) {
    const over = { ...splitBuild('sp', run, [{ steps: ['s1'], status: 'done' }], { base: SHA }), status: run === 'failed' ? 'fixing' : 'complete' };
    assert.deepEqual(p.planFill({ slots: SLOTS, accounts: ACC, running: [over], queue: next, now: NOW }).launches.map((l) => l.id), ['next'], `${run}: main is free again`);
  }
  assert.deepEqual(p.RUN_ACTIVE, ['building', 'combining', 'ci', 'merging', 'merged', 'live']);
});
t('the 4-builds setting is retired: ignored by the planner, dropped by the migration with a note, nothing else lost', () => {
  const steps = [{ id: 's1', model: 'Opus', done: true }, ...['s2', 's3', 's4', 's5', 's6', 's7'].map((id) => ({ id, model: 'Opus', after: [] }))];
  const r = p.planFill({ slots: SLOTS, accounts: [{ ...ACC[0], free: 6, parallel: 6 }], running: [{ id: 'b', status: 'running', steps }], settings: { maxParallelPerBuild: 1 }, now: NOW });
  assert.deepEqual(r.launches.map((l) => l.step), ['s3', 's4', 's5', 's6', 's7'], 'the one build takes every free slot, not 1 + 3');
  const m = p.migrateFillSettings({ maxParallelPerBuild: 3, maxBuildsAtOnce: 4, autoQueuePending: true, apiOverflow: false });
  assert.deepEqual(m.settings, { autoQueuePending: true, apiOverflow: false }); assert.deepEqual(m.notes.map((x) => [x.key, x.was]), [['maxParallelPerBuild', 3], ['maxBuildsAtOnce', 4]]);
  assert.ok(m.notes.every((x) => /retired Nov 25 2026/.test(x.note))); assert.deepEqual(p.migrateFillSettings(m.settings), { settings: m.settings, notes: [] });
  assert.equal(p.BUILDS_AT_ONCE, 1); assert.equal(p.FILL_DEFAULTS.maxParallelPerBuild, 3, 'old readers of the default still get a number');
  // builds already side by side when the rule changed finish; nothing new starts until none is left
  const two = [{ id: 'old1', status: 'running', steps: [{ id: 's1', model: 'Opus' }] }, { id: 'old2', status: 'running', steps: [{ id: 's1', model: 'Opus' }] }];
  const r2 = p.planFill({ slots: SLOTS, accounts: ACC, running: two, queue: [{ id: 'q', status: 'queued', steps: [{ id: 's1', model: 'Opus' }] }], now: NOW });
  assert.deepEqual(r2.launches, []); assert.equal(r2.waits[0].why, 'one build at a time: old1 is building (and 1 more from before the rule)');
});
t('main lock (main-lock@1): one holder, one base for every part, released only when the run is over', () => {
  const B = 'b'.repeat(40); const at = fx.now;
  const one = { id: 'one', steps: [{ id: 's1', files: ['x'] }, { id: 's2', files: ['y'] }] }; const two = { id: 'two', steps: [{ id: 's1', files: ['z'] }] };
  const p1 = sp.planParts(one, 4, {}, { at }).plan; const p2 = sp.planParts(two, 4, {}, { at }).plan;
  assert.equal(sp.canStartRun(p1).ok, true); assert.match(sp.startRun(p1, { sha: 'short', at }).why, /full commit sha/);
  const s1 = sp.startRun(p1, { sha: SHA, at });
  assert.equal(s1.ok, true); assert.equal(s1.plan.run, 'building'); assert.equal(s1.plan.base, SHA); assert.deepEqual(s1.plan.parts.map((x) => x.base), [SHA, SHA], 'every part on the locked sha');
  assert.deepEqual(s1.lock, { $axf: 'main-lock@1', build: 'one', splitId: 'one.r1', base: SHA, lockedAt: at, by: 'dispatcher' });
  assert.equal(sp.validatePlan(s1.plan, one).ok, true); assert.equal(sp.oneBase(s1.plan, s1.lock).ok, true);
  assert.match(sp.oneBase({ ...s1.plan, parts: [{ ...s1.plan.parts[0], base: B }, s1.plan.parts[1]] }).why, /p1 not on the run's base/);
  // a second build never starts beside it: by the lock, and by the active run alone
  assert.match(sp.startRun(p2, { lock: s1.lock, sha: B, at }).why, /main is locked by one \(one\.r1\).*one build at a time/);
  assert.match(sp.startRun(p2, { builds: [{ ...one, split: s1.plan }], sha: B, at }).why, /one is building \(one\.r1\): one build at a time/);
  assert.deepEqual(sp.activeRuns([{ ...one, split: s1.plan }, { ...two, split: p2 }]), [{ build: 'one', splitId: 'one.r1', run: 'building' }]);
  // the base is never rewritten; the holder taking again changes nothing
  assert.match(sp.takeMainLock(s1.lock, { splitId: 'one.r1', sha: B }).why, /never rewritten/); assert.equal(sp.takeMainLock(s1.lock, { splitId: 'one.r1', sha: SHA }).taken, false);
  assert.match(sp.startRun(s1.plan, { lock: s1.lock, sha: SHA }).why, /only a queued run starts/);
  // released at finished / failed, by its own split only
  assert.equal(sp.releaseMainLock(s1.lock, { splitId: 'two.r1' }).ok, false); assert.equal(sp.lockAfterRun(s1.plan, s1.lock).lock.build, 'one');
  for (const run of sp.RUN_ACTIVE) assert.equal(sp.lockAfterRun({ ...s1.plan, run }, s1.lock).released, null, `${run}: main stays locked`);
  const failed = sp.runNext(s1.plan, 'failed', { at, why: 'cancelled' }).plan;
  assert.deepEqual(sp.lockAfterRun(failed, s1.lock), { lock: null, released: s1.lock }); assert.equal(sp.lockAfterRun({ ...s1.plan, run: 'finished' }, s1.lock).lock, null);
  assert.equal(sp.startRun(p2, { lock: sp.lockAfterRun(failed, s1.lock).lock, builds: [{ ...one, split: failed }], sha: B, at }).ok, true, 'the next build starts once main is free');
  // stale: a lock nobody works under
  assert.equal(sp.mainLockStale(s1.lock, { now: NOW + sp.MAIN_LOCK_STALE_MS + 1 }).stale, true); assert.equal(sp.mainLockStale(s1.lock, { now: NOW + sp.MAIN_LOCK_STALE_MS + 1, live: true }).stale, false);
  assert.equal(sp.mainLockStale(s1.lock, { now: NOW, plan: failed }).stale, true); assert.equal(sp.mainLockStale(s1.lock, { now: NOW, plan: s1.plan }).stale, false);
  assert.deepEqual(sp.RUN_ACTIVE, p.RUN_ACTIVE, 'the planner and the split engine agree on when a run holds main');
});
t('stepBranch: parallel steps get their own branch off the build branch', () => { assert.equal(p.stepBranch({ id: 'b', branch: 'claude/b' }, { id: 's3' }, { parallel: true }), 'claude/b--s3'); assert.equal(p.stepBranch({ id: 'b', branch: 'claude/b' }, { id: 's3' }), 'claude/b'); assert.equal(p.stepBranch({ id: 'b' }, { id: 's1' }, { parallel: true }), 'claude/b--s1'); });

if (!write) console.log(`check-build-pipeline-fill: ${n} checks passed`);
