/**
 * Console commands (core/engines/console-commands.mjs; build console-commands, Nov 2026): the console domain of control@1.
 * Checks: catalog from search entries + actions, resolve (id, sub-tab path, title, words, ambiguous, nothing), action
 * policy (navigate / write / destructive, the action's own `requires`), client picking (recent, all, id, stale), the
 * runner end to end after the gate (list, get, open, run, confirm, back, clients, no console), and the message check.
 *   npx -y tsx framework/spec/check-console-commands.mts
 */
import assert from 'node:assert/strict';
import { controlGate } from '../core/engines/control-rules.mjs';
import {
  CONSOLE_CLIENT_STALE_MS, CONSOLE_TOOLS, consoleActionConfirm, consoleActionEffect, consoleActionNeeds, consoleCatalogFrom, consoleMessage, consoleMessageErrors,
  consolePickClients, consoleResolve, consoleSearch, normalizeConsoleCatalog, runConsoleCommand,
  consoleValueItems, consoleValueErrors, consoleElementId, consoleElementResolve, consoleElementDestructive, CONSOLE_OPS,
} from '../core/engines/console-commands.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

/* ---- catalog ---- */
const entries = [
  { kind: 'view', label: 'Plan Studio', icon: 'map', keywords: ['plans'], focus: { kind: 'view', view: 'plan-studio' } },
  { kind: 'view', label: 'Build orchestrator', focus: { kind: 'view', view: 'build-orchestrator' } },
  { kind: 'view', label: 'Builds', focus: { kind: 'view', view: 'builds' } },
  { kind: 'view', label: 'Home', focus: { kind: 'view', view: 'home' } },
  { kind: 'view', label: 'Theme manager', focus: { kind: 'view', view: 'theme-manager' } },
  { kind: 'view', label: 'Token control', focus: { kind: 'view', view: 'token-control' } },
  { kind: 'settings-tab', label: 'Token control settings', detail: 'Settings', focus: { kind: 'setting', tab: 'token-control' } },
  { kind: 'settings-tab', label: 'Appearance settings', focus: { kind: 'setting', tab: 'appearance' } },
  { kind: 'settings-tab', label: 'Plugins settings', focus: { kind: 'setting', tab: 'plugins' } },
  { kind: 'dialog', label: 'Asset JSON', focus: { kind: 'dialog', id: 'asset-json' } },
  { kind: 'setting', label: 'Compact mode', focus: { kind: 'setting', tab: 'appearance', anchor: 'setting:compact' } },
  { kind: 'action', label: 'Randomize assets', focus: { kind: 'action', spec: 'assets.random' } },
];
const actions = [
  { id: 'assets.random', meta: { label: 'Randomize assets', requires: 'assets.swap' } },
  { id: 'assets.reset', meta: { label: 'Reset to defaults' } },
  { id: 'nav', meta: { label: 'Navigate', params: true } },
  { id: 'terminal.open', meta: { label: 'Open output terminal' } },
  { id: 'swap', meta: { label: 'Swap asset', params: true, requires: 'assets.swap' } },
  { id: 'file.save', meta: { label: 'Save', stub: true } },
  { id: 'plans.archive', meta: { label: 'Archive plan', effect: 'destructive' } },
];
const cat = consoleCatalogFrom(entries, actions, { app: 'console-web', here: { screen: 'home' } });
eq(cat.items.filter((i) => i.kind === 'screen').map((i) => i.id), ['plan-studio', 'build-orchestrator', 'builds', 'home', 'theme-manager', 'token-control'], 'views become screens');
eq(cat.items.find((i) => i.kind === 'settings' && i.id === 'token-control')!.label, 'Token control', '" settings" dropped from tab labels');
ok(!cat.items.some((i) => i.id === 'file.save'), 'stub actions are left out');
ok(!cat.items.some((i) => i.label === 'Compact mode'), 'single settings are not catalog items (their tab is)');
ok(cat.items.find((i) => i.id === 'nav')!.params === true, 'params kept');
eq(cat.here, { screen: 'home' }, 'here kept');
eq(normalizeConsoleCatalog({ items: [{ kind: 'screen', id: 'a' }, { kind: 'screen', id: 'a' }, { kind: 'bogus', id: 'b' }, { kind: 'dialog' }] }).items, [{ kind: 'screen', id: 'a', label: 'a' }], 'de-duplicated, unknown kinds and id-less items dropped');

