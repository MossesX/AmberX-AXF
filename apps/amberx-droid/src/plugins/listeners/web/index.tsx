/**
 * Listeners: the control panel for every background listener in AmberX (Nov 6 2026, Fable, build gizmo-rebuild-fable).
 * Brett: "I need more powerful controls over the background listeners for AmberX. I've had problems with the
 * microphone... it's crashing with other apps, and sometimes it'll just do that sound over and over."
 *
 * One row per listener (framework/libs/listeners `LISTENERS` + anything the phone reports): state chip (listening,
 * paused for a call / another app, stopped on errors with the reason), who holds the microphone, the last error and
 * how many restarts it is on, and its controls: allowed, pause for calls, pause for other apps, start sound, restarts
 * before it gives up, Restart now. The controls are app settings (`amberx.listeners.<id>.<field>`, declared below so
 * lib-hubsync carries them to every device and the Dev Console); every change is pushed to the native side at once
 * (`native.listenerSet`), and the device's state (listener-state@1) is published to the hub table
 * amberx-axf/_data/listeners/devices for the console's AmberX listeners plugin.
 *
 * HOOKS other plugins use (keep these names):
 *   action `listeners.open`            open the panel
 *   action `listeners.restart:<id>`    restart one listener (allowed off → on)
 *   view   `listeners`
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Chip, Container, Note, SelectField, Switch, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { HubData, type Row } from '../../../axf/libs/hubstore';
import { hubSync } from '../../../axf/libs/hubsync';
import {
  HUB, LISTENERS, RETRY_CHOICES, deviceSummary, listenerDef, listenerLabel, policyFieldsFor, policyFrom, policyKeys, stateLabel, stateTone,
  type DeviceListeners, type ListenerInfo,
} from '../../../axf/libs/listeners';
import { HUB as HUB_URL } from '../../../hub/useHub';
import { Subscriptions, deviceStore } from '../../../listeners';
import { micLease } from '../../../miclease';
import { isNative, native, type ListenersStatus } from '../../../native';
import { soundState } from '../../../sound';
import { changedPolicies, combine, deviceIdOf, deviceNameOf, pageRows, restartKey, restartRequests, settingsGroups } from './core';
import './listeners.css';

export const LISTENERS_ID = 'ai.amberx.amberx.listeners';
const VERSION = '0.1.0';
/** Publish the device document at most this often (changes are coalesced), and at least this often while visible. */
const PUBLISH_MIN_MS = 10_000;
const HEARTBEAT_MS = 5 * 60_000;
/** Re-read the synced settings (the console may have changed a policy) this often while the panel is open. */
const REFRESH_MS = 60_000;

/* ---------------------------------------------------------------- the store */

interface State { native: ListenersStatus | null; doc: DeviceListeners | null; error: string; publishedAt: number; publishError: string }
let state: State = { native: null, doc: null, error: '', publishedAt: 0, publishError: '' };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const useListeners = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
let rtRef: AxfRuntime | null = null;
const nativeSubs = new Subscriptions();

function identity() {
  const store = deviceStore();
  return { device: deviceIdOf(store, isNative()), name: deviceNameOf(globalThis.navigator?.userAgent ?? '', isNative()), side: isNative() ? 'native' as const : 'page' as const };
}

/** The device document right now, from the native status, the page's own listeners and the policies. */
function build(rt: AxfRuntime, nat: ListenersStatus | null): DeviceListeners {
  const s = soundState();
  const page = pageRows({ leaseHolder: micLease().holder(), soundOwner: s.owner, quiet: s.quiet }, isNative());
  return combine(nat, page, { ...identity(), now: Date.now() }, (k) => rt.settings.get(k));
}

function refreshDoc(rt: AxfRuntime, nat: ListenersStatus | null = state.native) {
  const doc = build(rt, nat);
  set({ native: nat, doc });
  schedulePublish(rt);
}

async function readNative(rt: AxfRuntime) {
  try { refreshDoc(rt, await native.listenersStatus()); set({ error: '' }); }
  catch (e) { refreshDoc(rt, null); set({ error: e instanceof Error ? e.message : String(e) }); }
}

