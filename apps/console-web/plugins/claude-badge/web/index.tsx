import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Container, Icon, Meter, TextField, useIsPhone } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

import { ASSET_ID as HUB_ASSET, COUNTER as HUB_COUNTER } from '@console/axf/libs/hubstatus';
import { BADGES, CHIPS, HEALTH_KINDS, ICONS, KINDS, METRICS, METRIC_NAMES, STATE_IDS, STATE_NAMES, TAPS, TONES, badgeAttachment, gb, healthState, healthText, healthTip, iconKey, iconOf, keyOf, labelOf, meterText, pingText, shapeOf, shownOf, statusWord, tapPlan, typeWord } from './model';
import type { BadgeKind, BadgeState, BadgeTone, HealthKind, HealthResult, Metric, PingResult, UsageAccount, UsageResult, UsageWindow } from './model';
import './badges.css';

/*
 * Badges (folder claude-badge): eight badges on the banner, one plugin. Claude tests the AI connection when the console
 * loads (axf.llm@1) and carries the Claude Code login on the VPS. VPS is a ping: green while the host answers, red when it
 * doesn't. axHub shows the framework's live check (hubLive): green only while settings come live from axHub, red
 * otherwise. AmberX shows whether the phone app is connected. The usage meter shows how much of its 5-hour and weekly
 * limits the active account has used. Disk, CPU and Mem are the server health widgets, coloured by the thresholds set on
 * the Server health page (view server-health), which a tap opens. Everything but the Claude test is plain code and costs
 * no tokens.
 * Each badge: shown or hidden, Icons only, label, an icon per state, side and order on the banner, and what a tap does.
 * Settings are hot: a badge repaints the moment one changes. model.ts holds the table.
 */
const ID = 'ai.amberx.axf.console.claude-badge';
const FOLDER = 'claude-badge';
const POP_MS = 5000;
const VPS_POLL_MS = 60000;
const HEALTH_POLL_MS = 60000;
const HEALTH_VIEW = 'server-health';
const USAGE_POLL_MS = 300000;
const OLD_HUB_SHOW = 'hubstatus.show';
const HUB_MOVED = 'claude-badge.axhub.moved';
const P = 'axp-badges';

interface TestResult { at: number; ok: boolean; model: string; name: string; provider: string; ms: number; error: string; claude?: boolean; state?: string; account?: string }
/** One read of the Claude Code login on the VPS (GET /claude-login): plain code, no tokens, never a credential. */
export interface LoginResult { at: number; ok: boolean; state: string; reachable: boolean; account: string; email: string; plan: string; expiresAt: string; limitedAt: number; error: string }
interface AmberxResult { at: number; state: BadgeState; online: boolean; lastSeen: number; text: string }

