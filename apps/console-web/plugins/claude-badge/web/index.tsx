import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon, Meter, useIsPhone } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

import { ASSET_ID as HUB_ASSET, COUNTER as HUB_COUNTER } from '@console/axf/libs/hubstatus';
import { BADGES, CHIPS, ICONS, KINDS, STATE_IDS, STATE_NAMES, TAPS, TONES, badgeAttachment, buildState, buildText, iconKey, iconOf, keyOf, labelOf, meterText, readyLine, shapeOf, shownOf, statusWord, tapPlan, typeWord } from './model';
import type { BadgeKind, BadgeState, BadgeTone, BuildResult, ReadyAccount, UsageAccount, UsageResult, UsageWindow } from './model';
import './badges.css';

/*
 * Badges (folder claude-badge): five badges on the banner, one plugin. Claude says whether Claude can build: green when one
 * build account or more can sign in and has credits in the orchestrator's account health sweep (the dispatcher's own check,
 * GET /build), red when none can; its drop-down lists which accounts are ready. VPS says whether the console can see those
 * accounts on the host. Neither reads the VPS root `claude auth status` / .active login. axHub shows the framework's live
 * check (hubLive). AmberX shows whether the phone app is connected. The usage meter shows how much of its 5-hour and weekly
 * limits the active account has used. All plain reads: no tokens.
 * Each badge: shown or hidden, Icons only, label, an icon per state, side and order on the banner, and what a tap does.
 * Settings are hot: a badge repaints the moment one changes. model.ts holds the table.
 */
const ID = 'ai.amberx.axf.console.claude-badge';
const FOLDER = 'claude-badge';
const POP_MS = 5000;
const VPS_POLL_MS = 60000;
const BUILD_POLL_MS = 60000;
const USAGE_POLL_MS = 300000;
const OLD_HUB_SHOW = 'hubstatus.show';
const HUB_MOVED = 'claude-badge.axhub.moved';
const P = 'axp-badges';

interface TestResult { at: number; ok: boolean; model: string; name: string; provider: string; ms: number; error: string; claude?: boolean; state?: string; account?: string }
/** The VPS badge (GET /vps, the same read as /build): can the console see the build accounts on the host. */
export interface VpsResult { at: number; ok: boolean; state: string; reachable: boolean; text: string; source?: string; from?: string }
interface AmberxResult { at: number; state: BadgeState; online: boolean; lastSeen: number; text: string }

