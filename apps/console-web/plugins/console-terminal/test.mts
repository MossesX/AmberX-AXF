/*
 * Pure-part self-test for the Terminal plugin's header overflow (terminal-header-responsive, Nov 8 2026):
 *   node --experimental-strip-types apps/console-web/plugins/console-terminal/test.mts
 * header-core.ts (registry, pins, styles, voice lookup) against the framework's overflow rule (overflowWidgets, the
 * banner's), at phone, tablet and desktop widths, and the server's mirror of the item ids (server/store.py).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PINS, HEADER_IDS, HEADER_ITEMS, HEADER_STYLES, findHeaderItem, forcedOut, headerState, headerStyle, normPins, overflowEntries, setPin } from './web/header-core.ts';
import { overflowWidgets } from '../../../../framework/core/engines/bannerwidgets.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0;
const check = (cond: unknown, msg: string) => { if (!cond) { console.error(`  ✗ ${msg}`); process.exit(1); } n++; console.log(`  ✓ ${msg}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// registry
check(new Set(HEADER_IDS).size === HEADER_IDS.length, 'header item ids are unique');
check(HEADER_ITEMS.every((i) => i.priority >= 1 && i.priority <= 9 && i.id.startsWith(`${i.bar}.`)), 'priorities on the banner scale (1…9), ids name their bar');
const top = (bar: string) => HEADER_ITEMS.filter((i) => i.bar === bar).sort((a, b) => b.priority - a.priority).slice(0, 2).map((i) => i.id);
check(eq(top('toolbar'), ['toolbar.session', 'toolbar.status']), 'toolbar: session name and status have the top priority');
check(top('chain')[0] === 'chain.title', 'chain bar: the title has the top priority');
check(eq(normPins(undefined), [...DEFAULT_PINS]) && eq(DEFAULT_PINS, ['toolbar.session', 'toolbar.status', 'chain.title']), 'default pins: session, status, chain title');
check(eq(normPins(['chain.title', 'bogus', 'toolbar.find', 'chain.title']), ['toolbar.find', 'chain.title']), 'pins: unknown dropped, repeats dropped, registry order');
check(eq(normPins([]), []), 'an empty pin list stays empty (nothing pinned is a choice)');
check(headerStyle('menu') === 'menu' && headerStyle('loud') === 'priority', 'style: known kept, unknown = priority');

// voice / CLI lookup
check(findHeaderItem('status')?.id === 'toolbar.status' && findHeaderItem('the find button')?.id === 'toolbar.find' && findHeaderItem('mouse mode')?.id === 'toolbar.mouse', 'items found by what someone says');
check(findHeaderItem('reveal speed')?.id === 'chain.speed' && findHeaderItem('nothing like it') === null, '…by label words, and nothing for no match');
check(setPin(DEFAULT_PINS, 'find', true).includes('toolbar.find') && !setPin(DEFAULT_PINS, 'status', false).includes('toolbar.status'), 'setPin pins and unpins by name');
check(eq(setPin(DEFAULT_PINS, 'zzz', true), [...DEFAULT_PINS]), 'setPin with an unknown item changes nothing');

// the overflow rule at three widths (widths in px as drawn at the default theme; gap 4, ⋯ button 32)
const W: Record<string, number> = { 'toolbar.claude': 118, 'toolbar.session': 180, 'toolbar.status': 70, 'toolbar.find': 28, 'toolbar.size': 92, 'toolbar.mouse': 28, 'toolbar.mosh': 28, 'toolbar.copy': 28, 'toolbar.paste': 28, 'toolbar.settings': 28, 'toolbar.hide': 28 };
const order = ['toolbar.claude', 'toolbar.session', 'toolbar.status', 'toolbar.find', 'toolbar.size', 'toolbar.mouse', 'toolbar.mosh', 'toolbar.copy', 'toolbar.paste', 'toolbar.settings', 'toolbar.hide'];
const at = (width: number, pins = DEFAULT_PINS) => overflowWidgets(overflowEntries('toolbar', order, pins).map((e) => ({ ...e, width: W[e.key]! })), width, 32, 4);
const total = order.reduce((s, k) => s + W[k]!, 0) + 4 * (order.length - 1);
check(eq(at(1280), []), 'desktop (1280): everything fits, no ⋯');
const tablet = at(600);
check(tablet.length > 0 && !tablet.includes('toolbar.session') && !tablet.includes('toolbar.status'), 'tablet (600): some items in ⋯, session and status stay');
check(tablet[0] === 'toolbar.hide', '…the lowest priority (Hide) leaves first');
const phone = at(360);
check(phone.length > tablet.length && !phone.includes('toolbar.session') && !phone.includes('toolbar.status'), 'phone (360): more in ⋯, session and status stay');
const kept = order.filter((k) => !phone.includes(k));
check(kept.reduce((s, k) => s + W[k]!, 0) + 4 * kept.length + 32 <= 360, '…and what stays plus ⋯ fits: nothing overlaps');
check(phone.indexOf('toolbar.settings') === -1 || phone.indexOf('toolbar.settings') > phone.indexOf('toolbar.mouse'), '…settings (7) leaves after the modes (3)');
check(!at(360, [...DEFAULT_PINS, 'toolbar.find']).includes('toolbar.find'), 'a pinned item never leaves, even on a phone');
check(at(total).length === 0 && at(total - 1).length > 0, 'the bar gives way at the exact width (measured, not a viewport breakpoint)');

// menu style
check(eq(forcedOut('menu', order, DEFAULT_PINS), order.filter((k) => !DEFAULT_PINS.includes(k))) && eq(forcedOut('priority', order, DEFAULT_PINS), []), 'menu style: only pinned items on the bar; other styles measure');

// API answer + server mirror
const st = headerState(['toolbar.find'], 'compact');
check(st.style === 'compact' && eq(st.styles, [...HEADER_STYLES]) && st.items.find((i) => i.id === 'toolbar.find')?.pinned === true, 'header state for API / MCP / voice: style, styles, every item with pinned');
const py = readFileSync(resolve(HERE, 'server/store.py'), 'utf8');
const pyIds = [...(/HEADER_IDS: tuple\[str, \.\.\.\] = \(([\s\S]*?)\)\n/.exec(py)?.[1] ?? '').matchAll(/"([a-z.]+)"/g)].map((m) => m[1]);
check(eq(pyIds, [...HEADER_IDS]), 'server/store.py HEADER_IDS mirrors header-core.ts');
check(/"headerPins": \["toolbar\.session", "toolbar\.status", "chain\.title"\]/.test(py) && /"headerStyle": \("priority", "compact", "menu"\)/.test(py), 'server defaults and styles mirror header-core.ts');

console.log(`all ${n} checks passed`);
