import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon, Meter, useIsPhone } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

import { ASSET_ID as HUB_ASSET, COUNTER as HUB_COUNTER } from '@console/axf/libs/hubstatus';
import { BADGES, CHIPS, ICONS, KINDS, STATE_IDS, STATE_NAMES, TAPS, TONES, iconKey, iconOf, keyOf, labelOf, meterText, orderOf, shapeOf, shownOf, sideOf, statusWord, tapPlan, typeWord } from './model';
import type { BadgeKind, BadgeState, BadgeTone, UsageAccount, UsageResult, UsageWindow } from './model';
import './badges.css';

/*
 * Badges (folder claude-badge): five badges on the banner, one plugin. Claude tests the AI connection when the console
 * loads (axf.llm@1). VPS watches the Claude Code login on the host. axHub shows the framework's live check (hubLive): green
 * only while settings come live from axHub, red otherwise. AmberX shows whether the phone app is connected. The usage
 * meter shows how much of its 5-hour and weekly limits the active account has used. Everything but the Claude test is
 * plain code and costs no tokens.
 * Each badge: shown or hidden, Icons only, label, an icon per state, side and order on the banner, and what a tap does.
 * Settings are hot: a badge repaints the moment one changes. model.ts holds the table.
 */
const ID = 'ai.amberx.axf.console.claude-badge';
const FOLDER = 'claude-badge';
const POP_MS = 5000;
const VPS_POLL_MS = 60000;
const USAGE_POLL_MS = 300000;
const OLD_HUB_SHOW = 'hubstatus.show';
const HUB_MOVED = 'claude-badge.axhub.moved';
const P = 'axp-badges';

interface TestResult { at: number; ok: boolean; model: string; name: string; provider: string; ms: number; error: string; claude?: boolean; state?: string; account?: string }
/** One read of the Claude Code login on the VPS (GET /vps): plain code, no tokens, never a credential. */
export interface VpsResult { at: number; ok: boolean; state: string; reachable: boolean; account: string; email: string; plan: string; expiresAt: string; limitedAt: number; error: string }
interface AmberxResult { at: number; state: BadgeState; online: boolean; lastSeen: number; text: string }

const read = (rt: AxfRuntime) => (k: string) => rt.settings.get(k);
/** The server's states → the four every badge has. */
export const stateOf = (r: TestResult | null): BadgeState => (r?.state === 'ok' || (!r?.state && r?.ok) ? 'ok' : r?.state === 'no-credit' ? 'warn' : 'error');
const vpsState = (r: VpsResult | null): BadgeState => (!r || !r.reachable ? 'off' : r.state === 'ok' ? 'ok' : r.state === 'no-credit' ? 'warn' : 'error');

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

/** What the VPS badge says in one line. */
export const vpsText = (r: VpsResult | null) => {
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
  const tip = checking ? 'Checking the AI connection…'
    : st === 'ok' ? `${popupText(r)}${r?.provider ? ` · ${r.provider}` : ''} · ${(r!.ms / 1000).toFixed(1)} s`
    : st === 'warn' ? `Out of credits: the account works but can't answer until it's topped up${why}` : `AI unavailable${why}`;
  return badgeAsset(rt, 'console', !r ? 'off' : st, checking || st === 'error' ? 'muted' : TONES[st], tip);
}

