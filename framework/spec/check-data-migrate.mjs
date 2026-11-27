#!/usr/bin/env node
/**
 * data-migrate on a seeded copy of real data, against a real axf-data (services/axf-data on a free port):
 * plan, migrate, verify, roll back from the backup, re-run idempotently, follow later source writes, and a forced
 * mismatch (target edited, journal diverged) must fail. Skipped with a note when python3 + FastAPI are missing.
 *   node framework/spec/check-data-migrate.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
try { execFileSync('python3', ['-c', 'import fastapi, uvicorn, cryptography'], { stdio: 'ignore' }); }
catch { console.log('data-migrate: skipped (python3 with fastapi, uvicorn and cryptography is needed)'); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'data-migrate-'));
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ tokens: [{ id: 'cli', sub: 'svc:cli', sha256: createHash('sha256').update('tok').digest('hex'), grants: { '*': ['admin'] } }] }));
const srv = spawn('python3', ['-m', 'uvicorn', 'main:app', '--port', String(port), '--log-level', 'warning'], { cwd: join(ROOT, 'services/axf-data'), env: { ...process.env, AXF_DATA_DIR: join(dir, 'axf-data'), AXF_DATA_TOKENS_FILE: join(dir, 'tokens.json') }, stdio: 'inherit' });
const url = `http://127.0.0.1:${port}`;
const stop = () => { try { srv.kill(); } catch { /* gone */ } };
process.on('exit', stop);
process.on('uncaughtException', (e) => { console.error(e); stop(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); stop(); process.exit(1); });
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${url}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }

