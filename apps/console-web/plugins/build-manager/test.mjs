#!/usr/bin/env node
/**
 * Build manager — self-test of the merge, timing, totals, filters and live-link logic (web/merge.mjs), on fixtures and
 * on the repo's real pending list / build queue / plan. Run: node apps/console-web/plugins/build-manager/test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as m from './web/merge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const pc = await import(join(REPO, 'framework/plan/pending-core.mjs'));
const qc = await import(join(REPO, 'framework/plan/build-queue-core.mjs'));
const h = { estimateMinutes: pc.estimateMinutes, formatMinutes: pc.formatMinutes };
let n = 0;
const ok = (cond, label) => { if (!cond) { console.error(`  ✗ ${label}`); process.exit(1); } n++; console.log(`  ✓ ${label}`); };

/* ---------- timing ---------- */
const steps = (...xs) => xs.map(([text, estimate, done]) => ({ text, estimate: h.estimateMinutes(estimate ?? ''), estimateText: estimate ?? '', done: !!done, doneAt: '' }));
let t = m.timing('', steps(['a', '20 min', true], ['b', '25 min'], ['c', '15 min']), h);
ok(t.total === 60 && t.left === 40 && t.stepsDone === 1 && t.stepsTotal === 3 && !t.needsSplit, 'steps add up; done steps come off the time left');
t = m.timing('2 h', [], h);
ok(t.total === 120 && t.left === 120 && t.needsSplit, 'over 30 min with no steps → needs split');
t = m.timing('30 min', [], h);
ok(!t.needsSplit && t.left === 30, '30 min or less stays whole (no flag)');
t = m.timing('', [], h);
ok(t.total == null && t.left == null && !t.needsSplit, 'no estimate → null time left, not flagged');
t = m.timing('1 h', steps(['a', '', true], ['b', '']), h);
ok(t.total === 60 && t.left === 30, 'own estimate with unestimated steps: done steps count as equal shares');
t = m.timing('', steps(['a', '10 min', true], ['b', '10 min', true]), h);
ok(t.left === 0 && t.stepsDone === 2, 'all steps done → 0 left');

