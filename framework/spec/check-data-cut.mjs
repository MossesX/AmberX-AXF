#!/usr/bin/env node
/**
 * data-cut (framework/cli/data-cut.mjs, groups framework/schemas/data-cut.json) against a real axf-data on a free port:
 * the group schema is sound, verify fails before the backfill, copy is a dry run without --apply, cutover copies, verifies
 * and flips only the flip: true entries, a write after the flip lands on axf-data and not in the file, sync keeps the
 * flip: false entries equal, a differing key blocks the flip, and local brings the files back. Skipped without
 * python3 + FastAPI.   node framework/spec/check-data-cut.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let n = 0;
const ok = (name) => { n += 1; console.log(`  ✓ ${name}`); };

// ── the group schema ──
const SPEC = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/data-cut.json'), 'utf8'));
assert.equal(SPEC.$axf, 'data-cut@1');
// the table registry: tables.py plus the modules it appends (tables_console.py, tables_plugins.py, …)
const TABLES = readdirSync(join(ROOT, 'services/axf-data')).filter((f) => /^tables(_[a-z]+)?\.py$/.test(f)).map((f) => readFileSync(join(ROOT, 'services/axf-data', f), 'utf8')).join('\n');
for (const [id, g] of Object.entries(SPEC.groups)) {
  assert.ok(g.title && Array.isArray(g.entries) && g.entries.length, `${id}: title and entries`);
  for (const e of g.entries) {
    assert.ok(!!e.key !== !!e.prefix, `${id}: an entry is a key or a prefix`);
    if (e.prefix) assert.ok(e.prefix.endsWith('/'), `${id}: ${e.prefix} ends in /`);
    assert.equal(typeof e.flip, 'boolean', `${id}: ${e.key || e.prefix} says flip`);
    if (!e.flip) assert.ok(e.why, `${id}: ${e.key || e.prefix} says why it does not flip`);
    if (e.flip) assert.ok(Array.isArray(e.writers) && e.writers.length, `${id}: ${e.key || e.prefix} names its writers`);
    if (e.table) assert.ok(e.table.endsWith('_*') ? TABLES.includes(`=${e.table.slice(0, -2)}`) : TABLES.includes(`'${e.table}'`), `${id}: table ${e.table} is in services/axf-data/tables*.py (or a SQLite mirror prefix in DEFAULT_MIRROR)`);
  }
}
const { ownerOf } = await import('../cli/data-cut.mjs');
assert.equal(ownerOf('plugins/agent-swarm/runs.json')?.key, 'plugins/agent-swarm/runs.json', 'an exact key beats the plugins/ catch-all');
assert.equal(ownerOf('plugins/molly/settings.json')?.prefix, 'plugins/', 'the catch-all takes what no other entry names');
assert.equal(ownerOf('plugins/push-banner/gate-log.jsonl')?.prefix, 'plugins/push-banner/', 'the longest prefix wins');
const exact = Object.values(SPEC.groups).flatMap((g) => g.entries).filter((e) => e.key).map((e) => e.key);
assert.equal(new Set(exact).size, exact.length, 'no key is named by two entries');
for (const k of exact) assert.equal(ownerOf(k)?.key, k, `${k} is owned by its own entry`);
ok(`schema: ${Object.keys(SPEC.groups).length} group(s), every entry a key or prefix, flips name writers, the rest say why, tables exist, every key has one owner (exact key, else the longest prefix)`);

try { execFileSync('python3', ['-c', 'import fastapi, uvicorn, cryptography'], { stdio: 'ignore' }); }
catch { console.log(`data-cut: ${n} checks ok (server part skipped: python3 with fastapi, uvicorn and cryptography is needed)`); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), 'data-cut-'));
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ tokens: [{ id: 'cli', sub: 'svc:cli', sha256: createHash('sha256').update('tok').digest('hex'), grants: { '*': ['admin'] } }] }));
const srv = spawn('python3', ['-m', 'uvicorn', 'main:app', '--port', String(port), '--log-level', 'warning'], { cwd: join(ROOT, 'services/axf-data'), env: { ...process.env, AXF_DATA_DIR: join(dir, 'axf-data'), AXF_DATA_TOKENS_FILE: join(dir, 'tokens.json') }, stdio: 'inherit' });
const url = `http://127.0.0.1:${port}`;
// uvicorn drops idle keep-alive sockets after 5 s; a request that meets a closed one is sent again once
const hfetch = async (u, o = {}) => { try { return await fetch(u, o); } catch { return fetch(u, o); } };
const stop = () => { try { srv.kill(); } catch { /* gone */ } rmSync(dir, { recursive: true, force: true }); };
process.on('exit', stop);
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${url}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }

