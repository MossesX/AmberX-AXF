#!/usr/bin/env node
// build-plan@1 — every build has a plan that is a view of its record, and a stale file can't hurt a build.
//   node framework/spec/check-build-plans.mjs
// Includes the Nov 6 2026 regression: token-usage-log-accounts-plan-studio-control (archived item brought back, steps
// doubled from 55 to 110, then 19 ticks lost), replayed on scratch copies. The repo, the hub and the live store are never
// written: AXF_BUILDS_STORE, AXF_PLANS_DIR and AXF_DATA_DIR all point at a temp folder.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-build-plans-'));
process.env.AXF_BUILDS_STORE = join(tmp, 'store.json');
process.env.AXF_PLANS_DIR = join(tmp, 'plans');
process.env.AXF_DATA_DIR = 'off';
process.env.AXF_BUILD_PROFILE = 'current';
process.env.AXF_BUILD_PLANS = 'off'; // no background pushes: the checks call refresh themselves

const c = await import('../plan/builds-store-core.mjs');
const m = await import('../plan/builds-merge-core.mjs');
const og = await import('../core/build-origin.mjs');
const io = await import('../cli/builds-store.mjs');
const bp = await import('../cli/build-plan.mjs');
const orch = await import('../../apps/console-web/plugins/build-orchestrator/orchestrator.mjs');
const pc = await import('../../apps/console-web/plugins/plan-studio/web/plan-core.mjs');
const plans = await import('../../apps/console-web/plugins/plan-studio/plans.mjs');

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const at = '2026-11-06T14:00:00.000Z'; const later = '2026-11-06T20:00:00.000Z';
const steps = (k, f = () => ({})) => Array.from({ length: k }, (_, i) => ({ id: `s${i + 1}`, text: `Step ${i + 1}`, model: 'Opus', ...f(i) }));
const storeWith = (b) => c.normalizeStore({ $axf: 'builds@1', rev: 1, updatedAt: at, migratedAt: '2026-10-01T00:00:00.000Z', builds: [c.normBuild({ id: 'x', title: 'X', status: 'pending', createdAt: at, updatedAt: at, profiles: ['current'], order: { current: 0 }, ...b }, { now: at })] });
const rec = (s) => s.builds.find((b) => b.id === 'x');
const itemFrom = (s, patch = {}) => ({ ...c.itemOfBuild(rec(s), at), ...patch, updatedAt: later });

// ------------------------------------------------------------------ a foreign file never moves a build back
await t('an archived item stays archived when a stale pending file says complete or pending', () => {
  const s = storeWith({ status: 'archived', steps: steps(2) });
  for (const status of ['pending', 'complete']) {
    const out = c.absorbPending(s, 'current', { items: [itemFrom(s, { status })] }, null, { now: later, newerOnly: true });
    assert.equal(rec(out).status, 'archived');
  }
});
await t('a running build keeps running; a stale file can still move one forward', () => {
  const s = storeWith({ status: 'running', steps: steps(2, (i) => ({ done: i === 0 })) });
  assert.equal(rec(c.absorbPending(s, 'current', { items: [itemFrom(s, { status: 'pending', title: 'Newer title' })] }, null, { now: later, newerOnly: true })).status, 'running');
  assert.equal(rec(c.absorbPending(s, 'current', { items: [itemFrom(s, { status: 'complete' })] }, null, { now: later, newerOnly: true })).status, 'complete');
});
await t('a stale pending file drops no step and takes no tick back', () => {
  const s = storeWith({ status: 'running', steps: steps(3, (i) => ({ done: i === 0, doneAt: at })) });
  const it = itemFrom(s); it.subPrompts = it.subPrompts.slice(0, 2).map((p) => { const { done, doneAt, ...x } = p; return x; }); // older: 2 steps, no ticks
  const r = rec(c.absorbPending(s, 'current', { items: [it] }, null, { now: later, newerOnly: true }));
  assert.equal(r.steps.length, 3); assert.equal(r.steps[0].done, true); assert.equal(r.removedSteps.length, 0);
});
await t('a stale orchestrator export does the same', () => {
  const s = storeWith({ status: 'built', steps: steps(3, () => ({ done: true, doneAt: at })) });
  const doc = c.projectOrchestrator(s, 'current');
  doc.builds[0] = { ...doc.builds[0], status: 'running', updatedAt: later, steps: doc.builds[0].steps.slice(0, 2).map((x) => ({ ...x, done: false })) };
  const r = rec(c.absorbOrchestrator(s, 'current', doc, { now: later, newerOnly: true, by: 'foreign-write' }));
  assert.equal(r.status, 'built'); assert.equal(r.steps.length, 3); assert.ok(r.steps.every((x) => x.done));
});
await t('a new step in a foreign file still comes in, and a step added on the Pending list by hand too', () => {
  const s = storeWith({ status: 'running', steps: steps(2) });
  const it = itemFrom(s); it.subPrompts = [...it.subPrompts, { text: 'Added later' }];
  assert.equal(rec(c.absorbPending(s, 'current', { items: [it] }, null, { now: later, newerOnly: true })).steps.length, 3);
  assert.equal(rec(c.absorbPending(s, 'current', { items: [it] }, null, { now: later })).steps.length, 3);
});
await t('a direct Pending change still moves status and removes steps (only foreign files are limited)', () => {
  const s = storeWith({ status: 'complete', builtAt: at, steps: steps(2, () => ({ done: true, doneAt: at })) });
  const it = itemFrom(s, { status: 'pending' }); it.subPrompts = it.subPrompts.slice(0, 1).map(({ done, doneAt, ...x }) => x);
  const r = rec(c.absorbPending(s, 'current', { items: [it] }, null, { now: later }));
  assert.equal(r.status, 'running'); assert.equal(r.steps.length, 1); assert.equal(r.steps[0].done, false);
});
await t('two checkouts taking the same item in make the same steps (seeded uids)', () => {
  const empty = c.normalizeStore({ $axf: 'builds@1', rev: 1, updatedAt: at, migratedAt: '2026-10-01T00:00:00.000Z', builds: [] });
  const it = { id: 'y', title: 'Y', status: 'pending', subPrompts: [{ text: 'A' }, { text: 'B' }], updatedAt: later };
  const uids = () => c.absorbPending(empty, 'current', { items: [it] }, null, { now: later, newerOnly: true }).builds[0].steps.map((x) => x.uid);
  assert.deepEqual(uids(), uids());
});

