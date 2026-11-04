/**
 * Menus that stay on screen and scroll when they don't fit (menu-fit@1, core/engines/menufit.ts; Brett, Nov 3 2026).
 *
 * The engine is pure; this file measures and applies it:
 *   - `menuViewBox()`  the room a menu may use: the visual viewport (so an open on-screen keyboard and pinch zoom
 *                      count), minus the safe-area insets and the layout asset's edge inset (--fx-layout-phone-edge)
 *   - `fitMenuEl()`    places one menu box (fixed drop-downs and context menus, absolute submenus) and caps its height;
 *                      the box's scroller (`.fx-menu__scroll`, or the box itself) then scrolls inside
 *   - `useMenuFit()`   keeps a framework menu fitted while it is open (its content changes, the window or keyboard
 *                      resizes, a parent menu scrolls) and keeps its scroll hints (`data-fx-more`) current
 *   - `installMenuFit()` fits every other menu box (plugins' ⋯ menus: `.fx-popover.fx-dropdown`, `.fx-popover[role=menu]`)
 *                      the moment it appears, so plugins inherit the behaviour without code changes
 *   - `focusMenuItem()` keyboard navigation: focus a row and scroll it into view (clear of the scroll hints)
 *
 * Sizes come from tokens: the edge inset from the layout asset, the hint height from density (axf.css). Only measured
 * values are written inline.
 */
import { useLayoutEffect, type RefObject } from 'react';
import { fitMenu, menuBox, type FitMode, type FitRect } from '../../core';

let probe: HTMLElement | null = null;
/** One hidden element that resolves the edge token and the safe-area insets to px. */
function probeEl(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (probe?.isConnected) return probe;
  probe = document.createElement('div');
  probe.className = 'fx-menu-probe';
  probe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(probe);
  return probe;
}

/** The room a menu may use, in the same coordinates as getBoundingClientRect. */
export function menuViewBox(): FitRect {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const de = typeof document !== 'undefined' ? document.documentElement : null;
  const view: FitRect = vv
    ? { left: vv.offsetLeft, top: vv.offsetTop, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height }
    : { left: 0, top: 0, right: de?.clientWidth ?? 0, bottom: de?.clientHeight ?? 0 };
  const p = probeEl();
  if (!p) return view;
  const cs = getComputedStyle(p);
  const insets = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  return menuBox(view, insets, p.offsetWidth - insets.left - insets.right);
}

const rectOf = (r: DOMRect | FitRect): FitRect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/** The box's natural height: its height now plus whatever its scrollers hide. */
function naturalHeight(el: HTMLElement): number {
  const scrollers = [el, ...Array.from(el.querySelectorAll<HTMLElement>(':scope > .fx-menu__scroll'))];
  return el.offsetHeight + scrollers.reduce((n, s) => n + Math.max(0, s.scrollHeight - s.clientHeight), 0);
}

/** The ancestor a fixed box is placed in when it isn't the viewport (a transform, filter or backdrop filter on the way up). */
function fixedContainer(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.transform !== 'none' || cs.filter !== 'none' || (cs.backdropFilter && cs.backdropFilter !== 'none') || cs.perspective !== 'none'
      || /paint|layout|strict|content/.test(cs.contain) || /transform|filter|perspective/.test(cs.willChange)) return p;
  }
  return null;
}

export interface FitOptions {
  /** keep the CSS's left/right (phones stretch drop-downs edge to edge) */
  stretch?: boolean;
}

/** Places a menu box next to `anchor` (viewport coordinates) and caps its height. */
export function fitMenuEl(el: HTMLElement, mode: FitMode, anchor: FitRect, opts: FitOptions = {}): void {
  const cs = getComputedStyle(el);
  const abs = cs.position === 'absolute';
  if (cs.position !== 'fixed' && !abs) { el.style.maxHeight = ''; el.removeAttribute('data-fx-flip'); return; } // inline submenus (phones)
  const mt = parseFloat(cs.marginTop) || 0, ml = parseFloat(cs.marginLeft) || 0;
  if (!opts.stretch) el.style.left = `${abs ? 0 : ml * -1}px`; // measured at the start so its width isn't squeezed
  const size = { width: el.offsetWidth, height: naturalHeight(el) };
  // a submenu's first row lines up with its parent row (its own padding above it) and sits just past the row's edge
  const pt = parseFloat(cs.paddingTop) || 0;
  const at = mode === 'side' ? { ...anchor, top: anchor.top - pt } : anchor;
  const r = fitMenu({ mode, anchor: at, size, box: menuViewBox(), gap: mode === 'side' ? pt / 2 : mt, stretch: opts.stretch });
  // absolute boxes (submenus) are placed inside their parent menu box; fixed ones in the viewport. Margins move the box.
  let ox = 0, oy = 0;
  const parent = abs ? (el.offsetParent as HTMLElement | null) : fixedContainer(el);
  if (parent) { const pr = parent.getBoundingClientRect(); ox = pr.left + parent.clientLeft; oy = pr.top + parent.clientTop; }
  const top = mode === 'side' ? r.top : r.top - mt;
  el.style.top = `${Math.round(top - oy)}px`;
  if (!opts.stretch) el.style.left = `${Math.round(r.left - ox - ml)}px`;
  el.style.maxHeight = `${r.maxHeight}px`;
  if (r.flip) el.setAttribute('data-fx-flip', r.flip); else el.removeAttribute('data-fx-flip');
  if (r.scroll) el.setAttribute('data-fx-scroll', ''); else el.removeAttribute('data-fx-scroll');
  updateMenuHints(el);
}

