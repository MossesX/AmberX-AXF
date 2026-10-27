/*
 * Speech — speech@1 (kernel contract, web reference; the SPEAKING side — listening stays on lib-voice / triggers@1).
 * Same design as the Kotlin kernel's `ai.amberx.axf.kernel.speech` (Speech.kt); fixture spec/fixtures/speech.json
 * (spec/check-speech.mts, Kotlin SpeechConformanceTest).
 *
 * Contract shape only (an implementation step follows): a `SpeechProvider` a platform module registers under
 * `axf.speech` (the kernel keeps a typed placeholder until one does), and the pure `SpeechQueue` rules every host
 * runs the same way — enqueue, pause, skip, rate steps 0.5–2.0, repeat. AmberX speaks in any app through this.
 */

export const SPEECH_CONTRACT = 'speech@1';
export const SPEECH_CAPABILITY = 'axf.speech';

export interface SpeechVoice { id: string; label: string; language: string; kind?: string }

export interface SpeakOptions {
  voice?: string;
  /** 0.5..2.0 (1 = normal) */
  rate?: number;
  /** 0.5..2.0 (1 = normal) */
  pitch?: number;
  language?: string;
  /** stop what is playing and speak now */
  interrupt?: boolean;
}

export type SpeakOutcome = 'done' | 'stopped' | 'failed';

/** What a platform module provides (Android: lib-voice's Speaker over TextToSpeech; web: SpeechSynthesis). */
export interface SpeechProvider {
  readonly id: string;
  readonly label: string;
  available(): Promise<boolean>;
  /** resolves when the utterance is over (done, stopped or failed) */
  speak(text: string, opts?: SpeakOptions): Promise<SpeakOutcome>;
  stop(): Promise<void>;
  voices(): Promise<SpeechVoice[]>;
}

export class SpeechNotImplemented extends Error {
  readonly capability = SPEECH_CAPABILITY;
  constructor() { super(`"${SPEECH_CAPABILITY}" is declared but not built yet.`); this.name = 'NotImplemented'; }
}

/** The kernel default until a provider registers. Never pretends to work. */
export class PlaceholderSpeechProvider implements SpeechProvider {
  readonly id = 'placeholder';
  readonly label = 'No speech provider';
  async available() { return false; }
  speak(): Promise<SpeakOutcome> { return Promise.reject(new SpeechNotImplemented()); }
  async stop() {}
  async voices(): Promise<SpeechVoice[]> { return []; }
}

/* ---------- queue rules (pure) ---------- */

export const RATE_MIN = 0.5;
export const RATE_MAX = 2.0;
export const RATE_DEFAULT = 1;
/** The rate steps "faster" / "slower" move through. */
export const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return RATE_DEFAULT;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(rate * 100) / 100));
}

/** The next step up or down from any rate (a rate between steps snaps to the next step in that direction). */
export function stepRate(rate: number, dir: 1 | -1): number {
  const r = clampRate(rate);
  if (dir > 0) return RATE_STEPS.find((s) => s > r + 1e-9) ?? RATE_MAX;
  return [...RATE_STEPS].reverse().find((s) => s < r - 1e-9) ?? RATE_MIN;
}

export type RepeatMode = 'none' | 'one' | 'all';
export const REPEAT_MODES: RepeatMode[] = ['none', 'one', 'all'];

export interface SpeechItem { id: string; text: string; opts?: SpeakOptions }

export interface SpeechQueueState {
  items: SpeechItem[];
  /** index of the item being (or about to be) spoken; = items.length when the queue is over */
  index: number;
  paused: boolean;
  rate: number;
  repeat: RepeatMode;
  /** true while the provider is speaking the current item */
  speaking: boolean;
}

export type SpeechQueueEvent =
  | { type: 'enqueue'; item: SpeechItem; next?: boolean }
  | { type: 'started' }
  | { type: 'done'; outcome: SpeakOutcome }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'back' }
  | { type: 'repeat'; mode: RepeatMode }
  | { type: 'again' }
  | { type: 'rate'; rate: number }
  | { type: 'faster' }
  | { type: 'slower' }
  | { type: 'clear' };
export const SPEECH_QUEUE_EVENTS = ['enqueue', 'started', 'done', 'pause', 'resume', 'skip', 'back', 'repeat', 'again', 'rate', 'faster', 'slower', 'clear'] as const;

/** What the host does after an event: speak the current item, stop the provider, or nothing. */
export type SpeechEffect = { effect: 'speak'; item: SpeechItem; rate: number } | { effect: 'stop' };

