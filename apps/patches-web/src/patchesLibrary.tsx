/**
 * Patches' own library (web): the app tabs (frames kept alive), the banner strip above them and the actions behind them.
 * Settings are not combined (Brett, Oct 24 2026): every app in a tab keeps its own settings interface (its own settings
 * asset, only its own settings); Patches' Settings holds only Patches' settings.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Icon, IconButton, ModelBadge, modelLabel, Note, Switch, useAsset, useAxfState, useRuntime, type AxfWebLibrary } from './axf/react';
import type { EmbedPlugin } from './axf/core';
import { api } from './api';

/** "built with Opus" for a plugin's row (Switch hints are text), or nothing when its model isn't known. */
const builtWithText = (model?: string) => (model ? `built with ${modelLabel(model)}` : '');
import type { AxfRuntime } from './axf/core';
import {
  DEFAULT_TABS, MAX_TABS, moveTab, pluginTabUrl, readTabs, tabChoices, tabIcon, tabKey, tabLabel, tabViewId, type TabChoice, type TabEntry,
  AUTO_INSTALL_KEY, enabledPluginIds, missingPlugins, missingSummary, pluginsEnabledMessage, pluginsRequestMessage, type PluginsState,
  BANNERS_KEY, TABS, fromApp, guestMenuCounters, guestMenuItems, parseStripMessage,
  runMessage, stripUrl, tabOrigin, tabUrl, type PatchTab,
} from './patches';

/** Reload ticks per tab (a frame reloads when its tick changes). */
const reloads = new Map<string, number>();
const reloadSubs = new Set<() => void>();
function bump(id: string) { reloads.set(id, (reloads.get(id) ?? 0) + 1); reloadSubs.forEach((f) => f()); }
function useReload(id: string): number { return useSyncExternalStore((f) => { reloadSubs.add(f); return () => reloadSubs.delete(f); }, () => reloads.get(id) ?? 0); }

/** Every frame Patches shows, by window, so a message is believed only from the frame it claims to be. */
const frames = new Map<Window, { tab: PatchTab; kind: 'app' | 'strip'; entry?: TabEntry }>();

function useOrigin(t: PatchTab): string {
  const rt = useRuntime();
  useAxfState();
  return tabOrigin(t, t.key ? rt.settings.get(t.key) : null);
}

/** Open Patches' own settings (on one of its tabs). Each app in a tab opens its own settings itself. */
export function openSettings(rt: AxfRuntime, tab?: string) {
  if (tab) void rt.dispatch(`settings.open:${tab}`);
  else rt.navigate('settings');
}

/* ---------------- frames ---------------- */

function Frame({ tab, src, kind, title, onHeight, entry }: { tab: PatchTab; src: string; kind: 'app' | 'strip'; title: string; onHeight?: (px: number) => void; entry?: TabEntry }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const w = ref.current?.contentWindow;
    if (!w) return;
    frames.set(w, { tab, kind, entry });
    return () => { frames.delete(w); };
  }, [tab, kind, src, entry]);
  void onHeight;
  return (
    <iframe
      ref={ref}
      className={`pt-frame pt-frame--${kind}`}
      src={src}
      title={title}
      // The apps are Brett's own sites behind axHub's wall. Scripts + same-origin let them run; the sandbox still stops
      // them from navigating Patches itself. Popups (open in a new tab, downloads) are allowed out of the sandbox.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  );
}

/**
 * One tab, kept alive across tab switches (AppShell `keep`): an app in a frame, or a tabable plugin of an app (that app
 * showing only the plugin's page, embed@1 page `view:<id>`). A plugin tab's frame belongs to its app: its messages,
 * plugin list and settings asks count as that app's.
 */
export function AppTab({ entry }: { entry: TabEntry }) {
  const t = TABS.find((x) => x.id === entry.app) ?? TABS[0]!;
  const origin = useOrigin(t);
  const id = tabViewId(entry);
  const tick = useReload(id);
  const src = entry.kind === 'plugin' ? pluginTabUrl(t, origin, entry.view) : tabUrl(t, origin);
  return <div className="pt-tab" data-patches-tab={id}><Frame key={`${origin}#${tick}`} tab={t} src={src} kind="app" title={tabLabel(entry)} entry={entry} /></div>;
}