/** The element that scrolls inside a menu box. */
export const menuScroller = (el: HTMLElement): HTMLElement => el.querySelector<HTMLElement>(':scope > .fx-menu__scroll') ?? el;

/** Sets `data-fx-more` ("up", "down", "up down") on the box while there is more to scroll to. */
export function updateMenuHints(el: HTMLElement): void {
  const s = menuScroller(el);
  const more = [s.scrollTop > 1 ? 'up' : '', s.scrollTop + s.clientHeight < s.scrollHeight - 1 ? 'down' : ''].filter(Boolean).join(' ');
  if (more) el.setAttribute('data-fx-more', more); else el.removeAttribute('data-fx-more');
}

/** Scrolls a menu by most of its height (a tap on a scroll hint). */
export function scrollMenuBy(el: HTMLElement | null, dir: 1 | -1): void {
  if (!el) return;
  const s = menuScroller(el);
  s.scrollBy({ top: dir * Math.max(s.clientHeight * 0.8, 1), behavior: 'smooth' });
}

/** Keyboard navigation: focus a row and bring it into view inside its scrolling menu. */
export function focusMenuItem(el: HTMLElement | undefined | null): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: 'nearest' });
}

/**
 * Re-runs `fit` while a menu is open: content size changes (a live list fills in), window / keyboard / zoom changes,
 * and any scroll outside the menu (a parent menu scrolling moves a submenu's row). Scrolls inside it update its hints.
 */
function watchMenu(el: HTMLElement, fit: () => void): () => void {
  let frame = 0;
  const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (el.isConnected) fit(); }); };
  const onScroll = (e: Event) => {
    const t = e.target as Node | null;
    if (t && t !== document && el.contains(t)) updateMenuHints(el); else soon();
  };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon);
  ro?.observe(el);
  const sc = menuScroller(el);
  for (const c of Array.from(sc.children)) ro?.observe(c);
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { for (const c of Array.from(menuScroller(el).children)) ro?.observe(c); soon(); });
  mo?.observe(sc, { childList: true });
  const vv = window.visualViewport;
  window.addEventListener('resize', soon);
  vv?.addEventListener('resize', soon);
  vv?.addEventListener('scroll', soon);
  document.addEventListener('scroll', onScroll, true);
  el.addEventListener('animationend', soon);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    ro?.disconnect(); mo?.disconnect();
    window.removeEventListener('resize', soon);
    vv?.removeEventListener('resize', soon);
    vv?.removeEventListener('scroll', soon);
    document.removeEventListener('scroll', onScroll, true);
    el.removeEventListener('animationend', soon);
  };
}

/**
 * Keeps a framework menu box fitted while it is mounted. `anchor` is read on every fit (the row or button may move);
 * returning null leaves the box where the CSS puts it.
 */
export function useMenuFit(ref: RefObject<HTMLElement | null>, mode: FitMode, anchor: () => FitRect | DOMRect | null | undefined, opts: FitOptions = {}, deps: readonly unknown[] = []): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute('data-fx-fit', 'managed');
    const fit = () => { const a = anchor(); if (a) fitMenuEl(el, mode, rectOf(a), opts); };
    fit();
    return watchMenu(el, fit);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ---- every other menu box (plugins' ⋯ menus) ---- */

const AUTO = '.fx-popover.fx-dropdown:not([data-fx-fit]), .fx-popover[role="menu"]:not([data-fx-fit])';
const stops = new WeakMap<HTMLElement, () => void>();

/** The open menu button a self-placed menu hangs from: the expanded `aria-haspopup` control just above it. */
function guessAnchor(el: HTMLElement): FitRect {
  const r = el.getBoundingClientRect();
  const mt = parseFloat(getComputedStyle(el).marginTop) || 0;
  const top = r.top - mt;
  let best: FitRect | null = null;
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('[aria-haspopup][aria-expanded="true"]'))) {
    const br = b.getBoundingClientRect();
    if (Math.abs(br.bottom - top) <= 2 && (!best || br.right - br.left < best.right - best.left)) best = rectOf(br);
  }
  return best ?? { left: r.left, right: r.left, top, bottom: top };
}

function adopt(el: HTMLElement): void {
  if (stops.has(el)) return;
  el.setAttribute('data-fx-fit', 'auto');
  const anchor = guessAnchor(el);
  const fit = () => fitMenuEl(el, 'below', anchor);
  fit();
  stops.set(el, watchMenu(el, fit));
}

/** Fits every menu box that places itself (plugins' ⋯ menus) as it appears. Returns the remover. */
export function installMenuFit(root: HTMLElement = document.body): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const scan = (n: Node) => {
    if (!(n instanceof HTMLElement)) return;
    if (n.matches(AUTO)) adopt(n);
    for (const c of Array.from(n.querySelectorAll<HTMLElement>(AUTO))) adopt(c);
  };
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      m.addedNodes.forEach(scan);
      m.removedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        for (const el of [n, ...Array.from(n.querySelectorAll<HTMLElement>('[data-fx-fit="auto"]'))]) { stops.get(el)?.(); stops.delete(el); }
      });
    }
  });
  mo.observe(root, { childList: true, subtree: true });
  scan(root);
  return () => mo.disconnect();
}
