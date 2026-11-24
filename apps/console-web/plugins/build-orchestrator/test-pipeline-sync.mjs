#!/usr/bin/env node
/**
 * Pipeline sync, end to end on a scratch builds store and a scratch plan tree (the repo, the hub and the live store
 * are never touched): a plan sent from Plan Studio 2.0 is followed from pending to landed, and at every state the
 * builds store, the orchestrator's read (GET /table) and Plan Studio 2.0's read are checked against the contracts of
 * build pipeline-sync-live-badges (Brett, Nov 23 2026: "follow a build from split all the way to complete ... very
 * small, but at least five steps").
 *
 *   node apps/console-web/plugins/build-orchestrator/test-pipeline-sync.mjs [--json]
 *
 * The contracts (pipeline-status@1):
 *   build   number · pipelineView { state, label, tone, icon, line, attempt, waitingOn, mergeLine { position,
 *           waitingFor } } (worked out by the store on read, never stored) · split { by, model, at, stepCount }
 *   step    uid · splitBy · model · modelBy · status
 *   states  pending, splitting, split, pulling-main, assigning-models, ready, sending, building, build-complete,
 *           failed (attempt N), then the lander's: waiting-to-merge, merging, running-ci, landed
 *
 * The build was made in four parts that land together. Any part that is not on this checkout is SKIPPED with a line
 * saying which part is missing and what was checked instead; a skip never fails the run. With every part merged the
 * run has no skips. Exit 1 on any failed check.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const dir = mkdtempSync(join(tmpdir(), 'axf-psync-'));
Object.assign(process.env, {
  AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_PLAN_TREE_DIR: join(dir, 'tree'), AXF_DATA_DIR: 'off',
  AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_SHIPPED: 'off', AXF_PLAN_BUILDS_TTL: '0',
  AXF_CREW_SAY: 'off', AXF_PIPELINE_CONSOLE: 'off', AXF_PIPELINE_DIR: join(dir, 'pipe'), AXF_DISPATCH_DIR: join(dir, 'pipe'),
});
const JSON_OUT = process.argv.includes('--json');

const BS = await import('../../../../framework/cli/builds-store.mjs');
const core = await import('../../../../framework/plan/builds-store-core.mjs');
const P2 = await import('../../../../framework/core/pipeline-status.mjs');
const T = await import('./web/status-table-core.mjs');
const V = await import('./web/pipeline-view-core.mjs');
const table = (await import('./status-table.mjs')).table;
const PS = await import('../plan-studio-2/tree.mjs').catch(() => null);

let passed = 0; const failures = []; const skips = [];
const say = (l) => { if (!JSON_OUT) console.log(l); };
const ok = (c, what) => { if (c) { passed += 1; say(`  ✓ ${what}`); } else { failures.push(what); if (!JSON_OUT) console.error(`  ✗ ${what}`); } return !!c; };
const eq = (a, b, what) => { const same = JSON.stringify(a) === JSON.stringify(b); return ok(same, same ? what : `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const skip = (part, why) => { skips.push({ part, why }); say(`  ~ SKIPPED (${part}): ${why}`); };
const section = (t) => say(`\n${t}`);

const get = (id) => BS.loadStore().builds.find((b) => b.id === id);
const row = (id) => table({ landed: true }).rows.find((r) => r.id === id);
const move = (id, to, o = {}) => BS.setFlowStatus(id, to, { by: 'vps', ...o });
const has = (list, s) => Array.isArray(list) && list.includes(s);

/* ------------------------------------------------------------------ 1. the screen's rules (pure, always run) */
section('1. The orchestrator screen: a badge, a line and the contract fields for every state');
{
  eq(V.PIPELINE_STATES, ['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'failed', 'waiting-to-merge', 'merging', 'running-ci', 'landed'], 'the 14 states, the lander\'s four last');
  for (const state of V.PIPELINE_STATES) {
    const v = V.viewOf({ id: 'x', status: state, attempt: 2, flow: 'pipeline-2' });
    ok(v.state === state && v.label && v.line && V.TONES.includes(v.tone) && v.icon, `${state}: badge "${v.label}" (${v.tone}), line "${v.line}"`);
  }
  eq(V.viewOf({ status: 'failed', attempt: 2 }).label, 'Failed (attempt 2)', 'failed carries its attempt');
  eq(['merging-pr', 'pr-pulling-main', 'merging-main'].map((s) => V.viewOf({ status: s }).state), ['merging', 'merging', 'merging'], 'the older landing statuses read as Merging, each with its own line');
  eq(V.viewOf({ status: 'made-up' }).label, 'made-up', 'an unknown state shows as itself and never throws');
  const fromStore = V.viewOf({ status: 'building', pipelineView: { state: 'running-ci', label: 'Running CI', tone: 'warning', icon: 'refresh', line: 'CI is on run 12.', attempt: 0, waitingOn: null } });
  eq([fromStore.state, fromStore.line, fromStore.fromStore], ['running-ci', 'CI is on run 12.', true], 'the store\'s pipelineView wins over the fallback');

  const active = { id: 'holder', number: 'B-0007', title: 'The holder', flow: 'pipeline-2', status: 'building' };
  const hand = { id: 'by-hand', title: 'A hand build', flow: 'pipeline-2', status: 'building', hand: { at: '2026-11-24T00:00:00Z', by: 'brett' } };
  const waiter = { id: 'waiter', title: 'The waiter', flow: 'pipeline-2', status: 'split', steps: [{ id: 's1' }, { id: 's2' }] };
  const w = V.viewOf(waiter, [hand, waiter, active]).waitingOn;
  eq([w?.buildId, w?.number, w?.reason], ['holder', 'B-0007', 'Waiting: The holder holds the active place'], 'a build waiting at split names the build holding the active place (a hand build never holds it)');
  eq(V.viewOf(waiter, [hand, waiter]).waitingOn, null, 'nothing holds the place: no waiting reason');
  const sw = V.viewOf({ ...waiter, pipelineView: { state: 'split', waitingOn: { buildId: 'holder', title: 'The holder', reason: 'Waiting: The holder holds the active place' } } }, [active]).waitingOn;
  eq([sw?.buildId, sw?.number], ['holder', 'B-0007'], 'the store\'s waitingOn is linked to the holder\'s row and build number');

  eq(V.normMergeLine({ position: 2, waitingFor: 'holder' }, [active]).text, '2nd to merge, waiting for B-0007', 'the merge line names the build ahead by its number (waitingFor = a build id)');
  eq(V.normMergeLine({ position: 3, waitingFor: 'B-0007' }, [active]).waitingFor, 'holder', '… and links to its row when waitingFor is a build number');
  eq(V.normMergeLine({ position: 1, waitingFor: '' }, []).text, '1st to merge', 'first in line waits for nobody');
  eq([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(V.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd'], 'ordinals');

  const r = T.buildRow({ id: 'b1', number: 'B-0042', title: 'A build', flow: 'pipeline-2', status: 'waiting-to-merge', split: { by: 'vps', model: 'claude-fable-5-2', at: '2026-11-24T00:00:00Z', stepCount: 2 },
    pipelineView: { state: 'waiting-to-merge', label: 'Waiting to merge', tone: 'warning', line: 'Built and waiting its turn.', mergeLine: { position: 2, waitingFor: 'holder' } },
    steps: [{ id: 's1', uid: 'st-aaa', text: 'One', model: 'Fable', modelBy: 'triage', splitBy: 'vps-fable', status: 'completed' }, { id: 's2', uid: 'st-bbb', text: 'Two', status: 'pending' }] }, [active]);
  eq([r.number, r.view.label, r.view.mergeLine.text, r.splitLabel], ['B-0042', 'Waiting to merge', '2nd to merge, waiting for B-0007', 'Split by Fable on the VPS'], 'a row carries the build number, the badge, the merge line and the split badge');
  eq(r.steps.map((s) => [s.uid, s.model, s.modelBy, s.split]), [['st-aaa', 'Fable', 'triage', 'Split by Fable on the VPS'], ['st-bbb', '', '', 'Split by Fable on the VPS']], 'each step carries its unique id, the triage model and the split badge (a step with no model yet shows none)');
  eq(V.waitingToMerge([r, T.buildRow({ id: 'b2', status: 'building' })]).map((x) => x.id), ['b1'], '"Merge together" takes the builds waiting in the merge line');
  eq(T.buildRow({ id: 'old', status: 'building' }).number, '', 'a build without a number shows none (never an invented one)');
  const old = T.ensureViews([{ id: 'o1', title: 'Old server row', status: 'failed', attempt: 3, steps: [{ id: 's1', title: 'One', status: 'failed' }] }])[0];
  eq([old.view.label, old.number, old.steps[0].uid, old.splitLabel], ['Failed (attempt 3)', '', '', ''], 'a row from a server older than the screen still gets its badge (and draws without a number or step id)');
  eq(T.filterRows([r], { text: 'b-0042', status: [r.status] }).length, 1, 'Find matches the build number');
}

/* ------------------------------------------------------------------ 2. Plan Studio 2.0 sends a plan */
section('2. A plan with five trivial steps is sent from Plan Studio 2.0');
let build = ''; let planId = '';
if (PS?.api) {
  const api = (r) => PS.api(r, { by: 'test' });
  const plan = api({ op: 'add', kind: 'plan', title: 'Sync walk' }).item;
  planId = plan.id;
  for (let i = 1; i <= 5; i += 1) api({ op: 'add', kind: 'step', title: `Add a line to docs/sync-walk-${i}.md`, parent: plan.id });
  build = api({ op: 'build', id: plan.id }).build.id;
  const b = get(build);
  ok(b && b.status === 'pending' && b.planRef === planId, `the plan is one build in the builds store (${build}), linked to its plan`);
  ok(row(build)?.view.label && row(build)?.view.line, `pending: badge "${row(build)?.view.label}", line "${row(build)?.view.line}"`);
} else {
  skip('Plan Studio 2.0', 'the plan-studio-2 plugin is not on this checkout: the build is seeded straight into the store');
  build = 'sync-walk';
  BS.withStore((s) => { s.builds.push(core.normBuild(P2.transition({ id: build, title: 'Sync walk', flow: P2.FLOW, source: 'plan-studio-2', planRef: 'sync-walk-plan', steps: [] }, 'pending', { by: 'test' }).rec)); return s; }, { by: 'test' });
  ok(get(build)?.status === 'pending', 'the build is in the scratch store at pending');
}

/* ------------------------------------------------------------------ 3. the walk */
section('3. The build walks every state; at each one the store read gives a badge and a line');
const STEPS = [1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, text: `Add a line to docs/sync-walk-${i}.md`, model: i === 1 ? 'Fable' : 'Opus', estimate: '2 min', files: [`docs/sync-walk-${i}.md`] }));
const splitAt = new Date().toISOString();
/** The VPS split: its own steps filed in the store with the split provenance (pipeline-status@1). */
const vpsSplit = (id, steps) => {
  move(id, 'splitting');
  move(id, 'split', { mutate: (rec) => {
    rec.split = { by: 'vps', model: 'Fable', at: splitAt, stepCount: steps.length };
    rec.steps = steps.map((s, i) => core.normStep({ ...P2.transition(s, 'pending', { at: splitAt, by: 'vps', kind: 'step' }).rec, splitBy: 'vps-fable', modelBy: 'triage' }, i));
  } });
};
let storeViews = 0;
/** At one state: the store record, the orchestrator's row and (when the store computes it) the store's own view. */
const check = (id, state, { status = state, attempt = 0 } = {}) => {
  const b = get(id); const r = row(id);
  if (!ok(b?.status === status, `${state}: the store holds ${status}${b?.status === status ? '' : ` (it holds ${b?.status})`}`)) return;
  const want = attempt ? `Failed (attempt ${attempt})` : null;
  ok(r?.view.label && r.view.line && (!want || r.view.label === want) && (r.view.fromStore || r.view.state === state), `${state}: the orchestrator shows "${r?.view.label}": ${r?.view.line}`);
  if (b.pipelineView) {
    storeViews += 1;
    ok(b.pipelineView.label && b.pipelineView.line && (b.pipelineView.state === state || status !== state), `${state}: the store's pipelineView has state, label and line`);
    if (attempt) eq(b.pipelineView.attempt, attempt, `${state}: the store's pipelineView carries attempt ${attempt}`);
  }
};

check(build, 'pending');
move(build, 'splitting'); check(build, 'splitting');
// the same write the splitting stage makes: steps and provenance in one store write
BS.setFlowStatus(build, 'split', { by: 'vps', mutate: (rec) => {
  rec.split = { by: 'vps', model: 'Fable', at: splitAt, stepCount: STEPS.length };
  rec.steps = STEPS.map((s, i) => core.normStep({ ...P2.transition(s, 'pending', { at: splitAt, by: 'vps', kind: 'step' }).rec, splitBy: 'vps-fable', modelBy: 'triage' }, i));
} });
check(build, 'split');
eq(get(build).steps.length, 5, 'split into five steps');

// a second build arrives and is split while the first holds the one active place
BS.withStore((s) => { s.builds.push(core.normBuild(P2.transition({ id: 'sync-waiter', title: 'The second build', flow: P2.FLOW, steps: [] }, 'pending', { by: 'test' }).rec)); return s; }, { by: 'test' });
vpsSplit('sync-waiter', [{ id: 's1', text: 'Add a line to docs/sync-waiter.md', model: 'Opus', estimate: '2 min', files: ['docs/sync-waiter.md'] }]);

for (const state of ['pulling-main', 'assigning-models', 'ready', 'sending', 'building']) {
  move(build, state);
  if (state === 'pulling-main') for (const s of STEPS) move(build, 'pulling-main', { step: s.id });
  if (state === 'ready') for (const s of STEPS) move(build, 'ready', { step: s.id });
  if (state === 'building') for (const s of STEPS) { move(build, 'sending', { step: s.id }); move(build, 'building', { step: s.id }); }
  check(build, state);
  const w = row('sync-waiter')?.view.waitingOn;
  ok(w?.buildId === build && /holds the active place/.test(w.reason), `${state}: the second build waits at split and names ${build} as holding the active place`);
  const sv = get('sync-waiter').pipelineView;
  if (sv) eq(sv.waitingOn?.buildId, build, `${state}: the store's pipelineView.waitingOn names it too`);
}
for (const s of STEPS) move(build, 'completed', { step: s.id });
move(build, 'build-complete'); check(build, 'build-complete');
eq([row(build).done, row(build).total], [5, 5], 'build complete: 5 of 5 steps done');

move(build, 'failed', { why: 'the test fails it once' });
move(build, 'build-complete'); // the retry: attempt 2
move(build, 'failed', { why: 'the test fails attempt 2' });
check(build, 'failed', { attempt: 2 });
eq(get(build).attempt, 2, 'failed on attempt 2, forward only');

// the lander's states: its own names once the lander part is on this checkout, else the statuses this store knows
const landerStates = ['waiting-to-merge', 'merging', 'running-ci', 'landed'];
const OLD = { merging: 'merging-pr' };
for (const state of landerStates) {
  const status = has(P2.BUILD_STATUSES, state) ? state : OLD[state];
  if (!status) { skip('lander', `the builds store on this checkout has no "${state}" status: the lander part (deploy/lander) writes it. The screen's badge and line for it were checked in part 1.`); continue; }
  // done-means-merged@1: the store takes `landed` only with the proof the lander records (the PR, its merge commit, CI green)
  if (state === 'landed') BS.withStore((st) => { const mergedAt = new Date().toISOString(); Object.assign(core.findBuild(st, build), { pr: '901', branch: `claude/${build}`, mergedAt, landed: { pr: 901, mergedAt, sha: 'a'.repeat(40), ci: 'success' } }); return st; }, { by: 'lander' });
  try { move(build, status, { by: 'lander' }); } catch (e) { ok(false, `${state}: the store refused ${status}: ${e.message}`); continue; }
  if (status !== state) skip('lander', `"${state}" is written as "${status}" on this checkout (the lander part renames it): checked under that status`);
  check(build, state, { status });
}
eq(get(build).status, 'landed', 'the build ends landed');
ok(!row('sync-waiter')?.view.waitingOn || row('sync-waiter').view.waitingOn.buildId !== build, 'once it landed, the second build no longer waits on it');
if (!storeViews) skip('store contract', 'the store read on this checkout carries no pipelineView (framework/core/pipeline-status.mjs pipelineView + framework/cli/builds-store.mjs): the orchestrator\'s own fallback view was checked at every state instead');

/* ------------------------------------------------------------------ 4. what survives store writes */
section('4. Build number, split provenance and step ids survive store writes and verify');
{
  // a later, unrelated store write must not drop them
  BS.withStore((s) => { core.findBuild(s, build).notes.push({ text: 'a later write', at: new Date().toISOString() }); return s; }, { by: 'test' });
  const b = get(build);
  if (b.split) eq([b.split.by, b.split.model, b.split.stepCount], ['vps', 'Fable', 5], 'split { by, model, stepCount } survives');
  else skip('store contract', 'build.split is not kept by the store on this checkout');
  if (b.steps.every((s) => s.splitBy === 'vps-fable')) ok(true, 'every step keeps splitBy "vps-fable"');
  else skip('store contract', 'steps[].splitBy is not kept by the store on this checkout (normStep drops it): the store part adds the field');
  if (b.steps.every((s) => s.modelBy === 'triage')) ok(true, 'every step keeps modelBy "triage"');
  else skip('store contract', 'steps[].modelBy is not kept by the store on this checkout: the store part adds the field');
  const uids = b.steps.map((s) => s.uid);
  ok(uids.every(Boolean) && new Set(uids).size === uids.length, `every step has its own unique id (${uids[0]} …)`);
  eq(row(build).steps.map((s) => s.uid), uids, 'the orchestrator shows the same step ids, each in its own column');
  const numbers = BS.loadStore().builds.map((x) => V.buildNumber(x));
  if (numbers.every(Boolean)) { ok(new Set(numbers).size === numbers.length, `every build has its own number (${numbers.join(', ')})`); eq(row(build).number, V.buildNumber(b), 'the orchestrator shows the build number the store gave'); }
  else skip('store contract', 'the store on this checkout gives a build no `number`: the orchestrator shows a dash in the build number column until it does');
  const v = core.validateStore(BS.loadStore());
  ok(v.ok, `the store is valid builds@1 (builds-store verify)${v.ok ? '' : `: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`}`);
  ok(!('pipelineView' in JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, 'utf8')).builds.find((x) => x.id === build)), 'pipelineView is never written to the store: it is worked out on read');
}