/* ---------- merge: no double counting ---------- */
const features = [
  { id: 'x.a', kind: 'epic', title: 'Epic A', status: 'planned', model: 'opus', catalog: ['f.cat'], history: [] },
  { id: 'x.b', kind: 'epic', title: 'Epic B', status: 'in-progress', model: 'fable', history: [{ at: '2026-10-21T10:00:00.000Z', text: 'Build started from the build queue (step 2)' }] },
  { id: 'x.c', kind: 'epic', title: 'Epic C', status: 'built', model: 'opus', history: [] },
  { id: 'f.in-epic', kind: 'feature', title: 'Inside A', status: 'planned', epic: 'x.a' },
  { id: 'f.cat', kind: 'feature', title: 'Listed by A', status: 'planned' },
  { id: 'f.loose', kind: 'feature', title: 'Loose feature', status: 'placeholder', model: 'sonnet', wave: 2, priority: 'P1' },
  { id: 'f.claimed', kind: 'feature', title: 'Claimed by pending', status: 'planned' },
  { id: 'f.built', kind: 'feature', title: 'Built', status: 'built' },
];
const queueState = { ...qc.emptyQueue(), steps: { 'x.a': { estimate: '1.5 h', steps: [{ text: 's1', estimate: '30 min', done: true, doneAt: '2026-10-21T09:00:00Z' }, { text: 's2', estimate: '30 min' }, { text: 's3', estimate: '30 min' }] } } };
const queue = qc.computeQueue(features, queueState);
const pending = [
  { id: 'p-open', title: 'Open item', model: 'Fable', status: 'pending', planId: 'x.b', createdAt: '2026-10-20T00:00:00Z', estimate: '2 h', subPrompts: [] },
  { id: 'p-steps', title: 'Stepped item', model: 'Opus', status: 'unsafe', createdAt: '2026-10-19T00:00:00Z', subPrompts: [{ text: 'one', at: '', estimate: '20 min', done: true }, { text: 'two', at: '', estimate: '25 min' }] },
  { id: 'p-claim', title: 'Claims a feature', model: 'Sonnet', status: 'pending', planId: 'f.claimed', createdAt: '2026-10-18T00:00:00Z', subPrompts: [] },
  { id: 'p-done', title: 'Done item', model: 'Opus', status: 'complete', createdAt: '2026-10-17T00:00:00Z', subPrompts: [] },
];
const rows = m.buildRows({ pending, queue, queueState, features }, h);
const keys = rows.map((r) => r.key);
ok(!keys.includes('pending:p-done'), 'complete pending items are not listed');
ok(keys.includes('pending:p-open') && !keys.includes('queue:x.b'), 'a pending item linked by planId replaces its queue step (no double count)');
ok(rows.find((r) => r.key === 'pending:p-open').queuePosition === queue.steps.find((s) => s.id === 'x.b').position, '…and keeps the queue position');
ok(keys.includes('queue:x.a') && !keys.includes('queue:x.c'), 'open queue steps listed, done steps not');
ok(!keys.includes('plan:f.in-epic') && !keys.includes('plan:f.cat') && !keys.includes('plan:x.a'), 'plan features inside an epic (epic or catalog) are not their own rows; epics only as queue steps');
ok(keys.includes('plan:f.loose') && !keys.includes('plan:f.built') && !keys.includes('plan:f.claimed'), 'loose unbuilt features are Plan rows; built and claimed ones are not');
ok(new Set(keys).size === keys.length, 'one row per build');
const qa = rows.find((r) => r.key === 'queue:x.a');
ok(qa.total === 90 && qa.left === 60 && qa.stepsDone === 1 && qa.stepsTotal === 3 && qa.model === 'Opus', 'queue StepRecord.estimate + steps are read (estimate minus done steps)');
const ps = rows.find((r) => r.key === 'pending:p-steps');
ok(ps.total === 45 && ps.left === 25 && ps.steps[0].done && ps.statusLabel === 'Unsafe', 'pending sub prompts with estimate/done are steps');
ok(rows.find((r) => r.key === 'pending:p-open').needsSplit, 'a 2 h pending item without steps needs split');
ok(rows.find((r) => r.key === 'plan:f.loose').left == null && rows.find((r) => r.key === 'plan:f.loose').model === 'Sonnet', 'plan feature without estimate → no estimate; model carried');
ok(rows.find((r) => r.key === 'pending:p-open').fable, 'Fable pending items are marked (Fable rebuilds)');

/* ---------- degrade gracefully: old data without the new fields ---------- */
const old = m.buildRows({ pending: [{ id: 'o', title: 'Old', model: 'Opus', status: 'pending', subPrompts: [{ text: 'x', at: '' }] }], queue: null, queueState: null, features: [] }, h);
ok(old.length === 1 && old[0].stepsTotal === 1 && old[0].stepsDone === 0 && old[0].left == null, 'pending without estimates/done still lists, as no estimate');
ok(m.buildRows({}, h).length === 0, 'no inputs → empty list');

/* ---------- totals, filters, sort ---------- */
const tot = m.totalsByModel(rows);
ok(tot.Opus.left === qa.left + ps.left && tot.Fable.left === 120 && tot.all.count === rows.length, 'time left totals per model');
ok(tot.all.noEstimate === rows.filter((r) => r.left == null).length && tot.all.needsSplit >= 1, 'totals count builds without estimate and needing split');
ok(m.filterRows(rows, { model: 'Fable' }).every((r) => r.model === 'Fable'), 'filter by model');
ok(m.filterRows(rows, { sources: ['plan'] }).every((r) => r.source === 'plan'), 'filter by source');
ok(m.filterRows(rows, { split: true }).every((r) => r.needsSplit), 'filter needs split');
ok(m.filterRows(rows, { status: 'unsafe' }).length === 1, 'filter by status');
const byLeft = m.sortRows(rows, 'left');
ok(byLeft.at(-1).left == null && byLeft[0].left <= byLeft[1].left, 'sort by time left: shortest first, no estimate last');
ok(m.sortRows(rows, 'model')[0].model === 'Fable', 'sort by model: Fable first');
ok(m.sortRows(rows, 'order')[0].source === 'pending', 'build order: pending, then queue order, then plan');