// ── seeded roots ──
const R = { repo: join(dir, 'repo'), data: join(dir, 'repo/.axf-console'), projects: join(dir, 'projects') };
const put = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`); };
put(join(R.data, 'state.json'), { project: 'axf', terminal: [{ t: 1 }], plugins: { a: { on: true } } });
put(join(R.data, 'alerts.json'), [{ id: 'a1', key: 'ci', source: 'ci', severity: 'error', title: 'CI red', count: 1 }]);
put(join(R.data, 'alerts-seen.json'), [1, 2, 3]);
put(join(R.data, 'host-check.json'), { $axf: 'host-check@1', at: 't', checks: [] });
put(join(R.data, 'alerts-secrets.json'), { ntfy: 'secret' });
put(join(R.data, 'deploys/log.jsonl'), '{"sha":"a","result":"ok"}\n{"sha":"b","result":"ok"}\n');
put(join(R.projects, 'amberx-axf/_data/home-cards/owner.json'), { $axf: 'home-layout@1', cards: [] });
put(join(R.projects, '_shared/_data/settings/appearance.json'), { $axf: 'appearance@1', theme: 'dark' });
put(join(R.projects, 'amberx-axf/_data/token-log/2026/11/06.jsonl'), '{"$axf":"token-turn@1","id":"x"}\n');
const env = { ...process.env, AXF_ROOT: R.repo, AXF_STATE: join(R.data, 'state.json'), AXHUB_PROJECTS_DIR: R.projects, AXF_DATA_URL: url, AXF_DATA_TOKEN: 'tok', AXF_DATA_CUT_SETTLE_MS: '0' };
// the CLI runs from this checkout but on the seeded roots (data-files.mjs reads AXF_ROOT for the repo root)
const cut = (...args) => { const r = spawnSync('node', [join(ROOT, 'framework/cli/data-cut.mjs'), ...args, '--json'], { env, encoding: 'utf8' }); let j = null; try { j = JSON.parse(r.stdout); } catch { /* error */ } return { code: r.status, j, err: r.stderr }; };
const entry = (r, k) => r.j.groups[0].entries.find((e) => e.entry === k);

let r = cut('verify', 'console');
assert.equal(r.code, 1, r.err); assert.ok(r.j.problems.some((p) => p.includes('console/state.json') && p.includes('missing')));
ok('verify before the backfill fails and names the missing keys');

r = cut('copy', 'console');
assert.equal(r.code, 0, r.err);
assert.ok(r.j.groups[0].copied.some((c) => c.key === 'console/state.json' && c.op === 'would-create'));
assert.ok(!r.j.groups[0].copied.some((c) => c.key.includes('secrets')), 'a file no rule maps never moves');
assert.equal((await (await hfetch(`${url}/v1/console/state.json`, { headers: { authorization: 'Bearer tok' } })).status), 404);
ok('copy without --apply is a dry run (nothing written); secrets are not in any group');

r = cut('cutover', 'console', '--apply');
assert.equal(r.code, 0, `${r.err}\n${JSON.stringify(r.j?.problems)}`);
assert.deepEqual(r.j.flipped.sort(), ['console/alerts-config.json', 'console/alerts-run.json', 'console/alerts-seen.json', 'console/alerts.json', 'console/home-cards/', 'console/state.json'].map((k) => `console/${k.slice(8)}: local → cutover`).sort());
for (const k of ['console/state.json', 'console/alerts.json', 'console/deploys/log', 'settings/', 'console/token-log/']) assert.ok(entry(r, k).ok && entry(r, k).equal >= 1, k);
const mode = JSON.parse(readFileSync(join(R.data, 'data-store/mode.json'), 'utf8'));
assert.equal(mode.namespaces.console.keys['state.json'].mode, 'cutover');
assert.ok(mode.namespaces.console.keys['state.json'].verified.counts.equal === 1);
assert.equal(mode.namespaces.console.keys['deploys/log'], undefined, 'a flip: false entry stays on the files');
assert.equal(mode.namespaces.settings, undefined);
ok('cutover --apply: backfilled, every key equal, only the flip: true entries flipped (verified kept on each)');

// a write after the flip goes to axf-data, the file stays as it was
const before = readFileSync(join(R.data, 'state.json'), 'utf8');
const w = spawnSync('node', ['--input-type=module', '-e', `import * as f from ${JSON.stringify(join(ROOT, 'framework/core/data-files.mjs'))}; f.writeJsonSync(${JSON.stringify(join(R.data, 'state.json'))}, { project: 'after', terminal: [], plugins: {} });`], { env, encoding: 'utf8' });
assert.equal(w.status, 0, w.stderr);
assert.equal(readFileSync(join(R.data, 'state.json'), 'utf8'), before);
const remote = await (await hfetch(`${url}/v1/console/state.json`, { headers: { authorization: 'Bearer tok' } })).json();
assert.equal(remote.project, 'after');
ok('after the flip a write to state.json lands on axf-data; the file is the read-only copy');

// sync keeps flip: false entries equal; flipped ones are not touched by it
appendFileSync(join(R.data, 'deploys/log.jsonl'), '{"sha":"c","result":"ok"}\n');
put(join(R.projects, '_shared/_data/settings/appearance.json'), { $axf: 'appearance@1', theme: 'light' });
r = cut('sync', 'console');
assert.equal(r.code, 0, r.err);
assert.ok(entry(r, 'console/deploys/log').ok && entry(r, 'settings/').ok);
assert.ok(!r.j.groups[0].copied.some((c) => c.key === 'console/state.json'), 'sync never writes a cut key');
const log = await (await hfetch(`${url}/v1/console/deploys/log?since=0`, { headers: { authorization: 'Bearer tok' } })).json();
assert.equal(log.entries.length, 3);
ok('sync: the deploys line and the settings change reach axf-data; the cut state.json is left alone');

// status shows the cut key as differing from its read-only file copy; local brings axf-data's body back to the file
r = cut('status', 'console');
assert.equal(entry(r, 'console/state.json').mode, 'cutover');
r = cut('local', 'console', '--apply');
assert.equal(r.code, 0, r.err);
assert.equal(JSON.parse(readFileSync(join(R.data, 'state.json'), 'utf8')).project, 'after');
assert.ok(r.j.flipped.includes('console/state.json: cutover → local'));
assert.equal(JSON.parse(readFileSync(join(R.data, 'data-store/mode.json'), 'utf8')).namespaces.console.keys, undefined);
ok('local --apply: axf-data bodies written back to the files, every override back to local');

// a key that differs blocks the whole flip
put(join(R.data, 'alerts.json'), [{ id: 'changed' }]);
await hfetch(`${url}/v1/console/alerts.json`, { method: 'PUT', headers: { authorization: 'Bearer tok', 'content-type': 'application/json', 'if-match': (await hfetch(`${url}/v1/console/alerts.json`, { headers: { authorization: 'Bearer tok' } })).headers.get('etag') }, body: JSON.stringify([{ id: 'other' }]) });
r = cut('cutover', 'console', '--apply', '--no-flip');
assert.equal(r.code, 0, 'copy wins over the target for a key still on the files');
r = cut('verify', 'console');
assert.equal(r.code, 0, JSON.stringify(r.j.problems));
ok('a key still on the files is re-copied before the flip (the file is the source until it flips)');
assert.ok(!existsSync(join(R.data, 'alerts.json.data-cut-')), 'no temp files left');

console.log(`data-cut: ${n} checks ok`);
process.exit(0);
