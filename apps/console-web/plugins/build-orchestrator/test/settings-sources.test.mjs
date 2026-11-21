#!/usr/bin/env node
/**
 * settings-sources@1 in the pipeline: three of its settings have their one stored key elsewhere and are read aliases
 * here (sessions per account → claude-workers limits.building; launch without asking and the brief size → the Claude
 * settings), a save never stores them again, and migrateSettings() moves what a store still carries, keeping the one
 * saved last and logging it.
 *   node apps/console-web/plugins/build-orchestrator/test/settings-sources.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-settings-sources-'));
const pipe = join(tmp, 'pipeline'); const workers = join(tmp, 'workers'); const claude = join(tmp, 'claude-settings.json');
for (const d of [pipe, workers]) mkdirSync(d, { recursive: true });
Object.assign(process.env, { AXF_PIPELINE_DIR: pipe, AXF_CLAUDE_WORKERS: workers, AXF_CLAUDE_SEEN: join(workers, 'seen.json'), AXF_CLAUDE_ACCOUNTS: join(tmp, 'accounts'), AXF_CLAUDE_SETTINGS_FILE: claude, AXF_SLOTS_DIR: join(tmp, 'slots'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off' });
delete process.env.AXF_PIPELINE_SETTINGS;
const PL = await import('../pipeline.mjs');
const P = await import('../pipeline-core.mjs');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const write = (f, v, at) => { writeFileSync(f, JSON.stringify(v)); if (at) utimesSync(f, new Date(at), new Date(at)); };
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const settingsFile = join(pipe, 'settings.json'); const accountsFile = join(pipe, 'accounts.json'); const workersFile = join(workers, 'workers.json');
const log = () => readFileSync(join(pipe, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.event === 'settings-migrated');
const wipe = () => { for (const f of [settingsFile, accountsFile, workersFile, claude, join(pipe, 'log.jsonl')]) rmSync(f, { force: true }); };

t('read aliases: a store with only the old keys is still read from them', () => {
  wipe();
  write(settingsFile, { parallelPerAccount: 4, autoQueue: true, briefMaxBytes: 50000 });
  const s = PL.loadSettings();
  assert.deepEqual([s.parallelPerAccount, s.autoQueue, s.briefMaxBytes], [4, true, 50000]);
  write(settingsFile, {}); write(claude, { values: { 'builds.maxParallel': 2 } });
  assert.equal(PL.loadSettings().parallelPerAccount, 2, 'the older Claude setting is the last alias');
});

t('the one stored key wins over every copy', () => {
  wipe();
  write(settingsFile, { parallelPerAccount: 4, autoQueue: true, briefMaxBytes: 50000 });
  write(workersFile, { limits: { building: 7 } });
  write(claude, { values: { 'builds.maxParallel': 2, 'builds.launchWithoutAsking': false, 'builds.briefMaxBytes': 90000 } });
  const s = PL.loadSettings();
  assert.deepEqual([s.parallelPerAccount, s.autoQueue, s.briefMaxBytes], [7, false, 90000]);
});

t('a save never stores an alias: sessions per account goes to claude-workers, the Claude ones are refused', () => {
  wipe();
  const s = PL.saveSettings({ parallelPerAccount: 3, maxRuns: 4 });
  assert.deepEqual([s.parallelPerAccount, s.maxRuns], [3, 4]);
  assert.equal(read(workersFile).limits.building, 3);
  const file = read(settingsFile);
  for (const k of Object.keys(P.ALIAS_KEYS)) assert.ok(!(k in file), `${k} is not in the pipeline settings file`);
  assert.throws(() => PL.saveSettings({ autoQueue: true }), /builds\.launchWithoutAsking/);
  assert.throws(() => PL.saveSettings({ briefMaxBytes: 1 }), /builds\.briefMaxBytes/);
});

t('accounts: the saved claude-workers cap is the account\'s sessions at once; own.parallel is only an alias', () => {
  const settings = P.normSettings({ parallelPerAccount: 2 });
  const row = { name: 'w', role: 'worker', plan: 'max', running: [], building: 8, buildingSet: true };
  assert.equal(P.accountView(row, { parallel: 3 }, { settings }).parallel, 8);
  assert.equal(P.accountView({ ...row, buildingSet: false, building: 3 }, { parallel: 4 }, { settings }).parallel, 4, 'no saved config: the old own key');
  assert.equal(P.accountView({ ...row, buildingSet: false, building: 3 }, {}, { settings }).parallel, 2, 'no saved config, no own key: the setting');
});

t('migration: the pipeline saved last → its numbers are kept, the per-account caps follow, all logged', () => {
  wipe();
  write(workersFile, { limits: { building: 5 }, perAccount: { a: { building: 8, label: 'A' }, b: { building: 5 }, c: { label: 'C' } } }, '2026-11-19T00:00:00Z');
  write(accountsFile, { b: { parallel: 2, fable: true } }, '2026-11-20T00:00:00Z');
  write(settingsFile, { parallelPerAccount: 5, autoQueue: false, briefMaxBytes: 122880, maxRuns: 5 }, '2026-11-20T00:00:00Z');
  const lines = PL.migrateSettings();
  const w = read(workersFile);
  assert.deepEqual([w.limits.building, w.perAccount.a.building, w.perAccount.a.label, w.perAccount.b.building, w.perAccount.c.building], [5, 5, 'A', 2, undefined]);
  assert.deepEqual(read(settingsFile), { maxRuns: 5 });
  assert.deepEqual(read(accountsFile), { b: { fable: true } });
  const spa = lines.find((l) => l.group === 'builds.sessionsPerAccount');
  assert.equal(spa.kept, 'pipeline (saved last)'); assert.equal(spa.disagreed, true);
  assert.deepEqual(spa.changes.map((c) => [c.key, c.from, c.to]).sort(), [['perAccount.a.building', 8, 5], ['perAccount.b.building', 5, 2]]);
  assert.equal(lines.length, 3); assert.equal(log().length, 3);
  assert.deepEqual(PL.migrateSettings(), [], 'nothing left to move: it runs once');
  assert.equal(PL.loadSettings().parallelPerAccount, 5);
});

t('migration: claude-workers saved last → its numbers are kept, the pipeline copies are dropped', () => {
  wipe();
  write(settingsFile, { parallelPerAccount: 2 }, '2026-11-18T00:00:00Z');
  write(workersFile, { limits: { building: 6 }, perAccount: { a: { building: 8 } } }, '2026-11-19T00:00:00Z');
  const [line] = PL.migrateSettings();
  assert.equal(line.kept, 'claude-workers (saved last)'); assert.deepEqual(line.changes, []);
  assert.deepEqual([read(workersFile).limits.building, read(workersFile).perAccount.a.building], [6, 8]);
  assert.ok(!('parallelPerAccount' in read(settingsFile)));
  assert.equal(PL.loadSettings().parallelPerAccount, 6);
});

t('migration: a value only the pipeline has is moved over; a Claude copy that says something else stays readable', () => {
  wipe();
  write(settingsFile, { parallelPerAccount: 4, autoQueue: true, briefMaxBytes: 50000 });
  const lines = PL.migrateSettings();
  assert.equal(read(workersFile).limits.building, 4);
  assert.equal(lines.length, 1, 'only sessions per account moved');
  assert.deepEqual(read(settingsFile), { autoQueue: true, briefMaxBytes: 50000 });
  const s = PL.loadSettings();
  assert.deepEqual([s.parallelPerAccount, s.autoQueue, s.briefMaxBytes], [4, true, 50000]);
  write(claude, { values: { 'builds.launchWithoutAsking': false, 'builds.briefMaxBytes': 60000 } });
  const more = PL.migrateSettings();
  assert.deepEqual(more.map((l) => [l.group, l.disagreed]), [['builds.launchWithoutAsking', true], ['builds.briefMaxBytes', true]]);
  assert.deepEqual(read(settingsFile), {});
});

rmSync(tmp, { recursive: true, force: true });
console.log(`settings-sources (pipeline): ${n} passed`);
