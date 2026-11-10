#!/usr/bin/env node
/**
 * assignment@1 — the orchestrator handing a build or step to an employee agent through the group chat (Brett, Nov 10 2026).
 * The contract (framework/core/build-assignment.mjs) is computed here and replayed from spec/fixtures/build-assignment.json;
 * the envelope is the swarm chat message (engines/swarm-rules.mjs, swarm-chat.mjs); the record rides on builds@1 builds
 * and steps (framework/plan/builds-store-core.mjs) and survives a merge (builds-merge-core.mjs). Schema snapshots current.
 *   node framework/spec/check-build-assignment.mjs            (--write regenerates the fixture)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../core/build-assignment.mjs';
import * as R from '../core/engines/swarm-rules.mjs';
import * as C from '../core/engines/swarm-chat.mjs';
import * as store from '../plan/builds-store-core.mjs';
import { mergeBuild, mergeStores } from '../plan/builds-merge-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/* ---- the contract: computed here, replayed from the fixture ---- */
const AT = '2026-11-10T16:28:00.000Z';
const at = (s) => A.plusSeconds(AT, s);
const agents = [
  { id: 'rio', name: 'Rio React', role: 'Front-end engineer', skill: 'react-ui', skills: ['react-ui'], keywords: ['react', 'dialog', 'css'], paths: ['**/*.tsx'], models: ['opus'], tools: ['Read', 'Edit'], salary: 20 },
  { id: 'tia', name: 'Tia Theme', role: 'Asset designer', skill: 'assets-themes', skills: ['assets-themes'], keywords: ['token', 'css'], paths: [], models: ['opus'], tools: ['Read', 'Edit'], salary: 10 },
  { id: 'joey', name: 'Joey', role: 'All-rounder', skill: 'builds', skills: ['builds', '*'], keywords: [], paths: [], models: ['opus', 'fable'], tools: ['Read', 'Edit', 'Bash'], salary: 7.5 },
  { id: 'py', name: 'Py Pete', role: 'Server engineer', skill: 'python-server', skills: ['python-server'], keywords: ['fastapi'], paths: [], models: ['opus'], tools: ['Read', 'Edit'], salary: 10 },
];
const ids = agents.map((a) => a.id);
const need = { skills: ['react-ui'], tools: ['Edit'], capabilities: ['dialog', 'css'] };
const candidates = A.candidatesFor(need, agents, { text: 'Dialog listing the matching agents with match %' });
const nobody = A.candidatesFor({ skills: ['kotlin-compose'] }, agents.filter((a) => a.id !== 'joey'), { fallback: 'py' });
const toolsOnly = A.candidatesFor({ tools: ['Bash'] }, agents);

