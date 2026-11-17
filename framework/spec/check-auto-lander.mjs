#!/usr/bin/env node
/**
 * auto-lander@1 conformance: decide() on a clash, red CI, CI running, green, a mid-flight attempt (open, then timed
 * out), the backoff between tries, escalation at maxAttempts, the per-kind switches, the holds the server never
 * touches (draft, fork, by hand, no PR, UI Review), apply / endAttempt / resetEscalation round trips, the policy from
 * the gate rule set, the lander-state@1 migration, the view every surface reads (service, current, queue, rows with
 * behind / paused / lastResult), the five commands (run, retry, pause, resume, settings), validation, and the schema snapshots.
 *   node framework/spec/check-auto-lander.mjs           check
 *   node framework/spec/check-auto-lander.mjs --write   regenerate fixtures/auto-lander.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../core/auto-lander.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/auto-lander.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-16T12:00:00Z';
const T = (min) => new Date(Date.parse(AT) + min * 60000).toISOString();

// ------------------------------------------------------------------ inputs

const HEAD = 'a710a710a710a710a710a710a710a710a710a710';
const HEAD2 = 'b710b710b710b710b710b710b710b710b710b710';
/** One build waiting in the lander with no history. */
const BUILD = { build: 'help-coverage-gate', pr: 710, branch: 'claude/help-coverage-gate', head: HEAD, state: 'waiting', since: T(-30), at: T(-30), attempts: [], reason: '' };
/** The policy as the default auto-lander rule carries it, and two hand-set ones. */
const POLICIES = {
  defaults: {},
  twoTries: { maxAttempts: 2, backoff: { baseMin: 1, factor: 2, maxMin: 5 }, attemptTimeoutMin: 20 },
  slowRetry: { attemptTimeoutMin: 20, backoff: { baseMin: 60, factor: 2, maxMin: 120 } },
  noFix: { fixSessions: false },
  noLand: { land: false },
  off: { enabled: false },
};
/** What the gate sees of the PR (pr-snapshot@1). */
const SNAPSHOTS = {
  clash: { number: 710, head: HEAD, ci: 'none', conflicts: ['framework/ui/axf.css', 'apps/console-web/src/App.tsx'], dataConflicts: ['_claude/builds/store.json'] },
  dataClashOnly: { number: 710, head: HEAD, ci: 'success', dataConflicts: ['_claude/builds/store.json'] },
  red: { number: 710, head: HEAD, ci: 'failure', failing: ['android / check-theme', 'android / conformance tests'] },
  running: { number: 710, head: HEAD, ci: 'running' },
  none: { number: 710, head: HEAD, ci: 'none' },
  green: { number: 710, head: HEAD, ci: 'success' },
  greenNewHead: { number: 710, head: HEAD2, ci: 'success' },
  uiWaiting: { number: 710, head: HEAD, ci: 'success', ui: 'waiting' },
  uiChanges: { number: 710, head: HEAD, ci: 'success', ui: 'changes' },
  draft: { number: 710, head: HEAD, ci: 'none', draft: true },
  fork: { number: 710, head: HEAD, ci: 'success', fork: true },
  heldByHand: { number: 710, head: HEAD, ci: 'success', landHeld: 'waiting for the skins build' },
  merged: { number: 710, head: HEAD, ci: 'success', merged: true },
  noPr: { ci: 'none' },
};
const att = (kind, k, result, startMin, endMin, extra = {}) => ({ build: BUILD.build, kind, n: k, account: 'hulu0241', session: `s-${kind}-${k}`, branch: BUILD.branch, head: HEAD, pr: 710, result, log: extra.log || '', at: T(startMin), endedAt: endMin === null ? '' : T(endMin), ...extra });
/** Attempt histories. */
const ATTEMPTS = {
  none: [],
  oneRedFailedJustNow: [att('red-ci', 1, 'failed', -12, -2, { log: 'android / check-theme still red' })],
  oneRedFailedLongAgo: [att('red-ci', 1, 'failed', -60, -50, { log: 'android / check-theme still red' })],
  twoRedFailed: [att('red-ci', 1, 'failed', -200, -190), att('red-ci', 2, 'failed', -120, -100, { head: HEAD2 })],
  threeRedFailed: [att('red-ci', 1, 'failed', -300, -290), att('red-ci', 2, 'failed', -200, -190), att('red-ci', 3, 'timeout', -120, -75)],
  twoClashFailedOneSkipped: [att('clash', 1, 'failed', -300, -299), att('clash', 2, 'skipped', -200, -199), att('clash', 3, 'failed', -120, -119)],
  landOpenFresh: [att('land', 1, 'started', -10, null)],
  landOpenStale: [att('land', 1, 'started', -50, null)],
  fixOpenFresh: [att('red-ci', 1, 'started', -30, null)],
  mixed: [att('clash', 1, 'ok', -400, -399), att('red-ci', 1, 'failed', -300, -290), att('red-ci', 2, 'ok', -200, -150), att('land', 1, 'failed', -100, -99, { log: 'merge refused: base branch was modified' })],
};

