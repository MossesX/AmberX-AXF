/**
 * Mic off (Nov 1 2026, Brett: "AmberX needs a button, a quick switch. It disables all the listening, turns the green
 * dot off my phone, turns off the microphone, completely disables all listening."). A spoken "mic off" isn't enough
 * (it needs the mic), so this is a button, everywhere he looks:
 *
 * - **Home** (Approvals): the big switch at the top (`MicSwitch`).
 * - **Banner**: the `status/amberx-mic` widget ("Listening" / "Mic off"; tap = flip), attached at run time so it shows
 *   on every banner asset. **Toolbar**: the toolbar asset's `mic-off` item. **Application menu**: AmberX → Mic off,
 *   with a check mark. **Settings → Sound and microphone**: the same switch.
 * - **Android**: the quick-settings tile "AmberX mic" and the watch service notification's Mic off / Mic on button
 *   (Java `MicTile`, `WatchService`), which work with the app closed.
 *
 * What it does: the native gate (`MicGuard.java`) stops every native mic user at once (hands-free, wake listener, the
 * one utterance after a trigger, Speak, the recorder's mic track, the detection overlay) and drops the watch service's
 * microphone type, so Android's green dot goes off; the page's gate (`micguard.ts`) stops every audio stream and
 * recognizer the page opened and refuses new ones. Nothing opens the mic until it is switched back. Kept across restarts
 * on this device (native prefs on Android, localStorage in a browser), never synced.
 *
 * The state also says when hands-free has let go of the mic by itself because a call or another app (the Claude app's
 * voice mode) is using it (`yielded`); it comes back by itself once the mic stays free.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from './axf/core';
import { Button, Chip, Container, type AxfWebLibrary } from './axf/react';
import { isNative, native, type MicState } from './native';
import { micChip, micDetail, micGuard } from './micguard';
import './mic.css';

export const MIC_ORIGIN = 'ai.amberx.amberx.mic';
/** 1 while AmberX may listen, 0 while Mic off is on (the banner's status widget reads it). */
export const MIC_ON = 'amberx.mic.on';
/** 1 while Mic off is on (the application menu's check mark). */
export const MIC_OFF = 'amberx.mic.off';
export const MIC_ACTIONS = { toggle: 'amberx.mic.toggle', off: 'amberx.mic.off', on: 'amberx.mic.on' } as const;

const initial = (off: boolean): MicState => ({ off, yielded: off ? 'mic-off' : null, label: off ? 'Mic off' : 'Listening', listening: false });

let rtRef: AxfRuntime | null = null;
let state: MicState = initial(micGuard().off());
const subs = new Set<() => void>();

function set(next: MicState) {
  state = { ...next, yielded: next.yielded ?? null };
  // The page's gate follows the native switch (the tile or the notification may have flipped it).
  if (micGuard().off() !== state.off) micGuard().set(state.off);
  rtRef?.setBadge(MIC_ON, state.off ? 0 : 1);
  rtRef?.setBadge(MIC_OFF, state.off ? 1 : 0);
  subs.forEach((f) => { try { f(); } catch { /* a listener's problem */ } });
}

export const micState = (): MicState => state;
export const onMic = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useMic = (): MicState => useSyncExternalStore(onMic, () => state);

/** Mic off on (`true`) or off: the page lets go first, then the native side; the state shows it at once. */
export async function setMicOff(off: boolean): Promise<MicState> {
  micGuard().set(off);
  set({ ...state, ...initial(off), listening: off ? false : state.listening });
  try { set(await native.micSet({ off })); } catch (e) {
    rtRef?.toast(e instanceof Error ? e.message : String(e), 'warning', 'Mic');
  }
  return state;
}
export const toggleMic = (): Promise<MicState> => setMicOff(!state.off);

