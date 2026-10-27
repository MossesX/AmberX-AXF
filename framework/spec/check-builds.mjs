#!/usr/bin/env node
/**
 * check-builds — builds@1 (framework/spec/BUILDS.md): the one builds dataset in framework/plan/builds-core.mjs.
 * Replays spec/fixtures/builds.json (migration of a small plan + pending + queue + orchestrator, every view, round
 * trips, write-backs through the older cores) and checks the invariants on it. Pure: nothing on disk is touched.
 *
 *   node framework/spec/check-builds.mjs            replay the fixture (CI)
 *   node framework/spec/check-builds.mjs --write    regenerate the fixture from the reference core
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from '../plan/builds-core.mjs';
import * as PC from '../plan/pending-core.mjs';
import * as QC from '../plan/build-queue-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures/builds.json');
const NOW = '2026-10-27T20:00:00.000Z', T1 = '2026-10-27T21:00:00.000Z';
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}: ${e.message}`); process.exit(1); } };
const J = (v) => JSON.parse(JSON.stringify(v));

/* ---- input: a small world with every kind of entry ---- */
const feature = (o) => ({ ports: {}, capabilities: [], dependsOn: [], catalog: [], modules: [], files: [], acceptance: [], warnings: [], recommendations: [], previews: [], screenshots: [], links: [], tags: [], notes: '', history: [{ at: '2026-10-01', text: 'Added' }], ...o });
export const input = {
  plan: {
    $axf: 'plan@1', generatedAt: '2026-10-26T00:00:00.000Z', statuses: ['built', 'partial', 'in-progress', 'placeholder', 'planned', 'blocked', 'dropped'],
    features: [
      feature({ id: 'x.kernel', title: 'Kernel', area: 'Kernel', kind: 'epic', status: 'built', priority: 'P0', wave: 1, effort: 'XL', summary: 'The core', model: 'fable', modelReason: 'core', source: 'seed', catalog: ['k.pure'], dependsOn: [] }),
      feature({ id: 'x.assets.designer', title: 'Asset designer', area: 'Assets', kind: 'epic', status: 'planned', priority: 'P1', wave: 2, effort: 'L', summary: 'No-code designer', model: 'fable', modelReason: 'contract', source: 'seed', catalog: ['c.designer'], dependsOn: ['x.kernel'] }),
      feature({ id: 'k.pure', title: 'Kernel is pure Kotlin', area: 'Kernel', group: 'Kernel shape', tab: 'kernel', groupId: 'kernel-shape', tag: 'lock', kind: 'feature', status: 'built', priority: 'P1', wave: 1, effort: '', summary: '', model: 'opus', source: 'catalog', catalog: ['k.pure'], modules: ['axf-kernel'], tags: ['kernel', 'lock'], epic: 'x.kernel' }),
      feature({ id: 'c.designer', title: 'Designer view', area: 'Console', group: 'Views', tab: 'console', groupId: 'views', tag: 'feature', kind: 'feature', status: 'planned', priority: 'P3', wave: 3, effort: '', summary: '', model: 'opus', source: 'catalog', catalog: ['c.designer'], tags: ['console', 'feature'], epic: 'x.assets.designer' }),
      feature({ id: 'u.alerts', title: 'Alerts on the phone', area: 'Console', kind: 'feature', status: 'in-progress', priority: 'P2', wave: 2, effort: 'M', summary: 'ntfy', model: 'opus', source: 'user', edited: true }),
    ],
  },
  pending: {
    $axf: 'pending@1', updatedAt: '2026-10-27T10:00:00.000Z', artifact: 'https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye',
    items: [
      { id: 'asset-designer', title: 'Asset Designer plugin (no-code)', detail: 'Design every asset without code.', model: 'Fable', status: 'pending', notes: [{ text: 'Waits on Fable credits', at: '2026-10-20T00:00:00.000Z' }], subPrompts: [{ text: 'Designer core', at: '2026-10-20T00:00:00.000Z', estimate: '30 min' }, { text: 'Designer UI', at: '2026-10-20T00:00:00.000Z', estimate: '30 min' }], createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', planId: 'x.assets.designer', estimate: '1 h', source: 'plan' },
      { id: 'kernel-docs', title: 'Kernel docs', detail: 'Write the kernel docs.', model: 'Sonnet', status: 'complete', notes: [], subPrompts: [], createdAt: '2026-10-18T00:00:00.000Z', builtAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', planId: 'x.docs.missing', source: 'chat' },
      { id: 'patches-fix', title: 'Patches: fix the tab bar', detail: 'The tab bar overlaps the banner.', model: 'Opus', status: 'unsafe', notes: [], subPrompts: [{ text: 'Find the overlap', at: '2026-10-21T00:00:00.000Z', estimate: '20 min', done: true, doneAt: '2026-10-21T01:00:00.000Z' }], createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T01:00:00.000Z', source: 'console' },
      { id: 'kernel-rebuild', title: 'Kernel: Fable rebuild', detail: '', model: 'Fable', status: 'complete', notes: [], subPrompts: [], createdAt: '2026-10-16T00:00:00.000Z', builtAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z', planId: 'x.kernel', source: 'fable-rebuilds' },
    ],
  },
  queue: {
    $axf: 'build-queue@1', order: ['x.kernel', 'x.assets.designer'], dirty: false, updatedAt: '2026-10-26T00:00:00.000Z',
    steps: { 'x.kernel': { completedAt: '1970-01-01T00:00:00.000Z', completedBy: 'baseline', deps: [] }, 'x.assets.designer': { estimate: '1 h', steps: [{ text: 'Designer core', estimate: '30 min' }, { text: 'Designer UI', estimate: '30 min' }] } },
    history: [{ at: '2026-10-26T00:00:00.000Z', by: 'console:init', text: 'Build queue created from the plan' }],
  },
  orchestrator: {
    $axf: 'orchestrator@1', updatedAt: '2026-10-27T12:00:00.000Z', rules: { sameSession: true, subAgents: false, approveModelSwitch: true, maxStepMinutes: 30 },
    builds: [
      { id: 'patches-fix', title: 'Patches: fix the tab bar', category: 'Console UI', detail: 'The tab bar overlaps the banner (orchestrated).', status: 'running', hidden: false, source: 'chat', pendingId: 'patches-fix', branch: 'claude/patches-fix', pr: '', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T02:00:00.000Z', builtAt: '', notes: [{ text: 'Started', at: '2026-10-22T00:00:00.000Z' }], approvals: [],
        steps: [{ id: 's1', text: 'Find the overlap', model: 'Fable', why: 'layout engine', phase: 'Phase 1', group: 'Engine', estimate: '20 min', files: ['framework/core/engines/layout.ts'], checks: [], session: 'same', agent: false, done: true, doneAt: '2026-10-22T01:00:00.000Z', note: '' }, { id: 's2', text: 'Fix the CSS', model: 'Opus', why: 'console UI', phase: 'Phase 2', group: 'UI', estimate: '15 min', files: [], checks: ['npm run build'], session: 'same', agent: false, done: false, doneAt: '', note: '' }] },
      { id: 'old-build', title: 'An archived build', category: 'Archive', detail: 'Done long ago.', status: 'archived', hidden: true, source: 'console', pendingId: '', branch: '', pr: '#1', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', builtAt: '2026-10-11T00:00:00.000Z', notes: [], approvals: [{ phase: 1, from: 'Fable', to: 'Opus', at: '2026-10-10T12:00:00.000Z' }],
        steps: [{ id: 's1', text: 'Step one', model: 'Fable', why: '', phase: '', group: '', estimate: '10 min', files: [], checks: [], session: 'same', agent: false, done: true, doneAt: '2026-10-10T10:00:00.000Z', note: '' }, { id: 's2', text: 'Step two', model: 'Opus', why: '', phase: '', group: '', estimate: '10 min', files: [], checks: [], session: 'same', agent: false, done: true, doneAt: '2026-10-11T00:00:00.000Z', note: '' }] },
    ],
  },
  catalog: { frameworkVersion: '0.2.0', tabs: [{ id: 'kernel', label: 'Kernel', groups: [{ id: 'kernel-shape', label: 'Kernel shape', items: [{ id: 'k.pure', title: 'Kernel is pure Kotlin', tag: 'lock' }] }] }, { id: 'console', label: 'Console', groups: [{ id: 'views', label: 'Views', items: [{ id: 'c.designer', title: 'Designer view', tag: 'feature' }] }] }] },
};

/* ---- compute everything the fixture pins ---- */
export function compute() {
  const { plan, report } = B.migrate({ ...input, now: NOW });
  const pending = B.pendingState(plan), queue = B.queueState(plan), orchestrator = B.orchestratorState(plan);
  const tracker = B.trackerState(plan, input.catalog, NOW), status = B.statusMap(plan);
  const rows = Object.fromEntries(B.VIEWS.map((v) => [v, B.rows(plan, { view: v }).map((r) => ({ id: r.id, status: r.status, pendingStatus: r.pendingStatus, orchestratorStatus: r.orchestratorStatus, model: r.model, views: r.views, position: r.position, steps: `${r.done}/${r.total}`, minutesLeft: r.minutesLeft, phases: r.phases.map((p) => `${p.model}:${p.steps.length}${p.gate ? ':gate' : ''}`), deps: r.deps.map((d) => d.id), linked: r.linked.map((l) => l.id) }))]));
  // write-backs through the older cores
  const after = {};
  { const r = PC.apply(pending, { action: 'status', id: 'asset-designer', status: 'complete' }, T1); const p2 = B.pendingIntoPlan(plan, r.state, T1); after.pendingComplete = { planStatus: p2.features.find((f) => f.id === 'x.assets.designer').status, queueDone: QC.computeQueue(p2.features, B.queueState(p2)).steps.find((s) => s.id === 'x.assets.designer').state, orch: B.orchestratorState(p2).builds.length }; }
  { const r = PC.apply(pending, { action: 'add', title: 'Born on the list', model: 'Opus', source: 'chat', detail: 'new' }, T1); const p2 = B.pendingIntoPlan(plan, r.state, T1); const f = p2.features.find((x) => x.id === r.item.id); after.pendingAdd = { id: f.id, kind: f.kind, status: f.status, model: f.model, source: f.source, inViews: B.viewsOf(f, p2) }; const r3 = PC.apply(r.state, { action: 'remove', id: r.item.id }, T1); after.pendingRemove = { gone: !B.pendingIntoPlan(p2, r3.state, T1).features.some((x) => x.id === r.item.id) }; }
  { const q2 = QC.stepsAction(plan.features, queue, { id: 'x.assets.designer', index: 0, done: true }, T1); const p2 = B.queueIntoPlan(plan, q2, T1); after.queueTick = { pendingStepDone: B.pendingState(p2).items.find((i) => i.id === 'asset-designer').subPrompts[0].done === true, orchStepDone: false }; }
  { const o = J(orchestrator); const b = o.builds.find((x) => x.id === 'patches-fix'); b.steps[1].done = true; b.steps[1].doneAt = T1; b.status = 'complete'; b.builtAt = T1; const p2 = B.orchestratorIntoPlan(plan, o, T1); after.orchComplete = { planStatus: p2.features.find((f) => f.id === 'patches-fix').status, pendingStatus: B.pendingState(p2).items.find((i) => i.id === 'patches-fix').status, pendingDone: B.pendingState(p2).items.find((i) => i.id === 'patches-fix').subPrompts.map((s) => !!s.done) }; }
  { const o = J(orchestrator); o.builds.push({ id: 'fresh', title: 'Fresh from the orchestrator', category: 'Assets', status: 'pending', source: 'chat', steps: [{ id: 's1', text: 'Only step', model: 'Fable', estimate: '10 min' }] }); const p2 = B.orchestratorIntoPlan(plan, o, T1); const f = p2.features.find((x) => x.id === 'fresh'); after.orchAdd = { kind: f.kind, status: f.status, model: f.model, area: f.area, inViews: B.viewsOf(f, p2) }; }
  return { $axf: 'builds@1-fixture', now: NOW, report: { ...report, attached: report.attached.length, created: report.created.map((c) => c.id) }, plan, pending, queue, orchestrator, tracker, status, rows, after };
}

const got = compute();
if (process.argv.includes('--write')) { writeFileSync(FIX, `${JSON.stringify(got, null, 1)}\n`); console.log(`wrote ${FIX}`); process.exit(0); }
const want = JSON.parse(readFileSync(FIX, 'utf8'));

/* ---- invariants (hold whatever the fixture says) ---- */
const { plan } = B.migrate({ ...input, now: NOW });
t('plan is migrated and carries the file-level state', () => { assert.equal(B.isMigrated(plan), true); assert.deepEqual(plan.builds.queue.order, input.queue.order); assert.deepEqual(plan.builds.rules, input.orchestrator.rules); assert.equal(plan.builds.artifact, input.pending.artifact); assert.deepEqual(plan.statuses, B.PLAN_STATUSES); });
t('pending item attached by planId; dangling planId kept; unlinked item becomes a build feature', () => {
  assert.equal(plan.features.find((f) => f.id === 'x.assets.designer').build.parked.pendingId, 'asset-designer');
  const kd = plan.features.find((f) => f.id === 'kernel-docs'); assert.equal(kd.kind, 'build'); assert.equal(kd.build.parked.planId, 'x.docs.missing'); assert.equal(kd.status, 'built');
  assert.equal(plan.features.find((f) => f.id === 'patches-fix').status, 'in-progress', 'orchestrator running wins over pending unsafe');
});
t('queue record + pending steps with the same count are one list', () => { const f = plan.features.find((x) => x.id === 'x.assets.designer'); assert.equal(f.build.steps.length, 2); assert.equal(f.build.estimate, '1 h'); assert.equal(f.build.steps[0].at, '2026-10-20T00:00:00.000Z'); });
t('orchestrator build attached by pendingId keeps its richer steps and its status', () => { const f = plan.features.find((x) => x.id === 'patches-fix'); assert.equal(f.build.steps.length, 2); assert.equal(f.build.steps[0].model, 'fable'); assert.equal(f.build.orchestration.branch, 'claude/patches-fix'); assert.equal(f.build.orchestration.status, 'running'); });
t('archived orchestrator build → built + archived flag, hidden kept', () => { const f = plan.features.find((x) => x.id === 'old-build'); assert.equal(f.status, 'built'); assert.equal(f.build.archived, true); assert.equal(f.build.hidden, true); assert.equal(B.orchStatusOf(f), 'archived'); assert.equal(B.pendingStatusOf(f), 'complete'); });
t('every view round-trips losslessly', () => {
  for (const [state, into] of [[B.pendingState, B.pendingIntoPlan], [B.queueState, B.queueIntoPlan], [B.orchestratorState, B.orchestratorIntoPlan]]) {
    assert.deepEqual(J(state(into(plan, state(plan), T1))), J(state(plan)));
    assert.deepEqual(J(into(plan, state(plan), T1).features), J(plan.features), 'a write-back of an unchanged view changes nothing');
  }
});
t('the older cores accept the derived states unchanged', () => { assert.deepEqual(J(PC.normalizeState(B.pendingState(plan), NOW).items.map((i) => i.id)), ['x.kernel', 'x.assets.designer', 'kernel-docs', 'patches-fix'].map((id) => B.pendingItem(plan.features.find((f) => f.id === id)).id)); assert.equal(QC.computeQueue(plan.features, B.queueState(plan)).next, 'x.assets.designer'); });
t('normalizePlan on an unmigrated plan adds nothing but defaults', () => { const p = B.normalizePlan(input.plan); assert.equal(B.isMigrated(p), false); assert.equal(p.features.length, input.plan.features.length); assert.equal(p.features.some((f) => f.build), false); });
t('rows: queue view follows the queue order, phases gate on a model switch', () => { const r = B.rows(plan, { view: 'queue' }); assert.deepEqual(r.map((x) => x.id), input.queue.order); const pf = B.rows(plan, { view: 'orchestrator' }).find((x) => x.id === 'patches-fix'); assert.equal(pf.phases.length, 2); assert.equal(pf.phases[1].gate, true); assert.equal(pf.views.join(), 'plan,pending,orchestrator'); });
t('tracker export = catalog features only, with ids', () => { const tr = B.trackerState(plan, input.catalog, NOW); assert.deepEqual(tr.items.map((i) => i.id), ['k.pure', 'c.designer']); assert.equal(tr.items[0].group, 'kernel-shape'); assert.equal(tr.summary.kernel.coverage, 100); assert.deepEqual(Object.keys(B.statusMap(plan)), ['k.pure', 'c.designer']); });
t('fixture matches the reference core', () => assert.deepEqual(J(got), want));
console.log(`check-builds: ${n} checks passed (${want.plan.features.length} features, ${Object.keys(want.rows).length} views)`);
