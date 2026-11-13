/**
 * The console inside the Android console app (apps/console-droid, Brett Nov 13 2026: "make the console an Android app,
 * just a wrapper for the web app, keep it floating on top; AmberX's banner was behind the camera, the clock and the
 * notification panel").
 *
 * - `?axf-open=<target>` (every browser): the shell's deep links `axf-console://open/<target>` land here; a
 *   console-control@1 address opens through the control executor, an action id runs (never a person-only one).
 * - When the shell's `window.axfNativeHost` is there:
 *   - `window.axfNative`: the host with parsed answers, plus `on(type, fn)` for its events (devtools, e2e, plugins);
 *   - safe area: once the framework CSS declares the --fx-safe-* tokens the page says it pads itself, and the shell
 *     sets the real status bar / cutout / navigation bar / keyboard sizes on <html>;
 *   - look: the native floating toolbar gets the live --fx-* tokens on load and on every skin change;
 *   - overlay: the console's `approvals-banner.overlay.*` settings and the `approvals.waiting` count go to the
 *     floating toolbar; dragging the toolbar saves its new edge / height back into those settings.
 * - `native.*` console actions (nativeRules.mjs NATIVE_ACTIONS) run every native feature, so REST
 *   (`POST /api/console/action`), MCP (`console_action`), the CLI (`axf console action native.overlay:expand`) and voice
 *   reach the phone the same way.
 * - Web content updates: the shell compares the page's entry bundle with the live console's and reloads off screen;
 *   on screen it sends `shell.update` and the console shows its "Reload for the new version" bar (native.update). Outside the app they say the phone app isn't here.
 */
import type { AxfRuntime } from '../axf/core';
import { executeControl, describeAnswer } from '../control/executor';
import { controlRegistry } from '../axf/react';
import { loader } from '../pluginLoader';
import {
  APPROVALS_TARGET, NATIVE_ACTIONS, OVERLAY_SETTING_PREFIX, WAITING_BADGE,
  PHONE_APP_ADDRESS, nativeCall, openTarget, overlayConfig, pageHandlesInsets, parseAnswer, themeTokens,
} from './nativeRules.mjs';
import { PERIOD_MS, decide, due, entryOf, pathOf } from './liveUpdate.mjs';
import { WRAPPER_ATTR, browserCapabilities, browserPlan, wrapperEnv } from './browserFallback.mjs';

/** The shell's Java bridge (`NativeBridge`): every method answers a JSON string. */
export interface AxfNativeHost {
  info(): string; permissions(): string; requestPermission(name: string): string;
  notify(json: string): string; cancelNotification(id: string): string;
  openUrl(url: string, where: string): string; wake(): string;
  overlay(verb: string): string; overlayState(): string; overlayConfigure(json: string): string;
  overlayApprovals(count: number, held: number, firstTitle: string): string;
  theme(json: string): string; insets(): string; insetsHandled(handled: boolean): string;
  recorder?(verb: string): string; update?(verb: string): string;
}

export type NativeAnswer = { ok: boolean; error?: string; [k: string]: unknown };
type Listener = (data: unknown) => void;

export interface AxfNative {
  available: true;
  call(method: string, ...args: unknown[]): NativeAnswer;
  state(): NativeAnswer;
  on(type: string, fn: Listener): () => void;
}

declare global {
  interface Window { axfNativeHost?: AxfNativeHost; axfNative?: AxfNative }
}

export const nativeHost = (): AxfNativeHost | null => (typeof window !== 'undefined' && window.axfNativeHost ? window.axfNativeHost : null);

/** One host call with a parsed answer; a missing method or a throw is an answer too. */
export function callNative(method: string, ...args: unknown[]): NativeAnswer {
  const h = nativeHost() as unknown as Record<string, (...a: unknown[]) => string> | null;
  if (!h) return { ok: false, error: 'the Android console app is not running this page' };
  if (typeof h[method] !== 'function') return { ok: false, error: `this app version has no ${method} (update the console app)` };
  try { return parseAnswer(h[method]!(...args)) as NativeAnswer; } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e) }; }
}

/** Everything the phone app knows, in one answer (native.state, axfNative.state()). */
export function nativeState(): NativeAnswer {
  const info = callNative('info');
  if (!info.ok) return info;
  const perms = callNative('permissions'), overlay = callNative('overlayState'), insets = callNative('insets'), update = callNative('update', 'state');
  return { ...info, ok: true, permissions: perms.permissions, overlay: overlay.overlay, canDraw: overlay.canDraw, insets: insets.insets, update: update.update };
}

/** Runs `?axf-open=` once on load (any browser). */
function runDeepLink(rt: AxfRuntime): void {
  const t = openTarget(window.location.href);
  if (!t) return;
  window.history.replaceState(window.history.state, '', t.rest);
  if (t.kind === 'none') return;
  setTimeout(() => {
    if (t.kind === 'address') {
      void executeControl(rt, { verb: 'open', address: t.target, by: 'deep-link' }).then((a) => { if (!a.ok) rt.toast(describeAnswer(a), 'warning', 'Open'); });
      return;
    }
    const id = t.target.split(':')[0]!;
    const known = rt.actions.list().find((a) => a.id === id);
    if (!known) { rt.toast(`Nothing called "${t.target}" to open here`, 'warning', 'Open'); return; }
    if (known.meta.personOnly) { rt.toast(`${known.meta.label} needs your own tap`, 'warning', 'Open'); return; }
    rt.dispatch(t.target);
  }, 300);
}

