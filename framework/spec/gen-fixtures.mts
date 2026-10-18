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
import { ATTACHABLE_TYPES, BADGE_TONE_TOKEN, BANNER_SIDES, bannerVars, formatClock, placeAttachments } from '../core/engines/banner';
import { scoreEntry } from '../core/engines/search';
import { ackAlerts, alertKey, applyAlert, deliveryTargets, diagnosticToAlert, DEFAULT_ALERT_RULES, ntfyPriority, resolveAlerts, sortAlerts, trimAlerts, unreadCount, ALERT_SEVERITIES, type Alert, type AlertInput, type AlertRules, type Diagnostic } from '../core/engines/alerts';
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
  const exists = new Set([...load('badge').map((a) => `badge:${a.id}`), ...load('clock').map((a) => `clock:${a.id}`), 'badge:claude']);
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
