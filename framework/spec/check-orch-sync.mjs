#!/usr/bin/env node
/**
 * check-orch-sync — orchestrator ↔ Pending builds sync (framework/plan/orch-sync.mjs + framework/cli/orch-sync.mjs).
 * Pure cases, then a round trip through pending.mjs actPending on temp files (the orchestrator's own save → Pending
 * round trip is in the build orchestrator plugin's test.mjs).
 *   node framework/spec/check-orch-sync.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sync from '../plan/orch-sync.mjs';

let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}: ${e.stack || e.message}`); process.exit(1); } };
const T0 = '2026-10-27T10:00:00.000Z', T1 = '2026-10-27T11:00:00.000Z', T2 = '2026-10-27T12:00:00.000Z';
const step = (id, text, model, done = false) => ({ id, text, model, estimate: '30 min', done, doneAt: done ? T1 : '', why: '', phase: '', group: '', files: [], checks: [], session: 'same', agent: false, note: '' });
const build = (o) => ({ id: 'b1', title: 'Build one', detail: 'd', category: '', status: 'running', hidden: false, source: 'chat', pendingId: '', branch: '', pr: '', createdAt: T0, updatedAt: T1, builtAt: '', notes: [], approvals: [], steps: [step('s1', 'Design', 'Fable', true), step('s2', 'Wire', 'Opus')], ...o });
const orch = (builds) => ({ $axf: 'orchestrator@1', updatedAt: T1, rules: {}, builds });
const pend = (items) => ({ $axf: 'pending@1', updatedAt: T0, artifact: '', items });

await t('orchestrator → pending publishes steps with [Model] prefixes, next model, status', () => {
  const r = sync.orchestratorToPending(orch([build()]), pend([]), T2);
  const it = r.pending.items[0];
  assert.equal(it.id, 'b1'); assert.equal(it.status, 'pending'); assert.equal(it.model, 'Opus');
  assert.deepEqual(it.subPrompts.map((p) => p.text), ['[Fable] Design', '[Opus] Wire']);
  assert.equal(it.subPrompts[0].done, true); assert.equal(it.updatedAt, T1);
});
await t('complete build → complete item with builtAt; archived build leaves its item alone', () => {
  const r = sync.orchestratorToPending(orch([build({ status: 'complete', builtAt: T2 }), build({ id: 'b2', status: 'archived' })]),
    pend([{ id: 'b2', title: 'kept', status: 'complete', model: 'Opus', notes: [], subPrompts: [], createdAt: T0, updatedAt: T0, builtAt: T0 }]), T2);
  assert.equal(r.pending.items.find((x) => x.id === 'b1').status, 'complete');
  assert.equal(r.pending.items.find((x) => x.id === 'b1').builtAt, T2);
  assert.equal(r.pending.items.find((x) => x.id === 'b2').title, 'kept');
});
await t('second publish is a no-op', () => {
  const a = sync.orchestratorToPending(orch([build()]), pend([]), T2);
  const b = sync.orchestratorToPending(orch([build()]), a.pending, T2);
  assert.equal(b.log.length, 0);
});
await t('pending item with no build is added to the orchestrator with its steps and models', () => {
  const r = sync.pendingToOrchestrator(pend([{ id: 'p1', title: 'New', detail: '', model: 'Fable', status: 'pending', notes: [], createdAt: T1, updatedAt: T1, builtAt: '', source: 'mcp',
    subPrompts: [{ text: '[Opus] a', estimate: '20 min' }, { text: 'b', estimate: '10 min' }] }]), orch([]), null, T2);
  const b = r.orch.builds[0];
  assert.equal(b.id, 'p1'); assert.equal(b.pendingId, 'p1'); assert.deepEqual(b.steps.map((s) => [s.text, s.model]), [['a', 'Opus'], ['b', 'Fable']]);
});
await t('a newer pending edit flows back: step tick, note, status; an older one does not', () => {
  const pub = sync.orchestratorToPending(orch([build()]), pend([]), T2).pending;
  const it = { ...pub.items[0], updatedAt: T2, subPrompts: pub.items[0].subPrompts.map((p) => ({ ...p, done: true, doneAt: T2 })), notes: [{ text: 'hi', at: T2 }] };
  const r = sync.pendingToOrchestrator(pend([it]), orch([build()]), null, T2);
  const b = r.orch.builds[0];
  assert.equal(b.steps[1].done, true); assert.equal(b.status, 'complete'); assert.ok(b.notes.some((x) => x.text === 'hi'));
  const old = sync.pendingToOrchestrator(pend([{ ...it, updatedAt: T0 }]), orch([build()]), null, T2);
  assert.equal(old.log.length, 0);
});
await t('a note on a paused (blocked) build does not unpause it', () => {
  const b0 = build({ status: 'blocked' });
  const it = { ...sync.orchestratorToPending(orch([b0]), pend([]), T2).pending.items[0], updatedAt: T2, notes: [{ text: 'n', at: T2 }] };
  assert.equal(sync.pendingToOrchestrator(pend([it]), orch([b0]), null, T2).orch.builds[0].status, 'blocked');
});
await t('removing a pending item archives its build', () => {
  const r = sync.pendingToOrchestrator(pend([]), orch([build()]), { action: 'remove', id: 'b1' }, T2);
  assert.equal(r.orch.builds[0].status, 'archived');
});

// ---- round trip through the real writers, on temp files
const dir = mkdtempSync(join(tmpdir(), 'orch-sync-'));
process.env.AXF_ORCH_FILE = join(dir, 'orchestrator.json');
process.env.AXF_PENDING_FILE = join(dir, 'pending.json');
writeFileSync(process.env.AXF_ORCH_FILE, JSON.stringify(orch([])));
writeFileSync(process.env.AXF_PENDING_FILE, JSON.stringify(pend([])));
const io = await import('../cli/orch-sync.mjs');
const readJ = (f) => JSON.parse(readFileSync(f, 'utf8'));
await t('Pending act → orchestrator (pending.mjs actPending step tick + add)', async () => {
  const p = await import('../cli/pending.mjs');
  p.actPending({ action: 'add', title: 'Round trip', model: 'Fable', subPrompts: [{ text: '[Fable] one', estimate: '20 min' }, { text: '[Opus] two', estimate: '20 min' }] });
  const b = readJ(process.env.AXF_ORCH_FILE).builds.find((x) => x.id === 'round-trip');
  assert.ok(b, 'added to the orchestrator'); assert.deepEqual(b.steps.map((s) => s.model), ['Fable', 'Opus']);
  p.actPending({ action: 'step', id: 'round-trip', index: 0, done: true });
  assert.equal(readJ(process.env.AXF_ORCH_FILE).builds.find((x) => x.id === 'round-trip').steps[0].done, true);
});
await t('syncNow is idempotent', () => { io.syncNow(); assert.equal(io.syncNow().length, 0); });

console.log(`check-orch-sync: ${n} checks passed`);
