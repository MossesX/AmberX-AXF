#!/usr/bin/env node
/**
 * gate-rules@1 conformance: the default rule set, the migration from today's push banner lander settings, evaluate
 * verdicts (green, red CI, UI Review held, code clash, draft, held by hand, a warn rule), lander-state@1 from the merge
 * queue, validation, and the schema snapshots.
 *   node framework/spec/check-gate-rules.mjs           check
 *   node framework/spec/check-gate-rules.mjs --write   regenerate fixtures/gate-rules.json's expected outputs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../core/gate-rules.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/gate-rules.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-15T12:00:00Z';

// ------------------------------------------------------------------ inputs

/** The push banner's config.json as the lander reads it on Nov 15 2026 (autoLand off since Nov 4, batch queue, UI hold on). */
const CONFIG_TODAY = { autoLand: false, landWaitUi: true, mergeQueue: true, queueMode: 'batch', queueDepth: 3, batchSize: 8, quietHours: { from: 23, to: 7 } };
/** The same file once build auto-lander-controls-in-the-gate-plugin (#705) lands: the one switch and serial mode. */
const CONFIG_705 = { autoLand: false, landWaitUi: true, mergeQueue: true, queueMode: 'batch', batchSize: 8, autoLander: { enabled: true, mode: 'serial' } };
/** UI hold switched off and the stack queue two deep, as a hand might set it. */
const CONFIG_HAND = { landWaitUi: false, queueMode: 'stack', queueDepth: 2, autoLander: { enabled: false, mode: 'merge-queue' } };
/** The auto-lander tuned by hand (Nov 16 2026 keys): five tries, two minutes before the second, no fix sessions. */
const CONFIG_AUTO = { autoLander: { enabled: true, mode: 'serial', maxAttempts: 5, backoffMin: 2, fix: false } };
/** A rule set saved before the auto-lander rule existed (the first eight defaults, rev 4). */
const SAVED_EIGHT = (() => { const s = G.defaultRuleSet({ at: AT }); return { ...s, rev: 4, rules: s.rules.filter((r) => r.id !== 'auto-lander') }; })();

const SNAPSHOTS = {
  green: { number: 701, title: 'Skins: hot-swap tokens', build: 'skins-hot-swap', branch: 'claude/skins-hot-swap', head: 'a701a701a701a701a701a701a701a701a701a701', ci: 'success', ui: '' },
  redCi: { number: 702, title: 'Help: coverage gate', build: 'help-coverage-gate', head: 'b702b702b702b702b702b702b702b702b702b702', ci: 'failure', failing: ['android / check-theme', 'android / conformance tests'], ui: '' },
  redCiSerial: { number: 702, head: 'b702b702b702b702b702b702b702b702b702b702', ci: 'failure', failing: ['android / check-controls'] },
  ciRunning: { number: 706, head: 'c706c706c706c706c706c706c706c706c706c706', ci: 'running' },
  uiWaiting: { number: 703, title: 'UI Review: phone shots', build: 'ui-review-phone-shots', head: 'c703c703c703c703c703c703c703c703c703c703', ci: 'success', ui: 'waiting' },
  uiChanges: { number: 703, head: 'c703c703c703c703c703c703c703c703c703c703', ci: 'success', ui: 'changes' },
  clash: { number: 704, title: 'Console: dock sizes', build: 'console-dock-sizes', head: 'd704d704d704d704d704d704d704d704d704d704', ci: 'none', conflicts: ['framework/ui/axf.css', 'apps/console-web/src/App.tsx'], dataConflicts: ['_claude/builds/store.json'] },
  dataClashOnly: { number: 707, head: 'e707e707e707e707e707e707e707e707e707e707', ci: 'success', dataConflicts: ['_claude/builds/store.json', 'framework/spec/fixtures/theme.json'] },
  draft: { number: 705, head: 'f705f705f705f705f705f705f705f705f705f705', ci: 'none', draft: true },
  heldByHand: { number: 701, head: 'a701a701a701a701a701a701a701a701a701a701', ci: 'success', landHeld: 'waiting for the skins build' },
  kicked: { number: 537, head: 'e537e537e537e537e537e537e537e537e537e537', ci: 'success', kicked: '#537 broke CI when tested on top of main (failed: android / conformance).' },
  directMerge: { number: 708, head: 'a708a708a708a708a708a708a708a708a708a708', ci: 'success', mergeVia: 'direct' },
  namedChecks: { number: 709, head: 'b709b709b709b709b709b709b709b709b709b709', ci: 'failure', failing: ['lint'], checks: { theme: 'pass', controls: 'pass', toolbars: 'fail', tests: 'pass' } },
};

