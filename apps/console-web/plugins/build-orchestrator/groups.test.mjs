// Self-test: node apps/console-web/plugins/build-orchestrator/groups.test.mjs
// build-groups@1 (custom groups and custom tabs, Brett Nov 13 2026): create / rename / colour / reorder / delete, builds
// assigned to one or several groups, state order partial → … → landed with counts, sort and filter, smart rules (title,
// behind main, filed today), pinned tabs per stage, group actions, saved per project. Core rules, then the CLI on a
// scratch store.
process.env.AXF_CREW_SAY ??= 'off';
process.env.AXF_BUILD_LIMIT ??= 'off';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './groups-core.mjs';

const PLUGIN = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(PLUGIN, '../../../..');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const NOW = Date.parse('2026-11-13T18:00:00Z');
const today = new Date(NOW).toISOString(); const old = '2026-10-01T10:00:00Z';
const rows = [
  { id: 'console-app-one', title: 'Console app part 1', tab: 'pending', priority: 'P2', createdAt: today, updatedAt: today },
  { id: 'console-app-two', title: 'Console app part 2', tab: 'active', priority: 'P1', createdAt: old, updatedAt: old, behind: 700 },
  { id: 'ui-skins', title: 'UI skins', tab: 'incomplete', priority: 'P0', createdAt: old, updatedAt: old, behind: 20 },
  { id: 'ui-done', title: 'UI done one', tab: 'complete', priority: 'P3', createdAt: old, updatedAt: old },
  { id: 'ui-landed', title: 'UI landed', tab: 'archive', priority: 'P2', createdAt: old, updatedAt: old },
  { id: 'queued-one', title: 'Queued thing', tab: 'queue', priority: 'P2', createdAt: old, updatedAt: old },
];

t('create, rename, colour, tab, reorder and delete', () => {
  let d = {};
  d = G.apply(d, 'all', { op: 'create', name: 'Console app', color: 'accent', tab: 'pending' }).doc;
  d = G.apply(d, 'all', { op: 'create', name: 'UI' }).doc;
  d = G.apply(d, 'all', { op: 'create', name: 'Urgent', color: 'danger' }).doc;
  assert.deepEqual(G.groupsOf(d, 'all').map((g) => g.id), ['console-app', 'ui', 'urgent']);
  assert.throws(() => G.apply(d, 'all', { op: 'create', name: 'ui' }), /already/);
  d = G.apply(d, 'all', { op: 'update', group: 'UI', name: 'Interface', color: 'info', tab: 'all' }).doc;
  const ui = G.findGroup(G.groupsOf(d, 'all'), 'interface'); assert.equal(ui.id, 'ui'); assert.equal(ui.color, 'info'); assert.equal(ui.tab, 'all');
  assert.throws(() => G.apply(d, 'all', { op: 'update', group: 'ui', color: 'pink' }), /colour/);
  d = G.apply(d, 'all', { op: 'move', group: 'urgent', to: 'first' }).doc;
  d = G.apply(d, 'all', { op: 'move', group: 'console app', to: 'down' }).doc;
  assert.deepEqual(G.groupsOf(d, 'all').map((g) => g.id), ['urgent', 'ui', 'console-app']);
  d = G.apply(d, 'all', { op: 'delete', group: 'urgent' }).doc;
  assert.deepEqual(G.groupsOf(d, 'all').map((g) => g.id), ['ui', 'console-app']);
  assert.throws(() => G.apply(d, 'all', { op: 'delete', group: 'nope' }), /no group/);
  assert.equal(G.groupsOf(d, 'other').length, 0, 'groups are per project');
});

t('assign: add to several groups, remove, set; bad ids refused', () => {
  let d = G.apply({}, 'all', { op: 'create', name: 'A' }).doc; d = G.apply(d, 'all', { op: 'create', name: 'B' }).doc;
  d = G.apply(d, 'all', { op: 'assign', groups: ['a', 'b'], builds: ['ui-skins', 'ui-done'] }).doc;
  assert.deepEqual(G.groupsOf(d, 'all').map((g) => g.builds), [['ui-skins', 'ui-done'], ['ui-skins', 'ui-done']]);
  d = G.apply(d, 'all', { op: 'assign', group: 'a', builds: ['ui-skins'], mode: 'remove' }).doc;
  d = G.apply(d, 'all', { op: 'assign', group: 'b', builds: ['queued-one'], mode: 'set' }).doc;
  assert.deepEqual(G.groupsOf(d, 'all').map((g) => g.builds), [['ui-done'], ['queued-one']]);
  assert.throws(() => G.apply(d, 'all', { op: 'assign', group: 'a', builds: ['Bad Id!'] }), /not a build id/);
});

t('view: sorted partial → pending → queued → running → done → landed, counts per state, filter, tab rows', () => {
  let d = G.apply({}, 'all', { op: 'create', name: 'All of it', tab: 'pending', builds: rows.map((r) => r.id) }).doc;
  let [v] = G.view(G.groupsOf(d, 'all'), rows, { now: NOW });
  assert.deepEqual(v.rows.map((r) => r.id), ['ui-skins', 'console-app-one', 'queued-one', 'console-app-two', 'ui-done', 'ui-landed']);
  assert.deepEqual(v.counts, { partial: 1, pending: 1, queued: 1, running: 1, failed: 0, done: 1, landed: 1 });
  assert.deepEqual(v.tabRows.map((r) => r.id), ['console-app-one'], 'a custom Pending tab shows the group\'s Pending builds');
  d = G.apply(d, 'all', { op: 'update', group: 'all of it', filter: ['pending', 'partial'], sort: 'priority' }).doc;
  [v] = G.view(G.groupsOf(d, 'all'), rows, { now: NOW });
  assert.deepEqual(v.rows.map((r) => r.id), ['ui-skins', 'console-app-one']); assert.equal(v.total, 6, 'counts stay over every member');
  const gone = G.view([{ ...G.groupsOf(d, 'all')[0], builds: ['gone-build'] }], rows)[0]; assert.deepEqual(gone.missing, ['gone-build']);
});

