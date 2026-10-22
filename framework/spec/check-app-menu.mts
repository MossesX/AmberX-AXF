/**
 * Self-test for the app-menu engine on the web port (CI: npx -y tsx framework/spec/check-app-menu.mts).
 * Replays spec/fixtures/app-menu.json through the reference engine (a port's conformance test replays the same file), checks the CLI validator (build-engine.mjs) gives the same menu-item errors as core/validate.ts, and exercises
 * the runtime's contribution + live-list API (add / replace / remove per module, providers sync + async, the built-in
 * providers, search entries, conflict diagnostics, slot.hide:…:toggle) which fixtures can't cover.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSET_ORIGIN, CHECKED_KINDS, DEFAULT_MENU, MENU_DEFAULT_ORDER, MENU_ITEM_FIELDS, MENU_MAX_DEPTH, PROVIDER_MAX,
  appMenuSearchEntries, buildAppMenu, chromeToggleItems, chromeToggleTypes, compileAppMenu, compileProviderItems, mergeAppMenu,
  parseChecked, resolveChecked, titleFromId, truthy, validateMenuItems, type AppMenuEnv,
} from '../core/engines/appmenu';
import { gateFor, resolvePermissions } from '../core/engines/uac';
import { validateAsset } from '../core/validate';
import { AxfRuntime } from '../core/runtime';

const root = new URL('../', import.meta.url).pathname;
const read = (f: string) => JSON.parse(readFileSync(join(root, 'spec/fixtures', f), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };
const f = read('app-menu.json');

// constants + pure helpers
{
  eq({ maxDepth: MENU_MAX_DEPTH, providerMax: PROVIDER_MAX, defaultOrder: MENU_DEFAULT_ORDER, checkedKinds: [...CHECKED_KINDS], itemFields: [...MENU_ITEM_FIELDS], defaultMenu: DEFAULT_MENU, assetOrigin: ASSET_ORIGIN }, f.spec, 'spec constants');
  for (const [id, t] of Object.entries<string>(f.titles)) eq(titleFromId(id), t, `title ${JSON.stringify(id)}`);
  for (const [v, t] of Object.entries<boolean>(f.truthy)) eq(truthy(JSON.parse(v)), t, `truthy ${v}`);
  for (const [b, c] of Object.entries<any>(f.checked)) {
    eq(parseChecked(b), c.parsed, `parse ${JSON.stringify(b)}`);
    eq(resolveChecked(b, { counter: (n) => (n === 'c' ? 2 : 0), setting: (k) => (k === 'a' ? 'yes' : undefined), hidden: (t) => t === 'toolbar' }), c.resolved, `resolve ${JSON.stringify(b)}`);
  }
}

// merge + compile
const standard = JSON.parse(readFileSync(join(root, 'assets/uac-policy/standard.json'), 'utf8')).data;
const developer = JSON.parse(readFileSync(join(root, 'assets/app-menu/developer.json'), 'utf8')).data;
const envFor = (role: string, hidden: string[] = ['toolbar'], settings: Record<string, unknown> = { 'builds.auto': 'true' }, counters: Record<string, number> = { 'builds.pending': 3, 'alerts.unread': 0, 'about.seen': 1 }, policy = standard): AppMenuEnv => {
  const granted = resolvePermissions(policy, role);
  return { gate: (r) => gateFor(policy, granted, r), counter: (n) => counters[n] ?? 0, setting: (k) => settings[k], hidden: (t) => hidden.includes(t), providers: ['features', 'recent'] };
};
{
  const merged = mergeAppMenu(f.asset, f.contributions);
  eq(merged, f.merged, 'merged tree');
  for (const [role, c] of Object.entries(f.compiled)) eq(compileAppMenu(merged, envFor(role)), c, `compiled ${role}`);
  eq(compileAppMenu(merged, envFor('admin', [], { 'builds.auto': 'off' })), f.compiledShown, 'compiled with the toolbar shown + setting off');
  for (const [role, c] of Object.entries(f.compiledHideGate)) eq(compileAppMenu(merged, envFor(role, ['toolbar'], { 'builds.auto': 'true' }, { 'builds.pending': 3, 'alerts.unread': 0, 'about.seen': 1 }, { ...standard, gating: 'hide' })), c, `compiled hide-gating ${role}`);
  eq(compileAppMenu(merged, { ...envFor('admin'), maxDepth: 2 }), f.compiledDepth2, 'depth cap 2');
  for (const [role, c] of Object.entries(f.developer)) eq(buildAppMenu(developer, [], envFor(role, [])), c, `developer asset ${role}`);
  // merge is pure and order-independent of calls: the same inputs give the same output twice
  eq(mergeAppMenu(f.asset, f.contributions), merged, 'merge is deterministic');
  // the asset isn't mutated by merging
  eq(f.asset, read('app-menu.json').asset, 'asset untouched');
}

// live lists
{
  const items = [
    { id: 'f1', label: 'Feature 1', action: 'nav:f1' }, { id: 'f2', label: 'Feature 2', action: 'nav:f2', requires: 'uac.manage' }, { id: 'f3', label: 'Feature 3', action: 'nav:f3' },
    { id: 'f4', label: 'Feature 4', action: 'nav:f4', badge: 'builds.pending' }, { id: 'f5', label: 'Feature 5', action: 'nav:f5' }, { id: 'sep', separator: true }, { id: 'f6', label: 'Feature 6', action: 'nav:f6' },
  ];
  eq(compileProviderItems(items, envFor('admin'), { id: 'features', max: 3, moreAction: 'nav:features' }), f.providers['cap-3-more-action'], 'provider cap + More… action');
  eq(compileProviderItems(items, envFor('admin'), { id: 'features', max: 3 }), f.providers['cap-3-no-action'], 'provider cap, no action');
  eq(compileProviderItems(items, envFor('guest'), { id: 'features', max: 12 }), f.providers['fits-guest'], 'provider fits (guest)');
  eq(compileProviderItems(items.slice(0, 3), envFor('admin'), { id: 'features', max: 3 }), f.providers['fits-exactly'], 'provider fits exactly');
}

// chrome toggles + search entries
{
  eq(chromeToggleTypes(), f.chrome.types, 'chrome toggle types');
  eq(chromeToggleTypes(true), f.chrome.all, 'chrome toggle types (all)');
  eq(chromeToggleItems(), f.chrome.items, 'chrome toggle items');
  eq(chromeToggleItems(['toolbar', 'color-theme', 'nav-menu'], { toolbar: 'Top toolbar' }), f.chrome.labelled, 'chrome toggle items (labelled)');
  eq(appMenuSearchEntries(compileAppMenu(mergeAppMenu(f.asset, f.contributions), envFor('admin')), new Set(['file.first'])), f.search.entries, 'search entries');
}

// validation: core and CLI agree on every case
{
  const cli = await import('../cli/build-engine.mjs') as { validateAsset: (raw: unknown) => { ok: boolean; errors: string[] }; validateMenuItems: (items: unknown, path: string) => string[] };
  for (const c of f.validation) {
    eq(validateMenuItems(c.items, 'data.menus[0].items'), c.errors, `validate items ${c.case} (core)`);
    eq(cli.validateMenuItems(c.items, 'data.menus[0].items'), c.errors, `validate items ${c.case} (cli)`);
  }
  for (const c of f.assets) {
    eq(validateAsset(c.raw), c.result, `validate ${c.case} (core)`);
    eq(cli.validateAsset(c.raw), c.result, `validate ${c.case} (cli)`);
  }
  // every starter asset still validates with the new rules
  for (const t of ['app-menu', 'context-menu']) for (const n of readdirSync(join(root, 'assets', t))) ok(validateAsset(JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))).ok, `starter ${t}/${n} valid`);
}

// runtime API
{
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, hidden: ['toolbar'] } as never, assets, storageKey: 'test:app-menu' });
  const menuIds = () => rt.appMenu().menus.map((m) => m.id);
  const items = (menu: string) => rt.appMenu().menus.find((m) => m.id === menu)?.items.map((i) => i.id) ?? [];
  const assetMenus = rt.asset('app-menu').data.menus.map((m) => m.id);
  eq(menuIds(), assetMenus, 'no contributions: the asset menus as they are');
  eq(rt.appMenuProviderIds(), ['views', 'nav', 'toolbar', 'settings', 'windows', 'dialogs', 'chrome'], 'built-in live lists');

  // contributions: add, replace by id, remove by module (providers of that module go too)
  rt.addAppMenuItems({ id: 'p1.builds', module: 'p1', menu: 'builds', menuLabel: 'Builds', items: [{ id: 'pending', label: 'Pending builds', action: 'nav:pending', badge: 'builds.pending' }] });
  rt.registerAppMenuProvider('p1.list', { items: () => [{ id: 'a', label: 'A', action: 'nav:a' }], module: 'p1' });
  rt.addAppMenuItems({ id: 'p1.live', module: 'p1', menu: 'builds', items: [{ id: 'live', label: 'Live', provider: 'p1.list' }] });
  eq(menuIds(), [...assetMenus, 'builds'], 'contributed menu created last (default order)');
  eq(items('builds'), ['pending', 'live'], 'contributed items');
  rt.setBadge('builds.pending', 7);
  eq(rt.appMenu().menus.find((m) => m.id === 'builds')?.items[0]?.count, 7, 'badge count resolved from the runtime counter');
  rt.addAppMenuItems({ id: 'p1.builds', module: 'p1', menu: 'builds', items: [{ id: 'pending', label: 'Pending (v2)', action: 'nav:pending' }] });
  eq(rt.appMenu().menus.find((m) => m.id === 'builds')?.items[0]?.label, 'Pending (v2)', 'same contribution id replaces');
  rt.removeAppMenuItems('p1');
  eq(menuIds(), assetMenus, 'remove by module drops its menu');
  ok(!rt.appMenuProviderIds().includes('p1.list'), 'remove by module drops its providers');

  // conflicts are reported once through diagnostics (and not again on re-reads)
  const seen: string[] = [];
  rt.diagnostics.subscribe((d) => { if (d.kind === 'contribution-conflict') seen.push(`${d.what}:${d.id}:${d.was}>${d.now}`); });
  rt.addAppMenuItems({ id: 'a.x', module: 'mod-a', menu: 'file', items: [{ id: 'twin', label: 'A', action: 'noop' }] });
  rt.addAppMenuItems({ id: 'b.x', module: 'mod-b', menu: 'file', items: [{ id: 'twin', label: 'B', action: 'noop' }] });
  rt.appMenu(); rt.appMenu();
  eq(seen, ['app-menu item:file/twin:mod-a>mod-b'], 'one conflict diagnostic');
  rt.removeAppMenuItems('mod-a'); rt.removeAppMenuItems('mod-b');

  // live lists: sync, async, missing; capped with More…
  rt.registerAppMenuProvider('many', { items: () => Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}`, action: `nav:i${i}` })), max: 5, moreAction: 'nav:all' });
  const many = await rt.loadAppMenuProvider('many');
  eq(many.map((i) => i.id), ['i0', 'i1', 'i2', 'i3', 'i4', 'many.more'], 'capped live list with More…');
  eq(many[5]?.action, 'nav:all', 'More… runs the provider\'s action');
  rt.registerAppMenuProvider('later', async () => { await new Promise((r) => setTimeout(r, 5)); return [{ id: 'z', label: 'Z', action: 'nav:z' }]; });
  eq((await rt.loadAppMenuProvider('later')).map((i) => i.id), ['z'], 'async provider');
  eq(await rt.loadAppMenuProvider('nobody'), [], 'unknown provider: empty');
  const off = rt.registerAppMenuProvider('temp', () => []);
  off();
  ok(!rt.appMenuProviderIds().includes('temp'), 'remover unregisters');

  // built-in providers: views come from the search index (the shell feeds it), nav + toolbar from the active assets, chrome = toggles
  rt.search.add('test.views', () => [{ id: 'view:home', kind: 'view', label: 'Home', icon: 'home', focus: { kind: 'view', view: 'home' } }, { id: 'view:assets', kind: 'view', label: 'Assets', focus: { kind: 'view', view: 'assets' } }]);
  eq((await rt.loadAppMenuProvider('views')).map((i) => `${i.id}=${i.action}`), ['view:home=nav:home', 'view:assets=nav:assets'], 'views live list');
  const navViews = rt.asset('nav-menu').data.sections.flatMap((s) => s.items.map((i) => `nav:${i.view}`));
  eq((await rt.loadAppMenuProvider('nav')).filter((i) => !i.separator).map((i) => i.action), navViews, 'nav live list = the nav-menu tree');
  const tbActions = rt.asset('toolbar').data.groups.flatMap((g) => g.items.map((i) => i.action));
  eq((await rt.loadAppMenuProvider('toolbar')).filter((i) => !i.separator && !i.id.startsWith('toolbar-widget')).map((i) => i.action), tbActions, 'toolbar live list = the toolbar items');
  const chrome = await rt.loadAppMenuProvider('chrome');
  eq(chrome.map((i) => `${i.id}:${i.check}`), chromeToggleTypes().map((t) => `chrome.${t}:${t !== 'toolbar'}`), 'chrome toggles checked while shown (toolbar hidden by the manifest)');
  rt.dispatch('slot.hide:toolbar:toggle');
  ok(!rt.slotHidden('toolbar'), 'slot.hide:…:toggle shows a hidden slot');
  rt.dispatch('slot.hide:toolbar:toggle');
  ok(rt.slotHidden('toolbar'), '…and hides it again');

  // search: contributed items with an action are indexed under kind `menu`; asset items and argument-free listed actions are not
  rt.addAppMenuItems({ id: 's.x', module: 'plug', menu: 'file', items: [{ id: 'pend', label: 'Pending builds', action: 'nav:pending' }, { id: 'reset', label: 'Reset assets', action: 'assets.reset' }] });
  const hits = rt.search.query('pending builds').map((h) => h.id);
  ok(hits.includes('menu:file/pend'), `contributed item found by search (${hits.join(', ')})`);
  ok(!rt.search.entries().some((e) => e.id === 'menu:file/reset'), 'an action already listed is not indexed twice');
  ok(!rt.search.entries().some((e) => e.kind === 'menu' && e.id.startsWith('menu:file/new')), 'asset items are not menu entries');
}

console.log(`check-app-menu: ${checks} checks ok`);
