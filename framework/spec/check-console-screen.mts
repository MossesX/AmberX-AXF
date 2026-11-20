/**
 * Console screen (core/engines/console-screen.mjs; build voice-console-control, Nov 20 2026): the numbered element map a
 * voice session reads instead of the screenshot, naming a target by words / number / address / coordinates, the guard on
 * controls that delete or decide, menu paths, keys and the command shape. Replays spec/fixtures/console-screen.json.
 *
 *   npx -y tsx framework/spec/check-console-screen.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONSOLE_TOOLS, consoleMessage, consoleMessageErrors } from '../core/engines/console-commands.mjs';
import {
  CONSOLE_DESCRIBE_CACHE_MS, CONSOLE_DESCRIBE_TIMEOUT_MS, CONSOLE_SCREEN_ACTIONS, CONSOLE_SCREEN_FRAME, CONSOLE_SCREEN_TOOLS, normalizeScreenCommand, screenActionWrites,
  screenElementLine, screenElementMap, screenKeys, screenMapText, screenMenuPath, screenResolveTarget, screenTargetGuard,
} from '../core/engines/console-screen.mjs';
import { CONTROL_TARGETS } from '../core/engines/control-rules.mjs';
import { SAMPLE_SCREEN, SAMPLE_TARGETS } from './console-screen-sample.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

/* ---- the map ---- */
const map = screenElementMap(SAMPLE_SCREEN);
eq(map.length, 17, 'elements without a label or a box are dropped');
eq(map.map((e) => e.n), map.map((_, i) => i + 1), 'numbered from 1');
eq(map.slice(0, 2).map((e) => e.label), ['File', 'View'], 'reading order: the top line first, left to right');
eq(map.filter((e) => e.label === 'Building' || e.label === 'Queue' || e.label === 'Search builds' || e.label === 'Refresh' || e.label === 'Stop all').map((e) => e.label),
  ['Building', 'Queue', 'Search builds', 'Refresh', 'Stop all'], 'one line of the screen reads left to right whatever order the DOM had');
ok(map[map.length - 1]!.visible === false && map[map.length - 1]!.label.startsWith('shipped-features-export'), 'what needs a scroll comes last');
const row = map.find((e) => e.address === 'grid:builds/row:skin-gallery-fixes')!;
eq(row.state, { expanded: true, selected: true }, 'state kept: expanded and selected');
ok(screenElementLine(row).includes('[row]') && screenElementLine(row).includes('(expanded, selected)') && screenElementLine(row).includes('→ grid:builds/row:skin-gallery-fixes'), 'a line says kind, state and address');
ok(screenElementLine(map[map.length - 1]!).includes('scroll to see'), 'an off-screen element says scroll to see');
ok(/ at \d+,\d+ \d+×\d+/.test(screenElementLine(map[0]!)), 'a visible element says where it is and how big');
eq(screenMapText(map).split('\n').length, 17, 'one line per element');
ok(screenMapText(map, 5).endsWith('… and 12 more'), 'a capped list says how many more');
eq(screenMapText([]), 'No interactive element is on the screen.', 'an empty screen says so');
eq(screenElementMap(SAMPLE_SCREEN, 3).length, 3, 'the map is capped');
eq(screenElementMap([{ label: 'x', kind: 'weird', box: { x: 0, y: 0, w: 5, h: 5 } }])[0]!.kind, 'item', 'an unknown kind is an item');