const read = (rt: AxfRuntime) => (k: string) => rt.settings.get(k);
/** The server's states → the four every badge has. */
export const stateOf = (r: TestResult | null): BadgeState => (r?.state === 'ok' || (!r?.state && r?.ok) ? 'ok' : r?.state === 'no-credit' ? 'warn' : 'error');
const vpsState = (r: VpsResult | null): BadgeState => (r?.state === 'ok' || r?.state === 'warn' || r?.state === 'error' ? r.state : 'off');

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`);
  return j;
}

/** "Powered by Claude Opus 5.5" when connected, "Out of credits" when the account works but has none, else "AI unavailable". */
export const popupText = (r: TestResult | null) => {
  const st = stateOf(r);
  return st === 'ok' ? `Powered by ${r?.name || 'Claude'}` : st === 'warn' ? 'Claude is out of credits' : 'AI unavailable';
};

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const whenOf = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };

/** What the VPS badge says in one line. */
export const vpsText = (r: VpsResult | null) => (r ? r.text || BADGES.vps.states[vpsState(r)].setting : 'Checking the build accounts on the VPS…');
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
  const r = buildLast; const st = buildState(r);
  const tip = !r ? 'Checking whether Claude can build…' : `${r.text}${r.accounts.length ? ` · ready: ${r.accounts.filter((a) => a.ready).map((a) => a.label || a.name).join(', ') || 'none'}` : ''}`;
  return badgeAsset(rt, 'console', !r && buildBusy ? 'warn' : st, TONES[!r && buildBusy ? 'warn' : st], tip, buildText(r, label(rt, 'console')));
}

function vpsAsset(rt: AxfRuntime) {
  const r = vpsLast; const st = vpsState(r);
  return badgeAsset(rt, 'vps', st, TONES[st], vpsText(r));
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
let buildLast: BuildResult | null = null;
let buildBusy = false;
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
  const a = badgeAttachment(read(rt), kind, ID);
  const place = `${a.at}:${a.order}`;
  if (placed[kind] && placed[kind] !== place) rt.detachFromBanner(key);
  placed[kind] = place;
  rt.attachToBanner(a);
}

/** The AI assistant test (Settings → Badges, on demand only): one tiny request through axf.llm@1. No badge reads it. */
export async function testConnection(): Promise<TestResult> {
  let r: TestResult;
  try { r = await call<TestResult>('test', { method: 'POST' }); }
  catch (e) { r = { at: Date.now(), ok: false, model: '', name: '', provider: '', ms: 0, error: (e as Error).message }; }
  last = r;
  listeners.forEach((f) => f(r));
  return r;
}

/** A 404 = the plugin was switched off: nothing to repaint, register() starts the reads again. */
const gone = (e: unknown) => { if (!(e as Error).message.includes('(404)')) return false; stopReads(); return true; };

/**
 * Can Claude build? One read (GET /build) paints both the Claude and the VPS badge. The tooltip pops out only when a
 * state changes after the first read.
 */
export async function checkBuild(rt: AxfRuntime, refresh = false): Promise<BuildResult | null> {
  buildBusy = true;
  let r: BuildResult;
  try { r = await call<BuildResult>(`build${refresh ? '?refresh=1' : ''}`); }
  catch (e) {
    buildBusy = false;
    if (gone(e)) return buildLast;
    const why = (e as Error).message;
    r = { at: Date.now(), ok: false, state: 'off', ready: 0, total: 0, accounts: [], source: 'none', from: '', healthAt: '', text: `Can't tell whether Claude can build: ${why}`, error: why, vps: { state: 'off', reachable: false, text: why } };
  }
  buildBusy = false;
  const was = buildLast; const wasVps = vpsLast;
  buildLast = r;
  vpsLast = { at: r.at, ok: r.vps?.state === 'ok', state: r.vps?.state ?? 'off', reachable: !!r.vps?.reachable, text: r.vps?.text ?? '' };
  paint(rt, 'console'); paint(rt, 'vps');
  if (was && was.state !== r.state && shownOf(read(rt), 'console')) rt.showBannerPopup(`badge:${BADGES.console.id}`, r.text, POP_MS);
  if (wasVps && wasVps.state !== vpsLast.state && shownOf(read(rt), 'vps')) rt.showBannerPopup(`badge:${BADGES.vps.id}`, vpsText(vpsLast), POP_MS);
  vpsListeners.forEach((f) => f(vpsLast));
  live();
  return r;
}
export const checkVps = (rt: AxfRuntime, refresh = false) => checkBuild(rt, refresh).then(() => vpsLast);

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

const CHECK: Record<BadgeKind, (rt: AxfRuntime) => Promise<unknown>> = { console: (rt) => checkBuild(rt, true), vps: (rt) => checkVps(rt, true), axhub: async () => undefined, amberx: checkAmberx, usage: (rt) => checkUsage(rt, true) };

function stopReads() { timers.forEach(clearInterval); timers = []; stopped = true; }
/** The badges stay live while they show and the page is open; a hidden page or badge reads nothing. */
function startReads(rt: AxfRuntime) {
  stopped = false;
  if (timers.length) return;
  const every = (kind: BadgeKind, ms: number, f: () => unknown) => timers.push(setInterval(() => { if (!document.hidden && shownOf(read(rt), kind)) void f(); }, ms));
  timers.push(setInterval(() => { if (!document.hidden && (shownOf(read(rt), 'console') || shownOf(read(rt), 'vps'))) void checkBuild(rt); }, BUILD_POLL_MS));
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
  if (kind === 'console' || kind === 'vps') void checkBuild(rt);
  setDrop({ kind, top: r?.bottom ?? 48, left: Math.max(8, Math.min(r?.left ?? 8, globalThis.innerWidth - w - 8)) });
}