/** The default rule set with the auto-lander rule as gate-rules@1 ships it, and the same set with the rule tuned / off / missing. */
const RULE = { $axf: 'gate-rule@1', id: 'auto-lander', kind: 'custom', enabled: true, severity: 'block', owner: 'console', title: 'Auto-lander fixes and lands', settings: { maxAttempts: 3, backoff: { baseMin: 5, factor: 3, maxMin: 60 }, attemptTimeoutMin: 45, mergeMain: true, fixSessions: true, land: true, escalateTo: 'banner' } };
const RULE_SETS = {
  shipped: { $axf: 'gate-rule-set@1', rev: 1, at: AT, rules: [{ id: 'ci-green', kind: 'ci', enabled: true, severity: 'block', owner: 'console', settings: {} }, RULE] },
  tuned: { $axf: 'gate-rule-set@1', rev: 2, at: AT, rules: [{ ...RULE, settings: { ...RULE.settings, maxAttempts: 5, backoff: { baseMin: 2, factor: 2, maxMin: 30 }, fixSessions: false } }] },
  off: { $axf: 'gate-rule-set@1', rev: 3, at: AT, rules: [{ ...RULE, enabled: false }] },
  missing: { $axf: 'gate-rule-set@1', rev: 1, at: AT, rules: [{ id: 'ci-green', kind: 'ci', enabled: true, severity: 'block', owner: 'console', settings: {} }] },
};

/** The lander-state@1 the gate plugin shows today (the gate-rules fixture's running state), to migrate. */
const LANDER_STATE = {
  $axf: 'lander-state@1', at: '2026-11-15T12:00:00Z', status: 'running', enabled: true, paused: false, pause: null, mode: 'batch', source: 'merge-queue@1',
  landing: { pr: 540, title: 'Skins: hot-swap tokens', build: 'skins-hot-swap', branch: 'claude/skins-hot-swap', ci: 'running', since: '2026-11-15T11:50:00Z', runUrl: 'https://github.com/MossesX/AmberX-AXF/actions/runs/9001' },
  lastRuns: [],
  waiting: [
    { position: 1, pr: 543, title: 'Notes: nested lists', build: 'notes-nested-lists', branch: 'claude/notes-nested', head: 'c543c543c543c543c543c543c543c543c543c543', state: 'waiting', rule: 'clash', reason: 'conflicts in code with #540; goes in the next batch', since: '' },
    { position: 2, pr: 539, title: 'Push banner: quiet hours', build: 'push-quiet-hours', branch: 'claude/quiet-hours', head: 'd539d539d539d539d539d539d539d539d539d539', state: 'waiting', rule: '', reason: 'waits its turn in the line.', since: '' },
    { position: 3, pr: 544, title: 'UI Review: phone shots', build: 'ui-review-phone-shots', branch: 'claude/phone-shots', head: 'a544a544a544a544a544a544a544a544a544a544', state: 'held', rule: 'ui-review', reason: 'its screenshots wait for Brett in UI Review', since: '' },
    { position: 4, pr: 537, title: 'Voice: wake word', build: 'voice-wake-word', branch: 'claude/wake-word', head: 'e537e537e537e537e537e537e537e537e537e537', state: 'kicked', rule: 'ci-green', reason: 'kicked out: #537 broke CI when tested on top of main (failed: android / conformance). Push a fix and it rejoins by itself.', since: '' },
    { position: 5, pr: 546, title: 'Notes: CI still running', build: 'notes-ci-running', branch: 'claude/notes-ci', head: 'f546f546f546f546f546f546f546f546f546f546', state: 'waiting', rule: 'ci-green', reason: 'its PR checks are still running', since: '2026-11-15T11:55:00Z' },
    { position: 6, pr: 545, title: 'Draft: nothing yet', build: '', branch: '', head: 'b545b545b545b545b545b545b545b545b545b545', state: 'held', rule: 'merge-queue-only', reason: 'it is a draft', since: '' },
    { position: 7, pr: 535, title: 'Console: dock sizes', build: 'console-dock-sizes', branch: '', head: 'f535f535f535f535f535f535f535f535f535f535', state: 'held', rule: '', reason: 'taken out of the queue by hand (waiting for the skins build)', since: '' },
  ],
  landedRecently: [538, 536],
};
const LANDER_STATE_LANDING = { ...LANDER_STATE, landing: { ...LANDER_STATE.landing, ci: 'success' }, waiting: [], landedRecently: [] };