// ── the seeded copy: real files from this checkout, laid out under the four roots ──
const R = { repo: join(dir, 'repo'), data: join(dir, 'repo/.axf-console'), plugins: join(dir, 'repo/.axf-console/plugins'), projects: join(dir, 'projects') };
const put = (f, text) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
const copy = (from, to) => { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); };
const B = join(ROOT, '_claude/builds');
copy(join(B, 'store.json'), join(R.repo, '_claude/builds/store.json'));
// the journal parts live on the hub (builds-journal@1), not in the repo: seed from the fixture journal
const JF = join(ROOT, 'framework/spec/fixtures-journal');
const journals = readdirSync(JF).filter((f) => f.endsWith('.jsonl')).sort((a, b) => statSync(join(JF, a)).size - statSync(join(JF, b)).size);
copy(join(JF, journals[0]), join(R.repo, '_claude/builds/journal', journals[0]));
for (const f of readdirSync(join(B, 'shipped')).sort().filter((f) => f.endsWith('.json')).slice(0, 25)) copy(join(B, 'shipped', f), join(R.repo, '_claude/builds/shipped', f));
for (const f of readdirSync(join(B, 'reports')).sort().filter((f) => statSync(join(B, 'reports', f)).isFile()).filter((f, i) => i < 8 || f.length > 80).slice(0, 12)) copy(join(B, 'reports', f), join(R.repo, '_claude/builds/reports', f));
put(join(R.projects, 'amberx-axf/_data/plan-studio/plans/p1.json'), JSON.stringify({ $axf: 'plan@1', id: 'p1', title: 'An archived plan' }));
put(join(R.projects, 'amberx-axf/_data/plan-studio/shipped-log.jsonl'), '{"at":"2026-11-01T00:00:00Z","plan":"p1"}\n{"plan":"p2","at":"2026-11-02T00:00:00Z"}\n');
copy(join(ROOT, 'apps/console-web/plugins/ui-review/kinds.json'), join(R.plugins, 'ui-review/kinds.json'));
put(join(R.plugins, 'ui-review', 'shots', 'i1', 'desktop.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
put(join(R.projects, '_shared/_claude/notes/handoffs/2026-11-14.md'), '# Handoff\n\nThe console goes down; the notes stay.\n');
put(join(R.projects, 'amberx-axf/_data/companion/broken.json'), '{ not json');            // console holds blobs: moves as a blob
put(join(R.projects, '_shared/_data/settings/apps/amberx-droid.json'), JSON.stringify({ theme: 'dark', n: 1.0 }, null, 2));
put(join(R.projects, '_shared/_data/claude/settings.json'), JSON.stringify({ $axf: 'claude-settings@1', values: { 'noWait.enabled': false } }));
put(join(R.projects, 'amberx-axf/_data/changes/2026/11/chg-20261115-abcdef12.json'), JSON.stringify({ id: 'chg-20261115-abcdef12', title: 'Data container' }));
put(join(R.projects, 'amberx-axf/_data/changes/README.md'), '# not migrated\n');
// a journal line over the 256 KiB entry limit: moves as a record with a pointer line
put(join(R.repo, '_claude/builds/journal/2026-12.jsonl'), `${JSON.stringify({ rev: 1, at: '2026-12-01T00:00:00Z', by: 't', action: 'big', blob: 'x'.repeat(300 * 1024) })}\n${JSON.stringify({ rev: 2, at: '2026-12-01T00:00:01Z', by: 't', action: 'small' })}\n`);
put(join(R.data, 'state.json'), JSON.stringify({ projects: ['amberx-axf'] }));
put(join(R.repo, '_claude/builds/store.json.lock'), 'pid');                              // skipped
// not data: a git checkout inside a plugin's data folder (agent-swarm job worktrees) and a package install
put(join(R.plugins, 'agent-swarm/job-worktrees/job-1/.git'), 'gitdir: /elsewhere\n');
put(join(R.plugins, 'agent-swarm/job-worktrees/job-1/package.json'), '{"name":"checkout"}');
put(join(R.plugins, 'agent-swarm/node_modules/x/package.json'), '{"name":"x"}');
put(join(R.plugins, 'agent-swarm/state.json'), '{"jobs":[]}');

Object.assign(process.env, { AXF_ROOT: R.repo, AXF_STATE: join(R.data, 'state.json'), AXHUB_PROJECTS_DIR: R.projects, AXF_DATA_URL: url, AXF_DATA_TOKEN: 'tok' });
delete process.env.AXF_PLUGINS_DATA_DIR;
const M = await import('../cli/data-migrate.mjs');
const D = await import('../core/data-store.mjs');
const store = D.createDataStore({ backend: D.httpBackend({ url, token: 'tok' }), by: 'svc:cli' });
const hashTree = (root) => { const out = {}; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) { if (e.name !== 'migration' && e.name !== 'data-store') walk(f); } else out[f.slice(root.length)] = createHash('sha256').update(readFileSync(f)).digest('hex'); } }; walk(root); return out; };

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); srv.kill(); throw e; } };
try {
  const before = { repo: hashTree(R.repo), projects: hashTree(R.projects) };
  let planned;
  await t('checkouts and package installs inside data folders are not walked', async () => {
    const files = M.scan().mapped.concat().map((m) => m.rel);
    assert.ok(files.includes('agent-swarm/state.json'), 'the plugin data next to them still moves');
    assert.ok(!files.some((f) => f.includes('job-worktrees') || f.includes('node_modules')), 'no checkout or node_modules file is mapped');
  });
  await t('plan (the default) is a dry run: counts per namespace, nothing written', async () => {
    planned = await M.run({ cmd: 'plan' });
    assert.equal(planned.dryRun, true);
    const ns = Object.fromEntries(planned.namespaces.map((x) => [x.ns, x]));
    for (const k of ['builds', 'planner', 'ui-review', 'notes', 'settings', 'changes', 'console']) assert.ok(ns[k], `plan has ${k}`);
    assert.equal(ns.changes.count, 1, 'the README in the changes folder stays out');
    assert.deepEqual(ns.console.asBlob, ['console/companion/broken.json']);
    assert.deepEqual(ns.notes.kinds, { blob: 1 });
    assert.ok(ns.builds.large.includes('builds/store.json'));
    assert.ok(ns.builds.notes.some((x) => x.includes('large entry moved as records')));
    assert.equal(planned.ok, true);
    assert.equal((await store.list('builds')).items.length, 0, 'nothing on axf-data');
    assert.ok(!existsSync(join(R.data, 'migration')), 'no report written by a dry run');
  });
  let first;
  await t('apply: backup first, copy, verify (every namespace equal)', async () => {
    first = await M.run({ cmd: 'apply', store });
    assert.equal(first.ok, true, JSON.stringify(first.namespaces.filter((x) => !x.ok)));
    for (const x of first.namespaces) { assert.ok(x.backup && existsSync(x.backup), `${x.ns}: backup tar`); assert.equal(x.count, x.m1); }
    const rep = JSON.parse(readFileSync(join(R.data, 'migration/builds.json'), 'utf8'));
    assert.equal(rep.equal, true); assert.deepEqual(rep.m0, rep.m1);
    assert.ok((await store.get('builds/store.json')).data.builds.length > 0);
    const big = (await store.read(`builds/journal/2026-12`)).entries[0].entry;
    assert.ok(big.large && (await store.get(big.large)).data.blob.length === 300 * 1024, 'the large entry is a record behind its pointer');
    const long = (await store.list('builds', { prefix: 'reports/' })).items.find((i) => i.path.length > 70);
    assert.ok(!long || long.path.split('/').pop().length <= 80);
  });
  await t('the source is untouched by the migration', async () => {
    assert.deepEqual(hashTree(R.repo), before.repo); assert.deepEqual(hashTree(R.projects), before.projects);
  });
  await t('verify on its own agrees', async () => { assert.equal((await M.run({ cmd: 'verify', store })).ok, true); });
  await t('re-run is idempotent: everything "same", nothing re-written', async () => {
    const cursor = (await store.health()).cursor;
    const again = await M.run({ cmd: 'apply', store });
    assert.equal(again.ok, true);
    for (const x of again.namespaces) assert.deepEqual(Object.keys(x.copy), ['same'], `${x.ns}: ${JSON.stringify(x.copy)}`);
    const snaps = again.namespaces.length; // each apply takes one snapshot (a _meta write, no data change)
    assert.equal((await store.health()).cursor, cursor + snaps);
  });
  await t('later source writes follow on a re-run (updated record, appended journal lines)', async () => {
    put(join(R.projects, '_shared/_data/settings/apps/amberx-droid.json'), JSON.stringify({ theme: 'light' }));
    appendFileSync(join(R.projects, 'amberx-axf/_data/plan-studio/shipped-log.jsonl'), '{"plan":"p3"}\n');
    const r = await M.run({ cmd: 'apply', only: ['settings', 'planner'], store });
    assert.equal(r.ok, true);
    assert.equal(r.namespaces.find((x) => x.ns === 'settings').copy.updated, 1);
    assert.equal(r.namespaces.find((x) => x.ns === 'planner').copy.appended, 1);
    assert.equal((await store.read('planner/shipped-log')).entries.length, 3);
  });
  await t('roll back: the backup tar restores the source byte for byte', async () => {
    const tar = first.namespaces.find((x) => x.ns === 'settings').backup;
    const out = mkdtempSync(join(tmpdir(), 'data-migrate-restore-'));
    execFileSync('tar', ['-xzf', tar, '-C', out], { stdio: 'ignore' });
    const f = join(out, R.projects.replace(/^\//, ''), '_shared/_data/settings/apps/amberx-droid.json');
    assert.equal(createHash('sha256').update(readFileSync(f)).digest('hex'), before.projects['/_shared/_data/settings/apps/amberx-droid.json']);
    rmSync(out, { recursive: true, force: true });
  });
  await t('forced mismatch: a key edited on axf-data fails verify (and apply) with the key named', async () => {
    const cur = await store.get('builds/origins.json') || await store.get('builds/store.json');
    await store.put(`builds/${cur.path}`, { tampered: true }, { ifMatch: cur.etag });
    const v = await M.run({ cmd: 'verify', only: ['builds'], store });
    assert.equal(v.ok, false);
    assert.ok(v.namespaces[0].mismatches.some((m) => m.key === `builds/${cur.path}` && m.why === 'content differs'));
    // apply repairs a record (the source wins while the namespace is local)…
    assert.equal((await M.run({ cmd: 'apply', only: ['builds'], store })).ok, true);
  });
  await t('forced mismatch: a journal that diverged on axf-data is never truncated: apply refuses', async () => {
    await store.append('planner/shipped-log', [{ plan: 'only-on-axf-data' }]);
    const r = await M.run({ cmd: 'apply', only: ['planner'], store });
    assert.equal(r.ok, false);
    const p = r.namespaces[0];
    assert.ok(p.refused && p.mismatches.some((m) => m.key === 'planner/shipped-log'));
    assert.equal((await store.read('planner/shipped-log')).entries.length, 4, 'nothing removed');
    const rep = JSON.parse(readFileSync(join(R.data, 'migration/planner.json'), 'utf8'));
    assert.equal(rep.ok, false); assert.ok(rep.refused);
  });
  await t('CLI: dry run by default, exit 1 on a mismatch', async () => {
    const env = { ...process.env };
    const dry = execFileSync(process.execPath, [join(ROOT, 'framework/cli/data-migrate.mjs')], { env, encoding: 'utf8' });
    assert.match(dry, /Dry run \(nothing written\)/);
    let code = 0; try { execFileSync(process.execPath, [join(ROOT, 'framework/cli/data-migrate.mjs'), 'verify', 'planner'], { env, stdio: 'ignore' }); } catch (e) { code = e.status; }
    assert.equal(code, 1);
    let code2 = 0; try { execFileSync(process.execPath, [join(ROOT, 'framework/cli/data-migrate.mjs'), 'apply'], { env, stdio: 'ignore' }); } catch (e) { code2 = e.status; }
    assert.equal(code2, 2, 'apply without namespaces refuses');
  });
  // ── data-mode: shadow → cutover (guarded) → rollback (replay) → local, on the settings namespace ──
  const DM = await import('../cli/data-mode.mjs');
  const F = await import('../core/data-files.mjs');
  F.setRemote(store);
  const settingsFile = join(R.projects, '_shared/_data/settings/apps/amberx-droid.json');
  await t('data-mode: shadow needs equal manifests; status shows it', async () => {
    const r = await DM.run({ cmd: 'shadow', only: ['settings'], store });
    assert.equal(r.ok, true, JSON.stringify(r.results));
    assert.equal(DM.readState().namespaces.settings.mode, 'shadow');
    assert.equal((await store.get('_meta/mode')).data.namespaces.settings.mode, 'shadow', 'the mode document is on axf-data');
    const st = await DM.run({ cmd: 'status', only: ['settings'], store });
    assert.equal(st.namespaces[0].mode, 'shadow'); assert.equal(st.remote.ok, true);
    const bad = await DM.run({ cmd: 'shadow', only: ['planner'], store });
    assert.equal(bad.ok, false, 'planner diverged above: shadow refused'); assert.match(bad.results[0].reason, /manifests differ/);
  });
  await t('data-mode: cutover refused until shadow has been quiet for the window, and with drift until it is accepted', async () => {
    const early = await DM.run({ cmd: 'cutover', only: ['settings'], store });
    assert.equal(early.ok, false); assert.match(early.results[0].reason, /quiet for 0 min, needs 30/);
    F.logDrift('write', 'settings/apps/amberx-droid.json', 'write-failed', null, null, 'test: axf-data was down');
    const drift = await DM.run({ cmd: 'cutover', only: ['settings'], store, windowMin: 0 });
    assert.equal(drift.ok, false); assert.match(drift.results[0].reason, /1 drift entry/);
    assert.equal((await store.read('_meta/drift/settings')).entries.length, 1, 'the drift log is on axf-data');
    const ok = await DM.run({ cmd: 'cutover', only: ['settings'], store, windowMin: 0, acceptDrift: true });
    assert.equal(ok.ok, true, JSON.stringify(ok.results));
    assert.equal(DM.readState().namespaces.settings.mode, 'cutover');
    assert.ok(DM.readState().namespaces.settings.cursor > 0);
  });
  await t('cutover: writes go to axf-data, the local file stays the backup', async () => {
    const before = readFileSync(settingsFile, 'utf8');
    await F.writeJson(settingsFile, { theme: 'cut-over' });
    assert.equal(readFileSync(settingsFile, 'utf8'), before);
    assert.deepEqual((await store.get('settings/apps/amberx-droid.json')).data, { theme: 'cut-over' });
    await F.writeJson(join(R.projects, '_shared/_data/settings/looks/new.json'), { made: 'after the cut' });
  });
  await t('rollback: replay the feed since the cut onto local, manifests equal, back to local', async () => {
    const r = await DM.run({ cmd: 'rollback', only: ['settings'], store });
    assert.equal(r.ok, true, JSON.stringify(r.results));
    assert.equal(r.results[0].replay.written, 2);
    assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), { theme: 'cut-over' });
    assert.deepEqual(JSON.parse(readFileSync(join(R.projects, '_shared/_data/settings/looks/new.json'), 'utf8')), { made: 'after the cut' });
    assert.equal(DM.readState().namespaces.settings.mode, 'local');
    const log = (await store.read('_meta/mode-log')).entries.map((e) => `${e.entry.ns}:${e.entry.from}>${e.entry.to}`);
    assert.deepEqual(log, ['settings:local>shadow', 'settings:shadow>cutover', 'settings:cutover>rollback', 'settings:rollback>local']);
  });
  await t('data-mode: local → cutover directly is refused (shadow first)', async () => {
    const r = await DM.run({ cmd: 'cutover', only: ['changes'], store, windowMin: 0 });
    assert.equal(r.ok, false); assert.match(r.results[0].reason, /shadow first/);
  });
} finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
console.log(`data-migrate: ${n} checks ok`);
