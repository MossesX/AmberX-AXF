/**
 * tab-control@1 (build tabs-api-control, Brett Nov 8 2026): every tab, sub-tab and titled section opens by path.
 *   npx -y tsx framework/spec/check-tab-control.mts
 * Covers the pure engine (split, match, pick, action ids), the console domain (console_open "screen/tab", a bare tab
 * name, REST/MCP message carries `tab`), the live registry + openTabPath on a stand-in runtime (Build orchestrator ›
 * Pipeline, Plan Studio › Board, Settings › Plugins › Console commands › a section), the per-tab actions, deep links,
 * and the CI check (a hand-drawn row without an action fails).
 */
import assert from 'node:assert/strict';
import { matchTab, pickTabTarget, splitTabPath, tabActionId, tabActionsOf, normalizeTabTarget, TAB_DEEP_LINK_PARAM } from '../core/engines/tab-control.mjs';
import { consoleScreenTab, runConsoleCommand, consoleCatalogFrom, consoleActionEffect } from '../core/engines/console-commands.mjs';
import { ActionBus } from '../core/engines/actions';
import { openTabPath, registerTabTarget, liveTabTargets, activeTabsOf, tabDeepLink, installTabControl } from '../react/tabRegistry';
import { checkTabSource, checkWiring } from '../cli/check-tab-actions.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

// ---------------------------------------------------------------- pure engine
eq(splitTabPath('build-orchestrator/pipeline'), ['build-orchestrator', 'pipeline'], 'split /');
eq(splitTabPath('Settings › Plugins > Console commands'), ['Settings', 'Plugins', 'Console commands'], 'split › and >');
eq(splitTabPath('  /a//b/ '), ['a', 'b'], 'empty parts dropped');
eq(tabActionId('build-orchestrator.tabs', 'pipeline'), 'tab.build-orchestrator.tabs.pipeline', 'action id');
eq(tabActionId('x', 'a:b c'), 'tab.x.a-b-c', 'action id has no : or spaces');
const TABS = [{ value: 'builds', label: 'Builds' }, { value: 'pipeline', label: 'Pipeline' }, { value: 'approvals', label: 'Upgrade approvals' }];
eq(matchTab(TABS, 'pipeline'), 'pipeline', 'match by value');
eq(matchTab(TABS, 'PIPELINE'), 'pipeline', 'match by value, any case');
eq(matchTab(TABS, 'upgrade approvals'), 'approvals', 'match by label');
eq(matchTab(TABS, 'upgrade'), 'approvals', 'match by label prefix');
eq(matchTab(TABS, 'nothing'), null, 'no match');
const rows = [
  { kind: 'tab-group' as const, id: 'other.tabs', label: 'Other', screen: 'other', tabs: [{ value: 'pipeline', label: 'Pipeline' }] },
  { kind: 'tab-group' as const, id: 'build-orchestrator.tabs', label: 'Build orchestrator', screen: 'build-orchestrator', tabs: TABS },
  { kind: 'section' as const, id: 'settings-group:x', label: 'Danger zone', screen: 'settings' },
];
eq(pickTabTarget(rows, 'pipeline', { screen: 'build-orchestrator' })?.target.id, 'build-orchestrator.tabs', 'the row on this screen wins');
eq(pickTabTarget(rows, 'other.tabs:pipeline', { screen: 'build-orchestrator' })?.target.id, 'other.tabs', 'row:tab names the row');
eq(pickTabTarget(rows, 'danger zone', {})?.target.kind, 'section', 'a section by its title');
eq(pickTabTarget(rows, 'x', {})?.target.id, 'settings-group:x', 'a section by the end of its id');
eq(pickTabTarget(rows, 'zzz', {}), null, 'nothing');
eq(tabActionsOf(rows[1], 'Build orchestrator').map((a) => a.id), TABS.map((t) => `tab.build-orchestrator.tabs.${t.value}`), 'one action per tab');
eq(tabActionsOf(rows[1], 'Build orchestrator')[1], { id: 'tab.build-orchestrator.tabs.pipeline', label: 'Build orchestrator › Pipeline', path: 'build-orchestrator/build-orchestrator.tabs:pipeline' }, 'action label + path');
eq(normalizeTabTarget({ kind: 'nope', id: 'x' }), null, 'unknown kind dropped');