/** What the runner knows around the migrated state: its heartbeat, commits behind main, holds by hand, titles. */
const SERVICE = { fresh: { runner: 'cron-lander', since: '2026-11-15T09:00:00Z', lastTick: T(-2) }, stale: { runner: 'cron-lander', since: '2026-11-15T09:00:00Z', lastTick: T(-90) }, said: { up: true, runner: 'axf-molly' }, none: {} };
const BEHIND = { 'skins-hot-swap': 0, 'notes-nested-lists': 12, 'push-quiet-hours': 3, 'voice-wake-word': 7 };
const HOLDS = { 'console-dock-sizes': 'taken out of the queue by hand (waiting for the skins build)', 'ui-review-phone-shots': '' };
const TITLES = { 'skins-hot-swap': 'Skins: hot-swap tokens', 'notes-nested-lists': 'Notes: nested lists' };
/** Commands as the console, CLI, MCP and voice send them (auto-lander-command@1). */
const REASON = { title: 'Retry the auto-lander on help-coverage-gate', description: 'Resets the escalation and runs the lander now.' };
const COMMANDS = {
  runAll: { command: 'run', reason: { title: 'Run the auto-lander now' } }, runOne: { command: 'run', build: BUILD.build, by: 'brett', reason: REASON },
  retry: { command: 'retry', build: BUILD.build, by: 'brett', reason: REASON }, retryNoBuild: { command: 'retry', reason: REASON },
  pauseOne: { command: 'pause', build: BUILD.build, by: 'brett', reason: { title: 'Pause help-coverage-gate', description: 'Holds it until the skins build lands.' } }, pauseAll: { command: 'pause', by: 'brett', reason: { title: 'Pause the auto-lander' } },
  resumeOne: { command: 'resume', build: BUILD.build, reason: { title: 'Resume help-coverage-gate' } },
  settings: { command: 'settings', by: 'brett', reason: { title: 'Auto-lander: five tries' }, settings: { maxAttempts: 5, fixSessions: false } },
  settingsEmpty: { command: 'settings', reason: { title: 'x' }, settings: {} }, settingsBad: { command: 'settings', build: 'x', reason: { title: 'x' }, settings: { maxAttempts: 0, escalateTo: 'mail' } },
  noReason: { command: 'run', build: BUILD.build }, unknown: { command: 'kick', build: BUILD.build, reason: REASON },
};

const IN = { AT, HEAD, HEAD2, BUILD, POLICIES, SNAPSHOTS, ATTEMPTS, RULE_SETS, LANDER_STATE, LANDER_STATE_LANDING, SERVICE, BEHIND, HOLDS, TITLES, COMMANDS };

// ------------------------------------------------------------------ outputs

const D = (snap, attempts = ATTEMPTS.none, policy = POLICIES.defaults, at = AT, build = BUILD) => L.decide(build, SNAPSHOTS[snap], ATTEMPTS[attempts] || attempts, POLICIES[policy] || policy, { at });
const inFlight = (state, attempts) => ({ ...BUILD, state, attempts: ATTEMPTS[attempts] });

