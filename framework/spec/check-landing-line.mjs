#!/usr/bin/env node
/**
 * landing-line@1 conformance: one line, one entry at a time, cancelled runs are never a verdict, red files a fix and
 * the line moves on, hands can pause / skip / move, and the merge queue migrates in its old order.
 *   node framework/spec/check-landing-line.mjs           check
 *   node framework/spec/check-landing-line.mjs --write   regenerate the expected output of fixtures/landing-line-migrate.json
 *                                                        (the migration) and fixtures/landing-line.json (`landNow`: a clean
 *                                                        green PR lands at once)
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../core/landing-line.mjs';
import { clashBounceStep } from '../../apps/console-web/plugins/build-orchestrator/pipeline-core.mjs'; // land-clash bounce: the dispatcher's side of a conflict (axf-plugin:build-orchestrator)

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/landing-line-migrate.json');
const LINE_FIX = join(ROOT, 'framework/spec/fixtures/landing-line.json');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/landing-line.json'), 'utf8'));
const WRITE = process.argv.includes('--write');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-14T22:15:48Z';
const T = (k) => `2026-11-14T22:${String(16 + k).padStart(2, '0')}:00Z`;

// ------------------------------------------------------------------ the migration fixture (before → after)

/** A merge queue as the runner left it on Nov 14 2026: a batch of two under test, two more behind, one kicked, one removed by hand, one held by UI Review, three merged. */
const QUEUE_IN = {
  $axf: 'merge-queue@1', at: '2026-11-14T22:10:00Z', on: true, mode: 'batch', mainSha: 'e4cd99aa8000000000000000000000000000000a', expect: 'e4cd99aa8000000000000000000000000000000a', avgMin: 14,
  history: [13, 15, 14],
  batch: { members: [{ pr: 540, head: 'a540a540a540a540a540a540a540a540a540a540' }, { pr: 541, head: 'b541b541b541b541b541b541b541b541b541b541' }], sha: 'ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4', base: 'e4cd99aa8000000000000000000000000000000a', builtAt: '2026-11-14T22:01:00Z', startedAt: '2026-11-14T22:02:00Z', ci: 'running', failing: [], runUrl: 'https://github.com/MossesX/AmberX-AXF/actions/runs/9001', bisect: false },
  split: [],
  stack: [],
  items: [
    { pr: 540, title: 'Skins: hot-swap tokens', url: 'https://github.com/MossesX/AmberX-AXF/pull/540', branch: 'claude/skins-hot-swap', head: 'a540a540a540a540a540a540a540a540a540a540', build: 'skins-hot-swap', agent: 'Opus', priority: 'P1', state: 'testing', ci: 'running', queueBranch: 'queue/batch', queueSha: 'ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4', ahead: [], inBatch: true, runUrl: 'https://github.com/MossesX/AmberX-AXF/actions/runs/9001', why: '', etaMin: 9, prCi: 'success' },
    { pr: 541, title: 'Help: coverage gate', url: 'https://github.com/MossesX/AmberX-AXF/pull/541', branch: 'claude/help-coverage', head: 'b541b541b541b541b541b541b541b541b541b541', build: 'help-coverage-gate', agent: 'Fable', priority: 'P2', state: 'testing', ci: 'running', queueBranch: 'queue/batch', queueSha: 'ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4ba7c4', ahead: [], inBatch: true, runUrl: 'https://github.com/MossesX/AmberX-AXF/actions/runs/9001', why: '', etaMin: 9, prCi: 'none' },
    { pr: 543, title: 'Notes: nested lists', url: 'https://github.com/MossesX/AmberX-AXF/pull/543', branch: 'claude/notes-nested', head: 'c543c543c543c543c543c543c543c543c543c543', build: 'notes-nested-lists', agent: 'Opus', priority: 'P2', state: 'waiting', ci: '', why: 'conflicts in code with #540; goes in the next batch', etaMin: 28, prCi: 'success' },
    { pr: 539, title: 'Push banner: quiet hours', url: 'https://github.com/MossesX/AmberX-AXF/pull/539', branch: 'claude/quiet-hours', head: 'd539d539d539d539d539d539d539d539d539d539', build: 'push-quiet-hours', agent: 'Opus', priority: 'P3', state: 'waiting', ci: '', why: '', etaMin: 28, prCi: 'success' },
  ],
  waiting: [
    { pr: 537, title: 'Voice: wake word', url: 'https://github.com/MossesX/AmberX-AXF/pull/537', branch: 'claude/wake-word', head: 'e537e537e537e537e537e537e537e537e537e537', build: 'voice-wake-word', agent: 'Opus', state: 'kicked', why: 'kicked out: #537 broke CI when tested on top of main (failed: android / conformance). Run: https://github.com/MossesX/AmberX-AXF/actions/runs/8990 Push a fix and it rejoins by itself.', prCi: 'success' },
    { pr: 535, title: 'Console: dock sizes', url: 'https://github.com/MossesX/AmberX-AXF/pull/535', branch: 'claude/dock-sizes', head: 'f535f535f535f535f535f535f535f535f535f535', build: 'console-dock-sizes', agent: 'Opus', state: 'held', why: 'taken out of the queue by hand (waiting for the skins build)', prCi: 'success' },
    { pr: 544, title: 'UI Review: phone shots', url: 'https://github.com/MossesX/AmberX-AXF/pull/544', branch: 'claude/phone-shots', head: 'a544a544a544a544a544a544a544a544a544a544', build: 'ui-review-phone-shots', agent: 'Opus', state: 'held', why: 'its screenshots wait for Brett in UI Review', prCi: 'success' },
    { pr: 545, title: 'Draft: nothing yet', url: 'https://github.com/MossesX/AmberX-AXF/pull/545', branch: 'claude/draft', head: 'b545b545b545b545b545b545b545b545b545b545', build: '', agent: '', state: 'held', why: 'it is a draft', prCi: 'none' },
  ],
  kicked: [
    { pr: 537, title: 'Voice: wake word', head: 'e537e537e537e537e537e537e537e537e537e537', why: '#537 broke CI when tested on top of main (failed: android / conformance). Run: https://github.com/MossesX/AmberX-AXF/actions/runs/8990', at: '2026-11-14T21:40:00Z', runUrl: 'https://github.com/MossesX/AmberX-AXF/actions/runs/8990' },
    { pr: 530, title: 'Closed meanwhile', head: '0530053005300530053005300530053005300530', why: '#530 conflicts with main in code (framework/ui/axf.css). Merge main in and fix them.', at: '2026-11-14T20:00:00Z' },
  ],
  merged: [
    { pr: 538, title: 'Builds: live clear backlog', sha: 'e4cd99aa8000000000000000000000000000000a', queueSha: '1111111111111111111111111111111111111111', at: '2026-11-14T21:55:00Z', retested: false, branch: 'queue/batch', agent: 'Opus', batch: [538, 536] },
    { pr: 536, title: 'Land: skin builds', sha: 'e4cd99aa8000000000000000000000000000000a', queueSha: '1111111111111111111111111111111111111111', at: '2026-11-14T21:55:00Z', retested: false, branch: 'queue/batch', agent: 'Fable', batch: [538, 536] },
    { pr: 533, title: 'Stack mode leftover', sha: '2222222222222222222222222222222222222222', queueSha: '3333333333333333333333333333333333333333', at: '2026-11-14T19:30:00Z', retested: false, branch: 'queue/pr-533', agent: 'Opus' },
  ],
  lastLanded: ['claude/live-clear-backlog', 'claude/land-skin-builds'],
  enlisted: [],
};
const CONTROL_IN = {
  $axf: 'merge-queue-control@1', updatedAt: '2026-11-14T22:05:00Z',
  order: [540, 541],
  removed: { 535: { why: 'waiting for the skins build', head: 'f535f535f535f535f535f535f535f535f535f535', at: '2026-11-14T21:50:00Z' } },
  kicked: { 537: { why: '#537 broke CI when tested on top of main (failed: android / conformance). Run: https://github.com/MossesX/AmberX-AXF/actions/runs/8990', head: 'e537e537e537e537e537e537e537e537e537e537', at: '2026-11-14T21:40:00Z' } },
  added: [543],
};
/** A stack-mode queue (the Nov 4 shape): two queue/pr-* refs, the second built on the first. */
const STACK_IN = {
  $axf: 'merge-queue@1', mode: 'stack', mainSha: 'abcabcabcabcabcabcabcabcabcabcabcabcabca',
  stack: [
    { pr: 600, head: 'a600a600a600a600a600a600a600a600a600a600', ahead: [], sha: '6000600060006000600060006000600060006000', base: 'abcabcabcabcabcabcabcabcabcabcabcabcabca', builtAt: '2026-11-14T21:00:00Z', startedAt: '2026-11-14T21:01:00Z', ci: 'success', failing: [], runUrl: 'https://x/run/600' },
    { pr: 601, head: 'a601a601a601a601a601a601a601a601a601a601', ahead: [600], sha: '6010601060106010601060106010601060106010', base: '6000600060006000600060006000600060006000', builtAt: '2026-11-14T21:00:00Z', ci: 'running', failing: [] },
  ],
  items: [
    { pr: 600, title: 'First', branch: 'claude/first', head: 'a600a600a600a600a600a600a600a600a600a600', build: 'first', state: 'passed', ci: 'success', queueBranch: 'queue/pr-600', queueSha: '6000600060006000600060006000600060006000', ahead: [], etaMin: 1 },
    { pr: 601, title: 'Second', branch: 'claude/second', head: 'a601a601a601a601a601a601a601a601a601a601', build: 'second', state: 'testing', ci: 'running', queueBranch: 'queue/pr-601', queueSha: '6010601060106010601060106010601060106010', ahead: [600], etaMin: 7 },
    { pr: 602, title: 'Third', branch: 'claude/third', head: 'a602a602a602a602a602a602a602a602a602a602', build: 'third', state: 'waiting', ci: '', etaMin: 21 },
  ],
  waiting: [], kicked: [], merged: [],
};
const IN = { batch: { queue: QUEUE_IN, control: CONTROL_IN, at: AT }, stack: { queue: STACK_IN, control: {}, at: AT }, empty: { queue: {}, control: {}, at: AT } };
const actual = Object.fromEntries(Object.entries(IN).map(([k, c]) => [k, L.migrateMergeQueue(c.queue, c.control, { at: c.at })]));
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'landing-line-migrate@1', note: 'Generated by framework/spec/check-landing-line.mjs --write; every port replays `in` (merge-queue@1 state + control) and must answer `out` (landing-line@1 + what to drop).', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ a small schema check (no ajv on the host)

