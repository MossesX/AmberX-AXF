// Self-test: node apps/console-web/plugins/build-breaker/test.mjs
// The seed loads and is whole, every ask has an app, filters / sort / group / totals work, the merge keeps unknown
// fields, the CLI works on scratch copies (the repo's seed is never written), and every Build menu entry opens
// something that exists.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as bb from './web/bb-core.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const here = new URL('.', import.meta.url).pathname;
const repo = new URL('../../../../', import.meta.url).pathname;
const SEED = join(here, 'data/asks.jsonl');
const seedText = readFileSync(SEED, 'utf8');
const doc = bb.parseJsonl(seedText);
const NOW = Date.parse('2026-10-29T20:00:00-04:00');

// ---- manifest + web entry
t('plugin@1 manifest, lifecycle, model, menus', () => {
  const man = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'));
  assert.equal(man.id, 'ai.amberx.axf.console.build-breaker');
  assert.equal(man.lifecycle.$axf, 'plugin-lifecycle@1'); assert.equal(man.lifecycle.dataDir, '.axf-console/plugins/build-breaker');
  assert.deepEqual(man.builtWith, { model: 'opus', builtAt: '2026-10-29' });
  assert.equal(man.tabable.view, 'build-breaker');
  for (const f of ['install.mjs', 'uninstall.mjs', 'hooks.mjs', 'asks.mjs']) assert.ok(existsSync(join(here, f)), f);
  const web = readFileSync(join(here, 'web/index.tsx'), 'utf8');
  assert.match(web, /parent: 'plugins'/); assert.match(web, /PluginLifecyclePanel/); assert.match(web, /contextExtras\.set\('\*:build-breaker'/);
  const menu = readFileSync(join(here, 'web/menu.ts'), 'utf8'); assert.match(menu, /menu: 'builds'/); assert.match(menu, /nav:build-breaker/);
});

// ---- the data
t('seed loads: build-asks@1 header + every ask', () => {
  assert.equal(doc.$axf, 'build-asks@1'); assert.equal(doc.skipped, 0);
  assert.ok(doc.asks.length >= 390, `${doc.asks.length} asks`);
  assert.ok(doc.apps.length > 5 && doc.plugins.length > 5);
  assert.deepEqual(bb.checkDoc(doc), []);
});
t('every ask has an app the file knows, plugin asks a known plugin, a date and a known status', () => {
  const apps = new Set(doc.apps.map((a) => a.id)), plugins = new Set(doc.plugins.map((p) => p.id));
  for (const a of doc.asks) {
    assert.ok(apps.has(a.app), `${a.id}: app ${a.app}`);
    if (a.plugin) assert.ok(plugins.has(a.plugin), `${a.id}: plugin ${a.plugin}`);
    assert.ok(bb.askTime(a) > 0, `${a.id}: date`);
    assert.notEqual(bb.statusInfo(a.status).bucket, 'other', `${a.id}: status ${a.status}`);
    assert.ok(a.title.length <= 80, `${a.id}: title one line`);
  }
});
t('round trip keeps unknown fields', () => {
  const again = bb.parseJsonl(bb.toJsonl(doc));
  assert.deepEqual(again.asks, doc.asks); assert.deepEqual(again.gaps, doc.gaps); assert.deepEqual(again.sources, doc.sources);
  const odd = bb.parseJsonl(`${JSON.stringify({ $axf: 'build-asks@1', extra: 1, apps: [{ id: 'x', name: 'X', more: true }], plugins: [] })}\n${JSON.stringify({ id: 'a', app: 'x', title: 'A', askedAt: '2026-10-01T10:00:00Z', status: 'built', future: { y: 2 } })}\nnot json\n`);
  assert.equal(odd.extra, 1); assert.equal(odd.apps[0].more, true); assert.deepEqual(odd.asks[0].future, { y: 2 }); assert.equal(odd.skipped, 1);
  assert.equal(bb.parseAny(JSON.stringify({ ...doc })).asks.length, doc.asks.length);
});

// ---- filters, sort, group, totals
t('search matches title, plain text and his own words (every word)', () => {
  const quoted = doc.asks.find((a) => a.quote && a.quote.split(/\s+/).some((w) => w.length > 6 && !a.title.toLowerCase().includes(w.toLowerCase())));
  const word = quoted.quote.split(/\s+/).find((w) => w.length > 6 && !quoted.title.toLowerCase().includes(w.toLowerCase())).replace(/[^\p{L}\p{N}-]/gu, '');
  assert.ok(bb.filterAsks(doc.asks, { q: word }).some((a) => a.id === quoted.id));
  const r = bb.filterAsks(doc.asks, { q: 'feature matrix' });
  assert.ok(r.length > 0 && r.every((a) => bb.searchText(a).includes('feature') && bb.searchText(a).includes('matrix')));
  assert.equal(bb.filterAsks(doc.asks, { q: 'zzzz-no-such-thing' }).length, 0);
});
t('status (multi), model and date filters', () => {
  const two = bb.filterAsks(doc.asks, { statuses: ['pending', 'held'] });
  assert.ok(two.length > 0 && two.every((a) => ['pending', 'held'].includes(a.status)));
  assert.equal(two.length, doc.asks.filter((a) => a.status === 'pending' || a.status === 'held').length);
  const fable = bb.filterAsks(doc.asks, { models: ['fable'] });
  assert.ok(fable.length > 0 && fable.every((a) => bb.normModel(a.model) === 'Fable'));
  const week = bb.filterAsks(doc.asks, { range: '7' }, NOW);
  assert.ok(week.length > 0 && week.length < doc.asks.length && week.every((a) => bb.askTime(a) >= NOW - 7 * 86400000));
  assert.equal(bb.filterAsks(doc.asks, { range: 'all' }, NOW).length, doc.asks.length);
  const day = bb.filterAsks(doc.asks, { from: '2026-10-21', to: '2026-10-21' });
  assert.ok(day.length > 0 && day.every((a) => bb.dayKey(a) === '2026-10-21'));
});
t('sort: newest first by default, oldest, title, cost', () => {
  const s = bb.sortAsks(doc.asks);
  for (let i = 1; i < s.length; i++) assert.ok(bb.askTime(s[i - 1]) >= bb.askTime(s[i]));
  const o = bb.sortAsks(doc.asks, 'oldest'); assert.ok(bb.askTime(o[0]) <= bb.askTime(o[o.length - 1]));
  const ti = bb.sortAsks(doc.asks, 'title'); assert.ok(ti[0].title.localeCompare(ti[ti.length - 1].title) <= 0);
  const c = bb.sortAsks(doc.asks, 'cost'); assert.ok((c[0].costUsd ?? 0) >= (c[c.length - 1].costUsd ?? 0));
  assert.equal(bb.sortAsks(doc.asks, 'status').length, doc.asks.length);
});
t('group-by keeps every ask once; status groups in registry order', () => {
  for (const g of bb.GROUPS) { const gs = bb.groupAsks(doc.asks, g.id); assert.equal(gs.reduce((k, x) => k + x.asks.length, 0), doc.asks.length, g.id); }
  const st = bb.groupAsks(doc.asks, 'status').map((g) => g.id);
  assert.deepEqual(st, bb.STATUSES.map((s) => s.id).filter((id) => st.includes(id)));
});
t('totals add up (buckets, models, minutes, dollars)', () => {
  const tt = bb.totals(doc.asks);
  assert.equal(Object.values(tt.buckets).reduce((a, b) => a + b, 0), doc.asks.length);
  assert.equal(Object.values(tt.models).reduce((a, b) => a + b.asks, 0), doc.asks.length);
  assert.ok(Math.abs(Object.values(tt.models).reduce((a, b) => a + b.cost, 0) - tt.cost) < 0.01);
  assert.equal(tt.minutes, doc.asks.reduce((a, x) => a + (Number(x.minutes) || 0), 0));
  assert.equal(tt.buckets.built, doc.asks.filter((a) => a.status === 'built').length);
});
t('All tab: app grids (no plugin) + plugin grids show every ask exactly once', () => {
  const apps = bb.sections(doc, doc.asks.filter((a) => !a.plugin), 'app'), plugins = bb.sections(doc, doc.asks, 'plugin');
  const ids = [...apps, ...plugins].flatMap((s) => s.asks.map((a) => a.id));
  assert.equal(ids.length, doc.asks.length); assert.equal(new Set(ids).size, doc.asks.length);
  assert.equal(bb.sections(doc, doc.asks, 'app').reduce((k, s) => k + s.asks.length, 0), doc.asks.length);
});
t('refs, links and formatting', () => {
  assert.deepEqual(bb.refFor({ sources: ['chat:x', 'pending:abc', 'orchestrator:windows-terminal s9-s11'] }), { kind: 'orchestrator', id: 'windows-terminal' });
  assert.deepEqual(bb.refFor({ sources: ['hub-pending:push-banner'] }), { kind: 'pending', id: 'push-banner' });
  assert.deepEqual(bb.refFor({ sources: ['changes:chg-20261021-34507ed28e'] }), { kind: 'change', id: 'chg-20261021-34507ed28e' });
  assert.equal(bb.refFor({ sources: ['chat:x'] }), null);
  assert.ok(doc.asks.filter((a) => bb.refFor(a)).length > 100);
  assert.equal(bb.prUrl(170), 'https://github.com/MossesX/AmberX-AXF/pull/170'); assert.equal(bb.prUrl(null), '');
  assert.equal(bb.fmtMinutes(150), '2h 30m'); assert.equal(bb.fmtMinutes(45), '45m'); assert.equal(bb.fmtCost(8.4), '$8.40'); assert.equal(bb.fmtCost(1234.5, { whole: true }), '$1,235');
  assert.equal(bb.statusInfo('waiting-pull').icon, 'download'); assert.equal(bb.statusInfo('done').id, 'built');
});
t('merge: newer updatedAt wins, mirror-only asks kept, unknown fields kept', () => {
  const seed = { $axf: 'build-asks@1', apps: [{ id: 'x', name: 'X' }], plugins: [], asks: [{ id: 'a', status: 'pending', updatedAt: '2026-10-29T10:00:00Z' }, { id: 'b', status: 'planned' }] };
  const mirror = { $axf: 'build-asks@1', apps: [{ id: 'y', name: 'Y' }], plugins: [], asks: [{ id: 'a', status: 'built', updatedAt: '2026-10-29T09:00:00Z' }, { id: 'b', status: 'built', updatedAt: '2026-10-29T11:00:00Z', keep: 1 }, { id: 'c', status: 'pending' }] };
  const m = bb.mergeDocs(seed, mirror);
  assert.deepEqual(m.asks.map((a) => [a.id, a.status]), [['a', 'pending'], ['b', 'built'], ['c', 'pending']]);
  assert.equal(m.asks[1].keep, 1); assert.deepEqual(m.apps.map((a) => a.id), ['x', 'y']);
});

// ---- the CLI, on scratch copies
t('asks.mjs add | set-status | list | check on scratch copies; the repo seed is untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-test-'));
  const seed = join(dir, 'seed.jsonl'), mirror = join(dir, 'mirror', 'asks.jsonl');
  copyFileSync(SEED, seed);
  const env = { ...process.env, AXF_BUILD_BREAKER_SEED: seed, AXF_BUILD_BREAKER_MIRROR: mirror };
  const cli = (...a) => JSON.parse(execFileSync('node', [join(here, 'asks.mjs'), ...a, '--json'], { env, encoding: 'utf8' }).trim().split('\n').pop());
  const added = cli('add', '--title', 'Test ask from the self-test', '--app', 'console-web', '--minutes', '30', '--model', 'fable', '--quote', 'make it so');
  assert.ok(added.ok); assert.equal(added.ask.model, 'Fable'); assert.equal(added.ask.costUsd, 8.25); assert.equal(added.ask.status, 'pending');
  const set = cli('set-status', added.ask.id, 'waiting-push', '--branch', 'claude/x', '--pr', '9');
  assert.equal(set.ask.status, 'waiting-push'); assert.equal(set.ask.pr, 9);
  const list = cli('list', '--status', 'waiting-push');
  assert.ok(list.asks.some((a) => a.id === added.ask.id));
  assert.ok(cli('check').ok);
  assert.ok(existsSync(mirror));
  assert.equal(bb.parseJsonl(readFileSync(seed, 'utf8')).asks.length, doc.asks.length + 1);
  const bad = (() => { try { execFileSync('node', [join(here, 'asks.mjs'), 'add', '--title', 'x', '--app', 'nope', '--json'], { env, encoding: 'utf8', stdio: 'pipe' }); return null; } catch (e) { return JSON.parse(String(e.stdout).trim()); } })();
  assert.equal(bad?.ok, false); assert.match(bad.error, /unknown app/);
  assert.equal(readFileSync(SEED, 'utf8'), seedText);
});

// ---- the Build context submenu only lists things that exist
t('every Build menu entry opens a real view or action', () => {
  const src = readFileSync(join(here, 'web/buildMenu.ts'), 'utf8');
  const core = JSON.parse(src.match(/CORE_VIEWS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const actions = [...src.matchAll(/action: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(actions.length >= 13);
  const pluginsDir = join(repo, 'apps/console-web/plugins');
  const code = readdirSync(pluginsDir).filter((d) => !d.startsWith('_') && existsSync(join(pluginsDir, d, 'web'))).flatMap((d) => readdirSync(join(pluginsDir, d, 'web')).filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(join(pluginsDir, d, 'web', f), 'utf8'))).join('\n');
  for (const a of actions) {
    if (a.startsWith('nav:')) { const v = a.slice(4); assert.ok(core.includes(v) || new RegExp(`views: \\{[^}]*['"\\[]${v}['"\\]]|const VIEW = '${v}'`).test(code), `view ${v}`); }
    else assert.ok(code.includes(`rt.actions.register('${a}'`), `action ${a}`);
  }
});

console.log(`build-breaker: ${n} checks passed`);
