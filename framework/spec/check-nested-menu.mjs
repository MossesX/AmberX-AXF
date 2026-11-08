#!/usr/bin/env node
/**
 * nested-menu@1 check (core/engines/menugen.mjs): source normalisation and de-duplication, categorisation (explicit,
 * words, hints, apps, "X settings"), the layout rules (sub categories, Settings fold, plugin groups, kind groups,
 * alphabetical chunks, More…, the cap on every level, the depth cap), favourites and recents, the app-menu and nav-menu
 * data (validated by the asset validator), search / jump-to, the field validators, and the three apps' static
 * generation (framework/cli/menu-gen.mjs) staying within the cap. Golden outputs: spec/fixtures/nested-menu.json
 * (`--write` regenerates it after an engine change).
 *
 *   node framework/spec/check-nested-menu.mjs [--write]
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAVORITES_ID, GENERATED_SUFFIX, JUMP_ACTION, MENU_CATEGORIES, NESTED_MENU_DEFAULTS, NESTED_MENU_FIELDS, NESTED_MENU_FRAME, NESTED_MENU_KEYS, RECENTS_ID,
  buildNestedMenu, categorize, generateMenuAssets, menuFieldErrors, normalizeSources, parseFieldValue, pushRecent, searchMenuIndex, sourceIdOf, toggleFavorite, treeOutline,
} from '../core/engines/menugen.mjs';
import { generateFor } from '../cli/menu-gen.mjs';
// @ts-expect-error plain .mjs (the build engine's own validator)
import { validateAsset } from '../cli/build-engine.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'framework/spec/fixtures/nested-menu.json');
const write = process.argv.includes('--write');
let checks = 0;
const ok = (c, msg) => { assert.ok(c, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

/* ---------------- ids and normalisation ---------------- */
eq(sourceIdOf({ action: 'nav:home' }), 'page:home', 'nav action → page id');
eq(sourceIdOf({ action: 'dialog:import-asset' }), 'dialog:import-asset', 'dialog action');
eq(sourceIdOf({ action: 'settings.open:plugins' }), 'settings:plugins', 'settings tab');
eq(sourceIdOf({ action: 'app.settings' }), 'settings:settings', 'app.settings is the Settings page');
eq(sourceIdOf({ provider: 'console.pending' }), 'list:console.pending', 'live list');
eq(sourceIdOf({ action: 'console.open:axhub-users' }), 'action:console.open:axhub-users', 'any other action');
const dup = normalizeSources([
  { action: 'nav:home', label: 'Home', icon: 'home', hint: 'Console' },
  { kind: 'page', view: 'home', label: 'Start page', module: 'ai.x.lib', moduleLabel: 'X', keywords: ['front'] },
  { action: 'nav:settings', label: 'Settings' },
  { action: 'app.settings', label: 'Settings' },
  { label: 'no action' },
  { action: 'dialog:x' },
]);
eq(dup.map((s) => s.id), ['page:home', 'page:settings', 'dialog:x'], 'duplicates merge, the page beats its settings twin, actionless entries drop');
eq(dup[0].label, 'Home', 'first label wins');
ok(dup[0].keywords.includes('front') && dup[0].module === 'ai.x.lib', 'keywords join and a library claims an app entry');
eq(dup[2].label, 'X', 'a label is made from the id');

/* ---------------- categorisation ---------------- */
const cat = (raw) => categorize(normalizeSources([raw])[0]);
eq(cat({ action: 'nav:plan', label: 'Plan' }), 'builds', 'Plan → Builds');
eq(cat({ action: 'nav:agent-manager', label: 'Agent manager' }), 'ai', 'Agent manager → AI');
eq(cat({ action: 'settings.open:plugins-menu', label: 'Plugins menu settings', moduleLabel: 'Plugins menu' }), 'plugins', '"X settings" is about X');
eq(cat({ action: 'console.open:axhub-users', label: 'Users' }), 'account', 'label words beat action words');
eq(cat({ action: 'nav:account', label: 'Account', hint: 'Console', hintId: 'console' }), 'account', 'a strong word beats the menu hint');
eq(cat({ action: 'molly.reload', label: 'Reload this app', hint: 'Molly', hintId: 'molly' }), 'start', 'reload → Start');
eq(cat({ action: 'x.unknown', label: 'Zzz' }), 'more', 'nothing matched → More');
eq(cat({ action: 'x.unknown', label: 'Zzz', hintId: 'help' }), 'help', 'only the hint → its alias');
eq(cat({ action: 'nav:console', label: 'Console', kind: 'app' }), 'apps', 'an app entry → Apps');
eq(cat({ action: 'nav:anything', label: 'Anything', category: 'work' }), 'work', 'a declared category wins');
eq(cat({ action: 'nav:anything', label: 'Anything', category: 'nope' }), 'more', 'an unknown declared category is ignored');