/** Wires the page to the phone app. Returns a remover. */
export function installNative(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  runDeepLink(rt);
  const offs: Array<() => void> = [];
  // <html data-axf-wrapper="app|browser">: CSS and plugins can tell the console app from a browser
  document.documentElement.setAttribute(WRAPPER_ATTR, wrapperEnv(window).mode);

  // native.* actions everywhere: outside the app they answer that the app isn't here
  for (const a of NATIVE_ACTIONS) {
    offs.push(rt.actions.register(a.id, (args) => {
      // part 1's synchronous host runs native.*; without it (a browser, or a shell with only part 3's bridge) the
      // browser's own way is used, so no action ever dead-ends on a missing host
      if (!nativeHost()) { void runInBrowser(rt, a.id, args); return; }
      const c = nativeCall(a.id, args);
      if ('error' in c) { rt.toast(c.error, 'warning', 'Phone'); return; }
      const r = c.call === 'state' ? nativeState() : callNative(c.call, ...c.args);
      rt.toast(r.ok ? describeNative(a.id, r) : String(r.error ?? 'failed'), r.ok ? 'success' : 'warning', 'Phone');
    }, { label: a.label, params: a.params, module: 'console.native', effect: a.id === 'native.state' ? 'read' : 'write' }));
  }

  // the phone app's state for every API: `state` on panel:phone-app (REST /api/console/control, MCP console_control,
  // `axf console control state panel:phone-app`); outside the app it answers that the app isn't here
  offs.push(controlRegistry(rt).register({
    address: PHONE_APP_ADDRESS, kind: 'panel', label: 'Android console app', detail: 'Phone · floating toolbar, permissions, safe area',
    icon: 'smartphone', keywords: ['phone', 'android', 'native', 'overlay', 'toolbar', 'app'], can: ['state'],
    state: () => ({ native: nativeState(), env: wrapperEnv(window), browser: browserCapabilities(window) }),
  }));

  // an open page follows the live deploy by itself unless the shell does it natively (part 1's ContentUpdate)
  if (typeof nativeHost()?.update !== 'function') offs.push(installLiveUpdate());

  const host = nativeHost();
  if (!host) return () => offs.forEach((f) => f());

  const listeners = new Map<string, Set<Listener>>();
  const onEvent = (e: Event) => {
    const d = (e as CustomEvent<{ type?: string; data?: unknown }>).detail ?? {};
    listeners.get(String(d.type))?.forEach((fn) => fn(d.data));
  };
  window.addEventListener('axf-native', onEvent);
  offs.push(() => window.removeEventListener('axf-native', onEvent));
  const on = (type: string, fn: Listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
    return () => { listeners.get(type)?.delete(fn); };
  };
  window.axfNative = { available: true, call: callNative, state: nativeState, on };
  offs.push(() => { delete window.axfNative; });

  const css = () => getComputedStyle(document.documentElement);
  // safe area: the page pads itself once its CSS has the tokens (an older console never claims it, the shell pads it)
  callNative('insetsHandled', pageHandlesInsets((t: string) => css().getPropertyValue(t)));

  // look, overlay settings and the approvals count, sent again only when they change
  let lastTheme = '', lastConfig = '', lastWaiting = -1;
  const sync = () => {
    const theme = JSON.stringify(themeTokens((t: string) => css().getPropertyValue(t)));
    if (theme !== lastTheme && theme !== '{}') { lastTheme = theme; callNative('theme', theme); }
    const cfg = JSON.stringify(overlayConfig((k: string) => (rt.settings.spec(k) ? rt.settings.get(k) : undefined)));
    if (cfg !== lastConfig && cfg !== '{}') { lastConfig = cfg; callNative('overlayConfigure', cfg); }
    const waiting = rt.badge(WAITING_BADGE);
    // the count is all the badge carries: every waiting item may pop the bar ("held" counts them all), the title is generic
    if (waiting !== lastWaiting) { lastWaiting = waiting; callNative('overlayApprovals', waiting, waiting, ''); }
  };
  sync();
  let queued = false;
  offs.push(rt.subscribe(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sync(); }); }));

  // the toolbar was dragged: its place is the console's own setting
  offs.push(on('overlay.moved', (d) => {
    const m = d as { edge?: string; top?: number };
    if (m.edge && rt.settings.spec(`${OVERLAY_SETTING_PREFIX}edge`)) rt.settings.set(`${OVERLAY_SETTING_PREFIX}edge`, m.edge as never);
    if (typeof m.top === 'number' && rt.settings.spec(`${OVERLAY_SETTING_PREFIX}top`)) rt.settings.set(`${OVERLAY_SETTING_PREFIX}top`, m.top as never);
  }));
  // a newer console is live while this page is on screen: the console's own "Reload for the new version" bar
  // (off screen the shell reloads by itself)
  offs.push(on('shell.update', () => loader.markStale()));
  // the approval bar's link and the overlay's "approvals" verb: the approvals list opens in this page (no reload)
  offs.push(on('approvals.open', () => { if (rt.actions.list().some((a) => a.id === APPROVALS_TARGET)) rt.dispatch(APPROVALS_TARGET); }));
  return () => offs.forEach((f) => f());
}

