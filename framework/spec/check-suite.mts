/**
 * Self-test for suite mode on the web port (CI: npx -y tsx framework/spec/check-suite.mts): a host (Patches) and the apps
 * in its tabs working as one app (Brett, Oct 24 2026).
 *  1. the marker Patches puts on a tab: nothing hidden but what it carries (the banner, the menu bar), four takes
 *  2. messages: banner / search-catalog / focus-search / hotkey / open-url / apps / ready, parsed, capped, refused
 *  3. a plugin drawn on the banner keeps loading when the host carries the banner (skipWhen hidden:banner)
 *  4. the guest runtime: ready once, banner items + taps, counters, pop-ups, the search catalog + picks, links to the
 *     host's other apps, host → app open-settings and run, plugin lists without the plugins take
 *  5. one look, own structure: two apps share colours / style / controls and keep their own layout, menus and bars
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EMBED_MESSAGE, embedFromQueryFull, embedSkipReason, embedTakeIds, embedUrlFull, parseEmbedMessage } from '../core/engines/embed';
import { APPEARANCE_FRAME, appearanceShared, appearanceSharedTypes, appSlotKey, mergeAppearanceFor, parseAppSlotKey, resolveAppearanceFor } from '../core/engines/appearance';
import { AxfRuntime } from '../core/runtime';

let checks = 0;
const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };
const ok = (v: unknown, what: string) => { assert.ok(v, what); checks++; };
const M = (o: Record<string, unknown>) => ({ $axf: EMBED_MESSAGE, ...o });

/* ---------- 1. the marker ---------- */
const TAKES = ['banner', 'app-menu', 'search', 'links'];
const url = embedUrlFull('https://console.example.com/', 'patches', { hidden: ['none'], takes: TAKES });
eq(url, 'https://console.example.com/?axf-embed=patches&axf-embed-hide=none&axf-embed-take=app-menu,banner,search,links', 'marker url');
const embed = embedFromQueryFull(new URL(url).search);
eq(embed?.host, 'patches', 'marker: host');
eq([...(embed?.takes ?? [])].sort(), [...TAKES].sort(), 'marker: takes');
eq([...(embed?.hidden ?? [])].sort(), ['app-menu', 'banner'], 'marker: only what the host carries is hidden');
for (const t of ['banner', 'search', 'links']) ok(embedTakeIds().includes(t), `take ${t} registered`);
eq(embedFromQueryFull('?axf-embed=patches&axf-embed-take=banner,nonsense')?.takes, ['banner'], 'unknown takes dropped');

