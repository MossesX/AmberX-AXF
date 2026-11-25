/**
 * Watch coverage (watch-coverage@1): every status a build or step can stand in has a watcher inside its limit.
 *   node --test deploy/watchdog/coverage.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P2 from '../../framework/core/pipeline-status.mjs';
import * as W from './core.mjs';
import * as C from './coverage.mjs';
import { AUDITS } from './audits.mjs';

const keys = (list) => list.map((g) => g.key);

test('the table has one row for every status of the contract that is not an end status', () => {
  const rows = C.coverage();
  const have = (kind) => rows.filter((r) => r.kind === kind).map((r) => r.status);
  assert.deepEqual(have('build'), P2.BUILD_STATUSES.filter((s) => s !== 'landed'));
  assert.deepEqual(have('step'), P2.STEP_STATUSES.filter((s) => s !== 'in-pr'));
  for (const r of rows) assert.ok(r.watchers.every((w) => w.by && w.action && w.limitMin > 0), `${r.kind} ${r.status}`);
});

test('as shipped: nothing is unwatched, and no gap is left but the known ones', async () => {
  const list = C.gaps(C.coverage({ stale: await C.staleDefaults() }));
  assert.deepEqual(keys(list.filter((g) => g.rule === 'unwatched')), []);
  assert.deepEqual(keys(C.failing(list)), []);
});

test('every known gap names the build that closes it', () => {
  for (const [key, k] of Object.entries(C.KNOWN_GAPS)) { assert.match(key, /^(build|step):[a-z-]+:(unwatched|slow)$/); assert.ok(k.build && k.why, key); }
});

test('a status with no budget is unwatched: a status added to the flow without a limit fails here', () => {
  const b = W.normSettings().budgets;
  const build = { ...b.build }; delete build['merging-pr'];
  const step = { ...b.step }; delete step.sending;
  const list = C.gaps(C.coverage({ budgets: { build, step } }));
  assert.ok(keys(list).includes('build:merging-pr:unwatched'));
  assert.ok(keys(list).includes('step:sending:unwatched'));
  assert.ok(keys(C.failing(list)).includes('build:merging-pr:unwatched'));
});

test('a landing status looked at later than the ceiling is slow; the other statuses have no ceiling', () => {
  const s = W.normSettings({ budgets: { build: { 'merging-main': C.LANDING_CEILING_MIN + 1, building: 900 } } });
  const list = C.gaps(C.coverage({ budgets: s.budgets }));
  assert.ok(keys(C.failing(list)).includes('build:merging-main:slow'));
  assert.ok(!keys(list).some((k) => k.startsWith('build:building')));
});

test('running-ci: slow at 60 minutes, covered once any watcher has a short limit', () => {
  const at = (budgets, stale = null) => keys(C.gaps(C.coverage({ budgets, stale }))).includes('build:running-ci:slow');
  const d = W.normSettings().budgets;
  assert.equal(at({ ...d, build: { ...d.build, 'running-ci': 60 } }), true);
  assert.equal(at(W.normSettings({ budgets: { build: { 'running-ci': 15 } } }).budgets), false);
  // the Stuck statuses watch counts as a watcher of a status it lists
  assert.equal(at({ ...d, build: { ...d.build, 'running-ci': 60 } }, { landing: 90, 'running-ci': 12 }), false);
  const row = C.coverage({ budgets: { ...d, build: { ...d.build, 'running-ci': 60 } }, stale: { 'running-ci': 12 } }).find((r) => r.kind === 'build' && r.status === 'running-ci');
  assert.equal(row.limitMin, 12); assert.equal(row.watchers.length, 2);
});

test('live: a watchdog or watch switched off, or a schedule not installed, is a gap', () => {
  assert.deepEqual(C.offGaps({ layer2: { enabled: true }, schedules: { ok: true, files: {} }, watchdogs: { enabled: true, cron: { installed: true }, watches: [{ id: 'stale', label: 'Stuck statuses', available: true, enabled: true }] } }), []);
  const off = keys(C.offGaps({
    layer2: { enabled: false },
    schedules: { ok: false, files: { 'axf-watchdog-l2': 'missing', 'axf-watchdog-audits': 'ok' }, l3Timer: 'inactive', retiredPresent: [] },
    watchdogs: { enabled: true, cron: { installed: false, file: '/etc/cron.d/axf-build-watchdog' }, watches: [{ id: 'sessions', label: 'Build sessions', available: true, enabled: false }, { id: 'stale', label: 'Stuck statuses', available: true, enabled: true }, { id: 'rows', available: false, error: 'boom' }] },
  }));
  assert.deepEqual(off, ['watch:layer-2:off', 'watch:schedules:off', 'watch:build-watchdog-cron:off', 'watch:sessions:off', 'watch:rows:off']);
  const g = C.offGaps({ schedules: { ok: false, files: { 'axf-watchdog-l2': 'missing' }, l3Timer: 'inactive' } })[0];
  assert.match(g.why, /axf-watchdog-l2 missing; axf-watchdog-l3\.timer inactive/);
});

test('check: the live settings are the ones measured, and an off gap fails it', async () => {
  const base = { settings: W.normSettings({ budgets: { build: { 'running-ci': 15 } } }), schedules: { ok: true, files: {} }, watchdogs: null, staleLimits: null };
  const ok = await C.check({ facts: base });
  assert.equal(ok.ok, true); assert.deepEqual(ok.gaps, []);
  const raised = await C.check({ facts: { ...base, settings: W.normSettings({ budgets: { build: { 'running-ci': 15, 'merging-pr': 45 } } }) } });
  assert.equal(raised.ok, false); assert.deepEqual(keys(raised.failing), ['build:merging-pr:slow']);
  const off = await C.check({ facts: { ...base, settings: W.normSettings({ enabled: false, budgets: { build: { 'running-ci': 15 } } }) } });
  assert.deepEqual(keys(off.failing), ['watch:layer-2:off']);
  assert.match(C.text(off.rows, off.gaps), /GAP \[off\] the Pipeline 2\.0 watchdog is switched off/);
});

test('the check runs in the watchdog audits, so a gap is one alert', () => {
  const a = AUDITS.find((x) => x.id === 'coverage');
  assert.deepEqual(a?.cmd, ['node', 'deploy/watchdog/coverage.mjs', 'check']);
});