/** The default set with UI Review as a warning and the toolbars rule off: a warn never blocks, an off rule is skipped. */
const SOFT_SET = (() => { const s = G.defaultRuleSet({ at: AT }); for (const r of s.rules) { if (r.id === 'ui-review') r.severity = 'warn'; if (r.id === 'toolbars') r.enabled = false; } return s; })();
/** Two rules handed to axf-molly. */
const SPLIT_SET = (() => { const s = G.defaultRuleSet({ at: AT }); for (const r of s.rules) if (r.id === 'ci-green' || r.id === 'tests') r.owner = 'axf-molly'; return s; })();

/** A merge queue as the runner left it: one batch under test, one behind it with a data clash, one held by UI Review, one kicked, two landed. */
const QUEUE = {
  $axf: 'merge-queue@1', at: '2026-11-15T11:57:00Z', on: true, mode: 'batch',
  items: [
    { pr: 540, title: 'Skins: hot-swap tokens', url: 'https://github.com/MossesX/AmberX-AXF/pull/540', branch: 'claude/skins-hot-swap', head: 'a540a540a540a540a540a540a540a540a540a540', build: 'skins-hot-swap', state: 'testing', ci: 'running', startedAt: '2026-11-15T11:50:00Z', runUrl: 'https://github.com/MossesX/AmberX-AXF/actions/runs/9001', why: '' },
    { pr: 543, title: 'Notes: nested lists', url: 'https://github.com/MossesX/AmberX-AXF/pull/543', branch: 'claude/notes-nested', head: 'c543c543c543c543c543c543c543c543c543c543', build: 'notes-nested-lists', state: 'waiting', ci: '', why: 'conflicts in code with #540; goes in the next batch' },
    { pr: 539, title: 'Push banner: quiet hours', url: 'https://github.com/MossesX/AmberX-AXF/pull/539', branch: 'claude/quiet-hours', head: 'd539d539d539d539d539d539d539d539d539d539', build: 'push-quiet-hours', state: 'waiting', ci: '', why: '' },
  ],
  waiting: [
    { pr: 544, title: 'UI Review: phone shots', branch: 'claude/phone-shots', head: 'a544a544a544a544a544a544a544a544a544a544', build: 'ui-review-phone-shots', state: 'held', why: 'its screenshots wait for Brett in UI Review' },
    { pr: 537, title: 'Voice: wake word', branch: 'claude/wake-word', head: 'e537e537e537e537e537e537e537e537e537e537', build: 'voice-wake-word', state: 'kicked', why: 'kicked out: #537 broke CI when tested on top of main (failed: android / conformance). Push a fix and it rejoins by itself.' },
    { pr: 545, title: 'Draft: nothing yet', head: 'b545b545b545b545b545b545b545b545b545b545', state: 'held', why: 'it is a draft' },
    { pr: 535, title: 'Console: dock sizes', head: 'f535f535f535f535f535f535f535f535f535f535', build: 'console-dock-sizes', state: 'held', why: 'taken out of the queue by hand (waiting for the skins build)' },
  ],
  merged: [{ pr: 538, at: '2026-11-15T11:40:00Z' }, { pr: 536, at: '2026-11-15T11:40:00Z' }],
};
const CONTROL = { $axf: 'merge-queue-control@1', removed: { 535: { why: 'waiting for the skins build', head: 'f535f535f535f535f535f535f535f535f535f535' } } };
const RUNS = [
  { $axf: 'auto-lander-run@1', startedAt: '2026-11-15T11:51:00Z', finishedAt: '2026-11-15T11:51:20Z', result: 'idle', mode: 'batch', reason: 'queue-empty', reasonText: 'Nothing is ready to land.', landing: null, merged: [], waiting: 0 },
  { $axf: 'auto-lander-run@1', startedAt: '2026-11-15T11:54:00Z', finishedAt: '2026-11-15T11:54:30Z', result: 'landing', mode: 'batch', reason: 'ci-waiting', reasonText: 'Waiting for CI on the PR being landed.', landing: { pr: 540, title: 'Skins: hot-swap tokens', build: 'skins-hot-swap', ci: 'running' }, merged: [], waiting: 2 },
];

