/**
 * Patches' own library (web): the three app tabs (frames kept alive), the banner strip above them, the combined
 * Settings (one tab per app), the settings hook in the application menu + the context menu, and the actions behind them.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Icon, Note, Switch, useAsset, useAxfState, useRuntime, type AxfWebLibrary } from './axf/react';
import type { EmbedPlugin } from './axf/core';
import { api } from './api';
import { library as settingsLibrary } from './axf/libs/settings';
import type { AxfRuntime } from './axf/core';
import {
  AUTO_INSTALL_KEY, enabledPluginIds, missingPlugins, missingSummary, pluginsEnabledMessage, pluginsRequestMessage, type PluginsState,
  BANNERS_KEY, bannerAsk, bannersUrl, SETTINGS_APPS, SETTINGS_APP_KEY, TABS, fromApp, guestMenuCounters, guestMenuItems, isSettingsApp, openTabMessage, parseStripMessage,
  runMessage, settingsUrl, stripUrl, tabOrigin, tabUrl, type PatchTab, type SettingsApp,
} from './patches';

/* ---------------- shared state: which app's tab the combined settings shows, and a sub-tab to open ---------------- */

type Want = { app: SettingsApp; tab?: string; at: number };
let want: Want = { app: 'patches', at: 0 };
const wantSubs = new Set<() => void>();
function setWant(next: Want) { want = next; wantSubs.forEach((f) => f()); }
function useWant(): Want { return useSyncExternalStore((f) => { wantSubs.add(f); return () => wantSubs.delete(f); }, () => want); }

/** Reload ticks per tab (a frame reloads when its tick changes). */
const reloads = new Map<string, number>();
const reloadSubs = new Set<() => void>();
function bump(id: string) { reloads.set(id, (reloads.get(id) ?? 0) + 1); reloadSubs.forEach((f) => f()); }
function useReload(id: string): number { return useSyncExternalStore((f) => { reloadSubs.add(f); return () => reloadSubs.delete(f); }, () => reloads.get(id) ?? 0); }

/** Every frame Patches shows, by window, so a message is believed only from the frame it claims to be. */
const frames = new Map<Window, { tab: PatchTab; kind: 'app' | 'settings' | 'strip' }>();

function useOrigin(t: PatchTab): string {
  const rt = useRuntime();
  useAxfState();
  return tabOrigin(t, t.key ? rt.settings.get(t.key) : null);
}

/** Open the combined settings on an app's tab (and a tab inside that app's settings). */
export function openSettings(rt: AxfRuntime, app: SettingsApp, tab?: string) {
  setWant({ app, tab, at: Date.now() });
  try { rt.settings.set(SETTINGS_APP_KEY, app); } catch { /* storage off */ }
  rt.navigate('settings');
}

/* ---------------- frames ---------------- */

function Frame({ tab, src, kind, title, onHeight }: { tab: PatchTab; src: string; kind: 'app' | 'settings' | 'strip'; title: string; onHeight?: (px: number) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const w = ref.current?.contentWindow;
    if (!w) return;
    frames.set(w, { tab, kind });
    return () => { frames.delete(w); };
  }, [tab, kind, src]);
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

/** One app tab: its app in a frame, kept alive across tab switches (AppShell `keep`). */
export function AppTab({ id }: { id: PatchTab['id'] }) {
  const t = TABS.find((x) => x.id === id) ?? TABS[0]!;
  const origin = useOrigin(t);
  const tick = useReload(id);
  return <div className="pt-tab" data-patches-tab={id}><Frame key={`${origin}#${tick}`} tab={t} src={tabUrl(t, origin)} kind="app" title={t.label} /></div>;
}

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

/* ---------------- combined settings ---------------- */

