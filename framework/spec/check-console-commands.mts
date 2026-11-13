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
  CONSOLE_CLIENT_STALE_MS, CONSOLE_LATE_MS, CONSOLE_TOOLS, consoleActionConfirm, consoleActionEffect, consoleActionNeeds, consoleCatalogFrom, consoleFieldValue, consoleMessage, consoleMessageErrors,
  consoleMessageLate, consolePickClients, consoleResolve, consoleSearch, consoleSplitFocus, normalizeConsoleCatalog, runConsoleCommand,
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
  { kind: 'field', label: 'Text size', detail: 'Settings › Appearance › Display', keywords: ['axf.display.fontScale'], focus: { tab: 'appearance', key: 'axf.display.fontScale' }, field: { type: 'slider', value: 100, min: 80, max: 140 } },
  { kind: 'field', label: 'Help mode', detail: 'Settings › Help', focus: { tab: 'help', key: 'axf.help.mode' }, field: { type: 'toggle', value: false } },
  { kind: 'field', label: 'Hub token', detail: 'Settings › Token control', focus: { tab: 'token-control', key: 'axf.hub.token' }, field: { type: 'secret', secret: true, value: 'leak' } },
  { kind: 'field', label: 'Layout', detail: 'Settings › Appearance', focus: { tab: 'appearance', key: 'axf.layout' }, field: { type: 'choice', value: 'tabs-top', options: [{ value: 'tabs-top', label: 'Top' }, { value: 'list', label: 'List' }] } },
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
ok(!cat.items.some((i) => i.label === 'Compact mode'), 'search-index setting rows are not catalog items (fields come as kind field)');
const fsz = cat.items.find((i) => i.kind === 'field' && i.id === 'axf.display.fontScale')!;
eq([fsz.parent, fsz.type, fsz.value, fsz.min, fsz.max], ['appearance', 'slider', '100', 80, 140], 'a field keeps its tab, kind, value as text and range');
const tok = cat.items.find((i) => i.id === 'axf.hub.token')!;
ok(tok.secret === true && tok.value === undefined, 'a secret field never carries its value');
eq(cat.items.find((i) => i.id === 'axf.layout')!.options, ['tabs-top', 'list'], 'choices by value');
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

/* ---- messages ---- */
ok(consoleMessageErrors({ $axf: 'console-command@1', op: 'open', kind: 'action', target: 'x' }).length === 1, 'open of an action refused');
ok(consoleMessageErrors({ $axf: 'console-command@1', op: 'explode' }).length === 1, 'unknown op refused');
ok(consoleMessageErrors({ op: 'back' }).length === 1, 'frame required');
eq(consoleMessage({ op: 'back' }, { id: 'x', by: 'me', now: NOW }), { $axf: 'console-command@1', id: 'x', op: 'back', by: 'me', at: new Date(NOW).toISOString() }, 'message shape');
eq(CONSOLE_TOOLS.length, 9, 'nine MCP shortcut tools');

/* ---- focus on a screen (console-commands-reliable, Nov 11 2026): a tab or an item after the screen's name ---- */
{
  const screens = cat.items.filter((i) => i.kind === 'screen');
  eq(consoleResolve(screens, 'screen', 'build-orchestrator pending'), { item: screens.find((i) => i.id === 'build-orchestrator'), focus: 'pending' }, 'screen id + tab');
  eq(consoleResolve(screens, 'screen', 'Build orchestrator / my-build').focus, 'my-build', 'screen title + item');
  eq(consoleResolve(screens, 'screen', 'build-orchestrator:console-commands-reliable').focus, 'console-commands-reliable', 'screen id: item');
  eq(consoleResolve(screens, 'screen', 'builds queue').item?.id, 'builds', 'the longest exact screen name wins, and only a whole name');
  eq(consoleResolve(screens, 'screen', 'plan studio').focus, undefined, 'a plain title has no focus');
  eq(consoleResolve(screens, 'screen', 'open the build orchestrator approvals').focus, 'approvals', 'leading words people add');
  eq(consoleSplitFocus(screens, 'build-orchestrator'), null, 'nothing after the name');
  eq(consoleSplitFocus(screens, 'build-orchestratorx y'), null, 'a name must end at a separator');
  const live = [{ id: 'tab', lastUsed: Date.now(), lastSeen: Date.now(), catalog: cat }];
  const g = (path: string, input?: Record<string, unknown>) => runConsoleCommand({ op: 'act', target: 'console.screens', path, action: 'open', ...(input ? { input } : {}) } as never, { clients: live, id: 'f1' });
  const a = g('build-orchestrator pending');
  ok(a.ok && a.deliver?.message.focus === 'pending' && a.deliver.message.target === 'build-orchestrator' && (a.data as { focus?: string }).focus === 'pending', 'open carries focus');
  const b = g('build-orchestrator', { focus: 'my-build' });
  ok(b.ok && b.deliver?.message.focus === 'my-build', 'input.focus wins');
  const c = runConsoleCommand({ op: 'act', target: 'console.settings', path: 'appearance', action: 'open', input: { focus: 'x' } } as never, { clients: live, id: 'f2' });
  ok(c.ok && c.deliver?.message.focus === 'x', 'a settings tab carries focus too (its <tab>.focus action runs it)');
  const cs = runConsoleCommand({ op: 'act', target: 'console.settings', path: 'appearance/x#1', action: 'open' } as never, { clients: live, id: 'f3' });
  ok(cs.ok && cs.deliver?.message.target === 'appearance' && cs.deliver.message.focus === 'x#1', 'settings "<tab>/<item>" splits the focus off');
}

