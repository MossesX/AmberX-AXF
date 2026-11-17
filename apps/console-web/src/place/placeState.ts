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

/* ================================================================== the place (pure) */

export const PLACE_FRAME = 'console-place@1';
export const PLACE_STORAGE_KEY = 'axf:console-place@1';
/** A saved place older than this is ignored (a tab left for days opens fresh). */
export const PLACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Query parameters that are deep links: any of them on load wins over the saved place. */
export const DEEP_LINK_PARAMS = ['axf-open', 'axf-cmd', 'axf-ref'] as const;
/** Saving waits this long after the last change. */
export const PLACE_SAVE_DEBOUNCE_MS = 250;

export interface ConsolePlace {
  $axf: typeof PLACE_FRAME;
  /** ISO time of the save */
  at: string;
  /** what saved it last: change, pagehide, hidden, unload, refresh, pull-refresh, api */
  by: string;
  /** the open view's address, `view:<id>` */
  view: string;
  /** tab row address → active tab value */
  tabs: Record<string, string>;
  /** grid address → selected row id */
  selection: Record<string, string>;
  /** scroll address → offset from the top in px */
  scroll: Record<string, number>;
}

export const viewAddress = (id: string): string => `view:${id}`;
export const viewIdOf = (address: string): string | null => (/^view:([^/]+)$/.test(address) ? address.slice(5) : null);

export function emptyPlace(view = 'home', by = 'change', at = new Date()): ConsolePlace {
  return { $axf: PLACE_FRAME, at: at.toISOString(), by, view: viewAddress(view), tabs: {}, selection: {}, scroll: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function pick<T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(v)) return out;
  for (const [k, x] of Object.entries(v)) if (k && ok(x)) out[k] = x;
  return out;
}
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length < 400;
const isOffset = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Reads a stored place; null when missing, malformed, from another frame or older than `maxAgeMs`. */
export function parsePlace(raw: string | null | undefined, now = Date.now(), maxAgeMs = PLACE_MAX_AGE_MS): ConsolePlace | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isRecord(v) || v.$axf !== PLACE_FRAME || typeof v.view !== 'string' || !viewIdOf(v.view)) return null;
  const at = Date.parse(String(v.at ?? ''));
  if (!Number.isFinite(at) || now - at > maxAgeMs || at - now > 60_000) return null;
  return {
    $axf: PLACE_FRAME, at: new Date(at).toISOString(), by: typeof v.by === 'string' ? v.by : 'change', view: v.view,
    tabs: pick(v.tabs, isStr), selection: pick(v.selection, isStr), scroll: pick(v.scroll, isOffset),
  };
}

/** True when the URL carries a deep link that must win over the saved place. */
export function hasDeepLink(href: string): boolean {
  try { const u = new URL(href); return DEEP_LINK_PARAMS.some((p) => u.searchParams.has(p)); } catch { return false; }
}

/**
 * What a load should restore: the saved place, unless a deep link is in the URL (the link wins: null) or the place is
 * unusable. `views` (when given) drops a saved view this console doesn't have; plugin views that load later are kept
 * when `views` is omitted.
 */
export function placeToRestore(saved: ConsolePlace | null, href: string, views?: readonly string[]): ConsolePlace | null {
  if (!saved || hasDeepLink(href)) return null;
  const id = viewIdOf(saved.view);
  if (!id || (views && !views.includes(id))) return null;
  return saved;
}

/** Only the parts of `place` that sit under `view` (or are global, like `scroll:main`) are reapplied on that view. */
export function belongsToView(address: string, view: string): boolean {
  if (address.startsWith('scroll:')) return true;
  if (address.startsWith('view:')) return address === view || address.startsWith(`${view}/`);
  return true;
}

/** A new place from the current one plus what is on screen now (rows not on screen keep their last value). */
export function mergePlace(prev: ConsolePlace | null, now: Omit<ConsolePlace, '$axf'>): ConsolePlace {
  const sameView = prev?.view === now.view;
  return {
    $axf: PLACE_FRAME, at: now.at, by: now.by, view: now.view,
    tabs: { ...(prev?.tabs ?? {}), ...now.tabs },
    selection: { ...(sameView ? prev?.selection : {}), ...now.selection },
    // scroll belongs to the view on screen: a new view starts from what it reports
    scroll: { ...(sameView ? prev?.scroll : {}), ...now.scroll },
  };
}

/* ================================================================== storage */

function storage(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

export function readPlace(now = Date.now()): ConsolePlace | null {
  try { return parsePlace(storage()?.getItem(PLACE_STORAGE_KEY), now); } catch { return null; }
}

export function writePlace(place: ConsolePlace): void {
  try { storage()?.setItem(PLACE_STORAGE_KEY, JSON.stringify(place)); } catch { /* storage full or off: this page only */ }
}

export function clearPlace(): void {
  try { storage()?.removeItem(PLACE_STORAGE_KEY); } catch { /* storage off */ }
}

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