/* ---------------- layout: a synthetic registry ---------------- */
const mk = (n, module, kind = 'page', cat = 'build') => Array.from({ length: n }, (_, i) => ({ kind, action: kind === 'page' ? `nav:${module}-${i}` : kind === 'dialog' ? `dialog:${module}-${i}` : `settings.open:${module}-${i}`, label: `${cat} ${module} ${String(i).padStart(2, '0')}${kind === 'settings' ? ' settings' : ''}`, module: `ai.test.${module}`, moduleLabel: `Plugin ${module}` }));
const synthetic = [
  { action: 'nav:home', label: 'Home', icon: 'home' },
  { action: 'nav:plan', label: 'Plan' }, { action: 'nav:build', label: 'Build queue' }, { action: 'nav:pending', label: 'Pending builds' }, { action: 'nav:tracker', label: 'Tracker' },
  { provider: 'console.pending', label: 'Open pending items' },
  ...mk(5, 'alpha'), ...mk(4, 'beta'), ...mk(3, 'gamma'), ...mk(2, 'delta'), ...mk(2, 'epsilon'),
  ...mk(6, 'alpha', 'settings'), ...mk(2, 'beta', 'settings'),
  { action: 'nav:about', label: 'About', hint: 'Help', hintId: 'help' },
  { action: 'nav:sub1', label: 'Sub one', subcategory: 'Exports', category: 'builds' }, { action: 'nav:sub2', label: 'Sub two', subcategory: 'Exports', category: 'builds' },
  { action: 'nav:z1', label: 'Theme editor' }, { action: 'nav:z2', label: 'Brand library' },
];
const tree = buildNestedMenu(synthetic, { app: 'test', appLabel: 'Test', favorites: ['page:plan', 'page:nope'], recents: ['page:home', 'page:plan', 'page:tracker'] });
ok(tree.$axf === NESTED_MENU_FRAME && tree.app === 'test', 'frame + app');
const builds = tree.categories.find((c) => c.id === 'builds');
ok(builds && builds.count === 31, `Builds holds the build entries (${builds?.count})`);
const widthOf = (nodes) => Math.max(nodes.length, ...nodes.filter((n) => n.group).map((n) => widthOf(n.items)));
ok(widthOf(builds.nodes) <= 12, `every Builds level within 12 (${widthOf(builds.nodes)})`);
const labels = (nodes) => nodes.map((n) => (n.group ? `${n.group.label} ▸` : n.src.label));
const top = labels(builds.nodes);
ok(top.slice(0, 4).join(',') === 'Build queue,Pending builds,Plan,Tracker', `the app's own pages stay flat and first (${top.slice(0, 4)})`);
ok(top.includes('Exports ▸'), 'a declared sub category is a sub menu');
ok(top.includes('Settings ▸'), 'settings tabs fold into one Settings sub menu');
ok(top.includes('Plugin alpha ▸'), 'a plugin with several entries becomes its own sub menu');
ok(!top.some((l) => l === 'More…' || /^[A-Z]–[A-Z]$/.test(l)) || widthOf(builds.nodes) <= 12, 'chunks only when needed');
eq(tree.favorites.map((s) => s.id), ['page:plan'], 'favourites keep only entries that exist');
eq(tree.recents.map((s) => s.id), ['page:home', 'page:tracker'], 'recents skip favourites');
ok(tree.stats.unplaced === 0 && tree.stats.placed === tree.stats.shown, 'everything placed');
ok(tree.index.find((e) => e.id === 'page:sub1').path.join('/') === 'Builds/Exports', 'the index carries the path');
const hidden = buildNestedMenu(synthetic, { app: 'test', hidden: ['help', 'page:home'] });
ok(!hidden.categories.some((c) => c.id === 'help') && !hidden.index.some((e) => e.id === 'page:home') && hidden.stats.hidden === 1, 'hidden categories and entries');
const tight = buildNestedMenu(synthetic, { app: 'test', maxPerLevel: 4, maxDepth: 2 });
ok(tight.categories.length <= 4 && tight.categories.every((c) => widthOf(c.nodes) <= 4), 'a tight cap folds categories and levels');
ok(tight.stats.deepest <= 2, `depth cap respected (${tight.stats.deepest})`);
ok(tight.notes.some((n) => /folded into More/.test(n)), 'folding is noted');
const noGroups = buildNestedMenu(synthetic, { app: 'test', groupByPlugin: false });
ok(!labels(noGroups.categories.find((c) => c.id === 'builds').nodes).includes('Plugin alpha ▸'), 'groupByPlugin off: no plugin sub menus');