function run() {
  // the round trip: red → fix session started → ended red → backoff → second try → green → landing → landed
  const trip = [];
  let b = BUILD;
  let a = L.decide(b, SNAPSHOTS.red, b.attempts, POLICIES.twoTries, { at: AT }); trip.push({ step: 'red: first fix session', action: a });
  b = L.apply(b, a, { account: 'hulu0241', session: 'fix-1', at: AT }); trip.push({ step: 'applied', build: b });
  a = L.decide(b, SNAPSHOTS.red, b.attempts, POLICIES.twoTries, { at: T(5) }); trip.push({ step: 'fix session running', action: a });
  b = L.endAttempt(b, 'failed', { log: 'android / check-theme still red', at: T(10), head: HEAD2 }); trip.push({ step: 'fix ended red', build: b });
  a = L.decide(b, SNAPSHOTS.red, b.attempts, POLICIES.twoTries, { at: T(10) }); trip.push({ step: 'backoff after failure 1', action: a });
  b = L.apply(b, a, { at: T(10) }); trip.push({ step: 'applied wait', build: b });
  a = L.decide(b, SNAPSHOTS.red, b.attempts, POLICIES.twoTries, { at: T(12) }); trip.push({ step: 'second fix session', action: a });
  b = L.apply(b, a, { account: 'hulu0241', session: 'fix-2', at: T(12) });
  b = L.endAttempt(b, 'ok', { log: 'pushed fix', at: T(20) });
  a = L.decide(b, SNAPSHOTS.running, b.attempts, POLICIES.twoTries, { at: T(21) }); trip.push({ step: 'CI running on the fix', action: a });
  b = L.apply(b, a, { at: T(21) });
  a = L.decide(b, SNAPSHOTS.greenNewHead, b.attempts, POLICIES.twoTries, { at: T(30) }); trip.push({ step: 'green: land', action: a });
  b = L.apply(b, a, { account: 'vps', at: T(30) }); trip.push({ step: 'landing', build: b });
  b = L.endAttempt(b, 'ok', { log: 'merged #710', at: T(31) });
  a = L.decide(b, SNAPSHOTS.merged, b.attempts, POLICIES.twoTries, { at: T(31) }); trip.push({ step: 'merged: none', action: a });
  b = L.apply(b, a, { at: T(31) }); trip.push({ step: 'landed', build: b });

  // escalation and the reset by hand
  const esc = L.apply(inFlight('waiting', 'threeRedFailed'), D('red', 'threeRedFailed'), { at: AT });
  const reset = L.resetEscalation(esc, { at: T(60), by: 'brett' });

  return {
    decide: {
      clash: D('clash'), dataClashOnly: D('dataClashOnly'), red: D('red'), running: D('running'), none: D('none'), green: D('green'),
      uiWaiting: D('uiWaiting'), uiChanges: D('uiChanges'), draft: D('draft'), fork: D('fork'), heldByHand: D('heldByHand'), merged: D('merged'), noPr: D('noPr', 'none', 'defaults', AT, { ...BUILD, pr: 0 }),
      off: D('red', 'none', 'off'), noFix: D('red', 'none', 'noFix'), noLand: D('green', 'none', 'noLand'), clashNoMerge: D('clash', 'none', { mergeMain: false }),
    },
    retry: {
      backoffJustNow: D('red', 'oneRedFailedJustNow'), afterBackoff: D('red', 'oneRedFailedLongAgo'), thirdTry: D('red', 'twoRedFailed'),
      inFlightLand: D('green', 'landOpenFresh', 'defaults', AT, inFlight('landing', 'landOpenFresh')), inFlightFix: D('red', 'fixOpenFresh', 'defaults', AT, inFlight('fixing', 'fixOpenFresh')),
      staleLandRetried: D('green', 'landOpenStale', 'defaults', AT, inFlight('landing', 'landOpenStale')), staleLandBackoff: D('green', 'landOpenStale', 'slowRetry', AT, inFlight('landing', 'landOpenStale')),
      skippedNotCounted: D('clash', 'twoClashFailedOneSkipped'), mixedHistoryLandAgain: D('green', 'mixed', 'defaults', T(60)),
      backoffMinutes: { defaults: [1, 2, 3, 4, 5].map((k) => L.backoffMinutes(k, POLICIES.defaults)), twoTries: [1, 2, 3, 4].map((k) => L.backoffMinutes(k, POLICIES.twoTries)) },
    },
    escalate: { atMax: D('red', 'threeRedFailed'), twoTriesAtMax: D('red', 'twoRedFailed', 'twoTries'), escalatedStays: L.decide(esc, SNAPSHOTS.green, esc.attempts, {}, { at: T(1) }), build: esc, reset, afterReset: L.decide(reset, SNAPSHOTS.red, reset.attempts, {}, { at: T(61) }) },
    trip,
    policy: Object.fromEntries(Object.entries(RULE_SETS).map(([k, s]) => [k, L.policyFromRules(s)])),
    migrate: { running: L.fromLanderState(LANDER_STATE, { at: AT }), landing: L.fromLanderState(LANDER_STATE_LANDING, { policy: POLICIES.twoTries, at: AT }), empty: L.fromLanderState({}, { at: AT }) },
    errors: {
      goodBuild: L.buildErrors(esc), goodState: L.stateErrors(L.fromLanderState(LANDER_STATE, { at: AT })),
      badAttempt: L.attemptErrors({ $axf: 'x', build: '', kind: 'nope', n: 0, result: 'done', at: 'yesterday', endedAt: 'x' }),
      badBuild: L.buildErrors({ build: 'x', state: 'flying', since: '', attempts: [att('land', 1, 'started', -5, null), att('land', 1, 'started', -4, null), att('red-ci', 2, 'ok', -3, -2)], escalation: { kind: 'land' } }),
      escalatedNoWhy: L.buildErrors({ build: 'x', state: 'escalated', since: AT, attempts: [] }),
      badPolicy: L.policyErrors({ enabled: 'yes', maxAttempts: 0, backoff: { baseMin: -1, factor: 0 }, attemptTimeoutMin: '5', land: 1, escalateTo: 'mail' }),
      badState: L.stateErrors({ $axf: 'nope', at: '', policy: { maxAttempts: 99 }, builds: [{ build: 'x', state: 'waiting', since: AT, attempts: [] }, { build: 'x', state: 'waiting', since: AT, attempts: [] }] }),
    },
    norm: { policy: L.normPolicy({ maxAttempts: 99, backoff: { baseMin: 0 }, escalateTo: 'mail' }), attempt: L.normAttempt({ kind: 'x', n: -1, result: 'meh', log: 'x'.repeat(2100) }).log.length, build: L.normBuild({ build: 'x', state: 'escalated' }, AT) },
    view: (() => {
      const migrated = L.fromLanderState(LANDER_STATE, { at: AT });
      const withEsc = L.putBuild(migrated, { ...esc, at: T(-1) }, AT);
      return {
        running: L.viewOf(withEsc, { service: SERVICE.fresh, behind: BEHIND, holds: HOLDS, titles: TITLES, at: AT }),
        stale: L.viewOf(migrated, { service: SERVICE.stale, at: AT }).service, said: L.viewOf(migrated, { service: SERVICE.said, at: AT }).service, none: L.viewOf(L.emptyState(AT, POLICIES.off), { service: SERVICE.none, at: AT }),
        lastResult: { none: L.lastResultOf(ATTEMPTS.none), open: L.lastResultOf(ATTEMPTS.landOpenFresh), mixed: L.lastResultOf(ATTEMPTS.mixed), skipped: L.lastResultOf(ATTEMPTS.twoClashFailedOneSkipped) },
        row: L.rowOf({ ...BUILD, attempts: ATTEMPTS.mixed }, { behind: 4, hold: 'paused by brett', title: 'Help coverage gate', at: AT }),
        errors: { good: L.viewErrors(L.viewOf(withEsc, { service: SERVICE.fresh, behind: BEHIND, holds: HOLDS, at: AT })), bad: L.viewErrors({ $axf: 'x', at: '', service: { up: 'yes', runner: 'me', policy: { maxAttempts: 0 } }, current: { build: 'ghost' }, queue: ['ghost', 7], builds: [{ build: 'x', state: 'waiting', since: AT, attempts: [], behind: -2, paused: 'no', lastResult: { result: 'started' } }] }) },
      };
    })(),
    commands: {
      norm: Object.fromEntries(Object.entries(COMMANDS).map(([k, c]) => [k, L.normCommand(c)])),
      errors: Object.fromEntries(Object.entries(COMMANDS).map(([k, c]) => [k, L.commandErrors(c)])),
      runNow: { inBackoff: D('red', 'oneRedFailedJustNow'), now: L.decide(BUILD, SNAPSHOTS.red, ATTEMPTS.oneRedFailedJustNow, POLICIES.defaults, { at: AT, now: true }), nowAtMax: L.decide(BUILD, SNAPSHOTS.red, ATTEMPTS.threeRedFailed, POLICIES.defaults, { at: AT, now: true }), nowInFlight: L.decide(inFlight('fixing', 'fixOpenFresh'), SNAPSHOTS.red, ATTEMPTS.fixOpenFresh, POLICIES.defaults, { at: AT, now: true }) },
    },
  };
}
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'auto-lander@1', note: 'Generated by framework/spec/check-auto-lander.mjs --write; every port replays `in` (a build, PR snapshots, attempt histories, policies, rule sets, a lander-state@1) and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ decide