// ------------------------------------------------------------------ merging two copies of a build
await t('the regression: one build under two sets of uids merges to 55 steps with every tick kept', () => {
  const a = c.normBuild({ id: 'x', title: 'X', status: 'running', updatedAt: at, steps: steps(55, (i) => ({ done: i < 19, doneAt: at })) }, { now: at });
  const b = c.normBuild({ id: 'x', title: 'X', status: 'pending', updatedAt: later, steps: steps(55) }, { now: later }); // same words, new uids
  assert.notEqual(a.steps[0].uid, b.steps[0].uid);
  for (const [x, y] of [[a, b], [b, a]]) {
    const out = m.mergeBuild(x, y);
    assert.equal(out.steps.length, 55); assert.equal(out.steps.filter((s) => s.done).length, 19);
    assert.equal(new Set(out.steps.map((s) => s.id)).size, 55);
  }
});
await t('a step only the older copy has stays unless the newer copy removed it', () => {
  const older = c.normBuild({ id: 'x', title: 'X', updatedAt: at, steps: steps(2) }, { now: at });
  const newer = JSON.parse(JSON.stringify(older)); newer.updatedAt = later;
  const extra = c.normStep({ id: 's3', text: 'Added on the other copy', createdAt: at }, 2, { now: at });
  const withExtra = { ...older, steps: [...older.steps, extra] };
  assert.equal(m.mergeBuild(newer, withExtra).steps.length, 3);
  assert.equal(m.mergeBuild({ ...newer, removedSteps: [{ step: extra, at: later, why: 'gone', by: 't' }] }, withExtra).steps.length, 2);
});

// ------------------------------------------------------------------ an addendum as a check-off item
const BRIEF = `# Build: launched-bare

## Brett said (verbatim)
"Make the thing."

1. First job
2. Second job

## Addendum 1 (Brett, voice)
"Also do the other thing."
- Claude does part one
- Claude does part two
`;
await t('a quoted addendum with a list reads as his words + summary + sub-steps; a plain one stays his words', () => {
  const p = og.parseBrief(BRIEF);
  assert.equal(p.addenda[0].said, 'Also do the other thing.'); assert.deepEqual(p.addenda[0].steps, ['Claude does part one', 'Claude does part two']);
  assert.ok(p.addenda[0].summary.includes('part two'));
  assert.equal(og.parseBrief('## Addendum 1\nno quote\n- a list of his\n').addenda[0].said, 'no quote\n- a list of his');
});
await t('check-off item + sub-steps: ids stay unique after steps are added, the item follows its sub-steps', () => {
  const s = [{ id: 's1', model: 'Fable' }, { id: 's56-55', model: 'Opus' }];
  const made = og.checkoffSteps(s, 2, { said: 'Do it. And more.', steps: ['a', 'b'] }, {});
  assert.deepEqual(made.map((x) => x.id), ['s57', 's57-1', 's57-2']); assert.equal(made[0].addendum, 2); assert.equal(made[1].parent, 's57'); assert.equal(made[0].model, 'Opus');
  assert.ok(made[0].text.startsWith('Addendum 2: Do it.'));
  og.tickParents(made, at); assert.equal(made[0].done, false);
  made[1].done = true; made[2].skip = true; og.tickParents(made, at); assert.equal(made[0].done, true);
  made[1].done = false; og.tickParents(made, at); assert.equal(made[0].done, false);
});

