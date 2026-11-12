import { useSyncExternalStore, useState } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { followSse, sseJson, SseHttpError } from '../../../src/axf/core/sse';
import { consoleCatalogFrom, consoleMessageErrors, type ConsoleHere, type ConsoleMessage } from '../../../src/axf/core/engines/console-commands.mjs';
import type { SearchEntry } from '../../../src/axf/core/engines/search';
import { createTokenStore } from '../../../src/axf/libs/apiclient/client';
import { Button, Note, TextField, useRuntime } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { mollyApp } from '../../../src/molly/apps';
import helpPack from '../help.json';

/**
 * Remote commands (Molly, build molly-gap-remote-actions): Molly's own client on the console-commands relay. The console
 * frame inside Molly already takes remote commands (app `molly/console-web`), but a Molly-level action (molly.*,
 * navigation.*, xlayout.*, the sign-in actions) lives in Molly's runtime, which that relay never reached. This client
 * announces Molly to the console server as app `molly` with Molly's own catalog (its views and the apps' pages, its
 * settings tabs, dialogs and actions), keeps the stream open, runs each console-command@1 through Molly's runtime and
 * acks it. From then on every Molly action has the same four reaches as a console one: REST (`POST /api/console/action
 * {"id": "molly.reload", "to": "molly"}`), MCP (`console_action("molly.reload")`, `console_open("console/nav:builds",
 * to="molly")`), the CLI (`axf console action molly.reload`, `axf console list actions --to molly`) and AmberX voice
 * (which calls the same MCP tools). `to: molly` names Molly itself; without it the relay sends a command to whichever
 * open client has the thing named.
 *
 * Molly talks to the console API from its own origin with the console's bearer token, kept in this browser under the
 * same key the credential seam (molly-sign-in-once) uses, so one sign-in serves both. No token: the client waits and
 * says so in Settings → Plugins → Remote commands.
 */

export const PLUGIN_ID = 'ai.amberx.axf.molly.remote-commands';
export const FOLDER = 'remote-commands';
const TAB = FOLDER;
/** What this client announces itself as (the relay's `app`; `to: molly` reaches it). */
export const RELAY_APP = 'molly';
/** The console bearer token for Molly's origin (shared with the credential seam's `console` backend). */
export const CONSOLE_TOKEN_KEY = 'molly:console-token';
/** The credential seam's setting that overrides the console API base. */
export const CONSOLE_BASE_KEY = 'molly.auth.console.base';
const KEYS = { on: 'remote-commands.enabled', toast: 'remote-commands.toast' } as const;
const HEARTBEAT_MS = 30_000;
const CLIENT_KEY = 'axf.remote-commands.client';
const DONE_KEY = 'axf.remote-commands.done';

const tokens = createTokenStore({ key: CONSOLE_TOKEN_KEY });

/* ------------------------------------------------------------------ state the settings panel watches */

export type RelayState = 'off' | 'no-token' | 'connecting' | 'connected' | 'denied' | 'unreachable';
export interface RelayStatus { state: RelayState; client: string; base: string; hasToken: boolean; items: number; last: string; lastAt: string }

let status: RelayStatus = { state: 'off', client: '', base: '', hasToken: false, items: 0, last: '', lastAt: '' };
const watchers = new Set<() => void>();
const setStatus = (patch: Partial<RelayStatus>) => { status = { ...status, ...patch }; watchers.forEach((f) => f()); };
const watch = (f: () => void) => { watchers.add(f); return () => { watchers.delete(f); }; };
const STATE_LINE: Record<RelayState, string> = {
  off: 'Off: Molly is not listening for remote commands.',
  'no-token': 'Waiting for the console token: paste it below (or sign in to the Console in Connections).',
  connecting: 'Connecting to the console…',
  connected: 'Connected: Molly takes remote commands.',
  denied: 'The console refused the token: paste a current console token.',
  unreachable: 'The console API is not answering from Molly (offline, or it does not allow Molly’s origin yet).',
};

/* ------------------------------------------------------------------ the relay */