/* ---------------- assets ---------------- */
const gen = generateMenuAssets(synthetic, { app: 'Test App', appLabel: 'Test', favorites: ['page:plan'], recents: ['page:home'] });
eq(gen.appMenu.id, `test-app${GENERATED_SUFFIX}`, 'asset id');
eq(validateAsset(gen.appMenu).errors, [], 'the generated app-menu validates');
eq(validateAsset(gen.navMenu).errors, [], 'the generated nav-menu validates');
const start = gen.appMenu.data.menus[0];
ok(start.id === 'start' && start.items[0].id === FAVORITES_ID && start.items[1].id === RECENTS_ID && start.items[2].action === JUMP_ACTION, 'Start: Favourites, Recent, Jump to…');
ok(start.items[0].items[0].id === 'page:plan', 'Favourites lists the pinned page');
const empty = generateMenuAssets(synthetic, { app: 'test' }).appMenu.data.menus[0];
ok(empty.items[0].items.length === 1 && /pinned/.test(empty.items[0].items[0].label), 'an empty Favourites explains itself instead of vanishing');
ok(gen.navMenu.data.navStyle === true && gen.navMenu.data.sections[0].label === 'Favourites' && gen.navMenu.data.sections[1].label === 'Recent', 'nav: Favourites and Recent sections');
const navTop = gen.navMenu.data.sections[2].items;
ok(navTop.every((i) => typeof i.view === 'string' && i.icon) && navTop.some((i) => i.view === '' && i.items.length), 'nav rows: pages and groups that open');
const navAll = (items) => items.flatMap((i) => [i, ...(i.items ? navAll(i.items) : [])]);
ok(navAll(navTop).every((i) => !i.items || i.view === '' || i.view), 'nav groups are pure groups');
ok(!navAll(navTop).some((i) => i.id.startsWith('list:') || i.id.startsWith('settings:')), 'the nav holds pages only');
ok(gen.appMenu.data.menus.length <= 12, 'menu bar within the cap');
const noStart = generateMenuAssets([{ action: 'nav:plan', label: 'Plan' }], { app: 'x', showFavorites: false, showRecents: false });
ok(noStart.appMenu.data.menus[0].items.length === 1 && noStart.appMenu.data.menus[0].items[0].action === JUMP_ACTION, 'without favourites and recents Start keeps Jump to…');

