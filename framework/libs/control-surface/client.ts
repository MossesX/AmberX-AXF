/**
 * Control surface client (`ai.amberx.axf.control-surface`, core part, no React): what every app on the framework runs so a
 * Claude session, the REST API or the CLI can open its screens, dialogs and settings tabs and run its actions
 * (build apps-control-surface, Brett Nov 3 2026: "Put EVERY app on the API, MCP and CLI"). Harvested from the Dev
 * Console's Console commands client (Nov 3 2026), which now runs on it.
 *
 * The app announces itself to the broker (the console server's console-commands plugin) with its catalog (its own search
 * index: screens, settings tabs and sub-tabs, dialogs, actions — plugins' too), keeps a stream open, and runs the
 * console-command@1 messages it gets through its own runtime: screens through `rt.search.focus` (so a screen a host or a
 * placement owns opens where it should), settings through `rt.search.focus` on the tab, dialogs through `rt.openDialog`,
 * actions through `rt.dispatch` (which checks the action's own `requires` against the signed-in role). Then it acks what
 * it did. Nothing else on the page changes.
 *
 * Wake (console-wake, Nov 3 2026): a command that found no client of this app waits on the broker and arrives when this
 * page says hello; a page opened by AmberX carries `?axf-cmd=<id>` and asks for that one first. A command runs once per
 * tab even if it arrives twice (reconnects), and the tab only says goodbye when the page really goes away.
 *
 * Inside a host (Molly, embed@1) the client says so: app `<host>/<app id>`, `host`, and whether the host shows its frame
 * (`front`), so a command for "the app Brett is looking at" lands where he can see it; before it runs a command while
 * hidden it asks the host to bring it forward.
 */
import type { AxfRuntime } from '../../core/runtime';
import { followSse, sseJson } from '../../core/sse';
import { consoleCatalogFrom, consoleMessageErrors, type ConsoleHere, type ConsoleItem, type ConsoleMessage } from '../../core/engines/console-commands.mjs';

export { APP_TOOLS, CONSOLE_APP, CONSOLE_TOOLS } from '../../core/engines/console-commands.mjs';
export type { ConsoleHere, ConsoleItem, ConsoleMessage } from '../../core/engines/console-commands.mjs';

export const CONTROL_SURFACE_ID = 'ai.amberx.axf.control-surface';
/** The broker every app talks to unless its transport says otherwise: the Dev Console's server. */
export const DEFAULT_BROKER = 'https://console.amberxai.com';
/** The broker's contract path (main.py CAPABILITY_MOUNTS console-commands@1). */
export const BROKER_PATH = '/api/console';
export const HEARTBEAT_MS = 30_000;
/** Settings keys (per device): listen at all, and a toast per command. */
export const CONTROL_SURFACE_KEYS = { on: 'control-surface.enabled', toast: 'control-surface.toast' } as const;

/** How the app reaches the broker: `fetch(path, init)` for `hello`, `seen`, `ack`, `bye`, `stream?client=…`. */
export interface ControlSurfaceTransport { fetch(path: string, init?: RequestInit): Promise<Response> }

export interface ControlSurfaceOptions {
  /** The app id reported (default: the runtime's manifest app.id). */
  app?: string;
  /** A transport, or the broker's base address (default DEFAULT_BROKER with the browser's own session). */
  transport?: ControlSurfaceTransport | string;
  /** The settings keys that switch this client and its toast (default CONTROL_SURFACE_KEYS; the console keeps its own). */
  keys?: { on: string; toast: string };
  /** Catalog items the app adds beyond its search index and actions (Molly: its apps as screens). */
  extraItems?: (rt: AxfRuntime) => Partial<ConsoleItem>[];
  /** What the app adds to `here` (Molly: the app on screen, IDE mode). Short values only. */
  extraHere?: (rt: AxfRuntime) => Record<string, string>;
  /** Run a message the app handles itself (its own screens); return null to let the runtime handle it. */
  run?: (rt: AxfRuntime, m: ConsoleMessage) => [boolean, string] | null;
  heartbeatMs?: number;
}