/** Enough of JSON Schema for this record: type, const, enum, required, properties, items, pattern, anyOf, $ref into $defs. */
function validate(schema, v, path = '$', errs = []) {
  const s = schema.$ref ? SCHEMA.$defs[schema.$ref.split('/').pop()] : schema;
  const type = Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v;
  if (s.const !== undefined && v !== s.const) errs.push(`${path}: not ${s.const}`);
  if (s.type && !(s.type === type || (s.type === 'number' && type === 'integer'))) errs.push(`${path}: ${type}, want ${s.type}`);
  if (s.enum && !s.enum.includes(v)) errs.push(`${path}: ${JSON.stringify(v)} not in enum`);
  if (s.pattern && typeof v === 'string' && !new RegExp(s.pattern).test(v)) errs.push(`${path}: ${v} fails ${s.pattern}`);
  if (s.maxLength && typeof v === 'string' && v.length > s.maxLength) errs.push(`${path}: too long`);
  if (s.minimum !== undefined && typeof v === 'number' && v < s.minimum) errs.push(`${path}: below ${s.minimum}`);
  if (s.maxItems && Array.isArray(v) && v.length > s.maxItems) errs.push(`${path}: over ${s.maxItems} items`);
  if (s.anyOf && !s.anyOf.some((o) => !validate(o, v, path, []).length)) errs.push(`${path}: matches none of anyOf`);
  if (type === 'object' && v) {
    for (const r of s.required || []) if (!(r in v)) errs.push(`${path}.${r}: missing`);
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in v) validate(sub, v[k], `${path}.${k}`, errs);
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => validate(s.items, x, `${path}[${i}]`, errs));
  return errs;
}
const schemaOk = (line, name) => { const errs = validate(SCHEMA, line); assert.deepEqual(errs, [], `${name} fails the schema`); assert.deepEqual(L.validateLine(line), { ok: true, errors: [] }, `${name} fails validateLine`); };