/* ---------- live tracker: linking and elapsed vs estimate ---------- */
const now = Date.parse('2026-10-21T12:00:00Z');
const act = [
  { id: 'gh:MossesX/AmberX-AXF:1', source: 'github', title: 'Rebuild shots · AmberX-AXF', detail: 'push on fable/p-open · #9', state: 'running', startedAt: now - 30 * 60_000 },
  { id: 'r:claude', source: 'reports', title: 'Claude Code: working on Stepped item', detail: 'building p-steps', state: 'running', startedAt: now - 5 * 60_000, steps: [{ name: 'Edit', state: 'running' }] },
  { id: 'gh:x:2', source: 'github', title: 'CI · axHub', detail: 'push on main', state: 'running', startedAt: now - 60_000 },
  { id: 'r:old', source: 'reports', title: 'harvest/f-loose done', state: 'done', startedAt: now - 9 * 60_000, finishedAt: now - 2_000 },
];
ok(m.linkRow(act[0], rows)?.row.key === 'pending:p-open', 'branch fable/<id> links a run to its build');
ok(m.linkRow(act[1], rows)?.row.key === 'pending:p-steps', 'a report naming the id links it');
ok(m.linkRow(act[2], rows) === null, 'unrelated runs stay unlinked');
ok(m.linkRow(act[3], rows)?.row.key === 'plan:f.loose', 'harvest/<plan id> links to the plan feature (dots ≈ dashes)');
ok(m.linkRow({ id: 'x', title: 'push on rebuild/theme-manager', state: 'running' }, [{ ...rows[0], key: 'pending:theme-manager-fable', id: 'theme-manager-fable', aliases: ['theme-manager-fable'] }])?.row.key === 'pending:theme-manager-fable', 'rebuild/<plugin> links to its <plugin>-fable item');
const live = m.liveEntries(act, rows, now);
const e0 = live.find((e) => e.id === 'act:gh:MossesX/AmberX-AXF:1');
ok(e0.elapsed === 30 * 60_000 && e0.estimate === 120 && Math.abs(e0.progress - 0.25) < 1e-9, 'elapsed vs estimate → progress');
const e1 = live.find((e) => e.id === 'act:r:claude');
ok(e1.currentStep === 'Edit' && e1.estimate === 25, 'current step from the run; estimate = time left');
ok(!live.some((e) => e.id === 'row:queue:x.b') && rows.find((r) => r.key === 'pending:p-open').building, 'x.b is claimed by p-open: the pending row carries its in-progress state, no separate queue row');
const live2 = m.liveEntries([], rows, now);
ok(live2.length === 1 && live2[0].row.key === 'pending:p-open', 'without activity, the build marked in progress still shows live');
const rowsB = m.buildRows({ pending: [], queue, queueState, features }, h);
const live3 = m.liveEntries([], rowsB, now);
ok(live3.length === 1 && live3[0].row.key === 'queue:x.b' && live3[0].elapsed === 2 * 3600_000, 'an epic marked in progress shows as live, elapsed since "Build started"');
ok(m.liveEntries([{ ...act[0], detail: 'push on fable/x-b' }], rowsB, now).filter((e) => e.row?.key === 'queue:x.b').length === 1, 'a linked run replaces the plain in-progress entry (no duplicate)');

/* ---------- step ticks: the routes the console really has (split-steps cores) ---------- */
const tp = m.tickRequest({ source: 'pending', id: 'asset-designer' }, 2, true);
ok(tp.path === 'pending' && tp.body.action === 'step' && tp.body.id === 'asset-designer' && tp.body.index === 2 && tp.body.done === true, 'pending tick → POST /api/pending {action:step, id, index, done}');
const tq = m.tickRequest({ source: 'queue', id: 'x.state' }, 0, false);
ok(tq.path === 'build-queue/steps' && tq.body.id === 'x.state' && tq.body.index === 0 && tq.body.done === false && !('action' in tq.body), 'queue tick → POST /api/build-queue/steps {id, index, done} (stepsAction shape)');
ok(m.tickRequest({ source: 'plan', id: 'f.x' }, 0, true) === null, 'plan features have nothing to tick');
const probe = m.probeTicks(pc, qc);
ok(probe.canTickPending && probe.canTickQueue, 'both shared cores tick steps (ticks on, not read-only)');
ok(!m.probeTicks({ apply() { throw new Error('unknown action'); } }, { emptyQueue: qc.emptyQueue, stepsAction() { throw new Error('nope'); } }).canTickQueue, 'an older core without the step actions → read-only');
{
  // the bodies the view sends really tick on the cores behind those routes
  const pst = pc.apply(pc.normalizeState({ $axf: 'pending@1', updatedAt: '', artifact: '', items: [{ id: 'p1', title: 'P', subPrompts: [{ text: 'a', at: '' }, { text: 'b', at: '' }] }] }), m.tickRequest({ source: 'pending', id: 'p1' }, 1, true).body);
  ok(pst.item.subPrompts[1].done === true && !pst.item.subPrompts[0].done, 'pending core applies the tick body');
  const feats = [{ id: 'x.e', title: 'E', kind: 'epic', status: 'planned' }];
  const q0 = { ...qc.emptyQueue(), steps: { 'x.e': { steps: [{ text: 'a' }, { text: 'b' }] } } };
  const q1 = qc.stepsAction(feats, q0, m.tickRequest({ source: 'queue', id: 'x.e' }, 0, true).body);
  ok(q1.steps['x.e'].steps[0].done === true && !q1.steps['x.e'].steps[1].done, 'build-queue core applies the tick body');
}