/** A transport to a broker by address: the browser's own session (cookies) signs each call. */
export function brokerTransport(base: string = DEFAULT_BROKER): ControlSurfaceTransport {
  const root = `${String(base).replace(/\/$/, '')}${BROKER_PATH}/`;
  return { fetch: (path, init = {}) => fetch(root + path.replace(/^\/+/, ''), { credentials: 'include', cache: 'no-store', ...init }) };
}

/** This tab's id (one per browser tab, kept across reloads of the tab). */
export function clientId(storageKey = 'axf.control-surface.client'): string {
  try {
    const v = sessionStorage.getItem(storageKey);
    if (v) return v;
    const n = `cc-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    sessionStorage.setItem(storageKey, n);
    return n;
  } catch { return `cc-${Math.random().toString(36).slice(2, 12)}`; }
}

/** Commands this tab already ran (id → its ack), so one that arrives again after a reconnect isn't run twice. */
const DONE_KEY = 'axf.control-surface.done';
function doneOf(id: string): [boolean, string] | null {
  try { const v = (JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '{}') as Record<string, [boolean, string]>)[id]; return v ?? null; } catch { return null; }
}
function markDone(id: string, res: [boolean, string]) {
  try {
    const all = JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '{}') as Record<string, [boolean, string]>;
    all[id] = res;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete all[k];
    sessionStorage.setItem(DONE_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the broker still delivers each queued command once */ }
}

/** The queued command this page was opened for (AmberX opens `…/?axf-cmd=<id>`); taken off the address once read. */
export function pickedCommand(): string {
  try {
    const u = new URL(window.location.href);
    const id = u.searchParams.get('axf-cmd') ?? '';
    if (!id) return '';
    u.searchParams.delete('axf-cmd');
    window.history.replaceState(window.history.state, '', u.toString());
    return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : '';
  } catch { return ''; }
}

/** Who the toast names: the session's name when it gave one, else Amber. */
export const who = (by?: string) => (by && !['mcp', 'console', 'unknown', 'cli'].includes(by) ? by : 'Amber');
/** "opened Terminal" → "opening Terminal" for a command that waited for this client. */
export const ongoing = (msg: string) => msg.replace(/^opened /, 'opening ').replace(/^ran /, 'running ');
export const device = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop');

/** Where this app is now. */
export function hereOf(rt: AxfRuntime, extra?: ControlSurfaceOptions['extraHere']): ConsoleHere {
  const s = rt.getState();
  const here: ConsoleHere = { screen: s.view };
  const label = rt.search.entries().find((e) => e.kind === 'view' && (e.focus as { view?: string }).view === s.view)?.label;
  if (label) here.screenLabel = label;
  if (s.dialog) here.dialog = s.dialog.id;
  if (s.view === 'settings') { const t = rt.settings.get('axf.settings.lastTab'); if (typeof t === 'string' && t) here.settings = t; }
  if (extra) { try { const e = extra(rt); if (e && Object.keys(e).length) here.extra = e; } catch { /* the app's extra is optional */ } }
  return here;
}

/** What this app has: its search index's screens and dialogs, every settings tab (with its parent), every action, plus the app's own items. */
export function catalogOf(rt: AxfRuntime, app: string, opts: ControlSurfaceOptions = {}) {
  const tabs = rt.settings.listTabs().map((t) => ({ kind: 'settings-tab', label: t.label, icon: t.icon, keywords: [t.description ?? '', t.parent ? `${t.parent} sub-tab` : ''], parent: t.parent, focus: { kind: 'setting', tab: t.id } }));
  const entries = [...rt.search.entries().filter((e) => e.kind === 'view' || e.kind === 'dialog'), ...tabs];
  let items: Partial<ConsoleItem>[] = [];
  if (opts.extraItems) { try { items = opts.extraItems(rt) ?? []; } catch { items = []; } }
  return consoleCatalogFrom(entries, rt.actions.list(), { app, here: hereOf(rt, opts.extraHere), items });
}

/** Run one message through the runtime; → [ok, what happened]. */
export function runMessage(rt: AxfRuntime, m: ConsoleMessage, history: string[], own?: ControlSurfaceOptions['run']): [boolean, string] {
  const errors = consoleMessageErrors(m);
  if (errors.length) return [false, errors.join('; ')];
  if (own) { const r = own(rt, m); if (r) return r; }
  switch (m.op) {
    case 'open':
      if (m.kind === 'screen') { rt.search.focus({ id: `view:${m.target}`, kind: 'view', label: m.label ?? m.target!, focus: { kind: 'view', view: m.target! } }); return [rt.getState().view === m.target || !!rt.getState().dialog, `opened ${m.label ?? m.target}`]; }
      if (m.kind === 'dialog') { rt.openDialog(m.target!, m.arg ? { arg: m.arg } : undefined); return [true, `opened ${m.label ?? m.target}`]; }
      rt.search.focus({ id: `settings-tab:${m.target}`, kind: 'setting', label: m.label ?? m.target!, focus: { kind: 'setting', tab: m.target!, ...(m.anchor ? { anchor: m.anchor } : {}) } });
      return [true, `opened ${m.label ?? m.target} settings`];
    case 'run': return rt.dispatch(m.spec!) ? [true, `ran ${m.label ?? m.spec}`] : [false, `${m.label ?? m.spec} didn't run here (no handler, or this role can't)`];
    case 'close': {
      const open = rt.getState().dialog;
      if (!open) return [true, 'no dialog was open'];
      // a named dialog closes only when it is the one open (a placed copy's id ends with it)
      if (m.target && open.id !== m.target && !open.id.endsWith(`:${m.target}`)) return [true, `${m.label ?? m.target} wasn't open (${open.id} is), left it`];
      rt.closeDialog();
      return [true, `closed ${m.label ?? open.id}`];
    }
    case 'home': rt.navigate(rt.manifest.startView ?? 'home'); return [true, `went home (${rt.getState().view})`];
    case 'back': {
      if (rt.getState().dialog) { rt.closeDialog(); return [true, 'closed the dialog']; }
      history.pop(); // the screen we're on
      const prev = history.pop();
      if (!prev) return [false, 'no screen before this one'];
      rt.navigate(prev);
      return [true, `back to ${prev}`];
    }
    default: return [false, 'unknown op'];
  }
}