/** One app's own settings page inside the combined settings (page mode), kept alive once opened. */
function AppSettings({ t, active, tab, at, banners = false }: { t: PatchTab; active: boolean; tab?: string; at: number; banners?: boolean }) {
  const origin = useOrigin(t);
  const ref = useRef<HTMLDivElement>(null);
  // A sub-tab asked for (e.g. the console's Appearance): sent once the page is there, again after a short wait.
  useEffect(() => {
    if (!active || !tab || !t.axf) return;
    const send = () => {
      const w = ref.current?.querySelector('iframe')?.contentWindow;
      if (w) try { w.postMessage(openTabMessage(tab), origin); } catch { /* not loaded */ }
    };
    send();
    const a = setTimeout(send, 800);
    const b = setTimeout(send, 2500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [active, tab, at, origin, t.axf]);
  return (
    <div ref={ref} className="pt-settings__page" hidden={!active}>
      {banners
        ? <Frame tab={t} src={bannersUrl(origin)} kind="settings" title="Banner settings" />
        : <Frame tab={t} src={settingsUrl(t, origin)} kind="settings" title={`${t.label} settings`} />}
    </div>
  );
}

/** Patches' combined Settings: Patches · Console · Pilot · axHub. Each app's tab is that app's own settings page. */
export function CombinedSettings() {
  const rt = useRuntime();
  const w = useWant();
  const saved = rt.settings.get(SETTINGS_APP_KEY);
  const app: SettingsApp = w.at ? w.app : isSettingsApp(saved) ? saved : 'patches';
  const [opened, setOpened] = useState<string[]>([app]);
  useEffect(() => { setOpened((o) => (o.includes(app) ? o : [...o, app])); }, [app]);
  const pick = (id: SettingsApp) => { setWant({ app: id, at: Date.now() }); try { rt.settings.set(SETTINGS_APP_KEY, id); } catch { /* storage off */ } };
  const Own = settingsLibrary.views?.settings?.render ?? (() => null);
  return (
    <div className="pt-settings">
      <div className="pt-settings__tabs" role="tablist" aria-label="Settings for">
        {SETTINGS_APPS.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === app} className={`pt-settings__tab ${a.id === app ? 'is-active' : ''}`} onClick={() => pick(a.id)}>
            <Icon name={a.icon} size={15} /><span>{a.label}</span>
          </button>
        ))}
      </div>
      <div className="pt-settings__body">
        <div className="pt-settings__page pt-settings__page--own" hidden={app !== 'patches'}>{Own()}</div>
        {/* Banners: every banner above the tabs (they come from the Dev Console), the console's Banners page on its own */}
        {opened.includes('banners') && <AppSettings t={TABS[0]!} banners active={app === 'banners'} tab={app === 'banners' ? w.tab : undefined} at={w.at} />}
        {TABS.filter((t) => opened.includes(t.id)).map((t) => (
          <AppSettings key={t.id} t={t} active={app === t.id} tab={app === t.id ? w.tab : undefined} at={w.at} />
        ))}
      </div>
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
      // Banner settings (from a banner's right-click, in the strip or an app) open Patches' Banners tab on that banner;
      // anything else the strip sends is ignored (it only relays banner taps to the Console tab).
      // Every page of an app (tab, settings page, banner strip) reports its plugins and runs only what Patches enabled.
      if (m.type === 'plugins') { void onPluginReport(rt, f.tab, e.source as Window, origin, m.plugins); return; }
      const banner = m.type === 'open-settings' ? bannerAsk(m.tab) : null;
      if (banner !== null) openSettings(rt, 'banners', banner || undefined);
      else if (f.kind === 'strip') return;
      else if (m.type === 'open-settings') openSettings(rt, f.tab.id, m.tab);
      else if (m.type === 'menu' && f.kind === 'app') showGuestMenu(rt, f.tab, m.menus);
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
            <Button size="sm" icon="settings" onClick={() => openSettings(rt, 'patches', 'connections')}>Plugins</Button>
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
      <p className="fx-muted" style={{ margin: 0 }}>Inside Patches the apps run only the plugins installed and switched on here; their own plugin settings are greyed out. On its own, each app keeps its own plugins.</p>
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
              <Switch key={id} checked={p.enabled} onChange={(on) => void switchPlugin(t, id, on)} label={p.name} hint={p.version ? `${id} · ${p.version}` : id} />
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
  const items = nav.data.sections.flatMap((sec) => sec.items).filter((it) => TABS.some((t) => t.id === it.view) && rt.gate(it.requires) !== 'hide');
  if (!items.length) return null;
  return (
    <nav className={`fx-nav fx-nav--${nav.data.style} patches-tabs`} data-orient="horizontal" aria-label="Apps">
      <div className="fx-nav__section" role="tablist">
        {items.map((it) => {
          const on = state.view === it.view;
          return (
            <button key={it.id} type="button" role="tab" aria-selected={on} className={`fx-nav__item ${on ? 'is-active' : ''}`} title={it.label}
              data-fx-ctx-target="nav-item" data-fx-ctx-payload={it.view} onClick={() => rt.navigate(it.view)}>
              <Icon name={it.icon} size={17} />
              <span className="fx-nav__text">{it.label}</span>
            </button>
          );
        })}
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
    // The settings hook: app.settings opens the combined settings (Patches' tab unless one is named).
    rt.actions.register('app.settings', () => openSettings(rt, 'patches'), { label: 'Settings' });
    rt.actions.register('patches.settings', ([app, tab]) => openSettings(rt, isSettingsApp(app) ? app : 'patches', tab || undefined), { label: 'Settings for an app', params: true });
    // From a tab's context menu: the payload is the tab (view) id.
    rt.actions.register('patches.settings.here', (_a, ctx) => openSettings(rt, isSettingsApp(ctx?.payload) ? ctx.payload : 'patches'), { label: 'Settings for this app' });
    rt.actions.register('patches.reload', () => { const v = rt.getState().view; if (TABS.some((t) => t.id === v)) bump(v); else rt.toast('Pick a tab first.', 'info', 'Reload'); }, { label: 'Reload the tab in front' });
    rt.actions.register('patches.open', () => {
      const t = TABS.find((x) => x.id === rt.getState().view);
      if (!t) return rt.toast('Pick a tab first.', 'info', 'Open');
      window.open(`${tabOrigin(t, t.key ? rt.settings.get(t.key) : null)}${t.path}`, '_blank', 'noopener');
    }, { label: 'Open the tab in front in a new tab' });
    rt.actions.register('patches.menu', ([tab, id]) => runGuestItem(rt, tab ?? '', id ?? ''), { label: 'Run an item of a tab app\'s menu', params: true, searchable: false });
    rt.actions.register('patches.plugins.fix', () => { for (const t of TABS) void installMissing(t); }, { label: 'Install the apps’ missing plugins in Patches' });
    rt.actions.register('patches.plugins', () => openSettings(rt, 'patches', 'connections'), { label: 'Plugins in Patches' });
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
  settingsPanels: [{ id: 'patches.plugins', tab: 'connections', title: 'Plugins', icon: 'package', order: 6, render: () => <PluginsPanel /> }],
  // The settings hook in the context menu, on every target Patches draws (banner, tabs, the settings page).
  contextMenu: [
    { id: 'patches.ctx', target: 'default', order: 1, items: [{ id: 'patches.settings', label: 'Settings', icon: 'settings', action: 'app.settings' }, { id: 'patches.reload', label: 'Reload the tab in front', icon: 'refresh', action: 'patches.reload' }] },
    { id: 'patches.ctx.canvas', target: 'canvas', order: 1, items: [{ id: 'patches.settings', label: 'Settings', icon: 'settings', action: 'app.settings' }] },
    { id: 'patches.ctx.tab', target: 'nav-item', order: 1, items: [{ id: 'patches.settings.tab', label: 'Settings for this app', icon: 'settings', action: 'patches.settings.here' }, { id: 'patches.settings', label: 'Settings', icon: 'settings', action: 'app.settings' }] },
  ],
  slots: {
    'app.frame.head': [{ id: 'patches.tabs', order: 10, render: () => <AppTabs /> }],
    'app.frame.top': [{ id: 'patches.strip', order: 10, render: () => <BannerStrip /> }],
    // Patches' own Systems check entry (missing plugins), above the console's banners in the strip.
    'app.frame.banners': [{ id: 'patches.plugins-check', order: 5, render: () => <PluginsCheck /> }],
  },
};
