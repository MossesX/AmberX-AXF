// Self-test: node apps/console-web/plugins/build-orchestrator/test/pending-rows.test.mjs
import assert from 'node:assert/strict';
import * as pr from '../pending-rows.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const NOW = Date.parse('2026-11-15T12:00:00Z');
const base = { id: 'skins', title: 'Skins', status: 'pending', priority: 'P1', steps: { done: 2, total: 5, left: 3 }, needsApproval: false, needsSplit: false, pipeline: null, said: 'make it swap', createdAt: '2026-11-15T09:00:00Z',
  stepList: [{ id: 's1', text: 'a', model: 'Fable', estimate: '5 min', done: true, skip: false }, { id: 's2', text: 'b', model: 'Opus', estimate: '', done: false, skip: false }], actions: ['archive', 'delete'] };

t('summary: title, status label, why, priority, steps, age', () => {
  const s = pr.summarize(base, { now: NOW });
  assert.equal(s.title, 'Skins'); assert.equal(s.statusLabel, 'Pending'); assert.equal(s.why, 'waiting for Queue');
  assert.equal(s.priority, 'P1'); assert.deepEqual(s.steps, { done: 2, total: 5 }); assert.equal(s.age, '3 h');
  assert.equal(s.stepList.length, 2); assert.equal(s.stepList[0].model, 'Fable'); assert.deepEqual(s.actions, ['archive', 'delete']);
});
t('summary: title falls back to the id; priority to P2', () => { const s = pr.summarize({ id: 'x' }, { now: NOW }); assert.equal(s.title, 'x'); assert.equal(s.priority, 'P2'); assert.equal(s.age, ''); });
t('why pending: most pressing first', () => {
  assert.equal(pr.whyPending({ ...base, needsApproval: true, needsSplit: true }), 'needs your upgrade approval');
  assert.equal(pr.whyPending({ ...base, pipeline: { splitRequested: 'x' } }), 'splitting');
  assert.equal(pr.whyPending({ ...base, steps: { done: 0, total: 0 } }), 'no steps yet');
  assert.equal(pr.whyPending({ ...base, needsSplit: true }), 'needs a split');
  assert.equal(pr.whyPending({ ...base, pipeline: { lastRun: { outcome: 'stopped' } } }), 'back from a run (stopped)');
});
t('age labels', () => {
  assert.equal(pr.ageLabel('2026-11-15T11:59:40Z', NOW), 'just now'); assert.equal(pr.ageLabel('2026-11-15T11:48:00Z', NOW), '12 min');
  assert.equal(pr.ageLabel('2026-11-14T00:00:00Z', NOW), '36 h'); assert.equal(pr.ageLabel('2026-11-10T00:00:00Z', NOW), '5 d');
});
t('notes: last five only', () => { const s = pr.summarize(base, { notes: Array.from({ length: 8 }, (_, i) => ({ text: `n${i}`, at: '' })) }); assert.deepEqual(s.notes.map((x) => x.text), ['n3', 'n4', 'n5', 'n6', 'n7']); });

t('viewer key: lower case, safe, prefixed; empty = console', () => {
  assert.equal(pr.viewerKey('Brett'), 'viewer:brett'); assert.equal(pr.viewerKey('a b/c'), 'viewer:a-b-c'); assert.equal(pr.viewerKey(''), 'viewer:console');
});
t('expand / collapse / toggle / collapse all, never mutating', () => {
  const v0 = pr.emptyView();
  const v1 = pr.expand(v0, 'brett', 'skins', 'a');
  assert.deepEqual(pr.expandedFor(v0, 'brett'), []); assert.deepEqual(pr.expandedFor(v1, 'brett'), ['skins']);
  const v2 = pr.expand(v1, 'brett', 'skins', 'b'); assert.deepEqual(pr.expandedFor(v2, 'brett'), ['skins']);
  const v3 = pr.toggle(v2, 'brett', 'banner', 'c'); assert.deepEqual(pr.expandedFor(v3, 'brett'), ['skins', 'banner']);
  const v4 = pr.toggle(v3, 'brett', 'skins', 'd'); assert.deepEqual(pr.expandedFor(v4, 'brett'), ['banner']);
  const v5 = pr.collapse(v4, 'brett', 'banner', 'e'); assert.deepEqual(pr.expandedFor(v5, 'brett'), []);
  const v6 = pr.collapseAll(v3, 'brett', 'f'); assert.deepEqual(pr.expandedFor(v6, 'brett'), []); assert.deepEqual(pr.expandedFor(v3, 'brett'), ['skins', 'banner']);
});
t('per viewer: A expanded does not expand for B', () => {
  const v = pr.expand(pr.emptyView(), 'viewer-a', 'skins');
  assert.deepEqual(pr.expandedFor(v, 'viewer-a'), ['skins']); assert.deepEqual(pr.expandedFor(v, 'viewer-b'), []);
  const rows = pr.rowsFor([base], v, 'viewer-b', { now: NOW }); assert.equal(rows[0].expanded, false);
  assert.equal(pr.rowsFor([base], v, 'viewer-a', { now: NOW })[0].expanded, true);
});
t('bad ids refused', () => { assert.throws(() => pr.expand(pr.emptyView(), 'a', '../x'), /bad build id/); assert.throws(() => pr.toggle(pr.emptyView(), 'a', ''), /bad build id/); });
t('prune drops builds that left Pending', () => { const v = pr.expand(pr.expand(pr.emptyView(), 'a', 'x'), 'a', 'y'); assert.deepEqual(pr.expandedFor(pr.prune(v, 'a', ['y']), 'a'), ['y']); });
t('normView drops junk', () => {
  const v = pr.normView({ viewers: { 'viewer:a': { expanded: ['ok', '../bad', 7, 'ok'] }, nope: { expanded: ['x'] } } });
  assert.deepEqual(Object.keys(v.viewers), ['viewer:a']); assert.deepEqual(v.viewers['viewer:a'].expanded, ['ok']); assert.equal(v.$axf, pr.SCHEMA);
});
t('line reads as one plain line', () => { const l = pr.line({ ...pr.summarize(base, { now: NOW }), expanded: true }); assert.match(l, /^▾ Skins · Pending: waiting for Queue · P1 · 2\/5 steps · 3 h \[skins\]$/); });

console.log(`pending-rows: ${n} tests passed`);