/**
 * Start this page's client: hello with the catalog, heartbeats, the stream, running + acking commands. → stop().
 * Does nothing (and returns a no-op) outside a browser.
 */
export function startControlSurface(rt: AxfRuntime, opts: ControlSurfaceOptions = {}): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const keys = opts.keys ?? CONTROL_SURFACE_KEYS;
  const transport = typeof opts.transport === 'string' || opts.transport === undefined ? brokerTransport(opts.transport) : opts.transport;
  const post = (path: string, body: unknown, keepalive = false) => transport.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive });
  const id = clientId();
  const appId = opts.app || rt.manifest.app.id;
  // Inside a host (Molly) the app says so: `<host>/<app>`, and whether the host shows its frame now (`front`), so a
  // command for "the app Brett is using" comes here only while he can see it.
  const host = rt.embedded?.host ?? '';
  const app = host ? `${host}/${appId}` : appId;
  const where = () => ({ front: rt.inFront(), ...(host ? { host } : {}) });
  const history: string[] = [rt.getState().view];
  let catalogKey = '';
  let pick = pickedCommand();
  const announce = (used = false) => {
    const catalog = catalogOf(rt, app, opts);
    const key = `${catalog.items.length}:${catalog.items.map((i) => i.id).join(',').length}`;
    if (key === catalogKey && !used) return post('seen', { client: id, here: catalog.here, ...where() }).catch(() => undefined);
    catalogKey = key;
    const body = { client: id, app, title: document.title, device: device(), catalog, here: catalog.here, ...where(), used: used || !!pick, ...(pick ? { pick } : {}) };
    pick = '';
    return post('hello', body).catch(() => undefined);
  };
  void announce(document.hasFocus());
  let lastView = rt.getState().view;
  const offState = rt.subscribe(() => {
    const v = rt.getState().view;
    if (v !== lastView) { lastView = v; if (history[history.length - 1] !== v) history.push(v); if (history.length > 50) history.shift(); void post('seen', { client: id, here: hereOf(rt, opts.extraHere) }).catch(() => undefined); }
  });
  const used = () => { void post('seen', { client: id, here: hereOf(rt, opts.extraHere), ...where(), used: true }).catch(() => undefined); };
  const onVisible = () => { if (rt.inFront()) used(); else void post('seen', { client: id, ...where() }).catch(() => undefined); };
  // the host showed or hid this app's frame (Molly switched apps): showing it means Brett is using it now
  const offFront = rt.onFront(onVisible);
  window.addEventListener('focus', used);
  document.addEventListener('visibilitychange', onVisible);
  const beat = setInterval(() => void announce(false), opts.heartbeatMs ?? HEARTBEAT_MS);
  // Only when the page really goes away (not into the back/forward cache, not a React re-render): a bye makes the
  // broker stop sending here at once.
  const bye = (e: PageTransitionEvent) => { if (!e.persisted) void post('bye', { client: id }, true).catch(() => undefined); };
  window.addEventListener('pagehide', bye);
  const stop = followSse(
    (signal) => transport.fetch(`stream?client=${encodeURIComponent(id)}`, { signal }),
    (f) => {
      const m = sseJson<ConsoleMessage | { $axf: 'console-hello@1' }>(f);
      // the broker restarted and lost this client's catalog: say hello again so commands resolve here
      if (m?.$axf === 'console-hello@1') { catalogKey = ''; void announce(document.visibilityState === 'visible'); return; }
      if (!m || !('id' in m) || !m.id) return;
      const again = doneOf(m.id);
      if (again) { void post('ack', { client: id, id: m.id, ok: again[0], message: again[1], here: hereOf(rt, opts.extraHere) }).catch(() => undefined); return; }
      // inside a host, bring this app's frame to the front first, so Brett sees the command happen
      if (host && !rt.inFront()) rt.bringToFront(`${who(m.by)}: ${m.label ?? m.target ?? m.op}`);
      let res: [boolean, string];
      try { res = runMessage(rt, m, history, opts.run); } catch (e) { res = [false, String((e as Error)?.message ?? e)]; }
      markDone(m.id, res);
      if (res[0] && rt.settings.get(keys.toast) !== false) rt.toast(`${who(m.by)}: ${m.delivery ? ongoing(res[1]) : res[1]}`, 'info', 'Remote control');
      void post('ack', { client: id, id: m.id, ok: res[0], message: res[1], here: hereOf(rt, opts.extraHere), ...where() }).catch(() => undefined);
    },
  );
  return () => { stop(); offState(); offFront(); clearInterval(beat); window.removeEventListener('focus', used); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pagehide', bye); };
}

/**
 * Keep the client running while the app's setting says so (on by default), restarting it when the switch flips.
 * → stop() for the page's life.
 */
export function installControlSurface(rt: AxfRuntime, opts: ControlSurfaceOptions = {}): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const keys = opts.keys ?? CONTROL_SURFACE_KEYS;
  let stop: (() => void) | null = null;
  const apply = () => {
    const on = rt.settings.get(keys.on) !== false;
    if (on && !stop) stop = startControlSurface(rt, opts);
    else if (!on && stop) { stop(); stop = null; }
  };
  apply();
  const off = rt.settings.subscribe(apply);
  return () => { off(); if (stop) { stop(); stop = null; } };
}