/* ---- single settings (fields): open, get, list, values ---- */
{
  const f1 = runConsoleCommand({ op: 'act', target: 'console.settings', path: 'text size', action: 'open' }, ctx);
  ok(f1.ok && f1.deliver!.message.kind === 'settings' && f1.deliver!.message.target === 'appearance' && f1.deliver!.message.anchor === 'setting:axf.display.fontScale', 'a field by name opens its tab scrolled to it');
  const f2 = runConsoleCommand({ op: 'act', target: 'console.settings', path: 'appearance', action: 'open' }, ctx);
  ok(f2.ok && f2.deliver!.message.target === 'appearance' && !f2.deliver!.message.anchor, 'a tab name still opens the tab');
  const f3 = runConsoleCommand({ op: 'get', target: 'console.settings', path: 'field:axf.help.mode' }, ctx);
  ok(f3.ok && f3.data.value === 'false', 'get reads a field value');
  const f4 = runConsoleCommand({ op: 'get', target: 'console.settings', path: 'token-control/axf.hub.token' }, ctx);
  ok(f4.ok && f4.data.value === null, 'a secret reads as null');
  const f5 = runConsoleCommand({ op: 'list', target: 'console.settings', select: { q: 'help' } }, ctx);
  ok(f5.ok && (f5.data.items as { kind: string }[]).some((i) => i.kind === 'field'), 'a search lists fields after tabs');
  const f6 = runConsoleCommand({ op: 'list', target: 'console.settings' }, ctx);
  ok(f6.ok && !(f6.data.items as { kind: string }[]).some((i) => i.kind === 'field'), 'no search = tabs only');
  ok(gated({ op: 'act', target: 'console.settings', path: 'text size', action: 'open' }, ['control.console.navigate']).ok, 'opening a field needs navigate only');
  eq(consoleFieldValue({ type: 'toggle' }, 'on'), { value: true }, 'toggle on');
  eq(consoleFieldValue({ type: 'toggle' }, 'toggle', true), { value: false }, 'toggle flips');
  eq(consoleFieldValue({ type: 'slider', min: 80, max: 140 }, '120'), { value: 120 }, 'slider number');
  ok(consoleFieldValue({ type: 'slider', min: 80, max: 140 }, '200').error, 'out of range refused');
  eq(consoleFieldValue({ kind: 'choice', options: [{ value: 'tabs-top', label: 'Top' }] }, 'TABS-TOP'), { value: 'tabs-top' }, 'a choice by value, any case (SettingSpec shape)');
  ok(consoleFieldValue({ type: 'choice', options: ['a'] }, 'b').error, 'unknown choice refused');
  eq(consoleFieldValue({ type: 'multi_choice', options: ['a', 'b'] }, 'a, b'), { value: ['a', 'b'] }, 'multi choice');
  eq(consoleFieldValue({ type: 'text' }, 'https://x:1'), { value: 'https://x:1' }, 'text as sent');
  ok(consoleFieldValue({ type: 'action' }, 'x').error, 'an action row has no value');
  const s1 = runConsoleCommand({ op: 'act', target: 'console.actions', path: 'settings.set', action: 'run', input: { args: ['axf.help.mode', 'on'] } }, { ...ctx, clients: [{ ...clients[0], catalog: consoleCatalogFrom(entries, [...actions, { id: 'settings.set', meta: { label: 'Change one setting', params: true, effect: 'write' } }]) }] });
  ok(s1.ok && s1.deliver!.message.spec === 'settings.set:axf.help.mode:on', 'settings.set runs through console.actions');
}

/* ---- liveness + late commands ---- */
ok(CONSOLE_CLIENT_STALE_MS <= 60_000, 'a console that stopped beating drops within a minute');
{
  const NOW2 = Date.parse('2026-11-11T10:00:00Z');
  const m = consoleMessage({ op: 'open', kind: 'screen', target: 'home' }, { id: 'l', now: NOW2 });
  eq(consoleMessageLate(m, NOW2 + 1_000), false, 'on time');
  eq(consoleMessageLate(m, NOW2 + CONSOLE_LATE_MS + 1), true, 'a live command that reached a waking tab late is skipped');
  eq(consoleMessageLate({ ...m, delivery: 'queued' }, NOW2 + CONSOLE_LATE_MS * 10), false, 'a queued command always runs');
}

console.log(`✓ console commands — ${n} checks`);
