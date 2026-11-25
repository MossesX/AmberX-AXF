#!/usr/bin/env node
/**
 * pipeline-status@1 checks: the view engine (framework/core/pipeline-status.mjs pipelineView) against its golden
 * fixture and its schema (framework/schemas/pipeline-status.json); every state has a label, a tone, an icon and a
 * line; the waiting reason, the merge line, the fallback for statuses outside the contract; build numbers; and the
 * build-clash@1 rules (framework/core/build-clash.mjs): steps that never share files, the rejection of a build that
 * clashes with one not on main yet, its two answers and deferred steps.
 *   node framework/spec/check-pipeline-status.mjs            check
 *   node framework/spec/check-pipeline-status.mjs --write    regenerate framework/spec/fixtures/pipeline-status.json from the engine
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../core/pipeline-status.mjs';
import * as C from '../core/build-clash.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = join(ROOT, 'framework/spec/fixtures/pipeline-status.json');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/pipeline-status.json'), 'utf8'));
let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.error(`FAIL ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// ---- the builds every case is read with
const step = (id, status, extra = {}) => ({ id, uid: `st-${id}`, text: `Step ${id}`, model: 'Opus', status, ...extra });
const p2 = (id, status, extra = {}) => ({ id, title: `Build ${id}`, flow: P.FLOW, status, statusAt: '2026-11-24T00:00:00.000Z', attempt: 1, steps: [step('s1', 'pending'), step('s2', 'pending')], ...extra });
const ACTIVE = p2('active', 'building', { number: 'B-0041', statusAt: '2026-11-23T10:00:00.000Z', steps: [step('s1', 'completed'), step('s2', 'building')] });
const BUILT_1 = p2('built-1', 'build-complete', { number: 'B-0038', hand: { at: '2026-11-23T08:00:00.000Z', by: 'brett' }, statusAt: '2026-11-23T09:00:00.000Z' });
const BUILT_2 = p2('built-2', 'build-complete', { number: 'B-0039', hand: { at: '2026-11-23T08:30:00.000Z', by: 'brett' }, statusAt: '2026-11-23T09:30:00.000Z' });
const OTHERS = [ACTIVE, BUILT_1, BUILT_2];
const SPLIT = { by: 'vps', model: 'claude-fable-5-2', at: '2026-11-23T23:59:53.907Z', stepCount: 2 };
const CASES = [
  ...P.PIPELINE_STATES.filter((s) => !P.LANDER_STATES.includes(s) && s !== 'failed').map((s) => [`state ${s}`, p2('x', s, { number: 'B-0042', split: s === 'pending' || s === 'splitting' ? undefined : SPLIT }), []]),
  ['failed, attempt 2', p2('x', 'failed', { failedFrom: 'building', attempt: 2 }), []],
  ['failed and gave up', p2('x', 'failed', { failedFrom: 'pulling-main', attempt: P.MAX_ATTEMPTS }), []],
  ['merging-pr shows as merging', p2('x', 'merging-pr'), []],
  ['pr-pulling-main shows as merging', p2('x', 'pr-pulling-main'), []],
  ['merging-main shows as merging', p2('x', 'merging-main'), []],
  ['running-ci', p2('x', 'running-ci'), []],
  ['landed', p2('x', 'landed'), []],
  ['split, another build holds the active place', p2('x', 'split', { split: SPLIT }), OTHERS],
  ['split, nothing active', p2('x', 'split', { split: SPLIT }), [BUILT_1]],
  ['split, on hold', p2('x', 'split', { pipeline: { heldAt: '2026-11-24T00:00:00.000Z' } }), OTHERS],
  ['split, rejected for a clash', p2('x', 'split', { clash: { rejected: true, reason: 'Rejected: 1 step of 2 touches files that B-0041 (Build active) has not landed yet (framework/core/x.mjs).', options: [] } }), OTHERS],
  ['split, clash answered by the pipeline', p2('x', 'split', { clash: { rejected: false, answer: 'run-all', auto: true, answeredBy: 'pipeline', reason: 'Clash: 1 step of 2 touches files that B-0041 (Build active) has not landed yet (framework/core/x.mjs).', options: [] } }), [BUILT_1]],
  ['split, clash answered: waits its turn', p2('x', 'split', { clash: { rejected: false, answer: 'defer', reason: 'Rejected: 1 step of 2 touches files that B-0041 has not landed yet.' } }), OTHERS],
  ['hand build at split never waits', p2('x', 'split', { hand: { at: '2026-11-24T00:00:00.000Z', by: 'brett' } }), OTHERS],
  ['building with a deferred step', p2('x', 'building', { steps: [step('s1', 'building'), step('s2', 'pending', { waitsFor: { buildId: 'built-1', number: 'B-0038', title: 'Build built-1' } })] }), [BUILT_1]],
  ['build-complete, first in the merge line', BUILT_1, OTHERS],
  ['build-complete, second: waiting to merge', BUILT_2, OTHERS],
  ['build-complete, the lander wrote its state and line', p2('x', 'build-complete', { landing: { state: 'waiting-to-merge', mergeLine: { position: 3, waitingFor: 'B-0039' } } }), OTHERS],
  ['running-ci with the lander state', p2('x', 'running-ci', { landing: { state: 'running-ci' } }), OTHERS],
  ['a builds@1 status is shown as itself', { id: 'old', title: 'Old build', status: 'queued', steps: [] }, OTHERS],
  ['archived is shown as itself', p2('x', 'archived', { archivedFrom: 'split' }), OTHERS],
  ['an unknown status never throws', { id: 'odd', flow: P.FLOW, status: 'teleporting' }, OTHERS],
  ['no status at all', { id: 'none' }, []],
];
const answers = () => CASES.map(([name, build, all]) => ({ name, build, all: all.map((b) => b.id), view: P.pipelineView(build, [build, ...all]) }));
const numbersCase = () => {
  const builds = [{ id: 'a', createdAt: '1' }, { id: 'b', createdAt: '2', number: 'B-0007' }, { id: 'c', createdAt: '3', number: 'B-0007' }, { id: 'd', createdAt: '0' }];
  const r = P.assignNumbers(builds, { seq: 9 });
  return { seq: r.seq, given: r.given, numbers: Object.fromEntries(builds.map((b) => [b.id, b.number])) };
};
const CLASH_NEW = { id: 'new', title: 'New build', flow: P.FLOW, status: 'split', steps: [{ id: 's1', uid: 'u1', text: 'Core change', files: ['framework/core/x.mjs'] }, { id: 's2', uid: 'u2', text: 'Docs', files: ['docs/a.md'] }, { id: 's3', uid: 'u3', text: 'UI', files: ['apps/ui/'] }] };
const CLASH_ALL = [
  { id: 'hand-1', number: 'B-0038', title: 'Hand build', flow: P.FLOW, status: 'building', steps: [{ id: 's1', files: ['framework/core'] }] },
  { id: 'wait-1', number: 'B-0039', title: 'Waiting to merge', flow: P.FLOW, status: 'build-complete', steps: [{ id: 's1', files: ['apps/ui/web/a.tsx'] }] },
  { id: 'queued', number: 'B-0040', title: 'Not started', flow: P.FLOW, status: 'split', steps: [{ id: 's1', files: ['docs/a.md'] }] },
  { id: 'done', number: 'B-0001', title: 'Landed', flow: P.FLOW, status: 'landed', steps: [{ id: 's1', files: ['docs/a.md'] }] },
];
const engine = () => ({
  $axf: 'pipeline-status-fixture@1', schema: P.STATUS_SCHEMA, states: P.PIPELINE_STATES, landerStates: P.LANDER_STATES, tones: P.PIPELINE_TONES, info: P.PIPELINE_STATE_INFO,
  views: answers(), numbers: numbersCase(),
  clash: { schema: C.SCHEMA, build: CLASH_NEW, all: CLASH_ALL, record: C.clashRecord(CLASH_NEW, CLASH_ALL, { at: '2026-11-24T00:00:00.000Z' }) },
});

if (process.argv.includes('--write')) { writeFileSync(FIX, `${JSON.stringify(engine(), null, 1)}\n`); console.log(`wrote ${FIX}`); process.exit(0); }

// ---- fixture round trip: the engine answers what the fixture holds (a port answers the same)
const fix = JSON.parse(readFileSync(FIX, 'utf8'));
eq(JSON.parse(JSON.stringify(engine())), fix, 'the engine matches the fixture (regenerate with --write after a deliberate change)');
const byId = new Map([...CASES.map((c) => c[1]), ...OTHERS].map((b) => [b.id, b]));
for (const v of fix.views) eq(JSON.parse(JSON.stringify(P.pipelineView(v.build, [v.build, ...v.all.map((id) => byId.get(id))]))), v.view, `fixture view "${v.name}" replays`);

// ---- the states, against the schema
eq(P.PIPELINE_STATES, ['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'failed', 'waiting-to-merge', 'merging', 'running-ci', 'landed'], 'PIPELINE_STATES in order');
eq(SCHEMA.schema, P.STATUS_SCHEMA, 'the schema names the contract');
eq(SCHEMA.$defs.state.enum, P.PIPELINE_STATES, 'schema states = engine states');
eq(SCHEMA.$defs.landerState.enum, P.LANDER_STATES, 'schema lander states = engine lander states');
eq(SCHEMA.$defs.tone.enum, P.PIPELINE_TONES, 'schema tones = engine tones');
for (const s of P.PIPELINE_STATES) {
  const i = P.PIPELINE_STATE_INFO[s];
  ok(!!i && !!i.label && !!i.line && !!i.icon && P.PIPELINE_TONES.includes(i.tone), `state ${s} has a label, a tone, an icon and a line`);
}
eq(Object.keys(P.PIPELINE_STATE_INFO), P.PIPELINE_STATES, 'nothing but the states has a badge');
eq(P.PIPELINE_STATE_INFO['pulling-main'].label, 'Pulling main', 'label: Pulling main');
eq(P.PIPELINE_STATE_INFO['waiting-to-merge'].label, 'Waiting to merge', 'label: Waiting to merge');

// ---- every view has the schema's shape
const view = (name) => fix.views.find((v) => v.name === name).view;
for (const v of fix.views) {
  ok(SCHEMA.required.every((k) => k in v.view), `"${v.name}" carries every required field`);
  ok(typeof v.view.label === 'string' && v.view.label.length > 0 && P.PIPELINE_TONES.includes(v.view.tone) && Number.isInteger(v.view.attempt) && v.view.attempt >= 1, `"${v.name}" has a label, a tone and an attempt`);
  ok(!/\{\w+\}/.test(`${v.view.label}${v.view.line}`), `"${v.name}" leaves no template field unfilled`);
  if (P.PIPELINE_STATES.includes(v.view.state)) ok(v.view.line.length > 0, `"${v.name}" says what it is doing`);
  if (v.view.waitingOn) ok(SCHEMA.$defs.waitingOn.required.every((k) => typeof v.view.waitingOn[k] === 'string'), `"${v.name}" waitingOn in shape`);
  if (v.view.mergeLine) ok(Number.isInteger(v.view.mergeLine.position) && typeof v.view.mergeLine.text === 'string' && (v.view.mergeLine.waitingFor === null || SCHEMA.$defs.buildRef.required.every((k) => typeof v.view.mergeLine.waitingFor[k] === 'string')), `"${v.name}" mergeLine in shape`);
  if (v.view.split) ok(SCHEMA.$defs.split.required.every((k) => k in v.view.split), `"${v.name}" split in shape`);
}

// ---- labels and lines
eq(view('failed, attempt 2').label, 'Failed (attempt 2)', 'failed carries its attempt');
ok(/Failed at Building, attempt 2 of 5/.test(view('failed, attempt 2').line), 'failed says where and which attempt');
ok(/gave up/.test(view('failed and gave up').line), 'a build that used up its attempts says so');
for (const s of ['merging-pr', 'pr-pulling-main', 'merging-main']) eq(view(`${s} shows as merging`).state, 'merging', `${s} shows as merging`);
ok(new Set(['merging-pr', 'pr-pulling-main', 'merging-main'].map((s) => view(`${s} shows as merging`).line)).size === 3, 'each merging phase has its own line');
eq(view('state building').split, SPLIT, 'the split provenance rides on the view');
eq(view('state pending').split, null, 'no split before the split');

// ---- waitingOn
const w = view('split, another build holds the active place');
eq(w.waitingOn, { buildId: 'active', number: 'B-0041', title: 'Build active', reason: 'Waiting: Build active holds the active place' }, 'a build at split names the build that holds the active place');
ok(w.line.startsWith('Waiting: Build active holds the active place'), 'and its line says so');
eq(view('split, nothing active').waitingOn, null, 'nothing active: nothing to wait on (hand builds never hold the place)');
eq(view('hand build at split never waits').waitingOn, null, 'a hand build runs beside the line');
eq(view('split, on hold').waitingOn, null, 'on hold is its own reason');
ok(/On hold/.test(view('split, on hold').line), 'on hold says so');
eq(P.pipelineView(p2('x', 'ready'), [p2('x', 'ready'), ACTIVE]).waitingOn?.buildId, 'active', 'ready behind an older active build names it');
eq(P.pipelineView(ACTIVE, [ACTIVE, p2('x', 'split')]).waitingOn, null, 'the active build waits on nobody');

// ---- the clash badge
const rj = view('split, rejected for a clash');
eq([rj.state, rj.label, rj.tone], ['split', 'Split', 'muted'], 'a clash never blocks: an older unanswered record shows an ordinary waiting build');
ok(!rj.clash.rejected && rj.clash.auto && rj.clash.canAnswer && /^Clash: /.test(rj.clash.reason) && /It carries on by itself/.test(rj.line) && /Waiting: /.test(rj.line), 'that waits only for its turn and says it carries on by itself');
const au = view('split, clash answered by the pipeline');
ok(au.label === 'Split' && au.clash.auto && au.clash.canAnswer && au.clash.answer === 'run-all' && /Run all or Defer answers it by hand/.test(au.line), 'the pipeline\'s own answer leaves Run all / Defer open by hand');
ok(view('split, clash answered: waits its turn').clash.canAnswer === false, 'a person\'s answer closes it');
eq(view('split, clash answered: waits its turn').label, 'Split', 'an answered clash is an ordinary waiting build again');
ok(/1 step deferred, waiting for B-0038 to land/.test(view('building with a deferred step').line), 'a deferred step names the build it waits for');

// ---- the merge line
eq(view('build-complete, first in the merge line').state, 'build-complete', 'first in line: build complete, the lander takes it next');
eq(view('build-complete, first in the merge line').mergeLine, { position: 1, waitingFor: null, text: '1st to merge' }, 'first in the merge line');
const m2 = view('build-complete, second: waiting to merge');
eq([m2.state, m2.label], ['waiting-to-merge', 'Waiting to merge'], 'second in line: waiting to merge');
eq(m2.mergeLine, { position: 2, waitingFor: { buildId: 'built-1', number: 'B-0038', title: 'Build built-1' }, text: '2nd to merge, waiting for B-0038 to merge' }, 'it names its place and the build it waits for');
const m3 = view('build-complete, the lander wrote its state and line');
eq([m3.state, m3.mergeLine.position, m3.mergeLine.waitingFor.buildId], ['waiting-to-merge', 3, 'built-2'], "the lander's own record wins (a build number is resolved to the build)");

// ---- outside the contract
eq([view('a builds@1 status is shown as itself').state, view('a builds@1 status is shown as itself').tone], ['queued', 'muted'], 'a builds@1 status falls back to the raw status');
eq(view('an unknown status never throws').state, 'teleporting', 'an unknown status is shown as itself');
eq(view('archived is shown as itself').label, 'Archived', 'archived is shown as itself');
for (const junk of [null, undefined, 7, 'x', [], { status: {} }, { steps: 'no' }, { flow: P.FLOW, status: 'split', steps: [null], clash: 'x', pipeline: 3 }]) {
  let v = null; try { v = P.pipelineView(junk, junk); } catch { v = null; }
  ok(!!v && typeof v.label === 'string', `never throws on ${JSON.stringify(junk)}`);
}
ok(P.pipelineView(p2('x', 'split'), P.pipelineContext([ACTIVE])).waitingOn?.buildId === 'active', 'a context worked out once gives the same answer');
eq(P.stepView({ id: 's1', uid: 'st-1', splitBy: 'vps-fable', model: 'Fable', modelBy: 'triage', status: 'ready', text: 'x' }), { id: 's1', uid: 'st-1', splitBy: 'vps-fable', model: 'Fable', modelBy: 'triage', status: 'ready' }, 'the step view: uid, splitBy, model, modelBy, status');
eq(P.normLanding({ state: 'merging', mergeLine: { position: 2, waitingFor: 'B-0038' }, junk: 1 }), { state: 'merging', mergeLine: { position: 2, waitingFor: 'B-0038' } }, "the lander's state and merge line are kept on its record");

// ---- build numbers
eq(fix.numbers.numbers, { a: 'B-0011', b: 'B-0007', c: 'B-0012', d: 'B-0010' }, 'numbers: oldest first from the high-water mark; a number held twice stays with the older build');
eq(P.numberText(123), 'B-0123', 'B-0123');
eq(P.numberText(12345), 'B-12345', 'past 9999 it just grows');
eq([P.numberValue('B-0123'), P.numberValue('123'), P.numberValue('')], [123, 0, 0], 'numberValue');
{ const bs = [{ id: 'a', number: 'B-0003' }, { id: 'b' }, { id: 'c' }]; const r = P.assignNumbers(bs, { ids: new Set(['c']) }); eq([r.given, bs[1].number], [[{ id: 'c', number: 'B-0004' }], undefined], 'only the named builds are numbered'); }
{ const bs = [{ id: 'a', number: 'B-0003' }]; eq(P.assignNumbers(bs, { seq: 3 }).given, [], 'a number is given once'); }

// ---- build-clash@1: inside one build
const S = (id, files, minutes = 10) => ({ id, text: id, files, estimate: `${minutes} min` });
eq(C.disjointParts([S('a', ['x/1']), S('b', ['y']), S('c', ['x']), S('d', ['y/2', 'z']), S('e', ['z/9']), S('f', [])]).map((p) => p.map((s) => s.id)), [['a', 'c'], ['b', 'd', 'e'], ['f']], 'steps tied by a file, directly or through a third, share a part');
eq(C.stepOverlaps(C.disjointParts([S('a', ['x/1']), S('b', ['y']), S('c', ['x'])]).map((p, i) => ({ id: `s${i + 1}`, files: p.flatMap((s) => s.files) }))), [], 'the parts never share a file');
eq(C.separateParts([[S('a', ['x'])], [S('b', ['y'])], [S('c', ['x/1', 'y/1'])], [S('d', ['q'])]]).map((p) => p.map((s) => s.id)), [['a', 'c', 'b'], ['d']], 'parts cut another way are joined until none overlaps');
eq(C.stepOverlaps([S('a', ['x/1']), S('b', ['x'])]), [{ a: 'a', b: 'b', files: ['x/1'] }], 'an overlap is reported with the files');
eq(C.sharedFiles(['a/b.mjs', 'c/'], ['a', 'c/d/e.ts', 'zz']), ['a/b.mjs', 'c/d/e.ts'], 'shared files: equal, or one inside the other');

// ---- build-clash@1: against builds not on main yet
eq(C.unmergedBuilds(CLASH_ALL, 'new').map((b) => b.id), ['hand-1', 'wait-1'], 'not on main yet: building, or built and waiting to merge (not queued, not landed)');
const rec = fix.clash.record;
ok(rec.rejected === true && /^Rejected: 2 steps of 3 touch files that B-0038 \(Hand build\), B-0039 \(Waiting to merge\) have not landed yet/.test(rec.reason), 'the whole build is rejected with a plain reason');
eq(rec.options.map((o) => o.id), ['run-all', 'defer'], 'two answers: run all, or run the clean steps and defer');
eq(rec.options[1].steps.map((d) => [d.step, d.uid, d.waitsFor.buildId, d.waitsFor.number]), [['s1', 'u1', 'hand-1', 'B-0038'], ['s3', 'u3', 'wait-1', 'B-0039']], 'each deferred step names the build it waits for');
eq(rec.options[1].label, 'Run 1 clean step now, defer 2', 'the defer answer says how many run now');
eq(C.clashRecord({ ...CLASH_NEW, steps: [CLASH_NEW.steps[1]] }, CLASH_ALL), null, 'a clean build is not rejected');
eq(C.clashRecord({ id: 'nofiles', steps: [{ id: 's1', text: 'no files named' }] }, CLASH_ALL), null, 'a build that names no files cannot be judged');
ok(C.isRejected({ clash: rec }) && !C.isRejected({ clash: { ...rec, answer: 'run-all', rejected: false } }) && !C.isRejected({}), 'isRejected until answered');
const auto = C.autoAnswer({ clash: rec }, { at: 'T' }).clash;
eq([auto.rejected, auto.answer, auto.auto, auto.answeredBy, auto.reason.slice(0, 7)], [false, 'run-all', true, C.AUTO_BY, 'Clash: '], 'the pipeline answers a clash itself (run-all, auto): it never blocks');
ok(C.canAnswer({ clash: auto }) && C.canAnswer({ clash: rec }) && !C.canAnswer({}) && C.autoAnswer({ clash: auto }) === null, 'a hand answer stays open after the pipeline\'s own');
const hand = C.answerClash({ id: 'new', clash: auto }, 'defer', { by: 'brett', at: 'T' });
ok(hand.clash.answer === 'defer' && !('auto' in hand.clash) && !C.canAnswer({ clash: hand.clash }) && hand.defer.length === 2, 'a hand answer replaces the pipeline\'s and stands');
const d = C.answerClash({ id: 'new', clash: rec }, 'defer', { by: 'brett', at: 'T' });
eq([d.clash.rejected, d.clash.answer, d.clash.answeredBy, d.defer.map((x) => x.step)], [false, 'defer', 'brett', ['s1', 's3']], 'defer: the clashing steps are the ones to mark');
eq(C.answerClash({ id: 'new', clash: rec }, 'run-all').defer, [], 'run-all: nothing waits');
let threw = 0; for (const f of [() => C.answerClash({ id: 'x' }, 'defer'), () => C.answerClash({ id: 'x', clash: rec }, 'maybe'), () => C.answerClash({ id: 'x', clash: d.clash }, 'run-all')]) { try { f(); } catch { threw++; } }
eq(threw, 3, 'no clash, a bad answer and a second answer are refused');
eq(C.normClash(JSON.parse(JSON.stringify(rec))), rec, 'the clash record survives its normaliser');
const ds = { id: 's1', waitsFor: { buildId: 'hand-1', number: 'B-0038', title: 'Hand build' } };
eq(C.stillDeferred(ds, CLASH_ALL)?.buildId, 'hand-1', 'a deferred step waits while that build is not on main');
eq(C.stillDeferred(ds, [{ ...CLASH_ALL[0], status: 'landed' }]), null, 'it starts by itself once that build has landed');
eq(C.stillDeferred(ds, [{ ...CLASH_ALL[0], status: 'archived' }]), null, 'or was cancelled');
eq(C.stillDeferred(ds, []), null, 'or is gone');
eq(C.stillDeferred({ id: 's1' }, CLASH_ALL), null, 'a step that waits for nothing is never deferred');

console.log(failed ? `pipeline-status: ${failed} of ${n} checks FAILED` : `pipeline-status: ${n} checks passed`);
process.exit(failed ? 1 : 0);
