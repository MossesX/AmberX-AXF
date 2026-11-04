/**
 * axHub status badge (`ai.amberx.axf.hubstatus`, web): a small badge on the banner of any AXF app saying whether the
 * app is reading its settings **live** from axHub. Red from the start ("axHub …") and whenever it isn't, green only
 * while it is (the rule in `./core.ts`). No dependencies.
 *
 *   import { hubStatusLibrary } from '<app>/axf/libs/hubstatus';
 *   installLibraries(rt, [settingsLibrary, hubStatusLibrary, ...]);
 *
 * - The badge is the framework's `status` widget (asset `status/axhub`, counter `hub.live`), attached to the banner's
 *   right side; no new asset type, so it sits next to any other status widget (each has its own id and counter).
 * - Every check reads the settings document from the hub (`GET <hub>/data/shared/settings/appearance.json`) with the
 *   browser's own hub session: no token, no redirects, no cache. A developer app's own hub source (the runtime's
 *   appearance source) must also be ready. The hub is the app's appearance hub when it has one, else the setting.
 * - Tap → dialog with the state, why, hub, last live read, and a "More" row that expands the details; Check now.
 * - When the state changes, a pop-up note (on the banner or as a toast, for a set number of seconds, or off).
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import './hubstatus.css';
import { Button, Chip, Icon, IconButton } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import type { AxfRuntime } from '../../core/runtime';
import {
  ASSET_ID, COUNTER, DEFAULT_LOOK, ID, ago, changeNote, clampEvery, clampSeconds, hostOf, hubLive, probeFrom, settingsUrl, statusAsset,
  type BadgeLook, type HubProbe, type HubStatus, type SourceState,
} from './core';

export * from './core';

export const DEFAULT_HUB = 'https://axhub.amberxai.com';
const K = {
  show: 'hubstatus.show', side: 'hubstatus.side', hub: 'hubstatus.hub', every: 'hubstatus.every',
  liveLabel: 'hubstatus.liveLabel', notLiveLabel: 'hubstatus.notLiveLabel', dot: 'hubstatus.dot',
  popup: 'hubstatus.popup', popupSeconds: 'hubstatus.popupSeconds',
} as const;

/* ---------------- store ---------------- */

interface State { probe: HubProbe | null; status: HubStatus; hub: string; checking: boolean }
let st: State = { probe: null, status: { live: 'checking', why: 'Checking axHub…' }, hub: DEFAULT_HUB, checking: false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useHubStatus = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);

let runtime: AxfRuntime | null = null;
let painted = '';
let lastLive: HubStatus['live'] | null = null;

const str = (rt: AxfRuntime, k: string, d: string) => { const v = rt.settings.get(k); return typeof v === 'string' && v.trim() ? v.trim() : d; };
const everyMs = (rt: AxfRuntime) => clampEvery(rt.settings.get(K.every) ?? 30) * 1000;
const look = (rt: AxfRuntime): BadgeLook => ({
  liveLabel: str(rt, K.liveLabel, DEFAULT_LOOK.liveLabel),
  notLiveLabel: str(rt, K.notLiveLabel, DEFAULT_LOOK.notLiveLabel),
  checkingLabel: DEFAULT_LOOK.checkingLabel,
  dot: rt.settings.get(K.dot) !== false,
});

/** The hub to check: the one this app reads its look from, else the setting. */
function hubOf(rt: AxfRuntime): string {
  const own = rt.appearanceHub();
  const raw = own || str(rt, K.hub, DEFAULT_HUB);
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (local && u.protocol === 'http:') ? u.origin : DEFAULT_HUB;
  } catch { return DEFAULT_HUB; }
}

/** Re-decide from what we know now (no network); repaint and pop up only when something changed. */
function evaluate(rt: AxfRuntime): void {
  const source = rt.appearanceState() as SourceState;
  const status = hubLive(st.probe, source, Date.now(), everyMs(rt) * 2 + 5000);
  if (status.live !== st.status.live || status.why !== st.status.why) set({ status });
  paint(rt);
  const note = changeNote(lastLive, status.live);
  lastLive = status.live;
  if (note) popup(rt, note, status.live === 'live');
}

