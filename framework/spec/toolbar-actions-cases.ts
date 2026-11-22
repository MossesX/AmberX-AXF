/**
 * page-toolbar@1 conformance cases (core/engines/toolbar-actions.ts). One list of inputs drives gen-fixtures.mts
 * (writes spec/fixtures/toolbar-actions.json) and check-toolbar-actions.mts (replays them and compares), so a port
 * (the deferred Kotlin twin, spec/PORTING.md) can read the same inputs and must produce the same outputs.
 */
import type { ToolbarData } from '../core/types';
import { findToolbarButton, pageToolbarId, pickPageToolbar, planToolbarOverflow, resolvePageToolbar, suggestToolbarButtons, toolbarInvocation, toolbarMatchesPage, toolbarState, type ToolbarAssetLike, type ToolbarEnv, type ToolbarPage, type ToolbarPageState } from '../core/engines/toolbar-actions';
import { migrateToolbar, toolbarMigrationRecord } from '../core/engines/toolbar-migrate.mjs';
import { pageToolbarSettingsId, parseActionRef } from '../core/engines/toolbar-rules.mjs';

const data = (d: Partial<ToolbarData> & { groups: ToolbarData['groups'] }): ToolbarData => ({ variant: 'icons-labels', align: 'start', showSearch: false, ...d });

/** The gate plugin's auto-lander toolbar as a page toolbar asset (what the handwritten gate.auto-lander bar does today). */
export const LANDER: ToolbarAssetLike = {
  id: 'gate-auto-lander', name: 'Auto-lander',
  data: data({
    scope: 'view:gate', slot: 'auto-lander', overflow: { when: 'auto', keep: 1 },
    groups: [
      { id: 'lander', label: 'Lander', items: [
        { id: 'run', icon: 'play', label: 'Run now', action: 'command:gate/lander-run', enabledWhen: ['!paused', 'waiting>0'], badge: 'state:waiting', priority: 200, overflow: 'never' },
        { id: 'retry', icon: 'refresh', label: 'Retry', action: 'command:gate/lander-retry', args: { build: '$selection.id' }, enabledWhen: 'selection.id' },
        { id: 'fix', icon: 'hammer', label: 'Fix', action: 'command:gate/lander-fix', args: { build: '$selection.id', mode: 'fix' }, enabledWhen: 'selection.id', priority: 90 },
        { id: 'pause', icon: 'pause', label: 'Pause', action: 'handler:gate.pause', checked: 'state:paused', visibleWhen: 'status!=off' },
      ] },
      { id: 'rules', label: 'Rules', priority: 50, items: [
        { id: 'reset', icon: 'trash', label: 'Reset rules', action: 'command:gate/rules-reset', destructive: true, confirm: 'Reset every rule to the defaults?', priority: 10 },
        { id: 'settings', icon: 'settings', label: 'Gate settings', action: 'control:view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=gate', overflow: 'always' },
        { id: 'home', icon: 'home', label: 'Home', action: 'nav:home', badge: 'alerts.unread', requires: 'dev.tools' },
      ] },
      { id: 'live', label: 'Open windows', provider: 'windows', max: 2, items: [] },
    ],
  }),
};

/** A plugin-scoped toolbar for its main slot. */
export const PLUGIN_MAIN: ToolbarAssetLike = { id: 'builds-main', name: 'Builds', data: data({ scope: 'plugin:ai.amberx.axf.console.builds-page', groups: [{ id: 'g', items: [{ id: 'refresh', icon: 'refresh', label: 'Refresh', action: 'builds.refresh' }] }] }) }; // axf-not-plugin:builds-page (test data)
/** An old-shape (frame) toolbar. */
export const FRAME: ToolbarAssetLike = { id: 'editor-classic-copy', name: 'Editor', data: data({ groups: [{ id: 'file', items: [{ id: 'new', icon: 'plus', label: 'New', action: 'file.new' }, { id: 'save', icon: 'save', label: 'Save', action: 'file.save', badge: 'drafts' }] }] }) };

export const ASSETS = [LANDER, PLUGIN_MAIN, FRAME];

const RUNNING: ToolbarPageState = { paused: false, waiting: 2, selection: { id: 'b1' }, status: 'running' };
const PAUSED: ToolbarPageState = { paused: true, waiting: 0, selection: {}, status: 'paused' };
const OFF: ToolbarPageState = { paused: false, waiting: 0, status: 'off' };

