/**
 * Self-test for embed@1 on the web port (CI: npx -y tsx framework/spec/check-embed.mts).
 *  1. replays spec/fixtures/embed.json against core/engines/embed.ts (the Kotlin EmbedEngine replays the same file)
 *  2. replays the `forced` cases of spec/fixtures/hide.json against core/engines/hide.ts
 *  3. drives the runtime: an embedded app hides the host's chrome over the user's choice, the choice survives, settings
 *     say who shows it, a standalone runtime is untouched, the frame carries data-axf-embed
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMBED_TAKE_UA_TOKEN, detectEmbedFull, embedFromQueryFull, embedFromUserAgentFull, embedLinkOk, embedLockNote, embedLockedBy, embedPage, embedTakeIds, embedTakenBy, embedTakenProvider, embedTakenView, embedTakes, embedUrlFull, parseEmbedMessage, settingsTabOf, userAgentSuffixFull, DEFAULT_HIDDEN, EMBED_UA_TOKEN, detectEmbed, embedFromQuery, embedFromUserAgent, embedHidden, embedHost, embedUrl, userAgentSuffix } from '../core/engines/embed';
import { hiddenSlots } from '../core/engines/hide';
import { AxfRuntime, HIDE_KEY } from '../core/runtime';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const f = JSON.parse(readFileSync(new URL('./fixtures/embed.json', import.meta.url), 'utf8'));
const h = JSON.parse(readFileSync(new URL('./fixtures/hide.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. embed.json ---------- */
eq(EMBED_UA_TOKEN, f.token, 'token');
eq(DEFAULT_HIDDEN, f.defaultHidden, 'default hidden');
for (const c of f.hosts) eq(embedHost(c.input), c.host, `host ${JSON.stringify(c.input)}`);
for (const c of f.hidden) eq(embedHidden(c.input), c.hidden, `hidden ${JSON.stringify(c.input)}`);
for (const c of f.queries) eq(embedFromQuery(c.input), c.embed, `query ${c.input}`);
for (const c of f.userAgents) eq(embedFromUserAgent(c.input), c.embed, `ua ${c.input}`);
for (const c of f.detect) eq(detectEmbed(c.search, c.userAgent), c.embed, `detect ${c.search} / ${c.userAgent}`);
for (const c of f.suffix) eq(userAgentSuffix(c.host, c.hidden ?? undefined), c.suffix, `suffix ${c.host} ${JSON.stringify(c.hidden)}`);
for (const c of f.urls) eq(embedUrl(c.url, c.host, c.hidden ?? undefined), c.out, `url ${c.url}`);
assert.throws(() => userAgentSuffix('bad id'), /bad host id/); checks++;
assert.throws(() => embedUrl('https://x/', ''), /bad host id/); checks++;

/* ---------- 2. hide.json forced layer ---------- */
for (const c of h.cases) eq(hiddenSlots(c.overrides, c.defaults ?? [], c.forced ?? []), c.hidden, `hide ${JSON.stringify(c)}`);
assert.ok(h.cases.some((c: { forced?: string[] }) => c.forced?.length), 'hide.json carries forced cases'); checks++;

