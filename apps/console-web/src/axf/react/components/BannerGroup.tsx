/*
 * The banner group (Brett, Oct 23 2026): when more than one banner is showing, every banner is wrapped in one group with a
 * thin title bar. The framework draws the one wrapper around the app.frame.banners slot, so however many banner plugins
 * are installed, only one wrapper is ever applied (never one per plugin). The title bar folds the group, and undocks it
 * into a floating window that is dragged by its title bar, resized from its corner and scrolls inside itself; docking puts
 * it back above the page. Where it sits is one setting, `axf.banners.group`, remembered per app like every other setting.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { useRuntime } from '../AxfProvider';
import { IconButton } from './Controls';

export const BANNER_GROUP_KEY = 'axf.banners.group';

export interface BannerGroupState {
  /** Undocked into a floating window. */
  floating: boolean;
  /** Folded to its title bar. */
  folded: boolean;
  /** Floating window position and size, in CSS pixels (size 0 = its natural size). */
  x: number; y: number; w: number; h: number;
}

const DEFAULT: BannerGroupState = { floating: false, folded: false, x: 24, y: 72, w: 0, h: 0 };
const MIN_W = 220;
const MIN_H = 60;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);

/** Reads the saved state; anything missing or malformed falls back to the default. */
export function parseBannerGroup(v: unknown): BannerGroupState {
  if (!v || typeof v !== 'object') return DEFAULT;
  const o = v as Record<string, unknown>;
  return {
    floating: o.floating === true,
    folded: o.folded === true,
    x: num(o.x, DEFAULT.x), y: num(o.y, DEFAULT.y),
    w: Math.max(0, num(o.w, 0)), h: Math.max(0, num(o.h, 0)),
  };
}

/** Keeps a floating window reachable: its title bar always inside the viewport, its size within it. */
export function clampBannerGroup(s: BannerGroupState, vw: number, vh: number): BannerGroupState {
  const w = s.w ? Math.min(Math.max(s.w, MIN_W), Math.max(MIN_W, vw)) : 0;
  const h = s.h ? Math.min(Math.max(s.h, MIN_H), Math.max(MIN_H, vh)) : 0;
  const shownW = w || MIN_W;
  return { ...s, w, h, x: Math.min(Math.max(s.x, 0), Math.max(0, vw - Math.min(shownW, 80))), y: Math.min(Math.max(s.y, 0), Math.max(0, vh - 28)) };
}

function useGroupState(): [BannerGroupState, (next: BannerGroupState) => void] {
  const rt = useRuntime();
  const sub = useCallback((fn: () => void) => rt.settings.onChange(BANNER_GROUP_KEY, fn), [rt]);
  const get = useCallback(() => rt.settings.get(BANNER_GROUP_KEY), [rt]);
  const raw = useSyncExternalStore(sub, get, get);
  const set = useCallback((next: BannerGroupState) => rt.settings.set(BANNER_GROUP_KEY, next as never), [rt]);
  return [parseBannerGroup(raw), set];
}

/** How many banners are on screen now: frames that aren't hidden and drew something (an idle banner draws nothing). */
function useShownCount(ref: RefObject<HTMLElement | null>): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const count = () => setN(Array.from(el.querySelectorAll<HTMLElement>('.fx-banner-frame')).filter((f) => !f.hidden && f.childElementCount > 0).length);
    count();
    const obs = new MutationObserver(count);
    obs.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    return () => obs.disconnect();
  }, [ref]);
  return n;
}

export function BannerGroup({ children }: { children: ReactNode }) {
  const [state, save] = useGroupState();
  const bodyRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const shown = useShownCount(bodyRef);
  // Live position while dragging (saved once on release, so a drag isn't a stream of settings writes).
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const floating = state.floating && shown > 0;
  const grouped = shown > 1 || floating;
  const view = floating ? clampBannerGroup(state, window.innerWidth, window.innerHeight) : state;

  // Remember the size the person resized the floating window to (CSS resize handle in its corner): the size before and
  // after a press on the window; a changed size is saved once.
  const sizeAtDown = useRef<{ w: number; h: number } | null>(null);
  const onWinDown = () => { const el = winRef.current; if (floating && el) sizeAtDown.current = { w: el.offsetWidth, h: el.offsetHeight }; };
  const onWinUp = () => {
    const el = winRef.current, before = sizeAtDown.current;
    sizeAtDown.current = null;
    if (!floating || !el || !before || state.folded) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (Math.abs(w - before.w) > 2 || Math.abs(h - before.h) > 2) save({ ...state, w, h });
  };

  const onTitleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!floating || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const start = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = { x: start.x, y: start.y };
    const move = (ev: PointerEvent) => {
      const c = clampBannerGroup({ ...view, x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py }, window.innerWidth, window.innerHeight);
      last = { x: c.x, y: c.y };
      setDrag(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (last.x !== start.x || last.y !== start.y) save({ ...state, x: last.x, y: last.y });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const pos = drag ?? { x: view.x, y: view.y };
  const style = floating
    ? { left: pos.x, top: pos.y, width: view.w || undefined, height: state.folded ? undefined : view.h || undefined }
    : undefined;

  return (
    <div
      ref={winRef}
      className="fx-banner-group"
      data-grouped={grouped ? 'on' : undefined}
      data-floating={floating ? 'on' : undefined}
      data-folded={grouped && state.folded ? 'on' : undefined}
      style={style}
      onPointerDown={onWinDown}
      onPointerUp={onWinUp}
    >
      {grouped && (
        <div className="fx-banner-group__bar" onPointerDown={onTitleDown} data-dragging={drag ? 'on' : undefined}>
          <span className="fx-banner-group__title">Banners · {shown}</span>
          <IconButton
            icon={state.folded ? 'chevron-down' : 'chevron-up'}
            label={state.folded ? 'Show the banners' : 'Fold the banners'}
            size={12}
            onClick={() => save({ ...state, folded: !state.folded })}
          />
          <IconButton
            icon={floating ? 'minimize' : 'external'}
            label={floating ? 'Dock the banners above the page' : 'Undock into a floating window'}
            size={12}
            onClick={() => save({ ...state, floating: !floating, folded: false })}
          />
        </div>
      )}
      <div ref={bodyRef} className="fx-banner-group__body" hidden={grouped && state.folded}>{children}</div>
    </div>
  );
}
