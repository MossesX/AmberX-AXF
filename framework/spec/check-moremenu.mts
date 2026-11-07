/**
 * lib-moremenu (`ai.amberx.axf.moremenu`): the ⋯ menu every console plugin shares since Nov 7 2026.
 *   1. placement rules for both looks (ctx flips to the roomier side; dropdown is right-aligned, ≤ 260 px, 8 px margin)
 *   2. items: conditional entries dropped, onPick / onSelect both run, key = id or label
 *   3. no console plugin ships its own MoreMenu any more (the harvest stays harvested)
 *
 *   npx -y tsx framework/spec/check-moremenu.mts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DROPDOWN_MARGIN, DROPDOWN_MAX_WIDTH, itemKey, pick, placeMenu, placementStyle, popoverClass, visibleItems } from '../libs/moremenu/core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let okN = 0, fail = 0;
const ok = (c: unknown, msg: string) => { if (c) okN++; else { fail++; console.log(`✗ ${msg}`); } };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 1. placement
ok(same(placeMenu({ left: 10, right: 40, bottom: 50 }, 1000), { top: 50, left: 10 }), 'ctx: a button on the left opens to the right of its left edge');
ok(same(placeMenu({ left: 900, right: 940, bottom: 50 }, 1000), { top: 50, right: 60 }), 'ctx: a button on the right anchors its right edge');
ok(same(placeMenu({ left: 480, right: 500, bottom: 20 }, 1000), { top: 20, right: 500 }), 'ctx: exactly half way counts as the right side');
ok(same(placeMenu({ left: -5, right: 10, bottom: 0 }, 1000), { top: 0, left: 0 }), 'ctx: never off the left edge');
ok(same(placeMenu({ left: 700, right: 740, bottom: 50 }, 1000, 'dropdown'), { top: 50, left: 740 - DROPDOWN_MAX_WIDTH }), 'dropdown: right-aligned with the button');
ok(same(placeMenu({ left: 10, right: 40, bottom: 50 }, 1000, 'dropdown'), { top: 50, left: DROPDOWN_MARGIN }), 'dropdown: clamped to the left margin');
ok(same(placeMenu({ left: 960, right: 1000, bottom: 50 }, 1000, 'dropdown'), { top: 50, left: 1000 - DROPDOWN_MAX_WIDTH - DROPDOWN_MARGIN }), 'dropdown: clamped to the right margin');
ok(same(placeMenu({ left: 100, right: 140, bottom: 50 }, 300, 'dropdown'), { top: 50, left: DROPDOWN_MARGIN }), 'dropdown: on a narrow screen the menu is viewport − 2 × margin wide and starts at the margin');
ok(same(placementStyle({ top: 1, right: 2 }), { top: 1, right: 2, left: 'auto' }) && same(placementStyle({ top: 1, left: 3 }), { top: 1, left: 3 }), 'style: right-anchored switches left off');
ok(popoverClass('ctx').startsWith('fx-ctx fx-popover') && popoverClass('dropdown').startsWith('fx-popover fx-dropdown'), 'each look keeps its framework classes');

// 2. items
let ran = '';
const items = visibleItems([{ label: 'A', onPick: () => { ran += 'a'; } }, false, null, undefined, { id: 'b', label: 'B', onSelect: () => { ran += 'b'; } }, { label: 'C' }]);
ok(items.length === 3, 'conditional entries are dropped');
for (const it of items) pick(it);
ok(ran === 'ab', 'onPick and onSelect both run, a handler-less item is harmless');
ok(itemKey(items[0]!) === 'A' && itemKey(items[1]!) === 'b', 'key = id, else label');

// 3. the harvest stays harvested
const plugins = join(ROOT, 'apps/console-web/plugins');
const own: string[] = [];
if (existsSync(plugins)) {
  for (const d of readdirSync(plugins)) {
    const web = join(plugins, d, 'web');
    if (!existsSync(web)) continue;
    for (const f of readdirSync(web)) {
      if (!/\.tsx?$/.test(f)) continue;
      const src = readFileSync(join(web, f), 'utf8');
      if (/export\s+function\s+MoreMenu\b/.test(src)) own.push(`${d}/web/${f}`);
    }
  }
}
ok(!own.length, `no plugin ships its own MoreMenu: ${own.join(', ')}`);
const baked = join(ROOT, 'apps/console-web/src/axf/libs/moremenu/index.tsx');
ok(existsSync(baked), 'the console carries the baked copy (src/axf/libs/moremenu)');
if (existsSync(baked)) ok(readFileSync(baked, 'utf8') === readFileSync(join(ROOT, 'framework/libs/moremenu/index.tsx'), 'utf8'), 'baked copy = framework copy');

console.log(`moremenu: ${okN} ok, ${fail} failed`);
if (fail) process.exit(1);
