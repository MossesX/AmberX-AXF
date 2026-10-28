/**
 * Hands-free listening + the detection overlay, pure (no DOM, no runtime). Tested by `apps/amberx-droid/test.mjs`.
 *
 * Hands-free (Oct 27 2026, Brett: "It only detects words when I press speak"): AmberX keeps listening on its own, on
 * screen and in the background, independent of axHub monitoring. It acts on a wake phrase ("hey amberx open approvals"),
 * or on everything it hears when "always armed" is on. On Android the native watch service listens
 * (`WatchService.java`) and shows the detection overlay (`DetectionOverlay.java`, like ActiveX's: a moving input-level
 * line, the decibel number, what was heard, quick settings); in a browser the page listens while it's open.
 */
import { beepMode, splitWake, type BeepMode } from './speech';


/** The overlay's colours, from the app's theme tokens. A token that can't be read is left out (the overlay keeps its own). */
export type OverlayColors = Partial<Record<'bg' | 'fg' | 'accent' | 'muted' | 'danger', string>>;
const COLOR_KEYS = ['bg', 'fg', 'accent', 'muted', 'danger'] as const;

/** What the native side runs with (`voiceSet` in src/native.ts). */
export interface VoiceConfig {
  handsFree: boolean;
  alwaysArmed: boolean;
  overlay: boolean;
  wakePhrases: string[];
  lang: string;
  colors: OverlayColors;
  /** Android: silence the recognizer's tone (notification + system streams), also media, or leave it on */
  beep: BeepMode;
  /** Android: Google's online recognizer (hears far better) instead of the on-device one */
  online: boolean;
  /** show swear words as said (no f***) */
  swears: boolean;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i;

/** A theme token's computed value as a colour Android can parse (#rrggbb / #aarrggbb), or null. */
export function nativeColor(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (HEX.test(s)) {
    if (s.length === 4) return `#${[...s.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
    if (s.length === 9) return `#${s.slice(7, 9)}${s.slice(1, 7)}`.toLowerCase(); // css #rrggbbaa → android #aarrggbb
    return s.toLowerCase();
  }
  const m = RGB.exec(s);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x ?? 0))) as [number, number, number];
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const a = m[4] === undefined ? '' : hex(Math.round(Math.max(0, Math.min(1, Number(m[4]))) * 255));
  return `#${a}${hex(r)}${hex(g)}${hex(b)}`;
}

export function overlayColors(tokens: Partial<Record<keyof OverlayColors, unknown>>): OverlayColors {
  const out: OverlayColors = {};
  for (const k of COLOR_KEYS) { const c = nativeColor(tokens[k]); if (c) out[k] = c; }
  return out;
}

export interface VoiceSettings { handsFree: unknown; alwaysArmed: unknown; overlay: unknown; wake: string[]; lang: unknown; beep?: unknown; online?: unknown; swears?: unknown }

/** Defaults: hands-free on, always armed off, overlay on. Always armed with no wake phrase still listens. */
export function voiceConfig(s: VoiceSettings, colors: OverlayColors = {}): VoiceConfig {
  return {
    handsFree: s.handsFree !== false,
    alwaysArmed: s.alwaysArmed === true,
    overlay: s.overlay !== false,
    wakePhrases: s.wake.slice(0, 20),
    lang: typeof s.lang === 'string' && s.lang.trim() ? s.lang.trim() : 'en-US',
    colors,
    beep: beepMode(s.beep),
    online: s.online !== false,
    swears: s.swears !== false,
  };
}

/** Hands-free does nothing without something to listen for: a wake phrase, or always armed. */
export function listens(c: Pick<VoiceConfig, 'handsFree' | 'alwaysArmed' | 'wakePhrases'>): boolean {
  return c.handsFree && (c.alwaysArmed || c.wakePhrases.length > 0);
}

/* ---------------------------------------------------------------- input level */

/**
 * Android's recognizer reports input level as an RMS value in dB, about -2 (silence) to 10 (loud). A browser's
 * analyser gives dBFS, about -90 (silence) to 0 (full scale). Both become a 0..1 level for the graph; the number shown
 * is the dB value as reported, rounded.
 */
export type LevelSource = 'android' | 'web';
export const LEVEL_RANGE: Record<LevelSource, [number, number]> = { android: [-2, 10], web: [-70, -10] };

export function levelOf(db: number, source: LevelSource): number {
  if (!Number.isFinite(db)) return 0;
  const [lo, hi] = LEVEL_RANGE[source];
  return Math.max(0, Math.min(1, (db - lo) / (hi - lo)));
}

/** dBFS of a block of samples (-1..1); -Infinity for silence. */
export function dbfs(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const v = samples[i] ?? 0; sum += v * v; }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export const dbText = (db: number): string => (Number.isFinite(db) ? `${Math.round(db)} dB` : '– dB');

export const HISTORY = 60;
/** Keeps the last `max` levels for the moving line. */
export function pushLevel(history: readonly number[], level: number, max = HISTORY): number[] {
  const next = [...history, Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0))];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** SVG polyline points for a history in a w×h box (newest on the right, louder = higher). */
export function graphPoints(history: readonly number[], w: number, h: number, max = HISTORY): string {
  if (history.length === 0) return '';
  const step = w / Math.max(1, max - 1);
  const x0 = w - step * (history.length - 1);
  return history.map((v, i) => `${round(x0 + i * step)},${round(h - v * h)}`).join(' ');
}
const round = (n: number) => Math.round(n * 10) / 10;

/* ---------------------------------------------------------------- what was heard */

/**
 * What an utterance heard hands-free should do: `command` = run the text after the wake phrase; `wake` = only the wake
 * phrase was said, so answer and listen for the command; `ignore` = no wake phrase and not always armed.
 */
export type Heard = { kind: 'command'; text: string } | { kind: 'wake' } | { kind: 'ignore' };

export function interpretHeard(text: string, wake: readonly string[], alwaysArmed: boolean, normalize: (s: string) => string): Heard {
  const h = normalize(text);
  if (!h) return { kind: 'ignore' };
  for (const w of [...wake].map(normalize).filter(Boolean).sort((a, b) => b.length - a.length)) {
    const i = ` ${h} `.indexOf(` ${w} `);
    if (i < 0) continue;
    const rest = h.slice(i + w.length).trim();
    return rest ? { kind: 'command', text: rest } : { kind: 'wake' };
  }
  const loose = splitWake(text, wake); // "hey amber x …", "hey ambrex …"
  if (loose) return loose.rest ? { kind: 'command', text: normalize(loose.rest) } : { kind: 'wake' };
  return alwaysArmed ? { kind: 'command', text: h } : { kind: 'ignore' };
}
