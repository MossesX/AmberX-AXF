/**
 * Sound and microphone (Nov 1 2026, Brett: "Note saved" on a loop in the app, "ding ding ding" in Chrome). One place
 * decides whether this page may speak, ring or listen, and shows it in Settings → Sound and microphone:
 *
 * - **Quiet** (`amberx.sound.quiet`, synced like every setting): no speech, no alarm, no tones, at once, on every device.
 *   The Android side keeps it too (`Quiet.java`), so the watch service obeys it with the app closed.
 * - **One owner per device** (`listeners.ts`): of this device's AmberX tabs, one speaks, rings and listens; the others
 *   stay silent and only show state. The Android app's web view is alone, so it always owns.
 * - **This browser** (kept on this device only, never synced): *Sounds in this browser* (off by default in a phone's
 *   browser, where the AmberX app makes the sounds) and *Listen hands-free in this browser* (off by default: the synced
 *   hands-free setting is the phone app's).
 * - **Who holds the microphone**: hands-free (the app's service or this tab's recognizer), or the page's mic lease
 *   holder (dictation, Speak, the Assistant microphone), or nobody (also while Mic off is on: `mic.tsx`, its own
 *   switch at the top of this tab).
 *
 * The decision is on `globalThis.__axfSoundOwner` (sound-owner@1) for console plugins loaded into AmberX (the veto
 * banner's alarm asks it before ringing); AmberX's own code calls `mayMakeSound()`.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from './axf/core';
import { Chip, Note, Switch, type AxfWebLibrary } from './axf/react';
import { isNative, native } from './native';
import { HOLDER_LABEL, micLease } from './miclease';
import { useMic } from './mic';
import {
  SOUND_OWNER_KEY, createOwner, deviceSoundsDefault, deviceStore, soundAllowed,
  HEARTBEAT_MS, type OwnerChannel, type OwnerLocks, type SoundOwner, type SoundOwnerApi, type SoundState,
} from './listeners';

export const K = { quiet: 'amberx.sound.quiet' } as const;
/** Device-only keys (localStorage), never synced to axHub. */
export const DEVICE = { sounds: 'amberx.device.sounds', handsFree: 'amberx.device.handsFree' } as const;

const store = deviceStore();
const readBool = (key: string, d: boolean): boolean => { const v = store.getItem(key); return v === 'true' ? true : v === 'false' ? false : d; };

let rtRef: AxfRuntime | null = null;
let owner: SoundOwner | null = null;
let state: SoundState = {
  quiet: false,
  owner: true,
  deviceSounds: readBool(DEVICE.sounds, deviceSoundsDefault({ native: isNative(), userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent })),
};
const subs = new Set<(s: SoundState) => void>();
const set = (p: Partial<SoundState>) => {
  const next = { ...state, ...p };
  if (next.quiet === state.quiet && next.owner === state.owner && next.deviceSounds === state.deviceSounds) return;
  state = next;
  subs.forEach((f) => { try { f(state); } catch { /* a listener's problem */ } });
};
export const soundState = (): SoundState => state;
export const onSound = (f: (s: SoundState) => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
const useSound = () => useSyncExternalStore((f) => onSound(f), () => state);

/** May this page speak or make a sound right now? */
export const mayMakeSound = (): boolean => soundAllowed(state);
/** Is this page the device's owner (the one that listens)? */
export const isSoundOwner = (): boolean => state.owner;

/** Browser hands-free on this device (the Android app ignores it: its service listens for the synced setting). */
export const deviceHandsFree = (): boolean => isNative() || readBool(DEVICE.handsFree, false);
export function setDeviceHandsFree(on: boolean): void { store.setItem(DEVICE.handsFree, String(on)); bump(); }
export function setDeviceSounds(on: boolean): void { store.setItem(DEVICE.sounds, String(on)); set({ deviceSounds: on }); bump(); }
let rev = 0;
const revSubs = new Set<() => void>();
const bump = () => { rev += 1; revSubs.forEach((f) => f()); };
/** Re-renders when a device-only switch changes; the voice plugin re-syncs hands-free on it. */
export const onDeviceChange = (f: () => void): (() => void) => { revSubs.add(f); return () => { revSubs.delete(f); }; };
const useDeviceRev = () => useSyncExternalStore((f) => onDeviceChange(f), () => rev);

/** Stops everything that sounds, now. */
function hush() {
  void native.quiet({ quiet: true }).catch(() => undefined);
  void native.stopSpeaking().catch(() => undefined);
  void native.vetoAlarmStop().catch(() => undefined);
  try { globalThis.speechSynthesis?.cancel(); } catch { /* none */ }
}

function browserChannel(): OwnerChannel | null {
  const BC = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
  if (!BC) return null;
  const ch = new BC('amberx.sound-owner');
  return {
    post: (m) => ch.postMessage(m),
    onMessage: (fn) => { const h = (e: MessageEvent) => fn(e.data); ch.addEventListener('message', h); return () => ch.removeEventListener('message', h); },
    close: () => ch.close(),
  };
}

function electThisPage() {
  if (owner) return;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { locks?: OwnerLocks });
  // The Android web view is the only AmberX page in the app: it owns. Tabs elect one (Web Locks, else a heartbeat).
  owner = isNative() ? createOwner({ id }) : createOwner({ id, locks: nav?.locks ?? null, channel: nav?.locks ? null : browserChannel() });
  set({ owner: owner.isOwner() });
  owner.on((o) => set({ owner: o }));
  if (!isNative() && !nav?.locks) {
    const t = setInterval(() => owner?.tick(Date.now()), HEARTBEAT_MS);
    owner.tick(Date.now());
    globalThis.addEventListener?.('pagehide', () => { clearInterval(t); owner?.close(); });
  }
}

