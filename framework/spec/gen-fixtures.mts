/**
 * Generates port-conformance fixtures from the reference (TypeScript) engines.
 * Every port's test suite loads the same framework/assets and must reproduce these outputs exactly.
 *   npx -y tsx framework/spec/gen-fixtures.mts
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { colorThemeVars, styleThemeVars } from '../core/engines/theme';
import { compileLayout, layoutVars } from '../core/engines/layout';
import { appMenuStyle, buttonStyle, containerStyle, contextMenuStyle, dialogStyle, navMenuStyle, popupStyle, sliderStyle, toolbarStyle } from '../core/engines/components';
import { filterMenu, gateFor, hasPermission, resolvePermissions } from '../core/engines/uac';
import { ActionBus } from '../core/engines/actions';
import { rollPlan, rollSlotDefault } from '../core/engines/roll';
import { hiddenSlots, hideableTypes } from '../core/engines/hide';
import { SPACING_DEFAULT, SPACINGS, spacingOf } from '../core/engines/spacing';
import { SEARCH_BAR_WIDTH, TOOLBAR_SIDES, WIDGET_TYPES, placeToolbarWidgets } from '../core/engines/widgets';
import { ATTACHABLE_TYPES, BADGE_TONE_TOKEN, BANNER_SIDES, bannerVars, formatClock, placeAttachments } from '../core/engines/banner';
import { scoreEntry } from '../core/engines/search';
import { ackAlerts, alertKey, applyAlert, deliveryTargets, diagnosticToAlert, DEFAULT_ALERT_RULES, ntfyPriority, resolveAlerts, sortAlerts, trimAlerts, unreadCount, ALERT_SEVERITIES, type Alert, type AlertInput, type AlertRules, type Diagnostic } from '../core/engines/alerts';
import { MCP_PERMISSIONS, MCP_PROTOCOL_VERSION, MCP_SESSION_HEADER, MCP_SUPPORTED_VERSIONS, MCP_VERSION_HEADER, SseParser, argumentSkeleton, callGate, classifyResponse, contentText, errorFromHttp, errorFromRpc, errorFromTransport, initializeParams, mcpHeaders, mergePages, negotiate, offers, pageParams, parseMessages, parseSse, rpcNotification, rpcRequest, serverIdFor, toolEffect, validateServerInput } from '../core/engines/mcp';
import { LIVE_KINDS, LIVE_STATES, LiveEventLog, reduceLiveState } from '../core/live-session';
import { ASSET_TYPES } from '../core/types';
import { validateAsset } from '../core/validate';
import { DEFAULT_PROJECT_RULES, validateProjectManifest } from '../core/project';

const root = new URL('..', import.meta.url).pathname;
const assetsDir = join(root, 'assets');
const out = join(root, 'spec/fixtures');
mkdirSync(out, { recursive: true });
const load = (type: string) => readdirSync(join(assetsDir, type)).map((f) => JSON.parse(readFileSync(join(assetsDir, type, f), 'utf8')));
const write = (name: string, data: unknown) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n');

write('theme.json', Object.fromEntries([
  ...load('color-theme').map((a) => [`color-theme:${a.id}`, colorThemeVars(a.data)]),
  ...load('style-theme').map((a) => [`style-theme:${a.id}`, styleThemeVars(a.data)]),
]));
write('layout.json', Object.fromEntries(load('layout').map((a) => [a.id, { compiled: compileLayout(a.data), vars: layoutVars(a.data) }])));
// Slot contract cases: a region that refuses its chrome drops out of the grid on every port.
const base = load('layout').find((a) => a.id === 'studio-dock')?.data ?? load('layout')[0].data;
write('layout-slots.json', Object.fromEntries([...Object.entries({
  'no-menubar': { menubar: [] },
  'no-nav': { nav: [] },
  'no-toolbar': { toolbar: ['nav-menu'] },
  'overlay-dialog-only': { overlay: ['dialog'] },
}).map(([k, slots]) => { const data = { ...base, slots }; return [k, { slots, compiled: compileLayout(data) }]; }),
  // Hidden slots (core/engines/hide.ts): the user hid a chrome type; its region drops out like a refusing slot.
  ...Object.entries({
    'hidden-nav': ['nav-menu'],
    'hidden-toolbar': ['toolbar'],
    'hidden-menubar': ['app-menu'],
    'hidden-all-chrome': ['app-menu', 'toolbar', 'nav-menu', 'context-menu'],
  }).map(([k, hidden]) => [k, { slots: {}, hidden, compiled: compileLayout({ ...base, slots: {} }, hidden) }]),
]));
// Which types can be hidden, and which overrides count (non-hideable types never hide).
write('hide.json', {
  hideable: hideableTypes(),
  cases: [
    { overrides: {}, hidden: hiddenSlots({}) },
    { overrides: { toolbar: true, 'nav-menu': false }, hidden: hiddenSlots({ toolbar: true, 'nav-menu': false }) },
    { overrides: { 'color-theme': true, layout: true, 'context-menu': true }, hidden: hiddenSlots({ 'color-theme': true, layout: true, 'context-menu': true }) },
  ],
});
// Spacing choice (core/engines/spacing.ts): every style theme compiled under every choice; plus how stored values read.
write('spacing.json', {
  default: SPACING_DEFAULT,
  order: SPACINGS,
  parse: Object.fromEntries(['tight', 'compact', 'regular', 'roomy', ''].map((v) => [v, spacingOf(v)])),
  vars: Object.fromEntries(load('style-theme').map((a) => [a.id, Object.fromEntries(SPACINGS.map((sp) => {
    const v = styleThemeVars(a.data, sp);
    return [sp, Object.fromEntries(['--fx-space', '--fx-row-h', '--fx-density-k', '--fx-radius-sm', '--fx-radius-md', '--fx-radius-lg', '--fx-font-size'].map((k) => [k, v[k]]))];
  }))])),
});
// Banner (core/engines/banner.ts): height vars, where attachments go, clock text, badge tone tokens.
{
  const banners = Object.fromEntries(load('banner').map((a) => [a.id, a.data]));
  const exists = new Set([...load('badge').map((a) => `badge:${a.id}`), ...load('clock').map((a) => `clock:${a.id}`), ...load('search-bar').map((a) => `search-bar:${a.id}`), 'badge:claude']);
  const has = (t: string, id: string) => exists.has(`${t}:${id}`);
  const thin = banners['amberx-thin'];
  const placeCases = {
    'asset-only': { banner: thin, extra: [] },
    'plugin-badge-left': { banner: thin, extra: [{ type: 'badge', id: 'claude', at: 'left', order: 5, origin: 'claude-badge' }] },
    'runtime-replaces-asset': { banner: thin, extra: [{ type: 'clock', id: 'digital-12h', at: 'center', origin: 'x' }] },
    'skips-bad': { banner: thin, extra: [{ type: 'button', id: 'x', at: 'left' }, { type: 'badge', id: 'missing', at: 'left' }, { type: 'badge', id: 'new', at: 'top' }] },
    'order-ties': { banner: { ...thin, attach: [] }, extra: [{ type: 'badge', id: 'new', at: 'right', order: 1 }, { type: 'badge', id: 'claude', at: 'right', order: 1 }, { type: 'clock', id: 'digital-24h', at: 'right', order: 0 }] },
    'no-banner': { banner: null, extra: [{ type: 'badge', id: 'new', at: 'left' }] },
  } as const;
  const parts = [
    { year: 2026, month: 10, day: 18, weekday: 0, hour: 18, minute: 5, second: 9 },
    { year: 2026, month: 1, day: 2, weekday: 5, hour: 0, minute: 0, second: 0 },
    { year: 2026, month: 12, day: 31, weekday: 4, hour: 12, minute: 59, second: 59 },
  ];
  const clocks = [
    { format: '24h', seconds: false, date: 'none' }, { format: '24h', seconds: true, date: 'weekday' },
    { format: '12h', seconds: false, date: 'short' }, { format: '12h', seconds: true, date: 'none' },
  ] as const;
  write('banner.json', {
    attachable: ATTACHABLE_TYPES,
    sides: BANNER_SIDES,
    vars: {
      ...Object.fromEntries(Object.entries(banners).map(([id, d]) => [id, bannerVars(d as never)])),
      'hidden': bannerVars(thin as never, true), 'none': bannerVars(null),
      'too-tall': bannerVars({ ...thin, height: 400 } as never), 'too-short': bannerVars({ ...thin, height: 2 } as never), 'not-a-number': bannerVars({ ...thin, height: 'x' } as never),
    },
    exists: [...exists].sort(),
    place: Object.fromEntries(Object.entries(placeCases).map(([k, c]) => [k, { banner: c.banner, extra: c.extra, placed: placeAttachments(c.banner as never, c.extra as never, has) }])),
    clock: clocks.flatMap((c) => parts.map((t) => ({ clock: c, parts: t, text: formatClock(c, t) }))),
    tones: BADGE_TONE_TOKEN,
  });
}
// Widgets (core/engines/widgets.ts): the toolbar as a widget host (start / end), widgets only.
{
  const exists = new Set([...load('clock').map((a) => `clock:${a.id}`), ...load('search-bar').map((a) => `search-bar:${a.id}`), ...load('badge').map((a) => `badge:${a.id}`)]);
  const has = (t: string, id: string) => exists.has(`${t}:${id}`);
  const cases = {
    'none': { toolbar: { widgets: [] }, extra: [] },
    'own-widgets': { toolbar: { widgets: [{ type: 'search-bar', id: 'everything', at: 'end' }, { type: 'clock', id: 'digital-12h', at: 'start' }] }, extra: [] },
    'runtime-moves-own': { toolbar: { widgets: [{ type: 'clock', id: 'digital-12h', at: 'start' }] }, extra: [{ type: 'clock', id: 'digital-12h', at: 'end', order: 1, origin: 'p' }] },
    'badges-are-not-widgets': { toolbar: { widgets: [{ type: 'badge', id: 'new', at: 'start' }, { type: 'search-bar', id: 'missing', at: 'end' }, { type: 'clock', id: 'digital-24h', at: 'left' }] }, extra: [] },
    'no-widgets-field': { toolbar: {}, extra: [{ type: 'search-bar', id: 'compact', at: 'start' }] },
    'no-toolbar': { toolbar: null, extra: [{ type: 'search-bar', id: 'compact', at: 'start' }] },
  } as const;
  write('widgets.json', {
    widgetTypes: WIDGET_TYPES,
    toolbarSides: TOOLBAR_SIDES,
    searchBarWidth: SEARCH_BAR_WIDTH,
    exists: [...exists].sort(),
    toolbar: Object.fromEntries(Object.entries(cases).map(([k, c]) => [k, { toolbar: c.toolbar, extra: c.extra, placed: placeToolbarWidgets(c.toolbar as never, c.extra as never, has) }])),
  });
}
write('components.json', {
  button: Object.fromEntries(load('button').map((a) => [a.id, buttonStyle(a.data)])),
  slider: Object.fromEntries(load('slider').map((a) => [a.id, sliderStyle(a.data)])),
  container: Object.fromEntries(load('container').map((a) => [a.id, containerStyle(a.data)])),
  dialog: Object.fromEntries(load('dialog').map((a) => [a.id, dialogStyle(a.data)])),
  popup: Object.fromEntries(load('popup').map((a) => [a.id, popupStyle(a.data)])),
  'context-menu': Object.fromEntries(load('context-menu').map((a) => [a.id, contextMenuStyle(a.data)])),
  toolbar: Object.fromEntries(load('toolbar').map((a) => [a.id, toolbarStyle(a.data)])),
  'nav-menu': Object.fromEntries(load('nav-menu').map((a) => [a.id, navMenuStyle(a.data)])),
  'app-menu': Object.fromEntries(load('app-menu').map((a) => [a.id, appMenuStyle(a.data)])),
  // style fields set explicitly (the starter assets mostly use defaults)
  'chrome-cases': {
    'toolbar-compact-glass': toolbarStyle({ variant: 'labels', align: 'start', groups: [], showSearch: false, density: 'compact', surface: 'glass', divider: false }),
    'toolbar-roomy-raised': toolbarStyle({ variant: 'icons', align: 'center', groups: [], showSearch: true, density: 'roomy', surface: 'raised' }),
    'nav-compact-fill': navMenuStyle({ style: 'pills', sections: [], density: 'compact', indicator: 'fill', showIcons: false }),
    'nav-roomy-none': navMenuStyle({ style: 'list', sections: [], density: 'roomy', indicator: 'none' }),
    'menu-compact-glass': appMenuStyle({ menus: [], density: 'compact', surface: 'glass' }),
    'menu-roomy-raised': appMenuStyle({ menus: [], density: 'roomy', surface: 'raised' }),
  },
});
write('uac.json', Object.fromEntries(load('uac-policy').map((p) => [p.id, {
  roles: Object.fromEntries(p.data.roles.map((r: { id: string }) => [r.id, [...resolvePermissions(p.data, r.id)].sort()])),
  checks: ['files.write', 'dev.deploy', 'assets.swap', 'uac.manage', 'anything.else'].map((perm) => ({ perm, byRole: Object.fromEntries(p.data.roles.map((r: { id: string }) => [r.id, hasPermission(resolvePermissions(p.data, r.id), perm)])) })),
  gate: Object.fromEntries(p.data.roles.map((r: { id: string }) => [r.id, gateFor(p.data, resolvePermissions(p.data, r.id), 'dev.deploy')])),
}])));
const menus = load('app-menu');
const standard = load('uac-policy').find((p) => p.id === 'standard').data;
write('menu-filter.json', Object.fromEntries(menus.map((m) => [m.id, Object.fromEntries(standard.roles.map((r: { id: string }) => {
  const granted = resolvePermissions(standard, r.id);
  return [r.id, m.data.menus.map((menu: { id: string; items: unknown[] }) => ({ id: menu.id, items: filterMenu(menu.items as never, (req) => gateFor(standard, granted, req)).map((i: { id: string }) => i.id) }))];
}))])));
write('actions.json', ['file.save', 'swap:color-theme:next', 'nav:home', 'dialog:import-asset', 'toast:success:Saved:ok', 'asset.json:{payload}', ''].map((spec) => ({ spec, parsed: ActionBus.parse(spec) })));
write('validation.json', [
  { case: 'missing-data', raw: { $axf: 'asset@1', type: 'button', id: 'x', name: 'X', version: '1' } },
  { case: 'bad-id', raw: { $axf: 'asset@1', type: 'button', id: 'Bad_Id', name: 'X', version: '1', data: {} } },
  { case: 'unknown-type', raw: { $axf: 'asset@1', type: 'nope', id: 'x', name: 'X', version: '1', data: {} } },
  { case: 'bad-enum', raw: { $axf: 'asset@1', type: 'button', id: 'x', name: 'X', version: '1', data: { shape: 'blob', fill: 'solid', weight: 600, uppercase: false, size: 'md', elevation: false } } },
  { case: 'uac-default-role', raw: { $axf: 'asset@1', type: 'uac-policy', id: 'x', name: 'X', version: '1', data: { defaultRole: 'ghost', gating: 'hide', roles: [{ id: 'a', label: 'A', permissions: [] }], permissions: {} } } },
  { case: 'slots-not-object', raw: { $axf: 'asset@1', type: 'layout', id: 'x', name: 'X', version: '1', data: { ...base, slots: ['nav'] } } },
  { case: 'slots-bad-region', raw: { $axf: 'asset@1', type: 'layout', id: 'x', name: 'X', version: '1', data: { ...base, slots: { sidebar: ['nav-menu'] } } } },
  { case: 'slots-bad-type', raw: { $axf: 'asset@1', type: 'layout', id: 'x', name: 'X', version: '1', data: { ...base, slots: { toolbar: ['toolbar', 'ribbon'] } } } },
  { case: 'slots-ok', raw: { $axf: 'asset@1', type: 'layout', id: 'x', name: 'X', version: '1', data: { ...base, slots: { menubar: ['app-menu', 'toolbar'], nav: [] } } } },
  { case: 'chrome-bad-enum', raw: { $axf: 'asset@1', type: 'toolbar', id: 'x', name: 'X', version: '1', data: { variant: 'icons', align: 'start', groups: [], showSearch: false, density: 'huge' } } },
].map((c) => ({ ...c, result: validateAsset(c.raw) })));
// Randomize rolls: which slots a roll touches and which assets it may pick (context menus are opt-in).
const rollCases: Record<string, { slots?: Record<string, boolean>; assets?: Record<string, boolean> }> = {
  default: {},
  'context-menu-slot-on': { slots: { 'context-menu': true } },
  'context-menu-slot-on-one-asset': { slots: { 'context-menu': true }, assets: { 'context-menu/compact-classic': true } },
  'asset-on-slot-off': { assets: { 'context-menu/compact-classic': true } },
  'toolbar-off-color-one-out': { slots: { toolbar: false }, assets: { 'color-theme/amber-ember': false } },
  'uac-never': { slots: { 'uac-policy': true } },
};
write('roll.json', {
  slotDefaults: Object.fromEntries(ASSET_TYPES.map((t) => [t, rollSlotDefault(t)])),
  cases: Object.fromEntries(Object.entries(rollCases).map(([k, rules]) => [k, { rules, plan: rollPlan(ASSET_TYPES, (t) => load(t), rules) }])),
});
// Search scoring: every port ranks the same entries the same way.
const searchCases = [
  { label: 'Randomize', kind: 'setting', detail: 'Settings › Appearance', keywords: [], query: 'random' },
  { label: 'Randomize assets', kind: 'action', detail: 'assets.random', keywords: [], query: 'randomize assets' },
  { label: 'Context menu', kind: 'setting', detail: 'Settings › Appearance › Randomize', keywords: ['axf.roll.slot.context-menu'], query: 'menu' },
  { label: 'Context menu', kind: 'setting', detail: 'Settings › Appearance › Randomize', keywords: ['axf.roll.slot.context-menu'], query: 'roll context' },
  { label: 'Pending builds', kind: 'view', detail: 'Page', keywords: ['pending'], query: 'Pending builds' },
  { label: 'Console token', kind: 'setting', detail: 'Settings › Account & security', keywords: [], query: 'tok' },
  { label: 'Console token', kind: 'setting', detail: 'Settings › Account & security', keywords: [], query: 'security' },
  { label: 'Café menu', kind: 'text', detail: 'Home', keywords: [], query: 'cafe' },
  { label: 'Output terminal', kind: 'action', detail: 'terminal.open', keywords: [], query: 'xyz' },
  { label: 'Next layout', kind: 'action', keywords: [], query: 'action layout' },
  { label: 'Swap (a+b)', kind: 'action', keywords: [], query: '(a+b' },
];
write('search.json', searchCases.map((c) => ({ ...c, score: Math.round(scoreEntry(c, c.query) * 1e6) / 1e6 })));
console.log('fixtures written to', out);

// Project manifests (project-manifest@1): every port's validator must report the same rule ids, in order.
// `existing` = the project-relative paths that exist, so pathsExist rules run identically everywhere.
const okManifest = {
  $manifest: 'project-manifest@1', name: 'axf-demo', displayName: 'AXF Demo', kind: 'app', status: 'active', version: '0.1.0',
  platforms: ['web'], framework: { relation: 'built-on', appManifest: 'axf.manifest.json' },
  repo: { host: 'github', owner: 'MossesX', name: 'axf-demo', exists: false, visibility: 'private' },
  location: { repo: 'MossesX/AmberX-AXF', path: 'apps/demo' }, data: { shared: ['state/', 'notes.json'] }, created: '2026-10-18',
};
const projectCases: Record<string, { manifest: unknown; existing?: string[] }> = {
  valid: { manifest: okManifest, existing: ['axf.manifest.json', 'state', 'notes.json'] },
  'valid-no-file-access': { manifest: okManifest },
  'not-an-object': { manifest: ['x'] },
  'empty-object': { manifest: {} },
  'bad-name': { manifest: { ...okManifest, name: 'Bad_Name' } },
  'reserved-name': { manifest: { ...okManifest, name: 'shared' } },
  'no-repo': { manifest: { ...okManifest, repo: undefined } },
  'repo-without-exists': { manifest: { ...okManifest, repo: { owner: 'MossesX', name: 'axf-demo' } } },
  'future-repo-no-location': { manifest: { ...okManifest, location: undefined } },
  'bad-vocab': { manifest: { ...okManifest, kind: 'website', status: 'paused', platforms: ['web', 'tv'], repo: { ...okManifest.repo, host: 'svn', visibility: 'secret' } } },
  'unsafe-data-paths': { manifest: { ...okManifest, data: { shared: ['/etc/passwd', '../up', 'ok.json', 'a\\b'] } }, existing: ['ok.json', 'axf.manifest.json'] },
  'missing-data-files': { manifest: okManifest, existing: [] },
  'warnings-only': { manifest: { ...okManifest, version: 'v1', created: 'yesterday', repo: { ...okManifest.repo, url: 'http://x' }, extra: 1 }, existing: ['axf.manifest.json', 'state', 'notes.json'] },
  'display-name-too-long': { manifest: { ...okManifest, displayName: 'x'.repeat(81) } },
  // Java's `$` also matches before a final line break; JavaScript's doesn't. Ports must follow the reference.
  'name-trailing-newline': { manifest: { ...okManifest, name: 'axf-demo\n' } },
  'pattern-input-too-long': { manifest: { ...okManifest, repo: { ...okManifest.repo, url: `https://${'x'.repeat(400)}` } } },
};
write('project-manifest.json', Object.fromEntries(Object.entries(projectCases).map(([k, c]) => {
  const raw = JSON.parse(JSON.stringify(c.manifest ?? null));
  const v = validateProjectManifest(raw, DEFAULT_PROJECT_RULES, c.existing ? { exists: (p) => c.existing!.includes(p) } : {});
  return [k, { manifest: raw, ...(c.existing ? { existing: c.existing } : {}), ok: v.ok, errors: v.errors.map((e) => e.rule), warnings: v.warnings.map((w) => w.rule) }];
})));

// Developer alerts: one alert per key, repeats bump the count, worse severity escalates, resolved ones reopen;
// delivery rules per channel with per-source overrides. Every port replays these steps and must match.
{
  type Step = { op: 'raise'; at: number; input: AlertInput } | { op: 'resolve'; at: number; keys: string[] } | { op: 'ack'; ids: string[] | 'all' };
  const rules: AlertRules = { channels: { bell: { min: 'info' }, ntfy: { min: 'error', sources: { ci: 'warning', builds: 'off' } }, webpush: { min: 'critical' } } };
  const steps: Step[] = [
    { op: 'raise', at: 1000, input: { source: 'ci', severity: 'warning', title: 'Android CI failed', key: 'ci:run:1', link: 'https://github.com/x/y/actions/runs/1' } },
    { op: 'raise', at: 2000, input: { source: 'ci', severity: 'warning', title: 'Android CI failed', key: 'ci:run:1' } },
    { op: 'ack', ids: ['ci:run:1'] },
    { op: 'raise', at: 3000, input: { source: 'ci', severity: 'warning', title: 'Android CI failed', key: 'ci:run:1', body: 'still failing' } },
    { op: 'raise', at: 4000, input: { source: 'ci', severity: 'error', title: 'Android CI failed', key: 'ci:run:1' } },
    { op: 'raise', at: 5000, input: { source: 'builds', severity: 'error', title: 'Build broken' } },
    { op: 'raise', at: 6000, input: { source: 'crashes', severity: 'critical', title: 'API crashed', body: 'Traceback…', meta: { where: 'api' } } },
    { op: 'resolve', at: 7000, keys: ['ci:run:1', 'nope'] },
    { op: 'raise', at: 8000, input: { source: 'ci', severity: 'info', title: 'Android CI failed', key: 'ci:run:1' } },
    { op: 'raise', at: 9000, input: { source: 'system', severity: 'oops' as never, title: '  spaced  ' } },
    { op: 'ack', ids: 'all' },
  ];
  let list: Alert[] = [];
  const events: unknown[] = [];
  for (const st of steps) {
    if (st.op === 'raise') {
      const r = applyAlert(list, st.input, st.at);
      list = r.list;
      events.push({ op: 'raise', key: r.alert.key, event: r.event, severity: r.alert.severity, count: r.alert.count, ack: r.alert.ack, targets: deliveryTargets(r.alert, r.event, rules), defaultTargets: deliveryTargets(r.alert, r.event, DEFAULT_ALERT_RULES), unread: unreadCount(list) });
    } else if (st.op === 'resolve') {
      list = resolveAlerts(list, st.keys, st.at);
      events.push({ op: 'resolve', unread: unreadCount(list) });
    } else {
      list = ackAlerts(list, st.ids);
      events.push({ op: 'ack', unread: unreadCount(list) });
    }
  }
  // trimming: 6 alerts kept to 4 drops the oldest resolved, then the oldest acknowledged
  let t: Alert[] = [];
  for (let i = 0; i < 6; i++) t = applyAlert(t, { source: 's', severity: 'info', title: `a${i}` }, 100 + i).list;
  t = resolveAlerts(t, ['s:a3'], 200);
  t = ackAlerts(t, ['s:a1']);
  const diagnostics: Diagnostic[] = [
    { kind: 'asset-conflict', type: 'color-theme', id: 'ocean', was: 'builtin', now: 'ai.example.themes' },
    { kind: 'setting-conflict', key: 'theme.accent', was: 'ai.example.a', now: 'ai.example.b' },
    { kind: 'contribution-conflict', what: 'settings tab', id: 'themes', was: 'ai.example.a', now: 'ai.example.b' },
    { kind: 'crash', where: 'web', message: 'TypeError: x is undefined', detail: 'at App.tsx:10' },
  ];
  write('alerts.json', {
    severities: ALERT_SEVERITIES,
    keys: [alertKey({ source: 'ci', title: 'Failed' }), alertKey({ source: ' ci ', title: ' Failed ', key: '  ' }), alertKey({ source: 'x', title: 'y', key: 'k1' })],
    ntfyPriority: Object.fromEntries(ALERT_SEVERITIES.map((s) => [s, ntfyPriority(s)])),
    rules,
    steps,
    events,
    final: sortAlerts(list),
    trim: { kept: trimAlerts(t, 4).map((a) => a.key) },
    diagnostics: diagnostics.map((d) => ({ diagnostic: d, alert: diagnosticToAlert(d) })),
  });
}

// Live sessions (live-session@1): the state reducer over every state × reserved kind (+ one owner kind), and a
// bounded event log replayed from several viewer positions (fresh, caught up, missed some, trimmed away, ahead).
{
  const kinds = [...Object.values(LIVE_KINDS), 'text'];
  const transitions = LIVE_STATES.flatMap((state) => kinds.map((kind) => ({ state, kind, next: reduceLiveState(state, kind) })));
  const log = new LiveEventLog(5);
  const appends = [
    { kind: LIVE_KINDS.open, data: { title: 'Chat' }, at: 1000 },
    { kind: LIVE_KINDS.turnStart, data: { turn: 't1' }, at: 1001 },
    { kind: 'text', data: { text: 'Hel' }, at: 1002 },
    { kind: 'text', data: { text: 'lo' }, at: 1003 },
    { kind: LIVE_KINDS.wait, data: { batch: 'b1' }, at: 1004 },
    { kind: LIVE_KINDS.resume, at: 1005 },
    { kind: LIVE_KINDS.turnEnd, data: { turn: 't1' }, at: 1006 },
  ];
  let state: string = 'idle';
  const states: string[] = [];
  for (const a of appends) { log.append(a.kind, a.data, a.at); state = reduceLiveState(state as never, a.kind); states.push(state); }
  const queries = [
    { after: 0, max: 500 }, { after: 2, max: 500 }, { after: 4, max: 2 }, { after: 6, max: 500 },
    { after: 7, max: 500 }, { after: 9, max: 500 }, { after: -3, max: 500 }, { after: 5, max: 0 },
  ];
  write('live-session.json', {
    states: LIVE_STATES,
    kinds: LIVE_KINDS,
    transitions,
    log: { limit: 5, appends, states, lastSeq: log.lastSeq, firstSeq: log.firstSeq, kept: log.all() },
    replays: queries.map((q) => ({ ...q, result: log.since(q.after, q.max) })),
  });
}

// MCP client (mcp-client@1, core/engines/mcp.ts): JSON-RPC framing, SSE parsing, Streamable HTTP rules, pagination,
// error mapping, tool effects + the outbound call gate, text rendering, server ids and validation. Replayed by
// framework/spec/check-mcp.mts (TS), the Kotlin McpConformanceTest and framework/python/axf_libs/mcp/test.py.
{
  const messages = [
    '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
    '{"jsonrpc":"2.0","id":"a","error":{"code":-32601,"message":"no such method","data":{"m":"x"}}}',
    '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
    '{"jsonrpc":"2.0","id":7,"method":"sampling/createMessage","params":{}}',
    '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}',
    '[{"jsonrpc":"2.0","id":1,"result":1},{"jsonrpc":"2.0","method":"n"}]',
    '{"jsonrpc":"1.0","id":1,"result":1}',
    '{"jsonrpc":"2.0","id":1}',
    '{"jsonrpc":"2.0","id":{"x":1},"method":"m"}',
    '{"jsonrpc":"2.0","id":1,"error":{"code":"x","message":"m"}}',
    'not json',
    '[]',
    '42',
  ];
  const sse = [
    'event: message\ndata: {"a":1}\n\n',
    'data: line1\ndata: line2\n\nid: 9\nretry: 250\nevent: ping\ndata: x\n\n',
    ': comment\r\ndata:no-space\r\n\r\ndata: tail-without-blank',
    'event: alone\n\ndata: {"b":2}\nid: bad\u0000id\n\n',
    'data: one\rdata: two\r\r',
    'retry: notanumber\ndata: r\n\n',
  ];
  const chunked = ['data: {"a":', '1}\n', '\ndata: {"b":2}\n\n'];
  const chunkParser = new SseParser();
  const chunkEvents = chunked.flatMap((c) => chunkParser.feed(c));
  chunkEvents.push(...chunkParser.end());
  const headers = [
    {}, { sessionId: 'abc' }, { sessionId: 'abc', protocolVersion: '2025-06-18' }, { method: 'GET' as const, sessionId: 's' }, { method: 'DELETE' as const, sessionId: 's', protocolVersion: '2025-03-26' }, { sessionId: null, protocolVersion: null },
  ];
  const responses = [
    [200, 'application/json', false], [200, 'application/json; charset=utf-8', true], [200, 'text/event-stream', true], [202, undefined, true], [404, 'text/plain', true], [404, 'text/plain', false],
    [200, 'text/html', false], [200, undefined, false], [500, 'application/json', true], [401, undefined, false], [204, undefined, false],
  ] as const;
  const negotiations = [
    { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true }, resources: {} }, serverInfo: { name: 'hub', version: '1.2', title: 'axHub' }, instructions: 'Be nice.' },
    { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'old' } },
    { protocolVersion: '2030-01-01', capabilities: {} },
    { capabilities: {} },
    'nope',
    { protocolVersion: '2025-03-26', capabilities: { prompts: null, logging: {} } },
  ];
  const capsCases = [{ tools: {} }, { tools: { listChanged: true }, resources: {}, prompts: null }, {}, null, { logging: false }];
  const pageSets = [
    [{ items: ['a', 'b'] }],
    [{ items: ['a'], nextCursor: 'c1' }, { items: ['b'], nextCursor: 'c2' }, { items: ['c'] }],
    [{ items: ['a'], nextCursor: 'c1' }, { items: ['b'], nextCursor: 'c1' }, { items: ['x'] }],
    [{ items: ['a'], nextCursor: 'c1' }, { items: ['b'], nextCursor: '' }, { items: ['x'] }],
    [{ items: [] }],
    [{ items: ['a'], nextCursor: 'c1' }, { items: ['b'], nextCursor: 'c2' }, { items: ['c'], nextCursor: 'c3' }, { items: ['d'] }],
  ];
  const rpcErrors = [-32700, -32600, -32601, -32602, -32603, -32002, -32001, -32800, -1, 42].map((code) => ({ code, message: code === 42 ? '' : `err ${code}` }));
  const httpErrors = [400, 401, 403, 404, 405, 408, 409, 429, 500, 502, 503, 504, 302, 200];
  const transportErrors = [['timeout', 'no answer within 30000 ms'], ['cancelled', 'cancelled'], ['network', 'ECONNREFUSED'], ['protocol', 'bad framing']] as const;
  const annotations = [null, {}, { readOnlyHint: true }, { readOnlyHint: true, destructiveHint: true }, { destructiveHint: true }, { destructiveHint: false }, { idempotentHint: true }, { readOnlyHint: false, destructiveHint: false }];
  const roles = [['*'], ['mcp.*'], ['mcp.call'], ['mcp.call', 'mcp.call.write'], ['mcp.call.*'], [], ['other.*', 'mcp.call.destructive']];
  const contents = [
    [{ type: 'text', text: 'hello' }],
    [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
    [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
    [{ type: 'resource', resource: { uri: 'file:///x', text: 'body', mimeType: 'text/plain' } }],
    [{ type: 'resource', resource: { uri: 'file:///y', blob: 'QUJD' } }],
    [{ type: 'resource_link', uri: 'file:///z', mimeType: 'text/plain' }],
    [{ type: 'audio', mimeType: 'audio/wav', data: 'AA' }, { type: 'resource', resource: { uri: 'u' } }],
    [],
    null,
  ];
  const ids = [['axHub', []], ['axHub', ['axhub']], ['axHub', ['axhub', 'axhub-2']], ['  --Weird  Name!! ', []], ['', []], ['x'.repeat(60), []], ['Ünïcode Server', []]] as const;
  const inputs = [
    { name: 'Hub', url: 'https://example.com/mcp' },
    { name: '', url: '' },
    { name: 'x', url: 'ftp://x' },
    { name: 'x', url: 'http://localhost:7090/mcp', id: 'Bad Id', tokenEnv: 'lower' },
    { name: 'y'.repeat(81), url: 'https://e.com/' + 'p'.repeat(500) },
    { name: 'ok', url: 'https://e.com', id: 'ok-1', tokenEnv: 'AXHUB_TOKEN' },
  ];
  const skeletons = [
    { properties: { a: { type: 'string' }, b: { type: 'number', default: 3 } }, required: ['a'] },
    { properties: { s: { type: 'string' }, i: { type: 'integer' }, b: { type: 'boolean' }, arr: { type: 'array' }, o: { type: 'object' }, e: { enum: ['x', 'y'] }, m: { type: ['number', 'null'] } }, required: ['s', 'i', 'b', 'arr', 'o', 'e', 'm'] },
    { properties: { opt: { type: 'string' } } },
    null,
  ];
  write('mcp-client.json', {
    version: MCP_PROTOCOL_VERSION,
    supported: MCP_SUPPORTED_VERSIONS,
    sessionHeader: MCP_SESSION_HEADER,
    versionHeader: MCP_VERSION_HEADER,
    permissions: MCP_PERMISSIONS,
    initialize: initializeParams(),
    requests: [rpcRequest(1, 'tools/list'), rpcRequest('x', 'tools/call', { name: 't', arguments: { a: 1 } }), rpcNotification('notifications/initialized'), rpcNotification('notifications/cancelled', { requestId: 3, reason: 'user' })],
    messages: messages.map((text) => ({ text, parsed: parseMessages(text) })),
    sse: sse.map((text) => ({ text, events: parseSse(text) })),
    sseChunked: { chunks: chunked, events: chunkEvents },
    headers: headers.map((o) => ({ options: o, headers: mcpHeaders(o) })),
    responses: responses.map(([status, contentType, hadSession]) => ({ status, contentType: contentType ?? null, hadSession, kind: classifyResponse(status, contentType, hadSession) })),
    negotiate: negotiations.map((result) => ({ result, outcome: negotiate(result) })),
    offers: capsCases.map((capabilities) => ({ capabilities, tools: offers(capabilities, 'tools'), resources: offers(capabilities, 'resources'), prompts: offers(capabilities, 'prompts'), logging: offers(capabilities, 'logging') })),
    pageParams: [null, '', 'c1'].map((c) => ({ cursor: c, params: pageParams(c) ?? null })),
    pages: pageSets.map((pages, i) => ({ pages, maxPages: i === 5 ? 3 : 100, merged: mergePages(pages, i === 5 ? 3 : 100) })),
    rpcErrors: rpcErrors.map((e) => ({ error: e, wire: errorFromRpc(e) })),
    httpErrors: httpErrors.map((status) => ({ status, wire: errorFromHttp(status) })),
    transportErrors: transportErrors.map(([kind, message]) => ({ kind, message, wire: errorFromTransport(kind, message) })),
    effects: annotations.flatMap((a) => [false, true].map((strict) => ({ annotations: a, strict, effect: toolEffect(a, strict) }))),
    gates: roles.flatMap((granted) => (['read', 'write', 'destructive'] as const).map((effect) => ({ granted, effect, gate: callGate(effect, granted) }))),
    // a host mapping the four permissions onto its own policy (the Dev Console: everything = dev.tools)
    mappedGates: [['dev.tools'], ['dev.*'], ['mcp.call']].flatMap((granted) => (['read', 'write', 'destructive'] as const).map((effect) => ({ granted, effect, perms: { MANAGE: 'dev.tools', CALL: 'dev.tools', WRITE: 'dev.tools', DESTRUCTIVE: 'dev.tools' }, gate: callGate(effect, granted, { MANAGE: 'dev.tools', CALL: 'dev.tools', WRITE: 'dev.tools', DESTRUCTIVE: 'dev.tools' }) }))),
    contentText: contents.map((content) => ({ content, text: contentText(content) })),
    serverIds: ids.map(([name, taken]) => ({ name, taken, id: serverIdFor(name, taken) })),
    validate: inputs.map((input) => ({ input, problems: validateServerInput(input) })),
    skeletons: skeletons.map((schema) => ({ schema, args: argumentSkeleton(schema as never) })),
  });
}