// ---------------------------------------------------------------- console domain (console_open "screen/tab")
const screens = [{ kind: 'screen', id: 'build-orchestrator', label: 'Build orchestrator' }, { kind: 'screen', id: 'plan-studio', label: 'Plan Studio' }, { kind: 'screen', id: 'settings', label: 'Settings' }];
const catItems = [...screens, { kind: 'action', id: 'tab.build-orchestrator.tabs.pipeline', label: 'Build orchestrator › Pipeline', effect: 'navigate' }];
eq(consoleScreenTab(catItems as never, 'build-orchestrator/pipeline'), { item: screens[0], tab: 'pipeline' }, 'screen/tab');
eq(consoleScreenTab(catItems as never, 'Plan Studio › Board'), { item: screens[1], tab: 'Board' }, 'Screen › Tab by title');
eq(consoleScreenTab(catItems as never, 'settings/plugins/console-commands'), { item: screens[2], tab: 'plugins/console-commands' }, 'settings sub-tab path');
eq((consoleScreenTab(catItems as never, 'pipeline') as { action: { id: string } }).action.id, 'tab.build-orchestrator.tabs.pipeline', 'bare tab name → its tab action');
eq(consoleScreenTab(catItems as never, 'plan studio'), null, 'plain screen unchanged');
eq(consoleActionEffect({ id: 'tab.x.y' }), 'navigate', 'tab actions only navigate');
const now = Date.now();
const clients = [{ id: 'c1', lastUsed: now, lastSeen: now, catalog: { $axf: 'console-catalog@1', app: 'console-web', items: catItems, here: {} } }];
const r1 = runConsoleCommand({ op: 'act', target: 'console.screens', path: 'build-orchestrator/pipeline', action: 'open', input: {} } as never, { clients: clients as never, grants: ['control.console.navigate'], now });
ok(r1.ok && r1.deliver?.message.target === 'build-orchestrator' && r1.deliver.message.tab === 'pipeline', 'console_open screen/tab delivers the tab path');
const r2 = runConsoleCommand({ op: 'act', target: 'console.screens', path: 'pipeline', action: 'open', input: {} } as never, { clients: clients as never, grants: ['control.console.navigate'], now });
ok(r2.ok && r2.deliver?.message.op === 'run' && r2.deliver.message.spec === 'tab.build-orchestrator.tabs.pipeline', 'console_open of a bare tab runs its action with the navigate grant');
const cat = consoleCatalogFrom([], [{ id: 'tab.build-orchestrator.tabs.pipeline', meta: { label: 'Build orchestrator › Pipeline', effect: 'navigate', searchable: false } as never }]);
ok(cat.items.some((i) => i.kind === 'action' && i.id === 'tab.build-orchestrator.tabs.pipeline'), 'per-tab actions show in console_list actions');

