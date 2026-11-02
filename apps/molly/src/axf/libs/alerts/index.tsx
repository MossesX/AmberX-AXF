/**
 * Alerts library (`ai.amberx.axf.alerts`) — developer alerts for any AXF app.
 *
 * - **Alerts view** (nav → Alerts, action `alerts.open`): the feed, newest first, filters by severity and source,
 *   acknowledge / resolve / dismiss, links to where to look.
 * - **Bell:** keeps the runtime counter `alerts.unread` up to date; any toolbar item with `badge: "alerts.unread"`
 *   shows it (the console's toolbar has one).
 * - **Settings → Alerts:** where alerts go (bell, ntfy, web push: lowest severity per channel and per source),
 *   ntfy server / topic / token, web push on this device, which sources run, test buttons.
 * - **Conflicts and crashes:** every runtime diagnostic (two modules using the same asset id, setting key or settings
 *   id) and every uncaught error in the page becomes an alert (engines/alerts.ts `diagnosticToAlert`).
 *
 * Where alerts live is the transport's business: `localTransport` keeps them in this browser (bell only); an app with a
 * server passes its own (the Dev Console's talks to /api/alerts, which also pushes to phones and runs CI / deploy /
 * systems-check sources). The engine is core/engines/alerts.ts (same on Android: AlertEngine).
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ALERT_SEVERITIES, AlertCenter, DEFAULT_ALERT_RULES, diagnosticToAlert, sortAlerts, unreadCount,
  type Alert, type AlertInput, type AlertRules, type AlertSeverity, type AxfRuntime, type ChannelMin,
} from '../../core';
import { Button, Chip, Icon, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import './alerts.css';

export const ALERTS_LIBRARY_ID = 'ai.amberx.axf.alerts';
export const ALERTS_BADGE = 'alerts.unread';
const P = 'axf-alerts';

/* ================================================================== transport */

export interface AlertSourceInfo { id: string; label: string; description?: string; enabled: boolean }
export interface AlertConfig {
  rules: AlertRules;
  ntfy?: { enabled: boolean; server: string; topic: string; hasToken: boolean; details?: boolean };
  webpush?: { enabled: boolean; publicKey: string | null };
  sources?: AlertSourceInfo[];
}
export interface AlertConfigPatch {
  rules?: AlertRules;
  ntfy?: { enabled?: boolean; server?: string; topic?: string; token?: string | null; details?: boolean };
  webpush?: { enabled?: boolean };
  sources?: Record<string, boolean>;
}

/** Where alerts live. Every method may reject; the UI shows the message. */
export interface AlertTransport {
  /** short words for the settings page ("this browser", "the console server") */
  label: string;
  list(): Promise<Alert[]>;
  raise(input: AlertInput): Promise<void>;
  ack(ids: string[] | 'all'): Promise<void>;
  resolve(keys: string[]): Promise<void>;
  dismiss(ids: string[]): Promise<void>;
  /** live updates: call `onList` with the whole list whenever it changes; returns a stop function */
  subscribe(onList: (alerts: Alert[]) => void): () => void;
  config?: { get(): Promise<AlertConfig>; set(patch: AlertConfigPatch): Promise<AlertConfig>; test(channel: string): Promise<{ ok: boolean; detail: string }> };
  webPush?: { subscribe(sub: PushSubscriptionJSON): Promise<void>; unsubscribe(endpoint: string): Promise<void>; test(): Promise<{ ok: boolean; detail: string }> };
}

