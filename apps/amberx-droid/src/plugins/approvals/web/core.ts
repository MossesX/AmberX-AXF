/**
 * Veto approvals in AmberX, the pure part (tested by `apps/amberx-droid/test.mjs`): the sound and vibration choices,
 * the alert config sent to the Android shell (`native.vetoSettings`, Java `VetoAlerts`), and what each notification says.
 * The hub contract itself (feed, push, stream, countdown, notify plan) is lib-hub's `veto.ts`.
 */
import type { VetoCall, VetoPhase } from '../../../axf/libs/hub/veto';
import { formatCountdown } from '../../../axf/libs/hub/veto';

/** Sounds the shell can play on a notification channel (Android RingtoneManager defaults) and the browser imitates. */
export const SOUNDS = [
  { value: 'default', label: 'Notification (phone default)' },
  { value: 'alarm', label: 'Alarm' },
  { value: 'ringtone', label: 'Ringtone' },
  { value: 'none', label: 'Silent' },
] as const;
export type Sound = (typeof SOUNDS)[number]['value'];

/** Vibration patterns (Android: off/on milliseconds; the browser's navigator.vibrate takes the same list). */
export const VIBRATIONS = [
  { value: 'default', label: 'Phone default', pattern: [] as number[] },
  { value: 'short', label: 'Short buzz', pattern: [0, 200] },
  { value: 'long', label: 'Long buzz', pattern: [0, 800] },
  { value: 'pulse', label: 'Three pulses', pattern: [0, 150, 100, 150, 100, 150] },
  { value: 'heartbeat', label: 'Heartbeat', pattern: [0, 100, 80, 300] },
  { value: 'none', label: 'No vibration', pattern: [] as number[] },
] as const;
export type Vibration = (typeof VIBRATIONS)[number]['value'];

export const K = {
  sound: 'amberx.approvals.sound',
  vibration: 'amberx.approvals.vibration',
  warningSound: 'amberx.approvals.warningSound',
  runningSound: 'amberx.approvals.runningSound',
  openTerminal: 'amberx.approvals.openTerminal',
} as const;

export const DEFAULTS = { sound: 'alarm', vibration: 'pulse', warningSound: 'alarm', runningSound: 'default' } as const;

const pick = <T extends string>(list: readonly { value: T }[], v: unknown, d: T): T => (list.some((x) => x.value === v) ? (v as T) : d);
export const soundOf = (v: unknown, d: Sound = 'default'): Sound => pick(SOUNDS, v, d);
export const vibrationOf = (v: unknown, d: Vibration = 'pulse'): Vibration => pick(VIBRATIONS, v, d);
export const patternOf = (v: Vibration): number[] => [...(VIBRATIONS.find((x) => x.value === v)?.pattern ?? [])];

/** What the shell's notification channels are made with (one channel per phase; Android channels can't change, so a
 * new choice makes a new channel and the old one is deleted). */
export interface VetoAlertConfig {
  held: { sound: Sound; vibration: number[]; vibrate: boolean };
  warning: { sound: Sound; vibration: number[]; vibrate: boolean };
  running: { sound: Sound; vibration: number[]; vibrate: boolean };
}

export function alertConfig(get: (k: string) => unknown): VetoAlertConfig {
  const vib = vibrationOf(get(K.vibration), DEFAULTS.vibration);
  const v = { vibration: patternOf(vib), vibrate: vib !== 'none' };
  return {
    held: { sound: soundOf(get(K.sound), DEFAULTS.sound), ...v },
    warning: { sound: soundOf(get(K.warningSound), DEFAULTS.warningSound), ...v },
    running: { sound: soundOf(get(K.runningSound), DEFAULTS.runningSound), ...v },
  };
}

/** Title and text of each notification. The command is shown in full in the expanded notification. */
export function notificationText(c: Pick<VetoCall, 'title' | 'command' | 'tool'>, phase: VetoPhase, secondsLeft: number): { title: string; text: string } {
  const what = c.command || c.tool;
  if (phase === 'held') return { title: `Runs in ${formatCountdown(secondsLeft)}: ${c.title}`, text: `${what}\nDeny to stop it.` };
  if (phase === 'warning') return { title: `${Math.max(0, Math.round(secondsLeft))} s left: ${c.title}`, text: `${what}\nDeny now to stop it.` };
  return { title: `Running now: ${c.title}`, text: what };
}

/** Browser stand-in for the phone's sounds: a short tone sequence per sound (frequency Hz, ms). */
export function tonesOf(sound: Sound): [number, number][] {
  switch (sound) {
    case 'alarm': return [[880, 180], [0, 80], [880, 180], [0, 80], [880, 180]];
    case 'ringtone': return [[660, 250], [830, 250], [660, 250]];
    case 'none': return [];
    default: return [[740, 200]];
  }
}