// ---------------------------------------------------------------- live registry on a stand-in runtime
const store: Record<string, string> = {};
(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
function fakeRuntime() {
  const state = { view: 'home' };
  const actions = new ActionBus();
  const dispatched: string[] = [];
  const toasts: string[] = [];
  const settingsTabs = [{ id: 'appearance', label: 'Appearance' }, { id: 'plugins', label: 'Plugins' }, { id: 'console-commands', label: 'Console commands', parent: 'plugins' }];
  const views = [['home', 'Home'], ['build-orchestrator', 'Build orchestrator'], ['plan-studio', 'Plan Studio'], ['settings', 'Settings']];
  const rt = {
    actions, dispatched, toasts,
    getState: () => state,
    search: {
      entries: () => views.map(([view, label]) => ({ id: `view:${view}`, kind: 'view', label, focus: { kind: 'view', view } })),
      focus: (e: { focus: { view: string } }) => { state.view = e.focus.view; return true; },
    },
    settings: { listTabs: () => settingsTabs },
    dispatch: (spec: string) => { dispatched.push(spec); const { id, args } = ActionBus.parse(spec); const h = actions.get(id); if (h) h.fn(args, {} as never); return true; },
    toast: (m: string) => { toasts.push(m); },
  };
  return rt;
}
{
  const rt = fakeRuntime();
  const off = installTabControl(rt as never);
  ok(rt.actions.get('tab.open')?.meta.params === true, 'tab.open is registered (params)');
  // the screens' rows mount only once their screen shows (as in the console)
  let orch = 'builds';
  let plan = 'list';
  const mounted: (() => void)[] = [];
  const mount = () => {
    if (rt.getState().view === 'build-orchestrator' && !mounted.length) {
      // like TabGroup: a change re-registers the row with its new value
      const reg = () => registerTabTarget(rt as never, 'k1', { kind: 'tab-group', id: 'build-orchestrator.tabs', label: 'Build orchestrator', screen: 'build-orchestrator', tabs: TABS, value: orch, select: (v) => { orch = v; reg(); } });
      mounted.push(reg());
    }
    if (rt.getState().view === 'plan-studio' && mounted.length < 2) {
      mounted.push(registerTabTarget(rt as never, 'k2', { kind: 'tab-group', id: 'plan-studio.tabs', label: 'Plan Studio', screen: 'plan-studio', tabs: [{ value: 'list', label: 'Plans' }, { value: 'board', label: 'Board' }], value: plan, select: (v) => { plan = v; } }));
    }
  };
  const timer = setInterval(mount, 20);
  const a = await openTabPath(rt as never, 'build-orchestrator/pipeline', { waitMs: 1000 });
  ok(a.ok && rt.getState().view === 'build-orchestrator' && orch === 'pipeline', `Build orchestrator › Pipeline opens (${a.message})`);
  eq(a.opened, ['Build orchestrator', 'Pipeline'], 'what it opened');
  eq(activeTabsOf(rt as never), ['build-orchestrator.tabs:pipeline'], 'activeTabsOf: the tab each row on screen shows (console_where)');
  ok(rt.actions.get('tab.build-orchestrator.tabs.pipeline')?.meta.effect === 'navigate', 'a seen row gives each tab a navigate action');
  ok(JSON.parse(store['axf.tabs.seen'] ?? '{}')['build-orchestrator.tabs'], 'seen rows are remembered on the device');
  const b = await openTabPath(rt as never, 'Plan Studio › Board', { waitMs: 1000 });
  ok(b.ok && rt.getState().view === 'plan-studio' && plan === 'board', `Plan Studio › Board opens (${b.message})`);
  // Settings: tabs and sub-tabs through settings.open, then a section inside
  let expanded = false;
  registerTabTarget(rt as never, 'k3', { kind: 'section', id: 'settings-panel:console-commands.wake', label: 'When no console is open', screen: 'settings', expand: () => { expanded = true; } });
  const c = await openTabPath(rt as never, 'settings/plugins/console-commands/when no console is open', { waitMs: 500 });
  ok(c.ok && rt.dispatched.includes('settings.open:plugins') && rt.dispatched.includes('settings.open:console-commands') && expanded, `Settings › Plugins › Console commands › section (${c.message})`);
  const d = await openTabPath(rt as never, 'build-orchestrator/nope', { waitMs: 200 });
  ok(!d.ok && /no tab or section "nope"/.test(d.message) && /Pipeline/.test(d.message), 'an unknown tab says which tabs are there');
  // a bare tab of a row seen on another screen goes to that screen first
  rt.getState().view = 'home';
  const e = await openTabPath(rt as never, 'upgrade approvals', { waitMs: 500 });
  ok(e.ok && rt.getState().view === 'build-orchestrator' && orch === 'approvals', `bare tab name opens its screen first (${e.message})`);
  // the per-tab action runs the same path
  rt.dispatch('tab.build-orchestrator.tabs.builds');
  await new Promise((r) => setTimeout(r, 100));
  eq(orch, 'builds', 'tab.<row>.<tab> action switches the tab');
  rt.dispatch('tab.open:build-orchestrator/pipeline');
  await new Promise((r) => setTimeout(r, 100));
  eq(orch, 'pipeline', 'tab.open:<path> switches the tab');
  ok(liveTabTargets(rt as never).some((t) => t.id === 'plan-studio.tabs'), 'live targets listed');
  clearInterval(timer);
  for (const f of mounted) f();
  off();
  ok(!rt.actions.get('tab.open'), 'cleanup takes tab.open away');
  // a new runtime on the same device lists the remembered tabs before their screen is opened
  const rt2 = fakeRuntime();
  installTabControl(rt2 as never);
  ok(rt2.actions.get('tab.plan-studio.tabs.board'), 'remembered rows give actions on the next load');
}
// deep link
eq(new URL(tabDeepLink('build-orchestrator/pipeline', 'https://console.amberxai.com/?x=1')).searchParams.get(TAB_DEEP_LINK_PARAM), 'build-orchestrator/pipeline', 'deep link carries the path');

// ---------------------------------------------------------------- CI check
eq(checkWiring().length, 0, 'framework wiring present');
eq(checkTabSource('<div role="tablist" aria-label="x"><button role="tab">A</button></div>', 'a.tsx').length, 1, 'a hand-drawn row without an action fails');
eq(checkTabSource('useTabControl({ id: "x" }); <div role="tablist"><button role="tab">A</button></div>', 'a.tsx').length, 0, 'a registered hand-drawn row passes');
eq(checkTabSource('<TabGroup<T> label="x" onChange={(v) => go(v)} />', 'a.tsx').length, 1, 'a TabGroup without an id fails');
eq(checkTabSource('<TabGroup<T> label="x" onChange={(v) => go(v)} id="a.b" />', 'a.tsx').length, 0, 'a TabGroup with an id passes');
eq(checkTabSource("el.closest('[role=\"tablist\"]')", 'a.tsx').length, 0, 'a selector that only reads rows passes');

console.log(`check-tab-control: ${n} checks passed`);
