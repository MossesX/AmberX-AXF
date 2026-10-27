/*
 * Speech on the web — speech@1 implementation for browsers (the speaking side; same design as Android lib-speech).
 *
 *  - WebSpeechProvider: a SpeechProvider over the browser's SpeechSynthesis (window.speechSynthesis). Guarded: where
 *    it is missing (node, old browsers) `available()` is false and `speak` resolves 'failed'; createSpeechProvider()
 *    hands out the kernel PlaceholderSpeechProvider instead. Synthesis + utterance factory are injectable (tests).
 *  - SpeechPlayer: runs the pure reduceSpeechQueue and only carries out its effects (= Android SpeechPlayer): stale
 *    completions never move the queue, a stop finishes before the next speak, an engine failing every item clears.
 *  - SPEECH_COMMANDS / speechTriggers / speechCommandEvent: the reader's spoken controls as data (triggers@1).
 */
import {
  PlaceholderSpeechProvider, RATE_DEFAULT, clampRate, currentSpeech, initialSpeechQueue, reduceSpeechQueue,
  type RepeatMode, type SpeakOptions, type SpeakOutcome, type SpeechItem, type SpeechProvider, type SpeechQueueEvent, type SpeechQueueState, type SpeechVoice,
} from './speech';
import { DEFAULT_COOLDOWN_MS, DEFAULT_THRESHOLD, type Trigger } from './triggers';

/* ---------- SpeechSynthesis, structurally (so node tests can fake it) ---------- */

export interface SynthVoiceLike { voiceURI: string; name: string; lang: string; localService?: boolean; default?: boolean }
export interface SynthUtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: SynthVoiceLike | null;
  onstart: ((ev?: unknown) => void) | null;
  onend: ((ev?: unknown) => void) | null;
  onerror: ((ev?: { error?: string }) => void) | null;
}
export interface SpeechSynthesisLike {
  speak(u: SynthUtteranceLike): void;
  cancel(): void;
  getVoices(): SynthVoiceLike[];
  addEventListener?(type: 'voiceschanged', fn: () => void): void;
  removeEventListener?(type: 'voiceschanged', fn: () => void): void;
}
export type SynthUtteranceFactory = (text: string) => SynthUtteranceLike;

type SpeechGlobals = { speechSynthesis?: unknown; SpeechSynthesisUtterance?: new (text: string) => unknown };

/** The browser's SpeechSynthesis, or null where there is none (node, old browsers). */
export function browserSpeechSynthesis(): SpeechSynthesisLike | null {
  const g = globalThis as SpeechGlobals;
  const s = g.speechSynthesis as Partial<SpeechSynthesisLike> | undefined;
  return s && typeof s.speak === 'function' && typeof s.cancel === 'function' && typeof s.getVoices === 'function' ? (s as SpeechSynthesisLike) : null;
}

/** A factory for the browser's SpeechSynthesisUtterance, or null where there is none. */
export function browserUtteranceFactory(): SynthUtteranceFactory | null {
  const Ctor = (globalThis as SpeechGlobals).SpeechSynthesisUtterance;
  return typeof Ctor === 'function' ? (text) => new Ctor(text) as SynthUtteranceLike : null;
}

/** True when this browser can speak. */
export function webSpeechAvailable(): boolean { return browserSpeechSynthesis() !== null && browserUtteranceFactory() !== null; }

/* ---------- provider ---------- */

export const WEB_SPEECH_PROVIDER_ID = 'web-speech';

export class WebSpeechProvider implements SpeechProvider {
  readonly id = WEB_SPEECH_PROVIDER_ID;
  readonly label = 'Browser speech (SpeechSynthesis)';
  private current: { u: SynthUtteranceLike; settle: (o: SpeakOutcome) => void } | null = null;

  constructor(
    private readonly synth: SpeechSynthesisLike | null = browserSpeechSynthesis(),
    private readonly utterance: SynthUtteranceFactory | null = browserUtteranceFactory(),
    /** how long voices() waits for the browser's voice list to load (Chrome loads it late) */
    private readonly voiceWaitMs = 1000,
  ) {}

  async available(): Promise<boolean> { return this.synth !== null && this.utterance !== null; }

