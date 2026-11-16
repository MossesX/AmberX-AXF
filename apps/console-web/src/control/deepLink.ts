/**
 * Console deep links on page load (console-control@1, framework/spec/CONSOLE-CONTROL.md):
 * `https://console…/?axf-target=<address>` opens that address once the console is up, the same way `console_show`
 * does over the relay. Any address the executor knows works: a screen (`view:build-orchestrator`), a tab
 * (`view:gate/tab:gate.tabs=auto-lander`), a row or a build step.
 *
 * The page boots in stages (account, plugin list, lazy plugin chunks), so a plugin screen is not registered on the
 * first frame: the link is retried until the screen it names is the one on show, or until it gives up. The address is
 * kept in sessionStorage until it lands, so a reload or a sign-in round trip in the same tab still arrives; axHub's wall
 * sends the browser back to the full URL, query included. The parameter is taken off the address bar once it landed.
 *
 * The parameter may also sit in the hash (`#/?axf-target=…`), for links that went through a router that keeps only the
 * fragment.
 */
import type { AxfRuntime } from '../axf/core';
import { CONSOLE_CONTROL_WIRE, parseAddress } from '../axf/core/engines/console-control';
import { executeControl, type ControlAnswer } from './executor';

export const DEEP_LINK_PARAM = 'axf-target';
const STORE_KEY = 'axf.console.deep-link';
/** How long a link waits for its screen to register (lazy plugin chunks on a slow phone connection). */
const GIVE_UP_MS = 30_000;
/** After it landed: how long the screen is watched for a late boot step that moves it away (restored layout, home). */
const HOLD_MS = 2_500;

/** The address in a URL's query or hash query, or null. */
export function deepLinkFrom(href: string): string | null {
  try {
    const u = new URL(href);
    const q = u.searchParams.get(DEEP_LINK_PARAM);
    if (q && q.trim()) return q.trim();
    const i = u.hash.indexOf('?');
    if (i >= 0) { const h = new URLSearchParams(u.hash.slice(i + 1)).get(DEEP_LINK_PARAM); if (h && h.trim()) return h.trim(); }
  } catch { /* not a URL */ }
  return null;
}

/** The URL without the parameter (query and hash query). */
export function withoutDeepLink(href: string): string {
  const u = new URL(href);
  u.searchParams.delete(DEEP_LINK_PARAM);
  const i = u.hash.indexOf('?');
  if (i >= 0) {
    const p = new URLSearchParams(u.hash.slice(i + 1)); p.delete(DEEP_LINK_PARAM);
    const rest = p.toString(); u.hash = u.hash.slice(0, i) + (rest ? `?${rest}` : '');
  }
  return u.toString();
}

/** The screen an address lands on (`view:<id>` at its root), or null for one that does not start with a screen. */
export function screenOf(address: string): string | null {
  try { const p = parseAddress(address); return p[0]?.kind === 'view' ? p[0].id : null; } catch { return null; }
}

/** The console-control command a deep link runs: rows and steps are focused, screens and tabs are opened. */
export function deepLinkCommand(address: string): { verb: 'open' | 'focus'; address: string; by: string } {
  let leaf = '';
  try { const p = parseAddress(address); leaf = p[p.length - 1]?.kind ?? ''; } catch { /* the executor answers invalid */ }
  return { verb: leaf === 'row' || leaf === 'step' ? 'focus' : 'open', address, by: 'deep-link' };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Open the address and keep at it until its screen is the one on show. Resolves with the last answer (ok or not).
 * `stillWanted` lets a newer link or the person (they navigated themselves) cancel it.
 */
export async function applyDeepLink(rt: AxfRuntime, address: string, stillWanted: () => boolean = () => true, giveUpMs = GIVE_UP_MS): Promise<ControlAnswer | null> {
  const want = screenOf(address);
  const deadline = Date.now() + giveUpMs;
  const cmd = deepLinkCommand(address);
  let answer: ControlAnswer | null = null;
  for (let delay = 120; stillWanted() && Date.now() < deadline; delay = Math.min(delay * 1.6, 1500)) {
    answer = await executeControl(rt, cmd);
    const on = rt.getState().view;
    if (answer.ok && (!want || on === want)) {
      // a later boot step (restored layout, a plugin that opens its home) may still move the screen: hold it briefly
      const held = Date.now() + HOLD_MS;
      while (Date.now() < held && stillWanted()) {
        await wait(150);
        if (want && rt.getState().view !== want) { answer = await executeControl(rt, cmd); }
      }
      return answer;
    }
    // invalid addresses never become valid: stop early
    if (!answer.ok && answer.code === CONSOLE_CONTROL_WIRE.INVALID) return answer;
    await wait(delay);
  }
  return answer;
}

/** Read the link from the page (or the tab's saved copy), apply it once, then tidy the address bar. Returns a remover. */
export function installDeepLink(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  let address = deepLinkFrom(window.location.href);
  try {
    if (address) window.sessionStorage.setItem(STORE_KEY, address);
    else address = window.sessionStorage.getItem(STORE_KEY);
  } catch { /* storage blocked: the URL alone carries it */ }
  if (!address) return () => {};
  let cancelled = false;
  const w = window as unknown as { axfDeepLink?: { address: string; done: boolean; answer: ControlAnswer | null } };
  w.axfDeepLink = { address, done: false, answer: null };
  void applyDeepLink(rt, address, () => !cancelled).then((answer) => {
    if (cancelled) return;
    w.axfDeepLink = { address: address!, done: true, answer };
    try { window.sessionStorage.removeItem(STORE_KEY); } catch { /* fine */ }
    try { if (deepLinkFrom(window.location.href)) window.history.replaceState(window.history.state, '', withoutDeepLink(window.location.href)); } catch { /* fine */ }
    if (!answer?.ok) rt.toast(`Couldn't open ${address}: ${answer?.message ?? 'it did not load'}`, 'warning', 'Deep link');
  });
  return () => { cancelled = true; };
}