t('smart rules: title contains, more than N behind main, filed today', () => {
  const mk = (rule) => G.view([G.normGroup({ name: 'S', rule })], rows, { now: NOW })[0];
  assert.deepEqual(mk({ titleContains: 'console app' }).auto.sort(), ['console-app-one', 'console-app-two']);
  assert.deepEqual(mk({ behindMoreThan: 500 }).auto, ['console-app-two']);
  assert.deepEqual(mk({ filedWithinDays: 0 }).auto, ['console-app-one']);
  assert.deepEqual(mk({ titleContains: 'ui', states: ['done', 'landed'] }).auto.sort(), ['ui-done', 'ui-landed']);
  assert.equal(G.normRule({}), null); assert.equal(mk(null).smart, false);
});

t('action targets: queue = Pending, land = Done, archive = not running, priority = all', () => {
  const v = G.view([G.normGroup({ name: 'X', builds: rows.map((r) => r.id) })], rows)[0];
  assert.deepEqual(G.actionTargets(v, 'queue').ids, ['console-app-one']);
  assert.deepEqual(G.actionTargets(v, 'land').ids, ['ui-done']);
  assert.deepEqual(G.actionTargets(v, 'archive').ids.sort(), ['console-app-one', 'queued-one', 'ui-done', 'ui-skins']);
  assert.equal(G.actionTargets(v, 'priority').ids.length, 6);
  assert.throws(() => G.actionTargets(v, 'explode'), /action is one of/);
});

{
  const tmp = mkdtempSync(join(tmpdir(), 'axf-groups-'));
  const storeFile = join(tmp, 'store.json'); mkdirSync(join(tmp, 'pipe'), { recursive: true });
  const b = (id, title, status) => ({ id, title, status, profiles: ['all'], createdAt: today, updatedAt: today, steps: [{ id: 's1', text: 'one', model: 'Opus', estimate: '5 min' }] });
  writeFileSync(storeFile, JSON.stringify({ $axf: 'builds@1', rev: 1, builds: [b('console-app-a', 'Console app A', 'pending'), b('console-app-b', 'Console app B', 'pending'), b('other-c', 'Other C', 'pending')] }));
  const env = { ...process.env, AXF_BUILDS_STORE: storeFile, AXF_BUILD_HOOKS: 'off', AXF_BUILDS_LIVE: '0', AXF_SHIPPED: 'off', AXF_PIPELINE_DIR: join(tmp, 'pipe'), AXF_PIPELINE_WORKTREE_MODE: 'mkdir', AXF_PIPELINE_CONSOLE: 'off', AXF_DATA_DIR: 'off', AXF_BUILD_PROFILE: 'all', AXF_ACTOR: 'check' };
  const run = (...args) => { const r = spawnSync(process.execPath, [join(PLUGIN, 'groups.mjs'), ...args, '--json'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 }); const o = JSON.parse(r.stdout.trim().split('\n').pop() || '{}'); if (r.status !== 0) throw Object.assign(new Error(o.error || r.stderr), { status: r.status }); return o; };
  try {
    t('cli: create a smart group with a Pending tab; tabs, add, show, loose pending', () => {
      const c = run('create', '--name', 'Console app', '--tab', 'pending', '--title', 'console app');
      assert.equal(c.group.total, 2); assert.equal(c.group.smart, true);
      const tabs = run('tabs'); assert.deepEqual(tabs.tabs.map((x) => [x.id, x.stage, x.count]), [['group:console-app', 'pending', 2]]);
      run('create', '--name', 'Urgent'); run('add', 'urgent', 'other-c');
      const l = run('list'); assert.deepEqual(l.groups.map((g) => g.id), ['console-app', 'urgent']); assert.deepEqual(l.loose, []);
      run('remove', 'urgent', 'other-c'); assert.deepEqual(run('list').loose.map((r) => r.id), ['other-c']);
      assert.throws(() => run('show', 'nope'), (e) => e.status === 2);
      const saved = JSON.parse(readFileSync(join(tmp, 'pipe', 'groups.json'), 'utf8')); assert.equal(saved.$axf, 'build-groups@1'); assert.ok(saved.projects.all.groups.length === 2);
    });
    t('cli apply (the API door): op on stdin', () => {
      const r = spawnSync(process.execPath, [join(PLUGIN, 'groups.mjs'), 'apply', '--sources', '--json'], { cwd: ROOT, env, input: JSON.stringify({ behind: {}, op: { op: 'update', group: 'urgent', color: 'danger' } }), encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout); assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).group.color, 'danger');
    });
    t('cli act queue: every Pending build of the group goes to the Queue', () => {
      const r = run('act', 'console app', 'queue');
      assert.deepEqual(r.done.sort(), ['console-app-a', 'console-app-b']);
      const st = JSON.parse(readFileSync(storeFile, 'utf8')).builds; assert.deepEqual(st.filter((x) => x.status === 'queued').map((x) => x.id).sort(), ['console-app-a', 'console-app-b']);
      const g = run('show', 'console-app'); assert.equal(g.group.counts.queued, 2);
    });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`✓ build groups — ${n} checks`);
