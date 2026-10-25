/**
 * Patches web self-test (CI: npx -y tsx apps/patches-web/test.mts): suite mode's pure rules in src/patches.ts.
 * The tab marker, the front app's banner items, one search, links between the apps, deep links, tab keys, the menus,
 * the tab group. The framework side (what the apps send) is framework/spec/check-suite.mts.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseEmbedMessage, embedFromQueryFull } from './src/axf/core';
import {
  DEFAULT_TABS, HUB, MAX_TABS, TABS, TAB_TAKES, appsMessage, bannerCounter, guestMenuCounters, guestMenuId, guestMenuItems, guestSearchEntries, hashForView,
  mirrorBanner, mirroredId, moveTab, normalizeOrigin, pluginTabUrl, readTabs, shareSummary, stripUrl, tabChoices, tabForUrl, tabKey, tabOrigin, tabShortcut,
  tabUrl, tabViewId, viewFromHash,
} from './src/patches';

let checks = 0;
const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };
const ok = (v: unknown, what: string) => { assert.ok(v, what); checks++; };
const [konsole, pilot, axhub] = TABS as [typeof TABS[0], typeof TABS[0], typeof TABS[0]];

/* the tabs and their marker */
eq(TABS.map((t) => t.id), ['console', 'pilot', 'axhub'], 'three app tabs');
eq(normalizeOrigin('https://console.example.com/some/path'), 'https://console.example.com', 'origin: path dropped');
eq([normalizeOrigin('http://x.example.com'), normalizeOrigin('https://u:p@x.example.com'), normalizeOrigin(''), normalizeOrigin(7)], [null, null, null, null], 'origin: https only, no credentials');
eq(tabOrigin(konsole, 'nonsense'), 'https://console.amberxai.com', 'bad saved address → default');
eq(tabOrigin(axhub, 'https://elsewhere.example.com'), HUB, 'axHub is always the hub');
const u = new URL(tabUrl(konsole, 'https://console.example.com'));
const e = embedFromQueryFull(u.search);
eq(e?.host, 'patches', 'tab marker: host');
eq([...(e?.takes ?? [])].sort(), [...TAB_TAKES].sort(), 'tab marker: banner, menu, search, links');
eq([...(e?.hidden ?? [])].sort(), ['app-menu', 'banner'], 'tab marker: only what Patches carries is hidden');
eq(u.searchParams.get('axf-embed-hide'), 'none', 'tab marker: hide=none, so an older build shows its own banner');
eq(new URL(tabUrl(konsole, 'https://console.example.com', 'https://console.example.com/x?y=1#z')).pathname, '/x', 'tab marker on a deep page keeps its path');
eq(embedFromQueryFull(new URL(stripUrl('https://console.example.com')).search)?.takes ?? null, null, 'banner strip takes nothing');
eq(embedFromQueryFull(new URL(pluginTabUrl(konsole, 'https://console.example.com', 'todo-manager')).search)?.page, 'view:todo-manager', 'plugin tab: page mode');
eq(shareSummary(['banner', 'app-menu', 'search', 'links']), 'banner, menu, search and links', 'share summary');
eq(shareSummary(['search']), 'search', 'share summary: one');
ok(shareSummary([]).startsWith('nothing'), 'share summary: none = older build');