const env = (over: Partial<ToolbarEnv> = {}, settings: Record<string, unknown> = {}): ToolbarEnv => ({
  get: (k) => settings[k],
  gate: (req) => (req === 'dev.tools' ? 'disable' : req === 'admin' ? 'hide' : 'allow'),
  counter: (n) => (n === 'alerts.unread' ? 3 : n === 'drafts' ? 120 : 0),
  handlers: ['gate.pause'],
  commands: ['gate/lander-run', 'gate/lander-retry', 'gate/lander-fix', 'gate/rules-reset'],
  providerItems: { windows: [{ id: 'w1', label: 'Plan', icon: 'layers', action: 'windows.restore:w1' }, { id: 'w2', label: 'Terminal', action: 'windows.restore:w2', locked: true }, { id: 'sep', label: '', separator: true }] },
  ...over,
});

export interface ToolbarResolveCase { name: string; asset: ToolbarAssetLike; page: ToolbarPage; state: ToolbarPageState; env: ToolbarEnv }

/** Resolve cases: the inputs the fixture records the outputs of. */
export const TOOLBAR_FIXTURE_CASES: ToolbarResolveCase[] = [
  { name: 'lander running, everything fits', asset: LANDER, page: { view: 'gate', slot: 'auto-lander' }, state: RUNNING, env: env() },
  { name: 'lander running, room for 3', asset: LANDER, page: { view: 'gate', slot: 'auto-lander' }, state: RUNNING, env: env({ fit: 3 }) },
  { name: 'lander paused, nothing selected', asset: LANDER, page: { view: 'gate', slot: 'auto-lander' }, state: PAUSED, env: env() },
  { name: 'lander off: pause hidden', asset: LANDER, page: { view: 'gate', slot: 'auto-lander' }, state: OFF, env: env() },
  { name: 'lander with user overrides and tap off', asset: LANDER, page: { view: 'gate', slot: 'auto-lander' }, state: RUNNING, env: env({}, { 'axf.chrome.toolbar.gate.auto-lander': { variant: 'icons', density: 'compact', tapConfirm: 'off' } }) },
  { name: 'lander, pause handler not wired, host takes home', asset: LANDER, page: { view: 'gate', slot: 'auto-lander' }, state: RUNNING, env: env({ handlers: [], takenByHost: (a) => a === 'nav:home' }) },
  { name: 'lander, host locks reset', asset: LANDER, page: { view: 'gate', slot: 'auto-lander' }, state: RUNNING, env: env({ lockedByHost: (a) => (a.endsWith('rules-reset') ? 'the host owns the rules' : null) }) },
  { name: 'lander, no registries: everything assumed wired', asset: LANDER, page: { view: 'gate', slot: 'auto-lander' }, state: RUNNING, env: { get: () => undefined } },
  { name: 'plugin main toolbar', asset: PLUGIN_MAIN, page: { plugin: 'ai.amberx.axf.console.builds-page', view: 'builds' }, state: {}, env: env() }, // axf-not-plugin:builds-page (test data)
  { name: 'frame toolbar (old shape) as the app toolbar', asset: FRAME, page: {}, state: {}, env: env() },
  { name: 'frame toolbar lent to a page', asset: FRAME, page: { view: 'plan' }, state: {}, env: env() },
];

const PICKS: { name: string; page: ToolbarPage; settings?: Record<string, unknown> }[] = [
  { name: 'view + slot', page: { view: 'gate', slot: 'auto-lander' } },
  { name: 'view main slot: none', page: { view: 'gate' } },
  { name: 'plugin main', page: { plugin: 'ai.amberx.axf.console.builds-page' } }, // axf-not-plugin:builds-page (test data)
  { name: 'plugin with its view too', page: { view: 'builds', plugin: 'ai.amberx.axf.console.builds-page' } }, // axf-not-plugin:builds-page (test data)
  { name: 'user pick wins', page: { view: 'gate', slot: 'auto-lander' }, settings: { 'axf.chrome.toolbar.gate.auto-lander.asset': 'editor-classic-copy' } },
  { name: 'user pick of an unknown asset falls back', page: { view: 'gate', slot: 'auto-lander' }, settings: { 'axf.chrome.toolbar.gate.auto-lander.asset': 'nope' } },
  { name: 'case-insensitive view', page: { view: 'GATE', slot: 'auto-lander' } },
  { name: 'unknown page', page: { view: 'nowhere' } },
];

const OVERFLOW_RULES: { name: string; rule: ToolbarData['overflow']; fit?: number }[] = [
  { name: 'auto, fits', rule: 'auto' },
  { name: 'auto, room for 4', rule: 'auto', fit: 4 },
  { name: 'auto keep 3, room for 1', rule: { when: 'auto', keep: 3 }, fit: 1 },
  { name: 'never, room for 1', rule: 'never', fit: 1 },
  { name: 'always keep 2', rule: { when: 'always', keep: 2, label: 'Actions' } },
  { name: 'always keep 0', rule: { when: 'always' } },
  { name: 'default rule', rule: undefined, fit: 2 },
];