/** This tab's client id (kept across reloads of the tab; the relay wants 6-64 of [A-Za-z0-9_-]). */
function clientId(): string {
  try {
    const v = sessionStorage.getItem(CLIENT_KEY);
    if (v) return v;
    const n = `molly-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    sessionStorage.setItem(CLIENT_KEY, n);
    return n;
  } catch { return `molly-${Math.random().toString(36).slice(2, 12)}`; }
}

/** Commands this tab already ran (a reconnect may bring one twice). */
function doneOf(id: string): [boolean, string] | null {
  try { return (JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '{}') as Record<string, [boolean, string]>)[id] ?? null; } catch { return null; }
}
function markDone(id: string, res: [boolean, string]) {
  try {
    const all = JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '{}') as Record<string, [boolean, string]>;
    all[id] = res;
    for (const k of Object.keys(all).slice(0, Math.max(0, Object.keys(all).length - 50))) delete all[k];
    sessionStorage.setItem(DONE_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the server still delivers each command once */ }
}

/** The console origin Molly talks to: the credential seam's base override (its `/api` dropped), else the Console app's address. */
export function consoleOrigin(rt: AxfRuntime): string {
  const v = rt.settings.get(CONSOLE_BASE_KEY);
  const raw = typeof v === 'string' && /^https?:\/\//.test(v.trim()) ? v.trim() : (mollyApp('console')?.url ?? '');
  return raw.replace(/\/+$/, '').replace(/\/api$/, '');
}

const relayUrl = (rt: AxfRuntime, path: string) => `${consoleOrigin(rt)}/api/console/${path}`;

function call(rt: AxfRuntime, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = tokens.get();
  if (t) headers.set('authorization', `Bearer ${t}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(relayUrl(rt, path), { ...init, headers, cache: 'no-store' });
}
const post = (rt: AxfRuntime, path: string, body: unknown, keepalive = false) => call(rt, path, { method: 'POST', body: JSON.stringify(body), keepalive });

const who = (by?: string) => (by && !['mcp', 'console', 'unknown', 'cli'].includes(by) ? by : 'Amber');
const device = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop');

/** Where Molly is: its view (an app, one of an app's pages, or its own screen), an open dialog, the settings tab. */
function hereOf(rt: AxfRuntime): ConsoleHere {
  const s = rt.getState();
  const here: ConsoleHere = { screen: s.view };
  const label = rt.search.entries().find((e) => e.kind === 'view' && (e.focus as { view?: string }).view === s.view)?.label;
  if (label) here.screenLabel = label;
  if (s.dialog) here.dialog = s.dialog.id;
  if (s.view === 'settings') { const t = rt.settings.get('axf.settings.lastTab'); if (typeof t === 'string' && t) here.settings = t; }
  return here;
}

/** Molly's catalog: its views (the apps and their pages once xLayout has them), settings tabs, dialogs and every action. */
function catalogOf(rt: AxfRuntime) {
  const tabs = rt.settings.listTabs().map((t) => ({ kind: 'settings-tab', label: t.label, icon: t.icon, keywords: [t.description ?? '', t.parent ? `${t.parent} sub-tab` : ''], parent: t.parent, focus: { kind: 'setting', tab: t.id } }));
  const entries = [...rt.search.entries().filter((e) => e.kind === 'view' || e.kind === 'dialog'), ...tabs];
  return consoleCatalogFrom(entries, rt.actions.list(), { app: RELAY_APP, here: hereOf(rt) });
}

/** Run one message through Molly's runtime → [ok, what happened]. */
function runMessage(rt: AxfRuntime, m: ConsoleMessage, history: string[]): [boolean, string] {
  const errors = consoleMessageErrors(m);
  if (errors.length) return [false, errors.join('; ')];
  const focus = (e: SearchEntry) => rt.search.focus(e);
  switch (m.op) {
    case 'open':
      if (m.kind === 'screen') { focus({ id: `view:${m.target}`, kind: 'view', label: m.label ?? m.target!, focus: { kind: 'view', view: m.target! } }); return [rt.getState().view === m.target || !!rt.getState().dialog, `opened ${m.label ?? m.target} in Molly`]; }
      if (m.kind === 'dialog') { rt.openDialog(m.target!, m.arg ? { arg: m.arg } : undefined); return [true, `opened ${m.label ?? m.target}`]; }
      focus({ id: `settings-tab:${m.target}`, kind: 'setting', label: m.label ?? m.target!, focus: { kind: 'setting', tab: m.target!, ...(m.anchor ? { anchor: m.anchor } : {}) } });
      return [true, `opened ${m.label ?? m.target} settings in Molly`];
    case 'run':
      // the catalog already leaves person-only actions out; a stale catalog or a crafted message stops here
      if (rt.actions.list().some((a) => (a.meta as { personOnly?: boolean }).personOnly === true && a.id === m.spec!.split(':')[0])) return [false, `${m.label ?? m.spec} needs Brett's own tap`];
      return rt.dispatch(m.spec!) ? [true, `ran ${m.label ?? m.spec} in Molly`] : [false, `${m.label ?? m.spec} didn't run in Molly (no handler, or this role can't)`];
    case 'close': {
      const open = rt.getState().dialog;
      if (!open) return [true, 'no dialog was open'];
      if (m.target && open.id !== m.target && !open.id.endsWith(`:${m.target}`)) return [true, `${m.label ?? m.target} wasn't open (${open.id} is), left it`];
      rt.closeDialog();
      return [true, `closed ${m.label ?? open.id}`];
    }
    case 'home': rt.navigate(rt.manifest.startView ?? 'home'); return [true, `Molly went home (${rt.getState().view})`];
    case 'refresh': return [true, m.hard ? 'hard reloading Molly (caches cleared)' : 'reloading Molly'];
    case 'back': {
      if (rt.getState().dialog) { rt.closeDialog(); return [true, 'closed the dialog']; }
      history.pop();
      const prev = history.pop();
      if (!prev) return [false, 'no screen before this one'];
      rt.navigate(prev);
      return [true, `Molly back to ${prev}`];
    }
    default: return [false, 'unknown op'];
  }
}

async function reloadPage(hard: boolean): Promise<void> {
  if (hard) {
    try { await Promise.all((await caches.keys()).map((k) => caches.delete(k))); } catch { /* no Cache API */ }
    try { await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister())); } catch { /* none */ }
    const u = new URL(location.href);
    u.searchParams.set('axf-refresh', Date.now().toString(36));
    location.replace(u.href);
    return;
  }
  location.reload();
}