/* ---------------- the tab group (patches-tabs@1, kept on Patches' server) ---------------- */

type TabsView = { tabs: TabEntry[]; loaded: boolean; error: string };
let tabsView: TabsView = { tabs: DEFAULT_TABS, loaded: false, error: '' };
const tabsSubs = new Set<() => void>();
function setTabsView(next: Partial<TabsView>) { tabsView = { ...tabsView, ...next }; tabsSubs.forEach((f) => f()); }
export function useTabs(): TabsView { return useSyncExternalStore((f) => { tabsSubs.add(f); return () => tabsSubs.delete(f); }, () => tabsView); }

/** Read the tab group (once at start; the default three apps until it answers or when it can't be read). */
export async function loadTabs(): Promise<void> {
  const r = await api<{ tabs: unknown }>('/tabs');
  if (r.ok && r.data) setTabsView({ tabs: readTabs(r.data.tabs), loaded: true, error: '' });
  else setTabsView({ loaded: true, error: r.error || 'the tab list could not be read' });
}

/** Save the whole tab group (in order); the server's answer is what's shown. */
async function saveTabs(rt: AxfRuntime, next: TabEntry[]): Promise<boolean> {
  const before = tabsView.tabs;
  setTabsView({ tabs: next });
  const r = await api<{ tabs: unknown }>('/tabs', { method: 'PUT', body: JSON.stringify({ tabs: next }) });
  if (r.ok && r.data) { setTabsView({ tabs: readTabs(r.data.tabs), error: '' }); }
  else { setTabsView({ tabs: before, error: r.error || 'could not save the tabs' }); rt.toast(r.error || 'Could not save the tabs.', 'danger', 'Tabs'); return false; }
  // the tab in front was removed: show the first one left
  const view = rt.getState().view;
  if (view !== 'settings' && !tabsView.tabs.some((e) => tabViewId(e) === view) && tabsView.tabs[0]) rt.navigate(tabViewId(tabsView.tabs[0]));
  return true;
}

/** Add a tab. A plugin tab also makes sure its plugin is installed in Patches for that app and switched on (it runs only then). */
async function addTab(rt: AxfRuntime, c: TabChoice): Promise<void> {
  if (c.added || tabsView.tabs.length >= MAX_TABS) return;
  const e = c.entry;
  if (e.kind === 'plugin') {
    const t = TABS.find((x) => x.id === e.app)!;
    if (!c.installed) await installMissing(t, [{ id: e.plugin, name: e.label, on: true }]);
    else if (!c.enabled) await switchPlugin(t, e.plugin, true);
  }
  if (await saveTabs(rt, [...tabsView.tabs, e])) { rt.navigate(tabViewId(e)); rt.closeDialog(); }
}

async function removeTab(rt: AxfRuntime, key: string): Promise<void> {
  await saveTabs(rt, tabsView.tabs.filter((e) => tabKey(e) !== key));
}

