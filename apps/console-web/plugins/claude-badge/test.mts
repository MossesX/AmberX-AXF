/** Badges: the pure model. `npx -y tsx apps/console-web/plugins/claude-badge/test.mts` */
import { BADGES, ICONS, KINDS, STATE_IDS, iconKey, iconOf, keyOf, labelOf, meterText, orderOf, shapeOf, shownOf, sideOf, tapPlan } from './web/model.ts';
import type { UsageResult } from './web/model.ts';

let n = 0;
const ok = (v: unknown, what: string) => { n += 1; if (!v) throw new Error(`FAILED: ${what}`); };
const settings = (o: Record<string, unknown>) => (k: string) => o[k];
const none = settings({});

ok(KINDS.length === 5 && ['console', 'vps', 'axhub', 'amberx', 'usage'].every((k) => k in BADGES), 'five badges');
ok(new Set(KINDS.map((k) => BADGES[k].id)).size === 5 && KINDS.every((k) => !BADGES[k].id.includes('.')), 'ids are unique and plain (a dotted id is dropped silently)');
for (const k of KINDS) for (const st of STATE_IDS) ok(ICONS.includes(BADGES[k].states[st].icon), `${k} ${st}: its default icon can be picked`);
ok(iconKey('console', 'ok') === 'claude-badge.icon.ok' && iconKey('console', 'warn') === 'claude-badge.icon.no-credit', 'the console keeps its old icon keys');
ok(iconKey('vps', 'warn') === 'claude-badge.vps.icon.no-credit', 'the VPS badge too');
ok(keyOf('console', 'show') === 'claude-badge.console.show' && keyOf('vps', 'icon-only') === 'claude-badge.vps.icon-only', 'and its show and icons-only keys');
ok(new Set(KINDS.flatMap((k) => STATE_IDS.map((st) => iconKey(k, st)))).size === 20, 'no two icons share a key');
ok(iconOf(settings({ [iconKey('axhub', 'error')]: 'bell' }), 'axhub', 'error') === 'bell', 'a picked icon');
ok(iconOf(settings({ [iconKey('axhub', 'error')]: 'nope' }), 'axhub', 'error') === 'alert', 'an unknown icon falls back');
ok(shownOf(none, 'usage') && !shownOf(settings({ [keyOf('usage', 'show')]: false }), 'usage'), 'show or hide');
ok(shapeOf(none, 'amberx') === 'pill' && shapeOf(settings({ [keyOf('amberx', 'icon-only')]: true }), 'amberx') === 'icon', 'icons only');
ok(labelOf(settings({ [keyOf('vps', 'label')]: '  Box ' }), 'vps') === 'Box' && labelOf(none, 'vps') === '', 'label text');
ok(orderOf(none, 'vps') === 6 && orderOf(settings({ [keyOf('vps', 'order')]: 2 }), 'vps') === 2 && orderOf(settings({ [keyOf('vps', 'order')]: 'x' }), 'vps') === 6, 'order');
ok(sideOf(none, 'axhub') === 'right' && sideOf(none, 'usage') === 'left' && sideOf(settings({ [keyOf('usage', 'side')]: 'right' }), 'usage') === 'right', 'side');

ok(tapPlan(none, 'usage').do === 'drop', 'usage meter: drop-down by default');
ok(tapPlan(none, 'axhub').spec === 'hubstatus.open', 'axHub: its details by default');
ok(tapPlan(none, 'console').spec === 'settings.open:claude-badge', 'Claude: settings by default, as before');
const set = (o: object) => settings(Object.fromEntries(Object.entries(o).map(([k, v]) => [keyOf('usage', k as 'tap'), v])));
ok(tapPlan(set({ tap: 'none' }), 'usage').do === 'none', 'nothing');
ok(tapPlan(set({ tap: 'screen', 'tap-target': 'alerts' }), 'usage').spec === 'nav:alerts', 'a page id');
ok(tapPlan(set({ tap: 'screen', 'tap-target': 'settings.open:alerts' }), 'usage').spec === 'settings.open:alerts', 'an action');
ok(tapPlan(set({ tap: 'screen' }), 'usage').spec === 'settings.open:claude-badge', 'a screen with no target opens the badge settings');
ok(tapPlan(set({ tap: 'command', 'tap-target': 'terminal.claude' }), 'usage').spec === 'terminal.claude', 'a command');
ok(tapPlan(set({ tap: 'command' }), 'usage').do === 'none', 'a command with no target does nothing');
ok(tapPlan(set({ tap: 'toggle' }), 'usage').key === keyOf('usage', 'icon-only'), 'toggle flips Icons only by default');
ok(tapPlan(set({ tap: 'toggle', 'tap-target': 'x.y' }), 'usage').key === 'x.y', 'or a setting');
ok(tapPlan(set({ tap: 'bogus' }), 'usage').do === 'drop', 'a bad value is the default');

const r = (a: object): UsageResult => ({ at: 0, ready: true, why: '', active: 'a', state: 'ok', accounts: [{ name: 'a', type: 'login', active: true, plan: '', fresh: true, asOf: 1, status: 'ok', why: '', fiveHour: null, weekly: null, ...a }] });
const win = (used: number) => ({ used, resetsAt: '', locked: false });
ok(meterText(r({ fiveHour: win(12.4), weekly: win(13) })) === '5h 12% · wk 13%', 'meter words');
ok(meterText(r({ weekly: win(13) })) === '5h – · wk 13%', 'no 5-hour window open');
ok(meterText(r({ weekly: win(13) }), 'Max') === 'Max 5h – · wk 13%', 'a label in front');
ok(meterText(null) === 'no reading' && meterText(r({ status: 'no-meter' })) === 'no reading', 'nothing to read');
console.log(`claude-badge model: ${n} checks passed`);
