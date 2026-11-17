/**
 * Console deep links on page load (console-control@1, framework/spec/CONSOLE-CONTROL.md):
 * `https://console…/?axf-target=<address>` opens that address once the console is up, the same way `console_show`
 * does over the relay. Any address the executor knows works: a screen (`view:build-orchestrator`), a tab
 * (`view:gate/tab:gate.tabs=auto-lander`), a row or a build step.
 *
 * The page boots in stages (account, plugin list, lazy plugin chunks), so a plugin screen is not registered on the
 * first frame: the link is retried until the screen it names is the one on show, or until it gives up. The address is
 * kept in sessionStorage until it lands, so a reload or a sign-in round trip in the same tab still arrives; axHub's wall
 * sends the browser back to the full URL, query included. Once it landed the address bar follows the console
 * (installAddressBar), so a browser refresh comes back to the same screen, tab, dialog and scroll.
 *
 * The parameter may also sit in the hash (`#/?axf-target=…`), for links that went through a router that keeps only the
 * fragment.
 */
import type { AxfRuntime } from '../axf/core';
import { CONSOLE_CONTROL_WIRE, formatAddress, parseAddress } from '../axf/core/engines/console-control';
import { controlRegistry } from '../axf/react';
import { controlState, executeControl, type ControlAnswer } from './executor';

export const DEEP_LINK_PARAM = 'axf-target';
const STORE_KEY = 'axf.console.deep-link';
/** What an address does not carry (the open dialog, the main pane's scroll), kept beside it for a reload of this tab. */
const EXTRA_KEY = 'axf.console.deep-link.extra';
interface HereExtra { address: string; dialog?: string; dialogProps?: Record<string, unknown>; scrollTop?: number }
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

/** The address cut after its last screen or tab segment (`…/tab:<row>=<value>`): the part a page load restores. */
function placeOf(parts: ReturnType<typeof parseAddress>): string {
  let end = 0;
  parts.forEach((p, i) => { if (p.kind === 'view' || ((p.kind === 'tab' || p.kind === 'subtab') && p.id.includes('='))) end = i + 1; });
  return formatAddress(parts.slice(0, Math.max(1, end)));
}

/**
 * Whether the console shows the address now: where it is (hereAddress) is the address's screen and tabs, or a
 * shallower part of it when a tab row does not say which tab is chosen. A screen that restores its own last tab after
 * mounting (a different tab) doesn't count as landed.
 */
export function showsAddress(rt: AxfRuntime, address: string): boolean {
  let place: string;
  try { place = placeOf(parseAddress(address)); } catch { return false; }
  const here = hereAddress(rt);
  if (here === place || here.startsWith(`${place}/`)) return true;
  // shallower than the link only because no tab row under `here` says which tab is chosen: as far as can be told
  return place.startsWith(`${here}/`) && !hasChosenTabUnder(rt, here);
}

/** The chosen value of every rendered tab row (row address → value), on the screen and in an open dialog. */
function tabRows(rt: AxfRuntime): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const t of controlRegistry(rt).snapshot().targets) {
    if ((t.kind !== 'tab' && t.kind !== 'subtab') || t.virtual || typeof t.value !== 'string' || !t.value) continue;
    if (t.address.slice(t.address.lastIndexOf('/') + 1).includes('=')) continue; // a single tab, not its row
    rows[t.address] = t.value;
  }
  return rows;
}

/** Whether a tab row directly under `here` reports a chosen tab (then `here` is as deep as the console is). */
function hasChosenTabUnder(rt: AxfRuntime, here: string): boolean {
  return Object.keys(tabRows(rt)).some((row) => row.startsWith(`${here}/`) && !row.slice(here.length + 1).includes('/'));
}

/**
 * Where an open dialog's content sits (Settings opens as a floating popup over the current screen, Nov 2026): the
 * screen-and-tab place most of the targets it rendered under another screen share (nav entries name bare screens and
 * don't count), or null.
 */
