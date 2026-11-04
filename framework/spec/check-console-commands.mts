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
  APP_TOOLS, CONSOLE_CLIENT_STALE_MS, CONSOLE_TOOLS, clientAppId, consoleActionConfirm, consoleActionEffect, consoleActionNeeds, consoleCatalogFrom, consoleMessage, consoleMessageErrors,
  consolePickClients, consoleResolve, consoleSearch, normalizeApps, normalizeConsoleCatalog, resolveAppId, runConsoleCommand,
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

/* ---- messages ---- */
ok(consoleMessageErrors({ $axf: 'console-command@1', op: 'open', kind: 'action', target: 'x' }).length === 1, 'open of an action refused');
ok(consoleMessageErrors({ $axf: 'console-command@1', op: 'explode' }).length === 1, 'unknown op refused');
ok(consoleMessageErrors({ op: 'back' }).length === 1, 'frame required');
eq(consoleMessage({ op: 'back' }, { id: 'x', by: 'me', now: NOW }), { $axf: 'console-command@1', id: 'x', op: 'back', by: 'me', at: new Date(NOW).toISOString() }, 'message shape');
eq(CONSOLE_TOOLS.length, 8, 'eight MCP shortcut tools');

/* ---- apps: the same surface for every app (build apps-control-surface) ---- */
const apps = [
  { id: 'amberx-droid', label: 'AmberX', url: 'https://amberx.amberxai.com', kind: 'web+android', aliases: ['amberx', 'the phone'] },
  { id: 'molly', label: 'Molly', url: 'https://molly.amberxai.com', kind: 'web', aliases: ['molly'] },
];
eq(normalizeApps({ apps }).map((a) => a.id), ['amberx-droid', 'molly', 'axf-console'], 'the console is always in the registry');
eq(resolveAppId('AmberX', apps), 'amberx-droid', 'label → id');
eq(resolveAppId('the phone', apps), 'amberx-droid', 'alias → id');
eq(resolveAppId('console-web', apps), 'axf-console', 'the console\'s old client id → its app id');
eq(resolveAppId('Expenses App', apps), 'expenses-app', 'an unlisted app is its own id');
eq(resolveAppId('', apps), '', 'nothing given');
eq(clientAppId({ app: 'molly/console-web' }), 'axf-console', 'a hosted console is the console');
eq(clientAppId({ app: 'molly/amberx-droid' }), 'amberx-droid', 'a hosted app is that app');
eq(clientAppId({}), 'axf-console', 'a client without an app is a console (old clients)');
const amberCat = consoleCatalogFrom([
  { kind: 'view', label: 'To-dos', focus: { kind: 'view', view: 'todos' } }, { kind: 'view', label: 'Notes', focus: { kind: 'view', view: 'notes' } },
  { kind: 'view', label: 'Inbox', focus: { kind: 'view', view: 'inbox' } }, { kind: 'settings-tab', label: 'Voice settings', parent: 'plugins', focus: { kind: 'setting', tab: 'voice' } },
], [{ id: 'notes.new', meta: { label: 'New note' } }, { id: 'notes.clear', meta: { label: 'Clear notes' } }], { app: 'amberx-droid', here: { screen: 'inbox', extra: { list: 'Inbox', junk: 'x'.repeat(400) } }, items: [{ kind: 'screen', id: 'voice', label: 'Voice' }, { kind: 'bogus', id: 'z' }] });
eq(amberCat.items.filter((i) => i.kind === 'screen').map((i) => i.id), ['todos', 'notes', 'inbox', 'voice'], 'extra items join the catalog (bad ones dropped)');
eq(amberCat.here.extra, { list: 'Inbox', junk: 'x'.repeat(160) }, 'here.extra kept, values capped');
const everyClient = [
  ...clients,
  { id: 'amber-phone', app: 'amberx-droid', device: 'phone', lastUsed: NOW - 2_000, lastSeen: NOW - 1_000, here: { screen: 'inbox' }, catalog: amberCat },
  { id: 'amber-in-molly', app: 'molly/amberx-droid', host: 'molly', front: false, device: 'desktop', lastUsed: NOW - 500, lastSeen: NOW - 1_000, here: { screen: 'notes' }, catalog: amberCat },
  { id: 'molly-tab', app: 'molly', device: 'desktop', lastUsed: NOW - 9_000, lastSeen: NOW - 1_000, here: { screen: 'console', extra: { app: 'console' } }, catalog: consoleCatalogFrom([{ kind: 'view', label: 'Console', focus: { kind: 'view', view: 'console' } }], [{ id: 'xlayout.ide', meta: { label: 'IDE mode on / off' } }], { app: 'molly' }) },
];
eq(consolePickClients(everyClient, 'recent', NOW, 'amberx-droid').map((c) => c.id), ['amber-phone'], 'recent of an app: in front beats used last; other apps left out');
eq(consolePickClients(everyClient, 'all', NOW, 'axf-console').map((c) => c.id), ['phone', 'desk'], 'the console\'s clients only');
eq(consolePickClients(everyClient, 'recent', NOW).map((c) => c.id), ['amber-phone'], 'no app = every app (front first, then used last: the hidden Molly frame loses)');
const actx = { ...ctx, clients: everyClient, apps };
const l1 = runConsoleCommand({ op: 'list', target: 'apps.list' }, actx);
ok(l1.ok && (l1.data.items as { id: string; online: number }[]).map((i) => `${i.id}:${i.online}`).join() === 'amberx-droid:2,axf-console:2,molly:1', `apps.list: every app with its clients online, online first (${l1.ok ? (l1.data.items as { id: string; online: number }[]).map((i) => `${i.id}:${i.online}`).join() : l1.message})`);
const l1b = runConsoleCommand({ op: 'list', target: 'apps.list' }, { ...actx, clients: [...everyClient, { id: 'x1', app: 'expenses', lastUsed: NOW, lastSeen: NOW, catalog: { items: [{ kind: 'screen', id: 'grid', label: 'Grid' }] } }] });
ok(l1b.ok && (l1b.data.items as { id: string; screens: number }[]).some((i) => i.id === 'expenses' && i.screens === 1), 'an unlisted app with a client shows under its own id');
const l1c = runConsoleCommand({ op: 'list', target: 'apps.list', select: { online: true, q: 'amber' } }, { ...actx, clients: [] });
ok(l1c.ok && l1c.data.total === 0, 'online filter: none online');
const o1 = runConsoleCommand({ op: 'act', target: 'apps.screens', path: 'to-dos', action: 'open', input: { app: 'amberx' } }, actx);
ok(o1.ok && o1.deliver!.to.join() === 'amber-phone' && o1.deliver!.message.target === 'todos' && o1.deliver!.message.app === 'amberx-droid', 'open a screen in AmberX by alias → its client in front, message carries the app');
const o2 = runConsoleCommand({ op: 'act', target: 'apps.screens', path: 'to-dos', action: 'open', input: { app: 'AmberX', to: 'all' } }, actx);
ok(o2.ok && o2.deliver!.to.join() === 'amber-phone,amber-in-molly', 'to all = every client of that app');
const o3 = runConsoleCommand({ op: 'act', target: 'apps.screens', path: 'plan studio', action: 'open', input: { app: 'console' } }, actx);
ok(o3.ok && o3.deliver!.to.join() === 'phone' && o3.deliver!.message.target === 'plan-studio', 'apps.* with app console = the console');
const o4 = runConsoleCommand({ op: 'act', target: 'apps.screens', path: 'to-dos', action: 'open' }, actx);
ok(!o4.ok && o4.code === 'validation' && o4.message.includes('input.app'), 'apps.* without an app says which field');
const o5 = runConsoleCommand({ op: 'act', target: 'apps.screens', path: 'grid', action: 'open', input: { app: 'expenses' } }, actx);
ok(!o5.ok && o5.code === 'not_found' && o5.noConsole === true && o5.app === 'expenses', 'no client of that app → noConsole with the app');
const o6 = runConsoleCommand({ op: 'act', target: 'apps.screens', path: 'to-dos', action: 'open', input: { app: 'amberx' } }, { ...actx, clients: clients });
ok(!o6.ok && o6.noConsole === true && o6.url === 'https://amberx.amberxai.com' && o6.message.includes('AmberX'), 'no AmberX open → says so with its address (the broker wakes it)');
const w1 = runConsoleCommand({ op: 'get', target: 'apps.nav', path: 'here', input: { app: 'molly' } }, actx);
ok(w1.ok && (w1.data.value as { screen: string; extra?: { app: string } }).screen === 'console' && (w1.data.value as { extra?: { app: string } }).extra?.app === 'console', 'where Molly is, with what the app adds');
const s1 = runConsoleCommand({ op: 'list', target: 'apps.screens', select: { app: 'amberx', q: 'note' } }, actx);
ok(s1.ok && (s1.data.items as { id: string }[]).map((i) => i.id).join() === 'notes' && s1.data.app === 'amberx-droid', 'list an app\'s screens');
const c5 = runConsoleCommand({ op: 'list', target: 'apps.clients', select: { app: 'amberx' } }, actx);
ok(c5.ok && c5.data.total === 2 && (c5.data.items as { appId: string }[]).every((i) => i.appId === 'amberx-droid'), 'an app\'s clients');
const c6 = runConsoleCommand({ op: 'list', target: 'apps.clients' }, actx);
ok(c6.ok && c6.data.total === 5, 'every client across apps');
const a6 = runConsoleCommand({ op: 'act', target: 'apps.actions', path: 'xlayout.ide', action: 'run', input: { app: 'molly' } }, { ...actx, grants: ['control.apps.write'] });
ok(a6.ok && a6.deliver!.message.spec === 'xlayout.ide' && a6.deliver!.to.join() === 'molly-tab', 'an app action runs with control.apps.write');
ok(!runConsoleCommand({ op: 'act', target: 'apps.actions', path: 'xlayout.ide', action: 'run', input: { app: 'molly' } }, { ...actx, grants: ['control.console.write'] }).ok, 'the console\'s write grant does not cover another app');
const a7 = runConsoleCommand({ op: 'act', target: 'apps.actions', path: 'notes.clear', action: 'run', input: { app: 'amberx' } }, actx);
ok(!a7.ok && a7.code === 'confirmation_required' && a7.confirm === consoleActionConfirm('notes.clear', salt, NOW, 'amberx-droid'), 'a destructive app action asks for a confirm bound to the app');
ok(runConsoleCommand({ op: 'act', target: 'apps.actions', path: 'notes.clear', action: 'run', input: { app: 'amberx' }, confirm: a7.ok ? '' : a7.confirm }, actx).ok, '… and runs with it');
const b1 = runConsoleCommand({ op: 'act', target: 'apps.nav', path: 'here', action: 'back', input: { app: 'amberx', to: 'amber-in-molly' } }, actx);
ok(b1.ok && b1.deliver!.to.join() === 'amber-in-molly', 'to a client id of the app');
ok(!runConsoleCommand({ op: 'act', target: 'apps.nav', path: 'here', action: 'back', input: { app: 'molly', to: 'amber-phone' } }, actx).ok, 'a client id of another app is not found');
eq(APP_TOOLS.length, 10, 'ten app MCP shortcut tools');

console.log(`✓ console commands — ${n} checks`);
