#!/usr/bin/env node
/**
 * build-rules on data-store@1: with the store's namespace served from axf-data, the rules are rows and one change writes
 * the rows it touched (data-patch@1), with its history line in the same call; no store file, history file or lock file
 * is written. Runs against a real axf-data (services/axf-data started on a free port).
 *
 * Skipped with a note when Python or FastAPI is missing, or when this checkout has no table for the build rules store
 * (services/axf-data/tables.py) or no path rule for its folder (framework/schemas/data-store-paths.json).
 *   node framework/spec/check-build-rules-data.mjs
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const skip = (why) => { console.log(`build-rules on data-store: skipped (${why})`); process.exit(0); };
try { execFileSync('python3', ['-c', 'import fastapi, uvicorn, cryptography'], { stdio: 'ignore' }); }
catch { skip('python3 with fastapi, uvicorn and cryptography is needed'); }
if (!/'build-rules',\s*'store\.json'/.test(readFileSync(join(ROOT, 'services/axf-data/tables.py'), 'utf8'))) skip('services/axf-data has no table for the build rules store in this checkout');

const dir = mkdtempSync(join(tmpdir(), 'build-rules-data-'));
const rulesDir = join(dir, 'projects/amberx-axf/_data/build-rules');
Object.assign(process.env, { AXF_ROOT: join(dir, 'repo'), AXF_STATE: join(dir, '.axf-console/state.json'), AXHUB_PROJECTS_DIR: join(dir, 'projects') });
const files = await import('../core/data-files.mjs');
const B = await import('../core/build-rules.mjs');
const f = B.storeFiles(rulesDir);
if (files.keyFor(f.store) !== 'console/build-rules/store.json') { rmSync(dir, { recursive: true, force: true }); skip('no path rule maps the build rules folder in this checkout'); }

const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
writeFileSync(join(dir, 'tokens.json'), JSON.stringify({ tokens: [{ id: 'o', sub: 'svc:orchestrator', sha256: createHash('sha256').update('tok').digest('hex'), grants: { '*': ['admin'] } }] }));
const srv = spawn('python3', ['-m', 'uvicorn', 'main:app', '--port', String(port), '--log-level', 'warning'], { cwd: join(ROOT, 'services/axf-data'), env: { ...process.env, AXF_DATA_DIR: join(dir, 'axf-data'), AXF_DATA_TOKENS_FILE: join(dir, 'tokens.json') }, stdio: 'inherit' });
const url = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${url}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
Object.assign(process.env, { AXF_DATA_URL: url, AXF_DATA_TOKEN: 'tok' });
mkdirSync(join(dir, '.axf-console/data-store'), { recursive: true });
writeFileSync(join(dir, '.axf-console/data-store/mode.json'), JSON.stringify({ $axf: 'data-store-mode@1', mode: 'local', namespaces: { console: { mode: 'cutover' } } }));
const H = { authorization: 'Bearer tok', connection: 'close' };
// uvicorn closes idle keep-alive sockets after 5 s: a fetch that lands on one answers "other side closed", so ask again once
const remote = async (key) => { let r; try { r = await fetch(`${url}/v1/${key}`, { headers: H }); } catch { r = await fetch(`${url}/v1/${key}`, { headers: H }); } return r.status === 200 ? r.json() : null; };

const AT = '2026-11-15T14:00:00Z';
const rule = (id, extra = {}) => ({ id, title: `Rule ${id}`, text: `Do ${id}.`, doer: 'session', kind: 'judgement', phase: 'dispatch', enabled: true, ...extra });
const seed = join(dir, 'seed.json');
writeFileSync(seed, JSON.stringify(B.seedStore([rule('alpha'), rule('beta'), rule('gamma')], { at: AT }).store));
const noFiles = () => { for (const p of [f.store, f.history, f.lock]) assert.ok(!existsSync(p), `${p} must not exist`); };

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); srv.kill(); throw e; } };
try {
  await t('the first write puts the seeded store on axf-data with the seed line and its own; no file is written', async () => {
    assert.equal(B.load({ dir: rulesDir, seed, at: AT }).seeded, true);
    const r = B.commit({ action: 'toggle', id: 'beta', enabled: false, reason: 'off' }, { dir: rulesDir, seed, at: '2026-11-15T14:01:00Z', by: 'brett' });
    assert.equal(r.store.rev, 2);
    const rec = await remote('console/build-rules/store.json');
    assert.deepEqual(rec.rules.map((x) => `${x.id}:${x.enabled}`), ['alpha:true', 'beta:false', 'gamma:true']);
    assert.deepEqual(B.history({ dir: rulesDir }).map((h) => h.action), ['toggle', 'seed']);
    noFiles();
  });
  await t('a change is a row patch: only the rule it touched, the head fields that moved and the history line', async () => {
    const before = B.load({ dir: rulesDir, seed, at: AT }).store;
    const applied = B.apply(before, { action: 'edit', id: 'alpha', patch: { note: 'first' }, reason: 'note' }, { at: '2026-11-15T14:02:00Z', by: 'brett' });
    const body = B.rowPatch(before, applied.store, applied.entry, 'build-rules/history.jsonl');
    assert.deepEqual(body.lists.rules.map((c) => [c.key, c.ifRev]), [['alpha', 1]]);
    assert.ok(!('rules' in body.head)); assert.equal(body.head.rev, 3); assert.equal(body.journal.entry.id, 'alpha');
    const r = B.commit({ action: 'edit', id: 'alpha', patch: { note: 'first' }, reason: 'note' }, { dir: rulesDir, seed, at: '2026-11-15T14:02:00Z', by: 'brett' });
    assert.equal(r.store.rev, 3);
    const l = B.load({ dir: rulesDir, seed, at: AT });
    assert.equal(l.seeded, false); assert.equal(l.store.rev, 3); assert.deepEqual(B.storeErrors(l.store), []);
    assert.equal(l.store.rules.find((x) => x.id === 'alpha').note, 'first'); assert.equal(l.store.rules.find((x) => x.id === 'alpha').rev, 2);
    assert.equal(l.store.rules.find((x) => x.id === 'beta').enabled, false, 'the other rows are as they were');
    assert.deepEqual(B.history({ dir: rulesDir }).map((h) => `${h.action}:${h.id || ''}@${h.rev}`), ['edit:alpha@3', 'toggle:beta@2', 'seed:@1']);
    noFiles();
  });
  await t('add and remove are one row each', async () => {
    B.commit({ action: 'add', rule: rule('delta'), reason: 'new' }, { dir: rulesDir, seed, at: '2026-11-15T14:03:00Z', by: 'brett' });
    B.commit({ action: 'remove', id: 'gamma', reason: 'gone' }, { dir: rulesDir, seed, at: '2026-11-15T14:04:00Z', by: 'brett' });
    const l = B.load({ dir: rulesDir, seed, at: AT });
    assert.deepEqual(l.store.rules.map((x) => x.id), ['alpha', 'beta', 'delta']); assert.equal(l.store.rev, 5);
    assert.deepEqual((await remote('console/build-rules/store.json')).rules.map((x) => x.id), ['alpha', 'beta', 'delta']);
    assert.deepEqual(B.history({ dir: rulesDir, limit: 2 }).map((h) => h.action), ['remove', 'add']);
    noFiles();
  });
  await t('a stale row is a conflict on that row (ifRev), never a silent overwrite', async () => {
    const cur = B.load({ dir: rulesDir, seed, at: AT }).store;
    const stale = { ...cur, rules: cur.rules.map((x) => (x.id === 'alpha' ? { ...x, rev: 1 } : x)) };
    const applied = B.apply(stale, { action: 'toggle', id: 'alpha', enabled: false, reason: 'off' }, { at: '2026-11-15T14:05:00Z', by: 'brett' });
    assert.throws(() => files.callSync({ op: 'patch', key: 'console/build-rules/store.json', body: B.rowPatch(stale, applied.store, applied.entry, 'build-rules/history.jsonl') }), (e) => e.code === 'conflict');
    assert.equal(B.load({ dir: rulesDir, seed, at: AT }).store.rules.find((x) => x.id === 'alpha').enabled, true);
  });
  await t('axf-data unreachable: the read throws, no local copy stands in', async () => {
    const env = { ...process.env, AXF_DATA_URL: 'http://127.0.0.1:9', BR_DIR: rulesDir, BR_SEED: seed };
    const code = "const B = await import(process.argv[1]); try { B.load({ dir: process.env.BR_DIR, seed: process.env.BR_SEED }); console.log('read'); } catch (e) { console.log(e.code); }";
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code, join(ROOT, 'framework/core/build-rules.mjs')], { env, encoding: 'utf8' }).trim();
    assert.equal(out, 'unavailable');
  });
} finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
console.log(`build-rules on data-store: ${n} checks ok`);
