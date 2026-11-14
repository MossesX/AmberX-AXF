/**
 * The listening engine (wake-listener@1): opens the microphone and hands every utterance to the core's state machine.
 *
 * Two backends behind one interface, picked by core.mjs pickEngine:
 *  - **native**: the console Android app's on-device recognizer, through the native bridge (`window.axfNative`,
 *    native-bridge@1): tools `listener.start { phrases }`, `listener.stop`, `listener.status`, event `listener`
 *    { text?, final?, listening, micOpen, error? }. Offline, no audio leaves the phone; the app keeps the mic notification.
 *    The Java side is a deferred twin (framework/spec/PORTING.md → Wake listener): until it lands the bridge has no
 *    `listener.*` tools and this falls through to the next backend.
 *  - **webspeech**: the browser's SpeechRecognition (Chrome, Edge, Safari), continuous, restarted when it stops.
 * Either way the engine takes the page's microphone lease first (mic-lease@1 on globalThis.__axfMicLease, the same
 * contract the Assistant mic, dictation and voice notes use) so two listeners never fight, and lets go while it waits.
 */

export type EngineKind = 'native' | 'webspeech' | 'none';
export interface EngineStatus { listening: boolean; micOpen: boolean; error: string }
export interface EngineHooks { onText: (text: string, isFinal: boolean) => void; onStatus: (s: EngineStatus) => void }
export interface Engine { kind: EngineKind; start(phrases: string[]): Promise<void>; stop(): Promise<void>; pause(): void; resume(): void; running(): boolean }

/* ------------------------------------------------------------------ mic lease (mic-lease@1) */

interface MicLease { readonly $axf: 'mic-lease@1'; holder(): string | null; take(owner: string, ttlMs?: number): boolean; release(owner: string): void; on(fn: (holder: string | null) => void): () => void }
const LEASE_KEY = '__axfMicLease';
export const LEASE_OWNER = 'wake-listener';