/** The page's own update check (liveUpdate.mjs): what it runs, what is live, when it last looked. */
const liveState = { loaded: '', live: '', checkedAt: 0, action: 'none' as string };

function loadedEntry(): string {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return el ? pathOf(el.getAttribute('src')) : '';
}

/** Reads the live index.html (never from a cache) and acts on a newer entry bundle. */
async function checkLive(forced = false): Promise<typeof liveState> {
  const now = Date.now();
  if (!due(liveState.checkedAt, now, forced)) return liveState;
  liveState.checkedAt = now;
  liveState.loaded ||= loadedEntry();
  try {
    const r = await fetch(import.meta.env.BASE_URL, { cache: 'no-store', credentials: 'same-origin' });
    if (r.ok) liveState.live = entryOf(await r.text());
  } catch { return liveState; }
  liveState.action = decide({ loaded: liveState.loaded, live: liveState.live, hidden: document.hidden, wrapper: wrapperEnv(window).wrapper });
  if (liveState.action === 'reload') window.location.reload();
  else if (liveState.action === 'notify') loader.markStale();
  return liveState;
}

/** Checks when the page comes back on screen and every PERIOD_MS; returns a remover. */
function installLiveUpdate(): () => void {
  liveState.loaded = loadedEntry();
  liveState.checkedAt = Date.now();
  const onVis = () => { void checkLive(); };
  document.addEventListener('visibilitychange', onVis);
  const timer = window.setInterval(() => { void checkLive(); }, PERIOD_MS);
  return () => { document.removeEventListener('visibilitychange', onVis); window.clearInterval(timer); };
}

/** A native.* action in a plain browser: the web's own way where there is one, a plain "needs the app" where not. */
async function runInBrowser(rt: AxfRuntime, id: string, args: unknown): Promise<void> {
  const say = (msg: string, ok: boolean) => rt.toast(msg, ok ? 'success' : 'warning', 'Browser');
  const p = browserPlan(id, args as string[] | undefined, window.location.origin) as Record<string, string> & { error?: string; do?: string };
  if (p.error) { say(p.error, false); return; }
  try {
    switch (p.do) {
      case 'notify': {
        const N = window.Notification;
        if (!N) { say(`${p.title}${p.text ? `: ${p.text}` : ''}`, true); return; }
        const perm = N.permission === 'default' ? await N.requestPermission() : N.permission;
        if (perm === 'granted') { new N(p.title!, { body: p.text }); say('Notification shown', true); }
        else say(`${p.title}${p.text ? `: ${p.text}` : ''}`, true);
        return;
      }
      case 'open': { window.open(p.url, p.target, 'noopener'); return; }
      case 'permission': {
        if (p.name === 'notifications') {
          const r = window.Notification ? await window.Notification.requestPermission() : 'unsupported';
          say(`Notifications: ${r}`, r === 'granted'); return;
        }
        if (p.name === 'mic') {
          const st = await navigator.mediaDevices.getUserMedia({ audio: true });
          st.getTracks().forEach((t) => t.stop());
          say('Microphone allowed', true); return;
        }
        say(`${p.name} has no browser permission`, false); return;
      }
      case 'focus': { window.focus(); return; }
      case 'update': {
        if (p.verb === 'reload') { window.location.reload(); return; }
        const u = p.verb === 'check' ? await checkLive(true) : liveState;
        say(u.live && u.live !== u.loaded ? `A newer console is live (${u.live})` : `This console is current (${u.loaded || 'page'})`, true); return;
      }
      case 'state': {
        const c = browserCapabilities(window);
        say(`Browser (no console app): notifications ${c.notifications}, mic ${c.mic ? 'available' : 'unavailable'}`, true); return;
      }
      default: say(`${id} needs the Android console app`, false);
    }
  } catch (e) { say(String((e as Error)?.message ?? e), false); }
}

function describeNative(id: string, r: NativeAnswer): string {
  switch (id) {
    case 'native.state': return `Console app ${String(r.version ?? '')}: overlay ${(r.overlay as { state?: string } | undefined)?.state ?? 'off'}`;
    case 'native.open': return `Opened ${String(r.opened ?? '')}`;
    case 'native.update': { const u = (r.update ?? {}) as { loaded?: string; live?: string; pending?: boolean }; return u.pending ? `New console ${u.live ?? ''} ready: reloading` : `Console ${u.loaded || 'page'} is current (checking now)`; }
    default: return 'Done on the phone';
  }
}
