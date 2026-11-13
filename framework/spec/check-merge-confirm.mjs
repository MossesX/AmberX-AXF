#!/usr/bin/env node
/**
 * merge-confirm@1 conformance: a merge is merged only once GitHub, read back, proves it.
 *   node framework/spec/check-merge-confirm.mjs           check
 *   node framework/spec/check-merge-confirm.mjs --write   regenerate fixtures/merge-confirm.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../core/merge-confirm.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/merge-confirm.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const T = (s) => `2026-11-13T10:${s}Z`; // 10:00:00 is the merge request
const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12';
const MAIN = 'def5678def5678def5678def5678def5678def56';
const PR_URL = 'https://github.com/MossesX/AmberX-AXF/pull/532';
const ask = (at, extra = {}) => ({ op: 'request', repo: 'MossesX/AmberX-AXF', pr: 532, path: 'merge-queue', by: 'merge-queue', build: 'b1', url: PR_URL, at, ...extra });
const ok200 = { status: 200, merged: true, sha: SHA, message: 'Pull Request successfully merged' };
const MERGED = { state: 'closed', merged: true, merged_at: T('00:02'), merge_commit_sha: SHA, html_url: PR_URL };
const OPEN = { state: 'open', merged: false, merged_at: null, merge_commit_sha: null };
const ON_MAIN = { status: 'ahead', sha: MAIN };
const NOT_ON_MAIN = { status: 'behind', sha: MAIN };
const IN = {
  happy: [ask(T('00:00')), { op: 'called', call: ok200, at: T('00:02') }, { op: 'observe', pr: MERGED, main: ON_MAIN, at: T('00:03') }],
  slowMain: [ask(T('00:00')), { op: 'called', call: ok200, at: T('00:02') }, { op: 'observe', pr: MERGED, main: NOT_ON_MAIN, at: T('00:03') }, { op: 'observe', pr: MERGED, main: { contains: true }, at: T('00:08') }],
  stillOpenThenRecheck: [ask(T('00:00')), { op: 'called', call: ok200, at: T('00:02') }, { op: 'observe', pr: OPEN, main: null, at: T('00:03') }, { op: 'observe', pr: OPEN, main: null, at: T('00:08') }, { op: 'observe', pr: OPEN, main: null, at: T('10:01') }, { op: 'recheck', at: T('12:00'), by: 'brett' }, { op: 'observe', pr: MERGED, main: ON_MAIN, at: T('12:01') }],
  refused: [ask(T('00:00'), { path: 'auto-land', by: 'auto-land' }), { op: 'called', call: { status: 405, message: 'Pull Request is not mergeable' }, at: T('00:02') }, { op: 'observe', pr: OPEN, main: null, at: T('00:02') }],
  refusedButMerged: [ask(T('00:00'), { path: 'console-auto-merge', by: 'console' }), { op: 'called', call: { status: 409, message: 'Head branch was modified' }, at: T('00:02') }, { op: 'observe', pr: MERGED, main: ON_MAIN, at: T('00:03') }],
  closedUnmerged: [ask(T('00:00'), { path: 'github-plugin', by: 'brett' }), { op: 'called', call: ok200, at: T('00:02') }, { op: 'observe', pr: { state: 'closed', merged: false }, main: null, at: T('00:03') }],
  readErrorThenTimeout: [ask(T('00:00'), { path: 'server-gate' }), { op: 'called', call: ok200, at: T('00:02') }, { op: 'observe', pr: { error: { status: 502, message: 'bad gateway' } }, main: null, at: T('00:03') }, { op: 'timeout', at: T('05:00') }, { op: 'timeout', at: T('10:00') }],
  noAnswer: [ask(T('00:00'), { path: 'script', by: 'deploy/land.sh' }), { op: 'observe', pr: MERGED, main: ON_MAIN, at: T('02:30') }],
  noAnswerTimeout: [ask(T('00:00'), { path: 'cli' }), { op: 'timeout', at: T('09:59') }, { op: 'timeout', at: T('10:00') }],
  shaMismatch: [ask(T('00:00')), { op: 'called', call: { ...ok200, sha: 'ffff999ffff999ffff999ffff999ffff999ffff9' }, at: T('00:02') }, { op: 'observe', pr: MERGED, main: ON_MAIN, at: T('00:03') }],
  secondAttempt: [ask(T('00:00')), { op: 'called', call: { status: 422, message: 'Base branch was modified' }, at: T('00:02') }, { op: 'observe', pr: OPEN, main: null, at: T('00:02') }, ask(T('01:00'), { by: 'merge-queue' }), { op: 'called', call: ok200, at: T('01:01') }, { op: 'observe', pr: MERGED, main: ON_MAIN, at: T('01:02') }],
  mergedIsFinal: [ask(T('00:00')), { op: 'called', call: ok200, at: T('00:02') }, { op: 'observe', pr: MERGED, main: ON_MAIN, at: T('00:03') }, { op: 'observe', pr: OPEN, main: null, at: T('00:10') }, { op: 'called', call: ok200, at: T('00:11') }, { op: 'timeout', at: T('20:00') }, { op: 'recheck', at: T('20:00') }, ask(T('30:00'))],
  reconcile: [ask(T('00:00'), { path: 'reconcile', by: 'builds-reconcile', pr: '#532' }), { op: 'observe', pr: { state: 'MERGED', mergedAt: T('00:02'), mergeCommit: { oid: SHA } }, main: { sha: SHA }, at: T('00:05') }],
  unconfirmedThenProven: [ask(T('00:00')), { op: 'called', call: null, at: T('00:02') }, { op: 'timeout', at: T('10:00') }, { op: 'observe', pr: MERGED, main: true, at: T('11:00') }],
  mergedApiNotOnMainTimeout: [ask(T('00:00')), { op: 'called', call: ok200, at: T('00:02') }, { op: 'observe', pr: MERGED, main: NOT_ON_MAIN, at: T('00:03') }, { op: 'observe', pr: MERGED, main: NOT_ON_MAIN, at: T('10:00') }],
  junk: [{ op: 'request', repo: 'nope', pr: 'x', at: T('00:00') }, { op: 'called', call: ok200, at: T('00:01') }],
};
const run = () => {
  const cases = Object.fromEntries(Object.entries(IN).map(([k, ops]) => [k, M.replay(ops)]));
  const h = cases.happy.record;
  return {
    cases,
    due: [[h && { ...h, state: 'merge-requested', nextCheckAt: '' }, T('01:59')], [h && { ...h, state: 'merge-requested' }, T('02:00')], [h && { ...h, state: 'pending-github-confirmation', nextCheckAt: T('00:08') }, T('00:07')], [h && { ...h, state: 'pending-github-confirmation', nextCheckAt: T('00:08') }, T('00:08')], [h, T('00:08')]].map(([r, at]) => M.due(r, at)),
    delays: [0, 1, 2, 3, 4, 5, 6, 40].map(M.nextDelayMs),
    verdicts: [[MERGED, ON_MAIN], [MERGED, NOT_ON_MAIN], [MERGED, null], [{ ...MERGED, merged_at: null }, ON_MAIN], [OPEN, null], [{ state: 'closed', merged: false }, null], [{ error: { status: 404, message: 'Not Found' } }, null], [null, null], [{ state: 'MERGED', mergedAt: T('00:02'), mergeCommit: { oid: SHA } }, { sha: SHA }], [MERGED, { sha: MAIN }]].map(([p, m]) => M.verdict(M.evidence(p, m, T('00:03')))),
    normRepo: ['MossesX/AmberX-AXF', 'https://github.com/MossesX/axHub/pull/44', 'git@github.com:mossesx/axhub.git', 'mossesx', 'a b/c', ''].map(M.normRepo),
    prNumber: ['532', '#532', PR_URL, { number: 7 }, { url: PR_URL }, 'none', 0].map(M.prNumber),
    labels: M.STATES.map(M.labelOf),
    validate: { ok: M.validateRecord(h).errors.map((e) => e.field), bad: M.validateRecord({ state: 'nope', path: 'ftp' }).errors.map((e) => e.field), fakeMerged: M.validateRecord({ ...h, evidence: null }).errors.map((e) => e.field) },
  };
};
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'merge-confirm@1', note: 'Generated by framework/spec/check-merge-confirm.mjs --write; every port replays `in` and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

const c = actual.cases; const fin = (k) => c[k].record; const trace = (k) => c[k].trace;
t('the record is written before the call, pending right after it, merged only on the full read-back', () => {
  assert.deepEqual(trace('happy'), ['merge-requested', 'pending-github-confirmation', 'merged']);
  const r = fin('happy'); assert.equal(r.id, 'mossesx/amberx-axf#532'); assert.equal(r.label, 'Merged'); assert.equal(r.confirmedAt, T('00:03')); assert.equal(r.endedAt, T('00:03')); assert.equal(r.nextCheckAt, '');
  assert.deepEqual(r.evidence.missing, []); assert.equal(r.evidence.onMain, true); assert.equal(r.evidence.shaMatch, true); assert.equal(r.checks, 1);
  assert.equal(r.deadlineAt, T('10:00')); assert.equal(r.history.length, 3); assert.ok(M.isMerged(r));
});
t('the pending label is the one word every path shows', () => { const p = M.replay(IN.happy.slice(0, 2)).record; assert.equal(p.label, 'Pending GitHub confirmation'); assert.equal(p.label, M.PENDING_LABEL); assert.equal(p.nextCheckAt, T('00:02')); assert.ok(!M.isMerged(p)); });
t('MERGED on GitHub but the commit not on main yet waits with backoff, then is merged when main has it', () => {
  assert.deepEqual(trace('slowMain'), ['merge-requested', 'pending-github-confirmation', 'pending-github-confirmation', 'merged']);
  const p = M.replay(IN.slowMain.slice(0, 3)).record; assert.equal(p.nextCheckAt, T('00:08')); assert.match(p.why, /not seen on main yet/); assert.deepEqual(p.evidence.missing, ['merge commit on main']);
  assert.equal(fin('slowMain').checks, 2);
});
t('still open past the deadline = unconfirmed; recheck reopens it with a fresh deadline; a later proof merges it', () => {
  assert.deepEqual(trace('stillOpenThenRecheck'), ['merge-requested', 'pending-github-confirmation', 'pending-github-confirmation', 'pending-github-confirmation', 'merge-unconfirmed', 'pending-github-confirmation', 'merged']);
  const u = M.replay(IN.stillOpenThenRecheck.slice(0, 5)).record; assert.equal(u.label, "GitHub hasn't confirmed"); assert.match(u.why, /PR still open/); assert.equal(u.endedAt, T('10:01'));
  const re = M.replay(IN.stillOpenThenRecheck.slice(0, 6)).record; assert.equal(re.rechecks, 1); assert.equal(re.deadlineAt, T('22:00')); assert.equal(re.endedAt, ''); assert.equal(re.nextCheckAt, T('12:00'));
  assert.equal(M.replay(IN.stillOpenThenRecheck.slice(0, 4)).record.nextCheckAt, T('00:23'), 'second wait is 15 s');
});
t('a refused call is still read back once: open = merge-failed, MERGED = merged (GitHub wins)', () => {
  assert.deepEqual(trace('refused'), ['merge-requested', 'pending-github-confirmation', 'merge-failed']); assert.match(fin('refused').why, /HTTP 405.*still open/);
  assert.deepEqual(trace('refusedButMerged'), ['merge-requested', 'pending-github-confirmation', 'merged']);
});
t('a PR closed without a merge is merge-failed whatever the merge call said', () => { assert.deepEqual(trace('closedUnmerged'), ['merge-requested', 'pending-github-confirmation', 'merge-failed']); assert.equal(fin('closedUnmerged').why, 'PR closed on GitHub without merging'); });
t('a read error never ends a record; the deadline does', () => {
  assert.deepEqual(trace('readErrorThenTimeout'), ['merge-requested', 'pending-github-confirmation', 'pending-github-confirmation', 'pending-github-confirmation', 'merge-unconfirmed']);
  assert.match(M.replay(IN.readErrorThenTimeout.slice(0, 3)).record.why, /HTTP 502 bad gateway/); assert.match(fin('readErrorThenTimeout').why, /within 10 min/);
});
t('no answer from the merge call: due after 2 min, read back straight from merge-requested, unconfirmed at the deadline', () => {
  assert.deepEqual(trace('noAnswer'), ['merge-requested', 'merged']); assert.equal(fin('noAnswer').calledAt, ''); assert.equal(fin('noAnswer').call, null);
  assert.deepEqual(trace('noAnswerTimeout'), ['merge-requested', 'merge-requested', 'merge-unconfirmed']); assert.match(fin('noAnswerTimeout').why, /no answer from the merge call/);
  assert.deepEqual(actual.due, [false, true, false, true, false]);
});
t("the merge call's sha is a hint: GitHub's merge commit wins and the mismatch is noted", () => { const r = fin('shaMismatch'); assert.equal(r.state, 'merged'); assert.equal(r.evidence.shaMatch, false); assert.equal(r.evidence.mergeCommitSha, SHA); assert.match(r.history.at(-1).why, /the merge call said ffff999/); });
t('a new request on a failed record is attempt 2 with the history kept', () => { const r = fin('secondAttempt'); assert.equal(r.attempt, 2); assert.equal(r.state, 'merged'); assert.equal(r.history.length, 6); assert.match(r.history[3].why, /attempt 2/); assert.equal(r.history[3].from, 'merge-failed'); });
t('merged is final: later reads, answers, timeouts, rechecks and requests change nothing', () => { assert.deepEqual(trace('mergedIsFinal'), ['merge-requested', 'pending-github-confirmation', 'merged', 'merged', 'merged', 'merged', 'merged', 'merged']); assert.deepEqual(fin('mergedIsFinal'), fin('happy')); });
t('reconcile: no merge call, a GraphQL read and main at the merge commit prove it', () => { const r = fin('reconcile'); assert.equal(r.path, 'reconcile'); assert.equal(r.state, 'merged'); assert.equal(r.call, null); assert.equal(r.evidence.mainSha, SHA); assert.equal(r.pr, 532); assert.match(r.history[0].why, /reconcile saw a merge/); });
t('an unconfirmed record still becomes merged when a later read proves it', () => { assert.deepEqual(trace('unconfirmedThenProven'), ['merge-requested', 'pending-github-confirmation', 'merge-unconfirmed', 'merged']); assert.equal(M.replay(IN.unconfirmedThenProven.slice(0, 2)).record.call.message, 'no answer'); });
t('MERGED but never on main by the deadline is unconfirmed, with the reason', () => { const r = fin('mergedApiNotOnMainTimeout'); assert.equal(r.state, 'merge-unconfirmed'); assert.match(r.why, /not seen on main yet/); assert.deepEqual(r.evidence.missing, ['merge commit on main']); });
t('junk makes no record', () => assert.deepEqual(c.junk, { record: null, trace: [null, null] }));
t('backoff 0, 5, 15, 30, 60, then 120 s', () => assert.deepEqual(actual.delays, [0, 5000, 15000, 30000, 60000, 120000, 120000, 120000]));
t('verdicts: every evidence shape', () => assert.deepEqual(actual.verdicts, ['merged', 'pending', 'pending', 'pending', 'not-merged', 'closed', 'unknown', 'unknown', 'merged', 'pending']));
t('repos and PR numbers from every shape the paths carry', () => { assert.deepEqual(actual.normRepo, ['mossesx/amberx-axf', 'mossesx/axhub', 'mossesx/axhub', '', '', '']); assert.deepEqual(actual.prNumber, [532, 532, 532, 7, 532, 0, 0]); });
t('every record validates and normalises to itself; a "merged" record without evidence is refused', () => {
  for (const { record } of Object.values(c)) if (record) { assert.ok(M.validateRecord(record).ok, record.id); assert.deepEqual(M.normRecord(record), record); }
  assert.deepEqual(actual.validate, { ok: [], bad: ['repo', 'pr', 'state', 'path', 'requestedAt'], fakeMerged: ['evidence'] });
});
t('labels for every state', () => assert.deepEqual(actual.labels, ['Merge requested', 'Pending GitHub confirmation', 'Merged', "GitHub hasn't confirmed", 'Merge failed']));
t('schemas/merge-confirm.json + schemas/json/merge-confirm.schema.json are current (run axf schemas)', () => { assert.ok(same(JSON.parse(rd('framework/schemas/merge-confirm.json')), M.REGISTRY)); for (const [name, s] of Object.entries(M.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name); });
t('MERGE-CONFIRM.md and PORTING.md carry the contract', () => { assert.match(rd('framework/spec/MERGE-CONFIRM.md'), /merge-confirm@1/); assert.match(rd('framework/spec/PORTING.md'), /merge-confirm@1/); });
console.log(`check-merge-confirm: ${n} checks passed`);