/* ---------- the real data ---------- */
const read = (f) => JSON.parse(readFileSync(join(REPO, 'framework/plan', f), 'utf8'));
const plan = read('plan.json'); const qs = read('build-queue.json'); const pend = pc.normalizeState(read('pending.json'));
const real = m.buildRows({ pending: pend.items, queue: qc.computeQueue(plan.features, qs), queueState: qs, features: plan.features }, h);
const rk = real.map((r) => r.key);
ok(real.length > 0 && new Set(rk).size === rk.length, `real data: ${real.length} builds, one row each`);
const claimedIds = new Set(pend.items.filter((i) => i.status !== 'complete' && i.planId).map((i) => i.planId));
ok(real.every((r) => !(r.source !== 'pending' && claimedIds.has(r.id))), 'real data: nothing listed twice through planId');
ok(real.filter((r) => r.source === 'pending').length === pend.items.filter((i) => i.status !== 'complete').length, 'real data: every open pending item listed');
const rt = m.totalsByModel(real);
ok(Number.isFinite(rt.all.left) && rt.Fable.count + rt.Opus.count + rt.Sonnet.count === rt.all.count, `real data totals: Fable ${pc.formatMinutes(rt.Fable.left)}, Opus ${pc.formatMinutes(rt.Opus.left) || '0'}, Sonnet ${pc.formatMinutes(rt.Sonnet.left) || '0'}`);
/* ---------- build log: Live + Built (history.mjs) ---------- */
const hs = await import('./web/history.mjs');
const iso = (t) => new Date(t).toISOString();
const sums = [
  { id: 'chg-20261021-aaaaaa0001', title: 'Running on the VPS', kind: 'build', model: 'claude-opus-5-5', state: 'running', status: 'running', createdAt: iso(now - 40 * 60_000), updatedAt: iso(now - 60_000),
    startedAt: iso(now - 40 * 60_000), lastSeenAt: iso(now - 60_000), estimate: { minutes: 80, costUsd: 11.2 }, surface: 'vps-claude-code', host: 'vps1', buildRef: { kind: 'pending', id: 'p-steps' },
    steps: { total: 4, done: 1, failed: 0, running: 'Server routes' }, doing: 'Editing server/__init__.py', areas: ['apps/console-web/plugins/x'], branch: 'feat/x', result: null, closed: null, repos: [], where: 'vps' },
  { id: 'chg-20261021-aaaaaa0002', title: 'Gone quiet', kind: 'build', model: 'fable', state: 'running', status: 'running', createdAt: iso(now - 3 * 3600_000), updatedAt: iso(now - 30 * 60_000),
    lastSeenAt: iso(now - 30 * 60_000), surface: 'claude-ai', steps: { total: 0, done: 0, failed: 0, running: '' }, result: null, closed: null, repos: [], where: '' },
  { id: 'chg-20261020-aaaaaa0003', title: 'Built with tokens', kind: 'build', model: 'opus', state: 'done', status: 'done', createdAt: iso(now - 26 * 3600_000), updatedAt: iso(now - 24 * 3600_000),
    startedAt: iso(now - 26 * 3600_000), finishedAt: iso(now - 24 * 3600_000), estimate: { minutes: 90, costUsd: 12.6 }, actual: { minutes: 120, costUsd: 9.87, inputTokens: 1000, outputTokens: 10, source: 'transcript' }, costEstimated: false,
    surface: 'vps-claude-code', branch: 'feat/y', commits: ['abc1234'], links: { pr: 'https://github.com/MossesX/AmberX-AXF/pull/1' }, steps: { total: 2, done: 2, failed: 0, running: '' }, result: { state: 'done', summary: 'ok' }, closed: null, repos: ['MossesX/AmberX-AXF'], where: 'vps' },
  { id: 'chg-20261015-aaaaaa0004', title: 'Backfilled kernel', kind: 'build', model: 'fable', state: 'done', status: 'done', createdAt: iso(now - 6 * 86400_000), updatedAt: iso(now - 6 * 86400_000),
    finishedAt: iso(now - 6 * 86400_000), estimate: { minutes: 480, costUsd: 132 }, costEstimated: true, surface: 'backfill', steps: { total: 0, done: 0, failed: 0, running: '' }, result: { state: 'done', summary: '' }, closed: 'x', repos: [], where: 'backfill' },
  { id: 'chg-20261021-aaaaaa0005', title: 'Just a question', kind: 'other', model: '', state: 'cancelled', createdAt: iso(now), updatedAt: iso(now), steps: { total: 0, done: 0, failed: 0, running: '' }, result: { state: 'cancelled', summary: 'no change' }, closed: null, repos: [], where: '' },
  { id: 'chg-20261021-aaaaaa0006', title: 'Failed build', kind: 'fix', model: 'sonnet', state: 'failed', createdAt: iso(now - 2 * 3600_000), updatedAt: iso(now - 3600_000), steps: { total: 0, done: 0, failed: 0, running: '' }, result: { state: 'failed', summary: 'x' }, closed: null, repos: [], where: '' },
];
const lv = hs.liveFromChanges(sums, rows, now);
ok(lv.length === 2 && lv.every((e) => e.changeId), 'Live: every running entry from any surface (VPS + claude.ai), nothing finished');
const v0 = lv.find((e) => e.changeId.endsWith('0001'));
ok(v0.row?.key === 'pending:p-steps' && v0.estimate === 80 && v0.elapsed === 40 * 60_000 && v0.costEstimate === 11.2 && v0.model === 'Opus' && v0.source === 'VPS' && v0.host === 'vps1', 'Live entry: linked by buildRef, elapsed vs estimate, cost, model, surface + host');
ok(v0.currentStep === 'Editing server/__init__.py' && v0.progress === 0.25 && !v0.stale, 'current activity + step progress');
ok(lv.find((e) => e.changeId.endsWith('0002')).stale && lv.find((e) => e.changeId.endsWith('0002')).activityState === 'stale', 'a session silent for 10+ min shows "no word" (stale), not running forever');
const bt = hs.builtRows(sums);
ok(bt.length === 3 && !bt.some((r) => r.title === 'Just a question') && bt[0].id.endsWith('0006'), 'Built: finished builds newest first; question-only entries left out');
const b3 = bt.find((r) => r.id.endsWith('0003'));
ok(b3.minutes === 120 && !b3.minutesEstimated && b3.cost === 9.87 && !b3.costEstimated && b3.commits[0] === 'abc1234' && b3.links.pr, 'actual time + cost win over the estimate; commits + links kept');
const b4 = bt.find((r) => r.id.endsWith('0004'));
ok(b4.minutes === 480 && b4.minutesEstimated && b4.cost === 132 && b4.costEstimated && b4.surface === 'backfill', 'backfill: estimated time + cost, flagged');
const tt = hs.builtTotals(bt);
ok(tt.all.count === 3 && Math.abs(tt.all.cost - 141.87) < 0.001 && tt.all.estimatedCost === 132 && tt.byModel.Fable.count === 1 && tt.byModel.Opus.cost === 9.87, 'totals overall + by model (estimated part counted)');
ok(Object.keys(tt.byWeek).length >= 1 && /^\d{4}-W\d{2}$/.test(Object.keys(tt.byWeek)[0]), 'totals by ISO week');
ok(hs.isoWeek(Date.parse('2026-10-21T12:00:00Z')) === '2026-W43' && hs.isoWeek(Date.parse('2026-01-01T12:00:00Z')) === '2026-W01', 'ISO weeks');
ok(hs.filterBuilt(bt, { model: 'Fable' }).length === 1 && hs.filterBuilt(bt, { cost: 'actual' }).length === 1 && hs.filterBuilt(bt, { period: '7d' }, now).length === 3 && hs.filterBuilt(bt, { period: '7d' }, now + 2 * 86400_000).length === 2, 'Built filters: model, actual/estimated cost, period');
ok(hs.matches('feat/y', b3) && hs.matches('OPUS built', b3) && !hs.matches('fable', b3) && hs.matches('', b3), 'search: every word, any field (branch, model, title), case-insensitive');
ok(hs.matches('p-steps', rows.find((r) => r.key === 'pending:p-steps')) && hs.matches('vps1', v0) && hs.matches('server routes', v0), 'search covers remaining rows (id) and live entries (host, step)');
ok(hs.money(9.876) === '$9.88' && hs.money(0.12) === '$0.120' && hs.money(132.4) === '$132' && hs.money(null) === '—', 'money format');