/** The Add tab dialog: every app and every tabable plugin the apps reported, each with Add (or "Already a tab"). */
export function AddTabDialog() {
  const rt = useRuntime();
  const tv = useTabs();
  const pv = usePluginsView();
  const { apps, plugins: groups } = tabChoices(tv.tabs, pv.reports, pv.state);
  const full = tv.tabs.length >= MAX_TABS;
  const row = (c: TabChoice, hint?: string) => (
    <li key={tabKey(c.entry)} className="pt-addtab__row">
      <Icon name={tabIcon(c.entry)} size={16} />
      <span className="pt-addtab__name"><strong>{tabLabel(c.entry)}</strong> {c.entry.kind === 'plugin' && <ModelBadge compact model={pv.reports[c.entry.app]?.find((r) => r.id === (c.entry as { plugin: string }).plugin)?.model ?? pv.state?.apps[c.entry.app]?.plugins[c.entry.plugin]?.model} />}{hint && <span className="fx-muted">{hint}</span>}</span>
      {c.added ? <span className="fx-muted">Already a tab</span> : <Button size="sm" icon="plus" tone="primary" disabled={full || pv.busy} onClick={() => void addTab(rt, c)}>Add</Button>}
    </li>
  );
  return (
    <div className="fx-stack pt-addtab">
      <p className="fx-muted" style={{ margin: 0 }}>Pick an app or a plugin to give it its own tab. Only plugins marked tabable are listed.</p>
      {full && <Note tone="warning">Patches has {MAX_TABS} tabs, the most it holds. Remove one first.</Note>}
      <section>
        <h3 className="pt-plugins__head">Apps</h3>
        <ul className="pt-addtab__list">{apps.map((c) => row(c))}</ul>
      </section>
      {groups.map((g) => (
        <section key={g.app.id}>
          <h3 className="pt-plugins__head"><Icon name={g.app.icon} size={14} /> {g.app.label} plugins</h3>
          <ul className="pt-addtab__list">{g.choices.map((c) => row(c, c.added ? undefined : !c.installed ? `Installs it in Patches for ${g.app.label}` : !c.enabled ? `Switches it on in Patches for ${g.app.label}` : undefined))}</ul>
        </section>
      ))}
      {!groups.length && <Note tone="info">No tabable plugins yet. Apps list theirs once their tab (or the banner strip) has loaded; open an app’s tab, then come back.</Note>}
    </div>
  );
}

/** Settings → Patches → Tabs: the tab group in order (up, down, remove) and Add tab…. */
function TabsPanel() {
  const rt = useRuntime();
  const tv = useTabs();
  useEffect(() => { if (!tv.loaded) void loadTabs(); }, [tv.loaded]);
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>The tabs above the menu, on every device. Apps show the whole app; a plugin tab shows just that plugin’s page.</p>
      {tv.error && <Note tone="danger">{tv.error}</Note>}
      <ul className="pt-addtab__list">
        {tv.tabs.map((e, i) => (
          <li key={tabKey(e)} className="pt-addtab__row">
            <Icon name={tabIcon(e)} size={16} />
            <span className="pt-addtab__name"><strong>{tabLabel(e)}</strong><span className="fx-muted">{e.kind === 'app' ? 'App' : `Plugin · ${TABS.find((t) => t.id === e.app)?.label ?? e.app}`}</span></span>
            <span className="fx-row">
              <IconButton icon="chevron-up" label="Move up" disabled={i === 0} onClick={() => void saveTabs(rt, moveTab(tv.tabs, tabKey(e), -1))} />
              <IconButton icon="chevron-down" label="Move down" disabled={i === tv.tabs.length - 1} onClick={() => void saveTabs(rt, moveTab(tv.tabs, tabKey(e), 1))} />
              <IconButton icon="trash" label={`Remove the ${tabLabel(e)} tab`} onClick={() => void removeTab(rt, tabKey(e))} />
            </span>
          </li>
        ))}
      </ul>
      {!tv.tabs.length && <p className="fx-muted" style={{ margin: 0 }}>No tabs: add one.</p>}
      <div className="fx-row">
        <Button icon="plus" tone="primary" disabled={tv.tabs.length >= MAX_TABS} onClick={() => rt.openDialog(ADD_TAB_DIALOG)}>Add tab…</Button>
        <Button icon="refresh" onClick={() => void saveTabs(rt, DEFAULT_TABS)}>Back to the three apps</Button>
      </div>
    </div>
  );
}

export const ADD_TAB_DIALOG = 'patches.tabs.add';

