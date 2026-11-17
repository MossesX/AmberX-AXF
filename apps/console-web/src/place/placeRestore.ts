/**
 * Putting the console's place back after a reload (see placeState.ts). Runs once per page load, before the first paint:
 *
 *   1. the view opens at once (`rt.navigate`, before React renders), so the page never flashes Home;
 *   2. each saved tab row is switched as soon as it registers its `tab:` target (rows inside a tab's panel register
 *      after their parent tab is on, so nested rows follow on their own);
 *
 * A deep link in the URL wins (nothing is restored). The person wins too: a tap, key, wheel or touch ends the restore,
 * and so does going to another view. Saving is held while the restore runs, so the first paint can't overwrite the
 * saved place; it resumes when the restore ends (done, cancelled or timed out).
 */
import type { AxfRuntime } from '../axf/core';
import { controlRegistry } from '../axf/react';
import { belongsToView, holdSaving, placeToRestore, readPlace, savePlaceNow, viewIdOf, type ConsolePlace } from './placeState';

/** The restore gives up after this long (the hub's waiting screen, slow data). */
export const RESTORE_TIMEOUT_MS = 12_000;

export interface RestoreRun {
  place: ConsolePlace;
  /** addresses still waiting to be applied */
  pending(): string[];
  /** resolves when the restore ends: 'done' | 'cancelled' | 'timeout' | 'left' */
  finished: Promise<string>;
  cancel(why?: string): void;
}

let current: RestoreRun | null = null;
export const currentRestore = (): RestoreRun | null => current;

type Step = { address: string; apply: () => boolean };

/** A saved tab row that hasn't shown up this long after the screen last changed is let go (its panel isn't open now). */
export const RESTORE_IDLE_MS = 1500;

/** Steps for one place: tab rows (this step), extended by placeScroll.ts for selection and scroll. */
const extraSteps: Array<(rt: AxfRuntime, place: ConsolePlace) => Step[]> = [];
export function addRestoreSteps(fn: (rt: AxfRuntime, place: ConsolePlace) => Step[]): void { extraSteps.push(fn); }

function tabSteps(rt: AxfRuntime, place: ConsolePlace): Step[] {
  const reg = controlRegistry(rt);
  return Object.entries(place.tabs).filter(([a]) => belongsToView(a, place.view)).map(([address, value]) => ({
    address,
    apply: () => {
      const e = reg.entry(address);
      if (!e?.def.set) return false;
      try { if (e.def.get?.() !== value) void e.def.set(value); } catch { /* the row refused: leave it */ }
      return true;
    },
  }));
}

/**
 * Restores `place` on this page. `navigate` false skips the view (already opened, e.g. a soft refresh). Returns the run,
 * or null when there is nothing to restore.
 */
export function restorePlace(rt: AxfRuntime, place: ConsolePlace, opts: { navigate?: boolean; timeoutMs?: number } = {}): RestoreRun | null {
  if (typeof window === 'undefined') return null;
  current?.cancel('replaced');
  const id = viewIdOf(place.view);
  if (!id) return null;
  if (opts.navigate !== false && rt.getState().view !== id) rt.navigate(id);
  holdSaving(true);
  const steps = [...tabSteps(rt, place), ...extraSteps.flatMap((fn) => fn(rt, place))];
  const left = new Map(steps.map((s) => [s.address, s]));
  let resolve!: (why: string) => void;
  const finished = new Promise<string>((r) => { resolve = r; });
  const offs: Array<() => void> = [];
  let ended = false;
  const end = (why: string) => {
    if (ended) return;
    ended = true;
    offs.forEach((f) => f());
    if (current === run) current = null;
    holdSaving(false);
    // a person who moved on keeps what they moved to; otherwise save what was put back
    savePlaceNow(why === 'done' ? 'restored' : 'change', rt);
    resolve(why);
  };
  const tick = () => {
    if (ended) return;
    if (rt.getState().view !== id) { end('left'); return; }
    for (const [a, s] of Array.from(left)) if (s.apply()) left.delete(a);
    if (!left.size) { end('done'); return; }
    const reg = controlRegistry(rt);
    const onlyAbsentRows = Array.from(left.keys()).every((a) => /(^|\/)(tab|subtab):[^/=]+$/.test(a) && !reg.entry(a));
    if (onlyAbsentRows && Date.now() - lastChange > RESTORE_IDLE_MS) end('done');
  };
  let queued = false;
  let lastChange = Date.now();
  const soon = () => { lastChange = Date.now(); if (queued) return; queued = true; setTimeout(() => { queued = false; tick(); }, 0); };
  offs.push(controlRegistry(rt).subscribe(soon));
  offs.push(rt.subscribe(soon));
  const iv = setInterval(tick, 150); // content that grows without a registry change (data loading for scroll)
  offs.push(() => clearInterval(iv));
  const t = setTimeout(() => end('timeout'), opts.timeoutMs ?? RESTORE_TIMEOUT_MS);
  offs.push(() => clearTimeout(t));
  const byPerson = (e: Event) => { if (e.isTrusted) end('cancelled'); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(ev, byPerson, { capture: true, passive: true });
    offs.push(() => window.removeEventListener(ev, byPerson, { capture: true }));
  }
  const run: RestoreRun = { place, pending: () => Array.from(left.keys()), finished, cancel: (why = 'cancelled') => end(why) };
  current = run;
  soon();
  return run;
}

/** On load: restore the saved place unless a deep link is in the URL or the console runs embedded as a page. */
export function restoreOnLoad(rt: AxfRuntime, href = typeof location === 'undefined' ? '' : location.href): RestoreRun | null {
  if (rt.embedded?.page) return null;
  const place = placeToRestore(readPlace(), href);
  return place ? restorePlace(rt, place) : null;
}