/* ---------------------------------------------------------------- publishing to the hub */

let table: ReturnType<HubData['table']> | null = null;
let publishTimer: ReturnType<typeof setTimeout> | null = null;
function devices() {
  table ??= new HubData({ hub: HUB_URL, project: HUB.project, folder: HUB.folder, mode: 'all', appId: LISTENERS_ID }).table(HUB.table);
  return table;
}
async function publish(rt: AxfRuntime) {
  if (rt.settings.get(K.publish) === false) return;
  const doc = state.doc ?? build(rt, state.native);
  try { await devices().put(doc.device, doc as unknown as Row); set({ publishedAt: Date.now(), publishError: '' }); }
  catch (e) { set({ publishError: e instanceof Error ? e.message : String(e) }); }
}
function schedulePublish(rt: AxfRuntime) {
  if (publishTimer) return;
  const wait = Math.max(0, PUBLISH_MIN_MS - (Date.now() - state.publishedAt));
  publishTimer = setTimeout(() => { publishTimer = null; void publish(rt); }, wait);
}

/* ---------------------------------------------------------------- settings keys */

export const K = {
  /** publish this device's listener state to the hub for the console */
  publish: 'amberx.listeners.publish',
} as const;

/** Push one listener's policy to the native side (the services obey it with the app closed too). */
async function pushPolicy(rt: AxfRuntime, id: string) {
  try { refreshDoc(rt, await native.listenerSet({ id, policy: policyFrom((k) => rt.settings.get(k), id) as unknown as Record<string, unknown> })); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
}

/** Restart a listener: allowed off, then on (the native side stops and starts it; the hub never sees the flip). */
export async function restartListener(rt: AxfRuntime, id: string) {
  try {
    await native.listenerSet({ id, policy: { on: false } });
    await new Promise((r) => setTimeout(r, 400));
    refreshDoc(rt, await native.listenerSet({ id, policy: policyFrom((k) => rt.settings.get(k), id) as unknown as Record<string, unknown> }));
    rt.toast(`${listenerLabel(id)} restarted.`, 'success', 'Listeners');
  } catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'warning', 'Listeners'); }
}

/* ---------------------------------------------------------------- the panel */

function ListenerRow({ l, micHolder }: { l: ListenerInfo; micHolder: string | null }) {
  const rt = useRuntime();
  const keys = policyKeys(l.id);
  const fields = policyFieldsFor(l.id);
  const def = listenerDef(l.id);
  const canRestart = l.side === 'native' && fields.includes('on');
  const setKey = (k: string, v: boolean | string) => rt.settings.set(k, v);
  return (
    <Container title={l.label} icon={l.kind === 'mic' ? 'mic' : l.kind === 'poll' ? 'eye' : 'bell'} className="axp-listeners__row" data-listener={l.id} data-state={l.state}>
      <div className="axp-listeners__state">
        <Chip tone={stateTone(l.state)}>{stateLabel(l)}</Chip>
        {micHolder === l.id && <Chip tone="accent">Has the mic</Chip>}
        {l.attempts > 0 && <Chip tone="warning">Retry {l.attempts}{l.policy.retries >= 0 ? ` of ${l.policy.retries}` : ''}</Chip>}
        <span className="fx-muted">{l.side === 'native' ? 'Phone' : 'This page'}</span>
      </div>
      {def.about && <p className="axp-listeners__about">{def.about}</p>}
      {l.lastError && <p className="axp-listeners__error">Last error: {l.lastError}{l.lastErrorAt ? ` (${new Date(l.lastErrorAt).toLocaleTimeString()})` : ''}</p>}
      <div className="axp-listeners__controls">
        {fields.includes('on') && <Switch label="Allowed" checked={l.policy.on} onChange={(v) => setKey(keys.on, v)} hint="Off: it never opens the microphone (or runs), on any device." />}
        {fields.includes('pauseOnCall') && <Switch label="Pause for calls" checked={l.policy.pauseOnCall} onChange={(v) => setKey(keys.pauseOnCall, v)} hint="Let go of the microphone while the phone rings or is in a call (phone or VoIP), come back after." />}
        {fields.includes('pauseForOtherApps') && <Switch label="Pause for other apps" checked={l.policy.pauseForOtherApps} onChange={(v) => setKey(keys.pauseForOtherApps, v)} hint="Let go while another app records or takes the audio, come back when it's done." />}
        {fields.includes('sound') && <Switch label="Start sound" checked={l.policy.sound} onChange={(v) => setKey(keys.sound, v)} hint="Only for a start you asked for. Restarts and resumes are always silent." />}
        {fields.includes('retries') && (
          <SelectField label="Restarts before it gives up" value={String(l.policy.retries)} onChange={(v) => setKey(keys.retries, v)}
            options={RETRY_CHOICES.map((c) => ({ value: String(c.value), label: c.label }))} hint="A listener refused at once (another app has the mic, the recognizer is busy) waits 1 s, 2 s, 4 s… then stops with the reason and tries once more cold a minute later." />
        )}
      </div>
      {canRestart && (
        <div className="axp-listeners__actions">
          <Button size="sm" icon="refresh" onClick={() => void restartListener(rt, l.id)} disabled={!l.policy.on}>Restart now</Button>
        </div>
      )}
    </Container>
  );
}