/** The Dev Console's plugin banners above every tab (`?axf-strip=banners`), sized to them. */
export function BannerStrip() {
  const rt = useRuntime();
  useAxfState();
  const t = TABS[0]!;
  const origin = useOrigin(t);
  const [px, setPx] = useState(0);
  const on = rt.settings.get(BANNERS_KEY) !== false;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const f = e.source ? frames.get(e.source as Window) : undefined;
      if (!f || f.kind !== 'strip' || e.origin !== origin) return;
      const m = parseStripMessage(e.data);
      if (m?.type === 'height') setPx(m.px);
      else if (m?.type === 'open') rt.navigate('console');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [rt, origin]);
  if (!on) return null;
  return (
    <div className="pt-strip" style={{ height: px }} aria-hidden={px === 0}>
      <Frame tab={t} src={stripUrl(origin)} kind="strip" title="Console banners" />
    </div>
  );
}

/* ---------------- messages from the apps ---------------- */

/** The apps ask Patches for their settings (their own hooks are gone inside Patches); anything else is ignored. */
export function useAppMessages() {
  const rt = useRuntime();
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const f = e.source ? frames.get(e.source as Window) : undefined;
      if (!f) return;
      // Believed only from the frame it came from, at that frame's own origin.
      const origin = tabOrigin(f.tab, f.tab.key ? rt.settings.get(f.tab.key) : null);
      if (e.origin !== origin) return;
      const m = fromApp(e.data);
      if (!m) return;
      // Patches no longer takes the apps' settings, so it never answers open-settings; the strip only relays banner taps.
      // Every page of an app (tab, settings page, banner strip) reports its plugins and runs only what Patches enabled.
      if (m.type === 'plugins') { void onPluginReport(rt, f.tab, e.source as Window, origin, m.plugins); return; }
      if (f.kind === 'strip') return;
      if (m.type === 'menu' && f.kind === 'app') showGuestMenu(rt, f.tab, m.menus);
      else if (m.type === 'notify') rt.toast(m.body ?? m.title, m.level === 'error' ? 'danger' : m.level === 'warning' ? 'warning' : m.level === 'success' ? 'success' : 'info', `${f.tab.label}: ${m.title}`);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [rt]);
}

/* ---------------- plugins Patches manages for the apps in its tabs (embed@1 take `plugins`) ----------------
 *
 * Brett, Oct 22 2026: "when Patches loads developer apps in tabs and Patches doesn't have all the plugins installed that
 * the apps have, put an entry in the systems check banner to fix it by installing the missing plugins in Patches, and
 * try to install them automatically. Disable all plugins from the apps and only enable them in Patches."
 *
 * Each page of an app reports the plugins it has (`plugins`). Patches keeps, per app, which are installed here and
 * switched on (server/main.py, patches-plugins@1), installs the missing ones by itself (Settings → Patches → Plugins →
 * Install missing plugins by themselves, on by default), and answers every page with the ones switched on
 * (`plugins-enabled`): that's all the app runs inside Patches. While any are missing (auto install off or failed), the
 * Systems check banner above the tabs says so, with Auto fix.
 */

type PluginsView = { state: PluginsState | null; error: string; reports: Partial<Record<PatchTab['id'], EmbedPlugin[]>>; busy: boolean; failed: string };
let plugins: PluginsView = { state: null, error: '', reports: {}, busy: false, failed: '' };
const pluginSubs = new Set<() => void>();
function setPlugins(next: Partial<PluginsView>) { plugins = { ...plugins, ...next }; pluginSubs.forEach((f) => f()); }
export function usePluginsView(): PluginsView { return useSyncExternalStore((f) => { pluginSubs.add(f); return () => pluginSubs.delete(f); }, () => plugins); }

let loading: Promise<PluginsState | null> | null = null;
/** Patches' plugin list (once; again after a change). */
function loadPlugins(force = false): Promise<PluginsState | null> {
  if (loading && !force) return loading;
  loading = api<PluginsState>('/plugins').then((r) => {
    if (r.ok && r.data) setPlugins({ state: r.data, error: '' });
    else setPlugins({ error: r.error || 'Patches’ plugin list could not be read' });
    return r.ok ? r.data : plugins.state;
  });
  return loading;
}

