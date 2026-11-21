// Self-test: node apps/console-web/plugins/plan-studio-2/test.mjs
// plan-tree@1 core (nesting to any depth, moves at any level, cycles refused, duplicate, delete + undo in place, links,
// collapse, Markdown / JSON export + import, build hand-off, the voice parser), the CLI + store on a scratch folder
// (the repo, the hub and the original Plan Studio are never read or written), the manifest and the plugin's web part.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

// ---------------------------------------------------------------- hand builds (hand-build@1, no dispatcher)
{
  const hd = mkdtempSync(join(tmpdir(), 'ps2-hand-'));
  const repo = join(here, '../../../..');
  // a fake launcher: records what the store and the emergency grants held at the moment of launch, and the pool its
  // session would count in, then answers like deploy/claude-headless.sh
  const launcher = join(hd, 'launcher.sh');
  writeFileSync(launcher, `#!/usr/bin/env bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { emergencyIds, poolOf } from "${repo}/framework/cli/build-limit.mjs";
const store = JSON.parse(readFileSync(process.env.AXF_BUILDS_STORE, "utf8"));
const b = store.builds.find((x) => x.id === process.env.AXF_BUILD_ID);
writeFileSync("launch-seen.json", JSON.stringify({ args: process.argv.slice(1), recorded: !!b && b.mode === "hand" && b.hand.state === "launching", model: process.env.AXF_MODEL,
  token: !!process.env.AXF_DISPATCH_TOKEN, approver: process.env.AXF_APPROVER ?? "", pool: poolOf("axf-" + process.env.AXF_BUILD_ID + "--gina", emergencyIds()), brief: readFileSync(".brief.md", "utf8") }));
' -- "$@"
echo "started axf-$2--gina in $(pwd)"
`);
  chmodSync(launcher, 0o755);
  const base = { ...process.env, AXF_PLAN_TREE_DIR: hd, AXF_BUILDS_STORE: join(hd, 'store.json'), AXF_BUILDS_LIVE: '0', AXF_BUILD_HOOKS: 'off', AXF_BUILDS_EXPORT: '0',
    AXF_SLOTS_DIR: join(hd, 'slots'), AXF_DISPATCH_DIR: join(hd, 'dispatch'), AXF_HAND_WORKTREES: join(hd, 'wt'), AXF_HAND_WORKTREE_MODE: 'mkdir', AXF_HAND_LAUNCHER: launcher, AXF_HAND_LAUNCH: 'here' };
  for (const k of ['AXF_APPROVER', 'AXF_APPROVER_VIA', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'AXF_SURFACE', 'AXF_SESSION', 'AXF_BUILD_ID', 'AXF_DISPATCH_TOKEN']) delete base[k];
  const BRETT = { AXF_APPROVER: 'Brett', AXF_APPROVER_VIA: 'console' };
  const run = (extra, ...a) => { try { return { ok: true, out: JSON.parse(execFileSync('node', [join(here, 'tree.mjs'), ...a, '--json'], { env: { ...base, ...extra }, encoding: 'utf8' }).trim().split('\n').pop()) }; } catch (e) { if (!e.stdout) throw e; return { ok: false, out: JSON.parse(String(e.stdout).trim().split('\n').pop()) }; } };
  const store = () => (existsSync(join(hd, 'store.json')) ? JSON.parse(readFileSync(join(hd, 'store.json'), 'utf8')).builds : []);
  const grants = () => { try { return JSON.parse(readFileSync(join(hd, 'slots', 'build-limit-emergency.json'), 'utf8')).builds.map((g) => g.id); } catch { return []; } };
  run({}, 'add', 'plan', 'Hand lane', '--body', 'Top body: the whole job.');
  run({}, 'add', 'section', 'Part one', '--in', 'Hand lane', '--body', 'Section body.');
  run({}, 'add', 'step', 'Deep step', '--in', 'Part one', '--body', 'Nested body, two levels down.');
  run({}, 'add', 'step', 'Second step', '--in', 'Hand lane', '--body', 'Last body.');

  await t('hand build: console-only, refused before anything is written', () => {
    for (const [who, extra] of [['the console token / MCP / CLI', {}], ['a Claude session', { ...BRETT, CLAUDECODE: '1' }], ['an axHub approval', { AXF_APPROVER: 'Brett', AXF_APPROVER_VIA: 'axhub' }], ['a headless run', { ...BRETT, AXF_SURFACE: 'headless' }]]) {
      const r = run(extra, 'hand', 'Hand lane', '--model', 'Fable');
      assert.equal(r.ok, false, `${who} is refused`); assert.equal(r.out.code, 'forbidden', who);
    }
    assert.equal(store().length, 0, 'no build record'); assert.deepEqual(grants(), [], 'no emergency grant');
    const srv = readFileSync(join(here, 'server/__init__.py'), 'utf8');
    assert.match(srv, /@router\.post\("\/hand"\)[\s\S]{0,800}who = brett_click\(request\)\s+if not who:\s+raise HTTPException\(403, HAND_ONLY_BRETT\)/, 'POST /hand refuses everyone but Brett\'s signed-in click');
    assert.match(readFileSync(join(here, 'web/api.ts'), 'utf8'), /startHand = [^\n]*ownerPost<HandResult>\('hand'/, 'the page starts it with Brett\'s session, never the console token');
    assert.match(readFileSync(join(here, 'web/ui.tsx'), 'utf8'), /onClick=\{start\}><span>/, 'the Start button is no console-control target');
  });

  await t('hand build: the model is picked every time (no default, never Sonnet)', () => {
    for (const m of [[], ['--model', ''], ['--model', 'Sonnet'], ['--model', 'gpt']]) {
      const r = run(BRETT, 'hand', 'Hand lane', ...m);
      assert.equal(r.ok, false, `model ${JSON.stringify(m)} refused`); assert.equal(r.out.code, 'validation'); assert.match(r.out.error, /model/i);
    }
    assert.equal(store().length, 0, 'no record without a model');
    const srv = readFileSync(join(here, 'server/__init__.py'), 'utf8');
    assert.match(srv, /if not str\(body\.get\("model"\) or ""\)\.strip\(\):\s+raise HTTPException\(400/, 'the route refuses a missing model');
  });

  await t('hand build: record first (mode hand, emergency), then launch on the chosen model in one emergency slot', () => {
    const r = run(BRETT, 'hand', 'Hand lane', '--model', 'Fable', '--id', 'hand-lane');
    assert.equal(r.ok, true, JSON.stringify(r.out)); assert.equal(r.out.build.id, 'hand-lane'); assert.equal(r.out.launch.ok, true);
    const seen = JSON.parse(readFileSync(join(hd, 'wt', 'hand-lane', 'launch-seen.json'), 'utf8'));
    assert.equal(seen.recorded, true, 'the build record was in the store when the launcher ran');
    assert.equal(seen.pool, 'emergency', 'its session counts in the emergency slot pool');
    assert.equal(seen.token, true, 'it carries a one-build dispatch token, so the launch gate takes it');
    assert.equal(seen.approver, '', 'the session never inherits Brett\'s approver variables');
    assert.equal(seen.model, 'fable'); assert.ok(seen.args.includes('claude-fable-5-2'), 'launched on the chosen model');
    const b = store().find((x) => x.id === 'hand-lane');
    assert.equal(b.mode, 'hand'); assert.equal(b.status, 'running'); assert.equal(b.hand.model, 'Fable'); assert.equal(b.hand.by, 'Brett');
    assert.ok(b.hand.emergency?.at, 'signed as emergency'); assert.equal(b.hand.state, 'launched'); assert.equal(b.hand.session, 'axf-hand-lane--gina');
    assert.equal(b.branch, 'claude/hand-lane'); assert.ok(b.flow !== 'pipeline-2', 'never a Pipeline 2.0 build: the dispatcher never touches it');
    assert.deepEqual(b.steps.map((x) => x.model), ['Fable'], 'one step, pinned to the chosen model');
    assert.ok(grants().includes('hand-lane'), 'the emergency grant is on file');
    const item = run({}, 'show', 'Hand lane').out.item;
    assert.equal(b.planRef, item.id, 'linked to the plan item'); assert.ok(item.links.some((l) => l.type === 'build' && l.ref.endsWith(':hand-lane') && l.label.startsWith('Hand build: ')));
    const again = run(BRETT, 'hand', 'Hand lane', '--model', 'Opus');
    assert.equal(again.ok, false); assert.match(again.out.error, /already has an open hand build/);
    const st = run({}, 'hand-status', 'Hand lane').out;
    assert.equal(st.builds[0].live.state, 'launched'); assert.equal(st.builds[0].brief, undefined, 'readers never get the brief');
    assert.deepEqual(st.models.map((m) => m.name), ['Fable', 'Opus'], 'the picker offers the live model policy');
  });

  await t('hand build: the brief is the whole item, every nested child with its body, in order, plus the rules', () => {
    const brief = JSON.parse(readFileSync(join(hd, 'wt', 'hand-lane', 'launch-seen.json'), 'utf8')).brief;
    const at = (x) => { const i = brief.indexOf(x); assert.ok(i >= 0, `the brief has "${x}"`); return i; };
    const order = ['# Hand lane', 'Top body: the whole job.', '### Part one', 'Section body.', '#### Deep step', 'Nested body, two levels down.', '### Second step', 'Last body.', '## Rules'].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'in tree order');
    for (const r of ['Open a PR', 'CI must go green', 'Do not merge the PR yourself', 'Tests', 'Clean code']) at(r);
    at('builds-live.mjs link hand-lane --branch claude/hand-lane');
  });

  await t('hand build: emergency grants stay while it is open (the dispatcher\'s sync never takes it back)', async () => {
    const EB = await import('../../../../framework/cli/emergency-builds.mjs');
    const open = { id: 'x', mode: 'hand', status: 'running', hand: { emergency: { at: '2026-11-21T00:00:00Z', by: 'Brett' }, state: 'launched', live: { state: 'pr' } } };
    assert.equal(EB.isOpenHandEmergency(open), true);
    assert.equal(EB.isOpenHandEmergency({ ...open, hand: { ...open.hand, live: { state: 'merged' } } }), false, 'merged: the grant goes');
    assert.equal(EB.isOpenHandEmergency({ ...open, hand: { ...open.hand, state: 'failed' } }), false, 'a failed launch holds no slot');
    assert.equal(EB.isOpenHandEmergency({ ...open, mode: '' }), false);
    const HB = await import('../../../../framework/cli/hand-build.mjs');
    const b = { hand: { state: 'launched', session: 'axf-x--a', live: { state: 'launched' } } };
    assert.equal(HB.liveState(b, { alive: true }).state, 'building');
    assert.deepEqual([HB.liveState(b, { alive: true, pr: { number: 9, state: 'open', ci: 'red' } })].map((l) => [l.state, l.pr, l.ci])[0], ['pr', 9, 'red']);
    assert.equal(HB.liveState(b, { alive: false, pr: { number: 9, state: 'closed', merged: true, ci: 'green' } }).state, 'merged');
    assert.equal(HB.ciOf([{ status: 'completed', conclusion: 'success' }, { status: 'in_progress' }]), 'pending');
    assert.equal(HB.ciOf([{ status: 'completed', conclusion: 'failure' }]), 'red');
    assert.equal(HB.ciOf([{ status: 'completed', conclusion: 'success' }]), 'green');
  });
  rmSync(hd, { recursive: true, force: true });
}

console.log(`plan-studio-2: ${n} checks passed`);