const d = actual.decide; const act = (x) => [x.action, x.state, x.kind, x.attempt, x.waitReason];
t('a clash merges main; data clashes alone do not count', () => { assert.deepEqual(act(d.clash), ['merge-main', 'merging-main', 'clash', 1, '']); assert.match(d.clash.reason, /axf\.css/); assert.deepEqual(act(d.dataClashOnly), ['land', 'landing', 'land', 1, '']); });
t('red CI starts a fix session', () => { assert.deepEqual(act(d.red), ['fix-session', 'fixing', 'red-ci', 1, '']); assert.match(d.red.reason, /check-theme/); });
t('CI running or not run waits', () => { assert.deepEqual(act(d.running), ['wait', 'ci-running', '', 0, 'ci-running']); assert.deepEqual(act(d.none), ['wait', 'waiting', '', 0, 'ci-none']); });
t('green lands', () => { assert.deepEqual(act(d.green), ['land', 'landing', 'land', 1, '']); assert.equal(d.green.$axf, L.ACTION_FRAME); assert.equal(d.green.pr, 710); });
t('what the server never touches: UI Review, drafts, forks, holds by hand, no PR; merged is done', () => {
  assert.deepEqual([d.uiWaiting, d.uiChanges, d.draft, d.fork, d.heldByHand, d.noPr].map((x) => [x.action, x.waitReason]), [['wait', 'ui-review'], ['wait', 'ui-review'], ['wait', 'draft'], ['wait', 'fork'], ['wait', 'held'], ['wait', 'no-pr']]);
  assert.deepEqual(act(d.merged), ['none', 'landed', '', 0, '']);
});
t('the switches: rule off does nothing; a kind switched off escalates at once; landing off waits for a hand', () => {
  assert.deepEqual(act(d.off), ['none', 'waiting', '', 0, 'switched-off']); assert.deepEqual(act(d.noFix), ['escalate', 'escalated', 'red-ci', 0, '']);
  assert.deepEqual(act(d.noLand), ['wait', 'waiting', 'land', 0, 'held']); assert.deepEqual(act(d.clashNoMerge), ['escalate', 'escalated', 'clash', 0, '']);
});