  /** Speaks now (whatever was playing ends as 'stopped'); resolves when the utterance is over. */
  speak(text: string, opts?: SpeakOptions): Promise<SpeakOutcome> {
    const synth = this.synth;
    const make = this.utterance;
    if (!synth || !make) return Promise.resolve('failed');
    this.endCurrent(true);
    return new Promise<SpeakOutcome>((resolve) => {
      let u: SynthUtteranceLike;
      try { u = make(text); } catch { resolve('failed'); return; }
      u.rate = clampRate(opts?.rate ?? RATE_DEFAULT);
      u.pitch = clampRate(opts?.pitch ?? 1);
      if (opts?.language) u.lang = opts.language;
      if (opts?.voice) {
        const v = safeVoices(synth).find((x) => x.voiceURI === opts.voice || x.name === opts.voice);
        if (v) u.voice = v;
      }
      let settled = false;
      const settle = (o: SpeakOutcome) => {
        if (settled) return;
        settled = true;
        if (this.current?.u === u) this.current = null;
        resolve(o);
      };
      u.onend = () => settle('done');
      // cancel() reports 'interrupted' (Chrome) or 'canceled' (Safari, Firefox): that is a stop, not a failure
      u.onerror = (ev) => settle(ev?.error === 'interrupted' || ev?.error === 'canceled' ? 'stopped' : 'failed');
      this.current = { u, settle };
      try { synth.speak(u); } catch { settle('failed'); }
    });
  }

  async stop(): Promise<void> { this.endCurrent(true); }

  private endCurrent(cancel: boolean) {
    const c = this.current;
    this.current = null;
    c?.settle('stopped');
    if (cancel && this.synth) { try { this.synth.cancel(); } catch { /* nothing to cancel */ } }
  }

  async voices(): Promise<SpeechVoice[]> {
    const synth = this.synth;
    if (!synth) return [];
    let list = safeVoices(synth);
    if (!list.length && synth.addEventListener) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); synth.removeEventListener?.('voiceschanged', done); resolve(); };
        const timer = setTimeout(done, this.voiceWaitMs);
        synth.addEventListener?.('voiceschanged', done);
      });
      list = safeVoices(synth);
    }
    return list
      .map((v) => ({ id: v.voiceURI || v.name, label: `${v.name} (${v.lang})`, language: v.lang, kind: v.localService === false ? 'network' : 'local' }))
      .sort((a, b) => a.language.localeCompare(b.language) || a.id.localeCompare(b.id));
  }
}

function safeVoices(s: SpeechSynthesisLike): SynthVoiceLike[] { try { return s.getVoices() ?? []; } catch { return []; } }

/** The browser provider when this browser can speak, else the kernel placeholder (never pretends to work). */
export function createSpeechProvider(): SpeechProvider { return webSpeechAvailable() ? new WebSpeechProvider() : new PlaceholderSpeechProvider(); }

/* ---------- player over the queue reducer ---------- */

export interface SpeechPlayerOptions {
  rate?: number;
  repeat?: RepeatMode;
  /** options for an item without its own (voice, pitch, language); the rate always comes from the queue */
  defaults?: () => SpeakOptions | undefined;
}

export class SpeechPlayer {
  private s: SpeechQueueState;
  private gen = 0;
  private stopping: Promise<void> = Promise.resolve();
  private nextId = 0;
  private failures = 0;
  private readonly listeners = new Set<(s: SpeechQueueState) => void>();
  private readonly defaults?: () => SpeakOptions | undefined;
  /** how the last utterance ended (null before the first) */
  lastOutcome: SpeakOutcome | null = null;

  constructor(readonly provider: SpeechProvider, opts: SpeechPlayerOptions = {}) {
    this.s = initialSpeechQueue(opts.rate ?? RATE_DEFAULT, opts.repeat ?? 'none');
    this.defaults = opts.defaults;
  }

  get state(): SpeechQueueState { return this.s; }
  /** true while something is being said or waits to be said (not paused) */
  get active(): boolean { return this.s.speaking || currentSpeech(this.s) !== null; }

