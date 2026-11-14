/**
 * Scroll control (console-control@1 `scroll` verb and `ScrollState`; spec/CONSOLE-CONTROL.md; build full-api-and-voice-control,
 * Nov 13 2026). The DOM half of the scroll contract: find the active or named scroll container, run up / down / page-up /
 * page-down / top / bottom / to-address with the pure maths in core/engines/console-control.ts (`scrollStep`), and report
 * the position and extent as `ScrollState`. Installed on the target registry by AxfProvider (`installScrollControl`), so
 * `scroll` and `state` on a `scroll:<id>` address, and `focus` (which reports the scroll after it moved), all read one source.
 *
 *   "scroll down"              → the active container (where the pointer last was, else the focused element's, else the main pane)
 *   scroll:main                → the main pane (`.fx-main`), registered by this module
 *   <div ref={useScrollContainer('log')} …>  → `scroll:log`, a named container a plugin offers (a log, a long list)
 *
 * The line height for page moves is the density row token (`--fx-dens-row-list`), measured in the container, so a page
 * keeps one row of overlap at every density. Reduced motion = instant moves.
 */
import { useCallback } from 'react';
import type { AxfRuntime } from '../core';
import { CONSOLE_CONTROL_WIRE, ConsoleControlError, scrollState, scrollStep, type ScrollSpec, type ScrollState } from '../core/engines/console-control';
import { controlRegistry, MAIN_SCROLL_ADDRESS, useControlTarget, type ControlScroller } from './controlTargets';
import { useOptionalRuntime } from './AxfProvider';

export const SCROLL_CONTAINER_ATTR = 'data-axf-scroll';
export const MAIN_SCROLL_ID = 'main';
/** The density token a page move keeps as overlap. */
export const SCROLL_LINE_TOKEN = '--fx-dens-row-list';
const MAIN_SELECTOR = '.fx-main';

let lastPointer: { x: number; y: number } | null = null;

/** Does this element scroll vertically (overflow allows it and there is more content than room)? */
export function isScrollable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el === document.scrollingElement) return el.scrollHeight > el.clientHeight;
  const o = getComputedStyle(el).overflowY;
  return (o === 'auto' || o === 'scroll' || o === 'overlay') && el.scrollHeight > el.clientHeight + 1;
}

/** The main pane's element (the visible one when several are kept), else the document. */
export function mainScrollElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const mains = Array.from(document.querySelectorAll<HTMLElement>(MAIN_SELECTOR)).filter((m) => m.offsetParent !== null || m === document.body);
  const main = mains[mains.length - 1] ?? document.querySelector<HTMLElement>(MAIN_SELECTOR);
  if (main && isScrollable(main)) return main;
  return (document.scrollingElement as HTMLElement | null) ?? main;
}

/** The nearest scrolling ancestor of `el` (itself included), else the main pane. */
export function scrollContainerOf(el: Element | null): HTMLElement | null {
  let cur: Element | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (isScrollable(cur)) return cur;
    cur = cur.parentElement;
  }
  return mainScrollElement();
}

/** The container a person means by "scroll down": under the pointer, else around the focused element, else the main pane. */
export function activeScrollContainer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (lastPointer) {
    const under = document.elementFromPoint(lastPointer.x, lastPointer.y);
    if (under) { const c = scrollContainerOf(under); if (c) return c; }
  }
  const focused = document.activeElement;
  if (focused && focused !== document.body) { const c = scrollContainerOf(focused); if (c) return c; }
  return mainScrollElement();
}

/** The address of a container: its `data-axf-scroll` id, `scroll:main` for the main pane, else `scroll:document`. */
export function scrollAddressOf(el: Element | null): string {
  if (!el) return MAIN_SCROLL_ADDRESS;
  const named = el.getAttribute(SCROLL_CONTAINER_ATTR);
  if (named) return `scroll:${named}`;
  if (el.matches(MAIN_SELECTOR) || el === document.scrollingElement) return MAIN_SCROLL_ADDRESS;
  const id = el.id || el.closest(`[${SCROLL_CONTAINER_ATTR}]`)?.getAttribute(SCROLL_CONTAINER_ATTR);
  return id ? `scroll:${id}` : 'scroll:document';
}

/** The state of a container, read from the DOM. */
export function scrollStateOf(el: Element | null): ScrollState {
  const c = el ?? mainScrollElement();
  if (!c) return scrollState(MAIN_SCROLL_ADDRESS, 0, 0, 0);
  return scrollState(scrollAddressOf(c), c.scrollTop, c.clientHeight, c.scrollHeight, c.scrollLeft);
}