/* ---------- Start build now (orchestrate.mjs) ---------- */
const o = await import('./web/orchestrate.mjs');
const feats2 = [
  { id: 'x.base', kind: 'epic', title: 'Base', status: 'built' },
  { id: 'x.mod', kind: 'epic', title: 'Modules', status: 'planned', model: 'fable', dependsOn: ['x.base'], files: ['framework/core/modules'] },
  { id: 'x.plug', kind: 'epic', title: 'Plugins', status: 'planned', model: 'opus', dependsOn: ['x.mod'], files: ['apps/console-web/plugins'] },
  { id: 'x.design', kind: 'epic', title: 'Designer', status: 'planned', model: 'opus', dependsOn: ['x.plug'] },
  { id: 'x.loop1', kind: 'epic', title: 'Loop 1', status: 'planned', dependsOn: ['x.loop2'] },
  { id: 'x.loop2', kind: 'epic', title: 'Loop 2', status: 'planned', dependsOn: ['x.loop1'] },
  { id: 'x.free', kind: 'epic', title: 'Free', status: 'planned', model: 'sonnet', files: ['framework/libs/free'] },
];
const qs2 = { ...qc.emptyQueue(), order: ['x.base', 'x.free', 'x.design', 'x.loop1', 'x.loop2', 'x.plug', 'x.mod'], steps: {} };
const rows2 = m.buildRows({ pending: [{ id: 'designer', title: 'Designer (pending)', model: 'Fable', status: 'pending', planId: 'x.design', subPrompts: [], estimate: '2 h' }], queue: qc.computeQueue(feats2, qs2), queueState: qs2, features: feats2 }, h);
const byKey = (k) => rows2.find((r) => r.key === k);
const byId2 = new Map(feats2.map((f) => [f.id, f]));
const dc = o.dependencyClosure(['x.design'], byId2);
ok(dc.order.join() === 'x.mod,x.plug' && !dc.cycles.length, 'dependency closure: unbuilt deps, deepest first; built ones skipped');
ok(o.dependencyClosure(['x.loop1'], byId2).cycles.length === 1, 'a dependency cycle is broken and reported, never loops');
let sp = o.planStart({ row: byKey('pending:designer'), rows: rows2, features: feats2, queue: qs2, running: [], reportCmd: 'node changes.mjs' });
ok(sp.ok && sp.model === 'fable' && sp.branch === 'fable/designer', 'a Fable pending item stays Fable, on fable/<id>');
ok(sp.deps.map((d) => d.id).join() === 'x.mod,x.plug', 'its dependencies are listed in build order');
ok(sp.order && sp.order.indexOf('x.mod') < sp.order.indexOf('x.plug') && sp.order.indexOf('x.plug') < sp.order.indexOf('x.design') && sp.order[0] === 'x.base', 'the queue is reordered: deps right before it, built steps keep their place');
ok(/Dependencies \(built first/.test(sp.brief) && /Do not touch/.test(sp.brief) && /changes\.mjs update last --ref pending:designer --model fable/.test(sp.brief) && /Never merge/.test(sp.brief), 'the brief: deps, do-not-touch list, reporting commands, never merge');
sp = o.planStart({ row: byKey('queue:x.free'), rows: rows2, features: feats2, queue: qs2, running: [] });
ok(sp.ok && sp.model === 'sonnet' && sp.branch === 'build/x-free' && sp.order === null && sp.areas.includes('framework/libs/free'), 'no deps → no reorder; model + areas from the plan');
const runningE = (over) => ({ id: 'chg:x', changeId: 'chg-20261021-aaaaaa0009', title: 'Someone else', state: 'running', activityState: 'running', source: 'VPS', host: 'vps1', via: '', branch: '', areas: [], ...over });
sp = o.planStart({ row: byKey('queue:x.free'), rows: rows2, features: feats2, queue: qs2, running: [runningE({ via: 'queue:x.free' })] });
ok(!sp.ok && /Already being built/.test(sp.refuse), 'never starts a build that is already running (same buildRef)');
sp = o.planStart({ row: byKey('queue:x.free'), rows: rows2, features: feats2, queue: qs2, running: [runningE({ branch: 'build/x-free' })] });
ok(!sp.ok && sp.refuse, '…or one on its branch');
sp = o.planStart({ row: byKey('queue:x.free'), rows: rows2, features: feats2, queue: qs2, running: [runningE({ areas: ['framework/libs'] })] });
ok(!sp.ok && /Wait/.test(sp.wait) && sp.clashes[0].paths[0] === 'framework/libs/free', 'overlapping folders with a running build → wait, naming who and where');
sp = o.planStart({ row: byKey('queue:x.free'), rows: rows2, features: feats2, queue: qs2, running: [runningE({ areas: ['framework/libsx', 'apps/other'] })] });
ok(sp.ok && sp.dontTouch.includes('apps/other'), 'no overlap (libsx ≠ libs) → ok, and its folders go on the do-not-touch list');
sp = o.planStart({ row: byKey('pending:designer'), rows: rows2, features: feats2, queue: qs2, running: [runningE({ via: 'queue:x.mod' })] });
ok(!sp.ok && /dependency/.test(sp.wait), 'a dependency being built right now → wait for it');
sp = o.planStart({ row: byKey('queue:x.free'), rows: rows2, features: feats2, queue: qs2, running: [runningE({ areas: ['framework/libs'], activityState: 'stale' })] });
ok(!sp.ok, 'a stale ("no word") build still blocks its folders (safe side)');
ok(!o.planStart({ row: null }).ok, 'unknown build → refused');
ok(o.overlaps(['apps/a/b'], ['apps/a']).length === 1 && o.overlaps(['apps/ab'], ['apps/a']).length === 0 && o.overlaps(['framework/core/*.ts'], ['framework/core/x.ts']).length === 1, 'overlap = same folder or inside it (on / boundaries; * = anything)');
const vc = o.verifyChecks(['apps/console-web/plugins/build-manager', 'framework/core/x']).map((c) => c.name);
ok(vc.includes('build-manager self-test (py)') && vc.includes('console build (tsc + vite)') && vc.includes('theme check') && vc.includes('menu reach') && vc.includes('framework assets'), 'verify checks follow the touched areas (plugin self-tests, console build, theme, menu reach, framework assets)');
const cmd = o.launchCommand({ brief: "it's $(rm -rf /) `x`", branch: 'fable/designer', model: 'fable', changeId: 'chg-20261021-aaaaaa0009' });
ok(!cmd.includes('rm -rf /') && cmd.includes(Buffer.from("it's $(rm -rf /) `x`").toString('base64')) && cmd.includes("worktree add -q -B 'fable/designer'") && cmd.includes('AXF_ADOPT_CHANGE=chg-20261021-aaaaaa0009') && cmd.includes('--model fable') && !/push|merge/.test(cmd), 'launch command: brief base64 (no injection), own worktree + branch, adopts the entry, never pushes/merges');
ok(o.launchCommand({ brief: 'x', branch: '../../etc; rm', model: 'gpt', changeId: 'nope' }).includes("'build/unnamed'") && o.launchCommand({ brief: 'x', branch: 'a', model: 'gpt', changeId: 'nope' }).includes('--model opus') && !o.launchCommand({ brief: 'x', branch: 'a', model: 'opus', changeId: 'x; rm -rf' }).includes('x; rm'), 'bad branch / model / id never reach the shell');

console.log(`all ${n} checks passed`);