/** Open the Claude badge's ready list without a tap (deep link): under the badge, or its settings when the badge is hidden. */
function openReady(rt: AxfRuntime) {
  if (!shownOf(read(rt), 'console')) { rt.dispatch(`settings.open:${FOLDER}`); return; }
  void checkBuild(rt);
  const r = document.querySelector('.fx-banner__badge')?.getBoundingClientRect();
  setDrop({ kind: 'console', top: r?.bottom ?? 48, left: Math.max(8, Math.min(r?.left ?? 8, globalThis.innerWidth - Math.min(320, globalThis.innerWidth - 16) - 8)) });
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

function ReadyRow({ a }: { a: ReadyAccount }) {
  return (
    <div className={`${P}__acct`} data-account={a.name} data-ready={a.ready ? 'yes' : 'no'}>
      <div className="fx-row fx-row--wrap">
        <b>{a.label || a.name}</b>
        {a.label && <span className="fx-small fx-muted fx-mono">{a.name}</span>}
        <span className="fx-small fx-muted">{a.kind === 'api' ? 'API key' : 'Subscription'}</span>
        <Chip tone={a.ready ? 'success' : 'danger'}>{a.ready ? 'Ready' : 'Not ready'}</Chip>
      </div>
      <span className="fx-small">{readyLine(a)}</span>
      {a.healthAt && <span className="fx-small fx-muted">Health check {whenOf(a.healthAt)}</span>}
    </div>
  );
}

/** The Claude badge's drop-down (and its settings panel): can Claude build, and which build accounts are ready. */
function ReadyList({ rt, inSettings = false }: { rt: AxfRuntime; inSettings?: boolean }) {
  const [busy, setBusy] = useState(false);
  const r = buildLast;
  const st = buildState(r);
  return (
    <div className="fx-stack" data-axf-ready-list="">
      <div className="fx-row fx-row--wrap">
        <b className="fx-grow">Can Claude build?</b>
        {r && <Chip tone={CHIPS[st]}>{BADGES.console.states[st].label}</Chip>}
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => { setBusy(true); void checkBuild(rt, true).finally(() => setBusy(false)); }}>{busy ? 'Reading…' : 'Refresh'}</Button>
      </div>
      {!r && <p className="fx-small fx-muted">Reading the build accounts…</p>}
      {r && <p className="fx-small">{r.text}</p>}
      {r?.accounts.map((a) => <ReadyRow key={a.name} a={a} />)}
      {r && <p className="fx-small fx-muted">Read at {timeOf(r.at)}. The dispatcher's own check over the orchestrator's account health sweep (every 5 minutes). No tokens used.</p>}
      {!inSettings && <Button size="sm" tone="ghost" icon="settings" onClick={() => { setDrop(null); rt.dispatch(`settings.open:${FOLDER}`); }}>Badge settings</Button>}
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
      {kind === 'usage' ? <UsageList rt={runtime} /> : kind === 'console' ? <ReadyList rt={runtime} /> : <StatusList rt={runtime} kind={kind} />}
    </div>,
    document.body,
  );
}

/* ---------------- settings ---------------- */

/** The AI assistant test, on demand: no badge runs it any more (the Claude badge is about builds). */
function AiTestPanel() {
  const [r, setR] = useState<TestResult | null>(last);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listeners.add(setR); return () => { listeners.delete(setR); }; }, []);
  const st = stateOf(r);
  const said = !r ? '' : st === 'ok' ? `Answered: ${r.name || r.model || 'a model'}` : st === 'warn' ? 'Out of credits' : 'AI unavailable';
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Sends one tiny message through the console's AI assistant and says which model answered. Only when you press Test: it costs a few tokens, and nothing on the banner depends on it.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void testConnection().finally(() => setBusy(false)); }}>{busy ? 'Testing…' : 'Test'}</Button>
        {r && <Chip tone={CHIPS[st]}>{st === 'ok' ? 'connected' : st === 'warn' ? 'out of credits' : 'unavailable'}</Chip>}
        {r && <span className="fx-small">{said}</span>}
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

function BuildPanel({ rt }: { rt: AxfRuntime }) {
  const [, tick] = useState(0);
  useEffect(() => { const again = () => tick((n) => n + 1); liveListeners.add(again); void checkBuild(rt); return () => { liveListeners.delete(again); }; }, [rt]);
  return <ReadyList rt={rt} inSettings />;
}