function vpsAsset(rt: AxfRuntime) {
  const r = vpsLast; const st = vpsState(r);
  const until = r?.state === 'ok' && r.expiresAt ? dayOf(r.expiresAt) : '';
  const rest = [r?.plan, until ? `login good to ${until}` : '', r && !r.reachable ? r.error : ''].filter(Boolean).join(' · ');
  return badgeAsset(rt, 'vps', st, TONES[st], rest ? `${vpsText(r)} · ${rest}` : vpsText(r));
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

const ASSETS: Record<BadgeKind, (rt: AxfRuntime) => object> = { console: consoleAsset, vps: vpsAsset, axhub: axhubAsset, amberx: amberxAsset, usage: usageAsset };

let last: TestResult | null = null;
let tested = false;
let checking = false;
const listeners = new Set<(r: TestResult | null) => void>();
let vpsLast: VpsResult | null = null;
const vpsListeners = new Set<(r: VpsResult | null) => void>();
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
  const at = sideOf(read(rt), kind); const order = orderOf(read(rt), kind);
  const place = `${at}:${order}`;
  if (placed[kind] && placed[kind] !== place) rt.detachFromBanner(key);
  placed[kind] = place;
  rt.attachToBanner({ type: 'badge', id: d.id, at, order, origin: ID, widget: { label: d.title, priority: 8, aliases: d.aliases, ...(kind === 'usage' ? { size: 'wide' as const } : {}) } });
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

/** Read the VPS login and repaint; the tooltip pops out only when the state changes after the first read. */
export async function checkVps(rt: AxfRuntime): Promise<VpsResult | null> {
  let r: VpsResult;
  try { r = await call<VpsResult>('vps'); }
  catch (e) {
    if (gone(e)) return vpsLast;
    r = { at: Date.now(), ok: false, state: 'error', reachable: false, account: '', email: '', plan: '', expiresAt: '', limitedAt: 0, error: (e as Error).message };
  }
  const changed = !!vpsLast && (vpsLast.state !== r.state || vpsLast.reachable !== r.reachable);
  vpsLast = r;
  paint(rt, 'vps');
  if (changed && shownOf(read(rt), 'vps')) rt.showBannerPopup(`badge:${BADGES.vps.id}`, vpsText(r), POP_MS);
  vpsListeners.forEach((f) => f(r));
  return r;
}

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

const CHECK: Record<BadgeKind, (rt: AxfRuntime) => Promise<unknown>> = { console: testConnection, vps: checkVps, axhub: async () => undefined, amberx: checkAmberx, usage: (rt) => checkUsage(rt, true) };

function stopReads() { timers.forEach(clearInterval); timers = []; stopped = true; }
/** The badges stay live while they show and the page is open; a hidden page or badge reads nothing. */
function startReads(rt: AxfRuntime) {
  stopped = false;
  if (timers.length) return;
  const every = (kind: BadgeKind, ms: number, f: () => unknown) => timers.push(setInterval(() => { if (!document.hidden && shownOf(read(rt), kind)) void f(); }, ms));
  every('vps', VPS_POLL_MS, () => checkVps(rt));
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

function ConsolePanel({ rt }: { rt: AxfRuntime }) {
  const [r, setR] = useState<TestResult | null>(last);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listeners.add(setR); return () => { listeners.delete(setR); }; }, []);
  const st = stateOf(r);
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Every time the console loads, one tiny message goes through the AI assistant. The Claude badge on the banner turns green and says which model answered, amber with “Out of credits” when the account works but has no credits left, or grey with “AI unavailable” when it can't connect (bad token or account).</p>
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
    </div>
  );
}

