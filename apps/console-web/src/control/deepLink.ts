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
import { CONSOLE_CONTROL_WIRE, formatAddress, parseAddress } from '../axf/core/engines/console-control';
import { controlState, executeControl, type ControlAnswer } from './executor';

export const DEEP_LINK_PARAM = 'axf-target';
const STORE_KEY = 'axf.console.deep-link';
/** What an address does not carry (the open dialog, the main pane's scroll), kept beside it for a reload of this tab. */
const EXTRA_KEY = 'axf.console.deep-link.extra';
interface HereExtra { address: string; dialog?: string; scrollTop?: number }
/** How long a link waits for its screen to register (lazy plugin chunks on a slow phone connection). */
const GIVE_UP_MS = 30_000;
/** After it landed: how long the screen is watched for a late boot step that moves it away (restored layout, home). */
const HOLD_MS = 3_000;

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
 * Whether the console shows the address now: its screen, and every tab it names chosen (`tab:<row>=<value>`), so a
 * screen that restores its own last tab after mounting doesn't count as landed.
 */
export function showsAddress(rt: AxfRuntime, address: string): boolean {
  let parts: ReturnType<typeof parseAddress>;
  try { parts = parseAddress(address); } catch { return false; }
  const st = controlState(rt);
  if (parts[0]?.kind === 'view' && st.screen !== parts[0].id) return false;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if ((seg.kind !== 'tab' && seg.kind !== 'subtab') || !seg.id.includes('=')) continue;
    const eq = seg.id.indexOf('=');
    const row = formatAddress([...parts.slice(0, i), { kind: seg.kind, id: seg.id.slice(0, eq) }]);
    if (row in st.tabs && st.tabs[row] !== seg.id.slice(eq + 1)) return false;
  }
  return true;
}

/**
 * The address of where the console is now: the screen plus its deepest active tab
 * (`view:gate/tab:gate.tabs=auto-lander`, `view:settings/tab:settings.tabs=plugins/subtab:…=…`).
 */
export function hereAddress(rt: AxfRuntime): string {
  const st = controlState(rt);
  let best = `view:${st.screen}`;
  // outermost row first; a sub-tab row lives under its parent row's chosen tab, so each step goes one level deeper
  for (const [row, value] of Object.entries(st.tabs).sort((a, b) => a[0].length - b[0].length)) {
    if (row.startsWith(`${best}/`)) best = `${row}=${value}`;
  }
  return best;
}

/**
 * Keep where the console is (screen, tabs, open dialog, scroll) for the next load of this tab, so a reload (a remote
 * `console_refresh`, a new build) comes back to it instead of the home screen. Returns the address kept.
 */
export function rememberHere(rt: AxfRuntime): string {
  const address = hereAddress(rt);
  const st = controlState(rt);
  const extra: HereExtra = { address, ...(st.dialog ? { dialog: st.dialog } : {}), ...(st.scroll && st.scroll.top > 0 ? { scrollTop: st.scroll.top } : {}) };
  try {
    window.sessionStorage.setItem(STORE_KEY, address);
    window.sessionStorage.setItem(EXTRA_KEY, JSON.stringify(extra));
  } catch { /* storage blocked: the URL alone carries it */ }
  return address;
}

/** `href` with the address as its `?axf-target=` (replacing any there). */
export function withDeepLink(href: string, address: string): string {
  const u = new URL(withoutDeepLink(href));
  u.searchParams.set(DEEP_LINK_PARAM, address);
  return u.toString();
}

/** After the address landed: reopen the dialog and the scroll kept for it by rememberHere. */
async function restoreExtra(rt: AxfRuntime, address: string): Promise<void> {
  let extra: HereExtra | null = null;
  try { extra = JSON.parse(window.sessionStorage.getItem(EXTRA_KEY) ?? 'null') as HereExtra | null; window.sessionStorage.removeItem(EXTRA_KEY); } catch { /* none */ }
  if (!extra || extra.address !== address) return;
  if (extra.dialog && !rt.getState().dialog) { try { rt.openDialog(extra.dialog); } catch { /* the dialog is gone */ } }
  if (extra.scrollTop && extra.scrollTop > 1) {
    // the screen's content may still be loading: try a few times until the pane is tall enough
    for (let i = 0; i < 10; i++) {
      const a = await executeControl(rt, { verb: 'scroll', address: 'scroll:main', scroll: { dir: 'top' }, by: 'deep-link' });
      if (!a.ok) return;
      const b = await executeControl(rt, { verb: 'scroll', address: 'scroll:main', scroll: { dir: 'down', amount: extra.scrollTop }, by: 'deep-link' });
      const top = b.state.scroll?.top ?? 0;
      if (Math.abs(top - extra.scrollTop) <= 2) return;
      await wait(300);
    }
  }
}

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
    if (answer.ok && (!want || on === want) && showsAddress(rt, address)) {
      // a later boot step (restored layout, a plugin that opens its home) may still move the screen: hold it briefly
      const held = Date.now() + HOLD_MS;
      while (Date.now() < held && stillWanted()) {
        await wait(150);
        if (!showsAddress(rt, address)) { answer = await executeControl(rt, cmd); }
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
    if (answer?.ok) void restoreExtra(rt, address!);
    try { if (deepLinkFrom(window.location.href)) window.history.replaceState(window.history.state, '', withoutDeepLink(window.location.href)); } catch { /* fine */ }
    if (!answer?.ok) rt.toast(`Couldn't open ${address}: ${answer?.message ?? 'it did not load'}`, 'warning', 'Deep link');
  });
  return () => { cancelled = true; };
}
