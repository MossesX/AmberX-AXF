// node --test deploy/watchdog/ended.test.mjs — a building step whose session is gone: finished, or dead? And the two
// kinds of build the layer-2 watchdog leaves alone (a hand build being built, a build stopped at its budget).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as C from './core.mjs';
import { endedOf } from './layer2.mjs';

const NOW = Date.parse('2026-11-23T20:30:00Z');
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const building = (more = {}) => ({ flow: 'pipeline-2', id: 'b', status: 'building', statusAt: ago(8), notes: [], steps: [{ id: 's7', status: 'building', statusAt: ago(6), attempt: 1, model: 'Fable', account: 'a', tmux: 'axf-b--s7--earl' }], ...more });

test('a session that is gone after a clean exit is a finished step, never a dead one (Nov 23 2026: s7 gave up against its own stale lock)', () => {
  const store = { builds: [building()] };
  const gone = { 'b/s7': { session: 'axf-b--s7--earl', tmux: false, logTail: '', logAgeMin: 3, ended: { exit: 0, kind: 'phase-done' } } };
  const issues = C.findIssues(store, { probes: gone, now: NOW });
  assert.deepEqual(issues.map((i) => [i.kind, i.build, i.step, i.cause]), [['step-ended', 'b', 's7', 'clean-exit']]);
  const d = C.plan(issues[0], { now: NOW, store });
  assert.equal(d.action, 'complete');
  const note = C.applyDecision(store, issues[0], d, { now: NOW });
  assert.match(note, /step s7 completed: its session axf-b--s7--earl ended cleanly/);
  const s = store.builds[0].steps[0];
  assert.deepEqual([s.status, s.attempt, s.done, s.statusBy], ['completed', 1, true, C.BY], 'completed on the attempt it ran on: no attempt is spent');
});

test('a session that is gone with a failing exit, or with no session-end at all, is still dead and retried forward', () => {
  for (const ended of [{ exit: 1, kind: 'crash' }, { exit: 143, kind: 'stopped' }, null, undefined]) {
    const store = { builds: [building()] };
    const issues = C.findIssues(store, { probes: { 'b/s7': { session: 'axf-b--s7--earl', tmux: false, logTail: '', ended } }, now: NOW });
    assert.deepEqual(issues.map((i) => i.kind), ['step-dead'], `ended = ${JSON.stringify(ended)}`);
    assert.equal(C.plan(issues[0], { now: NOW, store }).action, 'fail-dead');
  }
});

test('a clean exit inside the grace period, or with the session still alive, raises nothing', () => {
  const young = building({ steps: [{ id: 's7', status: 'building', statusAt: ago(1), tmux: 'axf-b--s7--earl' }] });
  assert.deepEqual(C.findIssues({ builds: [young] }, { probes: { 'b/s7': { tmux: false, ended: { exit: 0 } } }, now: NOW }), []);
  assert.deepEqual(C.findIssues({ builds: [building()] }, { probes: { 'b/s7': { tmux: true, logAgeMin: 0 } }, now: NOW }), []);
});

test('a usage limit in the log still wins over a clean exit code', () => {
  const issues = C.findIssues({ builds: [building()] }, { probes: { 'b/s7': { tmux: false, logTail: "You've hit your weekly limit", ended: { exit: 0 } } }, now: NOW });
  assert.deepEqual(issues.map((i) => i.kind), ['step-limit']);
});

test('the session-end event is read from the launcher\'s events file: the last one for that session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axf-wd-ended-'));
  writeFileSync(join(dir, 'events.jsonl'), [
    { event: 'session-start', session: 'axf-b--s7--earl' }, { event: 'session-end', session: 'axf-b--s7--earl', exit: 1, kind: 'crash' },
    { event: 'session-end', session: 'axf-b--s7--earl', exit: 0, kind: 'phase-done' }, { event: 'session-end', session: 'axf-b--s70--earl', exit: 9, kind: 'crash' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const env = { AXF_HEADLESS_DIR: dir };
  assert.deepEqual(endedOf('axf-b--s7--earl', env), { exit: 0, kind: 'phase-done' });
  assert.equal(endedOf('axf-b--s9--earl', env), null, 'no session-end line: not known');
  assert.equal(endedOf('', env), null);
});

test('a hand build that is being built is left alone; from build-complete on it is watched like any other', () => {
  const hand = { at: ago(60), by: 'Earl the Ear' };
  const out = building({ id: 'h', hand, statusAt: ago(900), steps: [{ id: 's1', status: 'building', statusAt: ago(900), tmux: 'axf-h--earl' }] });
  assert.deepEqual(C.findIssues({ builds: [out] }, { probes: { 'h/s1': { tmux: false } }, now: NOW }), [], 'a dead session: not relaunched from here');
  const crashed = { ...out, status: 'failed', failedFrom: 'building', attempt: 1, steps: [{ id: 's1', status: 'failed', failedFrom: 'building', attempt: 1 }] };
  assert.deepEqual(C.findIssues({ builds: [crashed] }, { now: NOW }), [], 'a crashed hand build is started again by hand, never retried here');
  const landing = { ...out, status: 'build-complete', statusAt: ago(45), steps: [{ id: 's1', status: 'completed', statusAt: ago(45) }] };
  const issues = C.findIssues({ builds: [landing] }, { now: NOW });
  assert.ok(issues.some((i) => i.build === 'h' && i.lander), 'stuck at build-complete: the lander is nudged, as for any build');
});

test('a build stopped at its budget is held on purpose: nothing is failed, retried or given up on', () => {
  const stop = { at: ago(30), kind: 'build', spentUsd: 55, capUsd: 50 };
  const b = building({ budgetStop: stop, statusAt: ago(900), steps: [{ id: 's7', status: 'failed', failedFrom: 'building', attempt: 1, statusAt: ago(30) }] });
  assert.deepEqual(C.findIssues({ builds: [b] }, { now: NOW }), []);
  assert.equal(C.findIssues({ builds: [{ ...b, budgetStop: undefined }] }, { now: NOW }).length > 0, true, 'released: watched again');
});