  /** Calls [fn] after every change; returns the unsubscribe. */
  subscribe(fn: (s: SpeechQueueState) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Sends one event through the reducer and carries out its effects. */
  dispatch(event: SpeechQueueEvent): void {
    const work: SpeechQueueEvent[] = [event];
    for (let i = 0; i < work.length; i++) {
      const step = reduceSpeechQueue(this.s, work[i]!);
      this.s = step.state;
      for (const fx of step.effects) {
        this.gen += 1;
        if (fx.effect === 'stop') this.stopProvider();
        else { this.speak(fx.item, fx.rate, this.gen); work.push({ type: 'started' }); }
      }
    }
    for (const fn of [...this.listeners]) { try { fn(this.s); } catch { /* a listener never breaks the player */ } }
  }

  /** Queues [text]; `next` puts it right after the current item; `opts.interrupt` clears the queue first. Returns the item id. */
  enqueue(text: string, opts?: SpeakOptions, next = false): string {
    const id = `s${++this.nextId}`;
    if (opts?.interrupt) this.dispatch({ type: 'clear' });
    const own = opts ? { ...opts } : undefined;
    if (own) delete own.interrupt;
    this.dispatch({ type: 'enqueue', item: own ? { id, text, opts: own } : { id, text }, next });
    return id;
  }

  /** Stops whatever is being read and says [text] now. */
  say(text: string, opts?: SpeakOptions): string { return this.enqueue(text, { ...(opts ?? {}), interrupt: true }); }
  pause(): void { this.dispatch({ type: 'pause' }); }
  resume(): void { this.dispatch({ type: 'resume' }); }
  skip(): void { this.dispatch({ type: 'skip' }); }
  back(): void { this.dispatch({ type: 'back' }); }
  faster(): void { this.dispatch({ type: 'faster' }); }
  slower(): void { this.dispatch({ type: 'slower' }); }
  /** says the current (or last) item again */
  again(): void { this.dispatch({ type: 'again' }); }
  setRate(rate: number): void { this.dispatch({ type: 'rate', rate }); }
  setRepeat(mode: RepeatMode): void { this.dispatch({ type: 'repeat', mode }); }
  /** stops reading and clears the queue */
  stop(): void { this.dispatch({ type: 'clear' }); }

  /** Runs a speech action (`speech.pause`, …); false when it isn't one. */
  command(action: string): boolean {
    const e = speechCommandEvent(action);
    if (!e) return false;
    this.dispatch(e);
    return true;
  }

  private stopProvider() {
    this.stopping = this.stopping.then(() => this.provider.stop()).catch(() => undefined);
  }

  private speak(item: SpeechItem, rate: number, gen: number) {
    const base = this.defaults?.();
    const own = item.opts;
    const opts: SpeakOptions = { rate };
    const voice = own?.voice ?? base?.voice; if (voice !== undefined) opts.voice = voice;
    const pitch = own?.pitch ?? base?.pitch; if (pitch !== undefined) opts.pitch = pitch;
    const language = own?.language ?? base?.language; if (language !== undefined) opts.language = language;
    void this.stopping.then(async () => {
      if (gen !== this.gen) return; // replaced or stopped while the stop finished: don't start a stale utterance
      let outcome: SpeakOutcome;
      try { outcome = await this.provider.speak(item.text, opts); } catch { outcome = 'failed'; }
      this.finished(gen, outcome);
    });
  }

  private finished(gen: number, outcome: SpeakOutcome) {
    if (gen !== this.gen) return; // stopped or replaced: the queue already moved on
    this.lastOutcome = outcome;
    if (outcome === 'failed') {
      this.failures += 1;
      if (this.failures >= Math.max(1, this.s.items.length)) { this.failures = 0; this.dispatch({ type: 'clear' }); return; }
    } else if (outcome === 'done') this.failures = 0;
    this.dispatch({ type: 'done', outcome });
  }
}

/* ---------- spoken controls as data (= Android SpeechCommands / SpeechTriggers) ---------- */

export const SPEECH_MODULE_ID = 'ai.amberx.axf.speech';

export interface SpeechCommand { action: string; label: string; phrases: string[]; event: SpeechQueueEvent }

export const SPEECH_COMMANDS: readonly SpeechCommand[] = [
  { action: 'speech.pause', label: 'Pause reading', phrases: ['pause', 'pause reading'], event: { type: 'pause' } },
  { action: 'speech.resume', label: 'Resume reading', phrases: ['resume', 'continue reading'], event: { type: 'resume' } },
  { action: 'speech.skip', label: 'Skip', phrases: ['skip', 'skip this'], event: { type: 'skip' } },
  { action: 'speech.faster', label: 'Read faster', phrases: ['faster', 'read faster'], event: { type: 'faster' } },
  { action: 'speech.slower', label: 'Read slower', phrases: ['slower', 'read slower'], event: { type: 'slower' } },
  { action: 'speech.repeat', label: 'Repeat', phrases: ['repeat', 'say that again'], event: { type: 'again' } },
  { action: 'speech.stop', label: 'Stop reading', phrases: ['stop reading'], event: { type: 'clear' } },
];

/** The queue event a speech action id means, or null. */
export function speechCommandEvent(action: string): SpeechQueueEvent | null {
  const c = SPEECH_COMMANDS.find((x) => x.action === action);
  return c ? { ...c.event } : null;
}

/** The reader's controls as permanent voice triggers (triggers@1): id = action, 80 %, no arming, [worksIn] (empty = anywhere). */
export function speechTriggers(module = SPEECH_MODULE_ID, worksIn: string[] = []): Trigger[] {
  return SPEECH_COMMANDS.map((c): Trigger => ({
    id: c.action, kind: 'voice', source: 'permanent', module, label: c.label, phrases: [...c.phrases], action: c.action,
    threshold: DEFAULT_THRESHOLD, worksIn: [...worksIn], arming: 'always', enabled: true, cooldownMs: DEFAULT_COOLDOWN_MS, mutedUntil: 0,
  }));
}