const IN = { CONFIG_TODAY, CONFIG_705, CONFIG_HAND, CONFIG_AUTO, SAVED_EIGHT, SNAPSHOTS, SOFT_SET, SPLIT_SET, QUEUE, CONTROL, RUNS, AT };

// ------------------------------------------------------------------ outputs

function run() {
  const set = G.defaultRuleSet({ at: AT });
  return {
    defaultRuleSet: set,
    migrate: { today: G.migrate(CONFIG_TODAY, { at: AT }), after705: G.migrate(CONFIG_705, { at: AT }), byHand: G.migrate(CONFIG_HAND, { at: AT }), auto: G.migrate(CONFIG_AUTO, { at: AT }), empty: G.migrate({}, { at: AT }) },
    joinDefaults: { savedEight: G.joinDefaults(SAVED_EIGHT, { at: AT }), complete: G.joinDefaults(set, { at: AT }) },
    landerSettings: { today: G.landerSettingsFrom(CONFIG_TODAY), after705: G.landerSettingsFrom(CONFIG_705), byHand: G.landerSettingsFrom(CONFIG_HAND), empty: G.landerSettingsFrom({}) },
    evaluate: Object.fromEntries(Object.entries(SNAPSHOTS).map(([k, s]) => [k, G.evaluate(set, s, { at: AT })])),
    evaluateSerial: G.evaluate(G.migrate(CONFIG_705, { at: AT }), SNAPSHOTS.redCiSerial, { at: AT }),
    evaluateBatch: G.evaluate(G.migrate(CONFIG_TODAY, { at: AT }), SNAPSHOTS.redCi, { at: AT }),
    evaluateSoft: { uiWaiting: G.evaluate(SOFT_SET, SNAPSHOTS.uiWaiting, { at: AT }), uiChanges: G.evaluate(SOFT_SET, SNAPSHOTS.uiChanges, { at: AT }), namedChecks: G.evaluate(SOFT_SET, SNAPSHOTS.namedChecks, { at: AT }) },
    evaluateSplit: { console: G.evaluate(SPLIT_SET, SNAPSHOTS.redCi, { owner: 'console', at: AT }), molly: G.evaluate(SPLIT_SET, SNAPSHOTS.redCi, { owner: 'axf-molly', at: AT }) },
    landerState: {
      running: G.landerStateFrom({ config: CONFIG_TODAY, queue: QUEUE, control: CONTROL, runs: RUNS, at: AT }),
      paused: G.landerStateFrom({ config: CONFIG_TODAY, queue: QUEUE, control: CONTROL, runs: RUNS, pause: { why: 'Brett is landing one by hand', by: 'brett', at: '2026-11-15T11:58:00Z' }, at: AT }),
      off: G.landerStateFrom({ config: CONFIG_HAND, queue: {}, runs: [{ startedAt: AT, finishedAt: AT, result: 'skipped', reason: 'switched-off' }], at: AT }),
      empty: G.landerStateFrom({ at: AT }),
    },
    ruleForWhy: Object.fromEntries(['', 'its screenshots wait for Brett in UI Review', 'UI Review holds it (changes)', 'it conflicts with main in code (framework/ui/axf.css)', 'conflicts in code with #540; goes in the next batch', 'its PR checks are red', 'its PR checks have not run yet', 'its batch went red: tested again in a smaller batch', 'it is a draft', 'it comes from a fork', "couldn't build its queue commit; tried again when its head or main changes", 'taken out of the queue by hand (x)', 'kicked out: #537 broke CI when tested on top of main.'].map((w) => [w || '(empty)', G.ruleForWhy(w)])),
    errors: {
      goodSet: G.ruleSetErrors(set), badRule: G.ruleErrors({ id: 'Bad Id', kind: 'x', enabled: 'yes', severity: 'hard', owner: 'me', settings: [] }),
      dupIds: G.ruleSetErrors({ $axf: G.SET_FRAME, rev: 1, at: AT, rules: [set.rules[0], set.rules[0]] }), notASet: G.ruleSetErrors({ rev: -1, at: 'yesterday' }),
      goodState: G.landerStateErrors(G.landerStateFrom({ config: CONFIG_TODAY, queue: QUEUE, control: CONTROL, runs: RUNS, at: AT })),
      badState: G.landerStateErrors({ $axf: G.STATE_FRAME, at: AT, status: 'paused', paused: false, mode: 'merge-queue', lastRuns: [{ result: 'done', reason: 'why' }], waiting: [{ pr: 0, state: 'zzz', reason: '', rule: 'Bad Rule' }], landing: {} }),
    },
    norm: { rule: G.normRule({ id: 'x', kind: 'nope', severity: 'loud', owner: 'nobody', enabled: 'y', settings: null, source: 'config.json foo' }), run: G.normRun({ startedAt: AT, result: 'landed', mode: 'merge-queue', merged: [1, 0, -2, 'x', 5], reason: 'nope' }) },
  };
}
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'gate-rules@1', note: 'Generated by framework/spec/check-gate-rules.mjs --write; every port replays `in` (configs, PR snapshots, rule sets, a merge queue) and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ the rules themselves