t('schema and engine agree on the vocabularies', () => {
  assert.deepEqual(SCHEMA.$defs.state.enum, [...L.STATES]);
  assert.deepEqual(SCHEMA.$defs.inFlight.enum, [...L.IN_FLIGHT]);
  assert.deepEqual(SCHEMA.$defs.terminal.enum, [...L.TERMINAL]);
  assert.deepEqual(SCHEMA.$defs.attemptResult.enum, [...L.ATTEMPT_RESULTS]);
  assert.deepEqual(SCHEMA.$defs.event.enum, [...L.EVENTS]);
  assert.equal(SCHEMA.properties.$axf.const, L.LINE_FRAME);
  assert.equal(SCHEMA.$defs.entry.properties.$axf.const, L.ENTRY_FRAME);
  assert.equal(SCHEMA.$defs.attempt.properties.$axf.const, L.ATTEMPT_FRAME);
  for (const s of L.STATES) { assert.ok(L.STATE_LABEL[s], `label ${s}`); assert.ok(L.STATE_TONE[s], `tone ${s}`); }
});
for (const k of Object.keys(actual)) t(`migrated line fits the schema: ${k}`, () => schemaOk(actual[k].line, k));

// ------------------------------------------------------------------ migration: order kept, history kept, stack fields gone

t('migration: the queue order is the line order, held PRs behind, nothing in flight', () => {
  const { line, drop, notes } = actual.batch;
  assert.deepEqual(line.entries.map((e) => e.id), ['pr-540', 'pr-541', 'pr-543', 'pr-539', 'pr-537', 'pr-535', 'pr-544', 'pr-545']);
  assert.deepEqual(line.entries.map((e) => e.state), ['waiting', 'waiting', 'waiting', 'waiting', 'fix-filed', 'paused', 'waiting', 'waiting']);
  assert.equal(L.inFlight(line), null);
  assert.equal(L.next(line).id, 'pr-540'); // the runner starts the front one; its batch run is not reused
  assert.equal(line.entries[0].attempts[0].result, 'aborted');
  assert.match(line.entries[0].attempts[0].why, /queue\/batch/);
  assert.equal(line.entries[2].note, 'conflicts in code with #540; goes in the next batch');
  assert.equal(line.entries[2].attempts.length, 0);
  assert.equal(line.entries[6].hold, 'its screenshots wait for Brett in UI Review');
  assert.equal(line.entries[7].hold, 'it is a draft');
  assert.equal(line.mainSha, QUEUE_IN.mainSha);
  assert.deepEqual(line.migratedFrom, { frame: 'merge-queue@1', at: AT, entries: 8, landed: 3 });
  assert.deepEqual(drop.branches, ['queue/batch']);
  assert.deepEqual(drop.files, ['merge-queue.json', 'merge-queue-control.json']);
  assert.ok(notes.some((x) => /manual order/.test(x)) && notes.some((x) => /add back/.test(x)));
});
t('migration: a kick-out is a fix-filed entry with its words and one red attempt; a hand removal is paused', () => {
  const { line } = actual.batch;
  const k = line.entries.find((e) => e.id === 'pr-537');
  assert.equal(k.state, 'fix-filed');
  assert.equal(k.since, '2026-11-14T21:40:00Z');
  assert.equal(k.outcome.kind, 'ci');
  assert.match(k.outcome.text, /#537 broke CI/);
  assert.equal(k.attempts.length, 1);
  assert.equal(k.attempts[0].result, 'red');
  assert.equal(k.attempts[0].runUrl, 'https://github.com/MossesX/AmberX-AXF/actions/runs/8990');
  assert.equal(k.fix.id, 'fix-voice-wake-word-e537e53');
  assert.equal(k.fix.kind, 'ci');
  const p = line.entries.find((e) => e.id === 'pr-535');
  assert.equal(p.state, 'paused');
  assert.equal(p.outcome.text, 'waiting for the skins build');
  assert.equal(p.pausedFrom, 'waiting');
  assert.ok(!line.entries.some((e) => e.pr === 530), 'a kicked PR that is no longer open is not in the line');
});
t('migration: merged PRs are landed history, oldest first, with the queue commit kept as legacy', () => {
  const { line } = actual.batch;
  assert.deepEqual(line.history.map((h) => h.id), ['pr-533', 'pr-538', 'pr-536']);
  assert.ok(line.history.every((h) => h.state === 'landed' && h.attempts[0].result === 'landed'));
  assert.equal(line.history[1].landedSha, QUEUE_IN.mainSha);
  assert.deepEqual(line.history[1].legacy.batch, [538, 536]);
  assert.match(line.history[1].attempts[0].note, /batch of 2/);
  assert.equal(line.history[0].legacy.branch, 'queue/pr-533');
});
t('migration: stack fields are gone from every entry; what the old record said stays under legacy', () => {
  for (const e of [...actual.batch.line.entries, ...actual.stack.line.entries]) {
    for (const f of L.LEGACY_STACK_FIELDS) assert.ok(!(f in e) || f === 'state', `${e.id} still has ${f}`);
    assert.ok(!('etaMin' in e) && !('ahead' in e) && !('queueSha' in e));
  }
  const s = actual.stack;
  assert.deepEqual(s.line.entries.map((e) => e.id), ['pr-600', 'pr-601', 'pr-602']);
  assert.deepEqual(s.line.entries.map((e) => e.state), ['waiting', 'waiting', 'waiting']);
  assert.deepEqual(s.line.entries[1].legacy.ahead, [600]);
  assert.deepEqual(s.drop.branches, ['queue/pr-600', 'queue/pr-601']);
  assert.equal(s.line.entries[0].attempts[0].result, 'aborted'); // a green stack run is not a landing: it lands on its own run
  assert.match(s.line.entries[0].attempts[0].why, /queue\/pr-600 \(60006000\)/);
  assert.equal(s.line.entries[2].attempts.length, 0);
});
t('migration: an empty or missing queue is an empty line; running it twice adds nothing', () => {
  assert.deepEqual(actual.empty.line.entries, []);
  assert.deepEqual(actual.empty.line.history, []);
  assert.deepEqual(actual.empty.drop.branches, []);
  const again = L.migrateMergeQueue(QUEUE_IN, CONTROL_IN, { at: AT });
  assert.deepEqual(again.line, actual.batch.line);
});

// ------------------------------------------------------------------ the state machine

const sha = (c, k = 0) => `${c}${String(k)}`.padEnd(40, c);
const add = (line, pr, k, extra = {}) => L.transition(line, { type: 'add', at: T(0), entry: { pr, build: `b${pr}`, branch: `claude/b${pr}`, title: `Build ${pr}`, head: sha(k), ...extra } });
const run = (conclusion, head, name = 'ci', status = 'completed', extra = {}) => ({ name, status, conclusion, head_sha: head, html_url: `https://x/run/${name}`, ...extra });
const fresh = () => { let l = L.emptyLine(T(0)); l = add(l, 701, '1'); l = add(l, 702, '2'); l = add(l, 703, '3'); return l; };
const fly = (l, id, k) => {
  l = L.transition(l, { type: 'start', id, at: T(k), mainSha: sha('f', k) });
  l = L.transition(l, { type: 'merged-main', id, at: T(k + 1), sha: sha('a', k) });
  l = L.transition(l, { type: 'regenerated', id, at: T(k + 2), head: sha('b', k) });
  return l;
};

t('transitions: the happy path, one attempt, the entry retires into history', () => {
  let l = fresh();
  assert.equal(L.next(l).id, 'pr-701');
  l = fly(l, 'pr-701', 1);
  assert.equal(l.entries[0].state, 'checking');
  assert.equal(l.entries[0].head, sha('b', 1));
  assert.equal(L.next(l), null, 'nothing starts while one is in flight');
  assert.throws(() => L.transition(l, { type: 'start', id: 'pr-702', at: T(4) }), /one at a time/);
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(4), runs: [run('success', sha('b', 1))] });
  assert.equal(l.entries[0].state, 'landing');
  l = L.transition(l, { type: 'landed', id: 'pr-701', at: T(5), sha: sha('f', 2) });
  assert.deepEqual(l.entries.map((e) => e.id), ['pr-702', 'pr-703']);
  assert.equal(l.history[0].state, 'landed');
  assert.equal(l.history[0].landedSha, sha('f', 2));
  assert.deepEqual(l.history[0].attempts.map((a) => [a.n, a.result, a.steps]), [[1, 'landed', ['merging-main', 'regenerating', 'checking', 'landing', 'landed']]]);
  assert.equal(L.next(l).id, 'pr-702');
  schemaOk(l, 'happy path');
  // adding the landed head again is a no-op; a new head is a new entry
  assert.equal(add(l, 701, '1', { head: sha('b', 1) }).entries.length, 2);
  assert.equal(add(l, 701, '9').entries.length, 3);
});
t('transitions: the engine never mutates its input', () => {
  const l = fresh(); const snap = JSON.stringify(l);
  fly(l, 'pr-701', 1);
  assert.equal(JSON.stringify(l), snap);
});
t('transitions: every illegal move throws with the state named', () => {
  let l = fresh();
  for (const type of ['merged-main', 'regenerated', 'check', 'land', 'landed', 'land-rejected', 'resume', 'rejoin', 'main-moved']) assert.throws(() => L.transition(l, { type, id: 'pr-701', at: T(1) }), /not allowed from waiting/, type);
  assert.throws(() => L.transition(l, { type: 'nope', id: 'pr-701' }), /unknown event/);
  assert.throws(() => L.transition(l, { type: 'start', id: 'pr-999', at: T(1) }), /no entry/);
  l = fly(l, 'pr-701', 1);
  assert.throws(() => L.transition(l, { type: 'start', id: 'pr-701', at: T(4) }), /not allowed from checking/);
  assert.throws(() => L.transition(l, { type: 'land', id: 'pr-701', at: T(4) }), /not green/);
  assert.throws(() => L.transition(l, { type: 'conflict', id: 'pr-701', at: T(4) }), /not allowed from checking/);
});
t('transitions: the line off holds new starts; the one in flight finishes', () => {
  let l = fly(fresh(), 'pr-701', 1);
  l = L.transition(l, { type: 'off', at: T(4), by: 'Brett' });
  assert.equal(L.next(l), null);
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(5), runs: [run('success', sha('b', 1))] });
  l = L.transition(l, { type: 'landed', id: 'pr-701', at: T(6), sha: sha('f', 2) });
  assert.equal(L.next(l), null, 'off: nothing new starts');
  assert.throws(() => L.transition(l, { type: 'start', id: 'pr-702', at: T(7) }), /line is off/);
  l = L.transition(l, { type: 'on', at: T(8), by: 'Brett' });
  assert.equal(L.next(l).id, 'pr-702');
  assert.equal(L.chip(L.transition(l, { type: 'off', at: T(9) })).paused, true);
});