/* ---------- 3. runtime ---------- */
const root = new URL('..', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest = { app: { id: 'test', name: 'Test' }, defaults } as never;
const make = (embed: ReturnType<typeof detectEmbed> | undefined) => new AxfRuntime({ manifest, assets, storageKey: `axf-test:${Math.random()}`, embed });

const solo = make(null);
eq(solo.embedded, null, 'standalone: no embed');
eq(solo.slotHidden('banner'), false, 'standalone: banner shown');
eq(solo.slotHiddenByHost('banner'), false, 'standalone: not by host');

const inside = make({ host: 'patches', hidden: ['banner'] });
eq(inside.embedded, { host: 'patches', hidden: ['banner'] }, 'embedded: host known');
eq(inside.slotHidden('banner'), true, 'embedded: banner hidden');
eq(inside.slotHiddenByHost('banner'), true, 'embedded: by the host');
eq(inside.slotHidden('toolbar'), solo.slotHidden('toolbar'), 'embedded: other chrome untouched');
eq(inside.banner().data, null, 'embedded: rt.banner() empty');
eq(inside.compileStyles().vars['--fx-banner-h'], '0px', 'embedded: banner height var is 0');
eq(solo.compileStyles().vars['--fx-banner-h'] !== '0px', true, 'standalone: banner has height');
// The user's own choice can't bring it back while embedded, and nothing is written for it.
inside.settings.clear(HIDE_KEY('banner'));
inside.setSlotHidden('banner', false);
eq(inside.slotHidden('banner'), true, 'embedded: show refused');
eq(inside.settings.get(HIDE_KEY('banner')), null, 'embedded: no override written');
// A saved "shown" choice stays saved for standalone runs.
inside.settings.set(HIDE_KEY('banner'), false);
eq(inside.slotHidden('banner'), true, 'embedded: forced over a saved false');
eq(inside.settings.get(HIDE_KEY('banner')), false, 'embedded: saved choice kept');
// Hidden slots list = host's over user's over app's.
const both = make({ host: 'patches', hidden: ['banner', 'toolbar'] });
both.settings.set(HIDE_KEY('toolbar'), false);
eq(both.hiddenSlots().includes('toolbar') && both.hiddenSlots().includes('banner'), true, 'embedded: two forced');
// Detection from the page when `embed` is omitted: no page here → standalone.
eq(make(undefined).embedded, null, 'no page: standalone');
// Node's navigator is a getter-only global: define over it for the test, then put it back.
const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 AXF-Embed/patches/none' } });
eq(make(undefined).embedded, { host: 'patches', hidden: [] }, 'page ua: detected (none hidden)');
Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '?axf-embed=dev-console' } });
eq(make(undefined).embedded, { host: 'dev-console', hidden: ['banner'] }, 'page query wins');
delete (globalThis as { location?: unknown }).location;
if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); else delete (globalThis as { navigator?: unknown }).navigator;


/* ---------- 4. embed-takes.json: what a host takes over, page mode, messages ---------- */
const t = JSON.parse(readFileSync(new URL('./fixtures/embed-takes.json', import.meta.url), 'utf8'));
eq(EMBED_TAKE_UA_TOKEN, t.uaToken, 'take token');
eq(embedTakeIds(), t.ids, 'take ids');
for (const c of t.takes) eq(embedTakes(c.input), c.takes, `takes ${JSON.stringify(c.input)}`);
for (const c of t.pages) eq(embedPage(c.input), c.page, `page ${JSON.stringify(c.input)}`);
for (const c of t.queries) eq(embedFromQueryFull(c.input), c.embed, `full query ${c.input}`);
for (const c of t.userAgents) eq(embedFromUserAgentFull(c.input), c.embed, `full ua ${c.input}`);
for (const c of t.detect) eq(detectEmbedFull(c.search, c.userAgent), c.embed, `full detect ${c.search}`);
for (const c of t.takenBy) eq(embedTakenBy(c.embed, c.action), c.fn, `takenBy ${JSON.stringify(c.embed.takes)} ${c.action}`);
for (const c of t.takenView) eq(embedTakenView(c.embed, c.view), c.fn, `takenView ${c.view}`);
for (const c of t.takenProvider) eq(embedTakenProvider(c.embed, c.provider), c.fn, `takenProvider ${c.provider}`);
for (const c of t.suffix) eq(userAgentSuffixFull(c.host, c.hidden ?? undefined, c.takes), c.suffix, `full suffix ${JSON.stringify(c)}`);
for (const c of t.urls) eq(embedUrlFull(c.url, c.host, c.opts), c.out, `full url ${c.url}`);
for (const c of t.links) eq(embedLinkOk(c.link), c.ok, `link ${c.link}`);
for (const c of t.messages) eq(parseEmbedMessage(c.input), c.message, `message ${JSON.stringify(c.input).slice(0, 60)}`);
for (const c of t.locked) { eq(embedLockedBy(c.embed, c.action), c.fn, `lockedBy ${JSON.stringify(c.embed.takes)} ${c.action}`); eq(embedLockNote(c.embed, c.fn), c.note, `lock note ${c.action}`); }
for (const c of t.pluginMessages) eq(parseEmbedMessage(c.input), c.message, `plugin message ${JSON.stringify(c.input).slice(0, 60)}`);
for (const c of t.settingsTab) eq(settingsTabOf(c.action) ?? null, c.tab, `settingsTab ${c.action}`);
// Old embed.json shapes are unchanged by the extension (no takes/page keys appear on them).
for (const c of f.queries) eq(embedFromQueryFull(c.input), c.embed, `full = old for ${c.input}`);

