// Self-test: node apps/console-web/plugins/feature-matrix/test.mjs
// The plugin's helpers and CLI on scratch copies (the repo's matrices file and tracker are never written).
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fm from './web/fm-core.mjs';
import * as dr from './web/draft.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const repo = new URL('../../../../', import.meta.url).pathname;
const read = (rel) => JSON.parse(readFileSync(join(repo, rel), 'utf8'));
const NOW = '2026-10-29T12:00:00.000Z';

// ---- manifest + web entry
const man = read('apps/console-web/plugins/feature-matrix/plugin.json');
t('plugin@1 manifest: id, data folder, model, no other plugin named', () => {
  assert.equal(man.id, 'ai.amberx.axf.console.feature-matrix'); assert.equal(man.lifecycle.dataDir, '.axf-console/plugins/feature-matrix');
  assert.equal(man.builtWith.model, 'opus'); assert.ok(man.builtWith.builtAt);
  const web = readFileSync(join(repo, 'apps/console-web/plugins/feature-matrix/web/index.tsx'), 'utf8');
  assert.match(web, /parent: 'plugins'/); assert.match(web, /PluginLifecyclePanel/); assert.match(web, /registerRowHook/);
  for (const other of ['build-orchestrator', 'build-manager', 'codebase-changes', 'changes-grid']) assert.doesNotMatch(web, new RegExp(`plugins/${other}`));
  const menu = readFileSync(join(repo, 'apps/console-web/plugins/feature-matrix/web/menu.ts'), 'utf8'); assert.match(menu, /menu: 'builds'/); assert.match(menu, /nav:feature-matrix/);
});
t('server part has no delete route', () => { const py = readFileSync(join(repo, 'apps/console-web/plugins/feature-matrix/server/__init__.py'), 'utf8'); assert.doesNotMatch(py, /@router\.delete/); assert.match(py, /never deleted/); });

// ---- the draft (feature-matrix@0) → feature-matrix@1 (s66: the first matrix of the dataset)
const draftRel = '_claude/builds/profiles/refactor/matrices.json';
const orchRel = '_claude/builds/profiles/refactor/orchestrator.json';
const draft = existsSync(join(repo, draftRel)) ? read(draftRel) : null;
const orch = read(orchRel);
if (draft && draft.$axf !== fm.SCHEMA) {
  const st = dr.fromDraft(draft, orch.builds, NOW);
  const m = st.matrices[0];
  t('draft converts to one valid feature-matrix@1 matrix', () => { assert.deepEqual(fm.validate(st), []); assert.equal(m.id, 'refactor:orchestrator:refactor-all'); assert.equal(m.items.length, draft.matrices[0].items.length); });
  t('keep flags become keep / skip; nothing dropped', () => { assert.equal(m.items.filter(fm.isKept).length, draft.matrices[0].items.filter((i) => i.keep !== false).length); });
  t('done items keep a done history line', () => { const done = draft.matrices[0].items.filter((i) => i.done).length; assert.equal(m.items.filter((it) => it.history.some((h) => h.action === 'done')).length, done); });
  t('items are tied to the build step carrying their [source step] tag', () => {
    const steps = new Set(orch.builds.find((b) => b.id === 'refactor-all').steps.map((s) => s.id));
    const tied = m.items.filter((it) => it.source.kind === 'step'); assert.ok(tied.length > 0);
    for (const it of tied) assert.ok(steps.has(it.source.id), it.id);
    for (const it of m.items.filter((x) => x.source.kind === 'manual')) assert.equal(it.state, 'skip', `${it.id}: an untied item is skipped, so Apply adds no step for it`);
  });
}

// ---- seeding + targets from synthetic tables
const tables = {
  builds: [{ id: 'b1', title: 'Build one', status: 'running', pendingId: 'p1', steps: [{ id: 's1', text: 'design', model: 'Fable', estimate: '20 min', group: 'G' }, { id: 's2', text: 'wire', model: 'Opus', estimate: '30 min', skip: true }] }, { id: 'old', status: 'complete', steps: [] }],
  pending: [{ id: 'p1', title: 'Pending one', model: 'Opus', subPrompts: [{ text: 'design', estimate: '20 min' }] }, { id: 'p2', title: 'Only pending', model: 'Fable', subPrompts: [{ text: 'a', estimate: '10 min' }, { text: 'b', estimate: '15 min', skip: true }] }],
  features: [{ id: 'x.epic', kind: 'epic', title: 'Epic', model: 'opus', acceptance: [{ text: 'works', done: false }] }],
  queue: { steps: { 'x.epic': { steps: [{ text: 'step a', estimate: '25 min' }] } } },
  change: { id: 'chg-20261029-abcdef12', title: 'A change', model: 'Opus', steps: [{ text: 'one', state: 'done' }, { text: 'two', state: 'skipped' }] },
};
t('seed items for every kind come from what the build has', () => {
  assert.deepEqual(dr.seedItems({ kind: 'orchestrator', id: 'b1' }, tables, NOW).map((i) => [i.id, i.state, i.minutes]), [['s1', 'keep', 20], ['s2', 'skip', 30]]);
  assert.equal(dr.seedItems({ kind: 'pending', id: 'p1' }, tables, NOW)[0].source.kind, 'step', 'a pending item with an orchestrator build seeds from its steps');
  assert.deepEqual(dr.seedItems({ kind: 'pending', id: 'p2' }, tables, NOW).map((i) => i.state), ['keep', 'skip']);
  assert.equal(dr.seedItems({ kind: 'queue', id: 'x.epic' }, tables, NOW)[0].minutes, 25);
  assert.equal(dr.seedItems({ kind: 'plan', id: 'x.epic' }, tables, NOW)[0].source.kind, 'acceptance');
  assert.deepEqual(dr.seedItems({ kind: 'change', id: tables.change.id }, tables, NOW).map((i) => i.state), ['keep', 'skip']);
});
t('targets: the build, its pending item, queue record, plan feature, change entry', () => {
  assert.deepEqual(Object.keys(dr.targetsFor({ kind: 'orchestrator', id: 'b1' }, tables)).sort(), ['build', 'pending']);
  assert.deepEqual(Object.keys(dr.targetsFor({ kind: 'pending', id: 'p1' }, tables)).sort(), ['build', 'pending']);
  assert.deepEqual(Object.keys(dr.targetsFor({ kind: 'queue', id: 'x.epic' }, tables)), ['queue']);
  assert.deepEqual(Object.keys(dr.targetsFor({ kind: 'plan', id: 'x.epic' }, tables)), ['feature']);
  assert.deepEqual(Object.keys(dr.targetsFor({ kind: 'change', id: 'x' }, tables)), ['change']);
  assert.deepEqual(dr.openBuilds(tables.builds).map((b) => b.id), ['b1']);
  assert.equal(dr.titleFor({ kind: 'orchestrator', id: 'b1' }, tables), 'Build one');
});

