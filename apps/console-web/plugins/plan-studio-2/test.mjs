// Self-test: node apps/console-web/plugins/plan-studio-2/test.mjs
// plan-tree@1 core (nesting to any depth, moves at any level, cycles refused, duplicate, delete + undo in place, links,
// collapse, Markdown / JSON export + import, build hand-off, the voice parser), the CLI + store on a scratch folder
// (the repo, the hub and the original Plan Studio are never read or written), the manifest and the plugin's web part.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tc from './web/tree-core.mjs';
import * as lc from './web/layout-core.mjs';

let n = 0;
const t = async (name, fn) => { try { await fn(); n += 1; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const here = new URL('.', import.meta.url).pathname;

// ---------------------------------------------------------------- manifest + files
await t('plugin@1 manifest, lifecycle, commands, web part, never the old Plan Studio', () => {
  const m = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'));
  assert.equal(m.id, 'ai.amberx.axf.console.plan-studio-2');
  assert.equal(m.lifecycle.dataDir, '.axf-console/plugins/plan-studio-2');
  assert.deepEqual(m.targets, ['axf-console']);
  assert.equal(m.builtWith.model, 'fable');
  assert.ok(m.provides.includes('service:plan-tree@1') && m.provides.includes('view:plan-studio-2'));
  assert.equal(m.commands.$axf, 'plugin-commands@1');
  for (const f of ['install.mjs', 'uninstall.mjs', 'hooks.mjs', 'tree.mjs', 'help.json', 'server/__init__.py', 'web/index.tsx', 'web/ui.tsx', 'web/api.ts', 'web/menu.ts', 'web/voice.ts', 'web/tree-core.mjs', 'web/tree-core.d.mts', 'web/plan-studio-2.css']) assert.ok(existsSync(join(here, f)), f);
  const web = readFileSync(join(here, 'web/index.tsx'), 'utf8');
  assert.match(web, /parent: 'plugins'/); assert.match(web, /PluginLifecyclePanel/); assert.match(web, /plan-studio-2\.focus/);
  for (const a of ['new-inside', 'rename', 'duplicate', 'move', 'link', 'export', 'build', 'delete', 'undo']) assert.match(web, new RegExp(`plan-studio-2\\.${a}`), `context menu action ${a}`);
  assert.match(readFileSync(join(here, 'web/menu.ts'), 'utf8'), /nav:plan-studio-2/);
  // separate from the original Plan Studio: no file here reads its folder, its store or its plan@1 files
  for (const f of ['tree.mjs', 'hooks.mjs', ...readdirSync(join(here, 'web')).map((x) => `web/${x}`), 'server/__init__.py']) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.doesNotMatch(src, /plugins\/plan-studio\//, `${f} names the old Plan Studio folder`);
    assert.doesNotMatch(src, /plan-core\.mjs|plans\.mjs|plan@1/, `${f} reads the old plan files`);
  }
});

await t('Send to emergency: a Brett-only route, never a registered action or a console-control target', () => {
  const srv = readFileSync(join(here, 'server/__init__.py'), 'utf8');
  assert.match(srv, /@router\.post\("\/emergency"\)[\s\S]{0,700}who = brett_click\(request\)\s+if not who:\s+raise HTTPException\(403/, 'POST /emergency refuses everyone but Brett\'s signed-in click');
  assert.match(srv, /body\.pop\("emergency", None\)/, 'POST /build drops an emergency flag from the body');
  // the button's words sit in a <span>: only buttons with plain-text words become console-control targets (remote presses)
  assert.match(readFileSync(join(here, 'web/ui.tsx'), 'utf8'), /onClick=\{sendEmergency\}><span>\{armed \? 'Confirm: send to emergency' : 'Send to emergency'\}<\/span><\/Button>/);
  assert.doesNotMatch(readFileSync(join(here, 'web/index.tsx'), 'utf8'), /emergency/i, 'no action, menu entry or deep link sends to emergency');
  assert.match(readFileSync(join(here, 'tree.mjs'), 'utf8'), /if \(emergency && !preview\) \{ const o = ownerFrom\(env\); if \(!o\.ok\) throw new tc\.TreeError\('forbidden'/, 'the CLI checks who asks before it writes anything');
});

// ---------------------------------------------------------------- core
let s = tc.emptyState();
await t('starts empty; add at any depth; default child kinds', () => {
  assert.equal(s.items.length, 0);
  ({ state: s } = tc.add(s, { kind: 'plan', title: 'Launch' }));
  const plan = s.items[0];
  assert.equal(plan.kind, 'plan'); assert.equal(plan.status, 'draft'); assert.equal(plan.parent, null);
  let r = tc.add(s, { parent: 'Launch', title: 'Store' }); s = r.state; assert.equal(r.item.kind, 'section', 'a plan holds sections by default');
  r = tc.add(s, { parent: 'Store', title: 'Write copy', model: 'Opus', minutes: 20 }); s = r.state; assert.equal(r.item.kind, 'step');
  r = tc.add(s, { parent: 'Write copy', kind: 'list', title: 'Checklist' }); s = r.state;
  r = tc.add(s, { parent: 'Checklist', title: 'Phone shots' }); s = r.state; assert.equal(r.item.kind, 'item');
  r = tc.add(s, { parent: 'Phone shots', kind: 'note', title: 'Deep note' }); s = r.state; // any kind inside any kind
  assert.equal(tc.depthOf(s, r.item.id), 5);
  assert.equal(tc.pathOf(s, r.item.id), 'Launch › Store › Write copy › Checklist › Phone shots › Deep note');
  assert.equal(tc.tree(s)[0].children[0].children[0].children[0].children[0].children[0].title, 'Deep note');
  assert.deepEqual(tc.progress(s, tc.resolve(s, 'Launch').id), { done: 0, total: 2, minutes: 20 });
});

await t('resolve by id, exact title, words, "the step about …"', () => {
  assert.equal(tc.resolve(s, 'Write copy').title, 'Write copy');
  assert.equal(tc.resolve(s, 'the step about copy').title, 'Write copy');
  assert.equal(tc.resolve(s, s.items[0].id).title, 'Launch');
  assert.equal(tc.resolve(s, 'nothing like this'), null);
  assert.equal(tc.find(s, 'phone')[0].focus, `plan-studio-2.focus:${tc.resolve(s, 'Phone shots').id}`);
});

await t('edit, rename, done, validation', () => {
  let r = tc.rename(s, 'Write copy', 'Write the copy'); s = r.state; assert.equal(r.item.title, 'Write the copy');
  r = tc.edit(s, 'Write the copy', { done: true, priority: 'P1', tags: ['store', 'store', 'copy'] }); s = r.state;
  assert.equal(r.item.done, true); assert.deepEqual(r.item.tags, ['store', 'copy']);
  assert.equal(tc.progress(s, tc.resolve(s, 'Launch').id).done, 1);
  r = tc.edit(s, 'Write the copy', { done: true }); assert.equal(r.changed, false, 'no change = same state');
  assert.throws(() => tc.rename(s, 'Launch', '  '), /name is needed/);
  assert.throws(() => tc.edit(s, 'nope', { title: 'x' }), /no item/);
});

await t('move at any level, reorder, nudge, indent / outdent, never into itself', () => {
  let r = tc.add(s, { parent: 'Launch', kind: 'section', title: 'Pricing' }); s = r.state;
  r = tc.add(s, { parent: 'Launch', kind: 'note', title: 'Ideas' }); s = r.state;
  assert.deepEqual(tc.children(s, tc.resolve(s, 'Launch').id).map((c) => c.title), ['Store', 'Pricing', 'Ideas']);
  s = tc.nudge(s, 'Ideas', -1).state;
  assert.deepEqual(tc.children(s, tc.resolve(s, 'Launch').id).map((c) => c.title), ['Store', 'Ideas', 'Pricing']);
  s = tc.move(s, 'Ideas', { parent: null, index: 0 }).state;
  assert.deepEqual(tc.roots(s).map((c) => c.title), ['Ideas', 'Launch']);
  s = tc.indent(s, 'Launch').state; // into the sibling above (Ideas)
  assert.equal(tc.resolve(s, 'Launch').parent, tc.resolve(s, 'Ideas').id);
  s = tc.outdent(s, 'Launch').state;
  assert.equal(tc.resolve(s, 'Launch').parent, null);
  s = tc.move(s, 'Checklist', { parent: 'Pricing' }).state; // a deep branch moved across the tree
  assert.equal(tc.pathOf(s, tc.resolve(s, 'Deep note').id), 'Launch › Pricing › Checklist › Phone shots › Deep note');
  assert.throws(() => tc.move(s, 'Launch', { parent: 'Pricing' }), /inside itself/);
  assert.throws(() => tc.move(s, 'Launch', { parent: 'Launch' }), /inside itself/);
  s = tc.move(s, 'Ideas', { parent: 'Launch' }).state;
  assert.deepEqual(tc.roots(s).map((c) => c.title), ['Launch']);
});

await t('duplicate copies the whole branch with new ids', () => {
  const before = s.items.length;
  const r = tc.duplicate(s, 'Pricing'); s = r.state;
  assert.equal(r.item.title, 'Pricing (copy)'); assert.equal(r.count, 4); assert.equal(s.items.length, before + 4);
  assert.equal(new Set(s.items.map((i) => i.id)).size, s.items.length, 'every id unique');
  assert.equal(r.item.order, tc.resolve(s, 'Pricing').order + 1, 'right after the original');
  s = tc.remove(s, 'Pricing (copy)').state;
});

await t('delete = trash with the branch; undo puts it back in the same place', () => {
  const kids = tc.children(s, tc.resolve(s, 'Launch').id).map((c) => c.title);
  const idx = kids.indexOf('Ideas');
  const t0 = s.trash.length; // the duplicate test left one entry
  const r = tc.remove(s, 'Ideas'); s = r.state;
  assert.equal(r.removed, 1); assert.equal(tc.resolve(s, 'Ideas'), null); assert.equal(s.trash.length, t0 + 1);
  const r2 = tc.remove(s, 'Pricing'); s = r2.state; assert.equal(r2.removed, 4);
  assert.equal(tc.resolve(s, 'Deep note'), null);
  s = tc.undo(s).state; // newest first: Pricing
  assert.equal(tc.pathOf(s, tc.resolve(s, 'Deep note').id), 'Launch › Pricing › Checklist › Phone shots › Deep note');
  s = tc.undo(s, r.trashId).state;
  assert.deepEqual(tc.children(s, tc.resolve(s, 'Launch').id).map((c) => c.title)[idx], 'Ideas', 'back at its old index');
  assert.equal(s.trash.length, t0);
  s = tc.undo(s).state; // the duplicate's leftover
  assert.equal(s.trash.length, 0);
  assert.throws(() => tc.undo(s), /nothing to undo/);
  s = tc.remove(s, 'Pricing (copy)').state; s = { ...s, trash: [] };
});

await t('links are explicit (todo, build, note, shipped, plan, url) and never a sync', () => {
  let r = tc.link(s, 'Launch', { type: 'todo', ref: '42', label: 'Ship it' }); s = r.state; assert.equal(r.changed, true);
  r = tc.link(s, 'Launch', { type: 'todo', ref: '42' }); assert.equal(r.changed, false, 'same link twice = no change');
  s = tc.link(s, 'Launch', { type: 'shipped', ref: 'orchestrator-only-launcher' }).state;
  s = tc.link(s, 'Launch', { type: 'plan', ref: tc.resolve(s, 'Store').id }).state;
  assert.throws(() => tc.link(s, 'Launch', { type: 'plan', ref: 'missing-item' }), /no plan item/);
  assert.throws(() => tc.link(s, 'Launch', { type: 'wiki', ref: 'x' }), /needs a type/);
  assert.equal(tc.resolve(s, 'Launch').links.length, 3);
  r = tc.unlink(s, 'Launch', { type: 'shipped', ref: 'orchestrator-only-launcher' }); s = r.state; assert.equal(r.changed, true);
  assert.equal(tc.resolve(s, 'Launch').links.length, 2);
  assert.doesNotMatch(JSON.stringify(s), /sync/i);
});

await t('collapse one / all; flatten hides what is under a collapsed row', () => {
  s = tc.setCollapsed(s, [tc.resolve(s, 'Store').id], true).state;
  const rows = tc.flatten(s).map((r) => r.item.title);
  assert.ok(rows.includes('Store') && !rows.includes('Write the copy'));
  const all = tc.setCollapsed(s, null, true); s = all.state; assert.ok(all.changed >= 2);
  assert.deepEqual(tc.flatten(s).map((r) => r.item.title), ['Launch']);
  s = tc.setCollapsed(s, null, false).state;
  assert.ok(tc.flatten(s).length > 5);
});

await t('Markdown + JSON export, import under a parent with new ids', () => {
  const md = tc.toMarkdown(s);
  assert.match(md, /^# Launch/m); assert.match(md, /## Store/); assert.match(md, /- \[x\] Write the copy \(Opus, 20 min\)/); assert.match(md, /↳ todo: Ship it/);
  const one = tc.toMarkdown(s, 'Pricing'); assert.match(one, /^# Pricing/);
  const j = tc.toJson(s, 'Pricing');
  assert.equal(j.$axf, 'plan-tree-export@1'); assert.equal(j.items.length, 4);
  const r = tc.importItems(s, j, { parent: 'Store' }); s = r.state;
  assert.equal(r.imported, 4);
  const copies = s.items.filter((i) => i.title === 'Pricing'); assert.equal(copies.length, 2);
  assert.ok(copies.some((c) => c.parent === tc.resolve(s, 'Store').id));
  assert.equal(new Set(s.items.map((i) => i.id)).size, s.items.length);
  assert.throws(() => tc.importItems(s, [], {}), /nothing to import/);
});

await t('normalize: unknown parents become roots, cycles are broken, orders contiguous', () => {
  const raw = { items: [{ id: 'a', parent: 'b', kind: 'plan', title: 'A', order: 5 }, { id: 'b', parent: 'a', kind: 'section', title: 'B' }, { id: 'c', parent: 'zzz', kind: 'note', title: 'C' }, { id: 'a', title: 'dup' }] };
  const nz = tc.normalize(raw);
  assert.equal(nz.items.length, 3);
  assert.ok(nz.items.some((i) => i.parent === null && (i.id === 'a' || i.id === 'b')), 'the cycle is cut');
  assert.equal(nz.items.find((i) => i.id === 'c').parent, null);
  assert.deepEqual(tc.roots(nz).map((i) => i.order), tc.roots(nz).map((_, k) => k));
});

await t('toBuild: open steps at any depth become the planning steps; notes under it become the detail', () => {
  const b = tc.toBuild(s, 'Launch', { said: 'ship it' });
  assert.equal(b.action, 'add'); assert.equal(b.title, 'Launch'); assert.equal(b.source, 'plan-studio-2');
  assert.ok(b.steps.every((x) => x.text !== 'Write the copy'), 'done steps are left out');
  assert.equal(b.said, 'ship it');
  const none = tc.toBuild(s, 'Ideas'); assert.equal(none.steps.length, 0);
});

await t('voice: every spoken form parses to one command', () => {
  const p = tc.parseVoice;
  assert.deepEqual(p('New plan Launch AmberX'), { op: 'add', kind: 'plan', title: 'Launch AmberX', parent: null });
  assert.deepEqual(p('add a step called Deploy to the Store'), { op: 'add', kind: 'step', title: 'Deploy', parent: 'Store' });
  assert.deepEqual(p('add a note Pricing under Launch'), { op: 'add', kind: 'note', title: 'Pricing', parent: 'Launch' });
  assert.deepEqual(p('rename Deploy to Ship it.'), { op: 'rename', id: 'Deploy', title: 'Ship it' });
  assert.deepEqual(p('delete the Pricing note'), { op: 'delete', id: 'the Pricing note' });
  assert.deepEqual(p('undo that'), { op: 'undo' });
  assert.deepEqual(p('duplicate Store'), { op: 'duplicate', id: 'Store' });
  assert.deepEqual(p('mark Deploy as done'), { op: 'edit', id: 'Deploy', patch: { done: true } });
  assert.deepEqual(p('tick off Deploy'), { op: 'edit', id: 'Deploy', patch: { done: true } });
  assert.deepEqual(p('mark Deploy not done'), { op: 'edit', id: 'Deploy', patch: { done: false } });
  assert.deepEqual(p('move Deploy up'), { op: 'nudge', id: 'Deploy', delta: -1 });
  assert.deepEqual(p('move Deploy into Pricing'), { op: 'move', id: 'Deploy', parent: 'Pricing' });
  assert.deepEqual(p('move Deploy to the top level'), { op: 'move', id: 'Deploy', parent: null });
  assert.deepEqual(p('send Launch to the build orchestrator'), { op: 'send-to-build', id: 'Launch' });
  assert.deepEqual(p('collapse all'), { op: 'collapse', all: true, collapsed: true });
  assert.deepEqual(p('expand Store'), { op: 'collapse', id: 'Store', collapsed: false });
  assert.deepEqual(p('find phone shots'), { op: 'find', q: 'phone shots' });
  assert.deepEqual(p('open Launch'), { op: 'open', id: 'Launch' });
  assert.deepEqual(p('export Store'), { op: 'export', id: 'Store', format: 'md' });
  assert.equal(p('what is the weather'), null);
});

// ---------------------------------------------------------------- CLI + store on a scratch folder
const dir = mkdtempSync(join(tmpdir(), 'ps2-'));
const env = { ...process.env, AXF_PLAN_TREE_DIR: dir, AXF_BUILDS_STORE: join(dir, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0' };
const cli = (...a) => execFileSync('node', [join(here, 'tree.mjs'), ...a], { env, encoding: 'utf8' }).trim();
const cliJson = (...a) => JSON.parse(cli(...a, '--json'));
const cliFails = (...a) => { try { cli(...a); throw new Error('expected a refusal'); } catch (e) { if (!e.stdout) throw e; return JSON.parse(String(e.stdout).trim().split('\n').pop()); } };
await t('CLI: empty store, add / say / find / build / undo / export / clear; the hub and repo untouched', () => {
  assert.equal(cli('where'), dir);
  assert.match(cli('tree'), /empty/);
  cli('add', 'plan', 'Launch', '--priority', 'P1');
  cli('add', 'plan', 'Empty');
  const bad = cliFails('validate', 'Empty', '--json'); assert.equal(bad.ok, false); assert.ok(bad.errors.some((e) => /nothing to build/.test(e.why)), 'plan-build@1: a plan with no steps and no body is refused');
  assert.throws(() => cli('build', 'Empty'), /does not pass plan-build@1/);
  cli('delete', 'Empty');
  cli('add', 'step', 'Deploy', '--in', 'Launch', '--model', 'Opus', '--minutes', '30');
  cli('add', 'step', 'Long and unestimated', '--in', 'Launch');
  const good = cliJson('validate', 'Launch'); assert.equal(good.ok, true, `planning steps need no minutes or model: ${JSON.stringify(good.errors)}`);
  assert.deepEqual(good.plan.steps.map((x) => [x.model ?? '', x.minutes ?? 0]), [['Opus', 30], ['', 0]], 'hints go along only when set');
  cli('delete', 'Long and unestimated');
  assert.equal(cliJson('say', 'add a step Test it to Launch').understood, true);
  assert.equal(cliJson('say', 'mark Test it done').item.done, true);
  assert.match(cli('find', 'deploy'), /plan-studio-2\.focus:/);
  const st = JSON.parse(readFileSync(join(dir, 'tree.json'), 'utf8'));
  assert.equal(st.$axf, 'plan-tree@1'); assert.equal(st.items.length, 3);
  const pv = cliJson('build', 'Launch', '--preview'); assert.equal(pv.preview, true); assert.equal(pv.change.steps.length, 1); assert.equal(pv.planning, 1);
  const b = cliJson('build', 'Launch', '--said', 'ship it'); assert.equal(b.build.id, 'launch'); assert.equal(b.planning, 1);
  const orch = JSON.parse(readFileSync(join(dir, 'store.json'), 'utf8'));
  const sent = orch.builds.find((x) => x.id === 'launch');
  assert.equal(sent.source, 'plan-studio-2'); assert.equal(sent.origin.said, 'ship it');
  assert.equal(sent.flow, 'pipeline-2'); assert.equal(sent.status, 'pending'); assert.ok(sent.statusAt && sent.statusBy, 'pipeline-2@1: at / by recorded');
  assert.equal(sent.steps.length, 0, 'one build, no build steps: the splitting stage designs them');
  assert.deepEqual(sent.planning, [{ text: 'Deploy', model: 'Opus', minutes: 30 }], 'the plan steps are kept as planning context');
  assert.ok(cliJson('show', 'Launch').item.links.some((l) => l.type === 'build' && l.ref.endsWith(':launch')));
  assert.throws(() => cli('build', 'Launch', '--id', 'launch'), /already a build/);
  assert.throws(() => cli('build', 'Launch', '--id', 'launch-again'), /already sent as launch/, 'no second build while the first is pending or active');
  const del = cliJson('delete', 'Deploy'); assert.equal(del.removed, 1);
  assert.match(cli('trash'), /Deploy/);
  assert.equal(cliJson('undo').item.title, 'Deploy');
  assert.match(cli('export', 'Launch'), /^# Launch/);
  assert.equal(JSON.parse(cli('export', '--json')).$axf, 'plan-tree-export@1');
  assert.equal(cliJson('api', JSON.stringify({ op: 'state' })).count, 3);
  assert.equal(cliJson('api', JSON.stringify({ op: 'get', id: 'Launch' })).children.length, 2);
  assert.throws(() => cli('clear'), /--yes/);
  assert.deepEqual(cliFails('api', JSON.stringify({ op: 'clear' })), { ok: false, error: 'clearing everything needs confirm: true', code: 'confirm' });
  cli('clear', '--yes');
  assert.match(cli('tree'), /empty/);
  assert.deepEqual(JSON.parse(cli('api', JSON.stringify({ op: 'say', text: 'what is the weather' }))).understood, false);
  assert.ok(!existsSync(join(dir, 'plans')), 'no plan@1 files are ever made');
});
rmSync(dir, { recursive: true, force: true });

// ---------------------------------------------------------------- page layouts + IDE dock (same dock-layout@1 assets)
await t('page layouts: open registry, words resolve, nav is the default', () => {
  assert.deepEqual(lc.layouts().map((l) => l.id), ['nav', 'tabs', 'ide']);
  assert.equal(lc.resolveLayout('').id, 'nav');
  assert.equal(lc.resolveLayout('IDE style').id, 'ide');
  assert.equal(lc.resolveLayout('tab group across the top').id, 'tabs');
  assert.equal(lc.resolveLayout('nav menu').id, 'nav');
  assert.equal(lc.resolveLayout('something else'), null);
  const off = lc.registerLayout({ id: 'reader', label: 'Reader', icon: 'file', kind: 'tabs' });
  assert.equal(lc.resolveLayout('reader').id, 'reader');
  off();
  assert.equal(lc.layouts().length, 3);
  assert.throws(() => lc.registerLayout({ id: 'x', kind: 'grid' }));
  assert.deepEqual(lc.SECTION_IDS, ['tree', 'editor', 'say', 'trash']);
  assert.equal(lc.resolveSection('Trash'), 'trash'); assert.equal(lc.resolveSection('nope'), null);
});
{
  const SEC = lc.SECTION_IDS;
  const assets = join(here, '../../../../framework/assets/dock-layout');
  const all = (d) => [...Object.values(d.panes).flatMap((p) => p.tabs), ...d.closed].sort();
  await t('IDE dock: every framework dock-layout asset spreads the sections over its panes, once each', () => {
    const files = readdirSync(assets).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 10, 'the framework ships its ten dock-layout starters');
    for (const f of files) {
      const d = lc.fromPreset(JSON.parse(readFileSync(join(assets, f), 'utf8')).data, SEC);
      assert.deepEqual(all(d), [...SEC].sort(), f);
      for (const p of Object.values(d.panes)) assert.ok(p.tabs.includes(p.active), f);
    }
    assert.deepEqual(lc.normalizeDock({ garbage: true }, SEC).panes.p1.tabs, SEC, 'junk in the saved setting heals');
    assert.equal(lc.paneIds(lc.fromPreset(lc.FALLBACK_PRESET, SEC).tree).length, 2);
  });
  await t('IDE dock: drag between panes, drop into a tab group, split on an edge, close, reopen, resize', () => {
    let d = lc.fromPreset(lc.FALLBACK_PRESET, SEC);
    const [a, b] = lc.paneIds(d.tree);
    d = lc.moveTab(d, 'tree', b, 0, SEC);
    assert.equal(lc.paneOf(d, 'tree'), b); assert.equal(d.panes[b].active, 'tree');
    d = lc.applyDrop(d, 'say', b, 'centre', SEC); assert.equal(lc.paneOf(d, 'say'), b, 'centre joins the tab group');
    d = lc.reorder(d, b, ['say', 'tree'], SEC); assert.deepEqual(d.panes[b].tabs.slice(0, 2), ['say', 'tree']);
    d = lc.applyDrop(d, 'trash', a, 'bottom', SEC);
    assert.equal(lc.paneIds(d.tree).length, 3, 'an edge drop splits');
    const c = lc.paneOf(d, 'trash'); assert.deepEqual(d.panes[c].tabs, ['trash']); assert.ok(d.tree.children.some((x) => x.kind === 'split' && x.vertical));
    d = lc.closePane(d, c, SEC); assert.deepEqual(d.closed, ['trash']);
    d = lc.runDockOp(d, 'reopen', ['Trash'], SEC); assert.deepEqual(d.closed, []);
    d = lc.runDockOp(d, 'close', ['trash'], SEC); assert.deepEqual(d.closed, ['trash']);
    d = lc.runDockOp(d, 'show', ['trash'], SEC); assert.ok(!d.closed.includes('trash'), 'show reopens a closed section');
    assert.deepEqual(all(d), [...SEC].sort(), 'never loses or doubles a section');
    const w = d.tree.weights.slice(); d = lc.resize(d, [], 0, 0.2); assert.ok(d.tree.weights[0] > w[0]);
    assert.throws(() => lc.runDockOp(d, 'bogus', [], SEC), /Dock ops/);
    const one = lc.fromPreset({ panes: 1, tree: { kind: 'leaf', pane: 1 } }, ['tree']);
    assert.equal(lc.closeTab(one, 'tree', ['tree']), one, 'the last open section stays');
    assert.equal(lc.dropZone(0.05, 0.5, false), 'left'); assert.equal(lc.dropZone(0.5, 0.5, false), 'centre'); assert.equal(lc.dropZone(0.5, 0.5, true), 'header');
  });
}

// ---------------------------------------------------------------- hand builds (hand-build.mjs): no dispatcher, no slot, 2 at once
{
  const hd = mkdtempSync(join(tmpdir(), 'ps2-hand-'));
  const keep = {};
  const scratch = { AXF_BUILDS_STORE: join(hd, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0', AXF_PLAN_TREE_DIR: hd };
  for (const [k, v] of Object.entries(scratch)) { keep[k] = process.env[k]; process.env[k] = v; }
  const hand = await import('./hand-build.mjs');
  const BS = await import('../../../../framework/cli/builds-store.mjs');
  const gate = await import('../../../../framework/cli/dispatch-gate.mjs');
  const mg = await import('../../../../framework/cli/model-gate.mjs');
  // Brett's own click: what the console server sets for his signed-in session, and nothing that marks a session or agent
  const brett = { AXF_APPROVER: 'Brett', AXF_APPROVER_VIA: 'console', AXF_DISPATCH_DIR: join(hd, 'dispatch'), AXF_PIPELINE_WORKTREES: join(hd, 'wt'), AXF_HAND_TMUX: 'off', HOME: hd };
  const wt = (id) => { const dir = join(hd, 'wt', id); mkdirSync(dir, { recursive: true }); return { dir, repo: hd }; };
  const ok = (seen = []) => (o) => { seen.push(o); return { status: 0, out: `started axf-${o.env.AXF_BUILD_ID} in ${o.dir}` }; };
  const builds = () => BS.loadStore().builds;

  let st = tc.emptyState();
  let r = tc.add(st, { kind: 'plan', title: 'Hand lane', body: 'Build the lane.' }); st = r.state; const plan = r.item.id;
  r = tc.add(st, { parent: plan, kind: 'step', title: 'Button', body: 'A button on every item.' }); st = r.state; const step = r.item.id;
  r = tc.add(st, { parent: step, kind: 'note', title: 'Deep note', body: 'Nested body, two levels down.' }); st = r.state;
  r = tc.add(st, { parent: plan, kind: 'step', title: 'Cap', body: 'At most two at once.' }); st = r.state;

  await t('hand build: Brett\'s signed-in console only; nothing is written for anyone else', () => {
    for (const env of [{ ...brett, AXF_APPROVER: '' }, { ...brett, AXF_APPROVER_VIA: 'token' }, { ...brett, CLAUDECODE: '1' }, { ...brett, AXF_SESSION: 'amber' }, { ...brett, AXF_SURFACE: 'headless' }]) {
      assert.throws(() => hand.launchHand(st, plan, { model: 'fable', env, sessions: [], worktree: wt, spawn: ok() }), (e) => e.code === 'forbidden' && /Only Brett/.test(e.message));
    }
    assert.equal(builds().length, 0, 'a refused ask writes no record');
    const srv = readFileSync(join(here, 'server/__init__.py'), 'utf8');
    assert.match(srv, /@router\.post\("\/hand-build"\)[\s\S]{0,700}who = brett_click\(request\)\s+if not who:\s+raise HTTPException\(403/, 'POST /hand-build refuses everyone but Brett\'s signed-in click (MCP and the CLI go through the same route)');
    assert.match(readFileSync(join(here, 'web/ui.tsx'), 'utf8'), /onClick=\{start\}><span>Start hand build<\/span><\/Button>/, 'the start button is no console-control target');
    const m = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'));
    assert.ok(['hand-build', 'hand-builds', 'hand-log'].every((id) => m.commands.items.some((c) => c.id === id)), 'REST / MCP / CLI commands for the lane');
    const refused = cliFails('api', JSON.stringify({ op: 'hand-build', id: plan, model: 'fable' }));
    assert.equal(refused.code, 'forbidden', 'the CLI (Amber\'s path) is refused the same way');
  });

  await t('hand build: the model is picked every time from the live policy, no default', () => {
    assert.deepEqual(hand.handModels().map((x) => x.value), ['fable', 'opus']);
    for (const model of ['', undefined, 'sonnet', 'haiku', 'gpt']) assert.throws(() => hand.launchHand(st, plan, { model, env: brett, sessions: [], worktree: wt, spawn: ok() }), (e) => e.code === 'model');
    assert.equal(builds().length, 0, 'no model, no record');
  });

  let first = '';
  await t('hand build: the record is written (mode hand, signed, linked) before the launcher runs', () => {
    const seen = [];
    const spawn = (o) => {
      const b = builds().find((x) => x.id === o.env.AXF_BUILD_ID);
      assert.ok(b, 'the record exists when the launcher starts');
      assert.equal(b.source, 'hand'); assert.equal(b.status, 'running'); assert.equal(b.planRef, plan); assert.equal(b.pipeline.model, 'fable'); assert.equal(b.branch, `claude/${b.id}`);
      assert.equal(b.steps.length, 0, 'no split');
      // every launcher gate accepts it: the dispatch token is this build's, the model gate passes it
      assert.equal(gate.check({ build: b.id, name: b.id, token: o.env.AXF_DISPATCH_TOKEN, env: o.env }).ok, true, 'dispatch gate');
      assert.equal(mg.launchCheck(b, o.env.AXF_MODEL).ok, true, 'model gate');
      assert.ok(!o.env.AXF_APPROVER, 'the session never inherits Brett\'s click');
      return ok(seen)(o);
    };
    const res = hand.launchHand(st, plan, { model: 'Fable', env: brett, sessions: [], worktree: wt, spawn });
    first = res.build.id;
    assert.equal(res.ok, true); assert.equal(res.session, `axf-${first}`); assert.equal(res.model, 'fable');
    assert.ok(seen[0].args.includes('claude-fable-5-2'), 'launched on the chosen model');
    assert.ok(tc.byId(res.state, plan).links.some((l) => l.type === 'build' && l.ref.endsWith(`:${first}`)), 'the item links to the build');
    assert.ok(builds().find((b) => b.id === first).notes.some((x) => /launched: axf-/.test(x.text)));
  });

  await t('hand build: the brief is the whole item, nested bodies in order, plus the rules', () => {
    const brief = readFileSync(join(hd, 'wt', first, '.axf-brief.md'), 'utf8');
    const at = (x) => { const i = brief.indexOf(x); assert.ok(i >= 0, `brief has "${x}"`); return i; };
    assert.ok(at('# Hand build: Hand lane') < at('Build the lane.'));
    assert.ok(at('Build the lane.') < at('1. Step: Button') && at('1. Step: Button') < at('A button on every item.'));
    assert.ok(at('A button on every item.') < at('1.1. Note: Deep note') && at('1.1. Note: Deep note') < at('Nested body, two levels down.'));
    assert.ok(at('Nested body, two levels down.') < at('2. Step: Cap') && at('2. Step: Cap') < at('At most two at once.'));
    for (const rule of ['open a PR', 'CI must go green', 'Never merge the PR yourself', 'Tests for what you change', 'Clean code']) assert.match(brief, new RegExp(rule));
  });

  await t('hand build: launches with every slot busy and past the host limit (no slot, no queue)', () => {
    BS.withStore((s) => { for (let i = 0; i < 8; i++) s.builds.push({ id: `busy-${i}`, title: `Busy ${i}`, status: 'running', steps: [], pipeline: { account: 'a', session: `axf-busy-${i}`, slot: `hl-${i}` } }); return s; }, { by: 'test' });
    const seen = [];
    const sessions = [...Array.from({ length: 8 }, (_, i) => `axf-busy-${i}`), `axf-${first}`];
    const res = hand.launchHand(st, step, { model: 'opus', env: brett, sessions, worktree: wt, spawn: ok(seen) });
    assert.equal(res.ok, true);
    assert.equal(seen[0].env.AXF_SLOTS, 'off', 'never an orchestrator or emergency slot');
    assert.equal(seen[0].env.AXF_BUILD_LIMIT, 'off', 'past the host build limit');
    assert.ok(seen[0].args.includes('claude-opus-5-5'));
  });

  await t('hand build: a third is refused while two run, naming the two; an ended one frees its place', () => {
    const two = builds().filter((b) => b.source === 'hand').map((b) => b.id);
    assert.equal(two.length, 2);
    const sessions = two.map((id) => `axf-${id}--amber`);
    const before = builds().length;
    assert.throws(() => hand.launchHand(st, plan, { model: 'fable', env: brett, sessions, worktree: wt, spawn: ok() }), (e) => e.code === 'cap' && two.every((id) => e.message.includes(id)) && /2/.test(e.message));
    assert.equal(builds().length, before, 'no third record');
    // records alone count while tmux can't be asked; a session gone after the run ended does not
    assert.equal(hand.runningHand(builds(), { sessions: null }).length, 2);
    BS.withStore((s) => { const b = s.builds.find((x) => x.id === two[0]); b.pipeline = { ...b.pipeline, runEnd: { at: new Date().toISOString(), exit: 0, kind: 'phase-done' } }; return s; }, { by: 'test' });
    assert.deepEqual(hand.runningHand(builds(), { sessions: [`axf-${two[1]}`] }).map((x) => x.id), [two[1]]);
    assert.equal(hand.launchHand(st, plan, { model: 'fable', buildId: 'hand-third', env: brett, sessions: [`axf-${two[1]}`], worktree: wt, spawn: ok() }).build.id, 'hand-third');
  });

  await t('hand build: a failed launch keeps the record (failed) and says why; status on the item', () => {
    const spawn = () => ({ status: 3, out: 'claude-headless: refused: something' });
    // an hour on, the records with no tmux session behind them are past their startup grace and no longer count
    const later = () => new Date(Date.now() + 3600e3).toISOString();
    assert.throws(() => hand.launchHand(st, step, { model: 'opus', buildId: 'hand-broken', env: brett, sessions: [], worktree: wt, spawn, now: later }), (e) => e.code === 'launch' && /refused: something/.test(e.message) && !!e.state);
    assert.equal(builds().find((b) => b.id === 'hand-broken').status, 'failed');
    const b = { id: 'x', title: 'X', source: 'hand', status: 'running', pipeline: { model: 'fable', launchedAt: new Date().toISOString() } };
    assert.equal(hand.handStatus(b, { sessions: [] }).state, 'launched');
    assert.equal(hand.handStatus(b, { sessions: ['axf-x--amber'] }).state, 'building');
    assert.equal(hand.handStatus({ ...b, pr: '#12345' }, { sessions: [], repo: 'o/r' }).prUrl, 'https://github.com/o/r/pull/12345');
    assert.equal(hand.handStatus({ ...b, pr: '#12345', landed: { ci: 'success' } }).label, 'PR #12345 · CI green');
    assert.equal(hand.handStatus({ ...b, pr: '#12345', landed: { ci: 'failure' } }).state, 'ci-red');
    assert.equal(hand.handStatus({ ...b, pr: '#12345', mergedAt: '2026-11-21T10:00:00Z' }).state, 'merged');
    assert.equal(hand.handStatus({ ...b, pipeline: { ...b.pipeline, runEnd: { exit: 1 } } }, { sessions: [] }).label, 'Ended (exit 1)');
    assert.equal(hand.listHand({ sessions: [], repo: '' }).builds.length, 4);
  });

  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(hd, { recursive: true, force: true });
}

console.log(`plan-studio-2: ${n} checks passed`);
