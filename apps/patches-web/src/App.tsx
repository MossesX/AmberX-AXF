import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppShell, bannerSlotDefs, FRAME_BANNERS_SLOT, FrameBanners, SlotsProvider, installLibraries, useAxfState, useBannerPrefsTick, useRuntime, type AxfWebLibrary, type ViewMap } from './axf/react';
import { library as settingsLibrary } from './axf/libs/settings';
import { dialogs } from './dialogs';
import { api, type Me } from './api';
import { AppTab, CombinedSettings, enabledOwnPlugins, installOwnPlugins, loadPlugins, patchesLibrary, relayToTab, useAppMessages, usePluginsView } from './patchesLibrary';
import { BANNERS_KEY, isStripPage, TABS } from './patches';
import { BANNER_PLUGINS, loadBannerPlugins, relayUnknown, setKnownViews, type Relay } from './bannerPlugins';

/** The access policy a signed-in hub account is bound to (framework starter uac-policy/hub-accounts). */
export const POLICY = 'hub-accounts';

/**
 * Patches' views: one per app (frames, kept alive: switching tabs never reloads an app) and the combined Settings
 * (Patches · Banners · Console · Pilot · axHub). The nav-menu asset `patches-tabs` shows the three app tabs.
 */
const views: ViewMap = {
  ...Object.fromEntries(TABS.map((t) => [t.id, { title: t.label, icon: t.icon, render: () => <AppTab id={t.id} /> }])),
  settings: { title: 'Settings', icon: 'settings', keywords: ['patches', 'console', 'pilot', 'axhub', 'preferences'], render: () => <CombinedSettings /> },
};
const KEEP = [...TABS.map((t) => t.id), 'settings'];

/** This page is the banner strip Patches on Android shows above its tabs (`?axf-strip=banners`). Fixed for the page's life. */
const STRIP = isStripPage(globalThis.location?.search ?? '');

/** Patches on Android gives the strip a JS bridge; in a browser there is none. */
interface StripBridge { height?: (px: number) => void; open?: (tab: string) => void; relay?: (json: string) => void; approval?: (id: string) => void }
const bridge = (): StripBridge | null => (globalThis as unknown as { AxfPatchesStrip?: StripBridge }).AxfPatchesStrip ?? null;

/** lib-settings (its view is Patches' tab of the combined settings) + Patches itself (installed last: its hooks win). */
const base: AxfWebLibrary[] = [settingsLibrary, patchesLibrary];

/** The banner plugins switched on in Patches, loaded (their web parts load only when on). */
function useBannerLibraries(relay: Relay): AxfWebLibrary[] {
  const rt = useRuntime();
  const v = usePluginsView();
  const [libs, setLibs] = useState<AxfWebLibrary[]>([]);
  // install the banner plugins Patches has but its list doesn't (each starts on), then read the list
  useEffect(() => { void installOwnPlugins().then(() => loadPlugins(true)); }, []);
  const on = enabledOwnPlugins(v.state);
  const key = on.map((p) => p.folder).join(',');
  useEffect(() => {
    let live = true;
    void loadBannerPlugins(rt, on, relay).then((l) => { if (live) setLibs(l); });
    // a plugin switched off: its settings and anything it attached go with it
    for (const p of BANNER_PLUGINS) if (!on.includes(p)) { rt.settings.removeModule(p.manifest.id); rt.detachAll(p.manifest.id); }
    return () => { live = false; };
  }, [rt, key]);
  return libs;
}

export function App() {
  const rt = useRuntime();
  useAxfState();
  // A banner tap that names something only the console has goes to the Console tab (or, in the strip, through Android).
  const relay = useMemo<Relay>(() => (kind, target) => {
    const b = STRIP ? bridge() : null;
    if (b?.relay) { try { b.relay(JSON.stringify({ $axf: 'embed@1', type: 'relay', kind, target })); b.open?.('console'); } catch { /* bridge gone */ } return; }
    relayToTab(rt, 'console', kind, target);
  }, [rt]);
  useState(() => { relayUnknown(rt, relay); return true; });
  const libs = useBannerLibraries(relay);
  const contributed = useMemo(() => installLibraries(rt, [...base, ...libs]), [rt, libs]);
  const allViews: ViewMap = { ...contributed.views, ...views };
  setKnownViews((view) => view in allViews || view === 'banners');
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { void api<Me>('/me').then((r) => setMe(r.data)); }, []);
  // Behind the wall the hub account decides the role (admin | themes | user); without it nothing is bound.
  useEffect(() => {
    if (me?.wall && me.user && me.role) rt.bindPrincipal({ id: me.user.name, label: me.user.name, policy: POLICY, role: me.role, attributes: { via: me.user.via } });
    else rt.unbindPrincipal();
  }, [rt, me]);
  useAppMessages();
  // The banner plugins' banners, framed by Banner settings (right-click / long-press → its look, behaviour and settings).
  const prefs = useBannerPrefsTick();
  const shown = rt.settings.get(BANNERS_KEY) !== false;
  const slots = useMemo(() => {
    const framed = bannerSlotDefs(rt, contributed.banners, shown ? contributed.banners : []);
    return { ...contributed.slots, [FRAME_BANNERS_SLOT]: [...(contributed.slots[FRAME_BANNERS_SLOT] ?? []), ...framed] };
  }, [rt, contributed, shown, prefs]);
  if (STRIP) return <SlotsProvider slots={slots}><Strip /></SlotsProvider>;
  // Page order: Patches' banner, the app tabs (app.frame.head), the menu bar, the banners (app.frame.banners), then the
  // app in the tab.
  return (
    <SlotsProvider slots={slots}>
      <AppShell views={allViews} dialogs={{ ...contributed.dialogs, ...dialogs }} tabs={contributed.tabs} keep={KEEP} />
    </SlotsProvider>
  );
}

/**
 * The strip page: only the banners, for Patches on Android (above its native tabs). Reports its height as it changes;
 * a view, dialog or console action a banner asks for goes to the Console tab through the bridge (the strip is a few
 * lines tall: nothing opens inside it).
 */
function Strip() {
  const rt = useRuntime();
  const state = useAxfState();
  const box = useRef<HTMLDivElement>(null);
  const waiting = Boolean(state.appearance && state.appearance.status !== 'ready');
  useState(() => {
    const own = rt as unknown as { openDialog: (id: string, props?: Record<string, unknown>) => void };
    // An approval opening by itself stays quiet here (Patches' notifications carry it); a tapped one opens in the AXHub
    // phone app (or the axHub tab). Any other dialog belongs to the console: it goes to the Console tab.
    const tapped = () => (navigator as unknown as { userActivation?: { isActive?: boolean } }).userActivation?.isActive === true;
    own.openDialog = (id, props) => {
      try {
        if (id === 'approvals.review') { if (tapped() && typeof props?.id === 'string') bridge()?.approval?.(props.id); return; }
        bridge()?.relay?.(JSON.stringify({ $axf: 'embed@1', type: 'relay', kind: 'dialog', target: id }));
        bridge()?.open?.('console');
      } catch { /* bridge gone */ }
    };
    document.documentElement.classList.add('axf-strip-page');
    return true;
  });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let sent = -1;
    const report = () => {
      const px = Math.ceil(el.getBoundingClientRect().height);
      if (px === sent) return;
      sent = px;
      try { bridge()?.height?.(px); } catch { /* not in Patches */ }
    };
    report();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [waiting]);
  return <div ref={box} className="pt-strip-page">{!waiting && <FrameBanners />}</div>;
}
