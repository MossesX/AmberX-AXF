// Self-test: node apps/console-web/plugins/build-profiles/cleanup-e2e.test.mjs
// The cleanup helper end to end on a scratch data folder and a scratch builds store (never the real ones): the plugin's
// real routes (FastAPI TestClient) → the real profiles CLI → the store, read back the way the panel reads it
// (web/cleanup-core.mjs). Scan, one-tap fix of one build, Fix all, what has no proof stays flagged. Then the other
// commands whose names differ between the route and the CLI (colour, move-builds, merge, purge) through the same path.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './web/cleanup-core.mjs';

const PLUGIN = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(PLUGIN, '../../../..');
const dir = mkdtempSync(join(tmpdir(), 'axf-profile-cleanup-'));
Object.assign(process.env, {
  AXF_DATA_DIR: dir, AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUILDS_EXPORT: '0', AXF_BUILDS_LIVE: '0',
  AXF_HEADLESS_DIR: join(dir, 'meters'), AXF_CONSOLE_ROOT: 'off', AXF_ACTOR: 'check', AXF_CREW_SAY: 'off',
});
delete process.env.AXF_BUILD_PROFILE;

const core = await import(join(ROOT, 'framework/plan/builds-store-core.mjs'));
const io = await import(join(ROOT, 'framework/cli/builds-store.mjs'));
const profiles = await import(join(ROOT, 'framework/cli/profiles.mjs'));

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const NOW = '2026-11-20T10:00:00.000Z';
const steps = (done, total) => Array.from({ length: total }, (_, i) => ({ id: `s${i + 1}`, text: `step ${i + 1}`, model: 'Opus', done: i < done, doneAt: i < done ? NOW : '' }));
const landed = { pr: 7, mergedAt: '2026-11-19T08:00:00.000Z', sha: 'a'.repeat(40), ci: 'success', verifiedAt: '2026-11-19T09:00:00.000Z', verifyHow: 'check' };
const build = (id, profile, status, done, total, more = {}) => core.normBuild({ id, title: `Build ${id}`, status, profiles: [profile], steps: steps(done, total), createdAt: NOW, updatedAt: NOW, ...more });
const statusOf = (id) => core.findBuild(io.loadStore(), id)?.status;
const profilesOf = (id) => core.findBuild(io.loadStore(), id)?.profiles;