/** One relay session: hello + heartbeat + stream + acks. `stop()` ends it (bye when the page goes). */
function startRelay(rt: AxfRuntime): () => void {
  const id = clientId();
  const history: string[] = [rt.getState().view];
  let catalogKey = '';
  let stopped = false;
  let stopStream: (() => void) | null = null;
  const where = () => ({ front: rt.inFront() });
  setStatus({ state: 'connecting', client: id, base: consoleOrigin(rt), hasToken: !!tokens.get() });

  const failed = (r: Response | null) => {
    if (r && (r.status === 401 || r.status === 403)) { setStatus({ state: 'denied' }); stopStream?.(); stopStream = null; return; }
    setStatus({ state: 'unreachable' });
  };
  const announce = async (used = false) => {
    if (stopped) return;
    const catalog = catalogOf(rt);
    const key = `${catalog.items.length}:${catalog.items.map((i) => i.id).join(',').length}`;
    const unchanged = key === catalogKey && !used;
    try {
      const r = unchanged
        ? await post(rt, 'seen', { client: id, here: catalog.here, ...where() })
        : await post(rt, 'hello', { client: id, app: RELAY_APP, title: document.title, device: device(), catalog, here: catalog.here, ...where(), used });
      if (!r.ok) { failed(r); return; }
      catalogKey = key;
      if (!unchanged) setStatus({ items: catalog.items.length });
      if (status.state !== 'connected' && stopStream) setStatus({ state: 'connected' });
      if (!stopStream) openStream();
    } catch { failed(null); }
  };
  const openStream = () => {
    stopStream = followSse(
      (signal) => call(rt, `stream?client=${encodeURIComponent(id)}`, { signal }),
      (f) => {
        const m = sseJson<ConsoleMessage | { $axf: 'console-hello@1' }>(f);
        if (m?.$axf === 'console-hello@1') { catalogKey = ''; void announce(document.visibilityState === 'visible'); return; }
        if (!m || !('id' in m) || !m.id) return;
        const again = doneOf(m.id);
        if (again) { void post(rt, 'ack', { client: id, id: m.id, ok: again[0], message: again[1], here: hereOf(rt) }).catch(() => undefined); return; }
        let res: [boolean, string];
        try { res = runMessage(rt, m, history); } catch (e) { res = [false, String((e as Error)?.message ?? e)]; }
        markDone(m.id, res);
        setStatus({ last: `${res[0] ? '✓' : '✗'} ${m.op} ${m.label ?? m.target ?? m.spec ?? ''} (${who(m.by)})`, lastAt: new Date().toISOString() });
        if (res[0] && rt.settings.get(KEYS.toast) !== false) rt.toast(`${who(m.by)}: ${res[1]}`, 'info', 'Remote command');
        const acked = post(rt, 'ack', { client: id, id: m.id, ok: res[0], message: res[1], here: hereOf(rt), ...where() }).catch(() => undefined);
        if (m.op === 'refresh' && res[0]) void acked.then(() => reloadPage(m.hard === true));
      },
      {
        onOpen: () => setStatus({ state: 'connected' }),
        onDrop: (e) => { if (e instanceof SseHttpError && (e.status === 401 || e.status === 403)) { setStatus({ state: 'denied' }); stopStream?.(); stopStream = null; } else if (!stopped) setStatus({ state: 'unreachable' }); },
      },
    );
  };

  void announce(document.hasFocus());
  let lastView = rt.getState().view;
  const offState = rt.subscribe(() => {
    const v = rt.getState().view;
    if (v === lastView) return;
    lastView = v;
    if (history[history.length - 1] !== v) history.push(v);
    if (history.length > 50) history.shift();
    void post(rt, 'seen', { client: id, here: hereOf(rt) }).catch(() => undefined);
  });
  // Brett touched Molly's own chrome (a click inside an app's frame focuses that app, which reports itself)
  const used = () => { void post(rt, 'seen', { client: id, here: hereOf(rt), ...where(), used: true }).catch(() => undefined); };
  const onVisible = () => { if (rt.inFront()) used(); else void post(rt, 'seen', { client: id, ...where() }).catch(() => undefined); };
  window.addEventListener('focus', used);
  document.addEventListener('visibilitychange', onVisible);
  const beat = setInterval(() => void announce(false), HEARTBEAT_MS);
  const bye = (e: PageTransitionEvent) => { if (!e.persisted) void post(rt, 'bye', { client: id }, true).catch(() => undefined); };
  window.addEventListener('pagehide', bye);
  return () => {
    stopped = true;
    stopStream?.(); stopStream = null;
    offState(); clearInterval(beat);
    window.removeEventListener('focus', used); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pagehide', bye);
    void post(rt, 'bye', { client: id }, true).catch(() => undefined);
  };
}

