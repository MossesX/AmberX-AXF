/**
 * Patches' own library (web): the app tabs (frames kept alive), the banner strip above them, and suite mode — the parts
 * of the apps Patches carries for them so the whole page works as one app (Brett, Oct 24 2026): the front app's banner
 * items on Patches' banner, its menus in Patches' menu bar, one search over every app, links between the apps opening
 * in their tabs, tab keys, loading covers, deep links. Every app still keeps its own pages, settings and plugins.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, FOCUS_SEARCH_EVENT, Icon, IconButton, ModelBadge, Note, useAsset, useAxfState, useRuntime, type AxfWebLibrary } from './axf/react';
import type { AxfRuntime, EmbedBannerItem, EmbedMenu, EmbedMessage, EmbedPlugin, EmbedSearchEntry } from './axf/core';
import { api } from './api';
import {
  DEFAULT_TABS, MAX_TABS, moveTab, pluginTabUrl, readTabs, tabChoices, tabIcon, tabKey, tabLabel, tabViewId, type TabChoice, type TabEntry,
  BANNERS_KEY, ERROR_MS, FRONT_STORE, READY_WAIT_MS, REMEMBER_KEY, SLOW_MS, WARM_KEY, TABS, appOf, appsMessage, fromApp, guestMenuCounters, guestMenuId,
  guestMenuItems, guestSearchEntries, hashForView, mirrorBanner, openSettingsMessage, parseStripMessage, runMessage, shareSummary, stripUrl,
  tabForUrl, tabOrigin, tabShortcut, tabUrl, viewFromHash, type PatchTab, type TabState,
} from './patches';

/** Reload ticks per tab (a frame reloads when its tick changes). */
const reloads = new Map<string, number>();
const reloadSubs = new Set<() => void>();
function bump(id: string) { reloads.set(id, (reloads.get(id) ?? 0) + 1); reloadSubs.forEach((f) => f()); }
function useReload(id: string): number { return useSyncExternalStore((f) => { reloadSubs.add(f); return () => reloadSubs.delete(f); }, () => reloads.get(id) ?? 0); }

/** Every frame Patches shows, by window, so a message is believed only from the frame it claims to be. */
type FrameKind = 'app' | 'plugin' | 'strip';
const frames = new Map<Window, { tab: PatchTab; kind: FrameKind; viewId: string }>();

const originFor = (rt: AxfRuntime, t: PatchTab) => tabOrigin(t, t.key ? rt.settings.get(t.key) : null);
const origins = (rt: AxfRuntime): Record<string, string> => Object.fromEntries(TABS.map((t) => [t.id, originFor(rt, t)]));

function useOrigin(t: PatchTab): string {
  const rt = useRuntime();
  useAxfState();
  return originFor(rt, t);
}

/** Open Patches' own settings (on one of its tabs). Each app in a tab opens its own settings itself. */
export function openSettings(rt: AxfRuntime, tab?: string) {
  if (tab) void rt.dispatch(`settings.open:${tab}`);
  else rt.navigate('settings');
}

/* ---------------- suite state: tab states + what each app shares ---------------- */

interface AppShare { banner: EmbedBannerItem[]; search: EmbedSearchEntry[]; menus: EmbedMenu[] | null; plugins: EmbedPlugin[] | null }
interface SuiteView {
  /** by tab view id */
  tabs: Record<string, TabState>;
  /** by app */
  apps: Partial<Record<PatchTab['id'], AppShare>>;
  /** a page another app linked to, shown in that app's tab (by view id) */
  deep: Record<string, string>;
}
let suite: SuiteView = { tabs: {}, apps: {}, deep: {} };
const suiteSubs = new Set<() => void>();
function setSuite(fn: (s: SuiteView) => SuiteView) { suite = fn(suite); suiteSubs.forEach((f) => f()); }
export function useSuite(): SuiteView { return useSyncExternalStore((f) => { suiteSubs.add(f); return () => suiteSubs.delete(f); }, () => suite); }
const NO_SHARE: AppShare = { banner: [], search: [], menus: null, plugins: null };
const shareOf = (id: string): AppShare => suite.apps[id as PatchTab['id']] ?? NO_SHARE;
function setShare(id: PatchTab['id'], patch: Partial<AppShare>) { setSuite((s) => ({ ...s, apps: { ...s.apps, [id]: { ...(s.apps[id] ?? NO_SHARE), ...patch } } })); }

function setTab(viewId: string, next: Partial<TabState>) {
  setSuite((s) => ({ ...s, tabs: { ...s.tabs, [viewId]: { ...(s.tabs[viewId] ?? { status: 'loading', takes: [], suite: false, since: Date.now() }), ...next } } }));
}