/** Alerts kept in this browser only (localStorage), bell only. For apps without a server. */
export function localTransport(storageKey = 'axf:alerts'): AlertTransport {
  const read = (): Alert[] => { try { return JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? '[]') as Alert[]; } catch { return []; } };
  const readRules = (): AlertRules => { try { return (JSON.parse(globalThis.localStorage?.getItem(`${storageKey}:rules`) ?? 'null') as AlertRules) ?? { channels: { bell: { min: 'info' } } }; } catch { return { channels: { bell: { min: 'info' } } }; } };
  const center = new AlertCenter({ alerts: read(), rules: readRules() });
  const save = () => { try { globalThis.localStorage?.setItem(storageKey, JSON.stringify(center.list)); } catch { /* storage blocked */ } };
  center.subscribe(save);
  return {
    label: 'this browser',
    list: async () => center.list,
    raise: async (i) => { center.raise(i); },
    ack: async (ids) => center.ack(ids),
    resolve: async (keys) => center.resolve(keys),
    dismiss: async (ids) => center.dismiss(ids),
    subscribe: (on) => { on(center.list); return center.subscribe(() => on(center.list)); },
    config: {
      get: async () => ({ rules: center.rules }),
      set: async (patch) => {
        if (patch.rules) { center.rules = patch.rules; try { globalThis.localStorage?.setItem(`${storageKey}:rules`, JSON.stringify(patch.rules)); } catch { /* storage blocked */ } }
        return { rules: center.rules };
      },
      test: async (channel) => {
        center.raise({ source: 'alerts', severity: 'info', key: `test:${channel}`, title: 'Test alert', body: `Sent from Settings → Alerts to ${channel}.` });
        return { ok: true, detail: 'Added to the bell' };
      },
    },
  };
}

/* ================================================================== store (one per runtime) */

