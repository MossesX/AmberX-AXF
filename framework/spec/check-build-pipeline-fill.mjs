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
t('stepBranch: parallel steps get their own branch off the build branch', () => { assert.equal(p.stepBranch({ id: 'b', branch: 'claude/b' }, { id: 's3' }, { parallel: true }), 'claude/b--s3'); assert.equal(p.stepBranch({ id: 'b', branch: 'claude/b' }, { id: 's3' }), 'claude/b'); assert.equal(p.stepBranch({ id: 'b' }, { id: 's1' }, { parallel: true }), 'claude/b--s1'); });

if (!write) console.log(`check-build-pipeline-fill: ${n} checks passed`);