/* the front app's banner items on Patches' banner */
const items = [
  { key: 'clock:digital-12h', type: 'clock', at: 'right', order: 0, data: { format: '12h' } },
  { key: 'search-bar:everything', type: 'search-bar', at: 'center', order: 0, data: {} },
  { key: 'status:axhub', type: 'status', at: 'right', order: 1, data: { counter: 'hub.live' }, value: 1 },
  { key: 'action-button:settings', type: 'action-button', at: 'right', order: 2, data: { action: 'app.settings', icon: 'settings' } },
  { key: 'action-button:alerts-bell', type: 'action-button', at: 'right', order: 3, data: { action: 'alerts.open', icon: 'bell' } },
  { key: 'counter:alerts-bell', type: 'counter', at: 'right', order: 4, data: { counter: 'alerts.unread', link: 'alerts.open' }, value: 3, popup: '3 new' },
  { key: 'badge:claude', type: 'badge', at: 'left', order: 0, data: { text: 'Claude', link: 'settings.open:claude-badge' } },
  { key: 'link:docs', type: 'link', at: 'right', order: 5, data: { href: 'https://example.com/docs' } },
] as const;
const mirrored = mirrorBanner('console', items as never);
eq(mirrored.map((m) => m.key), ['action-button:alerts-bell', 'counter:alerts-bell', 'badge:claude', 'link:docs'], 'banner: Patches’ own kinds, the axHub badge and the app’s Settings button left out');
eq(mirrored[0]!.data.action, 'patches.w:console:action-button:alerts-bell', 'banner: a button’s tap goes back to its app');
eq(mirrored[1]!.data.link, 'patches.w:console:counter:alerts-bell', 'banner: a counter’s tap too');
eq(mirrored[1]!.counter, { name: 'patches.g.console.alerts.unread', value: 3 }, 'banner: counters renamed per app, number kept');
eq(mirrored[1]!.data.counter, bannerCounter('console', 'alerts.unread'), 'banner: the widget reads the renamed counter');
eq(mirrored[1]!.popup, '3 new', 'banner: pop-up kept');
eq(mirrored[3]!.data, { href: 'https://example.com/docs' }, 'banner: a link stays a link');
ok(mirrored.every((m) => /^[a-z0-9][a-z0-9-]{1,47}$/.test(m.id)), 'banner: every id is an asset id');
eq(mirroredId('console', 'x'.repeat(80), 3).length <= 48, true, 'banner: long keys cut to an asset id');
ok(mirrored.find((m) => m.at === 'left')!.order > 5, 'banner: left items after the tab-in-front label');
ok(mirrored.filter((m) => m.at === 'right').every((m) => m.order < 10), 'banner: right items before Patches’ own');

/* one search */
const found = guestSearchEntries(pilot, [{ id: 'e0', kind: 'view', label: 'Designer', detail: 'Page' }, { id: 'e1', kind: 'action', label: 'Locked thing', locked: true }]);
eq(found, [{ id: 'patches.pilot.e0', kind: 'view', label: 'Designer', detail: 'Pilot · Page', keywords: ['Pilot'], focus: { kind: 'action', spec: 'patches.find:pilot:e0' } }], 'search: labelled with the app, picked in its tab, locked left out');

/* links between the apps */
const o = { console: 'https://console.example.com', pilot: 'https://pilot.example.com', axhub: 'https://hub.example.com' };
eq(tabForUrl('https://pilot.example.com/apps/x?y=1', o)?.tab.id, 'pilot', 'link: another app’s page opens in its tab');
eq(tabForUrl('https://hub.example.com/', o)?.tab.id, 'axhub', 'link: axHub’s front end opens in its tab');
eq(tabForUrl('https://hub.example.com/auth/admin/approvals/7', o), null, 'link: a hub server page opens outside');
eq(tabForUrl('https://elsewhere.example.org/', o), null, 'link: other sites open outside');
eq(tabForUrl('http://pilot.example.com/', o), null, 'link: http never');
const apps = parseEmbedMessage(appsMessage(o));
eq(apps && apps.type === 'apps' ? apps.apps.map((a) => a.origin) : null, Object.values(o), 'apps message parses on the app side');

/* deep links and tab keys */
eq(viewFromHash('#/pilot', ['console', 'pilot']), 'pilot', 'hash: #/pilot');
eq(viewFromHash('#pilot', ['console', 'pilot']), 'pilot', 'hash: #pilot');
eq(viewFromHash('#/nope', ['console']), null, 'hash: unknown view ignored');
eq(viewFromHash(hashForView('tab.console.todo-manager'), ['tab.console.todo-manager']), 'tab.console.todo-manager', 'hash: round trip');
const key = (o2: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code: string; key: string }>) => ({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...o2 });
eq(tabShortcut(key({ altKey: true, code: 'Digit3' })), 2, 'keys: Alt+3 = third tab');
eq(tabShortcut(key({ altKey: true, key: '1' })), 0, 'keys: Alt+1 by key');
eq([tabShortcut(key({ altKey: true, ctrlKey: true, code: 'Digit1' })), tabShortcut(key({ code: 'Digit1' })), tabShortcut(key({ altKey: true, code: 'Digit0' }))], [null, null, null], 'keys: only Alt+1 … Alt+9');

