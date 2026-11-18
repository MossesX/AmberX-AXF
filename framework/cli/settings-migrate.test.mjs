#!/usr/bin/env node
/** settings-migrate: pattern expansion, owner wins, newest copy wins when the owner is unset, dry run writes nothing, apply moves + strips + journals. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as M from './settings-migrate.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'axf-settings-migrate-'));
const env = { ...process.env, AXF_ROOT: tmp, AXHUB_PROJECTS_DIR: join(tmp, 'projects'), AXF_STATE: join(tmp, '.axf-console/state.json'), AXF_PLUGINS_DATA_DIR: join(tmp, '.axf-console/plugins') };
const ownerFile = join(tmp, '.axf-console/plugins/alpha/workers.json');
const copyFile = join(tmp, 'projects/amberx-axf/_data/beta/accounts.json');
const journal = join(tmp, 'journal.json');
mkdirSync(join(tmp, '.axf-console/plugins/alpha'), { recursive: true }); mkdirSync(join(tmp, 'projects/amberx-axf/_data/beta'), { recursive: true });
const registry = {
  $axf: 'settings-sources@1',
  stores: {
    'alpha/workers': { kind: 'data-store', ns: 'plugins', path: 'alpha/workers.json', frame: 'alpha-workers@1', owner: 'plugin:alpha', file: '{plugins}/alpha/workers.json' },
    'beta/accounts': { kind: 'data-store', ns: 'console', path: 'beta/accounts.json', owner: 'plugin:beta', file: '{projects}/amberx-axf/_data/beta/accounts.json' },
    'beta/settings': { kind: 'data-store', ns: 'console', path: 'beta/settings.json', owner: 'plugin:beta', file: '{projects}/amberx-axf/_data/beta/settings.json' },
  },
  settings: [
    { key: 'accounts.*.use', store: 'alpha/workers', pointer: '/perAccount/{1}/use', readers: [], writers: ['plugin:alpha'], mirrors: [], formerly: [{ store: 'beta/accounts', pointer: '/{1}/use' }] },
    { key: 'accounts.*.parallel', store: 'alpha/workers', pointer: '/perAccount/{1}/parallel', readers: [], writers: ['plugin:alpha'], mirrors: [], formerly: [{ store: 'beta/accounts', pointer: '/{1}/parallel' }] },
    { key: 'beta.**', store: 'beta/settings', pointer: '/{rest}', readers: [], writers: [], mirrors: [] },
  ],
};
// owner: a1 set (true), a2 unset; copy: a1 false (older), a2 true, a3 parallel 4; a4 in neither
writeFileSync(ownerFile, JSON.stringify({ $axf: 'alpha-workers@1', workers: ['a1'], perAccount: { a1: { use: true, label: 'One' }, a2: { label: 'Two' } } }));
writeFileSync(copyFile, JSON.stringify({ a1: { use: false }, a2: { use: true, health: { ok: true } }, a3: { parallel: 4 } }));
utimesSync(copyFile, new Date('2026-11-17T00:00:00Z'), new Date('2026-11-17T00:00:00Z'));
const opts = { registry, env, journal };

// expansion
const keys = await M.keysFor('accounts.*.use', opts);
assert.deepEqual(keys, ['accounts.a1.use', 'accounts.a2.use']);
assert.deepEqual(M.expandKeys('beta.**', '/{rest}', { maxRuns: 5, 'x.y': 1 }).map((r) => r.key), ['beta.maxRuns', 'beta.x.y']);
assert.deepEqual(M.expandKeys('look.**', '/{rest/}', { own: { spacing: 'tight', slots: { a: 1 } }, undo: null }).map((r) => r.key), ['look.own.spacing', 'look.own.slots.a', 'look.undo']);
assert.deepEqual(M.patternsWithFormerly(registry), ['accounts.*.use', 'accounts.*.parallel']);

// plan
const rows = await M.plan(['accounts.*.use', 'accounts.*.parallel', 'accounts.a4.use'], opts);
const by = Object.fromEntries(rows.map((r) => [r.key, r]));
assert.equal(by['accounts.a1.use'].pick.value, true); assert.match(by['accounts.a1.use'].pick.why, /owner holds/); assert.equal(by['accounts.a1.use'].conflict, true); assert.deepEqual(by['accounts.a1.use'].strip, ['beta/accounts']);
assert.equal(by['accounts.a2.use'].pick.value, true); assert.match(by['accounts.a2.use'].pick.why, /newest copy/); assert.equal(by['accounts.a2.use'].pick.store, 'beta/accounts');
assert.equal(by['accounts.a3.parallel'].pick.value, 4);
assert.equal(by['accounts.a4.use'].noop, true); assert.equal(by['accounts.a4.use'].pick.value, undefined);

// dry run changes nothing
await M.migrate(['accounts.*.use'], opts);
assert.equal(JSON.parse(readFileSync(copyFile, 'utf8')).a1.use, false); assert.ok(!existsSync(journal));

// apply
const r = await M.migrate(['accounts.*.use', 'accounts.*.parallel', 'accounts.a4.use'], { ...opts, apply: true, at: '2026-11-18T00:00:00Z' });
assert.equal(r.applied.length, 3);
const owner = JSON.parse(readFileSync(ownerFile, 'utf8')); const copy = JSON.parse(readFileSync(copyFile, 'utf8'));
assert.deepEqual(owner.perAccount, { a1: { use: true, label: 'One' }, a2: { label: 'Two', use: true }, a3: { parallel: 4 } });
assert.equal(owner.workers[0], 'a1');
assert.deepEqual(copy, { a1: {}, a2: { health: { ok: true } }, a3: {} });
const j = JSON.parse(readFileSync(journal, 'utf8'));
assert.equal(j.$axf, 'settings-migration@1'); assert.equal(j.entries.length, 3);
assert.deepEqual(j.entries[0].before, { 'alpha/workers': true, 'beta/accounts': false }); assert.deepEqual(j.entries[0].after, { 'alpha/workers': true, 'beta/accounts': null }); assert.equal(j.entries[0].at, '2026-11-18T00:00:00Z');
// a second run is a no-op
const again = await M.migrate(['accounts.*.use', 'accounts.*.parallel'], { ...opts, apply: true });
assert.equal(again.applied.length, 0); assert.ok(again.rows.every((x) => x.noop));
assert.equal(JSON.parse(readFileSync(journal, 'utf8')).entries.length, 3);

// CLI
process.env.AXF_ROOT = tmp; process.env.AXHUB_PROJECTS_DIR = env.AXHUB_PROJECTS_DIR; process.env.AXF_STATE = env.AXF_STATE; process.env.AXF_PLUGINS_DATA_DIR = env.AXF_PLUGINS_DATA_DIR;
const regFile = join(tmp, 'registry.json'); writeFileSync(regFile, JSON.stringify(registry));
const logs = []; const orig = console.log; console.log = (s) => logs.push(String(s));
try { assert.equal(await M.main(['--all', '--dry-run', '--registry', regFile, '--journal', journal]), 0); assert.equal(await M.main(['--registry', regFile]), 2); } finally { console.log = orig; }
assert.match(logs.join('\n'), /dry run: 0 move/);
rmSync(tmp, { recursive: true, force: true });
console.log('settings-migrate: ok');