/* ---------- 2. messages ---------- */
const bannerItem = { key: 'counter:alerts', type: 'counter', at: 'right', order: 3, data: { counter: 'alerts.unread' }, value: 4, popup: '  New alert  ' };
eq(parseEmbedMessage(M({ type: 'banner', items: [bannerItem] })), M({ type: 'banner', items: [{ key: 'counter:alerts', type: 'counter', at: 'right', order: 3, data: { counter: 'alerts.unread' }, value: 4, popup: 'New alert' }] }), 'banner: kept');
eq((parseEmbedMessage(M({ type: 'banner', items: [{ ...bannerItem, at: 'top' }, { ...bannerItem, key: 'bad key!' }, { ...bannerItem, type: 'Bad' }, bannerItem, bannerItem] })) as { items: unknown[] }).items.length, 1, 'banner: bad sides, keys, types and repeats dropped');
eq((parseEmbedMessage(M({ type: 'banner', items: Array.from({ length: 50 }, (_, i) => ({ ...bannerItem, key: `k${i}` })) })) as { items: unknown[] }).items.length, 32, 'banner: capped at 32 items');
eq((parseEmbedMessage(M({ type: 'banner', items: [{ ...bannerItem, data: { text: 'x'.repeat(5000) } }] })) as { items: unknown[] }).items.length, 0, 'banner: oversized data dropped');
eq(parseEmbedMessage(M({ type: 'banner', items: 'nope' })), null, 'banner: not a list = refused');
const entry = { id: 'e0', kind: 'view', label: 'Home', detail: 'Page', icon: 'home', keywords: ['start'] };
eq(parseEmbedMessage(M({ type: 'search-catalog', entries: [entry] })), M({ type: 'search-catalog', entries: [entry] }), 'search: kept');
eq((parseEmbedMessage(M({ type: 'search-catalog', entries: [{ ...entry, id: 'x1' }, { ...entry, id: 'e1', kind: 'Bad Kind' }, { ...entry, id: 'e2', label: '' }] })) as { entries: unknown[] }).entries.length, 0, 'search: bad ids, kinds, empty labels dropped');
eq(parseEmbedMessage(M({ type: 'focus-search' })), M({ type: 'focus-search' }), 'focus-search');
eq(parseEmbedMessage(M({ type: 'hotkey', key: 'Alt+3' })), M({ type: 'hotkey', key: 'Alt+3' }), 'hotkey: tab key');
for (const k of ['Alt+0', 'Ctrl+K', 'a', 'Alt+10']) eq(parseEmbedMessage(M({ type: 'hotkey', key: k })), null, `hotkey refused: ${k}`);
eq(parseEmbedMessage(M({ type: 'open-url', url: 'https://pilot.example.com/apps?x=1' })), M({ type: 'open-url', url: 'https://pilot.example.com/apps?x=1' }), 'open-url: https kept');
for (const u of ['http://pilot.example.com/', 'javascript:alert(1)', 'https://user:pw@pilot.example.com/', 'https://' + 'a'.repeat(1200) + '.com/']) eq(parseEmbedMessage(M({ type: 'open-url', url: u })), null, `open-url refused: ${u.slice(0, 30)}`);
eq(parseEmbedMessage(M({ type: 'apps', apps: [{ id: 'pilot', label: 'Pilot', origin: 'https://pilot.example.com/' }, { id: 'path', label: 'P', origin: 'https://p.example.com/a/path' }, { id: 'Bad Id', label: 'x', origin: 'https://x.example.com' }, { id: 'hub', label: 'Hub', origin: 'http://hub.example.com' }] })),
  M({ type: 'apps', apps: [{ id: 'pilot', label: 'Pilot', origin: 'https://pilot.example.com' }] }), 'apps: bare https origins only (no paths), ids checked');
eq((parseEmbedMessage(M({ type: 'ready', app: 'axf-console', takes: ['banner', 'search'] })) as { takes?: string[] }).takes, ['banner', 'search'], 'ready: says what it hands over');

/* ---------- 3. plugins drawn on the banner ---------- */
eq(embedSkipReason(embed, ['hidden:banner']), null, 'banner carried by the host: banner plugins still load');
ok(embedSkipReason({ host: 'patches', hidden: ['banner'] }, ['hidden:banner']), 'banner only hidden: banner plugins are skipped as before');

