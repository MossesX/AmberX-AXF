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

for (const [name, fn] of tests) { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } }
console.log(`shipped-features: ${n} checks passed`);