// ------------------------------------------------------------------ retries

const r = actual.retry;
t('backoff: 5, 15, 45, 60, 60 minutes by default; a failure two minutes ago waits, one fifty minutes ago tries again', () => {
  assert.deepEqual(r.backoffMinutes.defaults, [5, 15, 45, 60, 60]); assert.deepEqual(r.backoffMinutes.twoTries, [1, 2, 4, 5]);
  assert.deepEqual(act(r.backoffJustNow), ['wait', 'waiting', 'red-ci', 2, 'backoff']); assert.equal(r.backoffJustNow.notBefore, T(3));
  assert.deepEqual(act(r.afterBackoff), ['fix-session', 'fixing', 'red-ci', 2, '']); assert.deepEqual(act(r.thirdTry), ['fix-session', 'fixing', 'red-ci', 3, '']); assert.match(r.thirdTry.reason, /attempt 3 of 3/);
});
t('mid-flight: an open attempt waits where it is; a stale one counts as a timeout and is retried after its backoff', () => {
  assert.deepEqual(act(r.inFlightLand), ['wait', 'landing', 'land', 1, 'in-flight']); assert.deepEqual(act(r.inFlightFix), ['wait', 'fixing', 'red-ci', 1, 'in-flight']);
  assert.deepEqual(act(r.staleLandRetried), ['land', 'landing', 'land', 2, '']); // timed out at -5 min, backoff 5 min → due now
  assert.deepEqual(act(r.staleLandBackoff), ['wait', 'waiting', 'land', 2, 'backoff']); assert.equal(r.staleLandBackoff.notBefore, T(30)); // timed out at -30 min (20 min timeout), backoff 60 min → due at +30
});
t('skipped attempts never count; a landed-then-refused history tries landing again', () => {
  assert.deepEqual(act(r.skippedNotCounted), ['merge-main', 'merging-main', 'clash', 3, '']);
  assert.deepEqual(act(r.mixedHistoryLandAgain), ['land', 'landing', 'land', 2, '']);
});

// ------------------------------------------------------------------ escalation

const e = actual.escalate;
t('three failures of one kind escalate (timeouts count); two with maxAttempts 2', () => {
  assert.deepEqual(act(e.atMax), ['escalate', 'escalated', 'red-ci', 3, '']); assert.match(e.atMax.reason, /failed 3 times/); assert.deepEqual(act(e.twoTriesAtMax), ['escalate', 'escalated', 'red-ci', 2, '']);
  assert.equal(e.build.state, 'escalated'); assert.deepEqual(e.build.escalation, { at: AT, kind: 'red-ci', attempts: 3, why: e.atMax.reason, head: HEAD }); assert.deepEqual(L.buildErrors(e.build), []);
});
t('escalated stays until a hand resets; the reset skips the counted tries and the next try is attempt 1', () => {
  assert.deepEqual(act(e.escalatedStays), ['none', 'escalated', '', 0, '']);
  assert.equal(e.reset.state, 'waiting'); assert.equal(e.reset.escalation, null); assert.ok(e.reset.attempts.every((x) => x.result === 'skipped')); assert.deepEqual(e.reset.attempts.map((x) => x.n), [1, 2, 3]);
  assert.deepEqual(act(e.afterReset), ['fix-session', 'fixing', 'red-ci', 1, '']); assert.deepEqual(L.buildErrors(e.reset), []);
});

// ------------------------------------------------------------------ the round trip

t('the round trip red → fix → red → backoff → fix → green → landed is valid at every step', () => {
  const steps = actual.trip.map((x) => x.step);
  assert.deepEqual(steps, ['red: first fix session', 'applied', 'fix session running', 'fix ended red', 'backoff after failure 1', 'applied wait', 'second fix session', 'CI running on the fix', 'green: land', 'landing', 'merged: none', 'landed']);
  for (const x of actual.trip) if (x.build) assert.deepEqual(L.buildErrors(x.build), [], x.step);
  const last = actual.trip[actual.trip.length - 1].build;
  assert.equal(last.state, 'landed'); assert.deepEqual(last.attempts.map((x) => [x.kind, x.n, x.result, x.session]), [['red-ci', 1, 'failed', 'fix-1'], ['red-ci', 2, 'ok', 'fix-2'], ['land', 1, 'ok', '']]);
  assert.equal(last.head, HEAD2); assert.equal(last.attempts[1].head, HEAD2); assert.equal(actual.trip[2].action.waitReason, 'in-flight'); assert.equal(actual.trip[4].action.waitReason, 'backoff');
  assert.equal(actual.trip[9].build.attempts[2].account, 'vps');
});