/** The page's sound-owner@1 object, for console plugins that can't import this file. */
function publish() {
  const api: SoundOwnerApi = { $axf: 'sound-owner@1', allowed: mayMakeSound, state: soundState, on: onSound };
  (globalThis as Record<string, unknown>)[SOUND_OWNER_KEY] = api;
}

/* ---------------------------------------------------------------- settings panel */

function useMicHolder(): string {
  const [holder, setHolder] = useState<string | null>(() => micLease().holder());
  useEffect(() => micLease().on(setHolder), []);
  const [listening, setListening] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => void native.voiceStatus().then((s) => alive && setListening(s.listening)).catch(() => undefined);
    read();
    const t = setInterval(read, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (useMic().off) return 'Nobody: Mic off is on (nothing opens it until you turn it back on)';
  if (holder) return `${HOLDER_LABEL[holder] ?? holder} (in this page)`;
  if (listening) return isNative() ? 'Hands-free (AmberX\'s listening service)' : 'Hands-free (this tab)';
  return 'Nobody: the microphone is free';
}

function SoundPanel({ rt }: { rt: AxfRuntime }) {
  const s = useSound();
  useDeviceRev();
  const mic = useMicHolder();
  const quiet = rt.settings.get(K.quiet) === true;
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <Chip tone={quiet ? 'warning' : 'success'}>{quiet ? 'Quiet: no sound' : 'Sound on'}</Chip>
        <Chip tone={s.owner ? 'accent' : undefined}>{s.owner ? 'This page speaks and rings' : 'Another AmberX page speaks'}</Chip>
      </div>
      <p className="fx-muted" data-amberx-mic-holder>Microphone: {mic}</p>
      {!isNative() && (
        <>
          <Switch label="Sounds in this browser" checked={s.deviceSounds} onChange={setDeviceSounds}
            hint="This device only. Off in a phone's browser by default: the AmberX app speaks and rings there." />
          <Switch label="Listen hands-free in this browser" checked={deviceHandsFree()} onChange={setDeviceHandsFree}
            hint="This device only. Off by default: the synced Hands-free setting is for the phone app." />
          {!s.owner && <Note tone="info">Another AmberX tab on this device is the one that listens, speaks and rings. Close it and this one takes over.</Note>}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- library */

export const soundLibrary: AxfWebLibrary = {
  id: 'ai.amberx.amberx.sound',
  label: 'Sound and microphone',
  version: '0.1.0',
  settingsTabs: [{ id: 'sound', label: 'Sound and microphone', icon: 'bell', order: 25 }],
  settings: [
    {
      id: 'amberx.sound', label: 'Sound', icon: 'bell', tab: 'sound', order: 10, settings: [
        { key: K.quiet, label: 'Quiet', kind: 'toggle', default: false, description: 'No speech, tones or alarms on any device until it is switched off. Notices still show, silently.' },
      ],
    },
  ],
  settingsPanels: [
    { id: 'amberx.sound.panel', tab: 'sound', title: 'Who speaks, rings and listens', icon: 'mic', order: 0, render: () => (rtRef ? <SoundPanel rt={rtRef} /> : null) },
  ],
  appMenu: [{ id: 'amberx.sound', menu: 'axhub', items: [{ id: 'sound.quiet', label: 'Quiet (stop all sound)', icon: 'bell', action: 'amberx.quiet.toggle' }] }],
  register(rt) {
    rtRef = rt;
    electThisPage();
    publish();
    rt.actions.register('amberx.quiet.toggle', () => rt.settings.set(K.quiet, rt.settings.get(K.quiet) !== true), { label: 'Quiet (stop all sound)' });
    let last: boolean | null = null;
    const sync = () => {
      const q = rt.settings.get(K.quiet) === true;
      set({ quiet: q });
      if (q === last) return;
      last = q;
      if (q) hush(); else void native.quiet({ quiet: false }).catch(() => undefined);
    };
    rt.subscribe(sync);
    sync();
  },
};