/** Tell every page of an app which plugins it may run (only what is installed in Patches and switched on). */
function announce(t: PatchTab, origin?: string) {
  const ids = enabledPluginIds(plugins.state, t.id);
  const o = origin ?? tabOriginOf(t);
  for (const [w, f] of frames) if (f.tab.id === t.id) try { w.postMessage(pluginsEnabledMessage(ids), o); } catch { /* frame gone */ }
}
let originOf: ((t: PatchTab) => string) | null = null;
const tabOriginOf = (t: PatchTab) => originOf?.(t) ?? normalizeFallback(t);
const normalizeFallback = (t: PatchTab) => tabOrigin(t, null);

/** Install plugins into Patches for an app (all of its missing ones unless named), then tell its pages. */
export async function installMissing(t: PatchTab, only?: EmbedPlugin[]): Promise<boolean> {
  const list = only ?? missingPlugins(plugins.reports[t.id], plugins.state, t.id);
  if (!list.length) return true;
  setPlugins({ busy: true, failed: '' });
  const r = await api<PluginsState & { added: string[] }>('/plugins/install', { method: 'POST', body: JSON.stringify({ app: t.id, plugins: list }) });
  if (r.ok && r.data) setPlugins({ state: r.data, busy: false, error: '' });
  else setPlugins({ busy: false, failed: r.error || 'install failed' });
  announce(t);
  return r.ok;
}

/** An app page reported its plugins: keep the report, install what's missing (when allowed), answer that page. */
async function onPluginReport(rt: AxfRuntime, t: PatchTab, w: Window, origin: string, list: EmbedPlugin[]) {
  originOf = (x) => tabOrigin(x, x.key ? rt.settings.get(x.key) : null);
  // the tab's own report wins over its settings page / the strip (same app, same list)
  setPlugins({ reports: { ...plugins.reports, [t.id]: list } });
  await loadPlugins();
  if (rt.settings.get(AUTO_INSTALL_KEY) !== false && missingPlugins(list, plugins.state, t.id).length && !plugins.busy) await installMissing(t);
  try { w.postMessage(pluginsEnabledMessage(enabledPluginIds(plugins.state, t.id)), origin); } catch { /* frame gone */ }
}

/** Switch a plugin installed in Patches on or off for an app, then tell its pages. */
async function switchPlugin(t: PatchTab, id: string, on: boolean) {
  const r = await api<PluginsState>('/plugins/enabled', { method: 'POST', body: JSON.stringify({ app: t.id, id, enabled: on }) });
  if (r.ok && r.data) setPlugins({ state: r.data, failed: '' }); else setPlugins({ failed: r.error || 'could not switch it' });
  announce(t);
}

/** Every app with plugins it has but Patches doesn't (what the Systems check entry lists). */
function missingByApp(v: PluginsView): { t: PatchTab; missing: EmbedPlugin[] }[] {
  return TABS.map((t) => ({ t, missing: missingPlugins(v.reports[t.id], v.state, t.id) })).filter((x) => x.missing.length > 0);
}

/** The Systems check entry above the tabs: shown while an app has plugins Patches hasn't installed. */
function PluginsCheck() {
  const rt = useRuntime();
  const v = usePluginsView();
  const [open, setOpen] = useState(false);
  const rows = missingByApp(v);
  // Patches' own list unreadable: the apps run no plugins inside Patches until it is back, so say so.
  if (!v.state && v.error && Object.keys(v.reports).length) return (
    <div className="pt-check" role="status" data-fx-ctx-ignore="">
      <Note tone="danger" icon="alert">
        <div className="pt-check__line">
          <span className="pt-check__title"><strong>Systems check</strong> · Patches can’t read its plugin list, so the apps run no plugins here ({v.error})</span>
          <Button size="sm" icon="refresh" onClick={() => void loadPlugins(true).then(() => { for (const t of TABS) announce(t); })}>Try again</Button>
        </div>
      </Note>
    </div>
  );
  if (!rows.length || !v.state) return null;
  const count = rows.reduce((n, r) => n + r.missing.length, 0);
  const fixAll = async () => { for (const r of rows) await installMissing(r.t); };
  return (
    <div className="pt-check" role="status" data-fx-ctx-ignore="">
      <Note tone="warning" icon="alert">
        <div className="pt-check__line">
          <span className="pt-check__title"><strong>Systems check</strong> · Patches is missing {count} plugin{count === 1 ? '' : 's'} the apps use</span>
          <span className="fx-row">
            <Button size="sm" icon="zap" tone="primary" disabled={v.busy} onClick={() => void fixAll()}>{v.busy ? 'Installing…' : 'Auto fix'}</Button>
            <Button size="sm" icon={open ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen((x) => !x)}>{open ? 'Less' : 'Details'}</Button>
            <Button size="sm" icon="settings" onClick={() => openSettings(rt, 'connections')}>Plugins</Button>
          </span>
        </div>
        {v.failed && <div className="pt-check__err">Couldn’t install them: {v.failed}</div>}
        {open && (
          <ul className="pt-check__list">
            {rows.map((r) => (
              <li key={r.t.id}>
                <span>{missingSummary(r.t.label, r.missing, 8)}</span>
                <Button size="sm" disabled={v.busy} onClick={() => void installMissing(r.t)}>Install in Patches</Button>
              </li>
            ))}
          </ul>
        )}
      </Note>
    </div>
  );
}

