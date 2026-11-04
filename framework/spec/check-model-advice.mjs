#!/usr/bin/env node
// model-advice@1 — which model and thinking level work should run on; the check / triangle; Apply and Dismiss are Brett's.
// Pure engine against its fixture, the builds store round trip, the orchestrator actions and the launcher's --effort.
//   node framework/spec/check-model-advice.mjs            # check
//   node framework/spec/check-model-advice.mjs --write    # rewrite the fixture from the engine (after a deliberate change)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../core/model-advice.mjs';
import * as S from '../plan/builds-store-core.mjs';
import * as M from '../plan/builds-merge-core.mjs';
import * as IO from '../cli/builds-store.mjs';
import * as O from '../../apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs'; // axf-plugin:build-orchestrator
import { CONTROL_TARGETS } from '../core/engines/control-rules.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(ROOT, 'framework/spec/fixtures/model-advice.json');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const at = '2026-11-04T16:00:00.000Z';

// ------------------------------------------------------------------ the classifier (fixture = the contract, both ports)
const CASES = [
  { text: 'settings-placement@1 contract: placements, sub-choices, defaults, asset type + engine + fixture', files: [] },
  { text: 'ref@1 resolver: registries (screens, settings, plugins, dialogs, toolbars, menus, builds)', files: [] },
  { text: 'Live status writes to main: store writes committed at once, newer-wins merge per build and step, journal lines', files: ['framework/plan/builds-merge-core.mjs'] },
  { text: 'Kotlin twin of the embed engine, conformance fixture, wire codes never change meaning', files: [] },
  { text: 'Picker UI: top row in each plugin settings, context menu entry, Settings > Plugins sub-tab', files: ['apps/console-web/plugins/x/web/ui.tsx'] },
  { text: 'Server: REST routes for the ledger, pagination, tests', files: ['apps/console-web/plugins/x/server/__init__.py'] },
  { text: 'Docs: guides, examples, help packs for every command from the control@1 schema', files: [] },
  { text: 'Tests (retry, parallel writes, merge no-regress), local CI block, report, THREADS, PR', files: [] },
  { text: 'Land PR #320 merge-queue: update from main once, one CI run, merge, redeploy the console', files: [] },
  { text: 'Fix GET /api/build-queue 500 under load: investigate the lock, race between pollers, stale cache', files: [] },
  { text: 'Unify the three table components onto one shared grid; heavy refactor of every list screen', files: [] },
  { text: 'Rename the Pending tab to Parked and fix the typo in its tooltip', files: [] },
  { text: 'Every layout parameter becomes a token: layout asset type/schema, engine, fixtures', files: ['framework/core/engines/layout.ts'] },
  { text: 'New asset type tab-group@1 in asset-types.json with both validators and a Kotlin twin recorded in PORTING.md', files: [] },
];
const classified = CASES.map((c) => ({ ...c, out: A.classify(c.text, { files: c.files }) }));
const build = (over = {}) => S.normBuild({
  id: 'demo', title: 'Demo', status: 'complete', profiles: ['current'], order: { current: 0 }, createdAt: at, updatedAt: at, builtAt: at,
  steps: [
    { id: 's1', text: CASES[0].text, model: 'Opus', estimate: '30 min', done: true, doneAt: at },
    { id: 's2', text: CASES[4].text, model: 'Opus', estimate: '20 min', done: true, doneAt: at },
    { id: 's3', text: CASES[7].text, model: 'Opus', estimate: '15 min', done: true, doneAt: at },
  ], ...over,
}, { now: at, seed: 'fixture' });
const views = { built: A.adviseBuild(build()), open: A.adviseBuild(build({ status: 'pending', steps: build().steps.map((s) => ({ ...s, done: false, doneAt: '' })) })), heavy: A.adviseBuild(build({ steps: [{ id: 's1', text: CASES[2].text, model: 'Opus', estimate: '30 min', done: true, doneAt: at, files: CASES[2].files }, { id: 's2', text: CASES[5].text, model: 'Opus', estimate: '20 min', done: true, doneAt: at }] })), noSteps: A.adviseBuild(build({ steps: [], detail: 'A new asset type and its engine for every app', pending: { model: 'Opus' } })) };
const fixture = { $axf: 'model-advice@1', cases: classified.map((c) => ({ text: c.text, files: c.files, kind: c.out.kind, model: c.out.model, thinking: c.out.thinking, signals: c.out.signals })), builds: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, { recommendedModel: v.recommendedModel, recommendedThinking: v.recommendedThinking, verdict: v.verdict, adviceKind: v.adviceKind, cost: v.adviceCost, steps: v.steps.map((s) => ({ id: s.id, recommendedModel: s.recommendedModel, recommendedThinking: s.recommendedThinking, adviceKind: s.adviceKind })) }])), filters: { 'needs a look': A.parseFilter('needs a look'), 'fable high': A.parseFilter('fable high'), 'model:Opus thinking:low': A.parseFilter('model:Opus thinking:low'), clear: A.parseFilter('clear') } };
if (process.argv.includes('--write')) { writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`); console.log(`wrote ${FIXTURE}`); }
const want = JSON.parse(readFileSync(FIXTURE, 'utf8'));
t('fixture: every classifier case gives the same kind, model, thinking and signals (both ports)', () => assert.deepEqual(fixture.cases, want.cases));
t('fixture: build advice, verdicts and costs', () => assert.deepEqual(fixture.builds, want.builds));
t('fixture: filters parse the same words', () => assert.deepEqual(fixture.filters, want.filters));

t('rule of thumb: foundation = Fable high / max, plugin = Opus medium, landing = Opus low, debugging = Opus high', () => {
  const by = (i) => classified[i].out;
  assert.deepEqual([by(0).model, by(0).thinking, by(0).kind], ['Fable', 'high', 'foundation']);
  assert.deepEqual([by(1).model, by(1).kind], ['Fable', 'foundation']); // ref@1 (banner-ref-links report: a cross-app GUI behaviour contract)
  assert.deepEqual([by(2).model, by(2).thinking, by(2).kind], ['Fable', 'max', 'migration']);
  assert.deepEqual([by(3).model, by(3).thinking, by(3).kind], ['Fable', 'max', 'kernel']);
  assert.deepEqual([by(4).model, by(4).thinking], ['Opus', 'medium']); assert.deepEqual([by(5).model, by(5).thinking], ['Opus', 'medium']);
  for (const i of [6, 7, 8, 11]) assert.deepEqual([by(i).model, by(i).thinking, by(i).kind], ['Opus', 'low', 'landing'], `case ${i}`);
  assert.deepEqual([by(9).model, by(9).thinking, by(9).kind], ['Opus', 'high', 'debug']); assert.deepEqual([by(10).model, by(10).thinking, by(10).kind], ['Opus', 'high', 'architecture']);
  assert.equal(by(12).model, 'Fable'); assert.equal(by(13).model, 'Fable');
});
t('thinking levels: four, ordered, defaults per model, every spelling, --effort args', () => {
  assert.deepEqual([...A.THINKING], ['low', 'medium', 'high', 'max']);
  assert.equal(A.defaultThinking('Fable'), 'high'); assert.equal(A.defaultThinking('claude-opus-5-5'), 'medium'); assert.equal(A.defaultThinking('nope'), 'medium');
  assert.equal(A.normThinking('High'), 'high'); assert.equal(A.normThinking('max thinking'), 'max'); assert.equal(A.normThinking('medium-high'), 'medium'); assert.equal(A.normThinking('lots'), '');
  assert.deepEqual(A.effortArgs('max'), ['--effort', 'max']); assert.deepEqual(A.effortArgs(''), []); assert.deepEqual(A.effortArgs('nope'), []);
  assert.ok(A.thinkingRank('max') > A.thinkingRank('high') && A.thinkingRank('high') > A.thinkingRank('medium') && A.thinkingRank('medium') > A.thinkingRank('low'));
});
t('verdicts: keep when nothing foundation ran on Opus, Fable review for some, redo for a kernel / migration step or most of it', () => {
  assert.equal(views.built.verdict, 'fable-review'); assert.ok(views.built.adviceCost.usd > 0 && views.built.adviceCost.minutes >= 15);
  assert.equal(views.heavy.verdict, 'redo-on-fable'); assert.ok(views.heavy.adviceCost.usd > views.built.adviceCost.usd);
  const onFable = A.adviseBuild(build({ steps: build().steps.map((s) => ({ ...s, model: 'Fable' })) }));
  assert.equal(onFable.verdict, 'keep'); assert.equal(onFable.adviceCost.usd, 0);
  assert.equal(A.adviseBuild(build({ steps: [build().steps[1], build().steps[2]] })).verdict, 'keep');
  assert.equal(views.open.verdict, ''); assert.ok(views.open.adviceCost.usd > 0, 'open work: the Fable extra over Opus');
  assert.equal(views.noSteps.recommendedModel, 'Fable'); assert.equal(views.noSteps.verdict, 'fable-review');
});
t('review status: ok on the recommended model + thinking, look when it differs, dismissed only for exactly what Brett OK\'d', () => {
  const st = S.normStep({ id: 's1', text: CASES[0].text, model: 'Opus', recommendedModel: 'Fable', recommendedThinking: 'high' }, 0, { now: at });
  assert.equal(A.stepView(st).reviewStatus, 'look');
  assert.equal(A.stepView({ ...st, model: 'Fable' }).reviewStatus, 'ok'); // Fable defaults to high
  assert.equal(A.stepView({ ...st, model: 'Fable', thinking: 'low' }).reviewStatus, 'look');
  const ok = A.reviewOkFor(A.stepView(st), { at, by: 'brett', via: 'console' });
  assert.equal(A.stepView({ ...st, reviewOk: ok }).reviewStatus, 'dismissed');
  assert.equal(A.stepView({ ...st, reviewOk: ok, thinking: 'high' }).reviewStatus, 'look', 'a change since the OK brings the triangle back');
  assert.equal(A.stepView({ ...st, reviewOk: ok, recommendedThinking: 'max' }).reviewStatus, 'look', 'a new recommendation brings it back');
  assert.equal(A.stepView({ id: 's9', text: 'x', model: 'Opus' }).reviewStatus, 'ok', 'no recommendation = nothing to look at');
  const b = build(); Object.assign(b, A.adviseBuild(b)); for (const s of b.steps) Object.assign(s, A.adviseBuild({ ...b, steps: [s] }).steps[0]);
  const v = A.buildView(b); assert.equal(v.reviewStatus, 'look'); assert.equal(v.verdict, 'fable-review'); assert.equal(v.stepsToLook, 2, 's1 wants Fable; s3 is landing work on medium thinking (low recommended)');
  assert.ok(A.whyLines(v).some((l) => l.label === 'If left as is') && A.whyLines(v).some((l) => l.label === 'Cost to change'));
});
t('filters: by model, thinking, status, Needs a look and Fable candidates; words from a voice command', () => {
  const look = { model: 'Opus', thinking: 'medium', recommendedModel: 'Fable', recommendedThinking: 'high', reviewStatus: 'look', verdict: '' };
  const fine = { model: 'Opus', thinking: 'low', recommendedModel: 'Opus', recommendedThinking: 'low', reviewStatus: 'ok', verdict: '' };
  assert.ok(A.matchesFilter(look, { needsLook: true }) && !A.matchesFilter(fine, { needsLook: true }));
  assert.ok(A.matchesFilter(look, { fable: true }) && !A.matchesFilter(fine, { fable: true }));
  assert.ok(A.matchesFilter({ ...fine, verdict: 'redo-on-fable', reviewStatus: 'look' }, { fable: true }), 'a built item to redo is a Fable candidate');
  assert.ok(A.matchesFilter(fine, { status: 'ok' }) && !A.matchesFilter(look, { status: 'ok' }) && A.matchesFilter(look, { status: 'look' }));
  assert.ok(A.matchesFilter(fine, { thinking: 'low' }) && !A.matchesFilter(look, { thinking: 'low' }) && A.matchesFilter(look, { model: 'Opus' }) && !A.matchesFilter(look, { model: 'Fable' }));
  assert.deepEqual(A.parseFilter('needs a look'), { needsLook: true }); assert.deepEqual(A.parseFilter('fable candidates'), { fable: true });
  assert.deepEqual(A.parseFilter('opus high'), { model: 'Opus', thinking: 'high' }); assert.deepEqual(A.parseFilter('clear'), {});
  assert.ok(A.filterIsEmpty({}) && !A.filterIsEmpty({ fable: true })); assert.equal(A.filterLabel({ needsLook: true, model: 'Fable' }), 'Needs a look · Fable');
});

// ------------------------------------------------------------------ builds@1: the fields on records and in every projection
t('store: records keep the advice fields, validate them, and projections (orchestrator, Pending, queue) carry the view', () => {
  const { defaultSteps: _d, ...b } = build(); const adv = A.adviseBuild(b); // the default breakdown follows the steps (advice included) on the next write
  const rec = S.normBuild({ ...b, ...adv, adviceAt: at, steps: b.steps.map((s, i) => ({ ...s, ...adv.steps[i], thinking: i === 1 ? 'high' : undefined })) }, { now: at });
  assert.equal(rec.recommendedModel, 'Fable'); assert.equal(rec.verdict, 'fable-review'); assert.equal(rec.steps[1].thinking, 'high'); assert.equal(rec.steps[0].thinking, undefined, 'unset stays unset (exports byte-stable)');
  const plain = S.normBuild(b, { now: at }); for (const k of A.BUILD_RECORD_FIELDS) assert.equal(k in plain, false, `${k} absent when unset`);
  const store = S.normalizeStore({ ...S.emptyStore(at), builds: [rec] });
  assert.deepEqual(S.validateStore(store).errors, []);
  const bad = JSON.parse(JSON.stringify(store)); bad.builds[0].thinking = 'lots'; bad.builds[0].verdict = 'maybe'; bad.builds[0].steps[0].recommendedModel = 'Sonnet';
  assert.deepEqual(S.validateStore(bad).errors.map((e) => e.path.replace(/^builds\[0\]\(demo\)/, '')), ['.thinking', '.verdict', '.steps[0].recommendedModel']);
  const orch = S.projectOrchestrator(store, 'current').builds[0];
  assert.equal(orch.recommendedModel, 'Fable'); assert.equal(orch.steps[1].thinking, 'high'); assert.equal(orch.steps[0].recommendedModel, 'Fable');
  const it = S.projectPending(store, 'current').items[0];
  for (const k of A.VIEW_FIELDS) assert.ok(k in it, `pending item has ${k}`);
  assert.equal(it.verdict, 'fable-review'); assert.equal(it.reviewStatus, 'look'); assert.equal(it.stepsToLook, 3, 's1 wants Fable, s2 was set to high (medium recommended), s3 is landing work (low)');
  assert.deepEqual([it.subPrompts[0].model, it.subPrompts[0].recommendedModel, it.subPrompts[0].reviewStatus, it.subPrompts[1].thinking], ['Opus', 'Fable', 'look', 'high']);
  assert.equal(S.diffStores(store, S.absorbPending(store, 'current', S.projectPending(store, 'current'))).length, 0, 'the view fields never write back');
  assert.equal(S.diffStores(store, S.absorbOrchestrator(store, 'current', S.projectOrchestrator(store, 'current'))).length, 0);
  const epic = S.buildFromEpic({ id: 'x.e', title: 'Epic', status: 'planned' }, 'current', { now: at, rec: { steps: [{ text: CASES[0].text, estimate: '30 min' }] } });
  const st2 = S.normalizeStore({ ...S.emptyStore(at), meta: { queue: { current: { dirty: false, updatedAt: at, history: [] } }, pending: {} }, builds: [epic] });
  const q = S.projectQueue(st2, 'current'); assert.ok(q.steps['x.e'].advice && 'reviewStatus' in q.steps['x.e'].advice && 'model' in q.steps['x.e'].steps[0]);
  const back = S.absorbQueue(st2, 'current', q, [{ id: 'x.e', kind: 'epic', title: 'Epic', status: 'planned' }]);
  assert.equal(back.builds[0].queue.advice, undefined, 'advice is a projection, never a queue field'); assert.equal(S.diffStores(st2, back).length, 0);
});

// ------------------------------------------------------------------ orchestrator actions: recommendations only; Apply / Dismiss are Brett's
t('orchestrator: advise writes the recommendation; a session cannot apply or dismiss; Brett can; a change after his OK shows again', () => {
  let s = O.normalizeState({ builds: [build({ status: 'pending', steps: build().steps.map((x) => ({ ...x, done: false, doneAt: '' })) })] });
  s = O.apply(s, { action: 'advise', id: 'demo' }).state; const b = () => s.builds[0];
  assert.equal(b().recommendedModel, 'Fable'); assert.equal(b().steps[0].recommendedModel, 'Fable'); assert.equal(b().steps[2].recommendedThinking, 'low');
  assert.equal(A.buildView(b()).reviewStatus, 'look');
  assert.throws(() => O.apply(s, { action: 'apply-advice', id: 'demo' }), /only Brett/);
  assert.throws(() => O.apply(s, { action: 'dismiss-advice', id: 'demo' }), /only Brett/);
  assert.throws(() => O.apply(s, { action: 'apply-advice-all' }), /only Brett/);
  const brett = { approver: { by: 'brett', via: 'console' } };
  const r = O.apply(s, { action: 'apply-advice', id: 'demo', step: 's3', ...brett }); s = r.state;
  assert.equal(b().steps[2].thinking, 'low'); assert.equal(b().steps[2].reviewOk.how, 'apply'); assert.equal(A.stepView(b().steps[2]).reviewStatus, 'ok', 'on its recommendation now');
  s = O.apply(s, { action: 'apply-advice', id: 'demo', step: 's1', ...brett }).state;
  assert.equal(b().steps[0].model, 'Fable', 'Brett applying a Fable recommendation is the upgrade approval'); assert.equal(A.stepView(b().steps[0]).reviewStatus, 'ok');
  s = O.apply(s, { action: 'dismiss-advice', id: 'demo', ...brett }).state;
  assert.equal(A.buildView(b()).reviewStatus, 'ok', 'build now on its recommendation');
  s = O.apply(s, { action: 'set-thinking', id: 'demo', step: 's1', thinking: 'low' }).state;
  assert.equal(A.stepView(b().steps[0]).reviewStatus, 'look', 'a change after the OK brings the triangle back');
  assert.throws(() => O.apply(s, { action: 'set-thinking', id: 'demo', step: 's1', thinking: 'lots' }), /low, medium, high, max/);
  s = O.apply(s, { action: 'set-thinking', id: 'demo', step: 's1', thinking: '' }).state; assert.equal(b().steps[0].thinking, undefined);
  s = O.apply(s, { action: 'advise', id: 'demo', advice: { recommendedModel: 'Opus', recommendedThinking: 'low', modelWhy: 'curated', verdict: '', steps: [] }, pin: true }).state;
  assert.equal(b().advicePinned, true); assert.equal(b().modelWhy, 'curated');
  s = O.apply(s, { action: 'advise', id: 'demo' }).state; assert.equal(b().modelWhy, 'curated', 'a pinned (curated) recommendation is not overwritten');
  s = O.apply(s, { action: 'advise', id: 'demo', force: true }).state; assert.notEqual(b().modelWhy, 'curated'); assert.equal(b().advicePinned, true, 'force keeps the pin');
  const built = O.apply(O.normalizeState({ builds: [build()] }), { action: 'advise', id: 'demo' }).state;
  const acc = O.apply(built, { action: 'apply-advice', id: 'demo', ...brett }).state.builds[0];
  assert.equal(acc.steps[0].model, 'Opus', 'a done step never changes model (no redo starts from here)'); assert.ok(acc.notes.some((x) => /Fable review/.test(x.text))); assert.equal(A.buildView(acc).reviewStatus, 'dismissed');
});

// ------------------------------------------------------------------ control@1 and the launcher
t('control@1 planner.builds: the fields and acts are there (append-only)', () => {
  const tgt = CONTROL_TARGETS['planner.builds'];
  for (const k of ['thinking', 'recommendedModel', 'recommendedThinking', 'reviewStatus', 'modelWhy', 'verdict']) assert.ok(k in tgt.fields, `build field ${k}`);
  for (const k of ['thinking', 'recommendedModel', 'recommendedThinking', 'reviewStatus', 'modelWhy']) assert.ok(k in tgt.stepFields, `step field ${k}`);
  for (const k of ['advise', 'set-thinking', 'apply-advice', 'dismiss-advice']) assert.ok(k in tgt.acts, `act ${k}`);
  assert.ok('needsLook' in tgt.select && 'fable' in tgt.select && 'thinking' in tgt.select && 'model' in tgt.select, 'list filters');
});
t('launcher: a thinking level becomes claude --effort (AXF_THINKING or the build step), never an unknown word', () => {
  const sh = readFileSync(join(ROOT, 'deploy/claude-headless.sh'), 'utf8');
  assert.match(sh, /AXF_THINKING/); assert.match(sh, /--effort/);
  const out = execFileSync('bash', ['-c', `source <(sed -n '/^# ---- thinking/,/^# ---- end thinking/p' deploy/claude-headless.sh); effort_args low; echo "|"; AXF_THINKING=max effort_args; echo "|"; AXF_THINKING=lots effort_args; echo "|"; effort_args --model opus --effort high`], { cwd: ROOT, encoding: 'utf8' });
  assert.deepEqual(out.split('|').map((x) => x.trim()), ['--effort low', '--effort max', '', '']);
});

// ------------------------------------------------------------------ never lost: merge rules and the sidecar
t('mergeAdvice: newer recommendation wins, a copy without advice never blanks it, pinned beats unpinned of the same age, newest OK wins', () => {
  const old = { recommendedModel: 'Fable', recommendedThinking: 'high', modelWhy: 'old', adviceAt: '2026-11-04T10:00:00Z', reviewOk: { at: '2026-11-04T11:00:00Z', by: 'brett', model: 'Opus', recommendedModel: 'Fable' } };
  const fresh = { recommendedModel: 'Opus', recommendedThinking: 'low', modelWhy: 'new', adviceAt: '2026-11-04T12:00:00Z' };
  assert.equal(A.mergeAdvice(old, fresh).modelWhy, 'new'); assert.equal(A.mergeAdvice(fresh, old).modelWhy, 'new');
  assert.equal(A.mergeAdvice(old, fresh).reviewOk.by, 'brett', 'the OK survives a newer recommendation (and shows the triangle again by itself)');
  assert.equal(A.mergeAdvice(old, {}).modelWhy, 'old'); assert.equal(A.mergeAdvice({}, old).modelWhy, 'old'); assert.deepEqual(A.mergeAdvice({}, {}), {});
  assert.equal(A.mergeAdvice({ ...fresh, adviceAt: old.adviceAt, advicePinned: true }, old).modelWhy, 'new', 'pinned wins a tie');
  assert.equal(A.mergeAdvice({ thinking: 'max' }, { thinking: 'low', ...old }).thinking, 'max');
  const b1 = build({ steps: build().steps.map((s, i) => ({ ...s, ...(i === 0 ? { recommendedModel: 'Fable', adviceAt: '2026-11-04T10:00:00Z' } : {}) })), recommendedModel: 'Fable', adviceAt: '2026-11-04T10:00:00Z' });
  const b2 = { ...build(), updatedAt: '2026-11-04T13:00:00Z', steps: build().steps.map((s) => ({ ...s, updatedAt: '2026-11-04T13:00:00Z' })) }; // an older-code session wrote it newer, without the fields
  const m = M.mergeBuild(b1, b2);
  assert.equal(m.recommendedModel, 'Fable', 'a newer copy from old code cannot drop the recommendation'); assert.equal(m.steps[0].recommendedModel, 'Fable');
});
t('sidecar: every read heals the records from _claude/builds/advice.json and every write folds them back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'advice-')); const prev = { ...process.env };
  process.env.AXF_BUILDS_STORE = join(dir, 'store.json'); process.env.AXF_BUILDS_EXPORT = '0'; process.env.AXF_BUILDS_LIVE = 'off';
  try {
    const open = build({ status: 'pending', steps: build().steps.map((s) => ({ ...s, done: false, doneAt: '' })) });
    IO.withStore((s) => ({ ...s, builds: [open] }), { by: 'test' });
    IO.withStore((s) => { const b = s.builds[0]; const adv = A.adviseBuild(b); Object.assign(b, A.adviceRecord({ ...adv, adviceAt: at }, { build: true })); for (const st of adv.steps) Object.assign(b.steps.find((x) => x.uid === st.uid), A.adviceRecord({ ...st, adviceAt: at })); b.steps[1].thinking = 'max'; return s; }, { by: 'test' });
    const side = JSON.parse(readFileSync(IO.adviceFile(), 'utf8'));
    assert.equal(side.$axf, 'model-advice-sidecar@1'); assert.equal(side.builds.demo.recommendedModel, 'Fable'); assert.equal(Object.keys(side.builds.demo.steps).length, 3);
    // an older-code session rewrites the store without the fields
    IO.withStore((s) => { for (const b of s.builds) { for (const k of A.BUILD_RECORD_FIELDS) delete b[k]; for (const st of b.steps) for (const k of A.STEP_RECORD_FIELDS) delete st[k]; b.updatedAt = '2026-11-04T18:00:00.000Z'; } return s; }, { by: 'old-code' });
    const healed = IO.loadStore().builds[0];
    assert.equal(healed.recommendedModel, 'Fable'); assert.equal(healed.steps[0].recommendedModel, 'Fable'); assert.equal(healed.steps[1].thinking, 'max', 'the thinking level someone set comes back too');
    assert.equal(IO.mergeAdviceText(readFileSync(IO.adviceFile(), 'utf8'), ''), readFileSync(IO.adviceFile(), 'utf8'), 'merging the sidecar with nothing changes nothing');
  } finally { process.env = prev; }
});

console.log(`model-advice: ${n} checks passed`);
