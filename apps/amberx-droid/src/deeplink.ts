/**
 * Deep links into AmberX (Nov 10 2026, Brett: "That Gizmo didn't open. There's an AmberX web app tied to the app, so
 * why won't it work?").
 *
 * AmberX's web app lives at https://amberx.amberxai.com, the same origin the Android app loads in its WebView. A link on
 * that origin opens the matching screen in either place:
 *
 *   https://amberx.amberxai.com/gizmo        Gizmo's chat               (action companion.open)
 *   https://amberx.amberxai.com/gizmo/new    a new chat with Gizmo      (action companion.new)
 *   https://amberx.amberxai.com/gizmo/talk   Gizmo in talk mode         (action companion.talk)
 *   https://amberx.amberxai.com/?open=gizmo  the same, as a query (open=gizmo | gizmo-new | gizmo-talk)
 *
 * On the phone the link is an Android app link (MainActivity's verified intent filter, `/.well-known/assetlinks.json`
 * on the server), so it opens AmberX itself; without the app it opens the web app in the browser. Either way this file
 * maps the URL to the action. `amberx.open_url` hands such links straight to the app (OpenUrlRules.inApp).
 *
 * Pure part first (no DOM), then the installer the shell calls once.
 */

export const APP_ORIGIN = 'https://amberx.amberxai.com';

/** Path or `open=` value → the action it runs. */
export const LINKS: Readonly<Record<string, { path: string; open: string; action: string; label: string }>> = {
  gizmo: { path: '/gizmo', open: 'gizmo', action: 'companion.open', label: "Gizmo's chat" },
  'gizmo-new': { path: '/gizmo/new', open: 'gizmo-new', action: 'companion.new', label: 'A new chat with Gizmo' },
  'gizmo-talk': { path: '/gizmo/talk', open: 'gizmo-talk', action: 'companion.talk', label: 'Gizmo in talk mode' },
};

/** The full https link for a target id (`gizmo`, `gizmo-new`, `gizmo-talk`). */
export function linkFor(id: string): string | null {
  const l = LINKS[id];
  return l ? APP_ORIGIN + l.path : null;
}

/**
 * The action a URL asks for, or null. Takes a full URL (only AmberX's own origin counts) or a same-origin path with an
 * optional query (`/gizmo`, `/?open=gizmo`). Trailing slashes and case in the path don't matter.
 */
export function linkAction(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw.trim(), APP_ORIGIN); } catch { return null; }
  if (u.origin !== APP_ORIGIN) return null;
  const path = u.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  for (const l of Object.values(LINKS)) if (path === l.path) return l.action;
  if (path === '/' || path === '/index.html') {
    const open = (u.searchParams.get('open') ?? '').trim().toLowerCase();
    if (open && LINKS[open]) return LINKS[open].action;
  }
  return null;
}

/** The same URL without the deep link (path back to `/`, `open` dropped), so a reload doesn't open it again. */
export function spentUrl(raw: string): string {
  const u = new URL(raw, APP_ORIGIN);
  u.searchParams.delete('open');
  const q = u.searchParams.toString();
  return `/${q ? `?${q}` : ''}${u.hash}`;
}

interface LinkRuntime {
  dispatch(spec: string): boolean;
  actions: { get(id: string): unknown };
}

/**
 * Runs the page's own deep link once (web app and WebView), then each link the phone hands over (`link` events from
 * MainActivity: an app link tapped, or `amberx.open_url`). The action may register a moment after the shell mounts,
 * so a link waits up to 10 s for it. → stop function.
 */
export function installDeepLinks(rt: LinkRuntime, onLink?: (fn: (url: string) => void) => (() => void) | void): () => void {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const run = (url: string) => {
    const action = linkAction(url);
    if (!action) return false;
    let tries = 0;
    const go = () => {
      if (stopped) return;
      if (rt.actions.get(action) && rt.dispatch(action)) return;
      if (++tries < 50) { const t = setTimeout(() => { timers.delete(t); go(); }, 200); timers.add(t); }
    };
    go();
    return true;
  };
  // the page's own path (any host: the deployed web app, the WebView, a dev server)
  const own = typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '';
  if (own && run(own)) {
    try { history.replaceState(history.state, '', spentUrl(own)); } catch { /* sandboxed frame */ }
  }
  const off = onLink?.((url) => { run(url); });
  return () => { stopped = true; timers.forEach(clearTimeout); timers.clear(); if (typeof off === 'function') off(); };
}