/** The one client per page: runs while the setting is on and a token is there; restarts on a token or base change. */
class RelayClient {
  private stop: (() => void) | null = null;
  constructor(private rt: AxfRuntime) {}
  on(): boolean { return this.rt.settings.get(KEYS.on) !== false; }
  sync(): void {
    this.stop?.(); this.stop = null;
    if (!this.on()) { setStatus({ state: 'off', client: '', hasToken: !!tokens.get(), base: consoleOrigin(this.rt) }); return; }
    if (!tokens.get()) { setStatus({ state: 'no-token', client: '', hasToken: false, base: consoleOrigin(this.rt) }); return; }
    this.stop = startRelay(this.rt);
  }
  start(): void {
    this.sync();
    this.rt.settings.onChange(KEYS.on, () => this.sync());
    this.rt.settings.onChange(CONSOLE_BASE_KEY, () => this.sync());
    tokens.subscribe(() => this.sync());
  }
}
let client: RelayClient | null = null;

/* ------------------------------------------------------------------ Settings → Plugins → Remote commands */

const useStatus = () => useSyncExternalStore(watch, () => status, () => status);

function ConnectionPanel() {
  const rt = useRuntime();
  const s = useStatus();
  const [draft, setDraft] = useState('');
  const save = () => { if (draft.trim()) { tokens.set(draft.trim()); setDraft(''); } };
  return (
    <div className="fx-stack">
      <Note tone={s.state === 'connected' ? 'success' : s.state === 'off' || s.state === 'no-token' ? 'info' : 'warning'}>{STATE_LINE[s.state]}</Note>
      <p className="fx-muted">Console: {s.base || consoleOrigin(rt)}{s.client ? ` · client ${s.client}` : ''}{s.items ? ` · ${s.items} items` : ''}{s.last ? ` · last: ${s.last}` : ''}</p>
      <TextField label="Console token" type="password" value={draft} onChange={setDraft} placeholder={s.hasToken ? 'A token is saved in this browser' : 'Paste the console token'}
        hint="Kept in this browser only (the same token the Connections screen saves for the Console). It never leaves Molly except as the Authorization header to the console." />
      <div className="fx-form__actions">
        <Button icon="check" onClick={save} disabled={!draft.trim()}>Save token</Button>
        <Button icon="refresh" onClick={() => rt.dispatch('remote-commands.reconnect')}>Reconnect</Button>
        <Button icon="undo" onClick={() => rt.dispatch('remote-commands.forget-token')} disabled={!s.hasToken}>Forget token</Button>
      </div>
      <Note tone="info">
        Reach Molly without its screen: MCP <code>console_action("molly.reload")</code>, <code>console_open("console/nav:builds", to="molly")</code>, <code>console_list(kind="actions", to="molly")</code>;
        REST <code>POST /api/console/action {'{"id": "molly.reload", "to": "molly"}'}</code>; CLI <code>axf console action molly.reload</code>, <code>axf console list actions --to molly</code>.
        <code>to: molly</code> names Molly itself; without it a command goes to whichever open client has what it names.
      </Note>
    </div>
  );
}

