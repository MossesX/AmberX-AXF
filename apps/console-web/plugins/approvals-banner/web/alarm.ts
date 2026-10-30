/**
 * The veto alarm (Brett, Oct 30 2026): a configurable alarm for held calls, owned by the veto banner plugin so it works
 * in every app the plugin is installed in (the console, AmberX). Pure part: the settings, what they mean at a given
 * moment (is it due, how loud, is it ringing or between repeats), and the config the phone shell plays
 * (`VetoHost.alarm`, AmberX's Java `VetoAlarm`, which rings on the alarm stream so it sounds through silent mode).
 * The browser player is at the bottom (WebAudio tones or the chosen file, `navigator.vibrate`).
 *
 * Settings are runtime settings (`approvals-banner.alarm.*`), so they show in Settings → Plugins → Approvals banner and
 * follow the level toolbar like every other setting.
 */

export const ALARM_KEYS = {
  enabled: 'approvals-banner.alarm.enabled',
  tone: 'approvals-banner.alarm.tone',
  customSound: 'approvals-banner.alarm.customSound',
  customName: 'approvals-banner.alarm.customName',
  volume: 'approvals-banner.alarm.volume',
  louder: 'approvals-banner.alarm.louder',
  louderSeconds: 'approvals-banner.alarm.louderSeconds',
  ringSeconds: 'approvals-banner.alarm.ringSeconds',
  repeat: 'approvals-banner.alarm.repeat',
  repeatGapSeconds: 'approvals-banner.alarm.repeatGapSeconds',
  vibration: 'approvals-banner.alarm.vibration',
  startAt: 'approvals-banner.alarm.startAt',
  throughSilent: 'approvals-banner.alarm.throughSilent',
  notices: 'approvals-banner.notices',
} as const;

/** Built-in tones. `alarm` / `ringtone` / `notification` are the phone's own sounds (the browser imitates them). */
export const TONES = [
  { value: 'alarm', label: 'Phone alarm' },
  { value: 'ringtone', label: 'Phone ringtone' },
  { value: 'notification', label: 'Phone notification' },
  { value: 'beacon', label: 'Beacon (rising beeps)' },
  { value: 'siren', label: 'Siren' },
  { value: 'chime', label: 'Chime' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'custom', label: 'My own sound file' },
] as const;
export type Tone = (typeof TONES)[number]['value'];

/** Vibration patterns, off/on milliseconds (Android's VibrationEffect and the browser's navigator.vibrate take the same list). */
export const VIBRATIONS = [
  { value: 'none', label: 'No vibration', pattern: [] as number[] },
  { value: 'short', label: 'Short buzz', pattern: [0, 200] },
  { value: 'long', label: 'Long buzz', pattern: [0, 800] },
  { value: 'pulse', label: 'Three pulses', pattern: [0, 150, 100, 150, 100, 150] },
  { value: 'heartbeat', label: 'Heartbeat', pattern: [0, 100, 80, 300] },
  { value: 'sos', label: 'SOS', pattern: [0, 100, 100, 100, 100, 100, 300, 300, 100, 300, 100, 300, 300, 100, 100, 100, 100, 100] },
  { value: 'continuous', label: 'Continuous', pattern: [0, 1000, 200] },
] as const;
export type Vibration = (typeof VIBRATIONS)[number]['value'];

/** When in the countdown the alarm starts. */
export const START_AT = [
  { value: 'start', label: 'When the countdown starts', seconds: Infinity },
  { value: '60', label: 'With 60 s left', seconds: 60 },
  { value: '30', label: 'With 30 s left (the warning)', seconds: 30 },
  { value: '10', label: 'With 10 s left', seconds: 10 },
  { value: 'run', label: 'When it runs', seconds: 0 },
] as const;
export type StartAt = (typeof START_AT)[number]['value'];

export interface AlarmConfig {
  enabled: boolean;
  tone: Tone;
  /** A data: URL of his own sound (only when tone = custom), and its file name. */
  customSound: string;
  customName: string;
  /** 0–100. */
  volume: number;
  /** Gets louder over `louderSeconds`, from a fifth of the volume up to the volume. */
  louder: boolean;
  louderSeconds: number;
  /** How long one ring lasts (s). */
  ringSeconds: number;
  /** How many rings (1 = no repeat), with `repeatGapSeconds` of quiet between them. */
  repeat: number;
  repeatGapSeconds: number;
  vibration: Vibration;
  vibrationPattern: number[];
  startAt: StartAt;
  /** Ring through silent mode (phone: the alarm audio stream). */
  throughSilent: boolean;
}

