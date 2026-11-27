#!/usr/bin/env node
/**
 * stale-row@1 conformance: one row + its facts → the verdict every port must give, and the cleanup log record.
 *   node framework/spec/check-stale-rows.mjs           check
 *   node framework/spec/check-stale-rows.mjs --write   regenerate fixtures/stale-rows.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../core/stale-rows.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/stale-rows.json');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/stale-row.json'), 'utf8'));
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-16T12:00:00Z';

// ------------------------------------------------------------------ the cases (row + facts), one per way a row goes stale or stays
const merged = { number: 612, state: 'merged', mergedAt: '2026-11-16T10:00:00Z', mergeCommit: 'abcdef1234567890abcdef', url: 'https://github.com/MossesX/AmberX-AXF/pull/612' };
const IN = {
  // landed through the merge queue / landing line: the PR merged, the entry still sits in the line
  landedViaMergeQueue: { row: { kind: 'merge-queue', pr: 612, build: 'skins', branch: 'claude/skins', state: 'waiting' }, facts: { pr: merged, main: { landed: true, by: 'squash', commit: 'abcdef1234567890abcdef' }, build: { id: 'skins', status: 'built' }, branch: { name: 'claude/skins', exists: false }, session: { alive: false } } },
  // landed by a direct merge commit on main, no PR ever opened; the build row still says queued
  landedByMergeCommit: { row: { kind: 'queued', id: 'banner-fix', branch: 'claude/banner-fix' }, facts: { pr: null, main: { landed: true, by: 'merge-commit', commit: '1234567890abcdef1234' }, build: { id: 'banner-fix', status: 'queued' }, branch: { name: 'claude/banner-fix', exists: true }, session: { alive: false } } },
  // the PR was closed without a merge: the Pending build is abandoned
  closedUnmergedPr: { row: { kind: 'pending', id: 'old-idea', pr: '#77', branch: 'claude/old-idea' }, facts: { pr: { number: 77, state: 'closed' }, main: { landed: false }, build: { id: 'old-idea', status: 'pending' }, branch: { name: 'claude/old-idea', exists: false }, session: { alive: false } } },
  // the store says complete (mergedAt set) but the row in the Queue view never moved
  completeButQueued: { row: { kind: 'queued', id: 'dock-engine', status: 'queued' }, facts: { pr: null, main: null, build: { id: 'dock-engine', status: 'complete', mergedAt: '2026-11-15T20:00:00Z' }, branch: null, session: { alive: false } } },
  // a UI Review item still waiting for approval while its PR already merged: landed, never "approved"
  uiReviewPrMerged: { row: { kind: 'ui-review', id: 'r-20261115-9f1c', build: 'skins', pr: 612, status: 'pending' }, facts: { pr: merged, main: { landed: true, by: 'squash' }, build: { id: 'skins', status: 'complete' }, branch: null, session: null } },
  // a running build with a live session stays, whatever else the facts say
  runningMustStay: { row: { kind: 'building', id: 'watchdog', branch: 'claude/watchdog', pr: 9 }, facts: { pr: { number: 9, state: 'merged' }, main: { landed: true }, build: { id: 'watchdog', status: 'running' }, branch: { exists: true }, session: { alive: true, id: 'axf-watchdog' } } },
  // nothing looked up (or everything came back unknown): the row is left alone
  missingFactsMustStay: { row: { kind: 'pending', id: 'someday', branch: 'claude/someday' }, facts: {} },
  missingFactsNull: { row: { kind: 'queued', id: 'someday-2' }, facts: null },
  missingFactsUnknown: { row: { kind: 'merge-queue', pr: 44 }, facts: { pr: { number: 44, state: null }, main: { landed: null }, build: null, branch: { exists: null }, session: { alive: null } } },
  // Fable review of the first cut: the edges
  runningNoSessionKnown: { row: { kind: 'building', id: 'quiet' }, facts: { build: { id: 'quiet', status: 'running' }, session: null } },
  runningDeadSessionMerged: { row: { kind: 'building', id: 'done-late', pr: 20 }, facts: { pr: { number: 20, state: 'merged' }, build: { id: 'done-late', status: 'running' }, session: { alive: false } } },
  runningDeadSessionOpen: { row: { kind: 'building', id: 'crashed', pr: 21 }, facts: { pr: { number: 21, state: 'open' }, build: { id: 'crashed', status: 'running' }, session: { alive: false } } },
  openPr: { row: { kind: 'queued', id: 'in-review', pr: 3 }, facts: { pr: { number: 3, state: 'open' }, main: { landed: false }, build: { status: 'queued' }, branch: { exists: true } } },
  branchGoneOnly: { row: { kind: 'queued', id: 'gone', branch: 'claude/gone' }, facts: { pr: null, main: null, build: { status: 'queued' }, branch: { name: 'claude/gone', exists: false } } },
  uiReviewBuildFailed: { row: { kind: 'ui-review', id: 'r-2', build: 'flaky' }, facts: { build: { id: 'flaky', status: 'failed' } } },
  uiReviewBuildDeleted: { row: { kind: 'ui-review', id: 'r-3', build: 'dropped' }, facts: { build: { id: 'dropped', status: 'pending', deleted: true } } },
  mergeQueueBuildArchived: { row: { kind: 'merge-queue', pr: 90, build: 'shelved' }, facts: { pr: { number: 90, state: 'open' }, build: { id: 'shelved', status: 'archived' } } },
  queuedBuildFailed: { row: { kind: 'queued', id: 'flaky' }, facts: { build: { id: 'flaky', status: 'failed' } } },
  pendingBuildArchived: { row: { kind: 'pending', id: 'shelved' }, facts: { build: { id: 'shelved', status: 'archived' } } },
  mergedFlagOnly: { row: { kind: 'ui-review', id: 'r-4', pr: 'https://github.com/MossesX/AmberX-AXF/pull/5' }, facts: { pr: { number: 5, merged: true } } },
  closedFlagOnly: { row: { kind: 'merge-queue', pr: 6 }, facts: { pr: { number: 6, merged: false, closed: true } } },
  shorthandFacts: { row: { kind: 'queued', id: 'short' }, facts: { main: true, branch: false, session: false } },
  aliasKinds: { row: { kind: 'landing-line', pr: 7 }, facts: { pr: { number: 7, state: 'merged' } } },
  junkKind: { row: { kind: 'nope', id: 'j' }, facts: { pr: { number: 1, state: 'merged' } } },
  noId: { row: { kind: 'pending' }, facts: { pr: { number: 1, state: 'merged' } } },
  junkRow: { row: 'not a row', facts: 'not facts' },
};
const ROWS = [
  { kind: 'queued', id: 'a', pr: 1 }, { kind: 'merge-queue', pr: 2 }, { kind: 'ui-review', id: 'u1', build: 'a' }, { kind: 'pending', id: 'b' },
];
const FACTS_FOR = { 'queued:a': { pr: { number: 1, state: 'merged' } }, 'merge-queue:2': { pr: { number: 2, state: 'closed' } }, u1: { build: { id: 'a', status: 'complete' } } };

const run = () => {
  const verdicts = Object.fromEntries(Object.entries(IN).map(([k, c]) => [k, S.classify(c.row, c.facts)]));
  const rows = S.classifyRows(ROWS, FACTS_FOR);
  return {
    verdicts,
    records: Object.fromEntries(Object.entries(IN).map(([k, c]) => [k, S.logRecord(c.row, verdicts[k], { at: AT })])),
    describe: Object.fromEntries(Object.entries(IN).map(([k, c]) => [k, S.describe(c.row, verdicts[k])])),
    rows: rows.map((r) => ({ key: S.rowKey(r.row), action: r.action, reason: r.reason })),
    summary: { ...S.summarize(rows), complete: S.summarize(rows).complete.map((v) => v.reason), remove: S.summarize(rows).remove.map((v) => v.reason) },
    normKind: ['pending', 'queued', 'building', 'running', 'waiting', 'blocked', 'merge-queue', 'landing', 'landing-line', 'mergeQueue', 'ui-review', 'ui', 'review', 'complete', '', null].map(S.normKind),
    kindOfBuild: ['pending', 'queued', 'running', 'waiting', 'blocked', 'failed', 'built', 'complete', 'archived', ''].map((status) => S.kindOfBuild({ status })),
    prNumber: ['612', '#613', 'https://github.com/MossesX/AmberX-AXF/pull/614', '', 'none', 615, { number: 616 }, { url: 'https://github.com/MossesX/axHub/pull/45' }].map(S.prNumber),
  };
};
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'stale-row@1', note: 'Generated by framework/spec/check-stale-rows.mjs --write; every port replays `in` and must answer `out`.', in: { cases: IN, rows: ROWS, factsFor: FACTS_FOR }, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, { cases: IN, rows: ROWS, factsFor: FACTS_FOR }), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ the rules, case by case
const v = (k) => actual.verdicts[k];
const is = (k, action, reason) => { assert.equal(v(k).action, action, `${k} action`); assert.equal(v(k).reason, reason, `${k} reason`); };
t('landed via the merge queue: complete, the PR merge is the evidence', () => { is('landedViaMergeQueue', 'complete', 'pr-merged'); assert.match(v('landedViaMergeQueue').evidence[0], /^PR #612 merged 2026-11-16T10:00:00Z \(abcdef123456\)$/); });
t('landed by a direct merge commit with no PR: complete on-main', () => { is('landedByMergeCommit', 'complete', 'on-main'); assert.deepEqual(v('landedByMergeCommit').evidence, ['on main by merge-commit 1234567890ab', 'build banner-fix: queued']); });
t('a PR closed without a merge: remove, the build is abandoned', () => { is('closedUnmergedPr', 'remove', 'pr-closed'); assert.ok(v('closedUnmergedPr').evidence.includes('PR #77 closed')); assert.ok(v('closedUnmergedPr').evidence.includes('branch claude/old-idea deleted')); });
t('the build record says complete while the row still says queued: complete', () => is('completeButQueued', 'complete', 'build-complete'));
t('a UI Review item whose PR merged: complete (landed), never approved', () => { is('uiReviewPrMerged', 'complete', 'pr-merged'); assert.equal(S.REASONS['pr-merged'].action, 'complete'); });
t('a running build with a live session stays, even with a merged PR in the facts', () => { is('runningMustStay', 'keep', 'live'); assert.ok(v('runningMustStay').evidence.includes('session axf-watchdog')); });
t('missing facts keep the row: empty, null, or every piece unknown', () => { for (const k of ['missingFactsMustStay', 'missingFactsNull', 'missingFactsUnknown']) { is(k, 'keep', 'no-facts'); assert.deepEqual(v(k).evidence, ['no facts looked up']); } });

t('running: unknown session keeps; a dead session with a merged PR completes; a dead session with an open PR is not this watchdog\'s call', () => {
  is('runningNoSessionKnown', 'keep', 'live'); is('runningDeadSessionMerged', 'complete', 'pr-merged'); is('runningDeadSessionOpen', 'keep', 'open');
});
t('an open PR not on main keeps the row as open', () => { is('openPr', 'keep', 'open'); assert.deepEqual(v('openPr').evidence, ['PR #3 open', 'not on main', 'build in-review: queued']); });
t('a deleted branch alone never removes a row (absence is evidence, not a verdict)', () => { is('branchGoneOnly', 'keep', 'open'); assert.ok(v('branchGoneOnly').evidence.includes('branch claude/gone deleted')); });
t('rows that point at a dead build go: failed → build-failed, deleted / archived → build-cancelled', () => { is('uiReviewBuildFailed', 'remove', 'build-failed'); is('uiReviewBuildDeleted', 'remove', 'build-cancelled'); is('mergeQueueBuildArchived', 'remove', 'build-cancelled'); });
t('a build row keeps its own failed / archived status: the orchestrator shows it', () => { is('queuedBuildFailed', 'keep', 'own-status'); is('pendingBuildArchived', 'keep', 'own-status'); });
t('GitHub shapes: merged flag, closed flag, PR urls; shorthand booleans for main / branch / session', () => {
  is('mergedFlagOnly', 'complete', 'pr-merged'); is('closedFlagOnly', 'remove', 'pr-closed'); is('shorthandFacts', 'complete', 'on-main');
  assert.equal(actual.records.mergedFlagOnly.pr, 5);
});
t('kind aliases resolve; junk keeps as invalid-row and never throws', () => {
  is('aliasKinds', 'complete', 'pr-merged'); assert.equal(actual.records.aliasKinds.kind, 'merge-queue'); assert.equal(actual.records.aliasKinds.rowId, '7');
  is('junkKind', 'keep', 'invalid-row'); is('noId', 'keep', 'invalid-row'); is('junkRow', 'keep', 'invalid-row');
  assert.deepEqual(actual.normKind, ['pending', 'queued', 'building', 'building', 'building', 'building', 'merge-queue', 'merge-queue', 'merge-queue', 'merge-queue', 'ui-review', 'ui-review', 'ui-review', '', '', '']);
  assert.deepEqual(actual.kindOfBuild, ['pending', 'queued', 'building', 'building', 'building', '', '', '', '', '']);
  assert.deepEqual(actual.prNumber, [612, 613, 614, 0, 0, 615, 616, 45]);
});
t('every reason code maps to one action, and every verdict carries its action', () => {
  for (const [code, r] of Object.entries(S.REASONS)) assert.ok(S.ACTIONS.includes(r.action), code);
  for (const [k, x] of Object.entries(actual.verdicts)) { assert.equal(x.$axf, 'stale-row@1'); assert.equal(x.action, S.REASONS[x.reason].action, k); assert.ok(x.evidence.length, `${k} has evidence`); }
});
t('classifyRows: keyed facts (kind:id or bare id), a row with no facts keeps; summarize counts', () => {
  assert.deepEqual(actual.rows, [
    { key: 'queued:a', action: 'complete', reason: 'pr-merged' }, { key: 'merge-queue:2', action: 'remove', reason: 'pr-closed' },
    { key: 'ui-review:u1', action: 'complete', reason: 'build-complete' }, { key: 'pending:b', action: 'keep', reason: 'no-facts' }]);
  assert.deepEqual(actual.summary, { complete: ['pr-merged', 'build-complete'], remove: ['pr-closed'], keep: 1 });
  assert.deepEqual(S.classifyRows(ROWS, (r) => (r.id === 'b' ? { pr: { number: 8, state: 'merged' } } : null)).map((r) => r.reason), ['no-facts', 'no-facts', 'no-facts', 'pr-merged']);
  assert.deepEqual(S.classifyRows('junk'), []);
});

// ------------------------------------------------------------------ the cleanup log record and its schema (no ajv on the host)
function validate(schema, val, path = '$', errs = []) {
  const s = schema.$ref ? SCHEMA.$defs[schema.$ref.split('/').pop()] : schema;
  const type = Array.isArray(val) ? 'array' : val === null ? 'null' : Number.isInteger(val) ? 'integer' : typeof val;
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (s.const !== undefined && val !== s.const) errs.push(`${path}: not ${s.const}`);
  if (types.length && !types.some((x) => x === type || (x === 'number' && type === 'integer'))) errs.push(`${path}: ${type}, want ${types.join('|')}`);
  if (s.enum && !s.enum.includes(val)) errs.push(`${path}: ${JSON.stringify(val)} not in enum`);
  if (s.minLength && typeof val === 'string' && val.length < s.minLength) errs.push(`${path}: too short`);
  if (s.maxLength && typeof val === 'string' && val.length > s.maxLength) errs.push(`${path}: too long`);
  if (s.minimum !== undefined && typeof val === 'number' && val < s.minimum) errs.push(`${path}: below ${s.minimum}`);
  if (s.maxItems && Array.isArray(val) && val.length > s.maxItems) errs.push(`${path}: over ${s.maxItems} items`);
  if (s.anyOf && !s.anyOf.some((o) => !validate(o, val, path, []).length)) errs.push(`${path}: matches none of anyOf`);
  if (type === 'object' && val) {
    for (const r of s.required || []) if (!(r in val)) errs.push(`${path}.${r}: missing`);
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in val) validate(sub, val[k], `${path}.${k}`, errs);
  }
  if (Array.isArray(val) && s.items) val.forEach((x, i) => validate(s.items, x, `${path}[${i}]`, errs));
  return errs;
}
t('schema and engine agree on the vocabularies', () => {
  assert.deepEqual(SCHEMA.$defs.kind.enum, [...S.KINDS]);
  assert.deepEqual(SCHEMA.$defs.action.enum, [...S.ACTIONS]);
  assert.deepEqual(SCHEMA.$defs.reason.enum, [...S.REASON_CODES]);
  assert.equal(SCHEMA.title, S.RECORD_FRAME); assert.equal(SCHEMA.$defs.verdict.title, S.FRAME);
  assert.deepEqual(SCHEMA.required, ['$axf', 'id', 'kind', 'rowId', 'action', 'reason', 'evidence', 'at', 'by']);
});
t('every record fits the schema and validateRecord, with a stable id and by: watchdog', () => {
  for (const [k, rec] of Object.entries(actual.records)) {
    if (!rec.kind || k === 'junkKind' || k === 'noId' || k === 'junkRow') continue;
    assert.deepEqual(validate(SCHEMA, rec), [], `${k} fails the schema`); assert.deepEqual(S.validateRecord(rec), { ok: true, errors: [] }, `${k} fails validateRecord`);
    assert.equal(rec.by, 'watchdog'); assert.equal(rec.at, AT); assert.equal(rec.id, `${rec.kind}:${rec.rowId}:${AT}`);
  }
  for (const [k, vv] of Object.entries(actual.verdicts)) assert.deepEqual(validate(SCHEMA.$defs.verdict, vv), [], `${k} verdict fails the schema`);
  const r = actual.records.landedViaMergeQueue;
  assert.deepEqual({ kind: r.kind, rowId: r.rowId, build: r.build, pr: r.pr, branch: r.branch, action: r.action, reason: r.reason }, { kind: 'merge-queue', rowId: '612', build: 'skins', pr: 612, branch: 'claude/skins', action: 'complete', reason: 'pr-merged' });
});
t('a junk row still logs (kind falls back to pending, rowId empty) and validateRecord says what is missing', () => {
  const rec = actual.records.junkRow; assert.equal(rec.kind, 'pending'); assert.deepEqual(S.validateRecord(rec).errors, ['rowId']);
  assert.deepEqual(S.validateRecord({}).errors, ['$axf', 'id', 'kind', 'rowId', 'action', 'reason', 'evidence', 'at', 'by']);
  assert.deepEqual(S.validateRecord({ ...actual.records.openPr, reason: 'pr-merged' }).errors, ['reason/action']);
  assert.deepEqual(S.validateRecord({ ...actual.records.openPr, dry: 'yes', pr: -1 }).errors, ['pr', 'dry']);
});
t('dry runs and hand runs are marked; a note rides along', () => {
  const rec = S.logRecord(IN.openPr.row, v('openPr'), { at: AT, by: 'cli:brett', dry: true, note: 'checked by hand' });
  assert.equal(rec.by, 'cli:brett'); assert.equal(rec.dry, true); assert.equal(rec.note, 'checked by hand'); assert.deepEqual(validate(SCHEMA, rec), []);
  assert.ok(!('dry' in actual.records.openPr) && !('note' in actual.records.openPr));
});
t('describe: one plain line per row', () => {
  assert.equal(actual.describe.landedViaMergeQueue, 'Merge queue entry 612 → Complete: Its PR merged on main (PR #612 merged 2026-11-16T10:00:00Z (abcdef123456); on main by squash abcdef123456; build skins: built; branch claude/skins deleted)');
  assert.equal(actual.describe.missingFactsMustStay, 'Pending build someday → Keep: No facts yet: left alone (no facts looked up)');
  assert.equal(actual.describe.closedUnmergedPr, 'Pending build old-idea → Remove: Its PR was closed without a merge (PR #77 closed; not on main; build old-idea: pending; branch claude/old-idea deleted)');
});
t('PORTING.md lists the contract', () => assert.match(rd('framework/spec/PORTING.md'), /stale-row@1/));
t('CI runs this check', () => assert.match(rd('.github/workflows/android.yml'), /check-stale-rows\.mjs/));

console.log(`✓ stale rows — ${n} checks`);