function makeLease(): MicLease {
  let who: string | null = null; let until = 0;
  const fns = new Set<(h: string | null) => void>();
  const tell = () => fns.forEach((f) => { try { f(who); } catch { /* theirs */ } });
  return {
    $axf: 'mic-lease@1', holder: () => who,
    take(owner, ttlMs = 120_000) { const t = Date.now(); if (who && who !== owner && t < until) return false; const changed = who !== owner; who = owner; until = t + Math.max(1, ttlMs); if (changed) tell(); return true; },
    release(owner) { if (who === owner) { who = null; until = 0; tell(); } },
    on(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
  };
}
export function micLease(): MicLease {
  const g = globalThis as unknown as Record<string, MicLease | undefined>;
  const have = g[LEASE_KEY];
  if (have && have.$axf === 'mic-lease@1') return have;
  const made = makeLease();
  g[LEASE_KEY] = made;
  return made;
}

/* ------------------------------------------------------------------ what is here */

interface NativeBridge { tools?: string[]; call(tool: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>; on(event: string, fn: (data: Record<string, unknown>, event: string) => void): () => void }
// Window minus the console's own axfNative typing (src/native): the listener reads only the bridge part it needs
type Win = Omit<Window, 'axfNative'> & { axfNative?: NativeBridge; SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; onstart: (() => void) | null; onaudiostart: (() => void) | null;
}

export const NATIVE_TOOLS = ['listener.start', 'listener.stop', 'listener.status'];
export const NATIVE_EVENT = 'listener';

export function available(win: unknown = typeof window === 'undefined' ? null : window): { native: boolean; webspeech: boolean } {
  const w = win as Win | null;
  if (!w) return { native: false, webspeech: false };
  const n = w.axfNative;
  const native = !!n && typeof n.call === 'function' && Array.isArray(n.tools) && NATIVE_TOOLS.every((t) => n.tools!.includes(t));
  const webspeech = typeof (w.SpeechRecognition ?? w.webkitSpeechRecognition) === 'function';
  return { native, webspeech };
}

/* ------------------------------------------------------------------ the two backends */

const RESTART_MS = [400, 800, 1600, 3200, 6400];

export function createEngine(kind: EngineKind, hooks: EngineHooks, win: unknown = typeof window === 'undefined' ? null : window): Engine {
  const w = win as Win | null;
  const lease = micLease();
  let on = false; let paused = false; let fails = 0;
  let status: EngineStatus = { listening: false, micOpen: false, error: '' };
  const set = (p: Partial<EngineStatus>) => { status = { ...status, ...p }; hooks.onStatus(status); };

  if (kind === 'native' && w?.axfNative) {
    const bridge = w.axfNative;
    let off: (() => void) | null = null;
    return {
      kind,
      running: () => on,
      async start(phrases) {
        on = true; fails = 0;
        off?.(); off = bridge.on(NATIVE_EVENT, (d) => {
          if (typeof d.text === 'string' && d.text.trim()) hooks.onText(d.text, d.final !== false);
          set({ listening: d.listening !== false, micOpen: d.micOpen !== false, error: typeof d.error === 'string' ? d.error : '' });
        });
        try { const r = await bridge.call('listener.start', { phrases }); set({ listening: r.listening !== false, micOpen: r.micOpen !== false, error: '' }); }
        catch (e) { set({ listening: false, micOpen: false, error: (e as Error).message || 'the app refused to start the listener' }); }
      },
      async stop() { on = false; off?.(); off = null; try { await bridge.call('listener.stop'); } catch { /* already stopped */ } set({ listening: false, micOpen: false }); },
      pause() { if (!on || paused) return; paused = true; void bridge.call('listener.stop').catch(() => undefined); set({ listening: false, micOpen: false }); },
      resume() { if (!on || !paused) return; paused = false; void bridge.call('listener.start', {}).then((r) => set({ listening: r.listening !== false, micOpen: r.micOpen !== false })).catch(() => undefined); },
    };
  }

  if (kind === 'webspeech' && w) {
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    let rec: SpeechRecognitionLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let offLease: (() => void) | null = null;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const open = () => {
      if (!on || paused || !Ctor) return;
      if (!lease.take(LEASE_OWNER, 120_000)) { set({ listening: false, micOpen: false, error: `${lease.holder()} has the microphone` }); return; }
      const r = new Ctor();
      rec = r;
      r.continuous = true; r.interimResults = false; r.maxAlternatives = 1; r.lang = w.navigator?.language || 'en-US';
      r.onstart = () => { fails = 0; set({ listening: true, micOpen: true, error: '' }); };
      r.onaudiostart = () => set({ micOpen: true });
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res) continue;
          const text = res[0]?.transcript ?? '';
          if (text.trim()) hooks.onText(text, res.isFinal);
        }
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { on = false; set({ listening: false, micOpen: false, error: 'microphone not allowed in this browser' }); lease.release(LEASE_OWNER); return; }
        if (e.error === 'aborted' || e.error === 'no-speech') return; // onend restarts
        fails++;
        set({ error: e.error });
      };
      r.onend = () => {
        rec = null;
        set({ listening: false, micOpen: false });
        lease.release(LEASE_OWNER);
        if (!on || paused) return;
        clear();
        timer = setTimeout(open, RESTART_MS[Math.min(fails, RESTART_MS.length - 1)]);
      };
      try { r.start(); } catch { fails++; clear(); timer = setTimeout(open, RESTART_MS[Math.min(fails, RESTART_MS.length - 1)]); }
    };
    return {
      kind,
      running: () => on,
      async start() {
        on = true; paused = false; fails = 0;
        offLease?.(); offLease = lease.on((h) => { if (on && !paused && !rec && !h) { clear(); timer = setTimeout(open, 150); } });
        open();
      },
      async stop() { on = false; clear(); offLease?.(); offLease = null; try { rec?.abort(); } catch { /* gone */ } rec = null; lease.release(LEASE_OWNER); set({ listening: false, micOpen: false }); },
      pause() { if (!on || paused) return; paused = true; clear(); try { rec?.abort(); } catch { /* gone */ } rec = null; lease.release(LEASE_OWNER); set({ listening: false, micOpen: false }); },
      resume() { if (!on || !paused) return; paused = false; open(); },
    };
  }

  return { kind: 'none', running: () => false, async start() { set({ listening: false, micOpen: false, error: 'no speech recognizer here' }); }, async stop() { set({ listening: false, micOpen: false }); }, pause() { /* nothing to pause */ }, resume() { /* nothing to resume */ } };
}

/* ------------------------------------------------------------------ speaking back + the chime */

/** Says a line: the agent voice when the console has one (`axf:agent-voice.say`), else the device voice. */
export function say(text: string, opts: { agentVoice: boolean; onDone?: () => void } ): void {
  if (typeof window === 'undefined' || !text) { opts.onDone?.(); return; }
  if (opts.agentVoice) { window.dispatchEvent(new CustomEvent('axf:agent-voice.say', { detail: { agentId: 'amber', agentName: 'Amber', text } })); opts.onDone?.(); return; }
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') { opts.onDone?.(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.onend = () => opts.onDone?.();
  u.onerror = () => opts.onDone?.();
  try { synth.cancel(); synth.speak(u); } catch { opts.onDone?.(); }
}

let audio: AudioContext | null = null;
/** A short two-note chime when the wake phrase is heard. */
export function chime(): void {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    for (const [i, f] of [660, 990].entries()) {
      const o = audio.createOscillator(); const g = audio.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.09); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.12);
      o.connect(g); g.connect(audio.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.14);
    }
  } catch { /* no audio here */ }
}