// ------------------------------------------------------------------ the plan is a view of the build
const build = () => c.normBuild({ id: 'buildy', title: 'Buildy', detail: 'What it does', status: 'running', branch: 'claude/buildy', pr: '#12', profiles: ['current'], updatedAt: at,
  origin: { said: 'Make it', at, source: 'voice', verbatim: true, brief: 'the brief', addenda: [{ said: 'And this', at, summary: 'Will do this', step: 's3' }] },
  steps: [{ id: 's1', text: 'One', done: true, doneAt: at, estimate: '10 min' }, { id: 's2', text: 'Two', skip: true }, { id: 's3', text: 'Addendum 1: Will do this', addendum: 1 }, { id: 's3-1', text: 'Sub', parent: 's3' }] }, { now: at });
await t('planFromBuild: ids, ticks, links, stage, words; the same input gives no change', () => {
  const p = pc.planFromBuild(build(), { now: at });
  assert.deepEqual(p.steps.map((s) => s.id), ['buildy-1', 'buildy-2', 'buildy-3', 'buildy-3-1']);
  assert.equal(p.steps[0].done, true); assert.equal(p.steps[3].parent, 'buildy-3'); assert.equal(p.steps[3].phase, 'Addendum 1'); assert.equal(p.steps[0].minutes, 10);
  assert.equal(p.managed, 'build'); assert.equal(p.build.stage, 'running'); assert.equal(p.status, 'building'); assert.equal(p.origin.said, 'Make it');
  assert.equal(p.addenda[0].step, 'buildy-3'); assert.ok(p.body.includes('> Make it')); assert.ok(p.body.includes('**What Claude will do:** Will do this')); assert.ok(p.body.includes('`buildy-3-1`'));
  assert.deepEqual(p.links.map((l) => l.kind), ['build', 'related', 'branch', 'pr']); assert.equal(p.links[1].ref, 'pending:buildy');
  assert.equal(pc.validate(p).length, 0);
  assert.equal(pc.planMoved(p, pc.planFromBuild(build(), { plan: p, now: later })), false);
});
await t('status mirrors the build: running, built, merge queue, merged, archived', () => {
  const stage = (b, q) => pc.stageOf({ steps: [], ...b }, { queued: q });
  assert.deepEqual([stage({ status: 'running' }), stage({ status: 'built' }), stage({ status: 'built' }, true), stage({ status: 'complete' }), stage({ status: 'archived' }), stage({ status: 'pending' }), stage({ status: 'pending', steps: [{ done: true }] })],
    ['running', 'built', 'merge-queue', 'merged', 'archived', 'planned', 'paused']);
  const p = (status) => pc.planFromBuild({ ...build(), status }, { now: at }).status;
  assert.deepEqual([p('built'), p('complete'), p('archived')], ['building', 'done', 'dropped']);
});
await t('what Brett added to a plan stays: his text, comments and his own steps', () => {
  const first = pc.planFromBuild(build(), { now: at });
  const edited = { ...first, body: `My note\n\n${first.body}`, comments: [{ id: 'c', text: 'hi', at }], steps: [...first.steps, { id: 'mine', text: 'My own step', model: 'Opus', minutes: 0, dependsOn: [], done: false, doneAt: '', phase: '' }] };
  const b2 = build(); b2.steps[1].done = true; b2.steps[1].doneAt = at;
  const next = pc.planFromBuild(b2, { plan: edited, now: later });
  assert.ok(next.body.startsWith('My note')); assert.equal(next.comments.length, 1); assert.ok(next.steps.some((s) => s.id === 'mine')); assert.equal(next.steps.filter((s) => s.id === 'buildy-2').length, 1); assert.equal(next.steps[1].done, true);
  assert.equal(next.body.split(pc.BLOCK_START).length, 2);
});
await t('a store step undone is undone on the plan (the store wins)', () => {
  const first = pc.planFromBuild(build(), { now: at }); const b2 = build(); b2.steps[0].done = false;
  assert.equal(pc.planFromBuild(b2, { plan: first, now: later }).steps[0].done, false);
});
await t('syncBuild on a hand-made plan: a parked plan stays parked, steps added on the build show up, plan-only steps stay', () => {
  const plan = pc.normalize({ id: 'p', title: 'P', status: 'parked', steps: [{ text: 'A' }, { text: 'Mine only' }], build: { profile: 'current', id: 'x' } });
  const idle = pc.syncBuild(plan, { status: 'pending', steps: [{ id: 's1', text: 'A' }, { id: 's2', text: 'Added on the build' }] });
  assert.equal(idle.plan.status, 'parked'); assert.deepEqual(idle.plan.steps.map((s) => s.text), ['A', 'Mine only', 'Added on the build']);
  assert.equal(pc.syncBuild(plan, { status: 'running', steps: [{ text: 'A' }] }).plan.status, 'building');
  assert.equal(pc.syncBuild(plan, { status: 'built', steps: [{ text: 'A', done: true }], pr: '#1' }).plan.status, 'building'); // not done until it is merged
  assert.equal(pc.syncBuild(plan, { status: 'complete', steps: [{ text: 'A', done: true }] }).plan.status, 'done');
  assert.equal(pc.syncBuild(plan, { status: 'archived', steps: [{ text: 'A' }] }).plan.status, 'dropped');
});