/* ---- naming a target ---- */
const by = (t: string, prefer: string[] = []) => screenResolveTarget(map, t, { prefer });
const label = (t: string, prefer: string[] = []) => by(t, prefer).element?.label;
eq(by('5').element?.n, 5, 'a number names that element of the map');
eq(by('#2').element?.label, 'View', '#2');
eq(by('number 9').element?.n, 9, 'a spoken number');
eq(by('999').candidates, [], 'a number the map does not have');
eq(by('640,300').point, { x: 640, y: 300 }, 'x,y is a point anywhere');
eq(by('(12, 40)').point, { x: 12, y: 40 }, 'brackets and spaces');
eq(label('grid:builds/row:skin-gallery-fixes'), 'skin-gallery-fixes · failed · step 2 of 4', 'a full address');
eq(label('row:plan-studio-search'), 'plan-studio-search · failed · step 1 of 3', 'a short address matches the end');
eq(by('row:nope').candidates, [], 'an address nothing has');
eq(label('refresh'), 'Refresh', 'case-insensitive');
eq(label('the Refresh button'), 'Refresh', 'filler and kind words dropped');
eq(label('refrsh'), 'Refresh', 'one missing letter still matches');
eq(label('seting'), 'Settings', 'a transcription slip');
eq(label('queue tab'), 'Queue', 'the kind word prefers the tab');
eq(label('row 3'), 'plan-studio-search · failed · step 1 of 3', 'row 3 = the third visible row');
eq(label('the second row'), 'skin-gallery-fixes · failed · step 2 of 4', 'an ordinal');
eq(label('last row'), 'plan-studio-search · failed · step 1 of 3', 'the last visible row');
{
  const r = by('retry');
  ok(r.ambiguous === true && r.candidates!.length === 2 && r.candidates!.every((e) => e.label === 'Retry'), 'two Retry buttons: the numbered choices, not a guess');
  eq(label('the lower retry button'), 'Retry', 'a position word breaks the tie');
  eq(by('the lower retry button').element?.box.y, 258, 'lower = the one further down');
  eq(by('top retry').element?.box.y, 170, 'top = the one further up');
}
eq(label('skin gallery', ['row']), 'skin-gallery-fixes · failed · step 2 of 4', 'words from a row');
eq(label('shipped features'), 'shipped-features-export · done', 'an off-screen element is still found');
eq(by('launch rocket').candidates, [], 'nothing matches: no candidates, no guess');
ok(by('search rocket').candidates!.some((e) => e.label === 'Search builds') && !by('search rocket').element, 'a partial match is only offered');
eq(by('').candidates, [], 'no target');

/* ---- the guard ---- */
eq(screenTargetGuard({ label: 'Stop all' }), 'destructive', 'stop is destructive');
eq(screenTargetGuard({ label: 'Delete build' }), 'destructive', 'delete');
eq(screenTargetGuard({ label: 'Merge now' }), 'destructive', 'merge');
eq(screenTargetGuard({ label: 'Go', address: 'toolbar:x/button:force-push' }), 'destructive', 'the address names it');
eq(screenTargetGuard({ label: 'Tidy', state: { danger: true } }), 'destructive', 'a control drawn as dangerous');
eq(screenTargetGuard({ label: 'Approve' }), 'person', 'approve is Brett\'s own tap');
eq(screenTargetGuard({ label: 'Deny and delete' }), 'person', 'deciding wins over destructive');
eq(screenTargetGuard({ label: 'Retry' }), null, 'retry is plain');
eq(screenTargetGuard({ label: 'Stopwatch' }), null, 'whole words only');

/* ---- menu paths and keys ---- */
eq(screenMenuPath('Settings > Plugins > Agent cap'), ['Settings', 'Plugins', 'Agent cap'], 'a > path');
eq(screenMenuPath('File › Open… → Recent'), ['File', 'Open…', 'Recent'], 'other arrows');
eq(screenMenuPath('settings then plugins'), ['settings', 'plugins'], 'spoken: then');
eq(screenMenuPath(['A', ' B ']), ['A', 'B'], 'a list');
eq(screenKeys('ctrl+s').keys, [{ key: 's', ctrl: true, shift: false, alt: false, meta: false }], 'a chord');
eq(screenKeys('down down enter').keys!.map((k) => k.key), ['ArrowDown', 'ArrowDown', 'Enter'], 'a sequence');
eq(screenKeys('Shift+Tab').keys, [{ key: 'Tab', ctrl: false, shift: true, alt: false, meta: false }], 'case-insensitive names');
eq(screenKeys('esc').keys![0]!.key, 'Escape', 'esc');
eq(screenKeys('F5').keys![0]!.key, 'F5', 'function keys');
ok(screenKeys('banana').error, 'an unknown key is an error');
ok(screenKeys('x+s').error, 'an unknown modifier is an error');
ok(screenKeys('').error, 'no key');