/* ---- resolve ---- */
const items = cat.items;
eq(consoleResolve(items, 'screen', 'plan-studio').item?.id, 'plan-studio', 'by id');
eq(consoleResolve(items, 'screen', 'PLAN-STUDIO').item?.id, 'plan-studio', 'id is case-insensitive');
eq(consoleResolve(items, 'screen', 'Plan Studio').item?.id, 'plan-studio', 'by title');
eq(consoleResolve(items, 'screen', 'open the plan studio screen please').item?.id, 'plan-studio', 'filler words ignored');
eq(consoleResolve(items, 'screen', 'orchestrator').item?.id, 'build-orchestrator', 'by one word');
eq(consoleResolve(items, 'screen', 'plans').item?.id, 'plan-studio', 'by keyword');
eq(consoleResolve(items, 'screen', 'builds').item?.id, 'builds', 'exact word beats a longer label');
eq(consoleResolve(items, 'settings', 'plugins/token-control').item?.id, 'token-control', 'sub-tab path');
eq(consoleResolve(items, 'settings', 'token control settings').item?.id, 'token-control', 'tab by title with "settings"');
const sw = consoleResolve(items, 'action', 'swap:color-theme:dark');
ok(sw.item?.id === 'swap' && sw.args?.join(',') === 'color-theme,dark', 'action spec → id + args');
eq(consoleResolve(items, 'screen', 'spreadsheet').candidates, [], 'nothing found');
const amb = consoleResolve([{ kind: 'screen', id: 'a', label: 'Build log' }, { kind: 'screen', id: 'b', label: 'Build list' }], 'screen', 'build');
ok(amb.ambiguous && amb.candidates!.length === 2, 'a tie is ambiguous');
eq(consoleSearch(items, 'screen', 'theme').map((i) => i.id), ['theme-manager'], 'search');
eq(consoleSearch(items, 'screen').length, 6, 'no words = every item of the kind');

/* ---- action policy ---- */
eq(consoleActionEffect({ id: 'nav' }), 'navigate', 'nav navigates');
eq(consoleActionEffect({ id: 'settings.open' }), 'navigate', 'settings.open navigates');
eq(consoleActionEffect({ id: 'windows.restore' }), 'navigate', 'windows navigate');
eq(consoleActionEffect({ id: 'assets.reset' }), 'destructive', 'reset is destructive');
eq(consoleActionEffect({ id: 'appearance.restore' }), 'destructive', 'restore is destructive');
eq(consoleActionEffect({ id: 'assets.random' }), 'write', 'anything else writes');
eq(consoleActionEffect({ id: 'plans.archive', effect: 'destructive' }), 'destructive', 'declared effect wins');
eq(consoleActionEffect({ id: 'assets.reset', effect: 'read' }), 'navigate', 'declared read = navigate');
eq(consoleActionNeeds({ id: 'assets.random', requires: 'assets.swap' }).needs, ['control.console.write', 'assets.swap'], 'write + the action\'s own permission');
eq(consoleActionNeeds({ id: 'nav', requires: 'x' }).needs, ['control.console.navigate'], 'navigation needs navigate only');

