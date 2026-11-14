// Self-test: node apps/console-web/plugins/ui-directory/test.mjs
// The manifest and web entry follow the plugin rules, the collector reads the real repo into a valid ui-directory@1
// data set (every plugin, every console view and settings tab has a row, this plugin included), the web-registration
// parser reads literal ids, the store writes only when something moved and the change log says what, the build hook
// rebuilds on the right events only, and the CI check passes against the committed ratchet.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'ui-directory-'));
process.env.AXF_UI_DIRECTORY_DIR = tmp;
const dir = await import('./directory.mjs');
const D = await import('../../../../framework/core/ui-directory.mjs');
const hook = (await import('./build-hooks.mjs')).default;
const core = await import('./web/dir-core.mjs');

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const ta = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

t('plugin@1 manifest, lifecycle, model, web entry, menu', () => {
  const man = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'));
  assert.equal(man.id, 'ai.amberx.axf.console.ui-directory');
  assert.equal(man.lifecycle.$axf, 'plugin-lifecycle@1'); assert.equal(man.lifecycle.dataDir, '.axf-console/plugins/ui-directory');
  assert.equal(man.builtWith.model, 'fable'); assert.equal(man.buildHooks, 'build-hooks.mjs');
  assert.ok(man.provides.includes('settings-tab:ui-directory') && man.provides.includes('service:ui-directory@1'));
  for (const f of ['install.mjs', 'uninstall.mjs', 'hooks.mjs', 'directory.mjs', 'coverage.json', 'help.json', 'server/__init__.py']) assert.ok(existsSync(join(here, f)), f);
  const web = readFileSync(join(here, 'web/index.tsx'), 'utf8');
  assert.match(web, /parent: 'plugins'/); assert.match(web, /PluginLifecyclePanel/); assert.match(web, /role="toolbar" aria-label=/);
  assert.match(readFileSync(join(here, 'web/menu.ts'), 'utf8'), /settings\.open:ui-directory/);
});