const strip = (t: ReturnType<typeof resolvePageToolbar>) => ({
  id: t.id, address: t.address, scope: t.scope, slot: t.slot, label: t.label, look: t.look, tapConfirm: t.tapConfirm, stateKeys: t.stateKeys, moreLabel: t.moreLabel,
  groups: t.groups.map((g) => ({ id: g.id, label: g.label, provider: g.provider, visible: g.visible, buttons: g.buttons.map((b) => b.key) })),
  buttons: t.buttons.map((b) => ({ key: b.key, label: b.label, title: b.title, icon: b.icon, enabled: b.enabled, visible: b.visible, reason: b.reason, pressed: b.pressed, badge: b.badge, destructive: b.destructive, confirm: b.confirm, priority: b.priority, overflow: b.overflow, requires: b.requires, address: b.address, origin: b.origin, invocation: b.invocation })),
  hidden: t.groups.flatMap((g) => g.buttons).filter((b) => !b.visible).map((b) => ({ key: b.key, reason: b.reason })),
  bar: t.bar.map((b) => b.id), more: t.more.map((b) => b.id),
  state: toolbarState(t),
});

/** Every output the fixture holds, from the shared cases (and every starter toolbar's migration record). */
export function toolbarFixtureOutputs(cases: ToolbarResolveCase[], starters: { id: string; name?: string; data: ToolbarData }[]) {
  const first = resolvePageToolbar(LANDER, { view: 'gate', slot: 'auto-lander' }, RUNNING, env());
  return {
    contract: 'page-toolbar@1',
    resolve: Object.fromEntries(cases.map((c) => [c.name, strip(resolvePageToolbar(c.asset, c.page, c.state, c.env))])),
    match: Object.fromEntries(ASSETS.flatMap((a) => PICKS.map((p) => [`${a.id} ← ${p.name}`, toolbarMatchesPage(a.data, p.page)]))),
    pick: Object.fromEntries(PICKS.map((p) => [p.name, { id: pageToolbarId(p.page), asset: pickPageToolbar(ASSETS, p.page, (k) => p.settings?.[k])?.id ?? null }])),
    settingsIds: Object.fromEntries([['view:gate', undefined], ['view:gate', 'auto-lander'], ['view:gate', 'main'], ['plugin:ai.amberx.axf.console.builds-page', 'queue'], ['app', 'x'], ['view:PlanStudio2', 'tree']].map(([s, slot]) => [`${s} / ${slot ?? '-'}`, pageToolbarSettingsId(s, slot)])), // axf-not-plugin:builds-page (test data)
    overflow: Object.fromEntries(OVERFLOW_RULES.map((r) => { const p = planToolbarOverflow(first.buttons, r.rule, r.fit); return [r.name, { bar: p.bar.map((b) => b.id), more: p.more.map((b) => b.id), label: p.label }]; })),
    invocations: Object.fromEntries(['file.save', 'nav:home', 'swap:layout:next', 'action:plan.focus', 'command:gate/lander-run', 'control:view:builds', 'control:view:builds/button:refresh', 'control:setting:axf.display.fontScale', 'control:button:save', 'control:view:settings/tab:settings.tabs=plugins', 'handler:gate.pause'].map((a) => [a, toolbarInvocation(parseActionRef(a), { build: 'b1' })])),
    find: { byId: findToolbarButton(first, 'retry')?.key ?? null, byKey: findToolbarButton(first, 'rules/reset')?.key ?? null, caseInsensitive: findToolbarButton(first, 'RETRY')?.key ?? null, missing: findToolbarButton(first, 'nope') },
    starters: Object.fromEntries(starters.map((a) => [a.id, { record: toolbarMigrationRecord(a), resolvedAs: resolvePageToolbar({ id: a.id, name: a.name, data: migrateToolbar(a.data).data as ToolbarData }, {}, {}, { get: () => undefined }).buttons.map((b) => `${b.key}→${b.invocation?.kind}:${b.invocation?.kind === 'action' ? b.invocation.spec : ''}`)}])),
    suggest: suggestToolbarButtons('gate', [{ id: 'rules-list', title: 'Gate rules: list', readOnly: true }, { id: 'rules-reset', title: 'Gate rules: reset to defaults (confirm)' }, { id: 'lander-run', title: 'Auto-lander: run now' }, { id: 'lander-pause', title: 'Auto-lander: pause' }, { id: 'history', title: 'Gate: history', readOnly: true }], 4),
  };
}