/* ---------------- search, favourites, recents, fields ---------------- */
const hits = searchMenuIndex(gen.index, 'pend', { max: 5 });
ok(hits[0]?.label === 'Pending builds', `prefix hit first (${hits[0]?.label})`);
ok(searchMenuIndex(gen.index, 'alpha 03')[0]?.label === 'build alpha 03', 'two words');
ok(searchMenuIndex(gen.index, 'zzzz').length === 0, 'no match');
ok(searchMenuIndex(gen.index, 'build', { favorites: ['page:build'] })[0]?.id === 'page:build', 'a favourite ranks first among equals');
eq(pushRecent(['a', 'b'], 'b', 3), ['b', 'a'], 'recent moves to the front');
eq(pushRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b'], 'recents are capped');
eq(toggleFavorite(['a'], 'b'), ['a', 'b'], 'pin'); eq(toggleFavorite(['a', 'b'], 'a'), ['b'], 'unpin'); eq(toggleFavorite(['a'], 'a', true), ['a'], 'set on keeps');
eq(menuFieldErrors('maxPerLevel', 3), ['maxPerLevel must be a whole number from 4 to 30'], 'field bounds');
eq(menuFieldErrors('style', 'tree'), ['style must be one of list, rail, pills'], 'enum');
eq(menuFieldErrors('nope', 1).length, 1, 'unknown field');
eq(parseFieldValue('showRecents', 'off'), false, 'off → false'); eq(parseFieldValue('maxPerLevel', '8'), 8, 'number text'); eq(parseFieldValue('hidden', 'a, b'), ['a', 'b'], 'list text');
ok(Object.keys(NESTED_MENU_FIELDS).every((f) => NESTED_MENU_KEYS[f]), 'every field has a settings key');
ok(MENU_CATEGORIES.length === 12 && MENU_CATEGORIES[MENU_CATEGORIES.length - 1].id === 'more', '12 categories, More last');
ok(treeOutline(tree).split('\n').length > 10 && treeOutline(tree, { nav: true }).length > 0, 'outline');

/* ---------------- the three apps from their files ---------------- */
const apps = {};
for (const app of ['apps/console-web', 'apps/molly', 'apps/amberx-droid']) {
  const r = generateFor(join(ROOT, app));
  ok(r.stats.widest <= 12 && r.stats.deepest <= 4 && r.stats.unplaced === 0, `${app}: within the cap (${r.stats.widest}), depth ${r.stats.deepest}, nothing left out`);
  eq(validateAsset(r.appMenu).errors, [], `${app}: app-menu validates`);
  eq(validateAsset(r.navMenu).errors, [], `${app}: nav-menu validates`);
  apps[app] = { stats: r.stats, menus: r.appMenu.data.menus.map((m) => `${m.label} (${m.items.length})`), navRows: r.navMenu.data.sections.at(-1).items.map((i) => i.label) };
}
ok(apps['apps/console-web'].stats.sources > apps['apps/molly'].stats.sources, 'the console has the most entries');

/* ---------------- golden fixture ---------------- */
const fixture = {
  $axf: NESTED_MENU_FRAME,
  defaults: NESTED_MENU_DEFAULTS,
  fields: NESTED_MENU_FIELDS,
  keys: NESTED_MENU_KEYS,
  categories: MENU_CATEGORIES.map((c) => ({ id: c.id, label: c.label, icon: c.icon })),
  categorize: [
    ['Plan', 'nav:plan'], ['Agent manager', 'nav:agent-manager'], ['Users', 'console.open:axhub-users'], ['Zzz', 'x.unknown'], ['Theme editor', 'nav:theme-editor'], ['Plugin Manager', 'nav:plugin-manager'], ['Output terminal', 'terminal.open'], ['Approvals', 'nav:approvals'],
  ].map(([label, action]) => ({ label, action, category: cat({ label, action }) })),
  synthetic: { outline: treeOutline(tree), stats: tree.stats, appMenu: gen.appMenu.data, navMenu: gen.navMenu.data },
  apps,
};
if (write || !existsSync(FIXTURE)) { writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 1)}\n`); console.log(`wrote ${FIXTURE}`); }
else {
  const saved = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  for (const k of ['defaults', 'fields', 'keys', 'categories', 'categorize']) eq(fixture[k], saved[k], `fixture ${k}`);
  eq(fixture.synthetic, saved.synthetic, 'fixture synthetic tree + assets');
  // the apps' registries move with every plugin: only the shape is pinned
  for (const [app, v] of Object.entries(saved.apps)) ok(apps[app] && apps[app].stats.maxPerLevel === v.stats.maxPerLevel && apps[app].stats.widest <= 12, `fixture ${app} shape`);
}
console.log(`nested-menu@1: ${checks} checks passed`);