export const ALARM_DEFAULTS: AlarmConfig = {
  enabled: true, tone: 'alarm', customSound: '', customName: '', volume: 80, louder: true, louderSeconds: 20,
  ringSeconds: 30, repeat: 2, repeatGapSeconds: 15, vibration: 'pulse', vibrationPattern: [0, 150, 100, 150, 100, 150],
  startAt: '30', throughSilent: true,
};

/** A custom sound file is kept in settings as a data URL: capped so settings stay small. */
export const CUSTOM_SOUND_MAX = 1_500_000;

const pick = <T extends string>(list: readonly { value: T }[], v: unknown, d: T): T => (list.some((x) => x.value === v) ? (v as T) : d);
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
};
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
export const patternOf = (v: Vibration): number[] => [...(VIBRATIONS.find((x) => x.value === v)?.pattern ?? [])];
const soundOk = (v: unknown): v is string => typeof v === 'string' && v.length <= CUSTOM_SOUND_MAX && /^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(v);

/** The alarm settings, read through `get` (runtime settings), every value in range. */
export function alarmConfig(get: (k: string) => unknown): AlarmConfig {
  const d = ALARM_DEFAULTS;
  const vibration = pick(VIBRATIONS, get(ALARM_KEYS.vibration), d.vibration);
  const customSound = soundOk(get(ALARM_KEYS.customSound)) ? (get(ALARM_KEYS.customSound) as string) : '';
  let tone = pick(TONES, get(ALARM_KEYS.tone), d.tone);
  if (tone === 'custom' && !customSound) tone = d.tone;
  return {
    enabled: bool(get(ALARM_KEYS.enabled), d.enabled),
    tone,
    customSound,
    customName: typeof get(ALARM_KEYS.customName) === 'string' ? String(get(ALARM_KEYS.customName)).slice(0, 120) : '',
    volume: num(get(ALARM_KEYS.volume), d.volume, 0, 100),
    louder: bool(get(ALARM_KEYS.louder), d.louder),
    louderSeconds: num(get(ALARM_KEYS.louderSeconds), d.louderSeconds, 1, 120),
    ringSeconds: num(get(ALARM_KEYS.ringSeconds), d.ringSeconds, 1, 300),
    repeat: num(get(ALARM_KEYS.repeat), d.repeat, 1, 10),
    repeatGapSeconds: num(get(ALARM_KEYS.repeatGapSeconds), d.repeatGapSeconds, 0, 300),
    vibration,
    vibrationPattern: patternOf(vibration),
    startAt: pick(START_AT, get(ALARM_KEYS.startAt), d.startAt),
    throughSilent: bool(get(ALARM_KEYS.throughSilent), d.throughSilent),
  };
}

/** Seconds left at which the alarm starts (Infinity = as soon as the countdown starts). */
export const startSeconds = (cfg: Pick<AlarmConfig, 'startAt'>): number => START_AT.find((x) => x.value === cfg.startAt)?.seconds ?? 30;

/** Should a held call's alarm be ringing (started) at this point of its countdown? Never for shelved / approved / done. */
export function alarmDue(cfg: Pick<AlarmConfig, 'enabled' | 'startAt'>, call: { secondsLeft: number; shelved?: boolean; approvedNow?: boolean }): boolean {
  if (!cfg.enabled || call.shelved || call.approvedNow) return false;
  const at = startSeconds(cfg);
  return at === 0 ? call.secondsLeft <= 0 : call.secondsLeft <= at;
}

/** Total length of the alarm (all rings and the gaps between them), seconds. */
export const alarmLength = (cfg: Pick<AlarmConfig, 'ringSeconds' | 'repeat' | 'repeatGapSeconds'>): number =>
  cfg.ringSeconds * cfg.repeat + cfg.repeatGapSeconds * (cfg.repeat - 1);

/** Is it sounding `elapsed` seconds after it started (inside a ring, not a gap, not over)? */
export function ringingAt(cfg: Pick<AlarmConfig, 'ringSeconds' | 'repeat' | 'repeatGapSeconds'>, elapsed: number): boolean {
  if (elapsed < 0 || elapsed >= alarmLength(cfg)) return false;
  const cycle = cfg.ringSeconds + cfg.repeatGapSeconds;
  return elapsed % cycle < cfg.ringSeconds;
}