const ids = (s) => s.rules.map((r) => r.id);
t('the default set: nine rules in gate order, every one on and console; every gate rule blocks, the auto-lander policy is info', () => {
  assert.deepEqual(ids(actual.defaultRuleSet), ['merge-queue-only', 'ci-green', 'tests', 'theme', 'controls', 'toolbars', 'ui-review', 'clash', 'auto-lander']);
  assert.ok(actual.defaultRuleSet.rules.every((r) => r.enabled && r.owner === 'console' && r.source));
  assert.ok(actual.defaultRuleSet.rules.every((r) => r.severity === (r.id === 'auto-lander' ? 'info' : 'block')));
  assert.deepEqual(actual.defaultRuleSet.rules.find((r) => r.id === 'auto-lander').settings, { maxAttempts: 3, backoff: { baseMin: 5, factor: 3, maxMin: 60 }, attemptTimeoutMin: 45, mergeMain: true, fixSessions: true, land: true, escalateTo: 'banner' });
  assert.deepEqual(G.ruleSetErrors(actual.defaultRuleSet), []);
  assert.deepEqual(new Set(actual.defaultRuleSet.rules.map((r) => r.kind)), new Set(G.KINDS));
});
t('migration from today: batch queue, autoLand off, UI hold on, every key named, nothing dropped', () => {
  const m = actual.migrate.today; const mq = m.rules.find((r) => r.id === 'merge-queue-only');
  assert.deepEqual(m.migratedFrom.keys, ['autoLand', 'landWaitUi', 'mergeQueue', 'queueMode', 'queueDepth', 'batchSize']);
  assert.deepEqual(mq.settings, { mode: 'batch', autoLand: false, directMerge: false, depth: 3, batchSize: 8 });
  assert.equal(m.rules.find((r) => r.id === 'ui-review').enabled, true); assert.equal(m.rules.find((r) => r.id === 'ci-green').settings.redJoins, true);
  assert.deepEqual(ids(m), ids(actual.defaultRuleSet)); assert.deepEqual(G.ruleSetErrors(m), []);
  assert.deepEqual(actual.landerSettings.today, { enabled: true, mode: 'batch', autoLand: false, waitUi: true, depth: 3, batchSize: 8 });
});
t('migration after #705: serial mode, CI judged on the head, red never joins', () => {
  const m = actual.migrate.after705;
  assert.equal(m.rules.find((r) => r.id === 'merge-queue-only').settings.mode, 'serial');
  assert.deepEqual(m.rules.find((r) => r.id === 'ci-green').settings, { on: 'head', redJoins: false, noRunMin: 10 });
  assert.deepEqual(actual.landerSettings.after705, { enabled: true, mode: 'serial', autoLand: false, waitUi: true, depth: 3, batchSize: 8 });
});
t('migration by hand: UI hold off becomes the ui-review rule off; the lander off is lander state, not a rule', () => {
  const m = actual.migrate.byHand;
  assert.equal(m.rules.find((r) => r.id === 'ui-review').enabled, false); assert.equal(m.rules.find((r) => r.id === 'merge-queue-only').settings.mode, 'stack');
  assert.equal(m.rules.find((r) => r.id === 'merge-queue-only').enabled, true); assert.equal(actual.landerSettings.byHand.enabled, false);
});
t('the auto-lander rule: the lander switch is its switch, the new keys tune it, the old mode flags never turn fixing off', () => {
  const al = (m) => m.rules.find((r) => r.id === 'auto-lander');
  assert.equal(al(actual.migrate.today).enabled, true); assert.deepEqual(al(actual.migrate.today).settings, al(actual.defaultRuleSet).settings); // autoLand false, mergeQueue on: still fixes and lands
  assert.equal(al(actual.migrate.byHand).enabled, false); // autoLander.enabled false
  const a = al(actual.migrate.auto); assert.equal(a.enabled, true); assert.equal(a.settings.maxAttempts, 5); assert.equal(a.settings.backoff.baseMin, 2); assert.equal(a.settings.fixSessions, false); assert.equal(a.settings.land, true);
  assert.deepEqual(actual.migrate.auto.migratedFrom.keys, ['autoLander.enabled', 'autoLander.mode', 'autoLander.maxAttempts', 'autoLander.backoffMin', 'autoLander.fix']);
  assert.equal(actual.evaluate.green.results.find((r) => r.id === 'auto-lander').verdict, 'pass'); assert.equal(actual.evaluate.redCi.results.find((r) => r.id === 'auto-lander').verdict, 'pass'); // a policy, never a gate
});
t('a saved eight-rule set gains the auto-lander rule on read; a complete set is returned as is', () => {
  const j = actual.joinDefaults.savedEight; assert.deepEqual(ids(j), ids(actual.defaultRuleSet)); assert.equal(j.rev, 4); assert.deepEqual(j.joinedDefaults, ['auto-lander']); assert.equal(j.rules.at(-1).updatedBy, 'defaults'); assert.deepEqual(G.ruleSetErrors(j), []);
  assert.equal(actual.joinDefaults.complete.joinedDefaults, undefined); assert.deepEqual(ids(actual.joinDefaults.complete), ids(actual.defaultRuleSet));
});
t('an empty config migrates to the defaults with no keys named', () => { assert.deepEqual(actual.migrate.empty.migratedFrom.keys, []); assert.deepEqual(actual.migrate.empty.rules.map((r) => r.settings), actual.defaultRuleSet.rules.map((r) => r.settings)); });