const read = (rt: AxfRuntime) => (k: string) => rt.settings.get(k);
/** The server's states → the four every badge has. */
export const stateOf = (r: TestResult | null): BadgeState => (r?.state === 'ok' || (!r?.state && r?.ok) ? 'ok' : r?.state === 'no-credit' ? 'warn' : 'error');
/** The login's say in the Claude badge: a limit or a missing login on the VPS is amber; an unreadable VPS says nothing. */
const loginState = (r: LoginResult | null): BadgeState => (!r || !r.reachable ? 'off' : r.state === 'ok' ? 'ok' : 'warn');
const pingState = (r: PingResult | null): BadgeState => (!r ? 'off' : r.state === 'ok' ? 'ok' : r.state === 'off' ? 'off' : 'error');

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`);
  return j;
}

/** "Powered by Claude Opus 5.5" when connected, "Out of credits" when the account works but has none, else "AI unavailable". */
export const popupText = (r: TestResult | null) => {
  const st = stateOf(r);
  return st === 'ok' ? `Powered by ${r?.name || 'Claude'}${r?.account ? ` · ${r.account}` : ''}` : st === 'warn' ? 'Claude is out of credits' : 'AI unavailable';
};

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const whenOf = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
const dayOf = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };

/** The Claude Code login on the VPS in one line (the Claude badge's tooltip and panel). */
export const loginText = (r: LoginResult | null) => {
  if (!r) return 'Checking the VPS login…';
  if (r.state === 'ok') return `Claude Code on the VPS${r.email ? ` · ${r.email}` : ''}`;
  if (r.state === 'no-credit') return `VPS Claude hit its limit${r.limitedAt ? ` at ${timeOf(r.limitedAt)}` : ''}${r.email ? ` · ${r.email}` : ''}`;
  return r.reachable ? 'VPS Claude is not logged in' : "Can't read the VPS login";
};
const label = (rt: AxfRuntime, kind: BadgeKind) => labelOf(read(rt), kind) || BADGES[kind].label;

function badgeAsset(rt: AxfRuntime, kind: BadgeKind, st: BadgeState, tone: BadgeTone, tooltip: string, text = label(rt, kind)) {
  const d = BADGES[kind];
  return {
    $axf: 'asset@1', type: 'badge', id: d.id, name: d.title, version: '0.2.0', author: 'Badges plugin',
    description: `${d.about} Attached to the banner by the Badges plugin.`, tags: ['status', kind],
    data: { icon: iconOf(read(rt), kind, st), label: text, shape: shapeOf(read(rt), kind), tone, tooltip, ...(tapPlan(read(rt), kind).do === 'none' ? {} : { link: `claude-badge.tap.${kind}` }) },
  };
}

function consoleAsset(rt: AxfRuntime) {
  const r = last; const st = stateOf(r);
  const why = r?.error ? `: ${r.error}` : '';
  const ai = checking ? 'Checking the AI connection…'
    : st === 'ok' ? `${popupText(r)}${r?.provider ? ` · ${r.provider}` : ''} · ${(r!.ms / 1000).toFixed(1)} s`
    : st === 'warn' ? `Out of credits: the account works but can't answer until it's topped up${why}` : `AI unavailable${why}`;
  const shown = !r ? 'off' : st === 'ok' && loginState(loginLast) === 'warn' ? 'warn' : st;
  return badgeAsset(rt, 'console', shown, checking || shown === 'error' ? 'muted' : TONES[shown], loginLast ? `${ai} · ${loginText(loginLast)}` : ai);
}

function vpsAsset(rt: AxfRuntime) {
  const st = pingState(pingLast);
  return badgeAsset(rt, 'vps', st, TONES[st], pingText(pingLast));
}

function healthAsset(kind: HealthKind) {
  return (rt: AxfRuntime) => {
    const st = healthState(healthLast, kind);
    return badgeAsset(rt, kind, st, TONES[st], healthTip(healthLast, kind), healthText(healthLast, kind, labelOf(read(rt), kind)));
  };
}

/** Live, or red: the framework's check decides (rule: the axHub badge is red unless settings come live from axHub). */
function hubState(rt: AxfRuntime): BadgeState { return !rt.registry.has('status', HUB_ASSET) ? 'off' : rt.badge(HUB_COUNTER) > 0 ? 'ok' : 'error'; }
function axhubAsset(rt: AxfRuntime) {
  const st = hubState(rt);
  return badgeAsset(rt, 'axhub', st, st === 'ok' ? 'success' : 'danger', st === 'ok' ? 'axHub: settings are live' : "axHub isn't live: settings aren't coming from axHub right now");
}

function amberxAsset(rt: AxfRuntime) {
  const r = amberxLast; const st = r?.state ?? 'off';
  return badgeAsset(rt, 'amberx', st, TONES[st], r ? `${r.text}${!r.online && r.lastSeen ? ` · last seen ${timeOf(r.lastSeen)}` : ''}` : 'Checking the AmberX phone…');
}

const windowText = (name: string, w: UsageWindow | null) => (w ? `${name} ${Math.round(w.used)}% used${w.resetsAt ? `, resets ${whenOf(w.resetsAt)}` : ''}` : `${name}: no window open`);
function usageAsset(rt: AxfRuntime) {
  const r = usageLast; const st = r?.state ?? 'off';
  const a = r?.accounts.find((x) => x.active);
  const tip = !r ? 'Reading the usage…' : !a ? (r.why || 'Nothing to read') : a.status === 'no-meter' ? `${a.name}: ${a.why}` : `${a.name}: ${windowText('5-hour', a.fiveHour)} · ${windowText('Weekly', a.weekly)}`;
  return badgeAsset(rt, 'usage', st, TONES[st], tip, meterText(r, labelOf(read(rt), 'usage')));
}

const ASSETS: Record<BadgeKind, (rt: AxfRuntime) => object> = { console: consoleAsset, vps: vpsAsset, axhub: axhubAsset, amberx: amberxAsset, usage: usageAsset, disk: healthAsset('disk'), cpu: healthAsset('cpu'), memory: healthAsset('memory') };

let last: TestResult | null = null;
let tested = false;
let checking = false;
const listeners = new Set<(r: TestResult | null) => void>();
let loginLast: LoginResult | null = null;
let pingLast: PingResult | null = null;
let healthLast: HealthResult | null = null;
let amberxLast: AmberxResult | null = null;
let usageLast: UsageResult | null = null;
const liveListeners = new Set<() => void>();
const live = () => liveListeners.forEach((f) => f());
const placed: Partial<Record<BadgeKind, string>> = {};
let timers: ReturnType<typeof setInterval>[] = [];
let stopped = false;

/** Put one badge on the banner as its settings say, or take it off. A new side or order re-attaches it. */
function paint(rt: AxfRuntime, kind: BadgeKind) {
  const d = BADGES[kind];
  const key = `badge:${d.id}`;
  if (!shownOf(read(rt), kind)) { rt.detachFromBanner(key); delete placed[kind]; return; }
  rt.registry.register(ASSETS[kind](rt) as never, 'app', ID);
  const a = badgeAttachment(read(rt), kind, ID);
  const place = `${a.at}:${a.order}`;
  if (placed[kind] && placed[kind] !== place) rt.detachFromBanner(key);
  placed[kind] = place;
  rt.attachToBanner(a);
}

/** Run the connection test, repaint the badge and pop the tooltip out for 5 s. */
export async function testConnection(rt: AxfRuntime): Promise<TestResult> {
  checking = true;
  paint(rt, 'console');
  let r: TestResult;
  try { r = await call<TestResult>('test', { method: 'POST' }); }
  catch (e) { r = { at: Date.now(), ok: false, model: '', name: '', provider: '', ms: 0, error: (e as Error).message }; }
  last = r;
  checking = false;
  paint(rt, 'console');
  if (shownOf(read(rt), 'console')) rt.showBannerPopup(`badge:${BADGES.console.id}`, popupText(r), POP_MS);
  listeners.forEach((f) => f(r));
  return r;
}

/** A 404 = the plugin was switched off: nothing to repaint, register() starts the reads again. */
const gone = (e: unknown) => { if (!(e as Error).message.includes('(404)')) return false; stopReads(); return true; };

/** Read the Claude Code login on the VPS and repaint the Claude badge, which carries it. */
export async function checkLogin(rt: AxfRuntime): Promise<LoginResult | null> {
  let r: LoginResult;
  try { r = await call<LoginResult>('claude-login'); }
  catch (e) {
    if (gone(e)) return loginLast;
    r = { at: Date.now(), ok: false, state: 'error', reachable: false, account: '', email: '', plan: '', expiresAt: '', limitedAt: 0, error: (e as Error).message };
  }
  loginLast = r;
  paint(rt, 'console');
  live();
  return r;
}

/** Ping the VPS and repaint; the tooltip pops out only when the state changes after the first read. */
export async function checkVps(rt: AxfRuntime, refresh = false): Promise<PingResult | null> {
  let r: PingResult;
  try { r = await call<PingResult>(`vps${refresh ? '?refresh=1' : ''}`); }
  catch (e) {
    if (gone(e)) return pingLast;
    r = { at: Date.now(), ok: false, state: 'error', reachable: false, host: '', source: '', method: '', ms: 0, error: (e as Error).message };
  }
  const changed = !!pingLast && pingLast.state !== r.state;
  pingLast = r;
  paint(rt, 'vps');
  if (changed && shownOf(read(rt), 'vps')) rt.showBannerPopup(`badge:${BADGES.vps.id}`, pingText(r), POP_MS);
  live();
  return r;
}

/** Read disk, CPU load, memory and swap; repaint the three widgets. A disk newly past red pops its tooltip out. */
export async function checkHealth(rt: AxfRuntime, refresh = false): Promise<HealthResult | null> {
  try {
    const r = await call<HealthResult>(`health${refresh ? '?refresh=1' : ''}`);
    const wasRed = healthLast?.states.disk === 'error';
    healthLast = r;
    if (!wasRed && r.states.disk === 'error' && shownOf(read(rt), 'disk')) rt.showBannerPopup(`badge:${BADGES.disk.id}`, healthTip(r, 'disk'), POP_MS);
  } catch (e) { if (gone(e)) return healthLast; }
  for (const k of HEALTH_KINDS) paint(rt, k);
  live();
  return healthLast;
}
const anyHealthShown = (rt: AxfRuntime) => HEALTH_KINDS.some((k) => shownOf(read(rt), k));

async function checkAmberx(rt: AxfRuntime) {
  try { amberxLast = await call<AmberxResult>('amberx'); }
  catch (e) { if (gone(e)) return; amberxLast = { at: Date.now(), state: 'off', online: false, lastSeen: 0, text: (e as Error).message }; }
  paint(rt, 'amberx');
  live();
}

async function checkUsage(rt: AxfRuntime, refresh = false) {
  try { usageLast = await call<UsageResult>(`usage${refresh ? '?refresh=1' : ''}`); }
  catch (e) { if (gone(e)) return; if (!usageLast) usageLast = { at: Date.now(), ready: false, why: (e as Error).message, active: '', state: 'off', accounts: [] }; }
  paint(rt, 'usage');
  live();
}

const CHECK: Record<BadgeKind, (rt: AxfRuntime) => Promise<unknown>> = { console: (rt) => Promise.all([testConnection(rt), checkLogin(rt)]), vps: (rt) => checkVps(rt, true), axhub: async () => undefined, amberx: checkAmberx, usage: (rt) => checkUsage(rt, true), disk: (rt) => checkHealth(rt, true), cpu: (rt) => checkHealth(rt, true), memory: (rt) => checkHealth(rt, true) };

function stopReads() { timers.forEach(clearInterval); timers = []; stopped = true; }
/** The badges stay live while they show and the page is open; a hidden page or badge reads nothing. */
function startReads(rt: AxfRuntime) {
  stopped = false;
  if (timers.length) return;
  const every = (kind: BadgeKind, ms: number, f: () => unknown) => timers.push(setInterval(() => { if (!document.hidden && shownOf(read(rt), kind)) void f(); }, ms));
  every('vps', VPS_POLL_MS, () => checkVps(rt));
  every('console', VPS_POLL_MS, () => checkLogin(rt));
  timers.push(setInterval(() => { if (!document.hidden && anyHealthShown(rt)) void checkHealth(rt); }, HEALTH_POLL_MS));
  every('amberx', VPS_POLL_MS, () => checkAmberx(rt));
  every('usage', USAGE_POLL_MS, () => checkUsage(rt));
}

/* ---------------- what a tap does ---------------- */

let openDrop: { kind: BadgeKind; top: number; left: number } | null = null;
let lastPressed: Element | null = null;
const dropListeners = new Set<() => void>();
const setDrop = (d: typeof openDrop) => { openDrop = d; dropListeners.forEach((f) => f()); };

function tap(rt: AxfRuntime, kind: BadgeKind) {
  const plan = tapPlan(read(rt), kind);
  if (plan.do === 'dispatch') { rt.dispatch(plan.spec!); return; }
  if (plan.do === 'toggle') { const v = rt.settings.get(plan.key!); if (v === undefined || typeof v === 'boolean') void rt.settings.set(plan.key!, !v); return; }
  if (plan.do !== 'drop') return;
  if (openDrop?.kind === kind) { setDrop(null); return; }
  const r = (lastPressed ?? (document.activeElement as HTMLElement | null)?.closest('.fx-banner__badge'))?.getBoundingClientRect();
  const w = Math.min(320, globalThis.innerWidth - 16);
  if (kind === 'usage') void checkUsage(rt);
  setDrop({ kind, top: r?.bottom ?? 48, left: Math.max(8, Math.min(r?.left ?? 8, globalThis.innerWidth - w - 8)) });
}

function WindowMeter({ name, w }: { name: string; w: UsageWindow | null }) {
  return (
    <div className={`${P}__win`}>
      <span className="fx-small fx-muted">{name}</span>
      {w ? <Meter value={w.used} label={`${name} ${Math.round(w.used)}% used`} small /> : null}
      <span className="fx-small">{w ? `${Math.round(w.used)}% used${w.resetsAt ? ` · resets ${whenOf(w.resetsAt)}` : ''}` : 'No window open'}</span>
    </div>
  );
}

function AccountRow({ a }: { a: UsageAccount }) {
  const tone = a.status === 'limit' ? 'danger' : a.status === 'ok' ? 'success' : undefined;
  return (
    <div className={`${P}__acct`} data-account={a.name}>
      <div className="fx-row fx-row--wrap">
        <b>{a.name}</b>
        {a.active && <Chip tone="accent">Active</Chip>}
        <span className="fx-small fx-muted">{typeWord(a.type)}{a.plan ? ` · ${a.plan}` : ''}</span>
        <Chip tone={tone}>{statusWord(a.status)}</Chip>
      </div>
      {(a.fresh || a.asOf > 0) && <><WindowMeter name="5-hour" w={a.fiveHour} /><WindowMeter name="Weekly" w={a.weekly} /></>}
      {!a.fresh && a.asOf > 0 && <span className="fx-small fx-muted">As of {new Date(a.asOf).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
      {a.why && <span className="fx-small fx-muted">{a.why}</span>}
    </div>
  );
}

function UsageList({ rt }: { rt: AxfRuntime }) {
  const [busy, setBusy] = useState(false);
  const r = usageLast;
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <b className="fx-grow">Claude accounts</b>
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => { setBusy(true); void checkUsage(rt, true).finally(() => setBusy(false)); }}>{busy ? 'Reading…' : 'Refresh'}</Button>
      </div>
      {!r && <p className="fx-small fx-muted">Reading the accounts…</p>}
      {r && !r.accounts.length && <p className="fx-small fx-muted">{r.why || 'No saved accounts on the VPS.'}</p>}
      {r?.accounts.map((a) => <AccountRow key={a.name} a={a} />)}
      {r && <p className="fx-small fx-muted">Read at {timeOf(r.at)}. Percent of each limit: the service gives no absolute total. No tokens used.</p>}
    </div>
  );
}

/** Every other badge's drop-down: what it knows now, and a check. */
function StatusList({ rt, kind }: { rt: AxfRuntime; kind: BadgeKind }) {
  const [busy, setBusy] = useState(false);
  const data = (ASSETS[kind](rt) as { data: { tooltip: string } }).data;
  return (
    <div className="fx-stack">
      <b>{BADGES[kind].title}</b>
      <p className="fx-small">{data.tooltip}</p>
      <div className="fx-row fx-row--wrap">
        {kind !== 'axhub' && <Button size="sm" icon="refresh" disabled={busy} onClick={() => { setBusy(true); void CHECK[kind](rt).finally(() => setBusy(false)); }}>{busy ? 'Checking…' : 'Check now'}</Button>}
        <Button size="sm" tone="ghost" icon="settings" onClick={() => { setDrop(null); rt.dispatch(`settings.open:${FOLDER}`); }}>Badge settings</Button>
      </div>
    </div>
  );
}

/** The drop-down under a badge, mounted once on the page (slot app.frame.cover); nothing until a badge opens it. */
function Drop() {
  const [, tick] = useState(0);
  const phone = useIsPhone();
  useEffect(() => {
    const again = () => tick((n) => n + 1);
    dropListeners.add(again); liveListeners.add(again);
    return () => { dropListeners.delete(again); liveListeners.delete(again); };
  }, []);
  useEffect(() => {
    if (!openDrop) return undefined;
    const off = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.(`.${P}__drop, .fx-banner__badge`)) setDrop(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrop(null); };
    document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key); };
  });
  if (!openDrop || !runtime) return null;
  const { kind, top, left } = openDrop;
  return createPortal(
    <div className={`fx-popover fx-dropdown ${P}__drop`} style={phone ? { top } : { top, left }} role="dialog" aria-label={BADGES[kind].title} data-fx-overlay="" data-axf-search="off">
      {kind === 'usage' ? <UsageList rt={runtime} /> : <StatusList rt={runtime} kind={kind} />}
    </div>,
    document.body,
  );
}

/* ---------------- settings ---------------- */

function useLive() {
  const [, tick] = useState(0);
  useEffect(() => { const again = () => tick((n) => n + 1); liveListeners.add(again); return () => { liveListeners.delete(again); }; }, []);
}

/** The Claude Code login on the VPS: it lives with the Claude badge (amber when it hit a limit or isn't logged in). */
function LoginBlock({ rt }: { rt: AxfRuntime }) {
  useLive();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!loginLast) void checkLogin(rt); }, [rt]);
  const r = loginLast;
  const st = loginState(r);
  const until = r?.expiresAt ? dayOf(r.expiresAt) : '';
  return (
    <div className="fx-stack">
      <b>Claude Code login on the VPS</b>
      <div className="fx-row fx-row--wrap">
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => { setBusy(true); void checkLogin(rt).finally(() => setBusy(false)); }}>{busy ? 'Checking…' : 'Check login'}</Button>
        {r && <Chip tone={CHIPS[st === 'warn' && r.state === 'error' ? 'error' : st]}>{r.state === 'ok' ? 'logged in' : r.state === 'no-credit' ? 'limit hit' : r.reachable ? 'not logged in' : "can't read"}</Chip>}
        <span className="fx-small">{loginText(r)}</span>
      </div>
      {r && (
        <p className="fx-small fx-muted">
          {r.account ? <>account <span className="fx-mono">{r.account}</span></> : null}{r.plan ? <> · plan {r.plan}</> : null}{until ? <> · login good to {until}</> : null}
          {r.error ? <> · {r.error}</> : null}
        </p>
      )}
    </div>
  );
}

function ConsolePanel({ rt }: { rt: AxfRuntime }) {
  const [r, setR] = useState<TestResult | null>(last);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listeners.add(setR); return () => { listeners.delete(setR); }; }, []);
  const st = stateOf(r);
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Every time the console loads, one tiny message goes through the AI assistant. The Claude badge on the banner turns green and says which model answered, amber with “Out of credits” when the account works but has no credits left, or grey with “AI unavailable” when it can't connect (bad token or account). It also carries the Claude Code login on the VPS: amber when that login hit its limit or isn't logged in.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void testConnection(rt).finally(() => setBusy(false)); }}>{busy ? 'Testing…' : 'Test again'}</Button>
        {r && <Chip tone={CHIPS[st]}>{BADGES.console.states[st].label}</Chip>}
        {r && <span className="fx-small">{popupText(r)}</span>}
      </div>
      {r && (
        <p className="fx-small fx-muted">
          <Icon name="clock" size={12} /> {new Date(r.at).toLocaleTimeString()} · {(r.ms / 1000).toFixed(1)} s
          {r.model ? <> · model <span className="fx-mono">{r.model}</span></> : null}{r.provider ? <> · provider {r.provider}</> : null}
          {r.error ? <> · {r.error}</> : null}
        </p>
      )}
      <LoginBlock rt={rt} />
    </div>
  );
}

/** The VPS badge: a ping, green or red. */
function VpsPanel({ rt }: { rt: AxfRuntime }) {
  useLive();
  const [busy, setBusy] = useState(false);
  const r = pingLast;
  const st = pingState(r);
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">The VPS badge is green while the VPS answers a ping and red when it doesn't. Nothing else: the Claude Code login is on the Claude badge. The host is AXF_VPS_HOST, else the Terminal's VPS host, else the Docker gateway.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void checkVps(rt, true).finally(() => setBusy(false)); }}>{busy ? 'Pinging…' : 'Ping now'}</Button>
        {r && <Chip tone={CHIPS[st]}>{BADGES.vps.states[st].label}</Chip>}
        <span className="fx-small">{pingText(r)}</span>
      </div>
      {r && (
        <p className="fx-small fx-muted">
          <Icon name="clock" size={12} /> {new Date(r.at).toLocaleTimeString()}
          {r.host ? <> · host <span className="fx-mono">{r.host}</span>{r.source ? ` (${r.source})` : ''}</> : null}{r.method ? <> · {r.method === 'icmp' ? 'ICMP ping' : 'TCP port 22'}</> : null}
        </p>
      )}
    </div>
  );
}

/* ---------------- the server health page ---------------- */

/** Settings: where the thresholds live. */
function HealthLink({ rt }: { rt: AxfRuntime }) {
  return (
    <div className="fx-row fx-row--wrap">
      <p className="fx-small fx-muted fx-grow">The Disk, CPU and Mem badges read the VPS every minute. Their warn and red lines are set on the Server health page; the disk passing red raises an alert.</p>
      <Button icon="monitor" onClick={() => rt.dispatch(`nav:${HEALTH_VIEW}`)}>Open server health</Button>
    </div>
  );
}

const pctOf = (h: HealthResult, m: Metric) => h[m]?.pct ?? 0;
function metricLine(h: HealthResult, m: Metric): string {
  if (m === 'disk') return h.disk ? `${gb(h.disk.used)} used, ${gb(h.disk.free)} free of ${gb(h.disk.total)} on ${h.disk.path}` : 'No reading';
  if (m === 'cpu') return h.cpu ? `Load ${h.cpu.load1.toFixed(2)} · ${h.cpu.load5.toFixed(2)} · ${h.cpu.load15.toFixed(2)} (1, 5, 15 min) on ${h.cpu.cores} cores` : 'No reading';
  if (m === 'swap') return !h.swap ? 'No reading' : h.swap.none ? 'This server has no swap' : `${gb(h.swap.used)} of ${gb(h.swap.total)}`;
  return h.memory ? `${gb(h.memory.used)} of ${gb(h.memory.total)} in use` : 'No reading';
}

/** One metric's warn and red lines, saved on the server (so the disk alert follows them with no page open). */
function Thresholds({ rt, h, m }: { rt: AxfRuntime; h: HealthResult; m: Metric }) {
  const [warn, setWarn] = useState(String(h.thresholds[m].warn));
  const [red, setRed] = useState(String(h.thresholds[m].red));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setWarn(String(h.thresholds[m].warn)); setRed(String(h.thresholds[m].red)); }, [h.thresholds, m]);
  const save = async (body: object) => {
    setBusy(true); setErr('');
    try { await call('thresholds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metric: m, ...body }) }); await checkHealth(rt, true); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className={`fx-row fx-row--wrap ${P}__limits`}>
      <TextField label="Warn at %" type="number" value={warn} onChange={setWarn} />
      <TextField label="Red at %" type="number" value={red} onChange={setRed} error={err || undefined} />
      <Button size="sm" disabled={busy} onClick={() => void save({ warn: Number(warn), red: Number(red) })}>Save</Button>
      <Button size="sm" tone="ghost" disabled={busy} onClick={() => void save({ reset: true })}>Defaults</Button>
    </div>
  );
}

function HealthPage() {
  useLive();
  const rt = runtime;
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (rt) { void checkHealth(rt, true); void checkVps(rt); } }, [rt]);
  if (!rt) return null;
  const h = healthLast;
  const ping = pingState(pingLast);
  return (
    <div className="fx-stack fx-stack--lg" data-axf-view={HEALTH_VIEW}>
      <header className="fx-pagehead"><div><p className="fx-eyebrow">VPS</p><h1>Server health</h1></div></header>
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Server health">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void Promise.all([checkHealth(rt, true), checkVps(rt, true)]).finally(() => setBusy(false)); }}>{busy ? 'Reading…' : 'Refresh'}</Button>
        <Chip tone={CHIPS[ping]}>VPS {BADGES.vps.states[ping].label}</Chip>
        <span className="fx-small fx-muted">{pingText(pingLast)}</span>
      </div>
      {!h && <p className="fx-small fx-muted">Reading the server…</p>}
      {h && !h.ready && <p className="fx-small">{h.why}</p>}
      {h?.ready && METRICS.map((m) => (
        <Container key={m} title={METRIC_NAMES[m]} icon={m === 'disk' ? 'box' : m === 'cpu' ? 'chart' : 'layers'}
          actions={<Chip tone={CHIPS[h.states[m]]}>{h.states[m] === 'off' ? 'none' : `${Math.round(pctOf(h, m))}%`}</Chip>}>
          <div className={`fx-stack ${P}__metric`} data-metric={m}>
            {h.states[m] !== 'off' && <Meter value={pctOf(h, m)} label={`${METRIC_NAMES[m]} ${Math.round(pctOf(h, m))}%`} />}
            <span className="fx-small">{metricLine(h, m)}</span>
            <Thresholds rt={rt} h={h} m={m} />
          </div>
        </Container>
      ))}
      {h && <p className="fx-small fx-muted">Read at {timeOf(h.at)} in the console's container, which shares the VPS kernel. Plain code, no tokens. When the disk passes its red line the console raises an alert (also on AmberX).</p>}
    </div>
  );
}

function UsagePanel({ rt }: { rt: AxfRuntime }) {
  const [, tick] = useState(0);
  useEffect(() => { const again = () => tick((n) => n + 1); liveListeners.add(again); void checkUsage(rt); return () => { liveListeners.delete(again); }; }, [rt]);
  return <UsageList rt={rt} />;
}

/** Each badge's four states as it draws them now, with the icon picked for each (repaints as the icons change). */
function StatesPreview({ rt }: { rt: AxfRuntime }) {
  const [, tick] = useState(0);
  useEffect(() => { const offs = KINDS.flatMap((k) => STATE_IDS.map((st) => rt.settings.onChange(iconKey(k, st), () => tick((n) => n + 1)))); return () => offs.forEach((off) => off?.()); }, [rt]);
  return (
    <div className="fx-stack">
      {KINDS.map((k) => (
        <div key={k} className="fx-row fx-row--wrap">
          <span className={`fx-small fx-muted ${P}__who`}>{BADGES[k].title}</span>
          {STATE_IDS.map((st) => (
            <Chip key={st} tone={CHIPS[st]}><Icon name={iconOf(read(rt), k, st)} size={12} /> {BADGES[k].states[st].label}</Chip>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One badge's settings group: how it draws, where it sits, what a tap does and the icon for each state. */
const badgeGroup = (kind: BadgeKind, id: string, order: number) => ({
  id, label: BADGES[kind].title, icon: BADGES[kind].icon, tab: 'claude-badge', order,
  description: `${BADGES[kind].about} Whether it is on the banner, how it draws, what a tap does and the icon for each state.`,
  settings: [
    { key: keyOf(kind, 'show'), label: 'Show on the banner', kind: 'toggle' as const, default: true, scope: 'device' as const },
    { key: keyOf(kind, 'icon-only'), label: 'Icons only', kind: 'toggle' as const, default: false, scope: 'device' as const, description: 'Just the icon, no words. The colour still shows the state.' },
    { key: keyOf(kind, 'label'), label: 'Label', kind: 'text' as const, default: '', scope: 'device' as const, description: `The word on the badge. Empty = ${kind === 'usage' ? 'just the numbers' : BADGES[kind].label}${HEALTH_KINDS.includes(kind as HealthKind) ? ', then the number' : ''}.` },
    { key: keyOf(kind, 'side'), label: 'Side of the banner', kind: 'choice' as const, default: BADGES[kind].side, scope: 'device' as const, options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
    { key: keyOf(kind, 'order'), label: 'Order on the banner', kind: 'number' as const, default: BADGES[kind].order, min: 0, max: 99, step: 1, scope: 'device' as const, description: 'Lower sits further left.' },
    { key: keyOf(kind, 'tap'), label: 'Tap does', kind: 'choice' as const, default: BADGES[kind].tap, scope: 'device' as const, options: TAPS },
    { key: keyOf(kind, 'tap-target'), label: 'Tap target', kind: 'text' as const, default: '', scope: 'device' as const, description: 'Open a screen: a page id or an action such as settings.open:alerts. Run a command: a console action such as terminal.claude. Toggle: a setting key; empty flips Icons only.' },
    ...STATE_IDS.map((st) => ({ key: iconKey(kind, st), label: `${STATE_NAMES[st]} icon: ${BADGES[kind].states[st].setting}`, kind: 'choice' as const, default: BADGES[kind].states[st].icon, scope: 'device' as const, options: ICONS.map((i) => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) })) })),
  ],
});

/** The axHub badge moves in once: the framework's own badge steps aside, keeping whether it was shown. It stays switchable. */
function moveHubBadge(rt: AxfRuntime) {
  if (rt.settings.get(HUB_MOVED) === true) return;
  if (rt.settings.get(OLD_HUB_SHOW) === false) void rt.settings.set(keyOf('axhub', 'show'), false);
  void rt.settings.set(OLD_HUB_SHOW, false);
  void rt.settings.set(HUB_MOVED, true);
}

let runtime: AxfRuntime | null = null;
let watching = false;
let hubSeen = '';

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Badges',
  version: '0.5.0',
  appMenu,
  provides: ['banner.badge.claude', 'banner.badge.claude-vps', 'banner.badge.axhub', 'banner.badge.amberx-phone', 'banner.badge.claude-usage', 'banner.badge.vps-disk', 'banner.badge.vps-cpu', 'banner.badge.vps-memory'],
  views: { [HEALTH_VIEW]: { title: 'Server health', icon: 'monitor', keywords: ['server', 'vps', 'disk', 'cpu', 'load', 'memory', 'ram', 'swap', 'health'], render: () => <HealthPage /> } },
  // Only badges on the app's banner: inside a host that hides the banner it isn't loaded (embed@1 skipWhen).
  embed: { skipWhen: ['hidden:banner'] },
  slots: { 'app.frame.cover': [{ id: 'claude-badge.drop', order: 97, render: () => <Drop /> }] },
  register(rt) {
    runtime = rt;
    moveHubBadge(rt);
    if (!watching) document.addEventListener('pointerdown', (e) => { lastPressed = (e.target as Element | null)?.closest?.('.fx-banner__badge') ?? null; }, true);
    for (const k of KINDS) rt.actions.register(`claude-badge.tap.${k}`, () => tap(rt, k), { label: `${BADGES[k].title}: tap` });
    rt.actions.register('claude-badge.health.open', () => rt.dispatch(`nav:${HEALTH_VIEW}`), { label: 'Open server health' });
    rt.actions.register('claude-badge.health.refresh', () => { void checkHealth(rt, true); }, { label: 'Server health: read again' });
    rt.actions.register('claude-badge.vps.ping', () => { void checkVps(rt, true); }, { label: 'VPS: ping now' });
    if (!watching) {
      watching = true; // hot render: any setting of a badge repaints it at once
      for (const k of KINDS) {
        const keys = [...STATE_IDS.map((st) => iconKey(k, st)), ...(['icon-only', 'label', 'order', 'side', 'tap', 'tap-target'] as const).map((f) => keyOf(k, f))];
        for (const key of keys) rt.settings.onChange(key, () => { if (runtime) paint(runtime, k); });
        rt.settings.onChange(keyOf(k, 'show'), () => {
          if (!runtime) return;
          paint(runtime, k);
          if (!shownOf(read(runtime), k)) return;
          if (k === 'console') { if (!tested) { tested = true; void testConnection(runtime); } void checkLogin(runtime); } else if (k === 'usage') void checkUsage(runtime); else void CHECK[k](runtime);
        });
      }
      rt.subscribe(() => { // the framework's live check moves the axHub badge
        const now = `${hubState(rt)}`;
        if (now === hubSeen) return;
        const was = hubSeen; hubSeen = now;
        paint(rt, 'axhub');
        if (was && shownOf(read(rt), 'axhub')) rt.showBannerPopup(`badge:${BADGES.axhub.id}`, now === 'ok' ? 'axHub is back: settings are live again.' : 'axHub isn’t live: settings aren’t coming from axHub right now.', POP_MS);
      });
    }
    for (const k of KINDS) paint(rt, k);
    // A hidden console badge spends nothing: its test only runs from Test again, or once it is shown.
    if (!tested && shownOf(read(rt), 'console')) { tested = true; setTimeout(() => void testConnection(rt), 600); } // after the backend health check
    if (shownOf(read(rt), 'console')) setTimeout(() => void checkLogin(rt), 700);
    if (shownOf(read(rt), 'vps')) setTimeout(() => void checkVps(rt), 800);
    if (anyHealthShown(rt)) setTimeout(() => void checkHealth(rt), 900);
    if (shownOf(read(rt), 'amberx')) setTimeout(() => void checkAmberx(rt), 1000);
    if (shownOf(read(rt), 'usage')) setTimeout(() => void checkUsage(rt), 1200);
    if (stopped || !timers.length) startReads(rt);
  },
  settingsTabs: [{ id: 'claude-badge', label: 'Badges', icon: 'sparkles', parent: 'plugins', order: 46, description: 'The Claude, VPS, axHub, AmberX, usage, disk, CPU and memory badges on the banner.' }],
  settings: [badgeGroup('console', 'claude-badge.icons', 20), badgeGroup('vps', 'claude-badge.vps', 21), badgeGroup('axhub', 'claude-badge.axhub', 22), badgeGroup('amberx', 'claude-badge.amberx', 23), badgeGroup('usage', 'claude-badge.usage', 24), badgeGroup('disk', 'claude-badge.disk', 25), badgeGroup('cpu', 'claude-badge.cpu', 26), badgeGroup('memory', 'claude-badge.memory', 27)],
  settingsPanels: [
    { id: 'claude-badge.states', tab: 'claude-badge', title: 'The four states', icon: 'eye', order: 15, render: () => (runtime ? <StatesPreview rt={runtime} /> : null) },
    { id: 'claude-badge.status', tab: 'claude-badge', title: 'AI connection', icon: 'sparkles', order: 10, render: () => (runtime ? <ConsolePanel rt={runtime} /> : null) },
    { id: 'claude-badge.vps-status', tab: 'claude-badge', title: 'VPS ping', icon: 'cloud', order: 12, render: () => (runtime ? <VpsPanel rt={runtime} /> : null) },
    { id: 'claude-badge.health-link', tab: 'claude-badge', title: 'Server health', icon: 'monitor', order: 14, render: () => (runtime ? <HealthLink rt={runtime} /> : null) },
    { id: 'claude-badge.usage-status', tab: 'claude-badge', title: 'Usage of every account', icon: 'clock', order: 13, render: () => (runtime ? <UsagePanel rt={runtime} /> : null) },
    { id: 'claude-badge.lifecycle', tab: 'claude-badge', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
