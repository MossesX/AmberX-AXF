#!/usr/bin/env node
/**
 * Nested menus plugin self-test: the console's menus generated from its files (framework/cli/menu-gen.mjs over
 * apps/console-web) keep the shape Brett asked for, and the plugin's manifest declares what the library registers.
 *   node apps/console-web/plugins/nested-menus/test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFor } from '../../../../framework/cli/menu-gen.mjs';
import { NESTED_MENU_FIELDS, searchMenuIndex } from '../../../../framework/core/engines/menugen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
let checks = 0;
const ok = (c, msg) => { assert.ok(c, msg); checks++; };

const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
ok(manifest.$axf === 'plugin@1' && manifest.id === 'ai.amberx.axf.console.nested-menus', 'manifest id');
ok(manifest.menu?.category === 'look', 'the plugin declares its own menu category');
const cmdIds = manifest.commands.items.map((c) => c.id);
for (const id of ['jump', 'open', 'favorite', 'override', 'set', 'get', 'outline', 'generate']) ok(cmdIds.includes(id), `command ${id} declared (REST / MCP / CLI)`);
ok(manifest.commands.items.find((c) => c.id === 'set').description.includes('maxPerLevel'), 'set names the fields');
for (const f of Object.keys(NESTED_MENU_FIELDS)) if (f !== 'override') ok(manifest.commands.items.find((c) => c.id === 'set').description.includes(f) || f === 'override', `field ${f} is documented on menus.set`);

const web = readFileSync(join(HERE, 'web/index.tsx'), 'utf8');
ok(/from '\.\/menu'/.test(web) && /\n\s+appMenu,/.test(web), 'index.tsx installs appMenu from ./menu (menu-reach rule)');
ok(web.includes('generatedMenusLibrary('), 'the plugin is the framework library under its own id');

const r = generateFor(join(ROOT, 'apps/console-web'));
const s = r.stats;
ok(s.sources >= 150, `the console registers plenty of entries (${s.sources})`);
ok(s.widest <= s.maxPerLevel && s.maxPerLevel === 12, `no level wider than the cap (${s.widest} ≤ ${s.maxPerLevel})`);
ok(s.deepest <= 4, `never deeper than the app-menu engine allows (${s.deepest})`);
ok(s.unplaced === 0, `every entry is in a menu (${s.unplaced} left out)`);
ok(s.categories >= 8 && s.categories <= 12, `${s.categories} categories`);
ok(r.appMenu.data.menus.length <= 12 && r.appMenu.data.menus[0].id === 'start', 'the menu bar starts with Start and stays within the cap');
const start = r.appMenu.data.menus[0];
ok(start.items.some((i) => i.id === 'favorites') && start.items.some((i) => i.id === 'recents') && start.items.some((i) => i.action === 'menus.jump'), 'Start has Favourites, Recent and Jump to…');
const walk = (items, depth) => items.flatMap((i) => [{ i, depth }, ...(i.items ? walk(i.items, depth + 1) : [])]);
const all = walk(r.appMenu.data.menus.flatMap((m) => m.items), 1);
ok(all.every(({ i }) => !i.items || i.items.length <= 12), 'every sub menu within the cap');
ok(all.every(({ depth }) => depth <= 4), 'app-menu depth ≤ 4');
const actions = new Set(all.map(({ i }) => i.action).filter(Boolean));
for (const a of ['nav:home', 'nav:plan', 'nav:build', 'nav:pending', 'nav:tracker', 'nav:plugin-manager', 'settings.open:plugins', 'console.search']) ok(actions.has(a), `reaches ${a}`);
ok(actions.has('nav:settings') || actions.has('app.settings'), 'reaches Settings (the page beats its app.settings twin)');
ok(all.some(({ i }) => i.provider === 'console.pending'), 'live lists survive (pending builds)');
ok(r.navMenu.data.navStyle === true && r.navMenu.data.sections.length >= 1, 'the navigation opts in to nav-style sub menus');
const navTop = r.navMenu.data.sections[r.navMenu.data.sections.length - 1].items;
ok(navTop.length <= 12 && navTop.some((i) => i.items?.length), 'the nav has at most 12 rows closed and categories that open');
const hit = searchMenuIndex(r.index, 'plugin manager', { max: 3 })[0];
ok(hit && /plugin manager/i.test(hit.label), `jump-to finds the Plugin Manager (${hit?.label})`);
const perPlugin = r.index.filter((e) => e.module === 'ai.amberx.axf.console.plan-studio');
ok(perPlugin.length >= 1 && perPlugin.every((e) => e.path[0] === 'Builds'), 'Plan Studio lands under Builds');
ok(r.index.filter((e) => e.module === 'ai.amberx.axf.console.agent-manager').every((e) => e.path[0] === 'AI & agents'), 'Agent manager lands under AI & agents');

console.log(`nested-menus: ${checks} checks passed · console: ${s.sources} entries → ${s.categories} categories, ${s.groups} sub menus, widest ${s.widest}, deepest ${s.deepest}`);