function dialogPlace(rt: AxfRuntime): string | null {
  const s = rt.getState();
  if (!s.dialog) return null;
  const reg = controlRegistry(rt);
  const under = `view:${s.view}/`;
  const count = new Map<string, number>();
  for (const t of reg.snapshot().targets) {
    if (t.virtual || !t.address.startsWith('view:') || t.address.startsWith(under) || !reg.entry(t.address)) continue;
    let place: string;
    try { place = placeOf(parseAddress(t.address)); } catch { continue; }
    if (!place.includes('/')) continue; // a bare screen (a nav entry), not the dialog's content
    count.set(place, (count.get(place) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [place, n] of count) if (!best || n > count.get(best)!) best = place;
  return best;
}

/**
 * The address of where the console is now: the screen (or the place an open dialog shows) plus its deepest active tab
 * (`view:gate/tab:gate.tabs=auto-lander`, `view:settings/tab:settings.tabs=plugins/subtab:…=…`).
 */
export function hereAddress(rt: AxfRuntime): string {
  let best = dialogPlace(rt) ?? `view:${rt.getState().view}`;
  // outermost row first; a sub-tab row lives under its parent row's chosen tab, so each step goes one level deeper
  for (const [row, value] of Object.entries(tabRows(rt)).sort((x, y) => x[0].length - y[0].length)) {
    if (row.startsWith(`${best}/`)) best = `${row}=${value}`;
  }
  return best;
}

/**
 * Keep where the console is (screen, tabs, open dialog, scroll) for the next load of this tab, so a reload (a remote
 * `console_refresh`, a browser refresh, a new build) comes back to it instead of the home screen. Returns the address.
 */
export function rememberHere(rt: AxfRuntime): string {
  const address = hereAddress(rt);
  const st = controlState(rt);
  const open = rt.getState().dialog;
  // a dialog's props go along only when they are plain data (an id, an arg), never callbacks
  let props: Record<string, unknown> | undefined;
  try { props = open?.props && JSON.parse(JSON.stringify(open.props)); } catch { props = undefined; }
  const extra: HereExtra = { address, ...(open ? { dialog: open.id, ...(props && Object.keys(props).length ? { dialogProps: props } : {}) } : {}), ...(st.scroll && st.scroll.top > 0 ? { scrollTop: st.scroll.top } : {}) };
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

/** After the address landed: reopen the dialog and the scroll rememberHere kept for it. */
async function restoreExtra(rt: AxfRuntime, address: string): Promise<void> {
  let extra: HereExtra | null = null;
  try { extra = JSON.parse(window.sessionStorage.getItem(EXTRA_KEY) ?? 'null') as HereExtra | null; window.sessionStorage.removeItem(EXTRA_KEY); } catch { /* none */ }
  if (!extra || extra.address !== address) return;
  if (extra.dialog && !rt.getState().dialog) { try { rt.openDialog(extra.dialog, extra.dialogProps); } catch { /* the dialog is gone */ } }
  if (extra.scrollTop && extra.scrollTop > 1) {
    // the screen's content may still be loading: try a few times until the pane is tall enough
    for (let i = 0; i < 10; i++) {
      const a = await executeControl(rt, { verb: 'scroll', address: 'scroll:main', scroll: { dir: 'top' }, by: 'deep-link' });
      if (!a.ok) return;
      const b = await executeControl(rt, { verb: 'scroll', address: 'scroll:main', scroll: { dir: 'down', amount: extra.scrollTop }, by: 'deep-link' });
      if (Math.abs((b.state.scroll?.top ?? 0) - extra.scrollTop) <= 2) return;
      await wait(300);
    }
  }
}

/**
 * Open the address and keep at it until its screen is the one on show. Resolves with the last answer (ok or not).
 * `stillWanted` lets a newer link or the person (they navigated themselves) cancel it.
 */
export async function applyDeepLink(rt: AxfRuntime, address: string, stillWanted: () => boolean = () => true, giveUpMs = GIVE_UP_MS): Promise<ControlAnswer | null> {
  const deadline = Date.now() + giveUpMs;
  const cmd = deepLinkCommand(address);
  let answer: ControlAnswer | null = null;
  for (let delay = 120; stillWanted() && Date.now() < deadline; delay = Math.min(delay * 1.6, 1500)) {
    answer = await executeControl(rt, cmd);
    if (answer.ok && showsAddress(rt, address)) {
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

/**
 * The address bar follows the console (Brett, Nov 16 2026: a browser refresh reloads exactly where he is): as he moves
 * between screens, tabs and sub-tabs the page's URL carries `?axf-target=<address>` (replaced, not pushed, so Back is
 * not flooded), and the tab's sessionStorage keeps the address with the open dialog and scroll. A reload, the sign-in
 * round trip (axHub's wall returns to the full URL) or a remote refresh then lands right there. The home screen with
 * no tab chosen keeps the bare URL.
 */
export function installAddressBar(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  const home = `view:${rt.manifest.startView ?? 'home'}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    timer = undefined;
    let address: string;
    try { address = rememberHere(rt); } catch { return; }
    try {
      const href = window.location.href;
      const next = address === home ? withoutDeepLink(href) : withDeepLink(href, address);
      if (next !== href) window.history.replaceState(window.history.state, '', next);
    } catch { /* the stored copy still carries it */ }
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(sync, 250); };
  const offState = rt.subscribe(soon);
  const offReg = controlRegistry(rt).subscribe(soon);
  // a tab's chosen value is read on demand, not pushed: a press, a key or a scroll anywhere is the cue to read again
  const opts = { capture: true, passive: true } as const;
  for (const ev of ['click', 'keyup', 'change', 'scroll'] as const) window.addEventListener(ev, soon, opts);
  const now = () => { clearTimeout(timer); sync(); };
  const onHidden = () => { if (document.visibilityState === 'hidden') now(); };
  window.addEventListener('pagehide', now);
  document.addEventListener('visibilitychange', onHidden);
  sync();
  return () => {
    clearTimeout(timer); offState(); offReg();
    for (const ev of ['click', 'keyup', 'change', 'scroll'] as const) window.removeEventListener(ev, soon, opts);
    window.removeEventListener('pagehide', now);
    document.removeEventListener('visibilitychange', onHidden);
  };
}

/**
 * Read the link from the page (or the tab's saved copy), apply it once, then let the address bar follow the console
 * (installAddressBar). Returns a remover.
 */
export function installDeepLink(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  let address = deepLinkFrom(window.location.href);
  try {
    if (address) window.sessionStorage.setItem(STORE_KEY, address);
    else address = window.sessionStorage.getItem(STORE_KEY);
  } catch { /* storage blocked: the URL alone carries it */ }
  let cancelled = false;
  let follow: (() => void) | null = null;
  const page = window as unknown as { axfConsoleHere?: () => string };
  page.axfConsoleHere = () => hereAddress(rt); // where the console is, as an address (tests, devtools)
  const remove = () => { cancelled = true; follow?.(); delete page.axfConsoleHere; };
  if (!address) { follow = installAddressBar(rt); return remove; }
  const w = window as unknown as { axfDeepLink?: { address: string; done: boolean; answer: ControlAnswer | null } };
  w.axfDeepLink = { address, done: false, answer: null };
  void applyDeepLink(rt, address, () => !cancelled).then(async (answer) => {
    if (cancelled) return;
    try { window.sessionStorage.removeItem(STORE_KEY); } catch { /* fine */ }
    if (answer?.ok) await restoreExtra(rt, address!);
    if (cancelled) return;
    // only now: following earlier would write the boot screen over the link before it landed
    follow = installAddressBar(rt);
    w.axfDeepLink = { address: address!, done: true, answer };
    if (!answer?.ok) rt.toast(`Couldn't open ${address}: ${answer?.message ?? 'it did not load'}`, 'warning', 'Deep link');
  });
  return remove;
}