// ------------------------------------------------------------------ policy + migration

t('the policy comes from the auto-lander gate rule; off, tuned and missing all read', () => {
  assert.deepEqual(actual.policy.shipped, L.normPolicy({})); assert.equal(actual.policy.shipped.enabled, true);
  assert.equal(actual.policy.tuned.maxAttempts, 5); assert.equal(actual.policy.tuned.fixSessions, false); assert.deepEqual(actual.policy.tuned.backoff, { baseMin: 2, factor: 2, maxMin: 30 });
  assert.equal(actual.policy.off.enabled, false); assert.deepEqual(actual.policy.missing, L.normPolicy({}));
});
t('lander-state@1 migrates with nothing dropped: landing → ci-running, a kick → one failed red-ci attempt, holds stay waiting, landed stays landed', () => {
  const m = actual.migrate.running;
  assert.deepEqual(m.builds.map((x) => [x.build, x.pr, x.state, x.attempts.length]), [['skins-hot-swap', 540, 'ci-running', 0], ['notes-nested-lists', 543, 'waiting', 0], ['push-quiet-hours', 539, 'waiting', 0], ['ui-review-phone-shots', 544, 'waiting', 0], ['voice-wake-word', 537, 'waiting', 1], ['notes-ci-running', 546, 'ci-running', 0], ['pr-545', 545, 'waiting', 0], ['console-dock-sizes', 535, 'waiting', 0], ['pr-538', 538, 'landed', 0], ['pr-536', 536, 'landed', 0]]);
  assert.equal(m.builds[4].attempts[0].result, 'failed'); assert.match(m.builds[4].attempts[0].log, /broke CI/); assert.deepEqual(m.migratedFrom, { frame: 'lander-state@1', at: AT }); assert.deepEqual(L.stateErrors(m), []);
  assert.equal(actual.migrate.landing.builds[0].state, 'landing'); assert.equal(actual.migrate.landing.builds[0].attempts[0].result, 'started'); assert.equal(actual.migrate.landing.policy.maxAttempts, 2);
  assert.deepEqual(actual.migrate.empty.builds, []); assert.deepEqual(L.stateErrors(actual.migrate.empty), []);
});

// ------------------------------------------------------------------ the view (GET …/auto-lander) and the commands (POST …/auto-lander/<command>)