// the chat: ask → claim (first wins) → candidates (dialog + veto window) → default pick after 90 s → brief back
const posts = [
  ['m1', AT, 'boss', { type: 'ask', buildId: 'b', stepId: 's1', need }],
  ['m2', at(5), 'rio', { type: 'claim', buildId: 'b', stepId: 's1', ask: 'm1', by: 'rio' }],
  ['m3', at(6), 'tia', { type: 'claim', buildId: 'b', stepId: 's1', ask: 'm1', by: 'tia' }],
  ['m4', at(7), 'rio', { type: 'candidates', buildId: 'b', stepId: 's1', ask: 'm1', by: 'rio', candidates, vetoDeadline: at(95) }],
  ['m5', at(30), 'boss', { type: 'pick', buildId: 'b', stepId: 's1', ask: 'm1', employee: 'rio', pickedBy: 'default' }],
  ['m6', at(96), 'boss', { type: 'pick', buildId: 'b', stepId: 's1', ask: 'm1', employee: 'rio', pickedBy: 'default' }],
  ['m7', at(400), 'rio', { type: 'brief', buildId: 'b', stepId: 's1', ask: 'm1', by: 'rio', ref: '_claude/builds/reports/b-s1.md', kind: 'report', employee: { id: 'rio', name: 'Rio React', role: 'Front-end engineer', skill: 'react-ui' } }],
];
const messages = posts.map(([id, when, from, p]) => A.messageFor(p, { id, from, at: when, names: { rio: 'Rio React', tia: 'Tia Theme' } }));
const folded = A.fold(messages, { buildId: 'b', stepId: 's1' });
// Brett's veto inside the window, naming someone else; and a veto that declines
const open = A.fold(messages.slice(0, 4), { buildId: 'b', stepId: 's1' }).record;
const vetoPick = A.apply(open, { type: 'veto', buildId: 'b', stepId: 's1', ask: 'm1', employee: 'tia' }, { at: at(60), from: 'brett', messageId: 'v1' });
const vetoDecline = A.apply(open, { type: 'veto', buildId: 'b', stepId: 's1', ask: 'm1', note: 'not now' }, { at: at(60), from: 'brett', messageId: 'v2' });
const vetoLate = A.apply(open, { type: 'veto', buildId: 'b', stepId: 's1', ask: 'm1', employee: 'tia' }, { at: at(120), from: 'brett', messageId: 'v3' });
const brettPickEarly = A.apply(A.fold(messages.slice(0, 1)).record, { type: 'pick', buildId: 'b', stepId: 's1', ask: 'm1', employee: 'py', pickedBy: 'brett' }, { at: at(2), from: 'brett', messageId: 'p1' });
const wrongSpeaker = A.apply(null, { type: 'ask', buildId: 'b', need }, { at: AT, from: 'rio', messageId: 'x1' });
const errors = {
  'ask-empty': A.payloadErrors({ type: 'ask', buildId: 'b', need: {} }),
  'claim-no-ask': A.payloadErrors({ type: 'claim', buildId: 'b', by: 'rio' }),
  'candidates-bad': A.payloadErrors({ type: 'candidates', buildId: 'b', ask: 'm1', by: 'nobody', candidates: [{ employee: 'rio', match: 60 }, { employee: 'tia', match: 60 }] }, ids),
  'pick-bad': A.payloadErrors({ type: 'pick', buildId: 'b', ask: 'm1', employee: 'Rio', pickedBy: 'boss' }),
  'brief-bad': A.payloadErrors({ type: 'brief', buildId: 'b', ask: 'm1', by: 'rio', employee: { name: 'x' } }),
  'type-bad': A.payloadErrors({ type: 'grab', buildId: 'b' }),
  'chat-ok': C.messageErrors(messages[0], ids),
  'chat-wrong-speaker': C.messageErrors({ ...messages[0], from: 'rio' }, ids),
  'chat-wrong-job': C.messageErrors({ ...messages[1], jobId: 'other' }, ids),
  'chat-no-payload': C.messageErrors({ from: 'boss', kind: 'assignment', text: 'hey', jobId: 'b.s1' }, ids),
};
const normalized = {
  message: R.normMessage({ id: 'm1', at: AT, from: 'boss', kind: 'assignment', text: 'who?', jobId: 'b.s1', assignment: { type: 'ask', buildId: 'b', stepId: 's1', need: { skills: ['react-ui', 'react-ui', 7], junk: 1 } }, extra: true }),
  banterKeepsNoPayload: R.normMessage({ from: 'rio', kind: 'banter', text: 'yo', assignment: { type: 'ask', buildId: 'b', need } }),
  record: A.normAssignment({ status: 'bogus', candidates: [{ employee: 'rio', match: 140.6, reasons: ['x'] }, { employee: 'Bad', match: 1 }], claimedBy: 'rio', briefs: [{ ref: 'r', kind: 'nope', by: 'rio', at: 'yesterday' }, { kind: 'report' }], messages: ['m1', 'm1'], updatedAt: AT }),
  columnOnly: A.normAssignment(null, { assignedEmployee: 'rio' }),
  nothing: A.normAssignment({ status: '', candidates: [] }),
  payloadOnOtherKind: A.normPayload({ type: 'ask', buildId: 'b', need }),
};
const merged = {
  newerWins: A.mergeAssignment({ status: 'assigned', assignedEmployee: 'rio', briefs: [{ ref: 'a', kind: 'brief', by: 'rio', at: at(1) }], messages: ['m1'], updatedAt: at(1) }, { status: 'returned', assignedEmployee: 'rio', briefs: [{ ref: 'b', kind: 'report', by: 'rio', at: at(2) }], messages: ['m2'], updatedAt: at(2) }),
  employeeKept: A.mergeAssignment({ status: 'asked', ask: 'm9', updatedAt: at(9) }, { status: 'assigned', assignedEmployee: 'tia', updatedAt: at(1) }),
  declinedStays: A.mergeAssignment({ status: 'declined', pickedBy: 'brett', updatedAt: at(9) }, { status: 'assigned', assignedEmployee: 'tia', updatedAt: at(1) }),
};
const computed = {
  registry: A.REGISTRY, candidates, nobody, toolsOnly, messages, folded,
  veto: { pick: vetoPick, decline: vetoDecline, late: vetoLate, brettEarly: brettPickEarly, wrongSpeaker },
  defaultPick: { open: A.defaultPick(open, at(50), { buildId: 'b', stepId: 's1' }), closed: A.defaultPick(open, at(96), { buildId: 'b', stepId: 's1' }), left: [A.vetoLeft(open, at(50)), A.vetoLeft(open, at(95)), A.vetoLeft(open, at(200))] },
  errors, normalized, merged,
  jobIds: { build: A.jobIdOf('my-build'), step: A.jobIdOf('my-build', 's2'), parsed: [A.parseJobId('my-build.s2'), A.parseJobId('dotted.name'), A.parseJobId('x.s10.1')] },
  schemas: Object.keys(A.jsonSchemas()),
};