// ------------------------------------------------------------------ verdicts

const ev = actual.evaluate; const by = (v, id) => v.results.find((r) => r.id === id);
t('green: every rule passes, nothing holds it', () => { assert.equal(ev.green.pass, true); assert.equal(ev.green.blockedBy, ''); assert.ok(ev.green.results.every((r) => r.verdict === 'pass')); assert.deepEqual(ev.green.reasons, []); assert.equal(ev.green.$axf, G.VERDICT_FRAME); });
t('red CI in batch mode: the named checks fail, the whole run only holds, a fix is wanted, the headline is the failing check', () => {
  const b = actual.evaluateBatch;
  assert.equal(b.pass, false); assert.equal(b.held, false); assert.equal(b.agent, true);
  assert.equal(by(b, 'ci-green').verdict, 'hold'); assert.equal(by(b, 'theme').verdict, 'fail'); assert.equal(by(b, 'tests').verdict, 'fail'); assert.equal(by(b, 'controls').verdict, 'hold');
  assert.equal(b.blockedBy, 'tests');
});
t('the default set lands one at a time (merge queue off): red CI fails ci-green itself', () => {
  assert.equal(actual.defaultRuleSet.rules.find((r) => r.id === 'merge-queue-only').settings.mode, 'serial');
  assert.equal(by(ev.redCi, 'ci-green').verdict, 'fail'); assert.equal(ev.redCi.blockedBy, 'ci-green'); assert.equal(ev.redCi.agent, true);
  assert.equal(actual.landerSettings.empty.mode, 'serial');
});
t('red CI in serial mode: ci-green itself fails', () => { assert.equal(actual.evaluateSerial.pass, false); assert.equal(by(actual.evaluateSerial, 'ci-green').verdict, 'fail'); assert.equal(actual.evaluateSerial.blockedBy, 'ci-green'); assert.equal(by(actual.evaluateSerial, 'controls').verdict, 'fail'); });
t('CI running: a hold, not a failure, and no agent', () => { assert.equal(ev.ciRunning.held, true); assert.equal(ev.ciRunning.agent, false); assert.equal(ev.ciRunning.blockedBy, 'ci-green'); });
t('UI Review waiting holds; changes asked fails', () => {
  assert.equal(ev.uiWaiting.pass, false); assert.equal(ev.uiWaiting.held, true); assert.equal(ev.uiWaiting.blockedBy, 'ui-review'); assert.match(ev.uiWaiting.reasons[0], /waiting in UI Review/);
  assert.equal(ev.uiChanges.held, false); assert.equal(by(ev.uiChanges, 'ui-review').verdict, 'fail');
});
t('a code clash is the headline even though CI never ran; data clashes resolve by themselves', () => {
  assert.equal(ev.clash.pass, false); assert.equal(ev.clash.blockedBy, 'clash'); assert.equal(ev.clash.agent, true); assert.deepEqual(by(ev.clash, 'clash').files, ['framework/ui/axf.css', 'apps/console-web/src/App.tsx']);
  assert.equal(ev.dataClashOnly.pass, true); assert.match(by(ev.dataClashOnly, 'clash').reason, /resolve by themselves/);
});
t('a draft and a direct merge are refused by merge-queue-only', () => { assert.equal(ev.draft.blockedBy, 'merge-queue-only'); assert.equal(ev.directMerge.pass, false); assert.match(by(ev.directMerge, 'merge-queue-only').reason, /only the lander merges/); });
t('holds by hand are not rules: every rule passes, the PR still does not land', () => {
  assert.equal(ev.heldByHand.pass, false); assert.equal(ev.heldByHand.blockedBy, 'hand:held'); assert.ok(ev.heldByHand.results.every((r) => r.verdict === 'pass')); assert.equal(ev.heldByHand.held, true);
  assert.equal(ev.kicked.blockedBy, 'hand:kicked'); assert.match(ev.kicked.reasons[0], /rejoins by itself/);
});
t("named check results win over the run's colour", () => { const v = ev.namedChecks; assert.equal(by(v, 'theme').verdict, 'pass'); assert.equal(by(v, 'toolbars').verdict, 'fail'); assert.equal(by(v, 'tests').verdict, 'pass'); assert.equal(v.blockedBy, 'ci-green'); // one at a time: the red run itself is the headline
});
t('a warn rule never blocks and an off rule is skipped', () => {
  const s = actual.evaluateSoft;
  assert.equal(s.uiWaiting.pass, true); assert.deepEqual(s.uiWaiting.warnings, []); assert.equal(s.uiChanges.pass, true); assert.equal(s.uiChanges.warnings.length, 1);
  assert.equal(by(s.namedChecks, 'toolbars').verdict, 'skip'); assert.equal(s.namedChecks.blockedBy, 'ci-green');
});
t('rules handed to axf-molly are skipped on the console side and run on molly', () => {
  const c = actual.evaluateSplit.console; const m = actual.evaluateSplit.molly;
  assert.equal(by(c, 'ci-green').verdict, 'skip'); assert.match(by(c, 'ci-green').reason, /axf-molly/); assert.equal(by(c, 'theme').verdict, 'fail');
  assert.equal(by(m, 'ci-green').verdict, 'fail'); assert.equal(by(m, 'theme').verdict, 'skip');
});

