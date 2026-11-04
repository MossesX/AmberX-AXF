/**
 * The banner strip page and its follower (framework/react/bannerStrip.ts has the contract).
 *
 * `BannerStripPage` is what an app draws when a host asks for its banner strip (embed@1 page `view:axf-banners`; AppShell
 * picks it): the widgets its plugins attach to its banner bar (or, when the host asks for `bar`, the whole banner bar: its
 * banner asset in force with its logo and attachments, so the host's top banner is this app's), then its banners exactly
 * as on its own page (the app.frame.banners slot, Banner settings, colours, order; always docked). It tells the host how tall it is, asks for the whole window
 * while a dialog / menu / popover it opened is up, and sends a view a banner item opened to the app's own frame.
 *
 * `useBannerStripFollower` runs in the app's own frame inside the same host: it opens those views.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BadgeData } from '../../core/types';
import type { AxfRuntime } from '../../core/runtime';
import { useAxfState, useRuntime } from '../AxfProvider';
import { BANNER_STRIP_CHANNEL, BANNER_STRIP_MESSAGE, parseBannerStripChannel, parseBannerStripMessage, type BannerStripChannelMessage, type BannerStripMessage } from '../bannerStrip';
import { Banner, BannerBadge } from './Banner';
import { bannerLabel, bannerPrefs, setBannerPrefs, useBannerPrefsTick, useKnownBanners } from './BannerSettings';
import { FrameBanners } from './Slots';
import { WidgetView } from './Widgets';

/** Anything the strip opened that draws outside it (the framework's dialogs, menus, toasts, windows; a plugin's portal). */
const OVERLAY = '.fx-backdrop, [role="dialog"], [role="menu"], [role="listbox"], .fx-toast, .fx-window, [data-fx-overlay]';
/** A view handed to the app's frame is sent again when that frame says hello within this long (it was still loading). */
const RESEND_MS = 30000;

const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

/** Does something need more than the strip's own box right now? */
function needsWindow(strip: HTMLElement): boolean {
  const sb = strip.getBoundingClientRect();
  for (const el of Array.from(document.querySelectorAll(OVERLAY))) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (!strip.contains(el) || r.bottom > sb.bottom + 1 || r.top < sb.top - 1) return true;
  }
  // portals straight into <body> (plugin menus and popovers)
  for (const el of Array.from(document.body.children)) {
    if (el.id === 'root' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
    if (shown(el)) return true;
  }
  return false;
}

const toHost = (m: BannerStripMessage) => { if (window.parent !== window) window.parent.postMessage(m, '*'); };

/** The widgets plugins attach to the app's banner bar (bell, badges, chips); the host draws its own bar's widgets. */
function StripWidgets() {
  const rt = useRuntime();
  useAxfState();
  const list = rt.hostAttachments('banner').filter((a) => rt.registry.has(a.type as never, a.id));
  if (!list.length) return null;
  return (
    <div className="fx-banner fx-banner-strip__widgets" role="toolbar" aria-label="Banner widgets" data-fx-ctx-target="banner">
      <div className="fx-banner__side is-right">
        {list.map((a) => {
          const data = (rt.registry.get(a.type as never, a.id) as { data: unknown } | undefined)?.data;
          return <span key={`${a.type}:${a.id}`} className="fx-banner__item" data-axf-banner-item={`${a.type}:${a.id}`}>{a.type === 'badge' ? <BannerBadge data={data as BadgeData} /> : <WidgetView type={a.type} id={a.id} host="banner" />}</span>;
        })}
      </div>
    </div>
  );
}