// ------------------------------------------------------------------ check runs: cancelled / superseded / stale re-run, failure / timed_out are red

t('classifyCheckRun: only success is green and only failure / timed_out are red', () => {
  const h = sha('b', 1);
  const v = (r) => L.classifyCheckRun(r, { head: h });
  assert.deepEqual(v(run('success', h)), { verdict: 'green', reason: 'success', name: 'ci' });
  assert.equal(v(run('neutral', h)).verdict, 'green');
  assert.deepEqual(v(run('failure', h, 'android')), { verdict: 'red', reason: 'failure', name: 'android' });
  assert.equal(v(run('timed_out', h)).verdict, 'red');
  assert.equal(v(run('action_required', h)).verdict, 'red');
  assert.equal(v(run('startup_failure', h)).verdict, 'red');
  assert.deepEqual(v(run('cancelled', h)), { verdict: 'retry', reason: 'cancelled', name: 'ci' });
  assert.deepEqual(v(run('stale', h)), { verdict: 'retry', reason: 'stale', name: 'ci' });
  assert.deepEqual(v(run('success', sha('b', 0))), { verdict: 'retry', reason: 'superseded', name: 'ci' }, 'a run on another head is superseded, even a green one');
  assert.equal(v(run('failure', sha('b', 0))).verdict, 'retry', 'a red run on an old head is not this head\'s failure');
  assert.equal(v(run(null, h, 'ci', 'in_progress')).verdict, 'running');
  assert.equal(v(run(null, h, 'ci', 'queued')).verdict, 'running');
  assert.deepEqual(v(run('skipped', h)), { verdict: 'ignore', reason: 'skipped', name: 'ci' });
  assert.deepEqual(v(run('failure', h, 'CodeRabbit', 'completed', { app: { slug: 'coderabbitai' } })), { verdict: 'ignore', reason: 'not-ours', name: 'CodeRabbit' });
  assert.equal(v(run('', h)).verdict, 'retry', 'completed with no conclusion is not a result');
  assert.equal(L.classifyCheckRun(run('success', h)).verdict, 'green', 'no head to compare: the run counts');
});
t('classifyCheckRuns: red beats running beats retry beats green; nothing ours is none', () => {
  const h = sha('b', 1);
  const c = (runs) => L.classifyCheckRuns(runs, { head: h });
  assert.deepEqual(c([run('success', h, 'a'), run('failure', h, 'b'), run('cancelled', h, 'c')]), { verdict: 'red', failing: ['b'], retry: [] });
  assert.equal(c([run('success', h, 'a'), run(null, h, 'b', 'in_progress'), run('cancelled', h, 'c')]).verdict, 'running');
  assert.deepEqual(c([run('success', h, 'a'), run('cancelled', h, 'c'), run('success', sha('b', 0), 'd')]), { verdict: 'retry', failing: [], retry: ['c: cancelled', 'd: superseded'] });
  assert.equal(c([run('success', h, 'a'), run('skipped', h, 'b')]).verdict, 'green');
  assert.equal(c([run('skipped', h, 'b'), run('failure', h, 'cr', 'completed', { app: { slug: 'coderabbitai' } })]).verdict, 'none');
  assert.equal(c([]).verdict, 'none');
});
t('checking: a cancelled run keeps the entry checking, logs a retry on the attempt, never a failure', () => {
  let l = fly(fresh(), 'pr-701', 1);
  const h = sha('b', 1);
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(4), runs: [run('cancelled', h)] });
  assert.equal(l.entries[0].state, 'checking');
  assert.equal(l.entries[0].ci.verdict, 'retry');
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(5), runs: [run('success', sha('b', 0))] }); // superseded (old head)
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(6), runs: [run('stale', h)] });
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(7), runs: [run(null, h, 'ci', 'in_progress')] });
  assert.equal(l.entries[0].ci.verdict, 'running');
  assert.equal(l.entries[0].since, T(3), 'running / none do not restart the clock');
  assert.equal(l.entries[0].attempts.length, 1, 'one attempt: re-runs are not new attempts');
  assert.deepEqual(l.entries[0].attempts[0].retries.map((r) => r.why), [['ci: cancelled'], ['ci: superseded'], ['ci: stale']]);
  assert.equal(L.view(l).items[0].retries, 3);
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(8), runs: [run('success', h)] });
  assert.equal(l.entries[0].state, 'landing');
  assert.ok(!l.entries[0].fix && !l.entries[0].outcome, 'no fix was filed for the cancelled runs');
  schemaOk(l, 'after retries');
});