function LifecyclePanel() {
  return (
    <div className="fx-stack">
      <p className="fx-muted">Remote commands is all in apps/molly/plugins/{FOLDER}. Without it, Molly's own actions can only be run inside Molly (the console inside it still takes remote commands).</p>
      <p className="fx-muted"><code>node apps/molly/plugins/{FOLDER}/install.mjs</code> · <code>node apps/molly/plugins/{FOLDER}/uninstall.mjs --all</code></p>
    </div>
  );
}

/* ------------------------------------------------------------------ the library */

const onOff = (args: string[], payload: string | undefined, current: boolean) => { const a = (args[0] ?? payload ?? '').toLowerCase(); return a === 'on' || a === 'true' ? true : a === 'off' || a === 'false' ? false : !current; };

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Remote commands',
  version: '0.1.0',
  provides: ['settings-tab:remote-commands', 'service:molly-remote-commands@1'],
  builtWith: { model: 'fable', builtAt: '2026-11-12' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    const on = rt.actions.register.bind(rt.actions);
    on('remote-commands.status', () => {
      const s = status;
      rt.toast(`${STATE_LINE[s.state]}${s.client ? ` Client ${s.client}.` : ''}`, s.state === 'connected' ? 'success' : 'info', 'Remote commands');
      return { ...s };
    }, { label: 'Remote commands status', effect: 'read' });
    on('remote-commands.reconnect', () => { client?.sync(); rt.toast('Reconnecting to the console.', 'info', 'Remote commands'); }, { label: 'Reconnect remote commands' });
    on('remote-commands.listen', (args, ctx) => { const v = onOff(args, ctx.payload, rt.settings.get(KEYS.on) !== false); rt.settings.set(KEYS.on, v); rt.toast(v ? 'Molly listens for remote commands.' : 'Molly stopped listening for remote commands.', 'info', 'Remote commands'); }, { label: 'Remote commands on / off (on | off)' });
    on('remote-commands.toasts', (args, ctx) => { const v = onOff(args, ctx.payload, rt.settings.get(KEYS.toast) !== false); rt.settings.set(KEYS.toast, v); }, { label: 'Show a note for each remote command (on | off)' });
    on('remote-commands.forget-token', () => { tokens.clear(); rt.toast('The console token is gone from this browser.', 'info', 'Remote commands'); }, { label: 'Forget the console token', effect: 'destructive' });
    if (client) return; // one client per page (StrictMode registers twice in development)
    client = new RelayClient(rt);
    client.start();
  },
  settingsTabs: [{ id: TAB, label: 'Remote commands', icon: 'radio', order: 45, parent: 'plugins', description: 'Let Claude sessions, the API, the CLI and AmberX run Molly’s own actions and open its screens.' }],
  settings: [{
    id: 'remote-commands.prefs', label: 'Remote commands', icon: 'radio', tab: TAB, order: 10,
    description: 'Molly announces itself to the console’s command relay as its own client (app molly), so molly.*, navigation.* and xlayout.* actions run from REST, MCP, the CLI and voice. Opening only navigates; an action keeps its own permission.',
    settings: [
      { key: KEYS.on, label: 'Let remote callers move Molly', kind: 'toggle', default: true, scope: 'device', description: 'Off: Molly stops listening; the console inside it still takes its own commands.' },
      { key: KEYS.toast, label: 'Show a note for each command', kind: 'toggle', default: true, scope: 'device', description: 'A short toast saying who ran what.' },
    ],
  }],
  settingsPanels: [
    { id: 'remote-commands.connection', tab: TAB, title: 'Connection', icon: 'link', order: 15, render: () => <ConnectionPanel /> },
    { id: 'remote-commands.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
  appMenu: [
    { id: 'remote-commands.view', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 60, items: [
      { id: 'remote-commands.settings', label: 'Remote commands…', icon: 'radio', action: `settings.open:${TAB}` },
    ] },
  ],
};
