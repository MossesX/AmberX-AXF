/**
 * Per-instance transparency on every tab group, toolbar, navigation menu, application menu, context menu and banner
 * (web host of chrome-settings@1's `transparency` field; build land-per-instance-settings-picker, Brett Nov 13 2026:
 * "every tab group, application menu, navigation menu, toolbar can have its own settings interface that changes only
 * it, and they all have transparency"). Installed once by <AxfProvider>, so every instance in every app on the
 * framework gets it with no code of its own, hand-drawn strips included.
 *
 * Each surface element (the same ones tap-to-confirm finds, resolved to the same instance id its context menu opens)
 * gets the opacity token its kind's surface reads, written inline on that one element (and on the box that paints
 * it: a nav's region, a context menu's panel), from `axf.chrome.<kind>.<instance>.transparency`. 'inherit' / unset
 * removes them, so the element follows the style theme again. No other instance changes.
 *
 * The same setting by API: chrome.set:<kind>:<instance>:transparency:<inherit|0…100> (console REST / MCP / CLI /
 * voice), control@1 settings `axf.chrome.<kind>.<instance>`.
 */
import { CHROME_INSTANCE_KEY, chromeTransparencyVars, type ChromeType } from '../core/engines/chrome-settings-rules.mjs';
import { chromeSurfaceOf, TAP_SURFACES } from './tapConfirm';

/** Marks an element whose inline opacity tokens this module wrote (the names, space-separated). */
const OWN_ATTR = 'data-axf-own-transparency';

/** The boxes that paint a surface: the surface itself, plus a nav's region and a context menu's panel. */
function paintedBy(kind: ChromeType, el: HTMLElement): HTMLElement[] {
  const out = [el];
  const extra = kind === 'nav-menu' ? el.closest<HTMLElement>('.fx-region--nav') : kind === 'context-menu' ? el.closest<HTMLElement>('.fx-ctx') : null;
  if (extra && extra !== el) out.push(extra);
  return out;
}

function write(el: HTMLElement, vars: Record<string, string>): void {
  const prev = (el.getAttribute(OWN_ATTR) ?? '').split(' ').filter(Boolean);
  for (const name of prev) if (!(name in vars)) el.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
  const names = Object.keys(vars).join(' ');
  if (names) { if (el.getAttribute(OWN_ATTR) !== names) el.setAttribute(OWN_ATTR, names); } else if (prev.length) el.removeAttribute(OWN_ATTR);
}

/** One pass over `root`: every surface gets its instance's tokens (or loses the ones it no longer has). */
export function applyChromeTransparency(root: ParentNode, get: (key: string) => unknown): void {
  const want = new Map<HTMLElement, Record<string, string>>();
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(TAP_SURFACES))) {
    const s = chromeSurfaceOf(node);
    if (!s || s.el !== node) continue;
    const vars = chromeTransparencyVars(s.kind as ChromeType, get(CHROME_INSTANCE_KEY(s.kind, s.instance)));
    for (const box of paintedBy(s.kind as ChromeType, s.el)) want.set(box, { ...(want.get(box) ?? {}), ...vars });
  }
  // boxes that had tokens but are no longer a surface with any
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${OWN_ATTR}]`))) if (!want.has(el)) want.set(el, {});
  for (const [el, vars] of want) write(el, vars);
}

export interface ChromeTransparencyHost { refresh(): void; dispose(): void }

/**
 * Keep every surface in `doc` on its instance's transparency: re-applies when a setting changes and when chrome
 * mounts (one pass per animation frame at most).
 */
export function installChromeTransparency(doc: Document, get: (key: string) => unknown, onSettings: (fn: () => void) => () => void): ChromeTransparencyHost {
  let pending = false, handle = 0;
  const run = () => { pending = false; applyChromeTransparency(doc, get); };
  // the flag is set before the frame is asked for, so a frame that runs at once still clears it
  const schedule = () => { if (pending) return; pending = true; handle = (doc.defaultView?.requestAnimationFrame ?? ((f: FrameRequestCallback) => setTimeout(() => f(0), 16) as unknown as number))(run); };
  const off = onSettings(schedule);
  // only element additions / removals matter; our own style writes are attribute changes and are not observed
  const mo = new MutationObserver(schedule);
  mo.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
  run();
  return { refresh: run, dispose: () => { off(); mo.disconnect(); if (pending) doc.defaultView?.cancelAnimationFrame?.(handle); } };
}
