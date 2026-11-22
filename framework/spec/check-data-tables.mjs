#!/usr/bin/env node
/**
 * check-data-tables — framework/cli/data-tables.mjs (DATA-INVENTORY s4.2 / s4.3 / s4.6) on an in-memory axf-data and a
 * temporary hub tree: per-set file → key mapping, the row each table should hold per document (the rules of
 * services/axf-data/tables.py), backfill writes only what differs, a second pass writes nothing, cutover refuses a set
 * whose writers still write files (flipBlocked), and the plan set keeps Plan Studio 2's tree on the files (pinLocal).
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDataStore, memoryBackend } from '../core/data-store.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'axf-data-tables-'));
const P = join(tmp, 'projects');
process.env.AXHUB_PROJECTS_DIR = P;
process.env.AXF_DATA_STORE_DIR = join(tmp, 'mode');
process.env.AXF_DATA_URL = 'off';
const put = (rel, v) => { const f = join(P, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof v === 'string' || Buffer.isBuffer(v) ? v : `${JSON.stringify(v, null, 1)}\n`); };

const { SETS, check, cutover } = await import('../cli/data-tables.mjs');
let n = 0;
const t = async (name, fn) => { await fn(); n += 1; console.log(`  ✓ ${name}`); };

try {
  put('amberx-axf/_data/framework/plan/plan.json', { $axf: 'plan@1', statuses: ['built', 'planned'], features: [{ id: 'f1' }, { id: 'f2' }] });
  put('amberx-axf/_data/framework/plan/profiles.json', { profiles: [{ id: 'all' }] });
  put('amberx-axf/_data/framework/plan/profiles/all/framework/plan/plan.json', { features: [{ id: 'f1' }] });
  put('amberx-axf/_data/framework/plan/media/a.jpg', Buffer.from([0xff, 0xd8, 0xff, 1, 2]));
  put('amberx-axf/_data/project.manifest.json', { $manifest: 'project-manifest@1', name: 'amberx-axf' });
  put('garden/_data/project.manifest.json', { $manifest: 'project-manifest@1', name: 'garden' });
  put('amberx-axf/_data/plan-studio/history/x.json', { versions: [{ v: 1 }, { v: 2 }, { v: 3 }] });
  put('amberx-axf/_data/plan-studio/categories.json', { paths: ['A', 'A/B'] });
  put('amberx-axf/_data/plan-studio/deleted.json', { ids: ['p0'] });
  put('amberx-axf/_data/plan-studio/plans/p1.json', { id: 'p1' });
  put('amberx-axf/_data/plan-studio/shipped-log.jsonl', '{"build":"b","ok":true}\n');
  put('amberx-axf/_data/plan-studio-2/tree.json', { items: [{ id: 'n1' }], trash: [] });
  put('amberx-axf/_data/framework/catalog/status.json', { 'f.a': { status: 'built', wave: 1 }, 'f.b': { status: 'planned', wave: 2 } });
  put('amberx-axf/_data/framework/catalog/libraries.json', { items: [{ id: 'l1' }] });
  put('amberx-axf/_data/framework/schemas/project-rules.json', { rules: [{ id: 'r1' }, { id: 'r2' }], knownKeys: ['name'] });
  put('amberx-axf/_data/sessions/archive/2026/11/cc-1.json', { id: 'cc-1', prompts: [{ i: 0 }, { i: 1 }] });
  put('amberx-axf/_data/changes/2026/11/chg-1.json', { id: 'chg-1' });
  put('amberx-axf/_data/plan-studio/.x.json.123.tmp', 'partial');

  const store = createDataStore({ backend: memoryBackend(), by: 'svc:cli' });
  const plainGet = store.backend.get.bind(store.backend);
  store.backend.get = async (ns, path, ...rest) => {   // _meta/tables: what tables.py would hold, computed from the store itself
    if (ns !== '_meta' || path !== 'tables') return plainGet(ns, path, ...rest);
    const rows = {};
    for (const set of Object.values(SETS)) for (const tn of Object.keys(set.tables)) rows[tn] = 0;
    for (const nsid of ['console', 'planner', 'sessions', 'changes']) {
      let after; for (;;) {
        const r = await store.list(nsid, { after, limit: 1000 });
        for (const it of r.items) { if (it.kind === 'journal') continue; const key = `${nsid}/${it.path}`; const d = it.kind === 'record' ? (await store.get(key)).data : {}; for (const set of Object.values(SETS)) for (const [tn, fn] of Object.entries(set.tables)) rows[tn] += fn(key, d); }
        if (!r.next) break; after = r.next;
      }
    }
    return { bytes: new TextEncoder().encode(JSON.stringify({ engine: 'postgres', tables: Object.entries(rows).map(([name, r]) => ({ name, rows: r })) })) };
  };

  await t('a set names its files, temp files skipped, every file maps to a key', async () => {
    const r = await check('plan', { store, projects: P });
    assert.equal(r.unmapped.length, 0, r.unmapped.join(', '));
    assert.equal(r.files, 12);
    assert.equal(r.missing.length, 11);   // everything but the journal, which is compared line by line
    assert.ok(!r.ok);
  });
  await t('backfill writes what differs; rows per table equal what the files give', async () => {
    const r = await check('plan', { store, projects: P, apply: true });
    assert.equal(r.written.length, 11);
    assert.deepEqual(r.journals.map((j) => [j.key, j.local, j.appended]), [['planner/shipped-log', 1, 1]]);
    const again = await check('plan', { store, projects: P });
    assert.ok(again.ok, again.problems.join('; '));
    assert.deepEqual(Object.fromEntries(Object.entries(again.tables).map(([k, v]) => [k, v.want])),
      { plan_items: 5, plan_profiles: 1, plan_projects: 0, projects: 2, plan_media: 1, planner_items: 1, planner_history: 3, planner_categories: 2, planner_lists: 1, planner_tree: 1 });
    const third = await check('plan', { store, projects: P, apply: true });
    assert.equal(third.written.length, 0);
  });
  await t('catalog: the map document counts one row per feature; tracker.json is not data', async () => {
    await check('catalog', { store, projects: P, apply: true });
    const r = await check('catalog', { store, projects: P });
    assert.ok(r.ok, r.problems.join('; '));
    assert.deepEqual(Object.fromEntries(Object.entries(r.tables).map(([k, v]) => [k, v.want])), { catalog_features: 2, catalog_libraries: 1, project_rules: 3 });
    assert.deepEqual(SETS.catalog.drop, ['console/tracker.json']);
  });
  await t('sessions: one row per session, one per prompt, one per change; the cut is refused while writers write files', async () => {
    const r = await cutover('sessions', { store, projects: P, apply: true });
    assert.deepEqual(Object.fromEntries(Object.entries(r.tables).map(([k, v]) => [k, v.want])), { sessions: 1, session_messages: 2, codebase_changes: 1 });
    assert.ok(!r.ok && r.problems.some((p) => p.startsWith('not flipped:')), r.problems.join('; '));
    assert.deepEqual(r.flipped, []);
  });
  await t('plan cut: Plan Studio 2 tree is held on the files (key override local)', async () => {
    const MODE = await import('../core/data-store-mode.mjs');
    const dm = await import('../cli/data-mode.mjs');
    let s = dm.readState();
    s = MODE.transition(s, { ns: 'planner', to: 'shadow', at: new Date().toISOString(), ctx: { manifests: { local: { count: 0, bytes: 0, hash: '' }, remote: { count: 0, bytes: 0, hash: '' } } } }).state;
    s.namespaces.planner.mode = 'cutover';   // the namespace cut itself is data-mode's (manifests, drift window): covered by check-data-store
    dm.writeState(s);
    const r = await cutover('plan', { store, projects: P, apply: true });
    assert.ok(r.ok, r.problems.join('; '));
    assert.ok(r.flipped.includes('planner/v2/: cutover → local'), r.flipped.join('; '));
    const after = dm.readState();
    assert.equal(MODE.modeOf(after, 'planner', 'v2/tree.json'), 'local');
    assert.equal(MODE.modeOf(after, 'planner', 'plans/p1.json'), 'cutover');
    assert.equal(MODE.modeOf(after, 'console', 'framework/plan/plan.json'), 'local');   // console keys only with --keys
  });
  console.log(`data-tables: ${n} checks ok`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