/* ------------------------------------------------------------------ 5. one store, two screens */
section('5. Plan Studio 2.0 and the orchestrator read the same steps from the one store');
if (PS?.api && planId) {
  const api = (r) => PS.api(r, { by: 'test' });
  const orch = row(build).steps.map((s) => ({ id: s.id, title: s.title }));
  // the plan's build read (GET plans/<planId>/build): tried under the names the Plan Studio part may give it
  let read = null;
  for (const op of ['plan-build', 'build-read', 'build-view', 'linked-build']) {
    try { const r = api({ op, id: planId }); if (r?.build && Array.isArray(r.steps)) { read = r; break; } } catch { /* not this name */ }
  }
  if (read) {
    eq(read.steps.map((s) => s.id), orch.map((s) => s.id), 'the plan\'s build read lists the store\'s steps');
    eq(read.build.status, get(build).status, 'the plan\'s build read gives the store\'s status');
    if (get(build).pipelineView) eq(read.build.pipelineView?.state, get(build).pipelineView.state, 'both screens get the same pipelineView');
  } else {
    skip('Plan Studio 2.0', 'the plan\'s build read (GET /api/plugins/plan-studio-2/plans/<planId>/build) is not on this checkout: the plan\'s live rows were compared with the orchestrator instead');
    const live = api({ op: 'state' }).items.filter((i) => String(i.id).startsWith(`orch--${build}--`));
    eq(live.map((i) => i.title), orch.map((s) => s.title), 'Plan Studio lists the orchestrator\'s five steps from the store');
  }
  const p = api({ op: 'state' }).items.find((i) => i.id === planId);
  ok(p?.live?.build === build && p.live.steps?.total === 5, `the plan shows its build live: ${p?.live?.status}, ${p?.live?.steps?.done}/${p?.live?.steps?.total} steps (never "parked, 0 steps")`);
  const treeFile = join(process.env.AXF_PLAN_TREE_DIR, 'tree.json');
  const tree = existsSync(treeFile) ? readFileSync(treeFile, 'utf8') : '';
  const uids = get(build).steps.map((s) => s.uid);
  ok(tree && !uids.some((u) => tree.includes(u)) && !tree.includes(`orch--${build}--`), 'no build step is copied into the plan tree');
} else skip('Plan Studio 2.0', 'no plan to compare: the plan-studio-2 plugin is not on this checkout');