/** One list row in px inside `el` (the density token), measured; falls back to a sixteenth of the view. */
export function lineHeightIn(el: HTMLElement): number {
  try {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:var(${SCROLL_LINE_TOKEN})`;
    el.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    if (h > 0) return h;
  } catch { /* no DOM */ }
  return Math.max(16, Math.round(el.clientHeight / 16));
}

/** The offset of `target` inside `container`'s content (what `scrollTop` would be with the target at the top). */
export function offsetWithin(container: HTMLElement, target: Element): number {
  const c = container.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  return t.top - c.top + container.scrollTop;
}

/** Run a scroll spec on a container (the active one when null); `to` is the element for `dir: 'to'`. Answers the state after the move. */
export function runScroll(spec: ScrollSpec, container: HTMLElement | null = null, to: Element | null = null): ScrollState {
  const c = container ?? (to ? scrollContainerOf(to) : activeScrollContainer());
  if (!c) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, 'nothing on this screen scrolls', { because: 'no scroll container' });
  const before = scrollStateOf(c);
  if (spec.dir === 'to' && to && !c.contains(to)) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.VALIDATION, `${scrollAddressOf(c)} does not contain the target`, { problems: ['scroll.to is outside the container'] });
  const targetTop = spec.dir === 'to' && to ? offsetWithin(c, to) + (to as HTMLElement).getBoundingClientRect().height / 2 : null;
  const next = scrollStep(before, spec, lineHeightIn(c), targetTop);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  c.scrollTo({ top: next, behavior: reduce ? 'auto' : 'smooth' });
  // smooth scrolling lands later: answer the position asked for, so a caller never reads the old one
  return scrollState(before.container, next, before.height, before.extent, before.left);
}

/** The scroller the target registry calls (controlTargets.ts → ControlScroller). */
export function domScroller(): ControlScroller {
  return {
    scroll: (spec, container, to) => runScroll(spec, container instanceof HTMLElement ? container : null, to),
    state: (container) => scrollStateOf(container ?? activeScrollContainer()),
    containerOf: (el) => (el ? scrollContainerOf(el) : activeScrollContainer()),
  };
}

/**
 * Install scroll control on a runtime: the scroller on its target registry, `scroll:main` as a target, and the pointer
 * tracker that decides which container "scroll down" means. AxfProvider calls it.
 */
export function installScrollControl(rt: AxfRuntime): () => void {
  const reg = controlRegistry(rt);
  reg.setScroller(domScroller());
  const offMain = reg.register({
    address: MAIN_SCROLL_ADDRESS, kind: 'scroll', label: 'Main pane', keywords: ['page', 'content', 'main'],
    element: () => mainScrollElement(), get: () => mainScrollElement()?.scrollTop ?? 0, state: () => ({ scroll: scrollStateOf(mainScrollElement()) }),
  });
  const onPointer = (e: PointerEvent) => { lastPointer = { x: e.clientX, y: e.clientY }; };
  const onLeave = () => { lastPointer = null; };
  if (typeof document !== 'undefined') {
    document.addEventListener('pointermove', onPointer, { passive: true, capture: true });
    document.addEventListener('pointerdown', onPointer, { passive: true, capture: true });
    document.addEventListener('pointerleave', onLeave, { passive: true });
  }
  return () => {
    offMain();
    reg.setScroller(null);
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointermove', onPointer, { capture: true });
      document.removeEventListener('pointerdown', onPointer, { capture: true });
      document.removeEventListener('pointerleave', onLeave);
    }
  };
}

/**
 * A named scroll container a component offers (`scroll:<id>`): the returned ref goes on the scrolling element. It carries
 * `data-axf-scroll="<id>"`, registers as a target (state = its ScrollState, scroll = runs on it) and composes under the scope.
 */
export function useScrollContainer(id: string, label?: string): (el: HTMLElement | null) => void {
  const rt = useOptionalRuntime();
  const find = () => (typeof document === 'undefined' ? null : document.querySelector(`[${SCROLL_CONTAINER_ATTR}="${id.replace(/["\\]/g, '\\$&')}"]`));
  const setTarget = useControlTarget(rt ? {
    address: `scroll:${id}`, kind: 'scroll', label: label ?? id, keywords: ['scroll', id], element: find,
    get: () => (find() as HTMLElement | null)?.scrollTop ?? 0, state: () => ({ scroll: scrollStateOf(find()) }),
  } : null);
  return useCallback((el: HTMLElement | null) => { if (el) el.setAttribute(SCROLL_CONTAINER_ATTR, id); setTarget(el); }, [id, setTarget]);
}