const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
const loadedFrames = new Set<string>();
/** Messages for an app that wasn't up yet (its settings, asked from Patches): sent once it is. */
const pending = new Map<string, EmbedMessage[]>();
function clearTimers(viewId: string) { for (const t of timers.get(viewId) ?? []) clearTimeout(t); timers.delete(viewId); }
function addTimer(viewId: string, t: ReturnType<typeof setTimeout>) { timers.set(viewId, [...(timers.get(viewId) ?? []), t]); }

/** A tab's frame (re)starts loading: covered until it is up; slow after a while; failed if it never loads. */
function startLoading(viewId: string) {
  clearTimers(viewId);
  loadedFrames.delete(viewId);
  setTab(viewId, { status: 'loading', takes: [], suite: false, since: Date.now() });
  addTimer(viewId, setTimeout(() => { if (suite.tabs[viewId]?.status === 'loading') setTab(viewId, { status: 'slow', since: Date.now() }); }, SLOW_MS));
  addTimer(viewId, setTimeout(() => { if (!loadedFrames.has(viewId) && suite.tabs[viewId]?.status !== 'ready') setTab(viewId, { status: 'error', since: Date.now() }); }, ERROR_MS));
}

/** The page loaded. An app that says `ready` soon is in suite mode; one that doesn't is an older build, shown as it is. */
function frameLoaded(rt: AxfRuntime, viewId: string) {
  loadedFrames.add(viewId);
  addTimer(viewId, setTimeout(() => {
    const st = suite.tabs[viewId];
    if (st && st.status !== 'ready') { setTab(viewId, { status: 'ready', since: Date.now() }); flushPending(rt, viewId); }
  }, READY_WAIT_MS));
}

function frameReady(rt: AxfRuntime, viewId: string, takes: string[]) {
  clearTimers(viewId);
  loadedFrames.add(viewId);
  setTab(viewId, { status: 'ready', takes, suite: true, since: Date.now() });
  flushPending(rt, viewId);
}

function flushPending(rt: AxfRuntime, viewId: string) {
  const list = pending.get(viewId);
  if (!list?.length) return;
  pending.delete(viewId);
  for (const m of list) postTo(rt, viewId, m);
}

/** Send a message to the app in a tab (its own frame, at its own origin). False when that frame isn't there. */
function postTo(rt: AxfRuntime, viewId: string, msg: EmbedMessage): boolean {
  let sent = false;
  for (const [w, f] of frames) {
    if (f.viewId !== viewId || f.kind === 'strip') continue;
    try { w.postMessage(msg, originFor(rt, f.tab)); sent = true; } catch { /* frame gone */ }
  }
  return sent;
}

/** Send now when the app is up, else as soon as it is. */
function postWhenUp(rt: AxfRuntime, viewId: string, msg: EmbedMessage) {
  if (suite.tabs[viewId]?.status === 'ready' && postTo(rt, viewId, msg)) return;
  pending.set(viewId, [...(pending.get(viewId) ?? []), msg].slice(-5));
}

/* ---------------- frames ---------------- */

function Frame({ tab, src, kind, title, viewId }: { tab: PatchTab; src: string; kind: FrameKind; title: string; viewId: string }) {
  const rt = useRuntime();
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const w = ref.current?.contentWindow;
    if (!w) return;
    frames.set(w, { tab, kind, viewId });
    return () => { frames.delete(w); };
  }, [tab, kind, viewId]);
  return (
    <iframe
      ref={ref}
      className={`pt-frame pt-frame--${kind}`}
      src={src}
      title={title}
      onLoad={kind === 'strip' ? undefined : () => frameLoaded(rt, viewId)}
      // The apps are Brett's own sites behind axHub's wall. Scripts + same-origin let them run; the sandbox still stops
      // them from navigating Patches itself. Popups (open in a new tab, downloads) are allowed out of the sandbox.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  );
}

/** The app's address outside Patches (a browser tab), for Open in a browser tab. */
function outsideUrl(rt: AxfRuntime, entry: TabEntry | undefined): string | null {
  const t = entry ? appOf(entry.app) : undefined;
  return t ? `${originFor(rt, t)}${t.path}` : null;
}