const FX = 'framework/spec/fixtures/build-assignment.json';
if (process.argv.includes('--write')) writeFileSync(join(ROOT, FX), `${JSON.stringify({ $axf: 'fixture@1', about: 'assignment@1: the orchestrator hands a build or step to an employee agent through the group chat (core/build-assignment.mjs); regenerate: node framework/spec/check-build-assignment.mjs --write', at: AT, inputs: { agents, need, posts }, ...computed }, null, 1)}\n`);
const fx = read(FX);
for (const k of Object.keys(computed)) t(`fixture: ${k}`, () => assert.deepEqual(computed[k], fx[k]));

/* ---- what the fixture must say ---- */
t('candidates: every matching agent, best first, percentages add up to 100, reasons name the hits', () => {
  assert.deepEqual(candidates.map((c) => c.employee), ['rio', 'joey', 'tia']);
  assert.equal(candidates.reduce((s, c) => s + c.match, 0), 100);
  assert.ok(candidates[0].match > candidates[1].match);
  assert.deepEqual(candidates[0].reasons, ['skill react-ui', 'tool Edit', 'can dialog', 'can css', 'knows dialog']);
  assert.ok(candidates[1].reasons.includes('all-rounder: react-ui'));
  assert.ok(!candidates.some((c) => c.employee === 'py'), 'a tool everybody has is no match when skills are named');
});
t('nobody matches: the roster fallback is the one candidate at 100 %; a tools-only need matches on tools', () => {
  assert.deepEqual(nobody, [{ employee: 'py', match: 100, reasons: ['roster fallback: nobody matched the need'] }]);
  assert.deepEqual(toolsOnly.map((c) => c.employee), ['joey']);
});
t('the envelope is the swarm chat message: kind assignment, jobId names the work, payload kept, nothing else', () => {
  assert.equal(R.CHAT_KINDS.includes('assignment'), true); assert.equal(R.WORK_KINDS.includes('assignment'), true); assert.equal(C.JOB_KINDS.includes('assignment'), true);
  assert.deepEqual(Object.keys(normalized.message).sort(), ['assignment', 'at', 'from', 'id', 'jobId', 'kind', 'text', 'toned', 'vibe']);
  assert.deepEqual(normalized.message.assignment, { type: 'ask', buildId: 'b', stepId: 's1', ask: '', at: '', need: { skills: ['react-ui'], tools: [], capabilities: [] } });
  assert.equal('assignment' in normalized.banterKeepsNoPayload, false, 'a payload on another kind is dropped');
  assert.deepEqual(messages.map((m) => m.jobId), new Array(messages.length).fill('b.s1'));
  for (const m of messages) assert.deepEqual(C.messageErrors(m, ids), [], `message ${m.id} posts clean`);
});
t('who may post what: boss asks and default-picks, an agent claims / lists / returns, Brett vetoes and picks', () => {
  assert.deepEqual(errors['chat-wrong-speaker'].map((e) => e.field), ['message.assignment.type']);
  assert.match(errors['chat-wrong-speaker'][0].message, /rio cannot post an assignment "ask"/);
  assert.deepEqual(errors['chat-wrong-job'].map((e) => e.field), ['message.jobId']);
  assert.deepEqual(errors['chat-no-payload'].map((e) => e.field), ['message.assignment']);
  assert.equal(wrongSpeaker.error, 'rio cannot post a ask (boss does)'); assert.equal(wrongSpeaker.record, null);
});
t('validators name the field', () => {
  assert.deepEqual(errors['ask-empty'].map((e) => e.field), ['assignment.need']);
  assert.deepEqual(errors['claim-no-ask'].map((e) => e.field), ['assignment.ask']);
  assert.deepEqual(errors['candidates-bad'].map((e) => e.field), ['assignment.by', 'assignment.candidates', 'assignment.vetoDeadline']);
  assert.deepEqual(errors['pick-bad'].map((e) => e.field), ['assignment.employee', 'assignment.pickedBy']);
  assert.deepEqual(errors['brief-bad'].map((e) => e.field), ['assignment.ref', 'assignment.employee']);
  assert.deepEqual(errors['type-bad'].map((e) => e.code), ['invalid']);
});
t('the flow: first claimer wins, the dialog opens the 90 s window, the default pick waits for it, the brief closes it', () => {
  const r = folded.record;
  assert.deepEqual(folded.refused, [{ id: 'm3', error: 'rio already took it' }, { id: 'm5', error: `the veto window is open until ${at(95)} (65 s left)` }]);
  assert.equal(r.status, 'returned'); assert.equal(r.claimedBy, 'rio'); assert.equal(r.vetoDeadline, at(95));
  assert.equal(r.assignedEmployee, 'rio'); assert.equal(r.pickedBy, 'default'); assert.equal(r.pickedAt, at(96));
  assert.deepEqual(r.messages, ['m1', 'm2', 'm4', 'm6', 'm7']);
  assert.equal(r.briefs.length, 1); assert.equal(r.briefs[0].employee.name, 'Rio React'); assert.equal(r.briefs[0].message, 'm7');
  assert.equal(r.need.skills[0], 'react-ui');
});
t('the veto: inside the window Brett names someone or declines; after it the window is closed; he may pick before any claim', () => {
  assert.equal(vetoPick.error, ''); assert.equal(vetoPick.record.status, 'assigned'); assert.equal(vetoPick.record.assignedEmployee, 'tia'); assert.equal(vetoPick.record.pickedBy, 'brett');
  assert.equal(vetoDecline.record.status, 'declined'); assert.equal(vetoDecline.record.assignedEmployee, '');
  assert.equal(vetoLate.error, `the veto window closed at ${at(95)}`);
  assert.equal(brettPickEarly.record.status, 'assigned'); assert.equal(brettPickEarly.record.assignedEmployee, 'py');
});
t('defaultPick: nothing while the window is open, the top candidate once it closed; vetoLeft counts down to 0', () => {
  assert.equal(computed.defaultPick.open, null);
  assert.deepEqual(computed.defaultPick.closed, { type: 'pick', buildId: 'b', stepId: 's1', ask: 'm1', employee: 'rio', pickedBy: 'default', at: at(96) });
  assert.deepEqual(computed.defaultPick.left, [45, 0, 0]);
});
t('the record normalizes: bad status blank, candidates clipped and sorted, bad ids dropped, column fills a blank employee, nothing = null', () => {
  const r = normalized.record;
  assert.equal(r.status, ''); assert.deepEqual(r.candidates, [{ employee: 'rio', match: 100, reasons: ['x'] }]);
  assert.deepEqual(r.briefs.map((b) => [b.ref, b.kind, b.at]), [['r', 'brief', '']]); assert.deepEqual(r.messages, ['m1']);
  assert.deepEqual(normalized.columnOnly, { ...A.emptyAssignment(), status: 'assigned', assignedEmployee: 'rio' });
  assert.equal(normalized.nothing, null);
});
t('merging two copies: the later one wins, briefs and message ids union, an employee is never blanked unless declined', () => {
  assert.equal(merged.newerWins.status, 'returned'); assert.deepEqual(merged.newerWins.briefs.map((b) => b.ref), ['a', 'b']); assert.deepEqual(merged.newerWins.messages, ['m2', 'm1']);
  assert.equal(merged.employeeKept.assignedEmployee, 'tia'); assert.equal(merged.employeeKept.status, 'asked');
  assert.equal(merged.declinedStays.assignedEmployee, '');
});
t('job ids: <build> or <build>.<step>; a dotted build id without a step stays whole', () => {
  assert.deepEqual(computed.jobIds, { build: 'my-build', step: 'my-build.s2', parsed: [{ buildId: 'my-build', stepId: 's2' }, { buildId: 'dotted.name', stepId: '' }, { buildId: 'x', stepId: 's10.1' }] });
});

