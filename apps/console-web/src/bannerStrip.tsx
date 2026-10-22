/**
 * Banners in Patches (Brett, Oct 21 2026): standalone, the console shows its plugin banners as it always did. Inside
 * Patches the console tab shows none of them ("keep console the way it was unless running inside Patches"); Patches
 * shows them above every tab instead, through this banner strip.
 *
 * - `?axf-strip=banners` is the banner strip: the same console app, but the page is only the plugin banners
 *   (slot app.frame.banners), nothing else. Patches shows it in a web view above every tab, so the banners are on
 *   screen whichever app (Console, Pilot, axHub) is in front.
 * - The strip talks to Patches through `window.AxfPatchesStrip` (Patches' JS bridge, present only in its strip web
 *   view): `height(px)` as the banners grow and shrink, `open("console")` when a banner asks for a console view or
 *   dialog. What the banner asked for (an action a tap dispatches, a dialog, a view) goes to the Console tab over a
 *   same-origin BroadcastChannel (storage event as a fallback); the Console tab runs it only while it is embedded in
 *   Patches. Dialogs and views never open inside the strip (it is a few lines tall).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FrameBanners, useAxfState, useRuntime } from './axf/react';

export const STRIP_QUERY = 'axf-strip';
const RELAY_CHANNEL = 'axf-console-banner-actions';
const RELAY_KEY = 'axf:banner-action';
/** The host app the strip and the Console tab run in. */
const PATCHES = 'patches';
const MAX_ACTION = 300;

interface StripBridge { height?: (px: number) => void; open?: (tab: string) => void }
/**
 * Patches on Android gives the strip a JS bridge (`AxfPatchesStrip`); Patches on the web shows it in a frame and
 * listens for `patches-strip@1` messages instead (apps/patches-web). Either way the strip only reports its height and
 * asks for the Console tab.
 */
const bridge = (): StripBridge | null => {
  const g = globalThis as unknown as { AxfPatchesStrip?: StripBridge; parent?: Window };
  if (g.AxfPatchesStrip) return g.AxfPatchesStrip;
  if (!g.parent || g.parent === (globalThis as unknown)) return null;
  const post = (m: Record<string, unknown>) => { try { g.parent!.postMessage({ $axf: 'patches-strip@1', ...m }, '*'); } catch { /* no host */ } };
  return { height: (px) => post({ type: 'height', px }), open: (tab) => post({ type: 'open', tab }) };
};

/** This page is the banner strip (`?axf-strip=banners`). Fixed for the page's life. */
export const isBannerStrip = (() => {
  try { return new URLSearchParams(globalThis.location?.search ?? '').get(STRIP_QUERY) === 'banners'; } catch { return false; }
})();

/** Whether the console page shows the plugin banners: yes on its own, no as a tab in Patches (Patches' strip shows them). */
export function useBannersInConsole(): boolean {
  const rt = useRuntime();
  return rt.embedded?.host !== PATCHES;
}

/** What the strip hands to the Console tab: an action a tap dispatched, a dialog, or a view. */
type Relayed = { kind: 'action'; action: string } | { kind: 'dialog'; id: string; props?: Record<string, unknown> } | { kind: 'view'; view: string };

/** Sends what a banner asked for to the Console tab (same origin) and asks Patches to bring that tab to the front. */
function relay(what: Relayed): void {
  const msg = { ...what, at: Date.now() };
  try { const ch = new BroadcastChannel(RELAY_CHANNEL); ch.postMessage(msg); ch.close(); } catch { /* no BroadcastChannel */ }
  try { localStorage.setItem(RELAY_KEY, JSON.stringify(msg)); } catch { /* storage off */ }
  try { bridge()?.open?.('console'); } catch { /* not in Patches */ }
}

const short = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ACTION;

/** Console side of the relay: runs what the strip sends, only while this console is a tab in Patches. */
export function useBannerRelay(): void {
  const rt = useRuntime();
  useEffect(() => {
    if (isBannerStrip || rt.embedded?.host !== PATCHES) return;
    let last = 0;
    const run = (raw: unknown) => {
      const m = raw as { kind?: unknown; action?: unknown; id?: unknown; props?: unknown; view?: unknown; at?: unknown } | null;
      if (!m || typeof m !== 'object') return;
      const at = typeof m.at === 'number' ? m.at : 0;
      if (at && at <= last) return; // the same message through both carriers
      if (m.kind === 'action' && short(m.action)) rt.dispatch(m.action);
      else if (m.kind === 'dialog' && short(m.id)) rt.openDialog(m.id, m.props && typeof m.props === 'object' ? (m.props as Record<string, unknown>) : undefined);
      else if (m.kind === 'view' && short(m.view)) rt.navigate(m.view);
      else return;
      last = at || Date.now();
    };
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(RELAY_CHANNEL); ch.onmessage = (e) => run(e.data); } catch { ch = null; }
    const onStorage = (e: StorageEvent) => { if (e.key === RELAY_KEY && e.newValue) { try { run(JSON.parse(e.newValue)); } catch { /* not ours */ } } };
    globalThis.addEventListener('storage', onStorage);
    return () => { ch?.close(); globalThis.removeEventListener('storage', onStorage); };
  }, [rt]);
}

const patched = new WeakSet<object>();
/**
 * The strip page for its whole life: taps go to the Console tab (dispatches the libraries make while loading stay
 * here); dialogs and views always go there, an approval opening by itself included, since the strip is too small.
 */
function patchStrip(rt: ReturnType<typeof useRuntime>): void {
  if (patched.has(rt)) return;
  patched.add(rt);
  document.documentElement.classList.add('axf-strip-page');
  type Fns = Pick<typeof rt, 'dispatch' | 'openDialog' | 'navigate'>;
  const own = rt as unknown as Fns;
  const dispatch = rt.dispatch.bind(rt) as (...a: unknown[]) => unknown;
  const active = () => (navigator as unknown as { userActivation?: { isActive?: boolean } }).userActivation?.isActive === true;
  own.dispatch = ((action: string, ...rest: unknown[]) => {
    if (typeof action === 'string' && active()) { relay({ kind: 'action', action }); return; }
    return dispatch(action, ...rest);
  }) as Fns['dispatch'];
  own.openDialog = ((id: string, props?: Record<string, unknown>) => { relay({ kind: 'dialog', id, props }); }) as Fns['openDialog'];
  own.navigate = ((view: string) => { relay({ kind: 'view', view }); }) as Fns['navigate'];
}

/** The strip page: only the plugin banners. Reports its height to Patches as it changes. */
export function BannerStrip() {
  const rt = useRuntime();
  const state = useAxfState();
  const box = useRef<HTMLDivElement>(null);
  // A developer app waits for axHub's look first; until then the strip stays empty (Patches shows the hub's waiting screen in the tabs).
  const waiting = Boolean(state.appearance && state.appearance.status !== 'ready');
  // Before any banner renders (their effects run before this component's), so nothing they open lands in the strip.
  useState(() => { patchStrip(rt); return true; });
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
  return (
    <div ref={box} className="axf-banner-strip" data-axf-embed={rt.embedded?.host}>
      {!waiting && <FrameBanners />}
    </div>
  );
}