/* ------------------------------------------------------------------ 6. the parts that land with it */
section('6. The live channel and the lander (present on this checkout?)');
{
  const file = (p) => existsSync(join(ROOT, p));
  const text = (p) => (file(p) ? readFileSync(join(ROOT, p), 'utf8') : '');
  if (file('apps/console-web/server/builds_events.py')) {
    const src = text('apps/console-web/server/builds_events.py');
    ok(/builds\/updated/.test(src) && /builds\/events/.test(src) && /builds\.updated/.test(src), 'the console server has POST /api/builds/updated and GET /api/builds/events (event builds.updated)');
  } else skip('live channel', 'apps/console-web/server/builds_events.py is not on this checkout: the screen falls back to its poll (web/live.ts leaves the channel closed)');
  const live = text('apps/console-web/plugins/build-orchestrator/web/live.ts');
  ok(/'\/api\/builds\/events'/.test(live) && /'builds\.updated'/.test(live), 'the orchestrator screen listens on /api/builds/events for builds.updated');
  const lander = ['deploy/lander/run.mjs', 'deploy/lander/lander-core.mjs'].map(text).join('\n');
  if (/mergeLine/.test(lander)) ok(/position/.test(lander) && /waitingFor/.test(lander), 'the lander writes mergeLine { position, waitingFor }');
  else skip('lander', 'the lander on this checkout writes no mergeLine: the merge line shows once the lander part is merged');
  if (/merge-together|mergeTogether/.test(lander)) ok(true, 'the lander has the "Merge together" action');
  else skip('lander', 'the lander on this checkout has no "Merge together" action: the button says so in plain words when pressed');
}

rmSync(dir, { recursive: true, force: true });
const parts = [...new Set(skips.map((s) => s.part))];
if (JSON_OUT) process.stdout.write(`${JSON.stringify({ ok: !failures.length, passed, failed: failures, skipped: skips })}\n`);
else {
  console.log(`\n${failures.length ? '✗' : '✓'} pipeline sync: ${passed} passed, ${failures.length} failed, ${skips.length} skipped${parts.length ? ` (parts not on this checkout: ${parts.join(', ')})` : ''}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
}
process.exit(failures.length ? 1 : 0);