// ---- CLI on scratch files (AXF_FM_DIR, AXF_ORCH_FILE, AXF_DATA_DIR)
const dir = mkdtempSync(join(tmpdir(), 'fm-'));
process.env.AXF_FM_DIR = dir; process.env.AXF_ORCH_FILE = join(dir, 'orch.json'); process.env.AXF_DATA_DIR = join(dir, 'data'); process.env.AXF_BUILD_PROFILE = 'refactor';
copyFileSync(join(repo, orchRel), process.env.AXF_ORCH_FILE);
if (draft) copyFileSync(join(repo, draftRel), join(dir, 'refactor.json'));
const cli = await import('./matrix.mjs');
const repoMatrices = existsSync(join(repo, draftRel)) ? readFileSync(join(repo, draftRel), 'utf8') : null;
const repoTracker = readFileSync(join(repo, orchRel), 'utf8');
const first = cli.importAll('refactor');
const id = 'refactor:orchestrator:refactor-all';
t('import: the draft becomes feature-matrix@1 on disk, one matrix per open build', () => {
  const f = JSON.parse(readFileSync(join(dir, 'refactor.json'), 'utf8')); assert.equal(f.$axf, fm.SCHEMA); assert.ok(fm.findMatrix(fm.normalizeState(f), id));
  assert.ok(first.log.length >= 1); assert.ok(existsSync(join(dir, 'mirror', 'refactor.json')), 'mirrored to the plugin data folder');
});
t('import is idempotent', () => { const before = readFileSync(join(dir, 'refactor.json'), 'utf8'); const v = fm.findMatrix(fm.normalizeState(JSON.parse(before)), id).version; cli.importAll('refactor'); assert.equal(fm.findMatrix(cli.loadProfile('refactor'), id).version, v); });
const v0 = fm.findMatrix(cli.loadProfile('refactor'), id).version;
cli.act({ action: 'add-item', matrix: id, item: { name: 'Feature matrix self-test item', group: 'feature-matrix', minutes: 5, model: 'Opus' } });
t('add-item bumps the version and lights Apply', () => { const m = fm.findMatrix(cli.loadProfile('refactor'), id); assert.equal(m.version, v0 + 1); assert.equal(fm.isDirty(m), true); });
t('remove-item and remove are refused', () => { assert.throws(() => cli.act({ action: 'remove-item', matrix: id, item: 'feature-matrix-self-test-item' }), /never deleted/); assert.throws(() => cli.act({ action: 'remove', matrix: id }), /never deleted/); });
cli.act({ action: 'skip', matrix: id, item: 'feature-matrix-self-test-item' });
const r1 = cli.applyMatrix({ matrix: id }, NOW);
t('apply writes the tracker, records the version, saves a report', () => {
  const m = fm.findMatrix(cli.loadProfile('refactor'), id); assert.equal(m.appliedVersion, m.version); assert.equal(fm.isDirty(m), false);
  assert.ok(r1.report.targets.includes('build')); assert.ok(cli.reports().length >= 1);
  const tr = JSON.parse(readFileSync(process.env.AXF_ORCH_FILE, 'utf8')).builds.find((b) => b.id === 'refactor-all');
  assert.ok(!tr.steps.some((s) => s.id === 'fm-feature-matrix-self-test-item'), 'a skipped item that never had a step gets none');
});
t('a second apply changes nothing', () => { const r2 = cli.applyMatrix({ matrix: id }, NOW); assert.equal(r2.report.changes.length, 0); });
t('seed a pending-item matrix (only adds)', () => { const r = cli.seed({ ref: { kind: 'pending', id: 'refactor-all' }, profile: 'refactor' }); assert.equal(r.matrix.id, 'refactor:pending:refactor-all'); const again = cli.seed({ ref: { kind: 'pending', id: 'refactor-all' }, profile: 'refactor' }); assert.equal(again.matrix.version, r.matrix.version); });
t('one dataset over every profile', () => { const { state } = cli.loadAll(); assert.ok(state.matrices.some((m) => m.id === id)); assert.deepEqual(fm.validate(state), []); assert.ok(fm.grid(state).length >= 2); });
t('the repo files were never written', () => { if (repoMatrices != null) assert.equal(readFileSync(join(repo, draftRel), 'utf8'), repoMatrices); assert.equal(readFileSync(join(repo, orchRel), 'utf8'), repoTracker); });
writeFileSync(join(dir, 'done'), 'ok');
console.log(`feature-matrix: ${n} checks passed`);