/** Settings → Patches → Plugins: every app's plugins installed in Patches, a switch each; what's missing; auto install. */
function PluginsPanel() {
  const rt = useRuntime();
  useAxfState();
  const v = usePluginsView();
  useEffect(() => { void loadPlugins(true); }, []);
  const auto = rt.settings.get(AUTO_INSTALL_KEY) !== false;
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>Inside Patches the apps run only the plugins installed and switched on here; their plugin list moves here (each plugin's own settings stay in its app's Settings tab). On its own, each app keeps its own plugins.</p>
      <Switch checked={auto} onChange={(on) => rt.settings.set(AUTO_INSTALL_KEY, on)} label="Install missing plugins by themselves" hint="When an app has a plugin Patches doesn’t, install it here straight away (it starts on or off the way the app had it)." />
      {v.error && <Note tone="danger">{v.error}</Note>}
      {v.failed && <Note tone="danger">{v.failed}</Note>}
      {TABS.filter((t) => t.axf).map((t) => {
        const installed = Object.entries(v.state?.apps[t.id]?.plugins ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
        const missing = missingPlugins(v.reports[t.id], v.state, t.id);
        return (
          <section key={t.id} className="pt-plugins">
            <h3 className="pt-plugins__head"><Icon name={t.icon} size={14} /> {t.label}</h3>
            {!installed.length && !missing.length && <p className="fx-muted" style={{ margin: 0 }}>{v.reports[t.id] ? 'No plugins.' : 'Open its tab once: it reports its plugins.'}</p>}
            {installed.map(([id, p]) => (
              <Switch key={id} checked={p.enabled} onChange={(on) => void switchPlugin(t, id, on)} label={p.name} hint={[id, p.version, builtWithText(v.reports[t.id]?.find((r) => r.id === id)?.model ?? p.model)].filter(Boolean).join(' · ')} />
            ))}
            {missing.length > 0 && (
              <Note tone="warning">
                {missingSummary('Not in Patches yet', missing, 8)}{' '}
                <Button size="sm" disabled={v.busy} onClick={() => void installMissing(t)}>Install in Patches</Button>
              </Note>
            )}
          </section>
        );
      })}
      <div className="fx-row"><Button size="sm" icon="refresh" onClick={() => { void loadPlugins(true); for (const [w, f] of frames) try { w.postMessage(pluginsRequestMessage(), tabOriginOf(f.tab)); } catch { /* gone */ } }}>Check the apps again</Button></div>
    </div>
  );
}

/* ---------------- the apps' menus in Patches' application menu (embed@1 take `app-menu`) ---------------- */

