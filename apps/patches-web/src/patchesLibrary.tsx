/**
 * Patches' own library (web): the three app tabs (frames kept alive), the banner strip above them, the combined
 * Settings (one tab per app), the settings hook in the application menu + the context menu, and the actions behind them.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon, useAxfState, useRuntime, type AxfWebLibrary } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import type { AxfRuntime } from './axf/core';
import {
  BANNERS_KEY, SETTINGS_APPS, SETTINGS_APP_KEY, TABS, fromApp, isSettingsApp, openTabMessage, parseStripMessage,
  settingsUrl, stripUrl, tabOrigin, tabUrl, type PatchTab, type SettingsApp,
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
function AppSettings({ t, active, tab, at }: { t: PatchTab; active: boolean; tab?: string; at: number }) {
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
  return <div ref={ref} className="pt-settings__page" hidden={!active}><Frame tab={t} src={settingsUrl(t, origin)} kind="settings" title={`${t.label} settings`} /></div>;
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
      if (!f || f.kind === 'strip') return;
      // Believed only from the frame it came from, at that frame's own origin.
      const origin = tabOrigin(f.tab, f.tab.key ? rt.settings.get(f.tab.key) : null);
      if (e.origin !== origin) return;
      const m = fromApp(e.data);
      if (!m) return;
      if (m.type === 'open-settings') openSettings(rt, f.tab.id, m.tab);
      else if (m.type === 'notify') rt.toast(m.body ?? m.title, m.level === 'error' ? 'danger' : m.level === 'warning' ? 'warning' : m.level === 'success' ? 'success' : 'info', `${f.tab.label}: ${m.title}`);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [rt]);
}

/* ---------------- the library ---------------- */

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
  // The settings hook in the context menu, on every target Patches draws (banner, tabs, the settings page).
  contextMenu: [
    { id: 'patches.ctx', target: 'default', order: 1, items: [{ id: 'patches.settings', label: 'Settings', icon: 'settings', action: 'app.settings' }, { id: 'patches.reload', label: 'Reload the tab in front', icon: 'refresh', action: 'patches.reload' }] },
    { id: 'patches.ctx.canvas', target: 'canvas', order: 1, items: [{ id: 'patches.settings', label: 'Settings', icon: 'settings', action: 'app.settings' }] },
    { id: 'patches.ctx.tab', target: 'nav-item', order: 1, items: [{ id: 'patches.settings.tab', label: 'Settings for this app', icon: 'settings', action: 'patches.settings.here' }, { id: 'patches.settings', label: 'Settings', icon: 'settings', action: 'app.settings' }] },
  ],
  slots: { 'app.frame.top': [{ id: 'patches.strip', order: 10, render: () => <BannerStrip /> }] },
};