class AlertsStore {
  list: Alert[] = [];
  error = '';
  private listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  private crashTimes: number[] = [];
  private onError = (e: ErrorEvent) => this.crash(e.message || String(e.error), e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`);
  private onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as unknown;
    this.crash(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  };

  constructor(readonly rt: AxfRuntime, readonly transport: AlertTransport, readonly opts: AlertsOptions) {}

  start(): void {
    if (this.stop) return;
    this.stop = this.transport.subscribe((alerts) => { this.list = sortAlerts(alerts); this.error = ''; this.sync(); });
    // conflicts from before the library was installed are kept by the runtime; replay them (same key = same alert)
    this.rt.diagnostics.subscribe((d) => void this.raise(diagnosticToAlert(d)), true);
    if (this.opts.captureCrashes !== false && typeof window !== 'undefined') {
      window.addEventListener('error', this.onError);
      window.addEventListener('unhandledrejection', this.onRejection);
    }
  }

  /** A page error becomes a diagnostic; at most 10 a minute so a render loop can't flood the feed. */
  private crash(message: string, detail?: string): void {
    const now = Date.now();
    this.crashTimes = this.crashTimes.filter((t) => now - t < 60_000);
    if (this.crashTimes.length >= 10) return;
    this.crashTimes.push(now);
    this.rt.diagnostics.report({ kind: 'crash', where: this.opts.crashWhere ?? 'web', message: message.slice(0, 300), detail: detail?.slice(0, 1500) });
  }

  async raise(input: AlertInput): Promise<void> {
    try { await this.transport.raise(input); } catch (e) { this.fail(e); }
  }
  async act(fn: () => Promise<void>): Promise<void> {
    try { await fn(); this.list = sortAlerts(await this.transport.list()); this.error = ''; this.sync(); } catch (e) { this.fail(e); }
  }
  private fail(e: unknown): void { this.error = (e as Error)?.message ?? String(e); this.emit(); }

  private sync(): void {
    this.rt.setBadge(ALERTS_BADGE, unreadCount(this.list));
    this.emit();
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private rev = 0;
  getRev = () => this.rev;
  private emit(): void { this.rev++; for (const fn of this.listeners) fn(); }
}

const stores = new WeakMap<AxfRuntime, AlertsStore>();
/** The alerts store of a runtime (after the library registered), for apps that want to raise alerts from code. */
export function alertsOf(rt: AxfRuntime): { raise(input: AlertInput): Promise<void>; list(): Alert[] } | null {
  const s = stores.get(rt);
  return s ? { raise: (i) => s.raise(i), list: () => s.list } : null;
}

function useStore(): AlertsStore {
  const rt = useRuntime();
  const s = stores.get(rt);
  if (!s) throw new Error('The alerts library is not registered on this runtime');
  useSyncExternalStore(s.subscribe, s.getRev);
  return s;
}

/* ================================================================== helpers */

const TONE: Record<AlertSeverity, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { info: 'accent', success: 'success', warning: 'warning', error: 'danger', critical: 'danger' };
const ICON: Record<AlertSeverity, string> = { info: 'info', success: 'check-circle', warning: 'alert', error: 'x-circle', critical: 'zap' };

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** `view:<id>` / `settings:<tab>` stay in the app; http(s) links open in a new tab; anything else is ignored. */
function openLink(rt: AxfRuntime, link: string): void {
  if (link.startsWith('view:')) rt.navigate(link.slice(5));
  else if (link.startsWith('settings:')) rt.dispatch(`settings.open:${link.slice(9)}`);
  else if (/^https?:\/\//.test(link)) window.open(link, '_blank', 'noopener,noreferrer');
}

/* ================================================================== Alerts view */

type Show = 'open' | 'all';

function AlertsView() {
  const rt = useRuntime();
  const s = useStore();
  const [sev, setSev] = useState<AlertSeverity | 'all'>('all');
  const [source, setSource] = useState('all');
  const [show, setShow] = useState<Show>('open');
  const [open, setOpen] = useState<string | null>(null);
  const sources = useMemo(() => [...new Set(s.list.map((a) => a.source))].sort(), [s.list]);
  const rows = s.list.filter((a) => (show === 'all' || !a.resolved) && (sev === 'all' || a.severity === sev) && (source === 'all' || a.source === source));
  const unread = unreadCount(s.list);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Developer alerts · {s.transport.label}</p>
          <h1>Alerts</h1>
          <p className="fx-muted">{unread ? `${unread} new` : 'Nothing new'} · {s.list.filter((a) => !a.resolved).length} open · {s.list.length} kept</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="check" disabled={!unread} onClick={() => void s.act(() => s.transport.ack('all'))}>Mark all seen</Button>
          <Button icon="settings" onClick={() => rt.dispatch('settings.open:alerts')}>Alert settings</Button>
        </div>
      </header>
      {s.error && <p className={`${P}__error`}>{s.error}</p>}
      <div className={`${P}__filters`}>
        <div className={`${P}__chips`} role="group" aria-label="Severity">
          {(['all', ...[...ALERT_SEVERITIES].reverse()] as const).map((x) => (
            <button key={x} type="button" className={`fx-chip ${P}__chip ${sev === x ? 'is-on' : ''}`} aria-pressed={sev === x} onClick={() => setSev(x)}>{x}</button>
          ))}
        </div>
        <div className={`${P}__chips`} role="group" aria-label="Show">
          {(['open', 'all'] as const).map((x) => <button key={x} type="button" className={`fx-chip ${P}__chip ${show === x ? 'is-on' : ''}`} aria-pressed={show === x} onClick={() => setShow(x)}>{x === 'open' ? 'Open' : 'Include resolved'}</button>)}
        </div>
        {sources.length > 1 && (
          <select className="fx-input" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            <option value="all">All sources</option>
            {sources.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
      </div>
      {!rows.length && <p className="fx-muted">{s.list.length ? 'No alerts match these filters.' : 'No alerts yet. Problems from CI, deploys, the systems check, builds, plugins, conflicts and crashes show up here.'}</p>}
      {rows.length > 0 && (
        <div className={`${P}__list`} role="list">
          {rows.map((a) => (
            <div key={a.id} role="listitem" className={`${P}__item ${a.ack || a.resolved ? '' : 'is-unread'} ${a.resolved ? 'is-resolved' : ''}`}>
              <button type="button" data-fx-row="" className={`${P}__row`} aria-expanded={open === a.id} onClick={() => { setOpen(open === a.id ? null : a.id); if (!a.ack) void s.act(() => s.transport.ack([a.id])); }}>
                <span className={`${P}__sev is-${a.severity}`}><Icon name={ICON[a.severity]} size={16} /></span>
                <span className={`${P}__main`}>
                  <span className={`${P}__title`}>{a.title}</span>
                  <span className={`${P}__sub`}>{a.source} · {ago(a.lastAt)}{a.count > 1 ? ` · ${a.count}×` : ''}{a.resolved ? ' · resolved' : ''}</span>
                </span>
                <Chip tone={TONE[a.severity]}>{a.severity}</Chip>
              </button>
              {open === a.id && (
                <div className={`${P}__detail`}>
                  {a.body && <pre className={`${P}__body`}>{a.body}</pre>}
                  <p className="fx-small fx-muted" style={{ margin: 0 }}>First {new Date(a.firstAt).toLocaleString()} · last {new Date(a.lastAt).toLocaleString()}{Object.keys(a.meta).length ? ` · ${Object.entries(a.meta).map(([k, v]) => `${k}: ${v}`).join(' · ')}` : ''}</p>
                  <div className="fx-row fx-row--wrap">
                    {a.link && <Button icon="external" tone="primary" onClick={() => openLink(rt, a.link)}>Open</Button>}
                    {!a.resolved && <Button icon="check-circle" onClick={() => void s.act(() => s.transport.resolve([a.key]))}>Resolve</Button>}
                    <Button icon="trash" tone="ghost" onClick={() => void s.act(() => s.transport.dismiss([a.id]))}>Dismiss</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== Settings → Alerts */

function useConfig() {
  const s = useStore();
  const [cfg, setCfg] = useState<AlertConfig | null>(null);
  const [err, setErr] = useState('');
  const load = () => { if (!s.transport.config) return; s.transport.config.get().then((c) => { setCfg(c); setErr(''); }, (e: Error) => setErr(e.message)); };
  useEffect(load, [s.transport]);
  const save = async (patch: AlertConfigPatch) => {
    if (!s.transport.config) return null;
    try { const c = await s.transport.config.set(patch); setCfg(c); setErr(''); return c; } catch (e) { setErr((e as Error).message); return null; }
  };
  return { s, cfg, err, save, reload: load };
}

const MINS: ChannelMin[] = ['off', ...ALERT_SEVERITIES];
const CHANNEL_LABEL: Record<string, string> = { bell: 'Bell (in the app)', ntfy: 'Phone: ntfy', webpush: 'Phone: web push' };

function RulesPanel() {
  const { s, cfg, err, save } = useConfig();
  if (!s.transport.config) return <p className="fx-muted">This app's alerts transport has no settings.</p>;
  if (err) return <p className={`${P}__error`}>{err}</p>;
  if (!cfg) return <p className="fx-muted">Loading…</p>;
  const rules = cfg.rules ?? DEFAULT_ALERT_RULES;
  const channels = Object.keys(rules.channels);
  const sources = (cfg.sources ?? []).map((x) => x.id);
  const setMin = (ch: string, min: ChannelMin, src?: string) => {
    const r = structuredClone(rules);
    const c = r.channels[ch] ?? { min: 'off' };
    if (src) { c.sources = { ...(c.sources ?? {}) }; if (min === c.min) delete c.sources[src]; else c.sources[src] = min; }
    else c.min = min;
    r.channels[ch] = c;
    void save({ rules: r });
  };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>The lowest severity each channel gets. Phones only hear about new, worse or reopened alerts; repeats just bump the count in the bell.</p>
      <div className={`${P}__scroll`}>
        <table className="fx-table">
          <thead><tr><th>Source</th>{channels.map((c) => <th key={c}>{CHANNEL_LABEL[c] ?? c}</th>)}</tr></thead>
          <tbody>
            <tr><th>Everything</th>{channels.map((c) => <td key={c}><MinSelect value={rules.channels[c]!.min} onChange={(m) => setMin(c, m)} label={`${c} default`} /></td>)}</tr>
            {sources.map((src) => (
              <tr key={src}><th className={`${P}__muted-th`}>{src}</th>{channels.map((c) => {
                const v = rules.channels[c]!.sources?.[src];
                return <td key={c}><MinSelect value={v ?? rules.channels[c]!.min} inherited={v === undefined} onChange={(m) => setMin(c, m, src)} label={`${c} for ${src}`} /></td>;
              })}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MinSelect({ value, onChange, label, inherited }: { value: ChannelMin; onChange: (m: ChannelMin) => void; label: string; inherited?: boolean }) {
  return (
    <select className={`fx-input ${P}__min ${inherited ? 'is-inherited' : ''}`} value={value} aria-label={label} onChange={(e) => onChange(e.target.value as ChannelMin)}>
      {MINS.map((m) => <option key={m} value={m}>{m === 'off' ? 'off' : `${m}+`}</option>)}
    </select>
  );
}

function SourcesPanel() {
  const { cfg, err, save } = useConfig();
  if (err) return <p className={`${P}__error`}>{err}</p>;
  if (!cfg?.sources?.length) return <p className="fx-muted">{cfg ? 'This app has no switchable sources: conflicts and crashes are always on.' : 'Loading…'}</p>;
  return (
    <div className="fx-stack">
      {cfg.sources.map((x) => (
        <label key={x.id} className={`${P}__choice`}>
          <input type="checkbox" checked={x.enabled} onChange={(e) => void save({ sources: { [x.id]: e.target.checked } })} />
          <span><strong>{x.label}</strong>{x.description && <><br /><span className="fx-muted fx-small">{x.description}</span></>}</span>
        </label>
      ))}
    </div>
  );
}

function NtfyPanel() {
  const rt = useRuntime();
  const { s, cfg, err, save } = useConfig();
  const [server, setServer] = useState('');
  const [topic, setTopic] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (cfg?.ntfy) { setServer(cfg.ntfy.server); setTopic(cfg.ntfy.topic); } }, [cfg?.ntfy?.server, cfg?.ntfy?.topic]);
  if (err) return <p className={`${P}__error`}>{err}</p>;
  if (!cfg) return <p className="fx-muted">Loading…</p>;
  if (!cfg.ntfy) return <p className="fx-muted">Phone alerts need a server: {s.transport.label} can only show the bell.</p>;
  const n = cfg.ntfy;
  const randomTopic = () => setTopic(`axf-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`);
  const apply = async (patch: AlertConfigPatch['ntfy']) => { setBusy(true); const c = await save({ ntfy: patch }); setBusy(false); if (c) { setToken(''); rt.toast('ntfy settings saved', 'success'); } };
  const test = async () => {
    setBusy(true);
    try { const r = await s.transport.config!.test('ntfy'); rt.toast(r.detail, r.ok ? 'success' : 'danger', 'ntfy'); } catch (e) { rt.toast((e as Error).message, 'danger', 'ntfy'); }
    setBusy(false);
  };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Install the <strong>ntfy</strong> app on your phone and subscribe to the topic below (same server). Anyone who knows the topic can read it on a public server, so keep it long and random, or use your own ntfy server (https) with a token.</p>
      <label className={`${P}__choice`}><input type="checkbox" checked={n.enabled} disabled={busy} onChange={(e) => void apply({ enabled: e.target.checked })} /><span><strong>Send alerts to ntfy</strong></span></label>
      <label className={`${P}__choice`}><input type="checkbox" checked={!!n.details} disabled={busy} onChange={(e) => void apply({ details: e.target.checked })} /><span><strong>Include details</strong><br /><span className="fx-muted fx-small">Off: the phone gets the title and a link; tracebacks and CI output stay in the bell. Turn on only with your own server or a token-protected topic.</span></span></label>
      <div className={`${P}__grid`}>
        <label className={`${P}__field`}>Server<input className="fx-input fx-mono" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://ntfy.sh" /></label>
        <label className={`${P}__field`}>Topic
          <span className="fx-row"><input className="fx-input fx-mono fx-grow" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="axf-…" /><Button icon="shuffle" onClick={randomTopic}>Random</Button></span>
        </label>
      </div>
      <label className={`${P}__field`}>Access token (only for a protected server){n.hasToken ? ' · one is saved' : ''}
        <input className="fx-input fx-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={n.hasToken ? 'leave empty to keep it' : 'tk_…'} />
      </label>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="save" disabled={busy} onClick={() => void apply({ server: server.trim(), topic: topic.trim(), ...(token.trim() ? { token: token.trim() } : {}) })}>Save</Button>
        {n.hasToken && <Button icon="trash" tone="ghost" disabled={busy} onClick={() => void apply({ token: null })}>Forget token</Button>}
        <Button icon="bell" disabled={busy || !n.enabled || !n.topic} onClick={() => void test()}>Send a test</Button>
      </div>
    </div>
  );
}

function urlB64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function WebPushPanel({ swUrl }: { swUrl: string }) {
  const rt = useRuntime();
  const { s, cfg, err, save } = useConfig();
  const [state, setState] = useState<'unknown' | 'unsupported' | 'off' | 'on' | 'blocked'>('unknown');
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const check = async () => {
    if (!supported) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('blocked');
    const reg = await navigator.serviceWorker.getRegistration(swUrl).catch(() => undefined);
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    setState(sub ? 'on' : 'off');
  };
  useEffect(() => { if (swUrl) void check(); }, []);
  if (err) return <p className={`${P}__error`}>{err}</p>;
  if (!cfg) return <p className="fx-muted">Loading…</p>;
  if (!cfg.webpush || !s.transport.webPush) return <p className="fx-muted">Web push needs a server: {s.transport.label} can only show the bell.</p>;
  if (!swUrl) return <p className="fx-muted">This app doesn't serve the alerts service worker yet (alerts-sw.js), so web push can't be turned on here.</p>;
  const enable = async () => {
    setBusy(true);
    try {
      if (!cfg.webpush?.publicKey) throw new Error('The server has no web push key yet.');
      if ((await Notification.requestPermission()) !== 'granted') { setState('blocked'); throw new Error('Notifications are blocked for this site in the browser settings.'); }
      const reg = await navigator.serviceWorker.register(swUrl);
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(cfg.webpush.publicKey) });
      await s.transport.webPush!.subscribe(sub.toJSON());
      if (!cfg.webpush.enabled) await save({ webpush: { enabled: true } });
      rt.toast('This device gets alerts now', 'success', 'Web push');
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Web push'); }
    setBusy(false); void check();
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration(swUrl);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await s.transport.webPush!.unsubscribe(sub.endpoint); await sub.unsubscribe(); }
      rt.toast('This device no longer gets alerts', 'success', 'Web push');
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Web push'); }
    setBusy(false); void check();
  };
  const test = async () => {
    setBusy(true);
    try { const r = await s.transport.webPush!.test(); rt.toast(r.detail, r.ok ? 'success' : 'danger', 'Web push'); } catch (e) { rt.toast((e as Error).message, 'danger', 'Web push'); }
    setBusy(false);
  };
  const words: Record<typeof state, string> = { unknown: 'Checking…', unsupported: "This browser can't receive web push.", off: 'Off on this device.', on: 'On: this device gets alerts.', blocked: 'Notifications are blocked for this site in the browser settings.' };
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Browser notifications from this app, per device (Chrome on Android works; iPhone needs the app added to the home screen).</p>
      <label className={`${P}__choice`}><input type="checkbox" checked={cfg.webpush.enabled} disabled={busy} onChange={(e) => void save({ webpush: { enabled: e.target.checked } })} /><span><strong>Send alerts by web push</strong><br /><span className="fx-muted fx-small">to every device that turned it on below</span></span></label>
      <p style={{ margin: 0 }}>{words[state]}</p>
      <div className="fx-row fx-row--wrap">
        {state === 'off' && <Button tone="primary" icon="bell" disabled={busy} onClick={() => void enable()}>Turn on for this device</Button>}
        {state === 'on' && <Button icon="x" disabled={busy} onClick={() => void disable()}>Turn off for this device</Button>}
        <Button icon="bell" disabled={busy || !cfg.webpush.enabled} onClick={() => void test()}>Send a test</Button>
      </div>
    </div>
  );
}

function TestPanel() {
  const rt = useRuntime();
  const s = useStore();
  const raise = (severity: AlertSeverity) => void s.raise({ source: 'alerts', severity, key: `test:${severity}`, title: `Test ${severity} alert`, body: 'Raised from Settings → Alerts → Try it.' }).then(() => rt.toast('Raised: check the bell (and your phone for error and worse)', 'success'));
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Raise a test alert through the normal path, so it reaches every channel its severity is set for.</p>
      <div className="fx-row fx-row--wrap">{ALERT_SEVERITIES.map((x) => <Button key={x} onClick={() => raise(x)}>{x}</Button>)}</div>
    </div>
  );
}

/* ================================================================== library */

export interface AlertsOptions {
  /** where alerts live; default: this browser only */
  transport?: AlertTransport;
  /** turn uncaught page errors into crash alerts (default true) */
  captureCrashes?: boolean;
  /** `where` for page crashes (default `web`) */
  crashWhere?: string;
  /**
   * Where the app serves this library's alerts-sw.js (same origin, a real file), e.g. `/alerts-sw.js` with
   * `alertsServiceWorker()` from ./vite-plugin.mjs. Without it, web push is off and the settings panel says why.
   */
  serviceWorkerUrl?: string;
}

export function createAlertsLibrary(opts: AlertsOptions = {}): AxfWebLibrary {
  // created on first install, so importing the library has no side effects
  let transport = opts.transport;
  const swUrl = opts.serviceWorkerUrl ?? '';
  const panels: { id: string; title: string; icon: string; order: number; render: () => ReactNode }[] = [
    { id: 'alerts.rules', title: 'Where alerts go', icon: 'sliders', order: 10, render: () => <RulesPanel /> },
    { id: 'alerts.sources', title: 'Sources', icon: 'list', order: 20, render: () => <SourcesPanel /> },
    { id: 'alerts.ntfy', title: 'Phone: ntfy', icon: 'smartphone', order: 30, render: () => <NtfyPanel /> },
    { id: 'alerts.webpush', title: 'Phone: web push', icon: 'bell', order: 40, render: () => <WebPushPanel swUrl={swUrl} /> },
    { id: 'alerts.test', title: 'Try it', icon: 'zap', order: 50, render: () => <TestPanel /> },
  ];
  return {
    id: ALERTS_LIBRARY_ID,
    label: 'Alerts',
    version: '1.0.0',
    provides: ['alerts', 'alerts.bell'],
    register(rt) {
      // installLibraries can run again (plugins toggled); keep one store per runtime
      let s = stores.get(rt);
      if (!s) { transport ??= localTransport(); s = new AlertsStore(rt, transport, opts); stores.set(rt, s); }
      s.start();
      const store = s;
      rt.actions.register('alerts.open', () => rt.navigate('alerts'), { label: 'Open alerts' });
      rt.actions.register('alerts.ackAll', () => void store.act(() => store.transport.ack('all')), { label: 'Mark all alerts seen' });
    },
    views: { alerts: { title: 'Alerts', icon: 'bell', render: () => <AlertsView /> } },
    nav: { label: 'Alerts', items: [{ id: 'alerts', label: 'Alerts', icon: 'bell', view: 'alerts' }] },
    settingsTabs: [{ id: 'alerts', label: 'Alerts', icon: 'bell', order: 34, description: 'Developer alerts: where they go (bell, ntfy, web push), which sources run, and a test.' }],
    settingsPanels: panels.map((p) => ({ ...p, tab: 'alerts' })),
  };
}

/** Default instance: alerts kept in this browser. Apps with a server use createAlertsLibrary({ transport }). */
export const library: AxfWebLibrary = createAlertsLibrary();