const v = actual.view;
t('the view: service from the heartbeat, current = the build in flight or on CI, queue in work order, every row with behind / paused / lastResult', () => {
  assert.equal(v.running.$axf, L.VIEW_FRAME); assert.deepEqual(L.viewErrors(v.running), []);
  assert.deepEqual([v.running.service.up, v.running.service.runner, v.running.service.paused, v.running.service.lastTick], [true, 'cron-lander', false, T(-2)]);
  assert.equal(v.running.current.build, 'skins-hot-swap'); assert.equal(v.running.current.title, 'Skins: hot-swap tokens'); assert.equal(v.running.current.state, 'ci-running');
  assert.deepEqual(v.running.queue, ['skins-hot-swap', 'notes-ci-running', 'console-dock-sizes', 'notes-nested-lists', 'pr-545', 'push-quiet-hours', 'ui-review-phone-shots', 'voice-wake-word']); // CI running first, then waiting by since (migrated rows without a since share AT and sort by id)
  assert.deepEqual(v.running.builds.slice(-3).map((r) => [r.build, r.state]), [['pr-538', 'landed'], ['pr-536', 'landed'], ['help-coverage-gate', 'escalated']]); // terminal rows after the queue, newest at first (the escalation was written a minute earlier)
  const byId = Object.fromEntries(v.running.builds.map((r) => [r.build, r]));
  assert.deepEqual([byId['notes-nested-lists'].behind, byId['pr-545'].behind, byId['console-dock-sizes'].paused, byId['console-dock-sizes'].hold, byId['ui-review-phone-shots'].paused], [12, L.BEHIND_UNKNOWN, true, HOLDS['console-dock-sizes'], false]);
  assert.deepEqual(byId['voice-wake-word'].lastResult.result, 'failed'); assert.equal(byId['skins-hot-swap'].lastResult, null); assert.equal(byId['help-coverage-gate'].lastResult.kind, 'red-ci');
  assert.deepEqual(v.running.service.counts, { builds: 11, queue: 8, inFlight: 0, ciRunning: 2, waiting: 6, landed: 2, escalated: 1, paused: 1 });
});
t('a stale heartbeat is down; a runner that says up is up; an empty state on a rule that is off is paused with nothing current', () => {
  assert.equal(v.stale.up, false); assert.equal(v.said.up, true); assert.equal(v.said.runner, 'axf-molly');
  assert.deepEqual([v.none.service.up, v.none.service.paused, v.none.current, v.none.queue, v.none.builds], [false, true, null, [], []]); assert.deepEqual(L.viewErrors(v.none), []);
});
t('lastResult is the latest ended attempt; an open one does not count; a row carries behind, title and the hold', () => {
  assert.equal(v.lastResult.none, null); assert.equal(v.lastResult.open, null); assert.deepEqual([v.lastResult.mixed.kind, v.lastResult.mixed.result, v.lastResult.mixed.at], ['land', 'failed', T(-99)]); assert.equal(v.lastResult.skipped.result, 'failed');
  assert.deepEqual([v.row.behind, v.row.paused, v.row.hold, v.row.title, v.row.lastResult.log], [4, true, 'paused by brett', 'Help coverage gate', 'merge refused: base branch was modified']);
  assert.deepEqual(v.errors.good, []); assert.ok(v.errors.bad.length >= 8); assert.ok(v.errors.bad.some((x) => /queue\[0\] ghost/.test(x))); assert.ok(v.errors.bad.some((x) => /current is null or one of builds/.test(x)));
});
const c = actual.commands;
t('commands: run / pause / resume take an optional build, retry needs one, settings takes none and a non-empty policy patch; every one carries a reason title', () => {
  for (const k of ['runAll', 'runOne', 'retry', 'pauseOne', 'pauseAll', 'resumeOne', 'settings']) assert.deepEqual(c.errors[k], [], k);
  assert.match(c.errors.retryNoBuild[0], /build names the build to retry/); assert.match(c.errors.settingsEmpty[0], /policy fields/); assert.ok(c.errors.settingsBad.some((x) => /build is empty for settings/.test(x))); assert.ok(c.errors.settingsBad.some((x) => /maxAttempts is 1\.\.10/.test(x)));
  assert.match(c.errors.noReason[0], /reason\.title/); assert.match(c.errors.unknown[0], /command is one of run, retry, pause, resume, settings/);
  assert.equal(c.norm.settings.$axf, L.COMMAND_FRAME); assert.deepEqual(c.norm.settings.settings, { maxAttempts: 5, fixSessions: false }); assert.equal(c.norm.runAll.settings, undefined); assert.equal(c.norm.unknown.command, 'run');
});
t('run by hand skips the backoff but never a limit or an open attempt', () => {
  assert.deepEqual(act(c.runNow.inBackoff), ['wait', 'waiting', 'red-ci', 2, 'backoff']); assert.deepEqual(act(c.runNow.now), ['fix-session', 'fixing', 'red-ci', 2, '']);
  assert.deepEqual(act(c.runNow.nowAtMax), ['escalate', 'escalated', 'red-ci', 3, '']); assert.deepEqual(act(c.runNow.nowInFlight), ['wait', 'fixing', 'red-ci', 1, 'in-flight']);
});

// ------------------------------------------------------------------ validation + snapshots

t('validation names every bad field', () => {
  assert.deepEqual(actual.errors.goodBuild, []); assert.deepEqual(actual.errors.goodState, []);
  assert.equal(actual.errors.badAttempt.length, 7); assert.ok(actual.errors.badBuild.some((x) => /more than one open/.test(x))); assert.ok(actual.errors.badBuild.some((x) => /numbered 1/.test(x))); assert.ok(actual.errors.badBuild.some((x) => /null unless escalated/.test(x)));
  assert.equal(actual.errors.escalatedNoWhy.length, 1); assert.equal(actual.errors.badPolicy.length, 7); assert.ok(actual.errors.badState.some((x) => /appears twice/.test(x)));
  assert.equal(actual.norm.policy.maxAttempts, 10); assert.equal(actual.norm.policy.backoff.baseMin, 5); assert.equal(actual.norm.policy.escalateTo, 'banner'); assert.equal(actual.norm.attempt, L.LOG_MAX); assert.equal(actual.norm.build.state, 'waiting');
});
t('schemas/auto-lander.json + schemas/json/auto-lander-*.schema.json are current (run axf schemas)', () => {
  assert.ok(same(JSON.parse(rd('framework/schemas/auto-lander.json')), L.REGISTRY));
  for (const [name, s] of Object.entries(L.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name);
});
t('PORTING.md and AUTO-LANDER.md carry the contract', () => { assert.match(rd('framework/spec/PORTING.md'), /auto-lander@1/); assert.match(rd('framework/spec/AUTO-LANDER.md'), /decide\(build, prState, attempts, policy/); });
console.log(`check-auto-lander: ${n} checks passed`);
