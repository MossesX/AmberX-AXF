/*
 * Watch live — watch-live@1 (web reference; DOM only, no imports at run time).
 *
 * A headless Claude session's live preview (framework/cli/watch-live.mjs starts it, the console proxies it at
 * /preview/<session>/<app>/) loads this helper. It does two things:
 *
 *  1. Focus: the element the session is changing is scrolled into view and outlined. The selector comes from the
 *     page's `?axfFocus=<selector>` (`&axfNote=` is shown on the outline), and later from the session's
 *     `.axf-focus.json` (served by the preview at `<base>__axf/focus`) whenever it changes. The outline is a separate
 *     overlay, so the element's own styles are never touched, and it follows the element across hot updates,
 *     re-renders, scrolls and resizes (it re-finds the selector whenever the DOM changes).
 *  2. Asset hot swap: an asset file the session edits is re-registered in the running app without a reload
 *     (`AxfRuntime.hotReplaceAsset`), so a theme, layout, menu, toolbar or dialog edit shows at once. Vite apps get
 *     the change as an `axf:asset` HMR event; asset-only projects (Android/Compose screens) get it from
 *     `axf dev` (framework/cli/dev-server.mjs) through `<base>__axf/assets/events`.
 *
 * The running runtime announces itself with `announceWatchLiveRuntime` (the AxfRuntime constructor does it), so the
 * helper also works when it is loaded separately from the app's own (baked) copy of the framework.
 * Android: the kernel has no twin yet (Android work is on hold); the preview shows an Android app's assets through
 * the web port and says so (PORTING.md, deferred gap).
 */

export const WATCH_LIVE_CONTRACT = 'watch-live@1';
/** Query parameters the popup adds to the preview URL. */
export const WATCH_LIVE_PARAMS = { focus: 'axfFocus', note: 'axfNote' } as const;
/** The global the runtime announces itself on (shared by every copy of the framework on the page). */
export const WATCH_LIVE_GLOBAL = '__axfWatchLiveRuntime';
/** Class names (axf.css styles them from theme tokens only). */
export const WATCH_LIVE_CLASSES = { outline: 'fx-watchlive-outline', note: 'fx-watchlive-note' } as const;

const OUTLINE_BASE = 'position:fixed;z-index:2147483000;pointer-events:none;box-sizing:border-box;outline:2px solid var(--fx-accent, Highlight);outline-offset:2px;';
const NOTE_BASE = 'position:absolute;left:0;bottom:calc(100% + 6px);white-space:nowrap;background:var(--fx-accent, Highlight);color:var(--fx-accent-text, HighlightText);';

/** What a session says it is working on (`.axf-focus.json`, `axf focus <app> <route> <selector>`). */
export interface WatchLiveFocus {
  app?: string;
  route?: string;
  selector?: string;
  note?: string;
  /** auto = guessed from the files being edited, not set by the session */
  auto?: boolean;
  at?: number;
}

/** One asset change (the same record `axf dev` serves on /events). */
export interface WatchLiveAssetChange {
  type: string;
  id: string;
  action: 'added' | 'changed' | 'removed';
  ok: boolean;
  raw?: unknown;
}

/** The part of AxfRuntime the helper needs. */
export interface WatchLiveRuntime {
  hotReplaceAsset(raw: unknown, origin?: string): { ok: boolean; errors?: string[] };
  /** used once for asset-only previews, to show the project's own default assets */
  swap?(type: never, id: string): boolean;
}

export function announceWatchLiveRuntime(rt: WatchLiveRuntime): void {
  try { (globalThis as Record<string, unknown>)[WATCH_LIVE_GLOBAL] = rt; } catch { /* frozen global: no hot swap */ }
}

export function watchLiveRuntime(): WatchLiveRuntime | null {
  const rt = (globalThis as Record<string, unknown>)[WATCH_LIVE_GLOBAL] as WatchLiveRuntime | undefined;
  return rt && typeof rt.hotReplaceAsset === 'function' ? rt : null;
}