// ------------------------------------------------------------------ end to end on a scratch store
await t('the launcher hook: a brief with no record gets a record, his words, its addendum and a plan', async () => {
  const r = await bp.ensure({ name: 'launched-bare', briefText: BRIEF, by: 'test' });
  assert.equal(r.plan.id, 'launched-bare');
  const b = c.findBuild(io.loadStore(), 'launched-bare');
  assert.deepEqual(b.steps.map((s) => s.id), ['s1', 's2', 's3', 's3-1', 's3-2']); assert.ok(b.origin.said.includes('Make the thing.')); assert.equal(b.title, 'Make the thing.'); assert.equal(b.origin.addenda[0].step, 's3'); assert.equal(b.planRef, 'launched-bare');
  assert.deepEqual(r.plan.steps.filter((s) => s.parent).map((s) => s.id), ['launched-bare-3-1', 'launched-bare-3-2']);
  await bp.ensure({ name: 'launched-bare', briefText: BRIEF, by: 'test' }); // launched again: no second addendum, no doubled steps
  assert.equal(c.findBuild(io.loadStore(), 'launched-bare').steps.length, 5);
  assert.equal((await bp.ensure({ name: 'no-such', briefText: '# Job: site-check\nHello\n' })).skipped, 'not a build');
});
await t('the orchestrator ticks: sub-steps tick the item, the plan follows, Plan Studio ticks go through the store', async () => {
  await bp.tick('launched-bare', 's3-1'); orch.act({ action: 'step', id: 'launched-bare', step: 's3-2', done: true });
  assert.equal(c.findBuild(io.loadStore(), 'launched-bare').steps.find((s) => s.id === 's3').done, true);
  await bp.refresh('launched-bare');
  const p = plans.getPlan('launched-bare');
  assert.deepEqual(p.steps.filter((s) => s.done).map((s) => s.id), ['launched-bare-3', 'launched-bare-3-1', 'launched-bare-3-2']);
  assert.ok(plans.history('launched-bare').versions.some((v) => v.kind === 'build'));
});
await t('orchestrator action addendum adds said + summary + sub-steps, in the plan after a refresh', async () => {
  orch.act({ action: 'addendum', id: 'launched-bare', said: 'One more', summary: 'Will do one more', steps: ['Only part'] });
  await bp.refresh('launched-bare');
  const p = plans.getPlan('launched-bare');
  assert.equal(p.addenda.length, 2); assert.equal(p.addenda[1].summary, 'Will do one more'); assert.ok(p.steps.some((s) => s.id === 'launched-bare-4-1'));
});
await t('refresh never makes a plan; a plan deleted on purpose stays gone', async () => {
  orch.act({ action: 'add', id: 'quiet', title: 'Quiet', steps: [{ text: 'A' }] });
  assert.equal((await bp.refresh('quiet')).plan, undefined); assert.equal(plans.getPlan('quiet'), null);
  plans.planForBuild('quiet'); plans.deletePlan('quiet');
  assert.equal(plans.planForBuild('quiet').plan, undefined);
});
await t('Turn into a build writes the store under its lock, never an export', () => {
  const saved = plans.savePlan(pc.normalize({ id: 'from-plan', title: 'From a plan', status: 'parked', steps: [{ text: 'Go', model: 'Opus' }] }), { by: 't', force: true });
  assert.ok(saved.ok);
  const r = plans.turnIntoBuild('from-plan', { profile: 'current', by: 't' });
  const b = c.findBuild(io.loadStore(), r.build.id);
  assert.equal(b.source, 'plan-studio'); assert.equal(b.planRef, 'from-plan'); assert.equal(b.steps.length, 1);
  assert.throws(() => plans.turnIntoBuild('from-plan', { profile: 'current', buildId: r.build.id }), /already/);
  assert.ok(existsSync(process.env.AXF_BUILDS_STORE)); assert.ok(JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')).builds.length >= 3);
});
writeFileSync(join(tmp, 'done'), '');
console.log(`build-plans: ${n} checks passed`);