/* ---- clients ---- */
const NOW = 1_800_000_000_000;
const clients = [
  { id: 'phone', app: 'console-web', title: 'Dev Console', device: 'phone', user: 'brett', lastUsed: NOW - 5_000, lastSeen: NOW - 1_000, here: { screen: 'home' }, catalog: cat },
  { id: 'desk', app: 'console-web', title: 'Dev Console', device: 'desktop', user: 'brett', lastUsed: NOW - 60_000, lastSeen: NOW - 2_000, here: { screen: 'builds' }, catalog: cat },
  { id: 'old', lastUsed: NOW - 1_000, lastSeen: NOW - CONSOLE_CLIENT_STALE_MS - 1, catalog: cat },
];
eq(consolePickClients(clients, 'recent', NOW).map((c) => c.id), ['phone'], 'recent = used last, stale left out');
eq(consolePickClients(clients, 'all', NOW).map((c) => c.id), ['phone', 'desk'], 'all live ones');
eq(consolePickClients(clients, 'desk', NOW).map((c) => c.id), ['desk'], 'one by id');
eq(consolePickClients(clients, 'old', NOW).length, 0, 'a stale id is gone');

/* ---- runner (after the gate) ---- */
const salt = 'check';
const ctx = { clients, grants: ['*'], salt, now: NOW, id: 'm1', by: 'claude' };
const gated = (cmd: Record<string, unknown>, grants: string[] = ['*']) => controlGate(cmd, grants, { salt, now: NOW });
const open = { op: 'act', target: 'console.screens', path: 'plan studio', action: 'open', by: 'claude' };
ok(gated(open, ['control.console.navigate']).ok, 'opening passes the gate with navigate alone');
const r1 = runConsoleCommand(open, ctx);
ok(r1.ok && r1.deliver!.to.join() === 'phone' && r1.deliver!.message.op === 'open' && r1.deliver!.message.target === 'plan-studio' && r1.deliver!.message.kind === 'screen', 'open → a message to the console used last');
eq(consoleMessageErrors(r1.ok ? r1.deliver!.message : null), [], 'the message is valid');
const r2 = runConsoleCommand({ ...open, input: { to: 'all' } }, ctx);
ok(r2.ok && r2.deliver!.to.join() === 'phone,desk', 'to all');
const r3 = runConsoleCommand({ op: 'act', target: 'console.settings', path: 'plugins/token-control', action: 'open', input: { anchor: 'settings-group:remote' } }, ctx);
ok(r3.ok && r3.deliver!.message.kind === 'settings' && r3.deliver!.message.anchor === 'settings-group:remote', 'settings sub-tab with an anchor');
const r4 = runConsoleCommand({ op: 'act', target: 'console.screens', path: 'spreadsheet', action: 'open' }, ctx);
ok(!r4.ok && r4.code === 'not_found', 'unknown screen → not_found');
const r5 = runConsoleCommand({ op: 'list', target: 'console.screens', select: { q: 'build' } }, ctx);
ok(r5.ok && (r5.data.items as { id: string }[]).map((i) => i.id).sort().join() === 'build-orchestrator,builds', `list with words (${r5.ok ? (r5.data.items as { id: string }[]).map((i) => i.id).join() : ''})`);
const r6 = runConsoleCommand({ op: 'get', target: 'console.nav', path: 'here' }, ctx);
ok(r6.ok && (r6.data.value as { screen: string }).screen === 'home', 'where the console is');
const r7 = runConsoleCommand({ op: 'act', target: 'console.nav', path: 'here', action: 'back' }, ctx);
ok(r7.ok && r7.deliver!.message.op === 'back', 'back');
const r8 = runConsoleCommand({ op: 'list', target: 'console.clients' }, ctx);
ok(r8.ok && r8.data.total === 2 && !('catalog' in (r8.data.items as object[])[0]!), 'clients without catalogs');
// dialogs: act close (Amber closes what she opened)
const dialogAct = (path: string, action = 'close') => runConsoleCommand({ op: 'act', target: 'console.dialogs', path, action }, ctx);
ok(gated({ op: 'act', target: 'console.dialogs', path: 'current', action: 'close' }, ['control.console.navigate']).ok, 'closing a dialog passes the gate with navigate alone');
const c1 = dialogAct('current');
ok(c1.ok && c1.deliver!.message.op === 'close' && c1.deliver!.message.kind === 'dialog' && !c1.deliver!.message.target, 'close "current" → whichever dialog is open');
eq(consoleMessageErrors(c1.ok ? c1.deliver!.message : null), [], 'the close message is valid');
const c2 = dialogAct('asset json');
ok(c2.ok && c2.deliver!.message.op === 'close' && c2.deliver!.message.target === 'asset-json', 'close a named dialog → only that one');
const c3 = dialogAct('spreadsheet');
ok(!c3.ok && c3.code === 'not_found', 'close an unknown dialog → not_found');
const c4 = dialogAct('asset json', 'open');
ok(c4.ok && c4.deliver!.message.op === 'open' && c4.deliver!.message.target === 'asset-json', 'open still opens');
const r9 = runConsoleCommand(open, { ...ctx, clients: [] });
ok(!r9.ok && r9.code === 'not_found' && r9.message.includes('no console is open'), 'no console → says so');
// actions: policy
const run = (path: string, grants: string[], extra: Record<string, unknown> = {}) => runConsoleCommand({ op: 'act', target: 'console.actions', path, action: 'run', ...extra }, { ...ctx, grants });
const a1 = run('terminal.open', ['control.console.navigate']);
ok(a1.ok && a1.deliver!.message.spec === 'terminal.open', 'a navigating action runs with navigate');
const a2 = run('assets.random', ['control.console.write']);
ok(!a2.ok && a2.code === 'denied' && a2.requires === 'assets.swap', 'a writing action also needs its own permission');
ok(run('assets.random', ['control.console.write', 'assets.swap']).ok, '… and runs with it');
const a3 = run('Reset to defaults', ['*']);
ok(!a3.ok && a3.code === 'confirmation_required' && typeof a3.confirm === 'string', 'a destructive action asks for confirmation');
const a4 = run('assets.reset', ['*'], { confirm: a3.ok ? '' : a3.confirm });
ok(a4.ok && a4.deliver!.message.spec === 'assets.reset', 'the same action with the token runs');
eq(a3.ok ? '' : a3.confirm, consoleActionConfirm('assets.reset', salt, NOW), 'confirm bound to the spec');
ok(!run('swap', ['*']).ok, 'a params action without args is refused');
const a5 = run('swap', ['*'], { input: { args: ['color-theme', 'dark'] } });
ok(a5.ok && a5.deliver!.message.spec === 'swap:color-theme:dark', 'args join the spec');
ok(!run('assets.reset', ['control.console.write']).ok, 'write does not cover a destructive action');

