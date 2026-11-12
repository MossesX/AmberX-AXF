/**
 * screen-focus: every screen can bring one of its tabs, groups or items forward (focus-on-every-screen, Nov 12 2026,
 * Brett: "Everything, everything needs to plan studio, UI review, everything."). `console_open` / `console_show` with a
 * focus run the screen's `<view>.focus:<key>` action; the shell registers a generic one for every view that doesn't
 * declare its own, and screens with their own state (tabs, filters, folded rows) register theirs on top.
 *
 * The generic focus works on the page itself: it waits for the screen to draw (lists load late), then looks for
 *   1. an item marked with the key: `data-fx-focus-key`, the context-menu payload, a settings anchor, an element id;
 *   2. a tab whose value or label is the key (the framework TabGroup draws role="tab" buttons) and opens it;
 *   3. the smallest row, card or group whose text holds the key.
 * The hit is opened (a folded <details> / aria-expanded=false toggle), scrolled to the middle and highlighted until the
 * next focus. A screen keeps its own ask (askScreenFocus / wantedScreenFocus) so a page that mounts later still sees it.
 */

/** Put this on every item row, card or group a screen lists: its id, the key a focus asks for. */
export const FOCUS_KEY_ATTR = 'data-fx-focus-key';
/** The class on the element a focus brought forward (highlight drawn in axf.css with asset tokens). */
export const FOCUS_HIT_CLASS = 'fx-focus-hit';
/** Window event a screen listens to: detail = { view, key }. */
export const SCREEN_FOCUS_EVENT = 'axf:screen-focus';
const ASK_TTL_MS = 30_000;
const WAIT_MS = 8_000;
const STEP_MS = 120;
const TEXT_AFTER_MS = 1_500;

/** The action every screen answers to. */
export function focusActionId(view: string): string { return `${view}.focus`; }

let ask: { view: string; key: string; at: number } | null = null;

/** Record what a screen is asked to bring forward and tell it (it may not be on screen yet). */
export function askScreenFocus(view: string, key: string): void {
  ask = { view, key, at: Date.now() };
  globalThis.dispatchEvent?.(new CustomEvent(SCREEN_FOCUS_EVENT, { detail: { view, key } }));
}

/** The key asked of this screen within the last 30 s, or ''. */
export function wantedScreenFocus(view: string, now = Date.now()): string {
  return ask && ask.view === view && now - ask.at < ASK_TTL_MS ? ask.key : '';
}

/** The screen carried the ask out: later re-renders don't jump back to it. */
export function settleScreenFocus(view: string): void { if (ask?.view === view) ask = null; }

/** Decoded, trimmed focus argument ("r-2026…", "Pending", "appearance#motion"). */
export function focusKeyOf(arg: string | undefined): string {
  const raw = String(arg ?? '');
  try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); }
}

const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s*\(\d+\)\s*$/, '').replace(/\s+\d+$/, '').trim().toLowerCase();

/** Elements marked with the key (attribute matches only). */
export function keyedMatch(root: ParentNode, key: string): HTMLElement | null {
  const k = esc(key);
  const sels = [`[${FOCUS_KEY_ATTR}="${k}"]`, `[data-fx-ctx-payload="${k}"]`, `[data-axf-anchor="${k}"]`, `[data-axf-anchor="setting:${k}"]`, `[data-axf-anchor="settings-group:${k}"]`, `[data-axf-anchor="settings-panel:${k}"]`, `[id="${k}"]`];
  for (const s of sels) { const el = root.querySelector<HTMLElement>(s); if (el) return el; }
  return null;
}

/** A tab (role="tab") whose value or label is the key. */
export function tabMatch(root: ParentNode, key: string): HTMLElement | null {
  const want = norm(key);
  for (const t of Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'))) {
    if (norm(t.dataset.value) === want || norm(t.getAttribute('aria-label')) === want || norm(t.textContent) === want) return t;
  }
  return null;
}

const ROWS = `[${FOCUS_KEY_ATTR}], [data-fx-ctx-target], [data-axf-anchor], [role="row"], [role="listitem"], [role="treeitem"], li, tr, details, article, .fx-card`;

/** The smallest row / card / group whose text holds the key (case-insensitive). */
export function textMatch(root: ParentNode, key: string): HTMLElement | null {
  const want = key.toLowerCase();
  if (want.length < 2) return null;
  let best: HTMLElement | null = null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(ROWS))) {
    if (!(el.textContent ?? '').toLowerCase().includes(want)) continue;
    if (!best || best.contains(el)) best = el;
  }
  return best;
}

/** Open a folded hit: <details>, its own aria-expanded toggle or the first folded toggle inside it. */
export function expand(el: HTMLElement): void {
  if (el instanceof HTMLDetailsElement) { el.open = true; return; }
  const own = el.closest('details');
  if (own && !own.open) own.open = true;
  if (el.getAttribute('aria-expanded') === 'false') { el.click(); return; }
  const t = el.querySelector<HTMLElement>(':scope > [aria-expanded="false"], :scope > * > [aria-expanded="false"]');
  if (t) t.click();
}

/** Scroll the hit to the middle and highlight it (the previous highlight goes). */
export function highlight(el: HTMLElement): void {
  for (const old of Array.from(document.querySelectorAll(`.${FOCUS_HIT_CLASS}`))) if (old !== el) old.classList.remove(FOCUS_HIT_CLASS);
  el.classList.add(FOCUS_HIT_CLASS);
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

export type FocusHit = 'item' | 'tab' | 'text' | 'none';

/**
 * Bring the key forward on what is drawn under `root` (default: the main region). Waits up to `waitMs` for the screen
 * to draw it; a tab hit is clicked and the search goes on inside it for a moment before settling on the tab.
 */
export function focusOnPage(key: string, opts: { root?: () => ParentNode | null; waitMs?: number } = {}): Promise<FocusHit> {
  const rootOf = opts.root ?? (() => document.querySelector('.fx-main') ?? document);
  const until = Date.now() + (opts.waitMs ?? WAIT_MS);
  const textFrom = Date.now() + TEXT_AFTER_MS; // marked items get a head start over a text match
  let tabbed: HTMLElement | null = null;
  return new Promise((resolve) => {
    const step = () => {
      const root = rootOf() ?? document;
      const hit = keyedMatch(root, key);
      if (hit) { expand(hit); highlight(hit); resolve('item'); return; }
      if (!tabbed) {
        const tab = tabMatch(root, key);
        if (tab) { if (tab.getAttribute('aria-selected') !== 'true') tab.click(); tabbed = tab; highlight(tab); resolve('tab'); return; }
      }
      if (Date.now() >= textFrom) {
        const t = textMatch(root, key);
        if (t) { expand(t); highlight(t); resolve('text'); return; }
      }
      if (Date.now() >= until) { resolve('none'); return; }
      setTimeout(step, STEP_MS);
    };
    step();
  });
}