// ------------------------------------------------------------------ red → fix filed, the line advances

t('red: a failure files one fix for (entry, head) and the next entry is up at once', () => {
  let l = fly(fresh(), 'pr-701', 1);
  const h = sha('b', 1);
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(4), runs: [run('success', h, 'web'), run('timed_out', h, 'android'), run('failure', h, 'conformance')] });
  const e = l.entries[0];
  assert.equal(e.state, 'fix-filed');
  assert.equal(e.outcome.kind, 'ci');
  assert.match(e.outcome.text, /#701 broke CI when landed on main \(failed: android, conformance\)\. Run: https:\/\/x\/run\/web/);
  assert.equal(e.fix.id, `fix-b701-${h.slice(0, 7)}`);
  assert.equal(e.fix.priority, 'P1');
  assert.deepEqual(e.fix.failing, ['android', 'conformance']);
  assert.equal(e.attempts[0].result, 'red');
  assert.equal(e.attempts[0].fix, e.fix.id);
  assert.ok(e.attempts[0].endedAt);
  assert.equal(L.inFlight(l), null);
  assert.equal(L.next(l).id, 'pr-702', 'the line moves on; the red one keeps its place');
  assert.deepEqual(l.entries.map((x) => x.id), ['pr-701', 'pr-702', 'pr-703']);
  assert.equal(L.chip(l).fixes, 1);
  assert.equal(L.chip(l).tone, 'warning');
  // the fix lands on the branch: it rejoins, waiting, with a new head and a second attempt when started
  assert.throws(() => L.transition(l, { type: 'rejoin', id: 'pr-701', at: T(5), head: h }), /new head/);
  l = L.transition(l, { type: 'rejoin', id: 'pr-701', at: T(5), head: sha('c', 1) });
  assert.equal(l.entries[0].state, 'waiting');
  assert.ok(!l.entries[0].fix && !l.entries[0].outcome);
  l = fly(l, 'pr-701', 6);
  assert.equal(l.entries[0].attempts.length, 2);
  assert.equal(l.entries[0].attempts[1].n, 2);
  assert.equal(l.entries[0].attempts[1].head, sha('c', 1));
  schemaOk(l, 'after rejoin');
});
t('red: a code conflict while merging main files a conflict fix with the files', () => {
  let l = L.transition(fresh(), { type: 'start', id: 'pr-701', at: T(1) });
  l = L.transition(l, { type: 'conflict', id: 'pr-701', at: T(2), files: ['framework/ui/axf.css', 'apps/console-web/src/x.tsx'] });
  const e = l.entries[0];
  assert.equal(e.state, 'fix-filed');
  assert.equal(e.outcome.kind, 'conflict');
  assert.equal(e.fix.kind, 'conflict');
  assert.deepEqual(e.fix.files, ['framework/ui/axf.css', 'apps/console-web/src/x.tsx']);
  assert.match(e.fix.text, /conflicts in code \(framework\/ui\/axf.css, apps\/console-web\/src\/x.tsx\)/);
  assert.equal(e.attempts[0].result, 'conflict');
  assert.equal(L.next(l).id, 'pr-702');
});
t('land-clash bounce: a conflict fix\'s files and head give a done build one merge-main step, once per head', () => {
  let l = L.transition(fresh(), { type: 'start', id: 'pr-701', at: T(1), head: 'abc1234abc1234abc1234abc1234abc1234abc12' });
  l = L.transition(l, { type: 'conflict', id: 'pr-701', at: T(2), files: ['framework/spec/check-ci-scope.mjs'] });
  const fix = l.entries[0].fix;
  const steps = Array.from({ length: 27 }, (_, i) => ({ id: `s${i + 1}`, text: `step ${i + 1}`, done: true }));
  const b = { id: 'phone-connect', branch: 'claude/phone-connect', steps };
  const st = clashBounceStep(b, { files: fix.files, head: fix.head });
  assert.equal(st.model, 'Opus');
  assert.match(st.text, /^Merge main into claude\/phone-connect and resolve conflicts in framework\/spec\/check-ci-scope\.mjs \(clash at abc1234\)/);
  assert.equal(clashBounceStep({ ...b, steps: [...steps, { id: 's28', ...st, done: true }] }, { files: fix.files, head: fix.head }), null, 'the same clash never adds a second step');
  assert.equal(clashBounceStep({ ...b, steps: [...steps, { id: 's28', ...st }] }, { files: fix.files, head: 'fff0000fff' }), null, 'steps open: no bounce');
});
t('main moved / merge rejected: the same entry goes round again, a new attempt, nothing else starts', () => {
  let l = fly(fresh(), 'pr-701', 1);
  l = L.transition(l, { type: 'main-moved', id: 'pr-701', at: T(4), mainSha: sha('f', 9) });
  assert.equal(l.entries[0].state, 'merging-main');
  assert.equal(l.entries[0].attempts.length, 2);
  assert.equal(l.entries[0].attempts[0].result, 'retry');
  assert.match(l.entries[0].attempts[0].why, /main moved/);
  assert.equal(L.next(l), null);
  l = L.transition(l, { type: 'merged-main', id: 'pr-701', at: T(5), sha: sha('a', 9) });
  l = L.transition(l, { type: 'regenerated', id: 'pr-701', at: T(6), head: sha('b', 9) });
  l = L.transition(l, { type: 'check', id: 'pr-701', at: T(7), runs: [run('success', sha('b', 9))] });
  l = L.transition(l, { type: 'land-rejected', id: 'pr-701', at: T(8), why: 'main moved' });
  assert.equal(l.entries[0].state, 'merging-main');
  assert.equal(l.entries[0].attempts.length, 3);
  assert.equal(l.entries[0].attempts[1].result, 'retry');
  schemaOk(l, 'after rejections');
});

