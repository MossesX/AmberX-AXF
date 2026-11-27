/**
 * data-store-mode@1: local → shadow → cutover → rollback, per namespace, with guards, routes and the drift log. Run
 * through check-data-store.mjs (`--write` regenerates fixtures/data-store-mode.json).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../core/data-store.mjs';
import * as M from '../core/data-store-mode.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/data-store-mode.json');
const attempt = (fn) => { try { return fn(); } catch (e) { if (!(e instanceof D.DataStoreError)) throw e; return { error: e.code, message: e.message }; } };
const T0 = '2026-11-15T06:00:00.000Z';
const plus = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();

export async function checkMode({ WRITE = false } = {}) {
  let n = 0;
  const out = {};
  const m = { count: 3, bytes: 300, hash: 'a'.repeat(64) };
  const mOther = { count: 3, bytes: 300, hash: 'b'.repeat(64) };
  const same = { local: m, remote: m }, differ = { local: m, remote: mOther };

  // constants and routes
  out.transitions = M.TRANSITIONS;
  out.routes = M.ROUTES;
  assert.deepEqual(Object.keys(M.TRANSITIONS), M.EVENTS);
  for (const [, [from, to]] of Object.entries(M.TRANSITIONS)) assert.ok(M.MODES.includes(from) && M.MODES.includes(to));
  assert.deepEqual(M.MODES, D.MODES); n += 1;

  // a document from disk
  const s0 = M.initialState(T0, 'svc:cli');
  out.initial = s0;
  out.norm = { junk: attempt(() => M.normState({ $axf: 'other@1' }, T0)), loose: M.normState({ mode: 'weird', namespaces: { builds: { mode: 'shadow', since: 'yesterday', drift: -1 }, 'plugins/x': { mode: 'cutover', cursor: 7 } } }, T0) };
  out.normBareOpen = attempt(() => M.normState({ namespaces: { plugins: { mode: 'shadow' } } }, T0));
  assert.equal(out.normBareOpen.error, 'invalid_body');
  assert.equal(out.norm.loose.mode, 'local'); n += 1;
  out.normBadNs = attempt(() => M.normState({ namespaces: { nope: { mode: 'shadow' } } }, T0));
  assert.equal(out.normBadNs.error, 'invalid_key');

  // modeOf / plans
  const shadowed = { ...s0, namespaces: { builds: { mode: 'shadow', since: T0, cursor: 0, manifest: 'm1', drift: 0, lastDriftAt: '' } } };
  out.modeOf = { builds: M.modeOf(shadowed, 'builds'), notes: M.modeOf(shadowed, 'notes'), plugin: M.modeOf(shadowed, 'plugins/ui-review'), bare: attempt(() => M.modeOf(shadowed, 'plugins')) };
  out.plans = Object.fromEntries(M.MODES.map((mode) => { const st = { ...s0, namespaces: { notes: { mode, since: T0, cursor: 0, manifest: '', drift: 0, lastDriftAt: '' } } }; return [mode, { read: M.readPlan(st, 'notes'), write: M.writePlan(st, 'notes') }]; }));
  assert.equal(out.plans.rollback.write.refused, 'read_only');
  assert.equal(out.plans.cutover.write.targets[0], 'remote');
  assert.deepEqual(out.plans.shadow.write.required, ['local']); n += 1;

  // guards, step by step on one namespace
  const steps = [];
  const step = (name, fn) => { const v = attempt(fn); steps.push({ name, v }); return v; };
  let st = s0;
  step('cutoverFromLocal', () => M.canTransition(st, 'builds', 'cutover', { manifests: same }));
  step('shadowNoManifests', () => M.canTransition(st, 'builds', 'shadow', {}));
  step('shadowDiffer', () => M.canTransition(st, 'builds', 'shadow', { manifests: differ }));
  step('shadowRemoteDown', () => M.canTransition(st, 'builds', 'shadow', { manifests: same, remoteOk: false }));
  step('shadowUnknownMode', () => M.canTransition(st, 'builds', 'sideways', {}));
  step('shadowRefusedThrows', () => M.transition(st, { ns: 'builds', to: 'shadow', at: T0, ctx: { manifests: differ } }));
  st = step('startShadow', () => M.transition(st, { ns: 'builds', to: 'shadow', at: T0, by: 'svc:cli', manifest: 'm-1', ctx: { manifests: same } })).state;
  step('shadowAgain', () => M.canTransition(st, 'builds', 'shadow', { manifests: same }));
  step('cutoverTooSoon', () => M.canTransition(st, 'builds', 'cutover', { manifests: same, now: plus(10) }));
  step('cutoverNoClock', () => M.canTransition(st, 'builds', 'cutover', { manifests: same }));
  // drift during shadow
  const d1 = step('driftEtag', () => M.driftEntry('read', 'builds/store.json', { rev: 4, etag: '4-aaaaaaaaaaaaaaaa' }, { rev: 4, etag: '4-bbbbbbbbbbbbbbbb' }, plus(5)));
  step('driftNone', () => M.driftEntry('read', 'builds/store.json', { rev: 4, etag: '4-aaaaaaaaaaaaaaaa' }, { rev: 9, etag: '4-aaaaaaaaaaaaaaaa' }, plus(5)));
  step('driftMissingRemote', () => M.driftEntry('write', 'builds/shipped/a.json', { rev: 1, etag: '1-aaaaaaaaaaaaaaaa' }, null, plus(6)));
  step('driftMissingLocal', () => M.driftEntry('read', 'builds/shipped/b.json', null, { rev: 1, etag: '1-aaaaaaaaaaaaaaaa' }, plus(6)));
  step('driftWriteFailed', () => M.driftEntry('write', 'builds/store.json', { rev: 5, etag: '5-aaaaaaaaaaaaaaaa' }, { error: 'unavailable: volume' }, plus(7)));
  step('driftAppendFailed', () => M.driftEntry('append', 'builds/journal/2026-11', { entries: 10 }, { error: 'unavailable' }, plus(7)));
  step('driftEntries', () => M.driftEntry('append', 'builds/journal/2026-11', { entries: 10 }, { entries: 9 }, plus(7)));
  step('driftEntriesSame', () => M.driftEntry('append', 'builds/journal/2026-11', { entries: 10 }, { entries: 10 }, plus(7)));
  step('driftNoAt', () => M.driftEntry('read', 'builds/store.json', null, { rev: 1, etag: 'x' }));
  st = M.applyDrift(st, d1);
  step('applyDrift', () => st.namespaces.builds);
  step('applyDriftPlugin', () => M.applyDrift(s0, M.driftEntry('read', 'plugins/ui-review/items.json', null, { rev: 1, etag: '1-aaaaaaaaaaaaaaaa' }, plus(8))).namespaces);
  step('applyNull', () => M.applyDrift(st, null) === st);
  step('cutoverWithDrift', () => M.canTransition(st, 'builds', 'cutover', { manifests: same, now: plus(60) }));
  step('cutoverDriftAccepted', () => M.canTransition(st, 'builds', 'cutover', { manifests: same, now: plus(60), acceptDrift: ['1'] }));
  step('cutoverDriftAcceptedTooSoon', () => M.canTransition(st, 'builds', 'cutover', { manifests: same, now: plus(20), acceptDrift: ['1'] }));
  step('cutoverDriftAcceptedShortWindow', () => M.canTransition(st, 'builds', 'cutover', { manifests: same, now: plus(20), acceptDrift: ['1'], minDriftFreeMs: 60000 }));
  step('nextStepShadowWait', () => M.nextStep(st, 'builds', { manifests: same, now: plus(20) }));
  step('backToLocal', () => M.transition(st, { ns: 'builds', to: 'local', at: plus(21) }).state.namespaces.builds);
  st = step('cutOver', () => M.transition(st, { ns: 'builds', to: 'cutover', at: plus(60), by: 'svc:console/brett', cursor: 4821, manifest: 'm-2', ctx: { manifests: same, acceptDrift: ['1'] } })).state;
  step('cutoverWrite', () => M.writePlan(st, 'builds'));
  step('cutoverRead', () => M.readPlan(st, 'builds'));
  step('nextStepDone', () => M.nextStep(st, 'builds'));
  step('cutoverToLocal', () => M.canTransition(st, 'builds', 'local', {}));
  st = step('rollBack', () => M.transition(st, { ns: 'builds', to: 'rollback', at: plus(90), by: 'svc:cli' })).state;
  step('rollbackWrite', () => M.writePlan(st, 'builds'));
  step('finishNotReplayed', () => M.canTransition(st, 'builds', 'local', { manifests: same, replayed: false }));
  step('finishDiffer', () => M.canTransition(st, 'builds', 'local', { manifests: differ, replayed: true }));
  step('nextStepReplay', () => M.nextStep(st, 'builds', { manifests: same }));
  step('cancelRollback', () => M.transition(st, { ns: 'builds', to: 'cutover', at: plus(95) }).state.namespaces.builds);
  st = step('finishRollback', () => M.transition(st, { ns: 'builds', to: 'local', at: plus(100), ctx: { manifests: same, replayed: true } })).state;
  step('nextStepLocal', () => M.nextStep(st, 'builds', { manifests: same }));
  // the whole store at once, and per-namespace manifests
  step('allShadowNoManifest', () => M.transition(s0, { ns: '*', to: 'shadow', at: T0, ctx: { manifests: { builds: same } } }));
  const everyNs = Object.fromEntries(Object.keys(D.NAMESPACES).filter((k) => !D.NAMESPACES[k].internal && !D.NAMESPACES[k].open).map((k) => [k, same]));
  const all = step('allShadow', () => M.transition(s0, { ns: '*', to: 'shadow', at: T0, ctx: { manifests: everyNs } }));
  step('allShadowSummary', () => M.summary(all.state));
  step('listShadow', () => M.transition(s0, { ns: ['notes', 'plugins/ui-review'], to: 'shadow', at: T0, ctx: { manifests: same } }).changes);
  step('transitionNoAt', () => M.transition(s0, { ns: 'notes', to: 'shadow', ctx: { manifests: same } }));
  step('summary', () => M.summary(st));
  // key-level modes (Nov 18 2026): one record or prefix of a namespace moves ahead of the rest; verified by the caller under its lock
  const verified = { at: plus(5), how: 'builds-data cutover: record equal, journal compared line by line', counts: { builds: 3, steps: 9, notes: 2 } };
  const k1 = step('keyCutoverUnverified', () => M.transitionKey(s0, { ns: 'builds', path: 'store.json', to: 'cutover', at: plus(5) }));
  const k2 = step('keyCutover', () => M.transitionKey(s0, { ns: 'builds', path: 'store.json', to: 'cutover', at: plus(5), by: 'svc:cli', verified }));
  const k3 = step('keyPrefixCutover', () => M.transitionKey(k2.state, { ns: 'builds', path: 'journal/', to: 'cutover', at: plus(6), by: 'svc:cli', verified }));
  step('keyModes', () => ({ store: M.modeOf(k3.state, 'builds', 'store.json'), journal: M.modeOf(k3.state, 'builds', 'journal/2026-11'), journalLarge: M.modeOf(k3.state, 'builds', 'journal-large/1.json'), pipeline: M.modeOf(k3.state, 'builds', 'pipeline/state.json'), namespace: M.modeOf(k3.state, 'builds'), override: M.keyOverride(k3.state, 'builds', 'journal/2026-11-p3') }));
  step('keyBackToLocal', () => M.transitionKey(k3.state, { ns: 'builds', path: 'store.json', to: 'local', at: plus(7) }));
  step('keyNoWay', () => M.transitionKey(k3.state, { ns: 'builds', path: 'store.json', to: 'rollback', at: plus(7) }));
  step('keyBadPath', () => M.transitionKey(s0, { ns: 'builds', path: '../x', to: 'shadow', at: plus(7), verified }));
  step('keyNormRoundTrip', () => M.normState(JSON.parse(JSON.stringify(k3.state)), T0));
  step('keyOpenNs', () => M.transitionKey(s0, { ns: 'plugins/ui-review', path: 'items.json', to: 'shadow', at: plus(8), verified }).state.namespaces['plugins/ui-review']);
  out.steps = steps;
  assert.equal(k1.error, 'invalid_body');
  assert.equal(k3.state.namespaces.builds.mode, 'local');
  assert.equal(M.modeOf(k3.state, 'builds', 'store.json'), 'cutover');
  assert.equal(M.modeOf(k3.state, 'builds', 'pipeline/state.json'), 'local');
  assert.equal(M.modeOf(k3.state, 'builds'), 'local');
  assert.equal(steps.find((s) => s.name === 'keyBackToLocal').v.state.namespaces.builds.keys['store.json'], undefined);
  assert.deepEqual(steps.find((s) => s.name === 'keyNormRoundTrip').v, k3.state);
  assert.equal(steps.find((s) => s.name === 'cutoverFromLocal').v.ok, false);
  assert.equal(steps.find((s) => s.name === 'shadowRefusedThrows').v.error, 'invalid_body');
  assert.equal(steps.find((s) => s.name === 'cutoverWithDrift').v.ok, false);
  assert.equal(steps.find((s) => s.name === 'cutoverDriftAccepted').v.ok, true);
  assert.equal(steps.find((s) => s.name === 'cutoverDriftAcceptedShortWindow').v.ok, true);
  assert.equal(steps.find((s) => s.name === 'finishNotReplayed').v.ok, false);
  assert.equal(st.namespaces.builds.mode, 'local');
  assert.equal(st.namespaces.builds.drift, 0);
  assert.equal(all.changes.length, Object.keys(everyNs).length);
  n += 1;

  const fixture = { $axf: M.SCHEMA, note: 'Generated by framework/spec/check-data-store.mjs --write; every port answers the same transitions, guards, routes and drift entries.', ...out };
  if (WRITE) writeFileSync(FIX, `${JSON.stringify(fixture, null, 1)}\n`);
  else {
    assert.ok(existsSync(FIX), 'fixtures/data-store-mode.json missing (run --write)');
    assert.deepEqual(JSON.parse(readFileSync(FIX, 'utf8')), JSON.parse(JSON.stringify(fixture)), 'fixtures/data-store-mode.json drifted (run --write)');
  }
  n += 1;
  return n;
}