t('web registrations: this plugin declares exactly what its manifest provides', () => {
  const w = dir.webRegistrations(here);
  assert.deepEqual(w.settingsTabs.map((x) => x.id), ['ui-directory']);
  assert.deepEqual(w.settingsPanels.map((x) => x.id), ['ui-directory.status', 'ui-directory.lifecycle']);
  assert.deepEqual(w.views.map((x) => x.id), ['ui-directory']); assert.deepEqual(w.dialogs, []);
  const g = D.registrationGaps(['view:ui-directory', 'settings-tab:ui-directory'], JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8')).provides);
  assert.deepEqual(g, { unregistered: [], phantom: [] });
});

t('the collector reads the repo into a valid data set with every plugin, view and settings tab', () => {
  const fresh = dir.buildFresh({ previous: null, now: '2026-11-14T04:00:00Z' });
  const d = fresh.directory;
  assert.equal(d.$axf, 'ui-directory@1'); assert.equal(d.generatedAt, '2026-11-14T04:00:00Z');
  assert.ok(d.total > 300, `${d.total} rows`); assert.equal(d.dropped, 0);
  assert.deepEqual(D.validateDirectory(d), { ok: true, errors: [] });
  const ids = new Set(d.rows.map((r) => r.id));
  assert.ok(ids.has('console-web:plugin:ui-directory') && ids.has('console-web:settings-tab:ui-directory') && ids.has('console-web:settings-panel:ui-directory.status'));
  assert.ok(ids.has('console-web:app:axf-console') && ids.has('console-web:screen:settings') && ids.has('console-web:screen:home'));
  for (const p of fresh.plugins) assert.ok(ids.has(D.rowId(p.app, 'plugin', p.folder)), `${p.app}/${p.folder}`);
  const own = d.rows.find((r) => r.id === 'console-web:settings-tab:ui-directory');
  assert.equal(own.deepLink.tool, 'console_settings'); assert.equal(own.status, 'live'); assert.equal(own.parent, 'console-web:settings-tab:plugins');
  const panel = d.rows.find((r) => r.id === 'console-web:settings-panel:ui-directory.status');
  assert.equal(panel.parent, own.id);
  assert.ok(d.rows.filter((r) => r.kind === 'app').every((r) => r.status === 'live' && r.deepLink === null), 'app rows are live containers');
  assert.ok(d.rows.some((r) => r.app === 'axhub-web' && r.kind === 'screen'), 'other apps have screens');
  assert.ok(d.rows.filter((r) => r.plugin && r.kind !== 'settings-tab' && r.kind !== 'plugin').some((r) => r.settings), 'rows link their settings interface');
  assert.ok(D.reachOf(own).cli.startsWith('axf console do open view:settings'));
  assert.ok(D.tree(d.rows).some((a) => a.name === 'GizmoX AI Studio' && a.children.length > 10), 'the tree groups by app');
  assert.ok(D.search(d.rows, 'ui directory')[0].id.includes('ui-directory'), 'search finds this plugin first');
});

t('the store writes only when something moved and keeps firstSeen', () => {
  rmSync(tmp, { recursive: true, force: true });
  const a = dir.writeDirectory({ reason: 'test', build: 'b1' });
  assert.ok(a.wrote && a.diff.added.length === a.directory.total);
  const b = dir.writeDirectory({ reason: 'test', build: 'b2' });
  assert.ok(!b.wrote, 'a second build with nothing new writes nothing');
  const log = JSON.parse(readFileSync(join(tmp, 'changes.json'), 'utf8'));
  assert.equal(log.length, 1); assert.equal(log[0].build, 'b1'); assert.equal(log[0].counts.added, a.directory.total);
  const saved = JSON.parse(readFileSync(join(tmp, 'directory.json'), 'utf8'));
  assert.ok(saved.rows.every((r) => r.firstSeen === saved.generatedAt), 'every row got firstSeen on the first build');
});

await ta('the build hook rebuilds on UI-changing events only', async () => {
  assert.deepEqual(await hook([{ event: 'heartbeat', build: { id: 'x' } }]), { rebuilt: false });
  const r = await hook([{ event: 'step-done', build: { id: 'ui-directory-plugin-self-updating-data' } }, { event: 'status', build: { id: 'other' } }]);
  assert.deepEqual(r.builds, ['ui-directory-plugin-self-updating-data', 'other']); assert.equal(r.rebuilt, false);
});

t('the CI check passes against the committed ratchet', () => {
  const r = dir.checkDirectory();
  assert.deepEqual(r.errors, []); assert.ok(r.ok);
  const ratchet = JSON.parse(readFileSync(join(here, 'coverage.json'), 'utf8'));
  for (const k of ['unlinked', 'unregistered', 'phantom']) assert.ok(r.counts[k] <= ratchet[k], `${k} ${r.counts[k]} ≤ ${ratchet[k]}`);
});

t('registration gaps are found (a view drawn but not provided; a provided dialog with no code)', () => {
  assert.deepEqual(D.registrationGaps(['view:a', 'dialog:b'], ['view:a', 'dialog:c', 'service:x@1']), { unregistered: ['dialog:b'], phantom: ['dialog:c'] });
});

t('the page: filters keep matches plus the rows that name their groups; the tree nests them', () => {
  const rows = dir.buildFresh({ previous: null, now: '2026-11-14T04:00:00Z' }).directory.rows;
  assert.ok(rows.some((r) => r.id === 'console-web:screen:ui-directory'), 'the directory page is itself in the directory');
  assert.equal(core.visibleRows(rows, core.EMPTY), rows);
  const f = { ...core.EMPTY, q: 'ui directory', kind: 'settings-panel' };
  const hit = core.matches(rows, f);
  assert.ok(hit.length >= 2 && hit.every((r) => r.kind === 'settings-panel'));
  const shown = core.visibleRows(rows, f);
  assert.ok(shown.some((r) => r.id === 'console-web:app:axf-console') && shown.some((r) => r.id === 'console-web:plugin:ui-directory'), 'app and plugin rows name the groups');
  const tr = D.tree(shown);
  const app = tr.find((a) => a.id === 'console-web:app:axf-console');
  const plug = app.children.find((n) => n.id === 'console-web:plugin:ui-directory');
  assert.ok(plug && core.countUnder(plug) >= 2, 'panels sit under their plugin');
  assert.ok(core.groupIds(tr).includes(app.id));
  assert.deepEqual(core.matches(rows, { ...core.EMPTY, q: 'zzzz-nothing' }), []);
});

t('the page: action args become filters (words, key=value, url-encoded)', () => {
  assert.deepEqual(core.filtersFromArgs(['toolbar', 'kind=settings-tab']), { q: 'toolbar', app: '', kind: 'settings-tab', status: '', family: '' });
  assert.deepEqual(core.filtersFromArgs('app%3Dconsole-web%20q%3Dbuilds'), { q: 'builds', app: 'console-web', kind: '', status: '', family: '' });
  assert.deepEqual(core.filtersFromArgs(['q=', 'app=', 'kind=', 'status=', 'family=radius']), { q: '', app: '', kind: '', status: '', family: 'radius' });
  assert.deepEqual(core.filtersFromArgs([]), { q: '', app: '', kind: '', status: '', family: '' });
});

t('every page action is a command or names the command it duplicates', () => {
  const man = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'));
  const web = readFileSync(join(here, 'web/index.tsx'), 'utf8');
  const actions = [...web.matchAll(/rt\.actions\.register\('([\w.-]+)'/g)].map((m) => m[1]);
  assert.ok(actions.length >= 7);
  for (const a of actions) assert.ok(man.commands.items.some((i) => i.action === a), a);
  for (const r of ['GET /page', 'POST /show', 'POST /open']) assert.ok(man.commands.items.some((i) => i.route === r), r);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`ui-directory: ${n} checks passed`);