// ------------------------------------------------------------------ hands: pause / skip / move / remove

t('pause: keeps its place, is passed over, resumes to waiting; pausing the one in flight frees the slot', () => {
  let l = fresh();
  l = L.transition(l, { type: 'pause', id: 'pr-701', at: T(1), why: 'wait for the skins build', by: 'Brett' });
  assert.equal(l.entries[0].state, 'paused');
  assert.equal(l.entries[0].pausedFrom, 'waiting');
  assert.equal(L.next(l).id, 'pr-702', 'a paused entry is passed over');
  assert.throws(() => L.transition(l, { type: 'pause', id: 'pr-701', at: T(2) }), /not allowed from paused/);
  l = L.transition(l, { type: 'resume', id: 'pr-701', at: T(2), by: 'Brett' });
  assert.equal(l.entries[0].state, 'waiting');
  assert.ok(!l.entries[0].pausedFrom && !l.entries[0].outcome);
  assert.equal(L.next(l).id, 'pr-701');
  l = fly(l, 'pr-701', 3);
  l = L.transition(l, { type: 'pause', id: 'pr-701', at: T(6), by: 'Brett' });
  assert.equal(l.entries[0].pausedFrom, 'checking');
  assert.equal(l.entries[0].attempts[0].result, 'aborted');
  assert.equal(L.inFlight(l), null);
  assert.equal(L.next(l).id, 'pr-702');
  schemaOk(l, 'paused in flight');
});
t('skip / remove: out of the line into history; the one in flight aborts its attempt', () => {
  let l = fly(fresh(), 'pr-701', 1);
  l = L.transition(l, { type: 'skip', id: 'pr-701', at: T(4), why: 'superseded by #703', by: 'Brett' });
  assert.deepEqual(l.entries.map((e) => e.id), ['pr-702', 'pr-703']);
  assert.equal(l.history[0].state, 'skipped');
  assert.equal(l.history[0].outcome.text, 'superseded by #703');
  assert.equal(l.history[0].attempts[0].result, 'aborted');
  assert.equal(L.next(l).id, 'pr-702');
  l = L.transition(l, { type: 'remove', id: 'pr-703', at: T(5), why: 'PR closed' });
  assert.deepEqual(l.entries.map((e) => e.id), ['pr-702']);
  assert.equal(l.history[1].outcome.kind, 'removed');
  assert.equal(L.view(l).skipped.length, 2);
  schemaOk(l, 'after skip / remove');
  // a skipped PR comes back when added again
  l = add(l, 701, '1');
  assert.deepEqual(l.entries.map((e) => e.id), ['pr-702', 'pr-701']);
});
t('move / move up: to an index, never ahead of the one in flight', () => {
  let l = fresh();
  l = L.transition(l, { type: 'move', id: 'pr-703', at: T(1), to: 0, by: 'Brett' });
  assert.deepEqual(l.entries.map((e) => e.id), ['pr-703', 'pr-701', 'pr-702']);
  assert.deepEqual(l.entries[0].moved, { at: T(1), by: 'Brett' });
  l = L.transition(l, { type: 'move', id: 'pr-703', at: T(2), to: 99 });
  assert.deepEqual(l.entries.map((e) => e.id), ['pr-701', 'pr-702', 'pr-703']);
  assert.throws(() => L.transition(l, { type: 'move', id: 'pr-703', at: T(2), to: -1 }), /0 = front/);
  l = fly(l, 'pr-701', 3);
  l = L.transition(l, { type: 'move', id: 'pr-703', at: T(6), to: 0 });
  assert.deepEqual(l.entries.map((e) => e.id), ['pr-701', 'pr-703', 'pr-702'], 'the in-flight entry keeps the front');
  l = L.moveUp(l, 'pr-702', { at: T(7), by: 'Brett' });
  assert.deepEqual(l.entries.map((e) => e.id), ['pr-701', 'pr-702', 'pr-703']);
  assert.deepEqual(L.moveUp(l, 'pr-702').entries.map((e) => e.id), ['pr-701', 'pr-702', 'pr-703'], 'cannot pass the one in flight');
  assert.throws(() => L.moveUp(l, 'pr-999'), /no entry/);
  assert.equal(L.next(l), null);
  schemaOk(l, 'after moves');
});
t('holds: a not-ready entry is passed over, never started by force', () => {
  let l = fresh();
  l = { ...l, entries: l.entries.map((e, i) => (i === 0 ? { ...e, hold: 'its screenshots wait for Brett in UI Review' } : e)) };
  assert.equal(L.next(l).id, 'pr-702');
  assert.throws(() => L.transition(l, { type: 'start', id: 'pr-701', at: T(1) }), /held/);
  assert.equal(L.view(l).items[0].why, 'not ready: its screenshots wait for Brett in UI Review');
});
t('entries by PR number, id or build; normEntry needs one of them', () => {
  const l = fresh();
  assert.equal(L.findEntry(l, 702).id, 'pr-702');
  assert.equal(L.findEntry(l, '702').id, 'pr-702');
  assert.equal(L.findEntry(l, 'b703').id, 'pr-703');
  assert.equal(L.findEntry(l, 'pr-701').id, 'pr-701');
  assert.equal(L.transition(l, { type: 'pause', id: 702, at: T(1) }).entries[1].state, 'paused');
  assert.equal(L.normEntry({ build: 'only-a-build' }).id, 'build-only-a-build');
  assert.equal(L.normEntry({ pr: '#44' }).pr, 44);
  assert.throws(() => L.normEntry({ title: 'nothing' }), /PR number or a build id/);
});
t('validateLine catches two in flight, a terminal entry in the line, a non-terminal one in history', () => {
  const l = fresh();
  const two = { ...l, entries: l.entries.map((e, i) => (i < 2 ? { ...e, state: 'checking' } : e)) };
  assert.ok(L.validateLine(two).errors.includes('one at a time'));
  const term = { ...l, entries: [{ ...l.entries[0], state: 'landed' }] };
  assert.ok(L.validateLine(term).errors.some((x) => x.startsWith('entry.state terminal')));
  const hist = { ...l, history: [{ ...l.entries[0], state: 'waiting' }] };
  assert.ok(L.validateLine(hist).errors.some((x) => x.startsWith('history.state')));
  assert.equal(L.validateLine({ $axf: 'nope' }).ok, false);
});
t('sequences: any run of events either applies cleanly or throws; the line is never left corrupt', () => {
  // a small deterministic generator (LCG) over the whole event vocabulary, 400 steps x 12 seeds
  const ids = ['pr-701', 'pr-702', 'pr-703', 'pr-704', 'pr-999'];
  const conclusions = ['success', 'failure', 'cancelled', 'stale', 'timed_out', 'neutral', 'skipped'];
  let applied = 0; let refused = 0;
  for (let seed = 1; seed <= 12; seed++) {
    let r = seed * 2654435761 % 4294967296;
    const rnd = (k) => { r = (r * 1664525 + 1013904223) % 4294967296; return r % k; };
    let l = fresh(); let k = 0;
    for (let step = 0; step < 400; step++) {
      const type = L.EVENTS[rnd(L.EVENTS.length)]; const id = ids[rnd(ids.length)]; k += 1;
      const at = `2026-11-15T${String(Math.floor(k / 60) % 24).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}:00Z`;
      const head = sha('b', rnd(10));
      const ev = { type, id, at, by: 'fuzz', why: 'fuzz', to: rnd(5), head, sha: head, mainSha: sha('f', rnd(10)), files: rnd(2) ? ['a.css'] : [], clean: rnd(3) === 0,
        entry: { pr: 700 + rnd(6), build: `b${rnd(6)}`, head, title: 'Fuzz' }, runs: [run(conclusions[rnd(conclusions.length)], rnd(3) ? (L.findEntry(l, id)?.head || head) : sha('z'))] };
      let next;
      try { next = L.transition(l, ev); applied += 1; } catch (e) { refused += 1; assert.ok(e instanceof Error && e.message, 'a refusal is an Error with words'); continue; }
      const v = L.validateLine(next);
      assert.deepEqual(v.errors, [], `seed ${seed} step ${step} ${type} ${id}: ${v.errors.join('; ')}`);
      assert.ok(L.liveEntries(next).length === next.entries.length, 'the line holds live entries only');
      assert.ok(!(L.next(next) && L.inFlight(next)), 'next is null while one is in flight');
      l = next;
    }
  }
  assert.ok(applied > 500 && refused > 500, `the generator reached both outcomes (${applied} applied, ${refused} refused)`);
});
// ------------------------------------------------------------------ a clean green PR lands at once (Brett, Nov 25 2026)
/*
 * Golden scenarios (fixtures/landing-line.json → landNow; regenerate with --write). Each replays its events on
 * an empty line; `out` is the entry's state after every event (or the refusal) and the attempts it leaves. A port
 * replays `in` and must answer `out`.
 */
