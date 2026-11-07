/**
 * Console commands (web part). Every open console tab announces itself to the console server with its catalog (its own
 * search index: screens, settings tabs and sub-tabs, dialogs, actions — plugins' too), keeps a stream open, and runs the
 * console-command@1 messages it gets through its own runtime: screens through `rt.search.focus` (so a screen a host or a
 * placement owns opens where it should), settings through `settings.open:<tab>`, dialogs through `rt.openDialog`,
 * actions through `rt.dispatch` (which checks the action's own `requires` against the signed-in role). Then it acks
 * what it did. Brett's open console goes where a Claude session says, and nothing else on the page changes.
 *
 * Console wake (Nov 3 2026): a command that found no open console waits on the server and arrives when this tab says
 * hello; a tab opened by AmberX carries `?axf-cmd=<id>` and asks for that one first. A command is run once per tab even
 * if it arrives twice (reconnects), and the tab only says goodbye when the page really goes away (not when React
 * re-renders it, which used to make the server drop the console for a moment and lose a command).
 *
 * Settings → Plugins → Console commands: on / off for this console, a toast per command, waking through AmberX, how long
 * a command waits, the browser AmberX opens, the open consoles, waiting and last commands.
 */
import { useEffect, useState } from 'react';
import { Button, Container, Note, SelectField, Switch, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { followSse, sseJson } from '@console/axf/core/sse';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './console-commands.css';
import { consoleCatalogFrom, consoleMessageErrors, type ConsoleHere, type ConsoleMessage } from '@console/axf/core/engines/console-commands.mjs';

const FOLDER = 'console-commands';
const ID = 'ai.amberx.axf.console.console-commands';
const KEYS = { on: 'console-commands.enabled', toast: 'console-commands.toast' } as const;
const HEARTBEAT_MS = 30_000;

/** This tab's id (one per browser tab, kept across reloads of the tab). */
function clientId(): string {
  const k = 'axf.console-commands.client';
  try {
    const v = sessionStorage.getItem(k);
    if (v) return v;
    const n = `cc-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    sessionStorage.setItem(k, n);
    return n;
  } catch { return `cc-${Math.random().toString(36).slice(2, 12)}`; }
}

/** Commands this tab already ran (id → its ack), so one that arrives again after a reconnect isn't run twice. */
const DONE_KEY = 'axf.console-commands.done';
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
  } catch { /* storage unavailable: the server still delivers each queued command once */ }
}

/** The queued command this page was opened for (AmberX opens `…/?axf-cmd=<id>`); taken off the address once read. */
function pickedCommand(): string {
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
const who = (by?: string) => (by && !['mcp', 'console', 'unknown', 'cli'].includes(by) ? by : 'Amber');
/** "opened Terminal" → "opening Terminal" for a command that waited for this console. */
const ongoing = (msg: string) => msg.replace(/^opened /, 'opening ').replace(/^ran /, 'running ');

const device = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop');
const post = (path: string, body: unknown, keepalive = false) => pluginFetch(FOLDER, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive });

/** Where this console is now. */
function hereOf(rt: AxfRuntime): ConsoleHere {
  const s = rt.getState();
  const here: ConsoleHere = { screen: s.view };
  const label = rt.search.entries().find((e) => e.kind === 'view' && (e.focus as { view?: string }).view === s.view)?.label;
  if (label) here.screenLabel = label;
  if (s.dialog) here.dialog = s.dialog.id;
  if (s.view === 'settings') { const t = rt.settings.get('axf.settings.lastTab'); if (typeof t === 'string' && t) here.settings = t; }
  return here;
}

/** What this console has: its search index's screens and dialogs, every settings tab (with its parent), every action. */
function catalogOf(rt: AxfRuntime) {
  const tabs = rt.settings.listTabs().map((t) => ({ kind: 'settings-tab', label: t.label, icon: t.icon, keywords: [t.description ?? '', t.parent ? `${t.parent} sub-tab` : ''], parent: t.parent, focus: { kind: 'setting', tab: t.id } }));
  const entries = [...rt.search.entries().filter((e) => e.kind === 'view' || e.kind === 'dialog'), ...tabs];
  return consoleCatalogFrom(entries, rt.actions.list(), { app: 'console-web', here: hereOf(rt) });
}

/**
 * Reloads this page: soft is a plain reload; hard clears the page's caches and service workers first, then reloads
 * past the HTTP cache with a one-time query value.
 */
async function reloadPage(hard: boolean): Promise<void> {
  if (hard) {
    try { await Promise.all((await caches.keys()).map((k) => caches.delete(k))); } catch { /* no Cache API here */ }
    try { await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister())); } catch { /* none */ }
    const u = new URL(location.href);
    u.searchParams.set('axf-refresh', Date.now().toString(36));
    location.replace(u.href);
    return;
  }
  location.reload();
}

/** Run one message; → [ok, what happened]. */
function runMessage(rt: AxfRuntime, m: ConsoleMessage, history: string[]): [boolean, string] {
  const errors = consoleMessageErrors(m);
  if (errors.length) return [false, errors.join('; ')];
  switch (m.op) {
    case 'open':
      if (m.kind === 'screen') {
        // a window that names itself a screen (the Terminal): the action that opens it (meta.screen)
        const win = rt.actions.list().find((a) => a.meta.screen === m.target && !a.meta.personOnly);
        if (win) return [rt.dispatch(win.id), `opened ${m.label ?? m.target}`];
        rt.search.focus({ id: `view:${m.target}`, kind: 'view', label: m.label ?? m.target!, focus: { kind: 'view', view: m.target! } }); return [rt.getState().view === m.target || !!rt.getState().dialog, `opened ${m.label ?? m.target}`];
      }
      if (m.kind === 'dialog') { rt.openDialog(m.target!, m.arg ? { arg: m.arg } : undefined); return [true, `opened ${m.label ?? m.target}`]; }
      rt.search.focus({ id: `settings-tab:${m.target}`, kind: 'setting', label: m.label ?? m.target!, focus: { kind: 'setting', tab: m.target!, ...(m.anchor ? { anchor: m.anchor } : {}) } });
      return [true, `opened ${m.label ?? m.target} settings`];
    case 'run':
      // the catalog already leaves these out; a stale catalog or a crafted message stops here
      if (rt.actions.list().some((a) => a.meta.personOnly === true && a.id === m.spec!.split(':')[0])) return [false, `${m.label ?? m.spec} needs Brett's own tap`];
      return rt.dispatch(m.spec!) ? [true, `ran ${m.label ?? m.spec}`] : [false, `${m.label ?? m.spec} didn't run here (no handler, or this role can't)`];
    case 'close': {
      const open = rt.getState().dialog;
      if (!open) return [true, 'no dialog was open'];
      // a named dialog closes only when it is the one open (a placed copy's id ends with it)
      if (m.target && open.id !== m.target && !open.id.endsWith(`:${m.target}`)) return [true, `${m.label ?? m.target} wasn't open (${open.id} is), left it`];
      rt.closeDialog();
      return [true, `closed ${m.label ?? open.id}`];
    }
    case 'home': rt.navigate(rt.manifest.startView ?? 'home'); return [true, `went home (${rt.getState().view})`];
    case 'refresh': return [true, m.hard ? 'hard reloading (caches cleared)' : 'reloading']; // after the ack: see reloadPage
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

/** Mounted once on the page (slot app.frame.cover), draws nothing. */
function ConsoleCommandsClient() {
  const rt = useRuntime();
  const [on, setOn] = useState(() => rt.settings.get(KEYS.on) !== false);
  useEffect(() => rt.settings.subscribe(() => setOn(rt.settings.get(KEYS.on) !== false)), [rt]);
  useEffect(() => {
    if (!on || typeof window === 'undefined') return;
    const id = clientId();
    // Inside a host (Molly) this console says so: app `molly/console-web`, and whether the host shows its frame now
    // (`front`), so a command for "the console Brett is using" comes here only while he can see it.
    const host = rt.embedded?.host ?? '';
    const app = host ? `${host}/console-web` : 'console-web';
    const where = () => ({ front: rt.inFront(), ...(host ? { host } : {}) });
    const history: string[] = [rt.getState().view];
    let catalogKey = '';
    let pick = pickedCommand();
    const announce = (used = false) => {
      const catalog = catalogOf(rt);
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
      if (v !== lastView) { lastView = v; if (history[history.length - 1] !== v) history.push(v); if (history.length > 50) history.shift(); void post('seen', { client: id, here: hereOf(rt) }).catch(() => undefined); }
    });
    const used = () => { void post('seen', { client: id, here: hereOf(rt), ...where(), used: true }).catch(() => undefined); };
    const onVisible = () => { if (rt.inFront()) used(); else void post('seen', { client: id, ...where() }).catch(() => undefined); };
    // the host showed or hid this console's frame (Molly switched apps): showing it means Brett is using it now
    const offFront = rt.onFront(onVisible);
    window.addEventListener('focus', used);
    document.addEventListener('visibilitychange', onVisible);
    const beat = setInterval(() => void announce(false), HEARTBEAT_MS);
    // Only when the page really goes away (not into the back/forward cache, not a React re-render): a bye makes the
    // server stop sending here at once.
    const bye = (e: PageTransitionEvent) => { if (!e.persisted) void post('bye', { client: id }, true).catch(() => undefined); };
    window.addEventListener('pagehide', bye);
    const stop = followSse(
      (signal) => pluginFetch(FOLDER, `stream?client=${encodeURIComponent(id)}`, { signal }),
      (f) => {
        const m = sseJson<ConsoleMessage | { $axf: 'console-hello@1' }>(f);
        // the server restarted and lost this console's catalog: say hello again so commands resolve here
        if (m?.$axf === 'console-hello@1') { catalogKey = ''; void announce(document.visibilityState === 'visible'); return; }
        if (!m || !('id' in m) || !m.id) return;
        const again = doneOf(m.id);
        if (again) { void post('ack', { client: id, id: m.id, ok: again[0], message: again[1], here: hereOf(rt) }).catch(() => undefined); return; }
        // inside a host, bring this console's frame to the front first, so Brett sees the command happen
        if (host && !rt.inFront()) rt.bringToFront(`${who(m.by)}: ${m.label ?? m.target ?? m.op}`);
        let res: [boolean, string];
        try { res = runMessage(rt, m, history); } catch (e) { res = [false, String((e as Error)?.message ?? e)]; }
        markDone(m.id, res);
        if (res[0] && rt.settings.get(KEYS.toast) !== false) rt.toast(`${who(m.by)}: ${m.delivery ? ongoing(res[1]) : res[1]}`, 'info', 'Console command');
        const acked = post('ack', { client: id, id: m.id, ok: res[0], message: res[1], here: hereOf(rt), ...where() }).catch(() => undefined);
        if (m.op === 'refresh' && res[0]) void acked.then(() => reloadPage(m.hard === true)); // the caller hears first, then the page goes
      },
    );
    return () => { stop(); offState(); offFront(); clearInterval(beat); window.removeEventListener('focus', used); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pagehide', bye); };
  }, [rt, on]);
  return null;
}

interface ClientRow { id: string; app?: string; front?: boolean; device: string; user: string; lastUsed: number; live: boolean; here: ConsoleHere; items: number }
interface RecentRow { at: string; by: string; target: string; path: string; action: string; ok: boolean; message: string; how?: string; delivered: { client: string; ok: boolean; message: string }[] }
interface QueueRow { id: string; state: string; at: string; expiresAt: string; path: string; action: string; by: string; wake: { sent: boolean; message: string } | null }
interface WakeSettings { wake: boolean; ttlS: number; browser: 'chrome' | 'default' }

const TTL_CHOICES = [30, 60, 120, 300, 600, 900].map((s) => ({ value: String(s), label: s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? '' : 's'}` }));

/** Settings → Plugins → Console commands: what happens when no console is open (kept on the console server). */
function WakePanel() {
  const [cfg, setCfg] = useState<WakeSettings | null>(null);
  const [owner, setOwner] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    pluginFetch(FOLDER, 'settings').then((r) => r.json()).then((j: { settings: WakeSettings; owner: boolean }) => { setCfg(j.settings); setOwner(j.owner); }, () => setErr('The Console commands server part is not answering.'));
  }, []);
  const save = (change: Partial<WakeSettings>) => post('settings', change).then((r) => r.json()).then((j: { settings?: WakeSettings; detail?: string }) => {
    if (j.settings) { setCfg(j.settings); setErr(''); } else setErr(j.detail ?? 'Not saved.');
  }, () => setErr('Not saved: the server part is not answering.'));
  if (!cfg) return err ? <Note tone="warning">{err}</Note> : <p className="axf-cc__muted">Loading…</p>;
  return (
    <div className="fx-stack">
      {err && <Note tone="warning">{err}</Note>}
      <Switch label="Wake the console through AmberX when it's closed" checked={cfg.wake} disabled={!owner} onChange={(on) => void save({ wake: on })}
        hint="A command that finds no open console waits here; after a few seconds AmberX on your phone opens the console so it runs. Needs the AmberX app with console wake." />
      <SelectField label="How long a command waits for a console" value={String(cfg.ttlS)} options={TTL_CHOICES}
        hint="After this it's dropped and never runs late." onChange={(v) => void save({ ttlS: Number(v) })} />
      <SelectField label="Browser AmberX opens" value={cfg.browser} options={[{ value: 'chrome', label: 'Chrome (default browser when Chrome is missing)' }, { value: 'default', label: 'The phone\'s default browser' }]}
        onChange={(v) => void save({ browser: v as WakeSettings['browser'] })} />
      {!owner && <Note tone="info">Only the console's owner changes these.</Note>}
    </div>
  );
}

/** Settings → Plugins → Console commands: the open consoles and the last commands. */
function ConsolesPanel() {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [err, setErr] = useState('');
  const load = () => Promise.all([
    pluginFetch(FOLDER, 'queue').then((r) => r.json()).then((j: { items?: QueueRow[] }) => setQueue(j.items ?? [])),
    pluginFetch(FOLDER, 'clients').then((r) => r.json()).then((j: { items?: ClientRow[] }) => setClients(j.items ?? [])),
    pluginFetch(FOLDER, 'recent').then((r) => r.json()).then((j: { items?: RecentRow[] }) => setRecent(j.items ?? [])),
  ]).then(() => setErr(''), () => setErr('The Console commands server part is not answering.'));
  useEffect(() => { void load(); }, []);
  const me = clientId();
  return (
    <div className="fx-stack">
      {err && <Note tone="warning">{err}</Note>}
      <Container title="Open consoles" icon="monitor">
        {clients === null ? <p className="axf-cc__muted">Loading…</p> : !clients.length ? <p className="axf-cc__muted">No console is open right now.</p> : (
          <ul className="axf-cc__list">
            {clients.map((c) => (
              <li key={c.id} className="axf-cc__row">
                <span className="axf-cc__id">{c.id}{c.id === me ? ' (this one)' : ''}</span>
                <span>{c.app && c.app !== 'console-web' ? `${c.app} · ` : ''}{c.device || 'browser'} · {c.here?.screenLabel ?? c.here?.screen ?? '—'}{c.front === false ? ' · hidden' : ''}</span>
                <span className="axf-cc__muted">{c.live ? 'open' : 'gone quiet'} · {c.lastUsed ? new Date(c.lastUsed).toLocaleTimeString() : 'not used yet'} · {c.items} items</span>
              </li>
            ))}
          </ul>
        )}
        <Button icon="refresh" onClick={() => void load()} data-help="cc-refresh">Refresh</Button>
      </Container>
      <Container title="Waiting commands" icon="clock">
        {!queue.length ? <p className="axf-cc__muted">Nothing is waiting. A command that finds no open console waits here until one opens.</p> : (
          <ul className="axf-cc__list">
            {queue.map((q) => (
              <li key={q.id} className="axf-cc__row">
                <span className="axf-cc__id">{q.state} · {q.action} {q.path}</span>
                <span className="axf-cc__muted">{q.by} · {new Date(q.at).toLocaleTimeString()} · {q.state === 'queued' ? `until ${new Date(q.expiresAt).toLocaleTimeString()}` : ''}{q.wake ? ` · ${q.wake.message}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Container>
      <Container title="Last commands" icon="list">
        {!recent.length ? <p className="axf-cc__muted">None yet. Ask Amber to open a screen, or run <code>axf console open plan studio</code>.</p> : (
          <ul className="axf-cc__list">
            {recent.map((r, i) => (
              <li key={`${r.at}-${i}`} className="axf-cc__row">
                <span className="axf-cc__id">{r.ok ? '✓' : '✗'} {r.action} {r.path}</span>
                <span className="axf-cc__muted">{r.by} · {new Date(r.at).toLocaleTimeString()}{r.how ? ` · ${r.how}` : ''} · {r.ok ? r.delivered.map((d) => `${d.client}: ${d.message}`).join(' · ') || 'sent' : r.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Container>
      <Note tone="info">
        Claude sessions call <code>console_open</code>, <code>console_settings</code>, <code>console_dialog</code>, <code>console_action</code>, <code>console_back</code>, <code>console_where</code>, <code>console_list</code> and <code>console_clients</code> (the console's MCP, also through axHub). REST: <code>POST /api/console/open</code> with <code>{'{"screen": "plan studio"}'}</code>. CLI: <code>axf console open plan studio</code>.
      </Note>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Console commands',
  version: '0.2.0',
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  appMenu,
  slots: { 'app.frame.cover': [{ id: 'console-commands.client', order: 99, render: () => <ConsoleCommandsClient /> }] },
  settingsTabs: [{ id: FOLDER, label: 'Console commands', icon: 'radio', order: 92, parent: 'plugins', description: 'Let Claude sessions open screens, dialogs and settings in this console' }],
  settings: [{
    id: 'console-commands.prefs', label: 'Console commands', icon: 'radio', tab: FOLDER, order: 10,
    description: 'When Brett tells Amber to load a screen, his open console goes there. Opening only navigates; an action that changes data keeps its own permission.',
    settings: [
      { key: KEYS.on, label: 'Let Claude sessions move this console', kind: 'toggle', default: true, scope: 'device', description: 'Off: this console stops listening; commands go to your other open consoles.' },
      { key: KEYS.toast, label: 'Show a note for each command', kind: 'toggle', default: true, scope: 'device', description: 'A short toast saying who opened what.' },
    ],
  }],
  settingsPanels: [
    { id: 'console-commands.wake', tab: FOLDER, title: 'When no console is open', icon: 'smartphone', order: 15, render: () => <WakePanel /> },
    { id: 'console-commands.consoles', tab: FOLDER, title: 'Open consoles and last commands', icon: 'monitor', order: 20, render: () => <ConsolesPanel /> },
    { id: 'console-commands.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
