#!/usr/bin/env node
/** Shipped features: ledger store, build hooks, importers, edits. `node apps/console-web/plugins/shipped-features/test.mjs` */
import assert from 'node:assert/strict';
import * as D from './ledger/db.mjs';

let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('migrations: every numbered file applies once, version recorded', () => {
  const db = D.openDb(':memory:'); assert.equal(D.schemaVersion(db), D.SCHEMA_VERSION); assert.deepEqual(D.migrateDb(db).applied, []);
  for (const tb of ['features', 'feature_history', 'feature_builds', 'edits', 'prs', 'builds', 'prompts', 'deploys', 'events_seen']) assert.equal(typeof D.counts(db)[tb], 'number');
  D.closeDb(':memory:');
});
t('features merge, history keeps the original, edits move being-edited', () => {
  const db = D.openDb(':memory:');
  const f = D.putFeature(db, { name: 'Grid', plugin: 'shipped-features', status: 'planned', plannedAt: '2026-11-04T12:00:00Z', builds: [{ id: 'b1', profile: 'angel' }] });
  D.putFeature(db, { name: 'Grid', plugin: 'shipped-features', status: 'building', prs: [350] });
  assert.equal(D.getFeature(db, f.id).status, 'building'); assert.equal(D.getFeature(db, f.id).plannedAt, '2026-11-04T12:00:00Z');
  assert.equal(D.featureHistory(db, f.id)[0].doc.status, 'planned', 'the original version is kept');
  D.putEdit(db, { feature: f.id, summary: 'Add CSV', build: 'b2', status: 'building', at: '2026-11-05T00:00:00Z' });
  assert.equal(D.getFeature(db, f.id).beingEdited, true); assert.equal(D.getFeature(db, f.id).editCount, 1);
  D.putEdit(db, { feature: f.id, summary: 'Add CSV', build: 'b2', status: 'merged', at: '2026-11-05T00:00:00Z' });
  assert.equal(D.getFeature(db, f.id).beingEdited, false); assert.equal(D.listEdits(db, f.id).length, 1);
  D.putEdit(db, { feature: f.id, summary: 'Add CSV', build: 'b2', status: 'building', at: '2026-11-05T00:00:00Z' });
  assert.equal(D.listEdits(db, f.id)[0].status, 'merged', 'an edit status never goes back');
  D.closeDb(':memory:');
});
t('a verbatim prompt is never replaced by a paraphrase', () => {
  const db = D.openDb(':memory:');
  D.putPrompt(db, { build: 'b1', said: 'his words', verbatim: true }); D.putPrompt(db, { build: 'b1', said: 'paraphrase', verbatim: false });
  assert.equal(D.getPrompt(db, 'p-b1-0').said, 'his words'); D.closeDb(':memory:');
});

t('a created build plans its steps right away, with his words; statuses follow the build', async () => {
  const H = await import('../../../../framework/core/build-hook.mjs'); const { applyEvents } = await import('./ledger/apply.mjs');
  const db = D.openDb(':memory:');
  const origin = { said: 'Put every feature in a list the moment it is planned.', at: '2026-11-04T21:34:07Z', source: 'chat', verbatim: true };
  const s1 = { id: 's1', uid: 'u1', title: 'Status chips in the grid', files: ['apps/console-web/plugins/shipped-features/web/index.tsx'] };
  const s2 = { id: 's2', uid: 'u2', title: 'Tests and report' };
  const b = { id: 'sf-live', title: 'Shipped live', profiles: ['angel'], status: 'pending', rev: 1, steps: [s1, s2], origin, createdAt: '2026-11-04T21:35:00Z' };
  const ev = (c) => H.eventsFromChange(c, { at: '2026-11-04T21:35:00Z', by: 'test' });
  applyEvents(db, ev({ op: 'add', before: null, after: b }));
  const [f] = D.listFeatures(db); assert.equal(D.listFeatures(db).length, 1, 'housekeeping steps are not features'); assert.equal(f.status, 'planned'); assert.equal(f.plugin, 'shipped-features');
  assert.equal(D.getPrompt(db, f.prompts[0].id).said, origin.said);
  applyEvents(db, ev({ op: 'change', before: b, after: { ...b, rev: 2, status: 'running', steps: [{ ...s1, done: true }, s2] } })); assert.equal(D.getFeature(db, f.id).status, 'building');
  applyEvents(db, ev({ op: 'change', before: { ...b, status: 'running' }, after: { ...b, rev: 3, status: 'built', pr: '350' } })); assert.equal(D.getFeature(db, f.id).status, 'in-pr');
  applyEvents(db, ev({ op: 'change', before: { ...b, status: 'built', pr: '350' }, after: { ...b, rev: 4, status: 'complete', pr: '350', mergedAt: '2026-11-05T00:00:00Z' } }));
  assert.equal(D.getFeature(db, f.id).status, 'merged'); assert.equal(D.getFeature(db, f.id).mergedAt, '2026-11-05T00:00:00Z');
  const again = applyEvents(db, ev({ op: 'add', before: null, after: b })); assert.equal(again, 0, 'replays are ignored');
  // a later build touching the same feature is an edit, not a new feature
  const b2 = { id: 'sf-chips-fix', title: 'Chip colours', profiles: ['urgent'], status: 'pending', rev: 1, steps: [{ id: 's1', uid: 'v1', title: 'Status chips in the grid: warn tone for stalled', files: ['apps/console-web/plugins/shipped-features/web/index.tsx'] }], origin: { said: 'Stalled should look different.', verbatim: true } };
  applyEvents(db, ev({ op: 'add', before: null, after: b2 }));
  assert.equal(D.listFeatures(db).length, 1); const [e] = D.listEdits(db, f.id); assert.equal(e.status, 'planned'); assert.equal(e.build, 'sf-chips-fix'); assert.equal(D.getFeature(db, f.id).beingEdited, true);
  applyEvents(db, ev({ op: 'change', before: b2, after: { ...b2, rev: 2, deleted: true } })); assert.equal(D.listEdits(db, f.id)[0].status, 'cancelled', 'a cancelled build keeps its edit as Cancelled');
  assert.equal(D.getFeature(db, f.id).beingEdited, false);
  // a cancelled build keeps its planned features as Cancelled
  const b3 = { id: 'sf-gone', title: 'Repo checklist', profiles: ['angel'], status: 'pending', rev: 1, steps: [{ id: 's1', uid: 'w1', title: 'Repo checklist page in the console' }] };
  applyEvents(db, ev({ op: 'add', before: null, after: b3 })); applyEvents(db, ev({ op: 'change', before: b3, after: { ...b3, rev: 2, status: 'archived' } }));
  assert.equal(D.listFeatures(db).find((x) => x.name.startsWith('Repo checklist')).status, 'cancelled');
  D.closeDb(':memory:');
});

for (const [name, fn] of tests) { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } }
console.log(`shipped-features: ${n} checks passed`);