const GREEN = sha('9');
const ADD = (pr, head = GREEN) => ({ type: 'add', at: T(0), entry: { pr, build: `b${pr}`, branch: `claude/b${pr}`, title: `Build ${pr}`, head } });
const LAND_NOW = [
  { name: 'clean and green: start goes straight to landing, then landed; main is never merged in and CI never runs again',
    events: [ADD(801), { type: 'start', id: 'pr-801', at: T(1), mainSha: sha('f', 1), clean: true, runs: [run('success', GREEN), run('skipped', GREEN, 'docs')] }, { type: 'landed', id: 'pr-801', at: T(2), sha: sha('c', 1) }] },
  { name: 'green but not known to merge as it is: the full path (merging-main)',
    events: [ADD(802), { type: 'start', id: 'pr-802', at: T(1), mainSha: sha('f', 1), runs: [run('success', GREEN)] }] },
  { name: 'clean but CI still running on the head: the full path',
    events: [ADD(803), { type: 'start', id: 'pr-803', at: T(1), clean: true, runs: [run(null, GREEN, 'ci', 'in_progress')] }] },
  { name: 'clean but the green run is for another head (superseded): not a result, the full path',
    events: [ADD(804), { type: 'start', id: 'pr-804', at: T(1), clean: true, runs: [run('success', sha('8'))] }] },
  { name: 'clean but one check is red: the full path, where the red is judged on the head main was merged into',
    events: [ADD(805), { type: 'start', id: 'pr-805', at: T(1), clean: true, runs: [run('success', GREEN), run('failure', GREEN, 'tests')] }] },
  { name: 'clean with no runs at all: nothing says green, the full path',
    events: [ADD(806), { type: 'start', id: 'pr-806', at: T(1), clean: true, runs: [] }] },
  { name: 'landed at once, then GitHub refuses the merge: the second attempt takes the full path',
    events: [ADD(807), { type: 'start', id: 'pr-807', at: T(1), clean: true, runs: [run('success', GREEN)] }, { type: 'land-rejected', id: 'pr-807', at: T(2), why: 'main moved: not mergeable' },
      { type: 'merged-main', id: 'pr-807', at: T(3), sha: sha('a', 7) }, { type: 'regenerated', id: 'pr-807', at: T(4), head: sha('b', 7) }, { type: 'check', id: 'pr-807', at: T(5), runs: [run('success', sha('b', 7))] }, { type: 'landed', id: 'pr-807', at: T(6), sha: sha('c', 7) }] },
  { name: 'one at a time: a clean green PR does not start while another entry is in flight, and lands at once when its turn comes',
    events: [ADD(808, sha('1')), ADD(809), { type: 'start', id: 'pr-808', at: T(1) }, { type: 'start', id: 'pr-809', at: T(2), clean: true, runs: [run('success', GREEN)] },
      { type: 'merged-main', id: 'pr-808', at: T(3), sha: sha('a', 8) }, { type: 'regenerated', id: 'pr-808', at: T(4), head: sha('b', 8) }, { type: 'check', id: 'pr-808', at: T(5), runs: [run('success', sha('b', 8))] }, { type: 'landed', id: 'pr-808', at: T(6), sha: sha('c', 8) },
      { type: 'start', id: 'pr-809', at: T(6), clean: true, runs: [run('success', GREEN)] }, { type: 'landed', id: 'pr-809', at: T(7), sha: sha('c', 9) }] },
  { name: 'a held or paused entry never lands at once',
    events: [{ type: 'add', at: T(0), entry: { pr: 810, build: 'b810', head: GREEN, hold: 'its screenshots wait for Brett in UI Review' } }, { type: 'start', id: 'pr-810', at: T(1), clean: true, runs: [run('success', GREEN)] }] },
];
const replayLandNow = (sc) => {
  let l = L.emptyLine(T(0)); const steps = [];
  for (const ev of sc.events) {
    try { l = L.transition(l, ev); } catch (e) { steps.push({ event: ev.type, id: ev.id || '', refused: e.message }); continue; }
    const id = ev.id || L.entryId(ev.entry); const e = L.findEntry(l, id) || l.history.find((x) => x.id === id);
    steps.push({ event: ev.type, id, state: e?.state || '', inFlight: L.inFlight(l)?.id || '' });
  }
  const all = [...l.entries, ...l.history];
  return { steps, entries: all.map((e) => ({ id: e.id, state: e.state, head: e.head, ci: e.ci?.verdict || '', attempts: e.attempts.map((a) => ({ n: a.n, steps: a.steps, result: a.result || '', ...(a.direct ? { direct: true } : {}) })) })), line: l };
};
const landNow = LAND_NOW.map((sc) => ({ name: sc.name, ...replayLandNow(sc) }));
const landNowOut = landNow.map(({ name, steps, entries }) => ({ name, steps, entries }));
if (WRITE) { const f = { $axf: 'landing-line-fixture@1', note: 'Generated by framework/spec/check-landing-line.mjs --write; every port replays `landNow.in` and must answer `landNow.out`.', landNow: { note: 'A clean green PR lands at once (landing-line@1 `start` with `clean` and green `runs`). Each scenario replays `events` on an empty line; `out` is the entry state after every event (or the refusal) and the attempts left.', in: LAND_NOW, out: landNowOut } }; writeFileSync(LINE_FIX, `${JSON.stringify(f, null, 1)}\n`); console.log(`wrote ${LINE_FIX} (landNow: ${LAND_NOW.length} scenarios)`); }
{ const f = JSON.parse(readFileSync(LINE_FIX, 'utf8'));
  t('landNow fixture inputs are the ones in this file', () => assert.ok(same(f.landNow?.in, LAND_NOW), 'landNow inputs drifted: run with --write'));
  for (const [i, sc] of landNowOut.entries()) t(`landNow replay: ${sc.name}`, () => assert.deepEqual(sc, f.landNow.out[i])); }