export function ListenersView() {
  const rt = useRuntime();
  const st = useListeners();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void readNative(rt);
    // The console may have changed a policy on the hub: re-read the synced settings while the panel is open.
    const t = setInterval(() => { hubSync()?.refresh(); void readNative(rt); setTick((x) => x + 1); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [rt]);
  const doc = st.doc;
  const rows = useMemo(() => doc?.listeners ?? [], [doc, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const publishOn = rt.settings.get(K.publish) !== false;
  return (
    <div className="axp-listeners" data-help="amberx-listeners">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Listeners</p>
          <h1>{doc?.name ?? 'This device'}</h1>
          <p className="fx-muted">{doc ? deviceSummary(doc) : 'Reading…'}. One listener owns the microphone at a time; one that keeps getting refused backs off and stops with the reason, and every switch here is kept on axHub.</p>
        </div>
        <div className="axp-listeners__head">
          {doc?.micOff && <Chip tone="danger">Mic off</Chip>}
          {doc?.micHolder && <Chip tone="accent">Mic: {listenerLabel(doc.micHolder)}</Chip>}
          <Button size="sm" icon="refresh" onClick={() => void readNative(rt)}>Refresh</Button>
        </div>
      </header>
      {st.error && <Note tone="warning">{st.error}</Note>}
      <div className="axp-listeners__grid">
        {rows.map((l) => <ListenerRow key={l.id} l={l} micHolder={doc?.micHolder ?? null} />)}
      </div>
      <Container title="Dev Console" icon="cloud">
        <Switch label="Show this device in the Dev Console" checked={publishOn} onChange={(v) => { rt.settings.set(K.publish, v); if (v) void publish(rt); }}
          hint={`The listener state above goes to axHub (${HUB.project}/_data/${HUB.folder}/${HUB.table}) every few minutes and on every change; the console's AmberX listeners page shows and controls it.`} />
        <p className="fx-muted">{st.publishError ? `Not published: ${st.publishError}` : st.publishedAt ? `Published ${new Date(st.publishedAt).toLocaleTimeString()}.` : publishOn ? 'Not published yet.' : 'Publishing is off.'}</p>
      </Container>
    </div>
  );
}

/* ---------------------------------------------------------------- library */

export const library: AxfWebLibrary = {
  id: LISTENERS_ID,
  label: 'Listeners',
  version: VERSION,
  builtWith: { model: 'fable', builtAt: '2026-11-06' },
  provides: ['amberx.listeners'],
  views: { listeners: { title: 'Listeners', icon: 'mic', keywords: ['listeners', 'microphone', 'mic', 'background', 'hands-free', 'talk mode', 'restart', 'pause', 'calls'], render: () => <ListenersView /> } },
  nav: { label: 'Listeners', items: [{ id: 'listeners', label: 'Listeners', icon: 'mic', view: 'listeners' }] },
  appMenu: [{ id: 'amberx.listeners', menu: 'axhub', items: [{ id: 'listeners.open', label: 'Listeners (microphone control)', icon: 'mic', action: 'listeners.open' }] }],
  contextMenu: [{ id: 'amberx.listeners', items: [{ id: 'listeners.open', label: 'Listeners', icon: 'mic', action: 'listeners.open' }] }],
  settingsTabs: [{ id: 'listeners', label: 'Listeners', icon: 'mic', order: 22, parent: 'plugins', description: 'Every background listener: allowed, pause for calls and other apps, start sound, restarts before it gives up.' }],
  settings: [
    { id: 'amberx.listeners.panel', label: 'Listeners', icon: 'mic', tab: 'listeners', order: 0, settings: [
      { key: 'amberx.listeners.manage', label: 'Open the Listeners panel', kind: 'link', target: 'listeners', description: 'Live state of every listener, who has the microphone, last errors, restart.' },
      { key: K.publish, label: 'Show this device in the Dev Console', kind: 'toggle', default: true, scope: 'device', description: `Publishes this device's listener state to axHub (${HUB.project}/_data/${HUB.folder}/${HUB.table}).` },
    ] },
    ...settingsGroups(),
  ],
  help: {
    entries: [
      {
        target: 'amberx-listeners', kind: 'screen', title: 'Listeners',
        text: 'Every background listener in AmberX on one page: what it is doing, who has the microphone, the last error, and its own switches. A listener that keeps getting refused backs off and stops with the reason instead of restarting forever.',
        more: 'Allowed turns a listener off everywhere. Pause for calls and Pause for other apps let it hand the microphone over and come back by itself. Start sound plays only for a start you asked for, never for a restart. Restarts before it gives up is how many quick failures in a row it tolerates (1 s, 2 s, 4 s… between them). The switches are kept on axHub, so the Dev Console shows and changes the same ones.',
        tryIt: 'Start a Claude voice call: hands-free shows Paused: a call is using the microphone, and comes back when the call ends.',
        related: ['amberx-mic-switch', 'view:settings'],
      },
      { target: 'action:listeners.open', kind: 'action', title: 'Listeners', text: 'Opens the Listeners control panel.' },
    ],
  },
  register(rt) {
    rtRef = rt;
    rt.actions.register('listeners.open', () => rt.navigate('listeners'), { label: 'Listeners' });
    rt.actions.register('listeners.restart', ([id]) => { if (id) void restartListener(rt, id); }, { label: 'Restart a listener', params: true, searchable: false });
    // Live state from the native side; the page's own listeners (the mic lease, the sound owner) are folded in.
    nativeSubs.bind('listeners', () => native.addListener('listeners', (s) => refreshDoc(rt, s)));
    micLease().on(() => refreshDoc(rt));
    void readNative(rt);
    // Policies: push every listener's policy once, then each one whose settings change (the console changes them on the
    // hub; lib-hubsync brings them here; this sends them on to the services).
    let snap: Record<string, unknown> = {};
    const policyKeysAll = LISTENERS.flatMap((l) => [...Object.values(policyKeys(l.id)), restartKey(l.id)]);
    const snapshot = () => Object.fromEntries(policyKeysAll.map((k) => [k, rt.settings.get(k)]));
    snap = snapshot();
    for (const l of LISTENERS.filter((x) => x.side === 'native')) void pushPolicy(rt, l.id);
    rt.settings.subscribe(() => {
      const next = snapshot();
      const ids = changedPolicies(snap, next);
      // The console asked for a restart (a new time under amberx.listeners.<id>.restart, synced through axHub).
      const restarts = isNative() ? restartRequests(snap, next) : [];
      snap = next;
      for (const id of ids) void pushPolicy(rt, id);
      for (const id of restarts) void restartListener(rt, id);
      if (ids.length) refreshDoc(rt);
    });
    // Heartbeat for the hub while the page is visible (the console marks a device stale after 10 minutes).
    setInterval(() => { if (globalThis.document?.visibilityState !== 'hidden') void readNative(rt); }, HEARTBEAT_MS);
    globalThis.document?.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void readNative(rt); });
  },
};

/** For tests: the runtime the library registered with (null before). */
export const listenersRuntime = () => rtRef;