/* ---------- 4. the guest runtime ---------- */
const root = new URL('..', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest = { app: { id: 'suite-app', name: 'Suite app' }, defaults } as never;
const posted: Record<string, unknown>[] = [];
(globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost = { post: (j: string) => posted.push(JSON.parse(j)) };
const last = (type: string) => [...posted].reverse().find((m) => m.type === type) as Record<string, unknown> | undefined;
const rt = new AxfRuntime({ manifest, assets, storageKey: `axf-suite:${Math.random()}`, embed });
const guest = (globalThis as unknown as { AxfEmbedGuest: { receive: (j: string) => void } }).AxfEmbedGuest;
eq(rt.slotHidden('banner'), true, 'guest: its banner is hidden (the host draws it)');
eq(rt.slotHidden('app-menu'), true, 'guest: its menu bar is hidden (the host carries it)');

rt.announceReady();
rt.announceReady();
eq(posted.filter((m) => m.type === 'ready'), [M({ type: 'ready', app: 'suite-app', takes: embed?.takes })], 'ready: once, with what it hands over');

let settingsRan = 0;
rt.actions.register('app.settings', () => { settingsRan++; }, { label: 'Settings' });
rt.attachToBanner({ type: 'action-button', id: 'settings', at: 'right', order: 40, origin: 'test' });
rt.attachToBanner({ type: 'counter', id: 'alerts', at: 'right', order: 41, origin: 'test' });
rt.setBadge('alerts.unread', 7);
rt.showBannerPopup('counter:alerts', 'Three new alerts', 5000);
ok(rt.shareBanner(true), 'banner: sent');
const items = (last('banner')?.items ?? []) as { key: string; type: string; at: string; value?: number; popup?: string; data: Record<string, unknown> }[];
ok(parseEmbedMessage(last('banner')), 'banner: what the guest sends parses on the host');
eq(items.map((i) => i.key), ['search-bar:everything', 'clock:digital-12h', 'action-button:settings', 'counter:alerts'], 'banner: every item, in banner order, though the banner is hidden');
eq(items.find((i) => i.key === 'counter:alerts')?.value, 7, 'banner: a counter carries its number');
eq(items.find((i) => i.key === 'counter:alerts')?.popup, 'Three new alerts', 'banner: a pop-up travels with its item');
eq(rt.shareBanner(), false, 'banner: unchanged = not sent again');
ok(rt.runSharedItem('w:action-button:settings'), 'banner tap: runs');
eq(settingsRan, 1, 'banner tap: ran the button’s action here');
eq(rt.runSharedItem('w:clock:nope'), false, 'banner tap: only what it sent');
guest.receive(JSON.stringify(M({ type: 'run', id: 'w:action-button:settings' })));
eq(settingsRan, 2, 'host run message: runs the tap');

let pinged = 0;
rt.actions.register('suite.ping', () => { pinged++; }, { label: 'Ping the suite test' });
ok(rt.shareSearch(), 'search: sent');
const entries = (last('search-catalog')?.entries ?? []) as { id: string; kind: string; label: string }[];
ok(entries.length > 5 && entries.every((e) => /^e[0-9]+$/.test(e.id) && e.kind !== 'text'), 'search: entries with host ids, no page words');
const ping = entries.find((e) => e.label === 'Ping the suite test');
ok(ping, 'search: an action is listed');
ok(rt.runSharedItem(`s:${ping!.id}`), 'search pick: focused');
eq(pinged, 1, 'search pick: ran the action here');
eq(rt.runSharedItem('s:e99999'), false, 'search pick: unknown entry refused');

eq(rt.openLink('https://pilot.example.com/x'), false, 'links: nothing before the host names its apps');
guest.receive(JSON.stringify(M({ type: 'apps', apps: [{ id: 'pilot', label: 'Pilot', origin: 'https://pilot.example.com' }] })));
eq(rt.siblingApps(), [{ id: 'pilot', label: 'Pilot', origin: 'https://pilot.example.com' }], 'links: the host named its apps');
ok(rt.openLink('https://pilot.example.com/x?y=1'), 'links: a link to another app goes to the host');
eq(last('open-url'), M({ type: 'open-url', url: 'https://pilot.example.com/x?y=1' }), 'links: open-url sent');
eq(rt.openLink('https://elsewhere.example.org/'), false, 'links: other sites open as before');

guest.receive(JSON.stringify(M({ type: 'open-settings' })));
eq(settingsRan, 3, 'host open-settings: the app opens its own settings');
ok(rt.reportPluginsToHost([{ id: 'p', name: 'P', on: true }]), 'plugins: listed to any host');
eq(last('plugins'), M({ type: 'plugins', plugins: [{ id: 'p', name: 'P', on: true }] }), 'plugins: report sent');
eq(rt.hostTakes('plugins'), false, 'plugins: the app keeps running its own');

// A page the host shows alone (a plugin tab) shares nothing and never reports.
posted.length = 0;
const page = new AxfRuntime({ manifest, assets, storageKey: `axf-suite:${Math.random()}`, embed: embedFromQueryFull('?axf-embed=patches&axf-embed-page=view:todo-manager') });
eq(page.shareBanner(true), false, 'page mode: no banner');
eq(page.shareSearch(), false, 'page mode: no search');
eq(page.reportPluginsToHost([{ id: 'p', name: 'P', on: true }]), false, 'page mode: no plugin list');
// The same app standalone: nothing is sent anywhere.
const solo = new AxfRuntime({ manifest, assets, storageKey: `axf-suite:${Math.random()}`, embed: null });
eq([solo.shareBanner(true), solo.shareSearch(), solo.openLink('https://pilot.example.com/'), solo.reportPluginsToHost([])], [false, false, false, false], 'standalone: nothing is shared');
eq(solo.slotHidden('banner'), false, 'standalone: banner shown');

/* ---------- 5. one look, own structure ---------- */
for (const t of ['color-theme', 'style-theme', 'button', 'slider', 'container', 'dialog', 'popup', 'tab-group', 'gauge', 'meter']) ok(appearanceShared(t), `shared look: ${t}`);
for (const t of ['layout', 'banner', 'app-menu', 'nav-menu', 'toolbar', 'context-menu', 'settings', 'uac-policy']) eq(appearanceShared(t), false, `own structure: ${t}`);
ok(appearanceSharedTypes().includes('color-theme') && !appearanceSharedTypes().includes('layout'), 'shared types list');
eq(appSlotKey('axf-console', 'layout'), 'app--axf-console--layout', 'per-app key');
eq(parseAppSlotKey('app--axf-console--layout'), { app: 'axf-console', type: 'layout' }, 'per-app key parsed');
eq([appSlotKey('Bad App', 'layout'), parseAppSlotKey('layout'), parseAppSlotKey('app--x--')], [null, null, null], 'bad per-app keys');
const at = '2026-10-24T00:00:00.000Z';
let doc = mergeAppearanceFor({ $axf: APPEARANCE_FRAME }, { slots: { 'color-theme': 'midnight-ink', layout: 'focus-top' }, hidden: { toolbar: true } }, 'axf-console', 'axf-console', at);
doc = mergeAppearanceFor(doc, { slots: { button: 'pill-outline', layout: 'classic-ide' }, hidden: { toolbar: false } }, 'axhub-web', 'axhub-web', at);
eq(doc.slots?.['color-theme'], 'midnight-ink', 'merge: a colour pick is one for every app');
eq(doc.slots?.button, 'pill-outline', 'merge: a control pick is one for every app');
eq([doc.slots?.layout, doc.slots?.['app--axf-console--layout'], doc.slots?.['app--axhub-web--layout']], [undefined, 'focus-top', 'classic-ide'], 'merge: each app keeps its own layout');
eq([doc.hidden?.toolbar, doc.hidden?.['app--axf-console--toolbar'], doc.hidden?.['app--axhub-web--toolbar']], [undefined, true, false], 'merge: each app keeps its own bars');
const has = () => true;
const consoleLook = resolveAppearanceFor(doc, 'axf-console', has);
const hubLook = resolveAppearanceFor(doc, 'axhub-web', has);
eq([consoleLook.slots['color-theme'], hubLook.slots['color-theme']], ['midnight-ink', 'midnight-ink'], 'resolve: both apps show the shared colours');
eq([consoleLook.slots.layout, hubLook.slots.layout], ['focus-top', 'classic-ide'], 'resolve: each its own layout');
eq([consoleLook.hidden?.toolbar, hubLook.hidden?.toolbar], [true, false], 'resolve: each its own bars');
const third = resolveAppearanceFor(doc, 'walkthrough-studio', has);
eq([third.slots['color-theme'], third.slots.layout ?? null], ['midnight-ink', null], 'resolve: a third app gets the look, not the others’ layouts');

console.log(`check-suite: ${checks} checks passed`);