/* ---- window screens (full-api-control): an action with meta.screen is a screen too ---- */
const wcat = consoleCatalogFrom([], [{ id: 'terminal.toolbar', meta: { label: 'Terminal (new sessions first)', screen: 'terminal', effect: 'navigate' } }, { id: 'secret.open', meta: { label: 'Secret', screen: 'secret', personOnly: true } }]);
const wscreen = wcat.items.find((i) => i.kind === 'screen' && i.id === 'terminal');
ok(!!wscreen && wscreen.action === 'terminal.toolbar' && wscreen.label === 'Terminal', 'an action naming a screen lists it as a screen (label from the id, the action kept)');
ok(wcat.items.some((i) => i.kind === 'action' && i.id === 'terminal.toolbar'), 'the action stays an action too');
ok(!wcat.items.some((i) => i.id === 'secret'), 'a person-only action names no screen');
eq(consoleResolve(wcat.items, 'screen', 'terminal').item?.id, 'terminal', '"terminal" resolves as a screen');
eq(consoleResolve(wcat.items, 'screen', 'open the terminal').item?.id, 'terminal', 'and by words');

/* ---- setting values (console.values, full-api-control) ---- */
const vitems = consoleValueItems([{ tab: 'display', label: 'Display', settings: [
  { key: 'axf.display.compact', label: 'Compact mode', kind: 'toggle' },
  { key: 'axf.display.fontScale', label: 'Text size', kind: 'slider', min: 0.8, max: 1.6, step: 0.05 },
  { key: 'axf.display.density', label: 'Density', kind: 'choice', options: [{ value: 'compact', label: 'Compact' }, { value: 'roomy', label: 'Roomy' }] },
  { key: 'axf.ai.key', label: 'API key', kind: 'secret' },
  { key: 'axf.display.head', label: 'Heading', kind: 'section' },
] }]);
eq(vitems.map((i) => i.id), ['axf.display.compact', 'axf.display.fontScale', 'axf.display.density', 'axf.ai.key'], 'every setting with a value is an item (sections are not)');
eq(consoleValueErrors(vitems[0], 'yes').length, 1, 'a switch takes true / false');
eq(consoleValueErrors(vitems[1], 2).length, 1, 'a slider keeps its range');
eq(consoleValueErrors(vitems[1], 1.1), [], 'in range passes');
eq(consoleValueErrors(vitems[2], 'tiny').length, 1, 'a choice keeps its options');
eq(consoleValueErrors(null, { a: 1 }).length, 1, 'an undeclared key takes only plain values');
const vcat = normalizeConsoleCatalog({ items: [...cat.items, ...vitems] });
ok(vcat.items.find((i) => i.id === 'axf.display.fontScale')?.max === 1.6 && vcat.items.find((i) => i.id === 'axf.ai.key')?.secret === true, 'the catalog keeps kind, range and secret');
const vctx = { ...ctx, clients: clients.map((c) => ({ ...c, catalog: vcat })) };
const vr = (cmd: Record<string, unknown>) => runConsoleCommand(cmd, vctx) as { ok: boolean; data?: Record<string, unknown>; deliver?: { message: Record<string, unknown> }; message?: string };
eq((vr({ op: 'list', target: 'console.values', select: { tab: 'display' } }).data as { total: number }).total, 4, 'list by tab');
const vg = vr({ op: 'get', target: 'console.values', path: 'text size' });
ok(vg.ok && vg.deliver!.message.op === 'read' && vg.deliver!.message.target === 'axf.display.fontScale', 'get by label words reads the key in the console');
ok(!vr({ op: 'get', target: 'console.values', path: 'axf.ai.key' }).ok, 'a secret is never read back');
const vs = vr({ op: 'set', target: 'console.values', path: 'axf.display.compact', value: true });
ok(vs.ok && vs.deliver!.message.op === 'set' && vs.deliver!.message.arg === 'true', 'set sends the JSON value');
ok(!vr({ op: 'set', target: 'console.values', path: 'axf.display.compact', value: 'nope' }).ok, 'a wrong value is refused before it is sent');
ok(vr({ op: 'set', target: 'console.values', path: 'axf.toolbar.main.tapConfirm', value: 'off' }).ok, 'an undeclared key (toolbar settings) can be set');
eq(vr({ op: 'reset', target: 'console.values', path: 'axf.display.density' }).deliver!.message.op, 'unset', 'reset unsets it');
ok(gated({ op: 'set', target: 'console.values', path: 'axf.display.compact', value: true }, ['control.console.read']).ok === false, 'set needs write');
ok(gated({ op: 'set', target: 'console.values', path: 'axf.x', value: ['a', 'b'] }).ok, 'a list of strings is a value (multi choice)');

