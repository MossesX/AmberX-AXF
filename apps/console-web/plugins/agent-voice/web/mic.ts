/**
 * Agent voice — the Assistant microphone (s4).
 *
 * One listener, shared fairly:
 *  - it takes the page's microphone lease (mic-lease@1, lease.ts) before it opens the mic and gives it back after, so
 *    AmberX dictation, Speak a command and voice notes never run at the same time as it (they take the same lease);
 *  - when someone else holds the lease it waits (up to `waitMs`) or says who is busy — never steals it;
 *  - in AmberX the native recognizer already makes hands-free wake listening let go of the mic while it listens
 *    (`pauseHandsFree`), and the agent's own voice is spoken with `holdMic` so hands-free never hears it as a command;
 *  - pressing the mic while the agent talks stops the talking first (`bargeIn`).
 *
 * Modes: tap (one utterance), hold (listens while pressed), toggle (keeps listening, utterance after utterance, until
 * tapped again, silence for `silenceMs` or `maxSeconds`).
 */
import { interpretHeard, type Heard, type MicSettings } from './core';
import { amberxNative, setSpeaker, speakerState, stopSpeaking } from './engine';
import { micLease } from './lease';

export const OWNER = 'agent-voice';

export interface MicHandlers {
  /** words so far (live text) */
  partial?: (text: string) => void;
  /** one finished utterance, already interpreted (send / cancel / text) */
  heard: (h: Heard) => void;
  /** listening ended (any reason) */
  end?: (why: 'done' | 'stopped' | 'silence' | 'max' | 'error' | 'busy') => void;
  error?: (message: string) => void;
}

interface NativeListen {
  listen(o: { lang: string; prompt?: string }): Promise<{ text: string }>;
  addListener(event: 'heard', fn: (e: { text: string; final: boolean; source?: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

type WebRec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void; abort(): void;
};

let session: { stop: (why: 'stopped' | 'silence' | 'max') => void } | null = null;
export const micActive = (): boolean => session !== null;

/** The device's answer about the microphone: 'denied' blocks, anything else may still ask. */
export async function devicePermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  const nat = amberxNative() as unknown as { micPermission?: () => Promise<{ state: 'granted' | 'denied' | 'prompt' }> } | null;
  if (nat?.micPermission) { try { return (await nat.micPermission()).state; } catch { return 'unknown'; } }
  try {
    const p = await (navigator as Navigator & { permissions?: { query(o: { name: string }): Promise<{ state: string }> } }).permissions?.query({ name: 'microphone' });
    return (p?.state as 'granted' | 'denied' | 'prompt') ?? 'unknown';
  } catch { return 'unknown'; }
}

export const recognitionAvailable = (): boolean =>
  !!amberxNative() || !!((globalThis as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ?? (globalThis as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

/** Waits for the lease (up to `waitMs`); true when we hold it. */
export async function takeLease(mic: MicSettings): Promise<boolean> {
  const lease = micLease();
  const ttl = (mic.maxSeconds + 5) * 1000;
  if (lease.take(OWNER, ttl)) return true;
  if (!mic.respectOthers) return false;
  const until = Date.now() + mic.waitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 200));
    if (lease.take(OWNER, ttl)) return true;
  }
  return false;
}

export function stopMic(): void { session?.stop('stopped'); }

/** Opens the microphone for the Assistant. Resolves when it has started (or failed to). */
export async function startMic(mic: MicSettings, h: MicHandlers): Promise<boolean> {
  if (session) { stopMic(); return false; }
  if (speakerState().speaking && mic.bargeIn) stopSpeaking();
  if (!(await takeLease(mic))) { h.end?.('busy'); return false; }
  setSpeaker({ listening: true });
  const lease = micLease();
  let ended = false;
  const finish = (why: Parameters<NonNullable<MicHandlers['end']>>[0]) => {
    if (ended) return;
    ended = true;
    session = null;
    lease.release(OWNER);
    setSpeaker({ listening: false });
    h.end?.(why);
  };
  const deliver = (text: string): Heard | null => {
    if (!text.trim()) return null;
    const heard = interpretHeard(text, mic);
    h.heard(heard);
    return heard;
  };
  const maxTimer = setTimeout(() => session?.stop('max'), mic.maxSeconds * 1000);
  if (mic.haptics) { try { (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(15); } catch { /* no haptics */ } }

  const nat = amberxNative() as unknown as NativeListen | null;
  if (nat?.listen) {
    // Native: one utterance per listen(); toggle mode loops until stopped or silent.
    let stopped = false;
    const sub = nat.addListener('heard', (e) => { if (e.source === 'listen' && !e.final && mic.liveText) h.partial?.(e.text); });
    session = { stop: (why) => { stopped = true; clearTimeout(maxTimer); void sub.then((s) => s.remove()); finish(why); } };
    void (async () => {
      let quietSince = Date.now();
      try {
        do {
          const r = await nat.listen({ lang: mic.lang });
          if (stopped) break;
          if (r.text.trim()) { quietSince = Date.now(); const heard = deliver(r.text); if (heard && heard.kind !== 'text' && mic.mode === 'toggle') break; }
          else if (Date.now() - quietSince > mic.silenceMs) { session?.stop('silence'); return; }
          lease.take(OWNER, (mic.maxSeconds + 5) * 1000);
        } while (mic.mode === 'toggle' && !stopped);
        clearTimeout(maxTimer);
        void sub.then((s) => s.remove());
        finish('done');
      } catch (e) {
        clearTimeout(maxTimer);
        void sub.then((s) => s.remove());
        h.error?.((e as Error).message || 'the microphone is busy');
        finish('error');
      }
    })();
    return true;
  }

  const Rec = ((globalThis as unknown as { SpeechRecognition?: new () => WebRec }).SpeechRecognition
    ?? (globalThis as unknown as { webkitSpeechRecognition?: new () => WebRec }).webkitSpeechRecognition);
  if (!Rec) { clearTimeout(maxTimer); h.error?.('This browser can\'t listen (no speech recognition). Use Chrome or the AmberX app.'); finish('error'); return false; }
  const rec = new Rec();
  rec.lang = mic.lang;
  rec.interimResults = mic.liveText;
  rec.continuous = mic.mode !== 'tap';
  rec.maxAlternatives = 1;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  const armSilence = () => {
    if (mic.mode !== 'toggle') return;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => session?.stop('silence'), mic.silenceMs);
  };
  let why: 'done' | 'stopped' | 'silence' | 'max' = 'done';
  rec.onresult = (e) => {
    armSilence();
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      const text = r[0]?.transcript ?? '';
      if (r.isFinal) { const heard = deliver(text); if (heard && heard.kind !== 'text' && mic.mode === 'toggle') session?.stop('stopped'); }
      else interim += text;
    }
    if (interim && mic.liveText) h.partial?.(interim);
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    h.error?.(e.error === 'not-allowed' ? 'The microphone isn\'t allowed for this page.' : `listening: ${e.error}`);
    why = 'done';
  };
  rec.onend = () => { clearTimeout(maxTimer); if (silenceTimer) clearTimeout(silenceTimer); finish(why); };
  session = { stop: (w) => { why = w; try { rec.stop(); } catch { finish(w); } } };
  try { rec.start(); armSilence(); } catch (e) { clearTimeout(maxTimer); h.error?.((e as Error).message); finish('error'); return false; }
  return true;
}