/** The big switch (Home, Settings → Sound and microphone). Framework Container, Chip and Button only. */
export function MicSwitch() {
  const s = useMic();
  const chip = micChip(s);
  return (
    <Container title="Microphone" icon="mic" className="amberx-mic">
      <div className="amberx-mic__body" data-help="amberx-mic-switch" data-amberx-mic={s.off ? 'off' : 'on'}>
        <div className="fx-row fx-row--wrap">
          <Chip tone={chip.tone}>{chip.text}</Chip>
          {s.recorderMic && !s.off && <Chip tone="warning">Recorder is recording your mic</Chip>}
        </div>
        <p className="fx-muted">{micDetail(s, isNative())}</p>
        <Button tone={s.off ? 'primary' : 'danger'} icon="mic" className="amberx-mic__button" aria-pressed={s.off} onClick={() => void toggleMic()}>
          {s.off ? 'Turn the mic back on' : 'Mic off'}
        </Button>
      </div>
    </Container>
  );
}

/* ---------------------------------------------------------------- library */

export const micLibrary: AxfWebLibrary = {
  id: MIC_ORIGIN,
  label: 'Mic off',
  version: '0.1.0',
  settingsPanels: [{ id: 'amberx.mic.panel', tab: 'sound', title: 'Mic off', icon: 'mic', order: -10, render: () => <MicSwitch /> }],
  appMenu: [{ id: 'amberx.mic', menu: 'axhub', items: [{ id: 'mic.off', label: 'Mic off (stop all listening)', icon: 'mic', action: MIC_ACTIONS.toggle, checked: `counter:${MIC_OFF}` }] }],
  help: {
    entries: [
      {
        target: `action:${MIC_ACTIONS.toggle}`, kind: 'toggle', title: 'Mic off',
        text: 'One tap and AmberX lets go of every microphone it holds: hands-free, the wake word, Speak, voice notes, the recorder\'s mic. The green dot goes off. Tap again to let it listen.',
        more: 'It stays off through restarts until you turn it back on. On the phone it is also a quick-settings tile ("AmberX mic") and a button on AmberX\'s notification, so it works with the app closed. Saying "mic off" can\'t work (that needs the mic), so it\'s a button. Separately, AmberX lets go by itself while a call or another app (a Claude voice call) uses the mic, and comes back when it\'s done.',
        tryIt: 'Tap Mic off, then pull down your quick settings: the green dot is gone.',
        related: ['amberx-mic-switch', 'view:settings'],
      },
      {
        target: 'amberx-mic-switch', kind: 'toggle', title: 'Microphone',
        text: 'Shows who has the mic right now (Listening, Mic on, Paused for another app, Mic off) and the big switch that turns every AmberX microphone off or back on.',
        tryIt: 'Start a Claude voice call: this says Paused for another app until the call ends.',
        related: [`action:${MIC_ACTIONS.toggle}`],
      },
    ],
  },
  register(rt) {
    rtRef = rt;
    rt.actions.register(MIC_ACTIONS.toggle, () => void toggleMic(), { label: 'Mic off (stop all listening)' });
    rt.actions.register(MIC_ACTIONS.off, () => void setMicOff(true), { label: 'Mic off' });
    rt.actions.register(MIC_ACTIONS.on, () => void setMicOff(false), { label: 'Turn the mic back on' });
    set(state);
    // The banner chip on whatever banner asset is active (same pattern as the approvals counter).
    if (rt.registry.has('status', 'amberx-mic')) rt.attachToBanner({ type: 'status', id: 'amberx-mic', at: 'right', order: 28, origin: MIC_ORIGIN });
    // The native switch is the truth on the phone (the tile and the notification flip it with the page closed).
    const read = () => void native.micState().then(set).catch(() => undefined);
    void native.addListener('mic', (e) => set(e)).catch(() => undefined);
    void native.addListener('monitor', (m) => {
      const x = m as unknown as { listening?: boolean; yielded?: string | null };
      if (typeof x.listening === 'boolean' && (x.listening !== state.listening || (x.yielded ?? null) !== state.yielded)) {
        set({ ...state, listening: !state.off && x.listening, yielded: state.off ? 'mic-off' : x.yielded ?? null });
      }
    }).catch(() => undefined);
    globalThis.document?.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') read(); });
    read();
  },
};