/** Put an app's menu into Patches' application menu as one top-level menu (replacing what it sent before). */
function showGuestMenu(rt: AxfRuntime, t: PatchTab, menus: Parameters<typeof guestMenuItems>[1]) {
  const module = `patches.guest.${t.id}`;
  for (const [name, n] of Object.entries(guestMenuCounters(t.id, menus))) rt.setBadge(name, n);
  rt.removeAppMenuItems(module);
  const items = guestMenuItems(t.id, menus);
  if (!items.length) return;
  rt.addAppMenuItems({ id: module, module, menu: `app-${t.id}`, menuLabel: t.label, menuOrder: 20 + TABS.indexOf(t), items });
}

/** A picked item of an app's menu: bring its tab up, then ask the app to run it (it runs only what it offered). */
function runGuestItem(rt: AxfRuntime, tabId: string, id: string) {
  const t = TABS.find((x) => x.id === tabId);
  if (!t || !id) return;
  rt.navigate(t.id);
  const origin = tabOrigin(t, t.key ? rt.settings.get(t.key) : null);
  for (const [w, f] of frames) if (f.kind === 'app' && f.tab.id === t.id) try { w.postMessage(runMessage(id), origin); } catch { /* frame gone */ }
}

/* ---------------- the library ---------------- */

/**
 * The app tabs, above the application menu (Brett, Oct 22 2026: "tabs for the apps above the application menu"): the
 * `patches-tabs` nav-menu asset drawn as one row in the page slot `app.frame.head`. The layout's nav region accepts
 * nothing (`slots.nav: []`), so the tabs aren't drawn a second time under the menu.
 */
function AppTabs() {
  const rt = useRuntime();
  const state = useAxfState();
  const nav = useAsset('nav-menu');
  const tv = useTabs();
  // The tab group (Settings → Patches → Tabs) decides which tabs show and in what order; an app tab keeps the label and
  // icon the nav-menu asset gives it (and its access rule), a plugin tab carries its own.
  const navItems = nav.data.sections.flatMap((sec) => sec.items);
  const items = tv.tabs.map((e) => {
    const it = e.kind === 'app' ? navItems.find((x) => x.view === e.app) : undefined;
    return { id: tabViewId(e), view: tabViewId(e), label: it?.label ?? tabLabel(e), icon: it?.icon ?? tabIcon(e), requires: it?.requires, plugin: e.kind === 'plugin' };
  }).filter((it) => rt.gate(it.requires) !== 'hide');
  return (
    <nav className={`fx-nav fx-nav--${nav.data.style} patches-tabs`} data-orient="horizontal" aria-label="Tabs">
      <div className="fx-nav__section" role="tablist">
        {items.map((it) => {
          const on = state.view === it.view;
          return (
            <button key={it.id} type="button" role="tab" aria-selected={on} className={`fx-nav__item ${on ? 'is-active' : ''}`} title={it.label}
              data-fx-ctx-target={it.plugin ? 'patches-plugin-tab' : 'nav-item'} data-fx-ctx-payload={it.view} onClick={() => rt.navigate(it.view)}>
              <Icon name={it.icon} size={17} />
              <span className="fx-nav__text">{it.label}</span>
            </button>
          );
        })}
        <button type="button" className="fx-nav__item patches-tabs__add" title="Add a tab" aria-label="Add a tab" onClick={() => rt.openDialog(ADD_TAB_DIALOG)}>
          <Icon name="plus" size={17} />
        </button>
      </div>
    </nav>
  );
}