function VpsPanel({ rt }: { rt: AxfRuntime }) {
  const [r, setR] = useState<VpsResult | null>(vpsLast);
  const [busy, setBusy] = useState(false);
  useEffect(() => { vpsListeners.add(setR); return () => { vpsListeners.delete(setR); }; }, []);
  const until = r?.expiresAt ? dayOf(r.expiresAt) : '';
  const st = vpsState(r);
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Watches the Claude Code login on the VPS with plain code, so it costs no tokens. Green is logged in and working, amber is limit hit or out of credits (for 24 hours after a build hits it, unless you switch accounts), red is not logged in, grey is the console can't read the VPS.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void checkVps(rt).finally(() => setBusy(false)); }}>{busy ? 'Checking…' : 'Check now'}</Button>
        {r && <Chip tone={CHIPS[st]}>{BADGES.vps.states[st].label}</Chip>}
        {r && <span className="fx-small">{vpsText(r)}</span>}
      </div>
      {r && (
        <p className="fx-small fx-muted">
          <Icon name="clock" size={12} /> {new Date(r.at).toLocaleTimeString()}
          {r.account ? <> · account <span className="fx-mono">{r.account}</span></> : null}{r.plan ? <> · plan {r.plan}</> : null}{until ? <> · login good to {until}</> : null}
          {r.error ? <> · {r.error}</> : null}
        </p>
      )}
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
    { key: keyOf(kind, 'label'), label: 'Label', kind: 'text' as const, default: '', scope: 'device' as const, description: `The word on the badge. Empty = ${kind === 'usage' ? 'just the numbers' : BADGES[kind].label}.` },
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
  provides: ['banner.badge.claude', 'banner.badge.claude-vps', 'banner.badge.axhub', 'banner.badge.amberx-phone', 'banner.badge.claude-usage'],
  // Only badges on the app's banner: inside a host that hides the banner it isn't loaded (embed@1 skipWhen).
  embed: { skipWhen: ['hidden:banner'] },
  slots: { 'app.frame.cover': [{ id: 'claude-badge.drop', order: 97, render: () => <Drop /> }] },
  register(rt) {
    runtime = rt;
    moveHubBadge(rt);
    if (!watching) document.addEventListener('pointerdown', (e) => { lastPressed = (e.target as Element | null)?.closest?.('.fx-banner__badge') ?? null; }, true);
    for (const k of KINDS) rt.actions.register(`claude-badge.tap.${k}`, () => tap(rt, k), { label: `${BADGES[k].title}: tap` });
    if (!watching) {
      watching = true; // hot render: any setting of a badge repaints it at once
      for (const k of KINDS) {
        const keys = [...STATE_IDS.map((st) => iconKey(k, st)), ...(['icon-only', 'label', 'order', 'side', 'tap', 'tap-target'] as const).map((f) => keyOf(k, f))];
        for (const key of keys) rt.settings.onChange(key, () => { if (runtime) paint(runtime, k); });
        rt.settings.onChange(keyOf(k, 'show'), () => {
          if (!runtime) return;
          paint(runtime, k);
          if (!shownOf(read(runtime), k)) return;
          if (k === 'console') { if (!tested) { tested = true; void testConnection(runtime); } } else if (k === 'usage') void checkUsage(runtime); else void CHECK[k](runtime);
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
    if (shownOf(read(rt), 'vps')) setTimeout(() => void checkVps(rt), 800);
    if (shownOf(read(rt), 'amberx')) setTimeout(() => void checkAmberx(rt), 1000);
    if (shownOf(read(rt), 'usage')) setTimeout(() => void checkUsage(rt), 1200);
    if (stopped || !timers.length) startReads(rt);
  },
  settingsTabs: [{ id: 'claude-badge', label: 'Badges', icon: 'sparkles', parent: 'plugins', order: 46, description: 'The Claude, VPS, axHub, AmberX and usage badges on the banner.' }],
  settings: [badgeGroup('console', 'claude-badge.icons', 20), badgeGroup('vps', 'claude-badge.vps', 21), badgeGroup('axhub', 'claude-badge.axhub', 22), badgeGroup('amberx', 'claude-badge.amberx', 23), badgeGroup('usage', 'claude-badge.usage', 24)],
  settingsPanels: [
    { id: 'claude-badge.states', tab: 'claude-badge', title: 'The four states', icon: 'eye', order: 15, render: () => (runtime ? <StatesPreview rt={runtime} /> : null) },
    { id: 'claude-badge.status', tab: 'claude-badge', title: 'AI connection', icon: 'sparkles', order: 10, render: () => (runtime ? <ConsolePanel rt={runtime} /> : null) },
    { id: 'claude-badge.vps-status', tab: 'claude-badge', title: 'VPS connection', icon: 'cloud', order: 12, render: () => (runtime ? <VpsPanel rt={runtime} /> : null) },
    { id: 'claude-badge.usage-status', tab: 'claude-badge', title: 'Usage of every account', icon: 'clock', order: 13, render: () => (runtime ? <UsagePanel rt={runtime} /> : null) },
    { id: 'claude-badge.lifecycle', tab: 'claude-badge', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