/* ---- the command ---- */
eq(normalizeScreenCommand({ action: 'click', target: 'Retry' }).command, { $axf: CONSOLE_SCREEN_FRAME, action: 'click', target: 'Retry' }, 'a click');
eq(normalizeScreenCommand({ action: 'click', target: 7 }).command?.target, '7', 'a number as a number');
ok(normalizeScreenCommand({ action: 'click' }).errors, 'a click needs a target');
ok(normalizeScreenCommand({ action: 'fly' }).errors, 'an unknown action');
eq(normalizeScreenCommand({ action: 'menu', path: 'Settings > Plugins' }).command?.path, ['Settings', 'Plugins'], 'a menu path');
eq(normalizeScreenCommand({ action: 'context_menu', target: 'row 2', item: 'Retry', confirm: true }).command, { $axf: CONSOLE_SCREEN_FRAME, action: 'context_menu', target: 'row 2', item: 'Retry', confirm: true }, 'right-click then pick');
eq(normalizeScreenCommand({ action: 'scroll', dir: 'Page Down' }).command?.dir, 'page-down', 'a scroll direction');
eq(normalizeScreenCommand({ action: 'scroll', to: 'queue' }).command?.to, 'queue', 'scroll to a target');
ok(normalizeScreenCommand({ action: 'scroll' }).errors, 'scroll needs dir or to');
ok(normalizeScreenCommand({ action: 'scroll', dir: 'sideways' }).errors, 'a bad direction');
eq(normalizeScreenCommand({ action: 'type', text: 'hello', target: 'search', submit: true }).command, { $axf: CONSOLE_SCREEN_FRAME, action: 'type', target: 'search', text: 'hello', submit: true }, 'typing');
eq(normalizeScreenCommand({ action: 'type', text: '' }).command?.text, '', 'typing nothing clears the field');
ok(normalizeScreenCommand({ action: 'key', keys: 'banana' }).errors?.length === 1, 'a bad key is one error');
eq(normalizeScreenCommand({ action: 'map' }).command, { $axf: CONSOLE_SCREEN_FRAME, action: 'map' }, 'reading the map takes nothing');
ok(!screenActionWrites('map') && screenActionWrites('click'), 'only map reads');

/* ---- contract: tools, message, control target, limits ---- */
eq(CONSOLE_SCREEN_TOOLS.length, 11, 'eleven screen tools');
ok(CONSOLE_SCREEN_TOOLS.every((t) => CONSOLE_TOOLS.includes(t)), 'every screen tool is a console MCP tool');
eq(Object.keys(CONTROL_TARGETS['console.screen'].acts).sort(), [...CONSOLE_SCREEN_ACTIONS].sort(), 'control@1 console.screen acts = the screen actions');
eq(consoleMessageErrors({ ...consoleMessage({ op: 'drive' }, { id: 'd1' }), command: { action: 'click', target: '3' } }), [], 'op drive carries a console-screen command');
ok(consoleMessageErrors(consoleMessage({ op: 'drive' }, { id: 'd2' })).length === 1, 'op drive without a command is refused');
eq([CONSOLE_DESCRIBE_TIMEOUT_MS, CONSOLE_DESCRIBE_CACHE_MS], [30_000, 120_000], 'a description gives up after 30 s and is kept 2 minutes');

/* ---- the fixture (what other ports replay) ---- */
{
  const fx = JSON.parse(readFileSync(new URL('./fixtures/console-screen.json', import.meta.url), 'utf8'));
  eq(fx.map, map, 'fixture: the numbered map');
  eq(fx.text, screenMapText(map), 'fixture: the map as text');
  for (const t of SAMPLE_TARGETS) eq(fx.resolve[t.target], JSON.parse(JSON.stringify(screenResolveTarget(map, t.target, { prefer: t.prefer ?? [] }))), `fixture: ${t.target} (${t.why})`);
  eq(Object.keys(fx.resolve).length, SAMPLE_TARGETS.length, 'fixture: every sample target');
  eq(fx.guards, Object.fromEntries(map.map((e) => [e.n, screenTargetGuard(e)])), 'fixture: the guard of every element');
}

console.log(`✓ console screen — ${n} checks`);