export const patchesLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.patches',
  label: 'Patches',
  version: '0.1.0',
  dependsOn: ['ai.amberx.axf.settings'],
  register(rt) {
    rt.actions.register('patches.reload', () => { const v = rt.getState().view; if (tabsView.tabs.some((e) => tabViewId(e) === v)) bump(v); else rt.toast('Pick a tab first.', 'info', 'Reload'); }, { label: 'Reload the tab in front' });
    rt.actions.register('patches.tabs.add', () => rt.openDialog(ADD_TAB_DIALOG), { label: 'Add a tab…' });
    rt.actions.register('patches.tabs', () => openSettings(rt, 'connections'), { label: 'Tabs in Patches' });
    rt.actions.register('patches.tabs.remove', (_a, ctx) => {
      const e = tabsView.tabs.find((x) => tabViewId(x) === ctx?.payload);
      if (e) void removeTab(rt, tabKey(e));
    }, { label: 'Remove this tab', searchable: false });
    void loadTabs();
    rt.actions.register('patches.open', () => {
      const front = tabsView.tabs.find((e) => tabViewId(e) === rt.getState().view);
      const t = TABS.find((x) => x.id === front?.app);
      if (!t) return rt.toast('Pick a tab first.', 'info', 'Open');
      window.open(`${tabOrigin(t, t.key ? rt.settings.get(t.key) : null)}${t.path}`, '_blank', 'noopener');
    }, { label: 'Open the tab in front in a new tab' });
    rt.actions.register('patches.menu', ([tab, id]) => runGuestItem(rt, tab ?? '', id ?? ''), { label: 'Run an item of a tab app\'s menu', params: true, searchable: false });
    rt.actions.register('patches.plugins.fix', () => { for (const t of TABS) void installMissing(t); }, { label: 'Install the apps’ missing plugins in Patches' });
    rt.actions.register('patches.plugins', () => openSettings(rt, 'connections'), { label: 'Plugins in Patches' });
    rt.actions.register('patches.banners.toggle', () => rt.settings.set(BANNERS_KEY, rt.settings.get(BANNERS_KEY) === false), { label: 'Console banners above every tab' });
  },
  settings: [{
    id: 'patches', label: 'Patches', icon: 'layers', tab: 'connections', order: 5,
    description: 'The apps in the tabs. Addresses are https, host only; axHub is the hub this app runs with.',
    settings: [
      ...TABS.filter((t) => t.key).map((t) => ({ key: t.key, label: `${t.label} address`, kind: 'text' as const, default: t.fallback, description: 'https only, no path' })),
      { key: BANNERS_KEY, label: 'Console banners above every tab', kind: 'toggle' as const, default: true, description: 'The Dev Console’s banners (codebase changes, builds, GitHub activity, approvals, systems check, keys, What’s new), on screen whichever tab is open.' },
    ],
  }],
  settingsPanels: [
    { id: 'patches.tabs', tab: 'connections', title: 'Tabs', icon: 'layout', order: 5.5, render: () => <TabsPanel /> },
    { id: 'patches.plugins', tab: 'connections', title: 'Plugins', icon: 'package', order: 6, render: () => <PluginsPanel /> },
  ],
  dialogs: { [ADD_TAB_DIALOG]: { title: 'Add a tab', icon: 'plus', render: () => <AddTabDialog /> } },
  // The settings hook in the context menu, on every target Patches draws (banner, tabs, the settings page).
  contextMenu: [
    { id: 'patches.ctx', target: 'default', order: 1, items: [{ id: 'patches.reload', label: 'Reload the tab in front', icon: 'refresh', action: 'patches.reload' }] },
    { id: 'patches.ctx.tab', target: 'nav-item', order: 1, items: [{ id: 'patches.tabs.add', label: 'Add a tab…', icon: 'plus', action: 'patches.tabs.add' }, { id: 'patches.tabs.remove', label: 'Remove this tab', icon: 'trash', action: 'patches.tabs.remove' }] },
    { id: 'patches.ctx.plugintab', target: 'patches-plugin-tab', order: 1, items: [{ id: 'patches.tabs.remove', label: 'Remove this tab', icon: 'trash', action: 'patches.tabs.remove' }, { id: 'patches.tabs.add', label: 'Add a tab…', icon: 'plus', action: 'patches.tabs.add' }, { id: 'patches.tabs', label: 'Tabs settings', icon: 'settings', action: 'patches.tabs' }] },
  ],
  slots: {
    'app.frame.head': [{ id: 'patches.tabs', order: 10, render: () => <AppTabs /> }],
    'app.frame.top': [{ id: 'patches.strip', order: 10, render: () => <BannerStrip /> }],
    // Patches' own Systems check entry (missing plugins), above the console's banners in the strip.
    'app.frame.banners': [{ id: 'patches.plugins-check', order: 5, render: () => <PluginsCheck /> }],
  },
};