/* ---------- 5. runtime: settings taken by the host ---------- */
{
  const posted: unknown[] = [];
  (globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost = { post: (j: string) => posted.push(JSON.parse(j)) };
  let ran = 0;
  const taken = make({ host: 'patches', hidden: ['banner'], takes: ['settings'] });
  taken.actions.register('app.settings', () => { ran++; }, { label: 'Settings' });
  taken.actions.register('settings.open', () => { ran++; }, { label: 'Open a settings tab', params: true });
  eq(taken.hostTakes('settings'), true, 'takes: settings');
  eq(taken.hostTakes('notifications'), false, 'takes: not notifications');
  eq(taken.takenByHost({ action: 'app.settings' }), true, 'taken: app.settings');
  eq(taken.takenByHost({ action: 'alerts.open' }), false, 'taken: other actions kept');
  eq(taken.takenByHost({ view: 'settings' }), true, 'taken: settings view');
  eq(taken.takenByHost({ provider: 'settings' }), true, 'taken: settings live list');
  taken.dispatch('app.settings');
  taken.dispatch('settings.open:appearance');
  taken.navigate('settings');
  eq(ran, 0, 'taken hooks never run here');
  eq(posted, [{ $axf: 'embed@1', type: 'open-settings' }, { $axf: 'embed@1', type: 'open-settings', tab: 'appearance' }, { $axf: 'embed@1', type: 'open-settings' }], 'taken hooks asked the host');
  eq(taken.getState().view === 'settings', false, 'view did not change');
  // The app menu drops every settings hook (items + the settings live list); other items stay.
  const menu = JSON.stringify(taken.appMenu());
  eq(/"action":"(app\.settings|settings\.open[^"]*)"/.test(menu), false, 'app menu: no settings items');
  eq(/"provider":"settings"/.test(menu), false, 'app menu: no settings live list');
  const solo2 = make(null);
  eq(/"action":"app\.settings"/.test(JSON.stringify(solo2.appMenu())), true, 'standalone app menu keeps Settings');
  // Page mode: the settings page itself opens its tabs (settings is never taken on its own page).
  const pageRt = make({ host: 'patches', hidden: ['banner'], takes: ['notifications'], page: 'settings' });
  let opened = '';
  pageRt.actions.register('settings.open', ([tab]) => { opened = String(tab); }, { label: 'Open', params: true });
  pageRt.dispatch('settings.open:about');
  eq(opened, 'about', 'page mode: own tabs open');
  (globalThis as unknown as { AxfEmbedGuest?: { receive: (j: string) => void } }).AxfEmbedGuest!.receive('{"$axf":"embed@1","type":"open-tab","tab":"plugins"}');
  eq(opened, 'plugins', 'page mode: host opens a tab through the bridge');
  delete (globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost;
}

// embed@1 take `app-menu`: the app hides its menu bar, sends its menu (data only) and runs only what it sent.
{
  const posted: { type?: string; menus?: { id: string; label: string; items: { id: string; label: string; items?: unknown[] }[] }[] }[] = [];
  (globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost = { post: (j: string) => posted.push(JSON.parse(j)) };
  const guest = make({ host: 'patches', hidden: ['app-menu', 'banner'], takes: ['settings', 'app-menu'] });
  eq(guest.slotHidden('app-menu'), true, 'app-menu taken: the app hides its menu bar');
  let ran = 0;
  guest.actions.register('test.menu-item', () => { ran++; }, { label: 'Test item' });
  guest.addAppMenuItems({ id: 'test.menu', module: 'test', menu: 'test', menuLabel: 'Test', items: [{ id: 'one', label: 'One', action: 'test.menu-item' }] });
  eq(await guest.shareAppMenu({ force: true }), true, 'app-menu: menu sent to the host');
  const sent = posted.at(-1)!;
  eq(sent.type, 'menu', 'app-menu: a menu message');
  eq(JSON.stringify(sent).includes('test.menu-item'), false, 'app-menu: no action ids cross over');
  const menu = sent.menus!.find((m) => m.label === 'Test')!;
  eq(!!menu, true, 'app-menu: contributed menu included');
  eq(JSON.stringify(sent).includes('"app.settings"') || /"label":"Settings"/.test(JSON.stringify(sent)), false, 'app-menu: taken settings hooks stay out');
  const item = menu.items.find((i) => i.label === 'One')!;
  (globalThis as unknown as { AxfEmbedGuest?: { receive: (j: string) => void } }).AxfEmbedGuest!.receive(JSON.stringify({ $axf: 'embed@1', type: 'run', id: item.id }));
  eq(ran, 1, 'app-menu: run runs the item it sent');
  eq(guest.runSharedMenuItem('m99.0'), false, 'app-menu: an id it never sent runs nothing');
  eq(await guest.shareAppMenu(), false, 'app-menu: unchanged menu not sent again');
  const pageGuest = make({ host: 'patches', hidden: ['app-menu', 'banner'], takes: ['app-menu'], page: 'settings' });
  eq(await pageGuest.shareAppMenu({ force: true }), false, 'app-menu: a settings page never shares its menu');
  const solo3 = make(null);
  eq(await solo3.shareAppMenu({ force: true }), false, 'app-menu: standalone app shares nothing');
  delete (globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost;
}

// Plugins a host makes unneeded (embed@1 skipWhen): skipped on that page only, logged once, listed with why.
{
  const { embedSkipReason } = await import('../core/engines/embed');
  const { installLibraries } = await import('../react/library');
  const host = { host: 'patches', hidden: ['app-menu', 'banner'], takes: ['settings', 'app-menu'] };
  eq(embedSkipReason(null, ['embedded']), null, 'skipWhen: standalone always loads');
  eq(embedSkipReason(host, ['embedded']), 'patches does this itself', 'skipWhen embedded: any host');
  eq(embedSkipReason(host, ['take:settings']), 'patches takes settings over', 'skipWhen take:<fn>');
  eq(embedSkipReason(host, ['take:notifications']), null, 'skipWhen take:<fn> the host does not take');
  eq(embedSkipReason(host, ['hidden:banner']), 'patches hides the banner', 'skipWhen hidden:<type>');
  eq(embedSkipReason(host, ['hidden:toolbar']), null, 'skipWhen hidden:<type> the host shows');
  eq(embedSkipReason({ ...host, page: 'settings' }, ['embedded']), null, 'page mode never skips (its tabs must all be there)');
  eq(embedSkipReason(host, undefined), null, 'no skipWhen: loads');
  const lib = (id: string, skipWhen?: string[]) => ({ id, label: id, version: '1.0.0', ...(skipWhen ? { embed: { skipWhen } } : {}), register: () => { registered.push(id); } });
  const registered: string[] = [];
  const inHost = make(host);
  installLibraries(inHost, [lib('keep'), lib('tabs', ['embedded']), lib('bell', ['hidden:banner']), lib('notify', ['take:notifications'])] as never);
  eq(registered, ['keep', 'notify'], 'inside the host: only what it needs is installed');
  eq(inHost.skippedLibraries.map((l) => `${l.id}: ${l.reason}`), ['tabs: patches does this itself', 'bell: patches hides the banner'], 'skipped plugins listed with why');
  eq(inHost.libraries.map((l) => l.id), ['keep', 'notify'], 'skipped plugins are not in the installed list');
  eq(inHost.terminal.lines.some((l) => /2 plugin\(s\) not loaded \(tabs, bell\)/.test(l.text)), true, 'launch log: one summary line');
  registered.length = 0;
  const alone = make(null);
  installLibraries(alone, [lib('keep'), lib('tabs', ['embedded']), lib('bell', ['hidden:banner'])] as never);
  eq(registered, ['keep', 'tabs', 'bell'], 'standalone: every plugin loads');
  eq(alone.skippedLibraries.length, 0, 'standalone: nothing skipped');
}

/* ---------- runtime: banner settings taken by the host (Patches' Banners tab) ---------- */
{
  const posted: unknown[] = [];
  (globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost = { post: (j: string) => posted.push(JSON.parse(j)) };
  let ran = 0;
  const taken = make({ host: 'patches', hidden: ['banner'], takes: ['settings', 'banners'] });
  taken.actions.register('banners.settings', () => { ran++; }, { label: 'Banner settings', params: true });
  eq(taken.hostTakes('banners'), true, 'takes: banners');
  eq(taken.takenByHost({ view: 'banners' }), true, 'taken: banners view');
  taken.dispatch('banners.settings:push-banner');
  taken.dispatch('banners.settings');
  taken.navigate('banners');
  eq(ran, 0, 'banner settings never open here');
  eq(posted, [{ $axf: 'embed@1', type: 'open-settings', tab: 'banners:push-banner' }, { $axf: 'embed@1', type: 'open-settings', tab: 'banners' }, { $axf: 'embed@1', type: 'open-settings', tab: 'banners' }], 'banner settings asked the host');
  eq(embedPage('banners'), 'banners', 'banners is a page a host can show');
  const page = make({ host: 'patches', hidden: ['banner'], takes: ['settings'], page: 'banners' });
  eq(page.hostTakes('banners'), false, 'the banners page keeps its own function');
  delete (globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost;
}

/* ---------- runtime: plugins managed by the host (take `plugins`, lock mode) ---------- */
{
  const posted: unknown[] = [];
  (globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost = { post: (j: string) => posted.push(JSON.parse(j)) };
  let ran = 0;
  const rt = make({ host: 'patches', hidden: ['banner'], takes: ['settings', 'plugins'] });
  rt.actions.register('plugin-manager.open', () => { ran++; }, { label: 'Plugin Manager', params: true });
  rt.actions.register('alerts.open', () => { ran++; }, { label: 'Alerts' });
  eq(rt.hostTakes('plugins'), true, 'takes: plugins');
  eq(rt.takenByHost({ action: 'plugin-manager.open' }), false, 'plugin hooks are not dropped');
  eq(rt.lockedByHost({ action: 'plugin-manager.open' }), 'Plugins are managed in Patches', 'plugin hooks are locked with a note');
  eq(rt.lockedByHost({ view: 'plugin-manager' }), 'Plugins are managed in Patches', 'plugin manager view locked');
  eq(rt.lockedByHost({ action: 'alerts.open' }), null, 'other hooks not locked');
  eq(rt.hostLockNote('plugins'), 'Plugins are managed in Patches', 'lock note for Settings → Plugins');
  eq(rt.dispatch('plugin-manager.open:x'), false, 'locked hook does not run');
  rt.navigate('plugin-manager');
  eq(rt.getState().view === 'plugin-manager', false, 'locked view does not open');
  rt.dispatch('alerts.open');
  eq(ran, 1, 'only the unlocked action ran');
  eq(posted.length, 0, 'a locked hook never asks the host');
  rt.addAppMenuItems({ id: 't.plugins', module: 't', menu: 'plugins', menuLabel: 'Plugins', items: [{ id: 'pm', label: 'Plugin Manager', action: 'plugin-manager.open' }, { id: 'al', label: 'Alerts', action: 'alerts.open' }] });
  const items = rt.appMenu().menus.find((m) => m.id === 'plugins')?.items ?? [];
  eq(items.map((i) => [i.id, i.locked]), [['pm', true], ['al', false]], 'app menu keeps plugin items, greyed out');
  // the plugin list: reported to the host, the host's answer kept and announced
  eq(rt.hostPlugins, null, 'no host list yet');
  let heard: string[] | null = null;
  rt.onHostPlugins((ids) => { heard = ids; });
  eq(rt.reportPluginsToHost([{ id: 'ai.amberx.axf.example.alpha', name: 'Activity', on: true }]), true, 'report sent');
  eq(posted.at(-1), { $axf: 'embed@1', type: 'plugins', plugins: [{ id: 'ai.amberx.axf.example.alpha', name: 'Activity', on: true }] }, 'report message');
  (globalThis as unknown as { AxfEmbedGuest: { receive: (j: string) => void } }).AxfEmbedGuest.receive(JSON.stringify({ $axf: 'embed@1', type: 'plugins-enabled', plugins: ['ai.amberx.axf.example.alpha'] }));
  eq(rt.hostPlugins, ['ai.amberx.axf.example.alpha'], 'host list kept');
  eq(heard, ['ai.amberx.axf.example.alpha'], 'host list announced');
  posted.length = 0;
  (globalThis as unknown as { AxfEmbedGuest: { receive: (j: string) => void } }).AxfEmbedGuest.receive(JSON.stringify({ $axf: 'embed@1', type: 'plugins-request' }));
  eq((posted[0] as { type?: string } | undefined)?.type, 'plugins', 'host asked: report sent again');
  // standalone, and a host that doesn't take plugins: nothing locked, nothing reported
  const solo = make(null);
  eq(solo.lockedByHost({ action: 'plugin-manager.open' }), null, 'standalone: nothing locked');
  eq(solo.reportPluginsToHost([]), false, 'standalone: nothing reported');
  const other = make({ host: 'patches', hidden: ['banner'], takes: ['settings'] });
  eq(other.hostLockNote('plugins'), null, 'host without the take: no note');
  delete (globalThis as unknown as { AxfEmbedHost?: unknown }).AxfEmbedHost;
}

console.log(`check-embed: ${checks} checks passed`);