for (const sc of landNow) t(`landNow line fits the schema: ${sc.name}`, () => schemaOk(sc.line, sc.name));
t('a clean green PR lands at once: one attempt, landing only, marked direct, pinned to the head CI went green on', () => {
  const sc = landNow[0]; const e = sc.entries[0];
  assert.deepEqual(sc.steps.map((x) => x.state), ['waiting', 'landing', 'landed']);
  assert.deepEqual(e.attempts, [{ n: 1, steps: ['landing', 'landed'], result: 'landed', direct: true }]);
  assert.equal(e.head, GREEN, 'the head is the one the green runs are for: nothing was merged into it'); assert.equal(e.ci, 'green');
  assert.ok(!e.attempts[0].steps.some((s) => ['merging-main', 'regenerating', 'checking'].includes(s)));
});
t('anything short of clean and green takes the full path', () => {
  for (const i of [1, 2, 3, 4, 5]) { const sc = landNow[i]; assert.equal(sc.steps.at(-1).state, 'merging-main', sc.name); assert.deepEqual(sc.entries[0].attempts, [{ n: 1, steps: ['merging-main'], result: '' }], sc.name); }
  assert.deepEqual(L.landsAtOnce({ head: GREEN }, { clean: true, runs: [run('success', GREEN)] }), { ok: true, why: '', runUrl: 'https://x/run/ci' });
  assert.equal(L.landsAtOnce({ head: GREEN }, { clean: 'yes', runs: [run('success', GREEN)] }).ok, false, 'clean is true or it is not known');
  assert.equal(L.landsAtOnce({ head: GREEN }, { clean: true, runs: [run('cancelled', GREEN)] }).why, `CI on ${GREEN.slice(0, 8)} is retry`, 'a cancelled run is not a result');
  assert.equal(L.landsAtOnce({ head: '' }, { clean: true, runs: [run('success', GREEN)] }).ok, false, 'no head, nothing to pin the merge to');
});
t('a refused merge after landing at once: a second attempt on the full path lands it', () => {
  const e = landNow[6].entries[0];
  assert.deepEqual(e.attempts.map((a) => [a.steps, a.result, !!a.direct]), [[['landing'], 'retry', true], [['merging-main', 'regenerating', 'checking', 'landing', 'landed'], 'landed', false]]);
  assert.equal(e.state, 'landed');
});
t('landing at once is still one at a time, and never for a held entry', () => {
  const sc = landNow[7];
  assert.match(sc.steps[3].refused, /pr-808 is already in flight; one at a time/);
  assert.deepEqual(sc.steps.slice(-2).map((x) => [x.id, x.state]), [['pr-809', 'landing'], ['pr-809', 'landed']]);
  assert.ok(sc.steps.every((x) => x.refused || !x.inFlight || ['pr-808', 'pr-809'].includes(x.inFlight)));
  assert.match(landNow[8].steps[1].refused, /held/);
});
t('commands: every hand action the line offers is declared once, with a REST path and a CLI word', () => {
  const ids = L.LINE_COMMANDS.map((c) => c.id);
  assert.deepEqual(ids, ['landing-list', 'landing-add', 'landing-pause', 'landing-resume', 'landing-skip', 'landing-move', 'landing-move-up', 'landing-on']);
  for (const c of L.LINE_COMMANDS) { assert.ok(c.path.startsWith('/landing') && c.cli && c.title && c.description && ['read', 'write'].includes(c.effect), c.id); }
});

console.log(`check-landing-line: ${n} checks passed`);