/* ---- the record on builds@1 builds and steps (framework/plan/builds-store-core.mjs) ---- */
t('store: a build and a step carry the record and the assignedEmployee column, kept equal; older records gain nothing', () => {
  const b = store.normBuild({ id: 'b', title: 'B', steps: [{ id: 's1', text: 'one', assignment: folded.record }, { id: 's2', text: 'two', assignedEmployee: 'tia' }, { id: 's3', text: 'three' }], assignment: { status: 'assigned', assignedEmployee: 'joey', updatedAt: AT } }, { now: AT });
  assert.equal(b.assignedEmployee, 'joey'); assert.equal(b.assignment.status, 'assigned');
  assert.equal(b.steps[0].assignedEmployee, 'rio'); assert.equal(b.steps[0].assignment.status, 'returned'); assert.equal(b.steps[0].assignment.briefs.length, 1);
  assert.equal(b.steps[1].assignedEmployee, 'tia'); assert.equal(b.steps[1].assignment.status, 'assigned', 'a column alone reads as assigned');
  assert.equal('assignedEmployee' in b.steps[2], false); assert.equal('assignment' in b.steps[2], false, 'no assignment = no fields');
  const old = store.normBuild({ id: 'old', title: 'Old', steps: [{ id: 's1', text: 'x' }] }, { now: AT });
  assert.equal('assignedEmployee' in old, false, 'a record nobody assigned is not rewritten'); assert.equal('assignment' in old, false);
  assert.equal(JSON.stringify(store.normBuild(old, { now: AT })), JSON.stringify(old));
  assert.equal(JSON.stringify(store.normBuild(b, { now: AT })), JSON.stringify(b), 'normalizing twice is the same record');
});
t('store: the orchestrator@1 projection carries the column and the record and absorbs them back', () => {
  let s = store.emptyStore(AT);
  s = store.absorbOrchestrator(s, 'all', { builds: [{ id: 'b', title: 'B', steps: [{ id: 's1', text: 'one', assignment: folded.record }], assignment: { status: 'assigned', assignedEmployee: 'joey', updatedAt: AT } }] }, { now: AT });
  const o = store.projectOrchestrator(s, 'all');
  assert.equal(o.builds[0].assignedEmployee, 'joey'); assert.equal(o.builds[0].steps[0].assignedEmployee, 'rio'); assert.equal(o.builds[0].steps[0].assignment.claimedBy, 'rio');
  o.builds[0].steps[0].assignment = vetoPick.record; o.builds[0].assignedEmployee = 'py';
  s = store.absorbOrchestrator(s, 'all', o, { now: at(10) });
  assert.equal(s.builds[0].steps[0].assignedEmployee, 'tia', 'the column follows the record');
  assert.equal(s.builds[0].assignedEmployee, 'joey', 'a bare column write does not override a record: changing who has it is a pick');
  assert.equal(s.builds[0].assignment.assignedEmployee, 'joey');
  const colOnly = store.absorbOrchestrator(store.emptyStore(AT), 'all', { builds: [{ id: 'c', title: 'C', assignedEmployee: 'py', steps: [{ id: 's1', text: 'x', assignedEmployee: 'tia' }] }] }, { now: AT });
  assert.equal(colOnly.builds[0].assignment.status, 'assigned'); assert.equal(colOnly.builds[0].steps[0].assignment.assignedEmployee, 'tia', 'a column alone reads as assigned');
  assert.deepEqual(store.validateStore(s).errors, []);
});
t('merge: two sessions, one claimed and one returned the brief: the later record wins and the briefs survive', () => {
  const base = store.normBuild({ id: 'b', title: 'B', updatedAt: at(10), steps: [{ id: 's1', uid: 'u1', text: 'one', updatedAt: at(10), assignment: open }] }, { now: AT });
  const ours = store.normBuild({ id: 'b', title: 'B', updatedAt: at(500), steps: [{ id: 's1', uid: 'u1', text: 'one', updatedAt: at(500), assignment: folded.record }], assignment: { status: 'assigned', assignedEmployee: 'joey', updatedAt: at(500) } }, { now: AT });
  const m = store.normBuild(mergeBuild(base, ours));
  assert.equal(m.steps[0].assignment.status, 'returned'); assert.equal(m.steps[0].assignedEmployee, 'rio'); assert.equal(m.assignedEmployee, 'joey');
  const back = store.normBuild(mergeBuild(ours, base));
  assert.equal(back.steps[0].assignment.status, 'returned', 'order does not matter');
  const olderWithEmployee = store.normBuild({ ...base, updatedAt: at(900), assignment: { status: 'assigned', assignedEmployee: 'tia', updatedAt: at(900) }, steps: [{ ...base.steps[0], updatedAt: at(900), assignment: null, assignedEmployee: '' }] });
  const m2 = store.normBuild(mergeBuild(olderWithEmployee, ours));
  assert.equal(m2.assignedEmployee, 'tia', 'the newer build-level record wins');
  assert.equal(m2.steps[0].assignedEmployee, 'rio', 'a copy with no record never blanks the employee');
  const S1 = store.normalizeStore({ ...store.emptyStore(AT), builds: [base] }); const S2 = store.normalizeStore({ ...store.emptyStore(AT), builds: [ours] });
  const ms = mergeStores(S1, S2);
  assert.equal(ms.store.builds[0].steps[0].assignment.briefs.length, 1); assert.deepEqual(ms.taken, ['b']);
});

/* ---- snapshots are current ---- */
t('schema snapshots are current (axf schemas)', () => {
  const want = A.jsonSchemas()['assignment.schema.json'];
  assert.deepEqual(read('framework/schemas/json/assignment.schema.json'), want, 'framework/schemas/json/assignment.schema.json is stale: node framework/cli/axf.mjs schemas');
  assert.deepEqual(read('framework/schemas/assignment.json'), JSON.parse(JSON.stringify(A.REGISTRY)), 'framework/schemas/assignment.json is stale: node framework/cli/axf.mjs schemas');
  const docCopy = '_claude/builds/contracts/assignment@1.schema.json';
  assert.ok(existsSync(join(ROOT, docCopy)) && existsSync(join(ROOT, '_claude/builds/contracts/assignment@1.md')), 'the contract doc and its schema copy live in _claude/builds/contracts/');
  assert.deepEqual(read(docCopy), want, `${docCopy} is stale: node framework/cli/axf.mjs schemas`);
  const sw = read('framework/schemas/json/swarm-state.schema.json');
  assert.ok(JSON.stringify(sw).includes('axf/assignment.schema.json#/$defs/payload'), 'the swarm message schema points at the assignment payload');
});

console.log(`✓ build-assignment: ${n} checks passed`);