/* the front app's menus */
const menus = [{ id: 'view', label: 'View', items: [{ id: 'a', label: 'Toolbar', check: true }, { id: 'b', label: 'Locked', locked: true }, { id: 'c', label: 'Alerts', count: 4 }, { id: 'd', label: 'Empty', items: [] }] }];
const top = guestMenuItems('console', menus as never);
eq(top.map((m) => m.label), ['View'], 'menus: one top-level menu per app menu');
eq(top[0]!.items!.map((i) => [i.label, i.action]), [['Toolbar', 'patches.menu:console:a'], ['Alerts', 'patches.menu:console:c'], ['Empty', 'patches.menu:console:d']], 'menus: items run back in the app, locked ones left out');
eq(guestMenuCounters('console', menus as never), { 'patches.menu.console.a': 1, 'patches.menu.console.c': 4 }, 'menus: checks and counts as counters');
eq(guestMenuId('console', 'g.View Menu'), 'g-console-g-view-menu', 'menus: top-level id');

/* the tab group */
eq(readTabs([{ kind: 'app', app: 'pilot' }, { kind: 'app', app: 'pilot' }, { kind: 'app', app: 'nope' }, { kind: 'plugin', app: 'console', plugin: 'todo', view: 'todo-manager', label: 'Todos' }]).map(tabKey), ['pilot', 'console:todo-manager'], 'tabs: checked, each once');
eq(readTabs(Array.from({ length: 30 }, (_, i) => ({ kind: 'plugin', app: 'console', plugin: `p${i}`, view: `v${i}`, label: `V${i}` }))).length, MAX_TABS, 'tabs: at most 20');
eq(moveTab(DEFAULT_TABS, 'pilot', -1).map(tabKey), ['pilot', 'console', 'axhub'], 'tabs: move up');
eq(moveTab(DEFAULT_TABS, 'console', -1).map(tabKey), ['console', 'pilot', 'axhub'], 'tabs: top stays');
const choices = tabChoices([{ kind: 'app', app: 'console' }], { console: [{ id: 'todo', name: 'Todos', on: false, tab: { view: 'todo-manager' }, model: 'opus' }, { id: 'plain', name: 'Plain', on: true }] });
eq(choices.apps.map((c) => c.added), [true, false, false], 'add tab: apps, the console already a tab');
eq(choices.plugins.map((g) => g.choices.map((c) => [tabViewId(c.entry), c.on, c.model])), [[['tab.console.todo-manager', false, 'opus']]], 'add tab: only tabable plugins, switched-off ones say so');

/* Patches ships every look asset the apps in its tabs can pick (one look: an id Patches lacks would fall back). */
const shared = ['color-theme', 'style-theme', 'button', 'slider', 'container', 'dialog', 'popup', 'tab-group', 'gauge', 'meter'];
const ids = (app: string, t: string) => { try { return readdirSync(new URL(`../${app}/src/assets/${t}/`, import.meta.url)).filter((n) => n.endsWith('.json')).sort(); } catch { return []; } };
for (const t of shared) for (const other of ['console-web', 'axhub-web']) {
  const missing = ids(other, t).filter((n) => !ids('patches-web', t).includes(n));
  eq(missing, [], `Patches has every ${t} ${other} has`);
}
const banner = JSON.parse(readFileSync(new URL('./src/assets/banner/patches.json', import.meta.url), 'utf8'));
ok(banner.data.attach.some((a: { type: string; id: string }) => a.type === 'search-bar' && a.id === 'suite'), 'banner: one search box for every app');

console.log(`patches-web test: ${checks} checks passed`);