function paint(rt: AxfRuntime): void {
  const show = rt.settings.get(K.show) !== false;
  const at = rt.settings.get(K.side) === 'left' ? 'left' : 'right';
  const asset = statusAsset(st.status, look(rt));
  const key = JSON.stringify([asset.data, show, at, st.status.live]);
  if (key === painted) return;
  painted = key;
  rt.registry.register(asset, 'app', ID);
  rt.setBadge(COUNTER, st.status.live === 'live' ? 1 : 0);
  if (show) rt.attachToBanner({ type: 'status', id: ASSET_ID, at, order: 24, origin: ID });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

function popup(rt: AxfRuntime, text: string, good: boolean): void {
  const how = rt.settings.get(K.popup) ?? 'banner';
  const ms = clampSeconds(rt.settings.get(K.popupSeconds) ?? 5) * 1000;
  if (how === 'off') return;
  if (how === 'toast') rt.toast(text, good ? 'success' : 'danger', 'axHub');
  else rt.showBannerPopup(`status:${ASSET_ID}`, text, ms);
}

let inflight = false;
/** One live read of the settings document on the hub. */
export async function checkNow(): Promise<void> {
  const rt = runtime;
  if (!rt || inflight) return;
  inflight = true;
  const hub = hubOf(rt);
  set({ checking: true, hub });
  const t0 = Date.now();
  let probe: HubProbe;
  try {
    const ctl = new AbortController();
    const kill = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(settingsUrl(hub), { credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' }, signal: ctl.signal });
    clearTimeout(kill);
    probe = probeFrom(r.status, Date.now(), Date.now() - t0, hub, '', r.headers.get('etag') ?? undefined);
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'no answer in 8 s' : (e as Error).message;
    probe = probeFrom(0, Date.now(), Date.now() - t0, hub, msg);
  } finally {
    inflight = false;
  }
  set({ probe, checking: false });
  evaluate(rt);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const onFocus = () => { if (visible()) void checkNow(); };

function loop(): void {
  if (timer) clearTimeout(timer);
  const rt = runtime;
  if (!rt) return;
  timer = setTimeout(() => { if (visible()) void checkNow(); loop(); }, everyMs(rt));
}

function start(rt: AxfRuntime): void {
  runtime = rt;
  paint(rt);
  if (ticker) return;
  void checkNow();
  loop();
  // staleness and the app's own hub source are re-checked every 5 s and on every runtime change, without the network
  ticker = setInterval(() => evaluate(rt), 5000);
  let lastSource = rt.appearanceState()?.status;
  rt.subscribe(() => { const s = rt.appearanceState()?.status; if (s !== lastSource) { lastSource = s; evaluate(rt); } });
  globalThis.addEventListener?.('focus', onFocus);
  globalThis.addEventListener?.('online', onFocus);
  globalThis.addEventListener?.('offline', () => { set({ probe: probeFrom(0, Date.now(), 0, st.hub, 'this device is offline') }); evaluate(rt); });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onFocus);
}

/* ---------------- the dialog ---------------- */

const WORD = { live: 'Live', 'not-live': 'Not live', checking: 'Checking' } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="axf-hubstatus__row"><span className="fx-muted">{label}</span><span>{children}</span></div>;
}

function StatusCard() {
  const s = useHubStatus();
  const [more, setMore] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const now = Date.now();
  const p = s.probe;
  const src = runtime?.appearanceState();
  return (
    <div className="fx-stack axf-hubstatus">
      <div className="fx-row fx-row--wrap">
        <span className="axf-hubstatus__dot" data-on={s.status.live === 'live' ? '1' : '0'} aria-hidden="true" />
        <strong>{WORD[s.status.live]}</strong>
        <Chip tone={s.status.live === 'live' ? 'success' : 'danger'}>{hostOf(s.hub)}</Chip>
      </div>
      <p style={{ margin: 0 }}>{s.status.why}</p>
      <Row label="Last live read">{p?.ok ? `${ago(p.at, now)} ago` : 'none yet'}</Row>
      <Row label="Last check">{p ? `${ago(p.at, now)} ago · ${p.ok ? 'answered' : 'failed'}` : s.checking ? 'checking…' : 'not yet'}</Row>
      <button type="button" className="axf-hubstatus__more" data-fx-row aria-expanded={more} onClick={() => setMore(!more)}>
        <Icon name={more ? 'chevron-down' : 'chevron-right'} size={14} /> More about the connection
      </button>
      {more && (
        <div className="fx-stack axf-hubstatus__details">
          <Row label="Answer">{p ? (p.status ? `HTTP ${p.status}${p.status === 404 ? ' (nothing saved yet: defaults from the hub)' : ''}` : 'no answer') : '—'}</Row>
          <Row label="Took">{p ? `${p.ms} ms` : '—'}</Row>
          {p?.version && <Row label="Settings version"><span className="fx-mono">{p.version}</span></Row>}
          <Row label="This app’s hub settings">{src ? src.status : 'none (only this check)'}</Row>
          <Row label="Reads"><span className="fx-mono fx-small">{settingsUrl(s.hub)}</span></Row>
          <Row label="Checks every">{runtime ? `${everyMs(runtime) / 1000} s while the page is visible, and on focus` : '—'}</Row>
        </div>
      )}
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" disabled={s.checking} onClick={() => void checkNow()}>{s.checking ? 'Checking…' : 'Check now'}</Button>
        <Button icon="external" onClick={() => globalThis.open(s.hub, '_blank', 'noopener')}>Open axHub</Button>
        <IconButton icon="settings" label="Settings" onClick={() => { runtime?.closeDialog(); runtime?.dispatch('settings.open:hubstatus'); }} />
      </div>
    </div>
  );
}

/* ---------------- the library ---------------- */

export const hubStatusLibrary: AxfWebLibrary = {
  id: ID,
  label: 'axHub status',
  version: '0.1.0',
  provides: ['banner.status.axhub'],
  register(rt) {
    rt.actions.register('hubstatus.open', () => rt.openDialog('hubstatus.details'), { label: 'Show the axHub connection' });
    rt.actions.register('hubstatus.check', () => void checkNow(), { label: 'Check axHub now' });
    for (const k of Object.values(K)) rt.settings.onChange(k, () => { painted = ''; if (k === K.every) loop(); if (k === K.hub) void checkNow(); else evaluate(rt); });
    start(rt);
  },
  dialogs: {
    'hubstatus.details': { title: 'axHub connection', icon: 'cloud', render: () => <StatusCard /> },
  },
  settingsTabs: [{ id: 'hubstatus', label: 'axHub status', icon: 'cloud', parent: 'plugins', order: 46, description: 'The axHub badge on the banner: green only while settings come live from axHub.' }],
  settings: [
    { id: 'hubstatus.badge', label: 'The badge', icon: 'eye', tab: 'hubstatus', order: 10, settings: [
      { key: K.show, label: 'Show the axHub badge on the banner', kind: 'toggle', default: true, scope: 'device', slot: 'banner' },
      { key: K.side, label: 'Side', kind: 'choice', default: 'right', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], scope: 'device' },
      { key: K.dot, label: 'Show the dot', kind: 'toggle', default: true },
      { key: K.liveLabel, label: 'Words while live (green)', kind: 'text', default: DEFAULT_LOOK.liveLabel },
      { key: K.notLiveLabel, label: 'Words while not live (red)', kind: 'text', default: DEFAULT_LOOK.notLiveLabel },
    ] },
    { id: 'hubstatus.popup', label: 'When it changes', icon: 'info', tab: 'hubstatus', order: 20, settings: [
      { key: K.popup, label: 'Pop-up note', kind: 'choice', default: 'banner', options: [{ value: 'banner', label: 'Next to the badge' }, { value: 'toast', label: 'Toast' }, { value: 'off', label: 'Off' }] },
      { key: K.popupSeconds, label: 'Seconds it stays', kind: 'number', default: 5, min: 1, max: 60, step: 1 },
    ] },
    { id: 'hubstatus.check', label: 'Checking', icon: 'refresh', tab: 'hubstatus', order: 30, settings: [
      { key: K.every, label: 'Check every (seconds)', kind: 'number', default: 30, min: 10, max: 600, step: 5 },
      { key: K.hub, label: 'axHub address (used when the app has no hub of its own)', kind: 'text', default: DEFAULT_HUB },
    ] },
  ],
  settingsPanels: [
    { id: 'hubstatus.now', tab: 'hubstatus', title: 'Now', icon: 'cloud', order: 5, render: () => <StatusCard /> },
  ],
};

export default hubStatusLibrary;