/** `?axfFocus=…&axfNote=…` → the focus it asks for (null when none). */
export function readFocusParams(search: string): WatchLiveFocus | null {
  const q = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const selector = (q.get(WATCH_LIVE_PARAMS.focus) ?? '').trim();
  if (!selector) return null;
  const note = (q.get(WATCH_LIVE_PARAMS.note) ?? '').trim();
  return { selector, ...(note ? { note } : {}) };
}

/** Adds the focus parameters to a URL (relative or absolute), keeping its hash route. */
export function withFocusParams(url: string, focus: WatchLiveFocus | null | undefined): string {
  if (!focus?.selector) return url;
  const [beforeHash = '', hash = ''] = url.split('#');
  const [path = '', query = ''] = beforeHash.split('?');
  const q = new URLSearchParams(query);
  q.set(WATCH_LIVE_PARAMS.focus, focus.selector);
  if (focus.note) q.set(WATCH_LIVE_PARAMS.note, focus.note);
  return `${path}?${q.toString()}${hash ? `#${hash}` : ''}`;
}

/** The first element a selector matches; a bad selector finds nothing instead of throwing. */
export function findFocusTarget(root: ParentNode, selector: string | undefined): Element | null {
  if (!selector) return null;
  try { return root.querySelector(selector); } catch { return null; }
}

/** Applies asset changes to the runtime; returns how many were applied and which need a reload instead. */
export function applyAssetChanges(rt: WatchLiveRuntime | null, changes: WatchLiveAssetChange[]): { applied: number; reload: boolean; errors: string[] } {
  let applied = 0;
  let reload = false;
  const errors: string[] = [];
  for (const c of changes) {
    if (!c.ok) { errors.push(`${c.type}/${c.id}: invalid, kept the last good version`); continue; }
    if (c.action === 'removed' || c.raw === undefined) { reload = true; continue; }
    if (!rt) { reload = true; continue; }
    const r = rt.hotReplaceAsset(c.raw, 'watch-live');
    if (r.ok) applied++;
    else errors.push(`${c.type}/${c.id}: ${(r.errors ?? []).join('; ') || 'not accepted'}`);
  }
  return { applied, reload, errors };
}

export interface WatchLiveOptions {
  /** the preview's base path (`/preview/<session>/<app>/`); the focus file and assets server hang off it */
  base: string;
  /** Vite's import.meta.hot, when the page runs under Vite */
  hot?: { on(event: string, cb: (data: unknown) => void): void } | null;
  /** asset-only projects: poll `axf dev` through the preview (`<base>__axf/assets`) and load its assets first */
  assetsServer?: boolean;
  win?: Window;
}

