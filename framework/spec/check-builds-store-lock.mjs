#!/usr/bin/env node
// builds@1 — a read never fails on the store lock (urgent-console-perf, Nov 4 2026).
// GET /api/build-queue returned 500 "builds store is locked" whenever a read found a foreign write to absorb while
// another process held the lock for more than 20 s. Reads now fall back to the store as it is.
//   node framework/spec/check-builds-store-lock.mjs
import assert from 'node:assert/strict';
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'axf-store-lock-'));
process.env.AXF_DATA_DIR = dir; // scratch data folder: the store and its exports live here, seeded from the repo's store
process.env.AXF_BUILDS_LIVE = '0'; // never publish to main from a test
delete process.env.AXF_BUILDS_STORE;
delete process.env.AXF_BUILDS_EXPORT;

const io = await import('../cli/builds-store.mjs');
const { queueView } = await import('../cli/build-queue.mjs');
const { profileRel, readProfiles } = await import('../cli/persist.mjs');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; console.log(`  ✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } };

try {
  // export every file once, then change one behind the store's back (a foreign write the next read wants to absorb)
  io.withStore((s) => s, { by: 'test', action: 'export' });
  const pending = join(dir, 'framework', 'plan', 'pending.json');
  appendFileSync(pending, '\n');
  const lock = `${io.storeFile()}.lock`;
  closeSync(openSync(lock, 'w')); // another writer holds the lock

  t('loadStore with a foreign write and a held lock answers within a few seconds, no "locked" error', () => {
    const t0 = Date.now(); const s = io.loadStore();
    assert.equal(s.$axf, 'builds@1'); assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0} ms`);
  });
  t('the build-queue read (GET /api/build-queue) answers too', () => {
    const v = queueView(); assert.ok(v.view && v.state, 'view + state');
  });
  t('writes still refuse a held lock (StoreLocked), they never write past it', () => {
    assert.throws(() => io.withStore((s) => s, { by: 'test', action: 'noop', lockWaitMs: 100 }), (e) => e instanceof io.StoreLocked);
  });
  rmSync(lock, { force: true });
  t('once the lock is free the read absorbs the foreign write again', () => {
    assert.equal(io.loadStore().$axf, 'builds@1'); assert.equal(existsSync(lock), false, 'lock left behind');
  });
  t('a file with nothing to export (a queue file for a profile without a queue) is recorded, so reads stop writing', () => {
    const s = io.loadStore();
    const empty = readProfiles().profiles.map((p) => p.id).filter((id) => !io.exportText(s, 'queue', id));
    assert.ok(empty.length, 'some profile has no queue');
    for (const id of empty) { const f = join(dir, profileRel(id, 'framework/plan/build-queue.json')); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, '{"$axf":"build-queue@1","order":[],"steps":{}}\n'); }
    io.loadStore(); // absorbs them once (a write) ...
    const ex = `${io.storeFile()}.exports.json`; const before = statSync(ex).mtimeMs; const store = statSync(io.storeFile()).mtimeMs;
    for (let i = 0; i < 3; i += 1) io.loadStore(); // ... then plain reads: no lock, no write
    assert.equal(statSync(ex).mtimeMs, before, 'exports index rewritten by a read'); assert.equal(statSync(io.storeFile()).mtimeMs, store);
    assert.equal(existsSync(lock), false);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`builds-store lock: ${n} checks passed`);