function VpsPanel({ rt }: { rt: AxfRuntime }) {
  const [r, setR] = useState<VpsResult | null>(vpsLast);
  const [busy, setBusy] = useState(false);
  useEffect(() => { vpsListeners.add(setR); return () => { vpsListeners.delete(setR); }; }, []);
  const st = vpsState(r);
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">Whether the console can see the build accounts on the VPS: green when it reads them (live, or the host dispatcher's snapshot from the last 10 minutes), amber when that snapshot is older, red when it can't see them. Plain reads, no tokens; it never reads the VPS root login.</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={busy} onClick={() => { setBusy(true); void checkVps(rt, true).finally(() => setBusy(false)); }}>{busy ? 'Checking…' : 'Check now'}</Button>
        {r && <Chip tone={CHIPS[st]}>{BADGES.vps.states[st].label}</Chip>}
        {r && <span className="fx-small">{vpsText(r)}</span>}
      </div>
      {r && <p className="fx-small fx-muted"><Icon name="clock" size={12} /> {new Date(r.at).toLocaleTimeString()}</p>}
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
  version: '0.6.0',
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
    // deep links: open the Claude badge's ready list, or read it again (console_open / voice / CLI reach these by id)
    rt.actions.register('claude-badge.ready.open', () => openReady(rt), { label: 'Claude: which build accounts are ready' });
    rt.actions.register('claude-badge.ready.refresh', () => void checkBuild(rt, true), { label: 'Claude: check the build accounts again' });
    if (!watching) {
      watching = true; // hot render: any setting of a badge repaints it at once
      for (const k of KINDS) {
        const keys = [...STATE_IDS.map((st) => iconKey(k, st)), ...(['icon-only', 'label', 'order', 'side', 'tap', 'tap-target'] as const).map((f) => keyOf(k, f))];
        for (const key of keys) rt.settings.onChange(key, () => { if (runtime) paint(runtime, k); });
        rt.settings.onChange(keyOf(k, 'show'), () => {
          if (!runtime) return;
          paint(runtime, k);
          if (!shownOf(read(runtime), k)) return;
          if (k === 'console' || k === 'vps') void checkBuild(runtime); else if (k === 'usage') void checkUsage(runtime); else void CHECK[k](runtime);
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
    if (shownOf(read(rt), 'console') || shownOf(read(rt), 'vps')) setTimeout(() => void checkBuild(rt), 600); // after the backend health check
    if (shownOf(read(rt), 'amberx')) setTimeout(() => void checkAmberx(rt), 1000);
    if (shownOf(read(rt), 'usage')) setTimeout(() => void checkUsage(rt), 1200);
    if (stopped || !timers.length) startReads(rt);
  },
  settingsTabs: [{ id: 'claude-badge', label: 'Badges', icon: 'sparkles', parent: 'plugins', order: 46, description: 'The Claude, VPS, axHub, AmberX and usage badges on the banner.' }],
  settings: [badgeGroup('console', 'claude-badge.icons', 20), badgeGroup('vps', 'claude-badge.vps', 21), badgeGroup('axhub', 'claude-badge.axhub', 22), badgeGroup('amberx', 'claude-badge.amberx', 23), badgeGroup('usage', 'claude-badge.usage', 24)],
  settingsPanels: [
    { id: 'claude-badge.states', tab: 'claude-badge', title: 'The four states', icon: 'eye', order: 15, render: () => (runtime ? <StatesPreview rt={runtime} /> : null) },
    { id: 'claude-badge.status', tab: 'claude-badge', title: 'Can Claude build', icon: 'sparkles', order: 10, render: () => (runtime ? <BuildPanel rt={runtime} /> : null) },
    { id: 'claude-badge.vps-status', tab: 'claude-badge', title: 'VPS build accounts', icon: 'cloud', order: 12, render: () => (runtime ? <VpsPanel rt={runtime} /> : null) },
    { id: 'claude-badge.ai-test', tab: 'claude-badge', title: 'AI assistant test', icon: 'zap', order: 14, render: () => <AiTestPanel /> },
    { id: 'claude-badge.usage-status', tab: 'claude-badge', title: 'Usage of every account', icon: 'clock', order: 13, render: () => (runtime ? <UsagePanel rt={runtime} /> : null) },
    { id: 'claude-badge.lifecycle', tab: 'claude-badge', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
