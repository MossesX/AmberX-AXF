/**
 * check-terminal-tab-position — the Terminal's tab position setting (terminal-tabs-left, Nov 3 2026): top, a left or
 * right stack, or the bottom; per device with a server default; the stack's width in --fx-space steps
 * (apps/console-web/plugins/console-terminal/web/tab-position-core.ts), and the stack's wiring in the plugin.
 *
 *   npx -y tsx framework/spec/check-terminal-tab-position.mts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEVICE_KEYS, STACK_WIDTH, TAB_POSITIONS, TAB_POSITION_LABELS, clampWidth, dragWidth, effectivePosition, initials, isPosition, isStack, keyWidth,
} from '../../apps/console-web/plugins/console-terminal/web/tab-position-core.ts';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string) => readFileSync(REPO + p, 'utf8');
let ok = 0;
const check = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };

console.log('terminal tab position');
check(TAB_POSITIONS.join() === 'top,left,right,bottom' && TAB_POSITIONS.every((p) => TAB_POSITION_LABELS[p]), 'four positions, each labelled');
check(isPosition('left') && !isPosition('sideways') && !isPosition('') && !isPosition(null), 'isPosition takes only the four');
check(isStack('left') && isStack('right') && !isStack('top') && !isStack('bottom'), 'left and right are stacks');
check(effectivePosition('left', 'top') === 'left', "a device's own pick wins");
check(effectivePosition('', 'right') === 'right' && effectivePosition(null, 'bottom') === 'bottom', 'no pick: the server default');
check(effectivePosition('nope', 'nope') === 'top' && effectivePosition(undefined, undefined) === 'top', 'nothing valid: the top');
check(clampWidth(undefined) === STACK_WIDTH.default && clampWidth('x') === STACK_WIDTH.default && clampWidth(-3) === STACK_WIDTH.default, 'width: junk = the default');
check(clampWidth(2) === STACK_WIDTH.min && clampWidth(999) === STACK_WIDTH.max && clampWidth(20.3) === 20.5, 'width: clamped, half steps');
check(dragWidth(15, 80, 8, 'left') === 25 && dragWidth(15, 40, 8, 'right') === 10, 'drag: a left stack grows rightwards, a right stack leftwards');
check(dragWidth(15, 4000, 8, 'left') === STACK_WIDTH.max && dragWidth(15, 26, 0, 'left') === 17, 'drag: clamped; no measured step = 13 px steps');
check(keyWidth(18, 'ArrowRight', 'left') === 19 && keyWidth(18, 'ArrowLeft', 'left') === 17 && keyWidth(18, 'ArrowLeft', 'right') === 19, 'keys: arrows towards the panes widen');
check(keyWidth(18, 'Home', 'left') === STACK_WIDTH.min && keyWidth(18, 'End', 'right') === STACK_WIDTH.max && keyWidth(18, 'a', 'left') === null, 'keys: Home / End; other keys ignored');
check(initials('Janitor Joey') === 'JJ' && initials("Landin' Lenny") === 'LL' && initials('amber') === 'AM' && initials('  ') === '?', 'avatar initials');
check(Object.values(DEVICE_KEYS).every((k) => k.startsWith('terminal.tabs.')), 'per-device keys under terminal.tabs.');

// wiring: the stack is reachable everywhere Brett asked for
const host = read('apps/console-web/plugins/console-terminal/web/TerminalHost.tsx');
const stack = read('apps/console-web/plugins/console-terminal/web/TabStack.tsx');
const css = read('apps/console-web/plugins/console-terminal/web/terminal.css');
const store = read('apps/console-web/plugins/console-terminal/server/store.py');
const manifest = JSON.parse(read('apps/console-web/plugins/console-terminal/plugin.json'));
check(/<TabStack /.test(host) && /positionItems\(tp/.test(host), 'the host draws the stack and the tab menu has Tab position');
check(/role="tablist" aria-orientation=/.test(stack) && /role="separator"/.test(stack), 'stack: a vertical tablist with a resize separator');
check(/is-drawer/.test(stack) && /touchstart/.test(stack), 'stack: slide-out with a swipe on a narrow window');
check(/\.axp-wt--tabs-at-left \.axp-wt__strip > \.axp-wt__tab/.test(css) && /--axp-wt-stack-n/.test(css), 'css: the strip hides its tabs; panes make room');
check(!/\d+px/.test(css.slice(css.indexOf('/* Tab position')).replace(/999px/g, '')), 'css: no px in the stack styles but pill radii (tokens only)');
check(/"tabPosition": \("top", "left", "right", "bottom"\)/.test(store), 'server: tabPosition is a validated choice');
const items = manifest.commands?.items ?? [];
check(['GET /tab-position', 'PUT /tab-position'].every((r) => items.some((i: { route?: string }) => i.route === r)) && items.some((i: { action?: string }) => i.action === 'terminal.tabs.position'),
  'commands: get / set the default (REST, MCP, CLI) and set this device (action)');
console.log(`${ok} checks passed`);