/* ---- elements on screen (console.elements) ---- */
eq(consoleElementId({ where: 'Plan / Studio', role: 'button', label: 'Save  draft' }), 'Plan ∕ Studio/button:Save draft', 'id = where/role:label, slashes in names folded');
eq(consoleElementId({ where: 'toolbar', role: 'button', label: 'Save', n: 2 }), 'toolbar/button:Save#2', 'the second of the same label gets #2');
eq(consoleElementId({ own: 'my-id', where: 'x', role: 'button', label: 'y' }), 'my-id', 'data-axf-id wins');
const els = [{ id: 'toolbar/button:Save', label: 'Save', role: 'button', where: 'toolbar' }, { id: 'toolbar/button:Save as', label: 'Save as', role: 'button', where: 'toolbar' }, { id: 'list/button:Delete plan', label: 'Delete plan', role: 'button', where: 'list' }];
eq(consoleElementResolve(els, 'toolbar/button:Save').item?.id, 'toolbar/button:Save', 'by id');
eq(consoleElementResolve(els, 'save').item?.id, 'toolbar/button:Save', 'by words: the exact label wins');
ok(consoleElementDestructive(els[2]) && !consoleElementDestructive(els[0]) && consoleElementDestructive({ label: 'Go', danger: true }), 'deleting labels and danger styles are destructive');
const er = (cmd: Record<string, unknown>, grants = ['*']) => runConsoleCommand(cmd, { ...ctx, grants }) as { ok: boolean; data?: Record<string, unknown>; deliver?: { message: Record<string, unknown> }; code?: string };
const el1 = er({ op: 'list', target: 'console.elements', select: { q: 'toolbar' } });
ok(el1.ok && el1.deliver!.message.op === 'elements' && el1.deliver!.message.arg === 'toolbar', 'list goes to the console with the words');
const ep = er({ op: 'act', target: 'console.elements', path: 'Delete plan', action: 'press' });
ok(ep.ok && ep.deliver!.message.op === 'press' && ep.deliver!.message.verb === 'press' && !ep.deliver!.message.confirmed && typeof ep.data!.confirmToken === 'string', 'a press goes with a confirm token held back for the server');
const tok = ep.data!.confirmToken as string;
const ep2 = er({ op: 'act', target: 'console.elements', path: 'Delete plan', action: 'press', confirm: tok });
ok(ep2.ok && ep2.deliver!.message.confirmed === true, 'the confirm token marks the press confirmed');
eq(er({ op: 'act', target: 'console.elements', path: 'Delete plan', action: 'press', confirm: tok }, ['control.console.write']).code, 'denied', 'a confirmed press needs control.console.delete');
eq(er({ op: 'act', target: 'console.elements', path: 'Delete plan', action: 'press', confirm: 'bogus' }).code, 'validation', 'a wrong token is refused');
eq(er({ op: 'act', target: 'console.elements', path: 'Name', action: 'set' }).code, 'validation', 'set needs input.value');
eq(JSON.parse(String(er({ op: 'act', target: 'console.elements', path: 'Compact', action: 'toggle', input: { on: false } }).deliver!.message.arg)), { on: false }, 'toggle carries on');
ok(['read', 'set', 'unset', 'elements', 'press'].every((o) => CONSOLE_OPS.includes(o)), 'the new message ops are known');
eq(consoleMessageErrors({ $axf: 'console-command@1', op: 'press', target: 'x', verb: 'smash' }).length, 1, 'an unknown verb is refused by the console too');

/* ---- messages ---- */
ok(consoleMessageErrors({ $axf: 'console-command@1', op: 'open', kind: 'action', target: 'x' }).length === 1, 'open of an action refused');
ok(consoleMessageErrors({ $axf: 'console-command@1', op: 'explode' }).length === 1, 'unknown op refused');
ok(consoleMessageErrors({ op: 'back' }).length === 1, 'frame required');
eq(consoleMessage({ op: 'back' }, { id: 'x', by: 'me', now: NOW }), { $axf: 'console-command@1', id: 'x', op: 'back', by: 'me', at: new Date(NOW).toISOString() }, 'message shape');
eq(CONSOLE_TOOLS.length, 13, 'thirteen MCP shortcut tools (value, elements, press since full-api-control; link since ui-api-parity-rule)');

console.log(`✓ console commands — ${n} checks`);