// ------------------------------------------------------------------ lander state

t('lander-state from the merge queue: running on #540, every other PR waits with the rule that holds it', () => {
  const s = actual.landerState.running;
  assert.equal(s.status, 'running'); assert.equal(s.landing.pr, 540); assert.equal(s.mode, 'batch'); assert.equal(s.source, 'merge-queue@1');
  assert.deepEqual(s.waiting.map((w) => [w.pr, w.state, w.rule]), [[543, 'waiting', 'clash'], [539, 'waiting', ''], [544, 'held', 'ui-review'], [537, 'kicked', 'ci-green'], [545, 'held', 'merge-queue-only'], [535, 'held', '']]);
  assert.ok(s.waiting.every((w) => w.reason)); assert.deepEqual(s.landedRecently, [538, 536]); assert.equal(s.lastRuns.length, 2); assert.deepEqual(G.landerStateErrors(s), []);
});
t('paused by hand says who and why; off says off; nothing at all is idle', () => {
  assert.equal(actual.landerState.paused.status, 'paused'); assert.equal(actual.landerState.paused.pause.by, 'brett'); assert.deepEqual(G.landerStateErrors(actual.landerState.paused), []);
  assert.equal(actual.landerState.off.status, 'off'); assert.equal(actual.landerState.off.enabled, false); assert.equal(actual.landerState.off.mode, 'stack');
  assert.equal(actual.landerState.empty.status, 'idle'); assert.deepEqual(actual.landerState.empty.waiting, []); assert.deepEqual(G.landerStateErrors(actual.landerState.empty), []);
});

