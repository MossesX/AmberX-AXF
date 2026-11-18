#!/usr/bin/env node
/**
 * check-build-pipeline-fill — build-pipeline@1 step dependencies, claims and the fill planner (spec/BUILD-PARALLEL.md).
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
for (const [k, c] of Object.entries(fx.in.fill)) { const r = p.planFill({ ...c, now: Date.parse(c.now ?? fx.now) }); out.fill[k] = { launches: r.launches, waits: r.waits, free: r.free, blocked: r.blocked }; }

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
t('per-build caps: pipeline.maxParallel and pipeline.budgetUsd hold the build, not the others', () => {
  const steps = [{ id: 's1', model: 'Opus', done: true }, { id: 's2', model: 'Opus', after: [] }, { id: 's3', model: 'Opus', after: [] }, { id: 's4', model: 'Opus', after: [] }];
  const r = p.planFill({ slots: SLOTS, accounts: ACC, running: [{ id: 'b', status: 'running', pipeline: { maxParallel: 1 }, steps }], now: NOW });
  assert.deepEqual(r.launches.map((l) => l.step), ['s3']); assert.match(r.waits[0].why, /parallel cap \(1\)/);
  const api = [{ name: 'api', kind: 'api', usable: true, fable: true, free: 4, running: 0, parallel: 4, api: { usable: true } }];
  const q = [{ id: 'cheap', status: 'queued', pipeline: { route: 'api', budgetUsd: 5, spentUsd: 4.5 }, steps: [{ id: 's1', model: 'Opus' }] }, { id: 'other', status: 'queued', pipeline: { route: 'api' }, steps: [{ id: 's1', model: 'Opus' }] }];
  const r2 = p.planFill({ slots: SLOTS, accounts: api, queue: q, settings: { budget: { capUsd: 100, spentUsd: 0, perLaunchUsd: 1 } }, now: NOW });
  assert.deepEqual(r2.launches.map((l) => l.id), ['other']); assert.match(r2.waits[0].why, /build budget cap reached \(\$4\.50 of \$5\.00\)/);
  assert.deepEqual(p.normPipeline({ maxParallel: 99, budgetUsd: '2.345', spentUsd: -1 }), { ...p.emptyPipeline(), maxParallel: 12, budgetUsd: 2.35 }, 'caps in shape');
});
t('auto-queue takes only split Pending builds that clash with no running build', () => {
  const running = [{ id: 'r', status: 'running', steps: [{ id: 's1', model: 'Opus', files: ['shared.mjs'] }] }];
  const pending = [{ id: 'unsplit', status: 'pending', steps: [] }, { id: 'clash', status: 'pending', steps: [{ id: 's1', model: 'Opus', files: ['shared.mjs'] }] }, { id: 'clear', status: 'pending', steps: [{ id: 's1', model: 'Opus', files: ['own.mjs'] }] }];
  const r = p.planFill({ slots: SLOTS, accounts: ACC, running, pending, settings: { autoQueue: true }, now: NOW });
  assert.deepEqual(r.launches.map((l) => l.id), ['clear']);
  assert.deepEqual(r.waits.map((w) => [w.id, w.why]), [['unsplit', 'no steps yet: waiting for the split'], ['clash', 'files clash with running build r (shared.mjs)']]);
});
t('stepBranch: parallel steps get their own branch off the build branch', () => { assert.equal(p.stepBranch({ id: 'b', branch: 'claude/b' }, { id: 's3' }, { parallel: true }), 'claude/b--s3'); assert.equal(p.stepBranch({ id: 'b', branch: 'claude/b' }, { id: 's3' }), 'claude/b'); assert.equal(p.stepBranch({ id: 'b' }, { id: 's1' }, { parallel: true }), 'claude/b--s1'); });

if (!write) console.log(`check-build-pipeline-fill: ${n} checks passed`);