export function BannerStripPage() {
  const rt = useRuntime();
  const ref = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState<{ top: number; left: number; width: number } | null>(null);
  // the host's top banner is this app's banner bar (host → strip `bar`): its banner asset in force, logo and attachments
  const [bar, setBar] = useState(false);
  const all = useKnownBanners();
  const prefsTick = useBannerPrefsTick();

  // the page behind the strip is see-through, so a dialog it opens sits over the host
  useLayoutEffect(() => {
    document.documentElement.dataset.axfStrip = 'on';
    return () => { delete document.documentElement.dataset.axfStrip; };
  }, []);

  // size + overlay → host
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let last = '';
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // `bar` only once the bar is really drawn (a hidden banner slot or no banner asset draws nothing: the host keeps its own)
        const drawn = !!el.querySelector(':scope > .fx-banner[role="banner"]');
        const m: BannerStripMessage = { $axf: BANNER_STRIP_MESSAGE, type: 'size', height: Math.ceil(el.getBoundingClientRect().height), overlay: needsWindow(el), ...(drawn ? { bar: true } : {}) };
        const key = `${m.height}:${m.overlay}:${drawn}`;
        if (key !== last) { last = key; toHost(m); }
      });
    };
    report();
    const ro = new ResizeObserver(report); ro.observe(el);
    const mo = new MutationObserver(report); mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'open'] });
    window.addEventListener('resize', report);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', report); };
  }, []);

  // the banner list → host (per-banner show / hide there)
  useEffect(() => {
    toHost({ $axf: BANNER_STRIP_MESSAGE, type: 'banners', banners: all.map((b) => ({ id: b.id, label: bannerLabel(b), ...(b.icon ? { icon: b.icon } : {}), hidden: bannerPrefs(rt, b.id).hideInHost })) });
  }, [all, prefsTick, rt]);

  // host → strip
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || window.parent === window) return;
      const m = parseBannerStripMessage(e.data); if (!m) return;
      if (m.type === 'inset') setInset(m.width > 0 ? { top: m.top, left: m.left, width: m.width } : null);
      else if (m.type === 'bar') setBar(m.on);
      else if (m.type === 'set-hidden') setBannerPrefs(rt, m.id, { hideInHost: m.hidden });
      else if (m.type === 'banners-request') toHost({ $axf: BANNER_STRIP_MESSAGE, type: 'banners', banners: all.map((b) => ({ id: b.id, label: bannerLabel(b), ...(b.icon ? { icon: b.icon } : {}), hidden: bannerPrefs(rt, b.id).hideInHost })) });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [rt, all]);

  // a banner item opened one of the app's views: open it in the app's own frame, and bring that frame on screen
  useEffect(() => forwardViews(rt), [rt]);

  return (
    <div ref={ref} className="fx-banner-strip" style={inset ? { marginTop: inset.top, marginLeft: inset.left, width: inset.width } : undefined}>
      {bar ? <Banner asHost /> : <StripWidgets />}
      {/* docked: the host's banner region is this strip; a floating group would be clipped inside its frame */}
      <FrameBanners docked />
    </div>
  );
}

function forwardViews(rt: AxfRuntime): () => void {
  const home = rt.getState().view;
  let last = home;
  let tab: string | undefined;
  let n = 0;
  let pending: { m: BannerStripChannelMessage; at: number } | null = null;
  const ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BANNER_STRIP_CHANNEL);
  if (ch) ch.onmessage = (e) => {
    const m = parseBannerStripChannel(e.data);
    if (m?.type === 'ack' && pending && pending.m.type === 'navigate' && pending.m.n === m.n) pending = null;
    else if (m?.type === 'hello' && pending && Date.now() - pending.at < RESEND_MS) ch.postMessage(pending.m);
  };
  const onTab = (e: Event) => { const d = (e as CustomEvent).detail; if (typeof d === 'string') tab = d; };
  window.addEventListener('axf:settings-tab', onTab);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = rt.subscribe(() => {
    const v = rt.getState().view;
    if (v === last) return;
    last = v;
    if (v === home) return;
    // after the action finishes (settings.open names its tab right after it navigates)
    clearTimeout(timer);
    timer = setTimeout(() => {
      const m: BannerStripChannelMessage = { type: 'navigate', view: v, ...(tab ? { tab } : {}), n: ++n };
      tab = undefined;
      pending = { m, at: Date.now() };
      ch?.postMessage(m);
      toHost({ $axf: BANNER_STRIP_MESSAGE, type: 'open', view: v });
      // back to where the strip started, so the same item opens the same view again next time
      last = home;
      rt.navigate(home);
    }, 0);
  });
  return () => { off(); clearTimeout(timer); window.removeEventListener('axf:settings-tab', onTab); ch?.close(); };
}

/** In the app's own frame inside a host: open the views its banner strip hands over. Standalone and in a page, nothing. */
export function useBannerStripFollower(): void {
  const rt = useRuntime();
  useEffect(() => {
    if (!rt.embedded || rt.embedded.page || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(BANNER_STRIP_CHANNEL);
    ch.onmessage = (e) => {
      const m = parseBannerStripChannel(e.data);
      if (m?.type !== 'navigate') return;
      if (m.tab) rt.dispatch(`settings.open:${m.tab}`); else rt.navigate(m.view);
      ch.postMessage({ type: 'ack', n: m.n } satisfies BannerStripChannelMessage);
    };
    ch.postMessage({ type: 'hello' } satisfies BannerStripChannelMessage);
    return () => ch.close();
  }, [rt]);
}
