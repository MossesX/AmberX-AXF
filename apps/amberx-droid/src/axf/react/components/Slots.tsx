/*
 * Named extension points: a view renders <Slot name="plan.top" props={{ … }} />, libraries and plugins contribute
 * content through AxfWebLibrary.slots. A slot with nothing contributed renders nothing, so a plugin can add a box
 * to a view without the view knowing it (and leaves nothing behind when it's removed).
 */
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { SlotDef } from '../library';
import { BannerGroup } from './BannerGroup';
import { HiddenBannersNote } from './BannerSettings';

const SlotsCtx = createContext<Record<string, SlotDef[]>>({});

export function SlotsProvider({ slots, children }: { slots: Record<string, SlotDef[]>; children: ReactNode }) {
  return <SlotsCtx.Provider value={slots}>{children}</SlotsCtx.Provider>;
}

export function Slot({ name, props = {} }: { name: string; props?: Record<string, unknown> }) {
  const defs = useContext(SlotsCtx)[name] ?? [];
  if (!defs.length) return null;
  return <>{defs.map((d) => <Fragment key={d.id}>{d.render(props)}</Fragment>)}</>;
}

export const useSlotFilled = (name: string) => (useContext(SlotsCtx)[name]?.length ?? 0) > 0;

/** Slot for banners above the whole page (`app.frame.banners`): above app.frame.top (a plugin's page-wide bar), so they stay
 * visible while a plugin covers the page. Contributed banners render nothing when idle; then the box collapses. */
export const FRAME_BANNERS_SLOT = 'app.frame.banners';
export function FrameBanners() {
  const filled = useSlotFilled(FRAME_BANNERS_SLOT);
  const empty = useStripEmpty();
  if (!filled) return null;
  // One wrapper for every banner, whichever plugins drew them: the banner group (title bar, fold, undock) once 2+ show.
  return <div ref={empty.ref} className="fx-frame-banners" data-fx-empty={empty.on ? 'on' : undefined} data-fx-ctx-ignore="" onClickCapture={revealExpanded}><BannerGroup><Slot name={FRAME_BANNERS_SLOT} /></BannerGroup><HiddenBannersNote /></div>;
}

/**
 * Whether the banner strip has nothing to show (Brett, Oct 27 2026: removing the last item from a banner left an empty
 * strip at the top). The strip always holds the banner group's wrapper, so CSS `:empty` never matched; instead it's empty
 * when every banner frame is hidden or drew nothing and nothing else (a hide note, an app's own banner) is in it. Watched
 * live, so the strip collapses the moment the last banner goes idle and comes back when one draws again.
 */
export function stripHasContent(strip: Element): boolean {
  const group = strip.querySelector(':scope > .fx-banner-group');
  const body = group?.querySelector(':scope > .fx-banner-group__body');
  for (const el of Array.from(strip.children)) if (el !== group) return true; // a note under the banners
  for (const el of Array.from(body?.children ?? [])) {
    if (!el.classList.contains('fx-banner-frame')) return true; // an app's own banner, or a quick-hide note
    if (!(el as HTMLElement).hidden && el.childElementCount > 0) return true;
  }
  return false;
}

function useStripEmpty() {
  const [on, setOn] = useState(false);
  const obs = useRef<MutationObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    const check = () => setOn(!stripHasContent(el));
    check();
    obs.current = new MutationObserver(check);
    obs.current.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  }, []);
  useEffect(() => () => obs.current?.disconnect(), []);
  return { ref, on };
}

/**
 * Tapping a banner item opens its details (Brett, Oct 25 2026: "the banner items expand with details, go back to what
 * they used to do"). The banners share one strip capped at part of the screen, so with several banners up the details
 * opened below the visible part and the tap looked like it did nothing. After a tap that opens something
 * (aria-expanded false → true), the opened item is scrolled into view inside the strip (and any scrolling list it sits
 * in), top first when it is taller than the space.
 */
function revealExpanded(e: MouseEvent<HTMLDivElement>) {
  const btn = (e.target as Element).closest?.('[aria-expanded]');
  if (!btn || btn.getAttribute('aria-expanded') !== 'false' || !e.currentTarget.contains(btn)) return;
  const strip = e.currentTarget;
  // After React has drawn the details (two frames: the click's update, then layout).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!btn.isConnected || btn.getAttribute('aria-expanded') !== 'true') return;
    const item = btn.closest('li') ?? btn.parentElement ?? btn;
    const tall = item.getBoundingClientRect().height > strip.clientHeight;
    item.scrollIntoView({ block: tall ? 'start' : 'nearest', inline: 'nearest', behavior: 'smooth' });
  }));
}
