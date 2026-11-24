/**
 * The console's place (build fix-refreshing-console-jumps-back, Nov 17 2026; report
 * _claude/builds/reports/fix-refreshing-console-jumps-back.md).
 *
 * A reload of any kind (browser reload, the phone's pull-down refresh, a server-pushed `console.refresh`, a new version)
 * used to land on Home at the top: the view, tabs, selection and scroll lived only in memory. The place store keeps them
 * in sessionStorage (this browser tab only, so two tabs keep two places), keyed by console-control addresses:
 *
 *   view       `view:<id>`                              the open screen
 *   tabs       `…tab:<row>` / `…subtab:<row>` → value   the active tab of every tab row on screen
 *   selection  `…grid:<id>` → row id                    the selected row of every data grid on screen
 *   scroll     `scroll:main` / `scroll:<pane>` → px     the main pane and every named pane (`data-axf-scroll`)
 *
 * Saving is debounced on every change and immediate on pagehide / visibilitychange(hidden) / beforeunload and right
 * before any reload the console starts itself (`savePlaceNow`). A URL deep link (`?axf-open=`, `?axf-cmd=`, `?axf-ref=`)
 * always wins over the saved place. The pure half (this file's top) has no DOM and is unit tested
 * (`scripts/place-state-check.mts`); the DOM half reads and applies the place through the control registry.
 */
import type { AxfRuntime } from '../axf/core';
import { controlRegistry, MAIN_SCROLL_ADDRESS } from '../axf/react';

export * from './placeCore';
import { mergePlace, PLACE_SAVE_DEBOUNCE_MS, readPlace, viewAddress, writePlace, type ConsolePlace } from './placeCore';

/* ================================================================== the DOM half */

const SCROLL_ATTR = 'data-axf-scroll';

function visible(el: Element): boolean {
  return (el as HTMLElement).offsetParent !== null || el === document.body;
}

/** `.fx-main` (the one on screen) when it scrolls, else the document. */
export function mainScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const mains = Array.from(document.querySelectorAll<HTMLElement>('.fx-main')).filter(visible);
  return mains[mains.length - 1] ?? (document.scrollingElement as HTMLElement | null);
}

/** Every scroll container worth saving: the main pane and every visible named pane. */
export function scrollers(): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  const main = mainScroller();
  if (main) out.set(MAIN_SCROLL_ADDRESS, main);
  if (typeof document === 'undefined') return out;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${SCROLL_ATTR}]`))) {
    const id = el.getAttribute(SCROLL_ATTR);
    if (id && visible(el)) out.set(`scroll:${id}`, el);
  }
  return out;
}

/** What is on screen now, as a place. */
export function capturePlace(rt: AxfRuntime, by = 'change'): ConsolePlace {
  const view = viewAddress(rt.getState().view);
  const tabs: Record<string, string> = {};
  const selection: Record<string, string> = {};
  const reg = controlRegistry(rt);
  for (const t of reg.snapshot().targets) {
    if ((t.kind === 'tab' || t.kind === 'subtab') && !t.address.includes('=') && typeof t.value === 'string' && t.value) tabs[t.address] = t.value;
    if (t.kind === 'grid' && (typeof t.value === 'string' || typeof t.value === 'number') && String(t.value)) selection[t.address] = String(t.value);
  }
  const scroll: Record<string, number> = {};
  for (const [addr, el] of scrollers()) scroll[addr] = Math.max(0, Math.round(el.scrollTop));
  return mergePlace(readPlace(), { at: new Date().toISOString(), by, view, tabs, selection, scroll });
}

/* ---------------- saving ---------------- */

let installedRt: AxfRuntime | null = null;
let held = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Saves the place now (before a reload the console starts itself, on pagehide). No-op while a restore is running. */
export function savePlaceNow(by = 'change', rt: AxfRuntime | null = installedRt): ConsolePlace | null {
  if (!rt || held) return null;
  if (timer) { clearTimeout(timer); timer = null; }
  const place = capturePlace(rt, by);
  writePlace(place);
  return place;
}

export function savePlaceSoon(by = 'change'): void {
  if (held || !installedRt) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; savePlaceNow(by); }, PLACE_SAVE_DEBOUNCE_MS);
}

/** Holds saving while a restore puts the place back (so the first paint on Home can't overwrite the saved place). */
export function holdSaving(on: boolean): void {
  held = on;
  if (on && timer) { clearTimeout(timer); timer = null; }
}
export const savingHeld = (): boolean => held;

/**
 * Starts saving: every runtime state change, every control-registry change (a tab switched, a row selected), every
 * scroll in the main pane or a named pane; at once on pagehide, hidden and beforeunload. Returns a remover.
 */
export function installPlaceSaving(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  installedRt = rt;
  const offState = rt.subscribe(() => savePlaceSoon('change'));
  const offReg = controlRegistry(rt).subscribe(() => savePlaceSoon('change'));
  const onScroll = (e: Event) => {
    const t = e.target;
    if (t === document || (t instanceof Element && (t.matches('.fx-main') || t.hasAttribute(SCROLL_ATTR)))) savePlaceSoon('change');
  };
  const onHide = () => { savePlaceNow('pagehide'); };
  const onVis = () => { if (document.visibilityState === 'hidden') savePlaceNow('hidden'); };
  const onUnload = () => { savePlaceNow('unload'); };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('visibilitychange', onVis);
  return () => {
    offState(); offReg();
    document.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('beforeunload', onUnload);
    document.removeEventListener('visibilitychange', onVis);
    if (installedRt === rt) installedRt = null;
  };
}