// ------------------------------------------------------------------ validation + snapshots

t('validation names every bad field', () => {
  assert.deepEqual(actual.errors.goodSet, []); assert.equal(actual.errors.badRule.length, 6); assert.ok(actual.errors.dupIds.some((e) => /appears twice/.test(e)));
  assert.deepEqual(actual.errors.goodState, []); assert.ok(actual.errors.badState.length >= 7);
  assert.deepEqual(actual.norm.rule, { $axf: G.RULE_FRAME, id: 'x', kind: 'custom', enabled: true, severity: 'block', owner: 'console', title: '', description: '', settings: {}, source: 'config.json foo' });
  assert.deepEqual(actual.norm.run.merged, [1, 5]); assert.equal(actual.norm.run.mode, 'batch'); assert.equal(actual.norm.run.reason, '');
});
t('schemas/gate-rules.json + schemas/json/gate-rule*.schema.json + lander-state.schema.json are current (run axf schemas)', () => {
  assert.ok(same(JSON.parse(rd('framework/schemas/gate-rules.json')), G.REGISTRY));
  for (const [name, s] of Object.entries(G.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name);
});
t('PORTING.md lists the contract', () => assert.match(rd('framework/spec/PORTING.md'), /gate-rules@1/));
console.log(`check-gate-rules: ${n} checks passed`);