// the plugin's routes, called one after another in one Python process: [[method, path, body-or-params], …] → [[status, json], …]
const PY = `
import importlib.util, json, sys
from pathlib import Path
here = Path(sys.argv[1]); root = here.parents[3]
sys.path.insert(0, str(here.parent.parent / "server"))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import console_context as cx
cx.set_context(ROOT=root, log=lambda *a, **k: None)
spec = importlib.util.spec_from_file_location("build_profiles_server", here / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
app = FastAPI(); app.include_router(mod.router, prefix="/p")
client = TestClient(app)
out = []
for method, path, data in json.loads(sys.stdin.read()):
    r = client.get(f"/p/{path}", params=data) if method == "GET" else client.post(f"/p/{path}", json=data)
    out.append([r.status_code, r.json()])
print(json.dumps(out))
`;
function routes(calls) {
  const r = spawnSync('python3', ['-c', PY, PLUGIN], { input: JSON.stringify(calls), encoding: 'utf8', env: process.env, cwd: ROOT, timeout: 240000 });
  assert.equal(r.status, 0, r.stderr.slice(-800));
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

try {
  mkdirSync(join(dir, 'framework/plan'), { recursive: true });
  writeFileSync(join(dir, 'framework/plan/profiles.json'), JSON.stringify({ $axf: 'build-profiles@1', active: 'all', profiles: [{ id: 'all', name: 'All builds', catalog: true }] }));
  profiles.act({ action: 'create', name: 'Alpha', id: 'pc-alpha' });
  profiles.act({ action: 'create', name: 'Beta', id: 'pc-beta' });
  const seed = core.emptyStore(NOW); seed.migratedAt = NOW;
  seed.builds.push(
    build('arch-merged', 'pc-alpha', 'archived', 2, 2, { pr: '7', branch: 'claude/arch-merged', mergedAt: landed.mergedAt, landed }),
    build('arch-steps', 'pc-alpha', 'archived', 3, 3),
    build('arch-open', 'pc-alpha', 'archived', 1, 3),
    build('running', 'pc-alpha', 'running', 1, 3),
    build('ghost', 'pc-gone', 'pending', 0, 1),
    build('beta-one', 'pc-beta', 'pending', 0, 2),
  );
  seed.builds.forEach((b, i) => { b.order[b.profiles[0]] = i; });
  writeFileSync(io.storeFile(), `${JSON.stringify(core.compactStore(seed), null, 1)}\n`);
  assert.deepEqual(core.validateStore(io.readStoreNow()).errors ?? [], [], 'the seeded store is a valid builds@1 store');

  const [scanAll, scanAlpha, badProfile, fixOne, afterOne, fixRest, afterAll, again] = routes([
    ['GET', 'cleanup', {}],
    ['GET', 'cleanup', { profile: 'pc-alpha' }],
    ['GET', 'cleanup', { profile: '--fix' }],
    ['POST', 'cleanup', { builds: ['ghost'] }],
    ['GET', 'cleanup', {}],
    ['POST', 'cleanup', {}],
    ['GET', 'cleanup', {}],
    ['POST', 'cleanup', {}],
  ]);

  t('scan: archived builds that finished and builds in a lost profile; an unfinished archived build is not flagged', () => {
    assert.equal(scanAll[0], 200);
    const s = C.normalizeScan(scanAll[1]);
    assert.deepEqual(s.findings.map((f) => [f.kind, f.id, f.fixable]).sort(), [['archived-complete', 'arch-merged', true], ['archived-complete', 'arch-steps', false], ['orphan-profile', 'ghost', true]]);
    assert.equal(s.fixable, 2);
    const merged = s.findings.find((f) => f.id === 'arch-merged');
    assert.equal(C.evidenceText(merged), 'its PR merged'); assert.match(C.fixText(merged), /^archived → (complete|landed)$/);
    assert.ok(s.findings.find((f) => f.id === 'arch-steps').why, 'what can\'t be fixed says why');
    assert.deepEqual(C.groupFindings(s.findings).map((g) => [g.kind, g.rows.length]), [['archived-complete', 2], ['orphan-profile', 1]]);
    assert.deepEqual(C.fixRequest(s).builds.sort(), ['arch-merged', 'ghost']);
  });
  t('scan of one profile; a bad profile id is refused', () => {
    assert.deepEqual(C.normalizeScan(scanAlpha[1]).findings.map((f) => f.id).sort(), ['arch-merged', 'arch-steps']);
    assert.equal(badProfile[0], 400);
  });
  t('one tap fixes one build and leaves the rest', () => {
    assert.equal(fixOne[0], 200, JSON.stringify(fixOne[1]));
    const r = C.normalizeFix(fixOne[1], ['ghost']);
    assert.deepEqual(r.fixed.map((f) => f.id), ['ghost']); assert.deepEqual(r.refused, []);
    assert.equal(C.fixMessage(r).tone, 'success');
    assert.deepEqual(C.normalizeScan(afterOne[1]).findings.map((f) => f.id).sort(), ['arch-merged', 'arch-steps']);
  });
  t('Fix all fixes everything fixable; what has no proof stays flagged, and a second run changes nothing', () => {
    assert.equal(fixRest[0], 200, JSON.stringify(fixRest[1]));
    assert.deepEqual(C.normalizeFix(fixRest[1]).fixed.map((f) => f.id), ['arch-merged']);
    const left = C.normalizeScan(afterAll[1]);
    assert.deepEqual(left.findings.map((f) => [f.id, f.fixable]), [['arch-steps', false]]);
    assert.equal(again[0], 200); assert.deepEqual(C.normalizeFix(again[1]).fixed, []);
    assert.equal(C.fixMessage(C.normalizeFix(again[1])).text, 'Nothing needed fixing.');
  });
  t('the store shows the fixes: status moved on, the lost profile replaced by the base one, a note left, nothing deleted', () => {
    assert.ok(['complete', 'landed'].includes(statusOf('arch-merged')), statusOf('arch-merged'));
    assert.deepEqual(profilesOf('ghost'), ['all']);
    assert.equal(statusOf('arch-steps'), 'archived'); assert.equal(statusOf('arch-open'), 'archived'); assert.equal(statusOf('running'), 'running');
    assert.match(core.findBuild(io.loadStore(), 'arch-merged').notes.at(-1).text, /^Cleanup: /);
    assert.equal(io.loadStore().builds.filter((b) => !b.deleted).length, 6);
  });

  // the other commands whose names differ between the route (plugin.json) and the CLI
  const [look, move, mergeKeep, mergeOff, noConfirm, purge, list] = routes([
    ['POST', 'update', { id: 'pc-alpha', colour: 'accent', icon: 'rocket' }],
    ['POST', 'move-builds', { builds: ['running'], to: 'pc-beta', from: 'pc-alpha' }],
    ['POST', 'merge', { from: 'pc-beta', into: 'pc-alpha' }],
    ['POST', 'merge', { from: 'pc-beta', into: 'pc-alpha', removeSource: true }],
    ['POST', 'purge', { id: 'pc-beta', confirm: 'yes' }],
    ['POST', 'purge', { id: 'pc-beta', confirm: 'pc-beta' }],
    ['GET', 'list', {}],
  ]);
  t('update: colour and icon reach the registry', () => {
    assert.equal(look[0], 200, JSON.stringify(look[1]));
    const p = list[1].profiles.find((x) => x.id === 'pc-alpha');
    assert.equal(p.color, 'accent'); assert.equal(p.icon, 'rocket');
  });
  t('move-builds moves the builds named', () => {
    assert.equal(move[0], 200, JSON.stringify(move[1]));
    assert.deepEqual(move[1].report.moved.map((x) => x.id ?? x), ['running']);
  });
  t('merge keeps the source on the list unless removeSource is set', () => {
    assert.equal(mergeKeep[0], 200, JSON.stringify(mergeKeep[1]));
    assert.ok(mergeKeep[1].registry.profiles.some((p) => p.id === 'pc-beta'), 'pc-beta stays after a plain merge');
    assert.deepEqual(profilesOf('running'), ['pc-alpha']); assert.deepEqual(profilesOf('beta-one'), ['pc-alpha']);
    assert.equal(mergeOff[0], 200, JSON.stringify(mergeOff[1]));
    assert.ok(!mergeOff[1].registry.profiles.some((p) => p.id === 'pc-beta') && mergeOff[1].registry.removed.some((p) => p.id === 'pc-beta'), 'pc-beta is off the list and restorable');
  });
  t('purge: confirm must be the id; with it the removed profile is gone for good', () => {
    assert.equal(noConfirm[0], 400);
    assert.equal(purge[0], 200, JSON.stringify(purge[1]));
    assert.ok(![...list[1].profiles, ...(list[1].removed ?? [])].some((p) => p.id === 'pc-beta'));
  });
  console.log(`✓ build-profiles cleanup end to end: ${n} checks`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