/** Starts focus + asset hot swap on this page. Returns a stop function. */
export function installWatchLive(opts: WatchLiveOptions): () => void {
  const win = opts.win ?? window;
  const doc = win.document;
  const base = opts.base.endsWith('/') ? opts.base : `${opts.base}/`;
  let focus: WatchLiveFocus | null = readFocusParams(win.location.search);
  let fileFocusAt = 0;
  let stopped = false;
  let outline: HTMLDivElement | null = null;
  let label: HTMLDivElement | null = null;
  let target: Element | null = null;
  let scrolledTo: Element | null = null;

  const ensureOverlay = () => {
    if (outline) return;
    outline = doc.createElement('div');
    outline.className = WATCH_LIVE_CLASSES.outline;
    outline.setAttribute('aria-hidden', 'true');
    // The essentials inline, so the outline also shows in an app that doesn't load axf.css (theme token, system fallback).
    outline.style.cssText = OUTLINE_BASE;
    label = doc.createElement('div');
    label.className = WATCH_LIVE_CLASSES.note;
    label.style.cssText = NOTE_BASE;
    outline.appendChild(label);
    doc.body.appendChild(outline);
  };

  const place = () => {
    if (stopped) return;
    if (!target || !target.isConnected) target = findFocusTarget(doc, focus?.selector);
    if (!target) { if (outline) outline.style.display = 'none'; return; }
    ensureOverlay();
    if (scrolledTo !== target) {
      scrolledTo = target;
      try { target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch { target.scrollIntoView(); }
    }
    const r = target.getBoundingClientRect();
    Object.assign(outline!.style, { display: 'block', top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
    label!.textContent = focus?.note || focus?.selector || '';
  };

  const setFocus = (f: WatchLiveFocus | null) => {
    const changed = (f?.selector ?? '') !== (focus?.selector ?? '');
    focus = f && f.selector ? f : focus;
    if (changed) { target = null; scrolledTo = null; }
    place();
  };

  let raf = 0;
  const schedule = () => { if (!raf) raf = win.requestAnimationFrame(() => { raf = 0; place(); }); };
  const mo = new MutationObserver(schedule);
  const startObserving = () => { if (doc.body) mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] }); };
  if (doc.body) startObserving(); else doc.addEventListener('DOMContentLoaded', startObserving, { once: true });
  win.addEventListener('scroll', schedule, true);
  win.addEventListener('resize', schedule);

  // The session moves on to another screen or element: follow `.axf-focus.json` (newer than what we showed).
  const pollFocus = async () => {
    try {
      const r = await fetch(`${base}__axf/focus`, { cache: 'no-store' });
      if (r.ok) {
        const f = (await r.json()) as WatchLiveFocus | null;
        if (f && f.selector && (f.at ?? 0) > fileFocusAt && !(f.auto && focus?.selector)) { fileFocusAt = f.at ?? Date.now(); setFocus(f); }
      }
    } catch { /* preview restarting */ }
  };
  const focusTimer = win.setInterval(() => { void pollFocus(); }, 3000);
  void pollFocus();

  const apply = (changes: WatchLiveAssetChange[]) => {
    const res = applyAssetChanges(watchLiveRuntime(), changes);
    for (const e of res.errors) console.warn('[axf watch-live]', e);
    if (res.reload) win.location.reload();
    else schedule();
  };
  opts.hot?.on('axf:asset', (data) => apply(Array.isArray(data) ? data as WatchLiveAssetChange[] : [data as WatchLiveAssetChange]));
  opts.hot?.on('vite:afterUpdate', () => { target = null; schedule(); });

  if (opts.assetsServer) {
    void (async () => {
      const assetsBase = `${base}__axf/assets`;
      let rev = 0;
      try {
        const snap = await (await fetch(`${assetsBase}/assets.json`, { cache: 'no-store' })).json() as { rev: number; assets: unknown[] };
        rev = snap.rev;
        const rt = watchLiveRuntime();
        for (const a of snap.assets) rt?.hotReplaceAsset(a, 'watch-live');
        // Show the project's own defaults (an Android app's theme, layout, menus) instead of the shell's.
        const man = await (await fetch(`${assetsBase}/manifest.json`, { cache: 'no-store' })).json().catch(() => null) as { defaults?: Record<string, string> } | null;
        for (const [type, id] of Object.entries(man?.defaults ?? {})) if (id) rt?.swap?.(type as never, id);
      } catch { /* the assets server isn't up yet; events catch up */ }
      while (!stopped) {
        try {
          const ev = await (await fetch(`${assetsBase}/events?since=${rev}`, { cache: 'no-store' })).json() as { rev: number; changed: WatchLiveAssetChange[] };
          rev = ev.rev;
          const withRaw: WatchLiveAssetChange[] = [];
          for (const c of ev.changed) {
            if (c.action === 'removed' || !c.ok) { withRaw.push(c); continue; }
            const raw = await (await fetch(`${assetsBase}/assets/${encodeURIComponent(c.type)}/${encodeURIComponent(c.id)}.json`, { cache: 'no-store' })).json();
            withRaw.push({ ...c, raw });
          }
          if (withRaw.length) apply(withRaw);
        } catch { await new Promise((r) => win.setTimeout(r, 3000)); }
      }
    })();
  }

  place();
  return () => {
    stopped = true;
    mo.disconnect();
    win.clearInterval(focusTimer);
    win.removeEventListener('scroll', schedule, true);
    win.removeEventListener('resize', schedule);
    outline?.remove();
  };
}