/** Volume (0–1) `elapsed` seconds into the current ring: a fifth of it rising to the full volume when `louder` is on. */
export function volumeAt(cfg: Pick<AlarmConfig, 'volume' | 'louder' | 'louderSeconds' | 'ringSeconds' | 'repeatGapSeconds'>, elapsed: number): number {
  const full = cfg.volume / 100;
  if (!cfg.louder) return full;
  const cycle = cfg.ringSeconds + cfg.repeatGapSeconds;
  const inRing = Math.max(0, elapsed % cycle);
  const t = Math.min(1, inRing / Math.max(1, cfg.louderSeconds));
  return full * (0.2 + 0.8 * t);
}

/** What the phone shell gets (`VetoHost.alarm`): the same settings, with the start point in seconds left (-1 = at the start). */
export function nativeAlarmConfig(cfg: AlarmConfig): Record<string, unknown> {
  const at = startSeconds(cfg);
  return {
    enabled: cfg.enabled, tone: cfg.tone, customSound: cfg.tone === 'custom' ? cfg.customSound : '', volume: cfg.volume,
    louder: cfg.louder, louderSeconds: cfg.louderSeconds, ringSeconds: cfg.ringSeconds, repeat: cfg.repeat,
    repeatGapSeconds: cfg.repeatGapSeconds, vibration: cfg.vibrationPattern, startSeconds: at === Infinity ? -1 : at,
    throughSilent: cfg.throughSilent,
  };
}

/** Browser stand-in tones per built-in sound: [frequency Hz (0 = rest), ms]. */
export function tonesOf(tone: Tone): [number, number][] {
  switch (tone) {
    case 'alarm': return [[880, 180], [0, 80], [880, 180], [0, 80], [880, 180], [0, 400]];
    case 'ringtone': return [[660, 250], [830, 250], [660, 250], [0, 450]];
    case 'notification': return [[740, 200], [0, 800]];
    case 'beacon': return [[520, 120], [0, 60], [700, 120], [0, 60], [880, 160], [0, 500]];
    case 'siren': return [[600, 220], [900, 220], [600, 220], [900, 220]];
    case 'chime': return [[1046, 300], [784, 300], [0, 400]];
    case 'pulse': return [[440, 100], [0, 100]];
    default: return [[740, 200], [0, 800]];
  }
}

/* ---------------------------------------------------------------- the browser player */

/** Plays the alarm in a page (tones or the custom file), louder over time, rings + gaps, with vibration. One at a time. */
export class BrowserAlarm {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private file: HTMLAudioElement | null = null;
  private startedAt = 0;
  private cfg: AlarmConfig = ALARM_DEFAULTS;

  get ringing(): boolean { return this.timer !== null; }

  start(cfg: AlarmConfig): void {
    this.stop();
    this.cfg = cfg;
    this.startedAt = Date.now();
    let nextAt = 0; // seconds into the alarm when the next tone loop starts
    const loop = () => {
      const elapsed = (Date.now() - this.startedAt) / 1000;
      if (elapsed >= alarmLength(cfg)) { this.stop(); return; }
      const on = ringingAt(cfg, elapsed);
      const vol = volumeAt(cfg, elapsed);
      if (cfg.tone === 'custom' && cfg.customSound) {
        if (on) {
          if (!this.file) { this.file = new Audio(cfg.customSound); this.file.loop = true; void this.file.play().catch(() => undefined); this.vibrate(); }
          this.file.volume = Math.max(0, Math.min(1, vol));
        } else if (this.file) { this.file.pause(); this.file = null; }
        return;
      }
      if (on && elapsed >= nextAt) nextAt = elapsed + this.playOnce(vol);
      if (!on) nextAt = 0;
    };
    loop();
    this.timer = setInterval(loop, 200);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.file) { this.file.pause(); this.file = null; }
    try { navigator.vibrate?.(0); } catch { /* none */ }
  }

  private vibrate(): void {
    if (this.cfg.vibrationPattern.length) try { navigator.vibrate?.(this.cfg.vibrationPattern); } catch { /* none */ }
  }

  /** One pass of the tone sequence; returns its length (s). */
  private playOnce(vol: number): number {
    const seq = tonesOf(this.cfg.tone);
    this.vibrate();
    let length = 0;
    try {
      this.ctx ??= new AudioContext();
      let at = this.ctx.currentTime;
      for (const [hz, ms] of seq) {
        if (hz > 0 && vol > 0) {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.frequency.value = hz;
          g.gain.setValueAtTime(0.25 * vol, at);
          g.gain.exponentialRampToValueAtTime(0.001, at + ms / 1000);
          o.connect(g).connect(this.ctx.destination);
          o.start(at);
          o.stop(at + ms / 1000);
        }
        at += ms / 1000;
        length += ms / 1000;
      }
    } catch { /* no audio */ }
    return Math.max(0.3, length);
  }
}