/** Over a tab while its app is opening: a spinner; then "taking a while" or "didn't load", with Reload. */
function TabCover({ entry }: { entry: TabEntry }) {
  const rt = useRuntime();
  const s = useSuite();
  const id = tabViewId(entry);
  const st = s.tabs[id];
  if (!st || st.status === 'ready') return null;
  const label = tabLabel(entry);
  const url = outsideUrl(rt, entry);
  return (
    <div className="pt-cover" role="status" aria-live="polite" data-status={st.status}>
      <div className="pt-cover__box">
        {st.status === 'error' ? <Icon name="alert" size={24} /> : <span className="pt-cover__spin"><Icon name="refresh" size={24} /></span>}
        <strong>{st.status === 'error' ? `${label} didn’t load` : `Opening ${label}…`}</strong>
        {st.status === 'slow' && <span className="fx-muted">It’s taking longer than usual.</span>}
        {st.status === 'error' && <span className="fx-muted">Check its address in Settings → Patches, and that you’re signed in to axHub.</span>}
        {st.status !== 'loading' && (
          <div className="fx-row">
            <Button size="sm" icon="refresh" tone="primary" onClick={() => bump(id)}>Reload</Button>
            {url && <Button size="sm" icon="external" onClick={() => window.open(url, '_blank', 'noopener')}>Open in a browser tab</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One tab, kept alive across tab switches (AppShell `keep`): an app in a frame (suite mode), or a tabable plugin of an
 * app (that app showing only the plugin's page, embed@1 page `view:<id>`, sharing nothing).
 */
export function AppTab({ entry }: { entry: TabEntry }) {
  const t = appOf(entry.app) ?? TABS[0]!;
  const origin = useOrigin(t);
  const id = tabViewId(entry);
  const tick = useReload(id);
  const s = useSuite();
  const src = entry.kind === 'plugin' ? pluginTabUrl(t, origin, entry.view) : tabUrl(t, origin, s.deep[id]);
  useEffect(() => { startLoading(id); }, [id, src, tick]);
  return (
    <div className="pt-tab" data-patches-tab={id}>
      <Frame key={`${src}#${tick}`} tab={t} src={src} kind={entry.kind === 'plugin' ? 'plugin' : 'app'} title={tabLabel(entry)} viewId={id} />
      <TabCover entry={entry} />
    </div>
  );
}

/* ---------------- the tab group (patches-tabs@1, kept on Patches' server) ---------------- */

type TabsView = { tabs: TabEntry[]; loaded: boolean; error: string };
let tabsView: TabsView = { tabs: DEFAULT_TABS, loaded: false, error: '' };
const tabsSubs = new Set<() => void>();
function setTabsView(next: Partial<TabsView>) { tabsView = { ...tabsView, ...next }; tabsSubs.forEach((f) => f()); }
export function useTabs(): TabsView { return useSyncExternalStore((f) => { tabsSubs.add(f); return () => tabsSubs.delete(f); }, () => tabsView); }

/** Every view Patches has: the tabs, every app (links to an app work even when it isn't a tab) and Settings. */
function knownViews(): string[] { return [...new Set([...tabsView.tabs.map(tabViewId), ...TABS.map((t) => t.id), 'settings'])]; }

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

async function addTab(rt: AxfRuntime, c: TabChoice): Promise<void> {
  if (c.added || tabsView.tabs.length >= MAX_TABS) return;
  if (await saveTabs(rt, [...tabsView.tabs, c.entry])) { rt.navigate(tabViewId(c.entry)); rt.closeDialog(); }
}

async function removeTab(rt: AxfRuntime, key: string): Promise<void> {
  await saveTabs(rt, tabsView.tabs.filter((e) => tabKey(e) !== key));
}

/** The plugins every app last reported (whenever it runs in Patches), for the Add tab dialog. */
function reports(s: SuiteView): Partial<Record<PatchTab['id'], EmbedPlugin[]>> {
  return Object.fromEntries(TABS.map((t) => [t.id, s.apps[t.id]?.plugins ?? []]));
}

/** The Add tab dialog: every app and every tabable plugin the apps reported, each with Add (or "Already a tab"). */
export function AddTabDialog() {
  const rt = useRuntime();
  const tv = useTabs();
  const s = useSuite();
  const { apps, plugins: groups } = tabChoices(tv.tabs, reports(s));
  const full = tv.tabs.length >= MAX_TABS;
  const row = (c: TabChoice, app?: PatchTab) => (
    <li key={tabKey(c.entry)} className="pt-addtab__row">
      <Icon name={tabIcon(c.entry)} size={16} />
      <span className="pt-addtab__name">
        <strong>{tabLabel(c.entry)} {c.entry.kind === 'plugin' && <ModelBadge compact model={c.model} />}</strong>
        {app && !c.added && c.on === false && <span className="fx-muted">Switched off in {app.label}: switch it on in its Plugins settings first.</span>}
      </span>
      {c.added ? <span className="fx-muted">Already a tab</span> : <Button size="sm" icon="plus" tone="primary" disabled={full || c.on === false} onClick={() => void addTab(rt, c)}>Add</Button>}
    </li>
  );
  return (
    <div className="fx-stack pt-addtab">
      <p className="fx-muted" style={{ margin: 0 }}>Pick an app or a plugin to give it its own tab. Only plugins marked tabable are listed.</p>
      {full && <Note tone="warning">Patches has {MAX_TABS} tabs, the most it holds. Remove one first.</Note>}
      <section>
        <h3 className="pt-head">Apps</h3>
        <ul className="pt-addtab__list">{apps.map((c) => row(c))}</ul>
      </section>
      {groups.map((g) => (
        <section key={g.app.id}>
          <h3 className="pt-head"><Icon name={g.app.icon} size={14} /> {g.app.label} plugins</h3>
          <ul className="pt-addtab__list">{g.choices.map((c) => row(c, g.app))}</ul>
        </section>
      ))}
      {!groups.length && <Note tone="info">No tabable plugins yet. Apps list theirs once their tab has loaded; open an app’s tab, then come back.</Note>}
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
      <p className="fx-muted" style={{ margin: 0 }}>The tabs above the menu, on every device. Alt+1 … Alt+9 bring them up. Apps show the whole app; a plugin tab shows just that plugin’s page.</p>
      {tv.error && <Note tone="danger">{tv.error}</Note>}
      <ul className="pt-addtab__list">
        {tv.tabs.map((e, i) => (
          <li key={tabKey(e)} className="pt-addtab__row">
            <Icon name={tabIcon(e)} size={16} />
            <span className="pt-addtab__name"><strong>{tabLabel(e)}</strong><span className="fx-muted">{e.kind === 'app' ? 'App' : `Plugin · ${appOf(e.app)?.label ?? e.app}`}{i < 9 ? ` · Alt+${i + 1}` : ''}</span></span>
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

/** "Shares its banner, menu, search and links with Patches", or why not. */
function appStatus(st: TabState | undefined): string {
  if (!st) return 'Not opened yet: its tab opens it.';
  if (st.status === 'loading') return 'Opening…';
  if (st.status === 'slow') return 'Taking longer than usual to open.';
  if (st.status === 'error') return 'Didn’t load: check its address.';
  return st.suite ? `Shares its ${shareSummary(st.takes)} with Patches.` : 'An older build: it shows its own banner and menu here until it is updated.';
}

/** Settings → Patches → Apps: each app, how it runs in Patches, its own settings, reload, open outside. */
function AppsPanel() {
  const rt = useRuntime();
  const s = useSuite();
  useAxfState();
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>Inside Patches the apps share one banner, one menu bar, one search box and one look (colours, style and controls). Each keeps its own pages, settings and plugins: open them here or from its own menu.</p>
      <ul className="pt-addtab__list">
        {TABS.map((t) => (
          <li key={t.id} className="pt-addtab__row">
            <Icon name={t.icon} size={16} />
            <span className="pt-addtab__name">
              <strong>{t.label}</strong>
              <span className="fx-muted">{t.blurb} {originFor(rt, t).replace(/^https:\/\//, '')}</span>
              <span className="fx-muted" data-patches-status={s.tabs[t.id]?.status ?? 'none'}>{appStatus(s.tabs[t.id])}</span>
            </span>
            <span className="fx-row">
              <Button size="sm" icon="settings" onClick={() => openAppSettings(rt, t.id)}>Its settings</Button>
              <IconButton icon="refresh" label={`Reload ${t.label}`} onClick={() => bump(t.id)} />
              <IconButton icon="external" label={`Open ${t.label} in a browser tab`} onClick={() => window.open(`${originFor(rt, t)}${t.path}`, '_blank', 'noopener')} />
            </span>
          </li>
        ))}
      </ul>
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
      <Frame tab={t} src={stripUrl(origin)} kind="strip" title="Console banners" viewId="strip" />
    </div>
  );
}

/* ---------------- what the apps send ---------------- */

/** An app's messages: believed only from its own frame, at its own origin. */
export function useAppMessages() {
  const rt = useRuntime();
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const f = e.source ? frames.get(e.source as Window) : undefined;
      if (!f || e.origin !== originFor(rt, f.tab)) return;
      const m = fromApp(e.data);
      if (!m) return;
      // Any page of an app (its tab, a plugin tab, the banner strip) lists its plugins: the Add tab dialog offers its tabable ones.
      if (m.type === 'plugins') { setShare(f.tab.id, { plugins: m.plugins }); return; }
      if (m.type === 'notify') { rt.toast(m.body ?? m.title, m.level === 'error' ? 'danger' : m.level === 'warning' ? 'warning' : m.level === 'success' ? 'success' : 'info', `${f.tab.label}: ${m.title}`); return; }
      if (f.kind === 'strip') return;
      if (m.type === 'ready') {
        frameReady(rt, f.viewId, m.takes ?? []);
        if (f.kind === 'app') try { (e.source as Window).postMessage(appsMessage(origins(rt)), e.origin); } catch { /* frame gone */ }
        return;
      }
      if (f.kind !== 'app') return;
      switch (m.type) {
        case 'menu': setShare(f.tab.id, { menus: m.menus }); break;
        case 'banner': setShare(f.tab.id, { banner: m.items }); break;
        case 'search-catalog': setShare(f.tab.id, { search: m.entries }); break;
        case 'focus-search': focusSearch(); break;
        case 'hotkey': { const n = /^Alt\+([1-9])$/.exec(m.key); if (n) goTab(rt, Number(n[1]) - 1); break; }
        case 'open-url': openUrl(rt, m.url); break;
        default: break;
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [rt]);
}

/** Patches' search box (Ctrl/Cmd+K in any app lands here). */
function focusSearch() {
  window.focus();
  window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
}

/** Bring the n-th tab up (Alt+1 … Alt+9, in Patches or in any app). */
function goTab(rt: AxfRuntime, i: number) {
  const e = tabsView.tabs[i];
  if (e) rt.navigate(tabViewId(e));
}

function stepTab(rt: AxfRuntime, by: 1 | -1) {
  const list = tabsView.tabs;
  if (!list.length) return;
  const i = list.findIndex((e) => tabViewId(e) === rt.getState().view);
  const j = i < 0 ? 0 : (i + by + list.length) % list.length;
  rt.navigate(tabViewId(list[j]!));
}

/** A link from one app to another: that app's tab comes up (on that page); anything else opens in a browser tab. */
function openUrl(rt: AxfRuntime, url: string) {
  const hit = tabForUrl(url, origins(rt));
  if (!hit) { window.open(url, '_blank', 'noopener'); return; }
  const id = hit.tab.id;
  const u = new URL(hit.url);
  // its start page: just bring the tab up (no reload); any other page: show that page in the tab
  if (!(u.pathname === hit.tab.path && !u.search && !u.hash)) {
    if (suite.deep[id] === hit.url) bump(id);
    else setSuite((s) => ({ ...s, deep: { ...s.deep, [id]: hit.url } }));
  }
  rt.navigate(id);
}

/** An app's own settings, from Patches: bring its tab up and ask it (each app keeps its own settings). */
function openAppSettings(rt: AxfRuntime, tabId: string | undefined, settingsTab?: string) {
  const t = tabId ? appOf(tabId) : undefined;
  if (!t) { rt.toast('Pick an app’s tab first.', 'info', 'Settings'); return; }
  rt.navigate(t.id);
  postWhenUp(rt, t.id, openSettingsMessage(settingsTab));
}

/** The app in front (app tabs only; a plugin tab or Patches' Settings has none). */
const frontApp = (rt: AxfRuntime): PatchTab | undefined => appOf(rt.getState().view);

/* ---------------- the front app on Patches' banner and in its menu bar ---------------- */

const GUEST_BANNER = 'patches.guest';
const GUEST_MENU = 'patches.guest-menu';
const FRONT_LABEL = 'patches-front';
let bannerShape = '';
let menuShape = '';
let frontPainted = '';
const popups = new Map<string, string>();

/** The front app's banner items on Patches' banner (registered as Patches' own assets; taps go back to the app). */
function paintBanner(rt: AxfRuntime, front: PatchTab | undefined) {
  const items = front ? mirrorBanner(front.id, shareOf(front.id).banner) : [];
  // counters change often: only the numbers are set again when nothing else changed
  for (const m of items) if (m.counter) rt.setBadge(m.counter.name, m.counter.value);
  const shape = JSON.stringify([front?.id ?? '', items.map((m) => [m.type, m.id, m.at, m.order, m.data])]);
  if (shape !== bannerShape) {
    bannerShape = shape;
    rt.detachFromBanner(GUEST_BANNER);
    for (const m of items) {
      const res = rt.registry.register({ $axf: 'asset@1', type: m.type, id: m.id, name: `${front!.label}: ${m.key}`, version: '1.0.0', data: m.data }, 'app', GUEST_BANNER);
      if (!res.ok) { rt.terminal.warn('patches', `${front!.label}'s banner item ${m.key} isn't shown: ${res.errors.join('; ')}`); continue; }
      rt.attachToBanner({ type: m.type, id: m.id, at: m.at, order: m.order, origin: GUEST_BANNER });
    }
  }
  for (const m of items) {
    if (!m.popup || popups.get(m.id) === m.popup) continue;
    popups.set(m.id, m.popup);
    rt.showBannerPopup(`${m.type}:${m.id}`, m.popup, 5000);
  }
}

/** The front app's menus in Patches' menu bar, after Patches' own menu (like a desktop menu bar following the front window). */
function paintMenus(rt: AxfRuntime, front: PatchTab | undefined) {
  const menus = front ? shareOf(front.id).menus : null;
  if (front && menus) for (const [n, v] of Object.entries(guestMenuCounters(front.id, menus))) rt.setBadge(n, v);
  const shape = JSON.stringify([front?.id ?? '', menus]);
  if (shape === menuShape) return;
  menuShape = shape;
  rt.removeAppMenuItems(GUEST_MENU);
  if (!front || !menus) return;
  guestMenuItems(front.id, menus).forEach((m, i) => {
    if (!m.items?.length) return;
    rt.addAppMenuItems({ id: `${GUEST_MENU}.${front.id}.${i}`, module: GUEST_MENU, menu: guestMenuId(front.id, m.id), menuLabel: m.label, menuOrder: 20 + i, items: m.items });
  });
}

/** "Console" next to Patches' mark: which app is in front (a label widget Patches repaints). */
function paintFront(rt: AxfRuntime, view: string) {
  const e = tabsView.tabs.find((x) => tabViewId(x) === view) ?? DEFAULT_TABS.find((x) => tabViewId(x) === view);
  const text = view === 'settings' ? 'Settings' : e ? tabLabel(e) : '';
  if (text === frontPainted) return;
  frontPainted = text;
  if (!text) { rt.detachFromBanner(`label:${FRONT_LABEL}`); return; }
  rt.registry.register({ $axf: 'asset@1', type: 'label', id: FRONT_LABEL, name: 'Tab in front', version: '1.0.0', data: { text, tone: 'accent', mono: false } }, 'app', 'patches.front');
  rt.attachToBanner({ type: 'label', id: FRONT_LABEL, at: 'left', order: 5, origin: 'patches.front' });
}

const readFront = () => { try { return localStorage.getItem(FRONT_STORE); } catch { return null; } };
const saveFront = (v: string) => { try { localStorage.setItem(FRONT_STORE, v); } catch { /* storage off */ } };

/** The address Patches was opened with (read once, before Patches writes the tab in front into it). */
const START_HASH = typeof location === 'undefined' ? '' : location.hash;
/** Patches has opened on the tab it was asked for (or found it doesn't have it): from then on the address follows the tabs. */
let started = false;

/**
 * Open on the tab asked for: the address's `#/<tab>`, else the one in front last time on this device (setting), else
 * the start view. A plugin tab is known only once the tab group has loaded, so this runs again then.
 */
function openStartView(rt: AxfRuntime, final: boolean) {
  if (started) return;
  const known = knownViews();
  const asked = START_HASH.replace(/^#\/?/, '') ? START_HASH : '';
  const last = rt.settings.get(REMEMBER_KEY) === false ? null : readFront();
  const v = viewFromHash(asked, known) ?? (last && known.includes(last) ? last : null);
  if (v) { started = true; if (v !== rt.getState().view) rt.navigate(v); return; }
  // not known yet: maybe a plugin tab the tab group brings; give up once it has loaded
  if (final || (!asked && !last)) started = true;
}

/** Keeps Patches' banner, menu bar, address and tab keys in step with the tab in front. Called once (App). */
export function useSuiteSync() {
  const rt = useRuntime();
  const state = useAxfState();
  const s = useSuite();
  const tv = useTabs();
  const front = appOf(state.view);
  // open on the tab asked for first (at start, and again once the tab group has loaded: plugin tabs come with it)
  useEffect(() => { openStartView(rt, tv.loaded); }, [rt, tv.loaded]);
  useEffect(() => {
    paintBanner(rt, front);
    paintMenus(rt, front);
    paintFront(rt, state.view);
  }, [rt, front, s, state.view, tv.tabs]);
  // the address says which tab is in front (#/pilot), so a reload, a bookmark or a shared link opens on it
  useEffect(() => {
    if (!started || !knownViews().includes(state.view)) return;
    const h = hashForView(state.view);
    if (location.hash !== h) history.replaceState(null, '', `${location.pathname}${location.search}${h}`);
    if (rt.settings.get(REMEMBER_KEY) !== false) saveFront(state.view);
  }, [rt, state.view, tv.tabs, tv.loaded]);
  useEffect(() => {
    const onHash = () => { const v = viewFromHash(location.hash, knownViews()); if (v && v !== rt.getState().view) rt.navigate(v); };
    const onKey = (e: KeyboardEvent) => {
      const i = tabShortcut(e);
      if (i == null) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      e.preventDefault();
      goTab(rt, i);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey); };
  }, [rt]);
}

/**
 * The app tabs, above the application menu (Brett, Oct 22 2026: "tabs for the apps above the application menu"): the
 * `patches-tabs` nav-menu asset drawn as one row in the page slot `app.frame.head`. The layout's nav region accepts
 * nothing (`slots.nav: []`), so the tabs aren't drawn a second time under the menu. Each tab shows whether its app is
 * still opening or failed.
 */
function AppTabs() {
  const rt = useRuntime();
  const state = useAxfState();
  const nav = useAsset('nav-menu');
  const tv = useTabs();
  const s = useSuite();
  // The tab group (Settings → Patches → Tabs) decides which tabs show and in what order; an app tab keeps the label and
  // icon the nav-menu asset gives it (and its access rule), a plugin tab carries its own.
  const navItems = nav.data.sections.flatMap((sec) => sec.items);
  const items = tv.tabs.map((e, i) => {
    const it = e.kind === 'app' ? navItems.find((x) => x.view === e.app) : undefined;
    return { id: tabViewId(e), view: tabViewId(e), label: it?.label ?? tabLabel(e), icon: it?.icon ?? tabIcon(e), requires: it?.requires, plugin: e.kind === 'plugin', key: i < 9 ? `Alt+${i + 1}` : '' };
  }).filter((it) => rt.gate(it.requires) !== 'hide');
  return (
    <nav className={`fx-nav fx-nav--${nav.data.style} patches-tabs`} data-orient="horizontal" aria-label="Tabs">
      <div className="fx-nav__section" role="tablist">
        {items.map((it) => {
          const on = state.view === it.view;
          const st = s.tabs[it.view]?.status;
          return (
            <button key={it.id} type="button" role="tab" aria-selected={on} className={`fx-nav__item ${on ? 'is-active' : ''}`} title={it.key ? `${it.label} (${it.key})` : it.label}
              data-fx-ctx-target={it.plugin ? 'patches-plugin-tab' : 'nav-item'} data-fx-ctx-payload={it.view} data-patches-state={st ?? 'idle'} onClick={() => rt.navigate(it.view)}>
              <span className="patches-tabs__icon"><Icon name={st === 'error' ? 'alert' : it.icon} size={17} /></span>
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

/** Run something an app put on Patches' banner, in its menu or in the search: its tab comes up, the app runs it. */
function runInApp(rt: AxfRuntime, tabId: string, id: string) {
  const t = appOf(tabId);
  if (!t || !id) return;
  rt.navigate(t.id);
  postWhenUp(rt, t.id, runMessage(id));
}

export const patchesLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.patches',
  label: 'Patches',
  version: '0.2.0',
  dependsOn: ['ai.amberx.axf.settings'],
  register(rt) {
    const front = () => tabsView.tabs.find((e) => tabViewId(e) === rt.getState().view);
    rt.actions.register('patches.reload', () => { const v = rt.getState().view; if (knownViews().includes(v) && v !== 'settings') bump(v); else rt.toast('Pick a tab first.', 'info', 'Reload'); }, { label: 'Reload the tab in front' });
    rt.actions.register('patches.open', () => {
      const url = outsideUrl(rt, front() ?? DEFAULT_TABS.find((e) => tabViewId(e) === rt.getState().view));
      if (!url) return rt.toast('Pick a tab first.', 'info', 'Open');
      window.open(url, '_blank', 'noopener');
    }, { label: 'Open the tab in front in a browser tab' });
    rt.actions.register('patches.go', ([v]) => { if (v && knownViews().includes(v)) rt.navigate(v); }, { label: 'Bring a tab up', params: true, searchable: false });
    rt.actions.register('patches.search', () => focusSearch(), { label: 'Search every app' });
    rt.actions.register('patches.next', () => stepTab(rt, 1), { label: 'Next tab' });
    rt.actions.register('patches.prev', () => stepTab(rt, -1), { label: 'Previous tab' });
    rt.actions.register('patches.tabs.add', () => rt.openDialog(ADD_TAB_DIALOG), { label: 'Add a tab…' });
    rt.actions.register('patches.tabs', () => openSettings(rt, 'connections'), { label: 'Tabs in Patches' });
    rt.actions.register('patches.tabs.remove', (_a, ctx) => {
      const e = tabsView.tabs.find((x) => tabViewId(x) === ctx?.payload);
      if (e) void removeTab(rt, tabKey(e));
    }, { label: 'Remove this tab', searchable: false });
    rt.actions.register('patches.front.settings', (_a, ctx) => openAppSettings(rt, typeof ctx?.payload === 'string' && appOf(ctx.payload) ? ctx.payload : frontApp(rt)?.id), { label: 'Settings of the app in front' });
    rt.actions.register('patches.app.settings', ([tab, ...rest]) => openAppSettings(rt, tab, rest.join(':') || undefined), { label: 'An app’s own settings', params: true, searchable: false });
    // what the apps sent: their menus, banner taps and search picks, run by the app itself
    rt.actions.register('patches.menu', ([tab, ...id]) => runInApp(rt, tab ?? '', id.join(':')), { label: 'Run an item of a tab app’s menu', params: true, searchable: false });
    rt.actions.register('patches.w', ([tab, ...key]) => runInApp(rt, tab ?? '', `w:${key.join(':')}`), { label: 'Tap an app’s banner item', params: true, searchable: false });
    rt.actions.register('patches.find', ([tab, id]) => runInApp(rt, tab ?? '', `s:${id ?? ''}`), { label: 'Open a search result in its app', params: true, searchable: false });
    rt.actions.register('patches.banners.toggle', () => rt.settings.set(BANNERS_KEY, rt.settings.get(BANNERS_KEY) === false), { label: 'Console banners above every tab' });
    // one search over every app
    rt.search.add('patches.apps', () => TABS.flatMap((t) => guestSearchEntries(t, shareOf(t.id).search)));
    // the Tabs menu's live list
    rt.registerAppMenuProvider('patches.tabs', () => tabsView.tabs.map((e, i) => ({ id: `tab.${tabKey(e)}`, label: tabLabel(e), icon: tabIcon(e), action: `patches.go:${tabViewId(e)}`, ...(i < 9 ? { shortcut: `Alt+${i + 1}` } : {}) })));
    void loadTabs();
  },
  settings: [{
    id: 'patches', label: 'Patches', icon: 'layers', tab: 'connections', order: 5,
    description: 'The apps in the tabs. Addresses are https, host only; axHub is the hub this app runs with.',
    settings: [
      ...TABS.filter((t) => t.key).map((t) => ({ key: t.key, label: `${t.label} address`, kind: 'text' as const, default: t.fallback, description: 'https only, no path' })),
      { key: BANNERS_KEY, label: 'Console banners above every tab', kind: 'toggle' as const, default: true, description: 'The Dev Console’s banners (codebase changes, builds, activity, approvals, systems check, keys, What’s new) on screen whichever tab is open. Off: the Console tab shows them itself.' },
      { key: REMEMBER_KEY, label: 'Open on the last tab', kind: 'toggle' as const, default: true, description: 'Patches opens on the tab that was in front last time on this device. A link with #/<tab> always wins.' },
      { key: WARM_KEY, label: 'Load every app at start', kind: 'toggle' as const, default: true, description: 'Console, Pilot and axHub load in the background as Patches opens, so search, menus and banners cover every app at once. Off: an app loads the first time its tab is opened (next time Patches opens).' },
    ],
  }],
  settingsPanels: [
    { id: 'patches.apps', tab: 'connections', title: 'Apps', icon: 'grid', order: 5.2, render: () => <AppsPanel /> },
    { id: 'patches.tabs', tab: 'connections', title: 'Tabs', icon: 'layout', order: 5.5, render: () => <TabsPanel /> },
  ],
  dialogs: { [ADD_TAB_DIALOG]: { title: 'Add a tab', icon: 'plus', render: () => <AddTabDialog /> } },
  contextMenu: [
    { id: 'patches.ctx', target: 'default', order: 1, items: [
      { id: 'patches.reload', label: 'Reload the tab in front', icon: 'refresh', action: 'patches.reload' },
      { id: 'patches.front.settings', label: 'Settings of the app in front', icon: 'sliders', action: 'patches.front.settings' },
      { id: 'patches.open', label: 'Open in a browser tab', icon: 'external', action: 'patches.open' },
    ] },
    { id: 'patches.ctx.tab', target: 'nav-item', order: 1, items: [
      { id: 'patches.front.settings', label: 'Its settings', icon: 'sliders', action: 'patches.front.settings' },
      { id: 'patches.tabs.add', label: 'Add a tab…', icon: 'plus', action: 'patches.tabs.add' },
      { id: 'patches.tabs.remove', label: 'Remove this tab', icon: 'trash', action: 'patches.tabs.remove' },
    ] },
    { id: 'patches.ctx.plugintab', target: 'patches-plugin-tab', order: 1, items: [{ id: 'patches.tabs.remove', label: 'Remove this tab', icon: 'trash', action: 'patches.tabs.remove' }, { id: 'patches.tabs.add', label: 'Add a tab…', icon: 'plus', action: 'patches.tabs.add' }, { id: 'patches.tabs', label: 'Tabs settings', icon: 'settings', action: 'patches.tabs' }] },
  ],
  slots: {
    'app.frame.head': [{ id: 'patches.tabs', order: 10, render: () => <AppTabs /> }],
    'app.frame.top': [{ id: 'patches.strip', order: 10, render: () => <BannerStrip /> }],
  },
};