export function initialSpeechQueue(rate = RATE_DEFAULT, repeat: RepeatMode = 'none'): SpeechQueueState {
  return { items: [], index: 0, paused: false, rate: clampRate(rate), repeat, speaking: false };
}

/** The item the host should be speaking now, or null (over, paused, empty). */
export function currentSpeech(s: SpeechQueueState): SpeechItem | null {
  if (s.paused || s.index < 0 || s.index >= s.items.length) return null;
  return s.items[s.index]!;
}

/**
 * The queue reducer. Pure: state + event → state + effects. A `speak` effect is emitted whenever the host should
 * start (or restart) the current item; the host calls the provider, then sends `started` and `done`.
 */
export function reduceSpeechQueue(s: SpeechQueueState, e: SpeechQueueEvent): { state: SpeechQueueState; effects: SpeechEffect[] } {
  const effects: SpeechEffect[] = [];
  let n: SpeechQueueState = { ...s, items: [...s.items] };
  const speakCurrent = () => { const item = currentSpeech(n); if (item) effects.push({ effect: 'speak', item, rate: n.rate }); };
  const restart = () => { if (n.speaking) { effects.push({ effect: 'stop' }); n.speaking = false; } speakCurrent(); };
  switch (e.type) {
    case 'enqueue': {
      const wasIdle = !n.speaking && currentSpeech(n) === null && !n.paused;
      if (e.next) n.items.splice(Math.min(n.index + (n.speaking ? 1 : 0), n.items.length), 0, e.item); else n.items.push(e.item);
      if (n.index > n.items.length - 1 && !n.speaking) n.index = n.items.length - 1;
      if (wasIdle) speakCurrent();
      break;
    }
    case 'started': n.speaking = true; break;
    case 'done': {
      n.speaking = false;
      if (e.outcome === 'stopped') break;
      if (n.repeat === 'one') { speakCurrent(); break; }
      n.index += 1;
      if (n.index >= n.items.length) { if (n.repeat === 'all' && n.items.length) n.index = 0; else n.index = n.items.length; }
      speakCurrent();
      break;
    }
    case 'pause': if (!n.paused) { n.paused = true; if (n.speaking) { effects.push({ effect: 'stop' }); n.speaking = false; } } break;
    case 'resume': if (n.paused) { n.paused = false; speakCurrent(); } break;
    case 'skip': {
      if (n.speaking) { effects.push({ effect: 'stop' }); n.speaking = false; }
      if (n.index < n.items.length) n.index += 1;
      if (n.index >= n.items.length && n.repeat === 'all' && n.items.length) n.index = 0;
      speakCurrent();
      break;
    }
    case 'back': {
      if (n.speaking) { effects.push({ effect: 'stop' }); n.speaking = false; }
      // the previous item; when the queue is over, the last one
      n.index = n.index >= n.items.length ? Math.max(0, n.items.length - 1) : Math.max(0, n.index - 1);
      speakCurrent();
      break;
    }
    case 'repeat': if (REPEAT_MODES.includes(e.mode)) n.repeat = e.mode; break;
    case 'again': {
      // say the current (or the last spoken) item once more
      if (n.index >= n.items.length && n.items.length) n.index = n.items.length - 1;
      n.paused = false;
      restart();
      break;
    }
    case 'rate': { const r = clampRate(e.rate); if (r !== n.rate) { n.rate = r; restart(); } break; }
    case 'faster': { const r = stepRate(n.rate, 1); if (r !== n.rate) { n.rate = r; restart(); } break; }
    case 'slower': { const r = stepRate(n.rate, -1); if (r !== n.rate) { n.rate = r; restart(); } break; }
    case 'clear': { if (n.speaking) effects.push({ effect: 'stop' }); n = { ...n, items: [], index: 0, speaking: false, paused: false }; break; }
  }
  return { state: n, effects };
}

/** Replays events from the initial state (fixtures). */
export function replaySpeechQueue(events: SpeechQueueEvent[], rate = RATE_DEFAULT, repeat: RepeatMode = 'none'): { state: SpeechQueueState; effects: SpeechEffect[] }[] {
  const out: { state: SpeechQueueState; effects: SpeechEffect[] }[] = [];
  let s = initialSpeechQueue(rate, repeat);
  for (const e of events) { const step = reduceSpeechQueue(s, e); out.push(step); s = step.state; }
  return out;
}
