/**
 * Mic off, the page's half (Nov 1 2026, Brett: "a quick switch. It disables all the listening, turns the green dot off
 * my phone, turns off the microphone"). The Android side has its own gate (`MicGuard.java`) for everything native; this
 * is the one place a page gets the microphone:
 *
 * - `getUserMedia` with audio and every `SpeechRecognition` / `webkitSpeechRecognition` go through here
 *   (`installMicGuard`, done when this module loads, before anything captures those constructors). While Mic off is
 *   on, an audio request is refused (`NotAllowedError`) and a recognizer's `start()` ends at once with `not-allowed`,
 *   so plugins and console plugins loaded into AmberX can't open the mic either, whatever they import.
 * - Turning it on (`setMicOff(true)`) stops every audio track and aborts every recognizer this page opened.
 * - Kept on this device (`amberx.device.micOff`, never synced): the phone app's own switch is the native one, and a
 *   synced value would turn a phone's mic back on from another device.
 *
 * Published as `globalThis.__axfMicOff` (mic-off@1), the same no-imports pattern as the mic lease, so console plugins
 * can ask before they try.
 */
import { deviceStore, type KeyValueStore } from './listeners';

export const MIC_OFF_KEY = 'amberx.device.micOff';
export const MIC_OFF_GLOBAL = '__axfMicOff';

export interface MicOffApi {
  readonly $axf: 'mic-off@1';
  off(): boolean;
  on(fn: (off: boolean) => void): () => void;
}

type Stoppable = { stop(): void };
type Track = Stoppable & { kind?: string };
type Stream = { getTracks(): Track[] };
type Rec = { start(): void; abort(): void; onerror?: ((e: { error: string }) => void) | null; onend?: (() => void) | null; addEventListener?(t: string, f: () => void): void };
type RecCtor = new () => Rec;

export interface MicGuard {
  off(): boolean;
  set(off: boolean): number;
  on(fn: (off: boolean) => void): () => void;
  /** Stops every audio track and recognizer opened through the guard; how many it stopped. */
  releaseAll(): number;
  /** How many audio streams / recognizers are open now. */
  open(): { streams: number; recognizers: number };
}

/** The guard over one global object (the page's `globalThis`; tests pass a fake). */
export function createMicGuard(g: Record<string, unknown>, store: KeyValueStore = deviceStore()): MicGuard {
  let off = store.getItem(MIC_OFF_KEY) === 'true';
  const streams = new Set<Stream>();
  const recs = new Set<Rec>();
  const fns = new Set<(off: boolean) => void>();
  const releaseAll = () => {
    let n = 0;
    streams.forEach((s) => { s.getTracks().forEach((t) => { if (!t.kind || t.kind === 'audio') { try { t.stop(); n++; } catch { /* already stopped */ } } }); });
    streams.clear();
    recs.forEach((r) => { try { r.abort(); n++; } catch { /* already ended */ } });
    recs.clear();
    return n;
  };
  const guard: MicGuard = {
    off: () => off,
    set(next) {
      const changed = next !== off;
      off = next;
      try { store.setItem(MIC_OFF_KEY, String(next)); } catch { /* storage off: kept for this page */ }
      const n = next ? releaseAll() : 0;
      if (changed) fns.forEach((f) => { try { f(next); } catch { /* a listener's problem */ } });
      return n;
    },
    on(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
    releaseAll,
    open: () => ({ streams: streams.size, recognizers: recs.size }),
  };

  // getUserMedia: audio refused while off; every stream with audio is kept so Mic off can stop it.
  const nav = g.navigator as { mediaDevices?: { getUserMedia?: (c: { audio?: unknown; video?: unknown }) => Promise<Stream> } } | undefined;
  const md = nav?.mediaDevices;
  const gum = md?.getUserMedia?.bind(md);
  if (md && gum && !(gum as { __axfMicGuard?: boolean }).__axfMicGuard) {
    const wrapped = async (c: { audio?: unknown; video?: unknown }) => {
      if (c?.audio && off) {
        const DE = g.DOMException as (new (m: string, n: string) => Error) | undefined;
        throw DE ? new DE('Mic off is on in AmberX.', 'NotAllowedError') : Object.assign(new Error('Mic off is on in AmberX.'), { name: 'NotAllowedError' });
      }
      const s = await gum(c);
      if (c?.audio) {
        if (off) { s.getTracks().forEach((t) => t.stop()); throw Object.assign(new Error('Mic off is on in AmberX.'), { name: 'NotAllowedError' }); }
        streams.add(s);
      }
      return s;
    };
    (wrapped as { __axfMicGuard?: boolean }).__axfMicGuard = true;
    try { md.getUserMedia = wrapped; } catch { /* read-only: recognizers are still guarded */ }
  }

  // SpeechRecognition: start() ends at once while off; every started recognizer is kept so Mic off can abort it.
  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    const Base = g[name] as (RecCtor & { __axfMicGuard?: boolean }) | undefined;
    if (typeof Base !== 'function' || Base.__axfMicGuard) continue;
    class Guarded extends Base {
      start() {
        if (off) {
          // like a refused microphone: error, then end (callers stop restarting on not-allowed)
          setTimeout(() => { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); }, 0);
          return;
        }
        recs.add(this);
        try { this.addEventListener?.('end', () => recs.delete(this)); } catch { /* no events */ }
        super.start();
      }
    }
    (Guarded as unknown as { __axfMicGuard: boolean }).__axfMicGuard = true;
    g[name] = Guarded;
  }

  g[MIC_OFF_GLOBAL] = { $axf: 'mic-off@1', off: () => off, on: guard.on } satisfies MicOffApi;
  return guard;
}

/** What the switch shows (native.ts `MicState`, without the import). */
export interface MicView { off: boolean; yielded: string | null; listening: boolean }

/** The words under the switch: what is true right now, plainly. */
export function micDetail(s: MicView, native: boolean): string {
  if (s.off) return native
    ? 'AmberX holds no microphone: no hands-free, no wake word, no Speak, no recorder mic. Android\'s green dot is off for AmberX. Nothing opens the mic until you turn it back on.'
    : 'This page holds no microphone and won\'t open one until you turn it back on.';
  if (s.yielded === 'call') return 'A call is using the microphone, so AmberX let go. Hands-free comes back by itself when the call ends.';
  if (s.yielded === 'other-app' || s.yielded === 'silenced') return 'Another app (a Claude voice call, a recorder) is using the microphone, so AmberX let go. Hands-free comes back by itself when it is done.';
  if (s.listening) return 'Hands-free is listening. One tap lets go of every microphone AmberX holds.';
  return 'The mic is allowed, but nothing in AmberX is listening right now. One tap keeps it that way until you turn it back on.';
}

export function micChip(s: MicView): { text: string; tone: 'success' | 'warning' | 'danger' | 'accent' } {
  if (s.off) return { text: 'Mic off', tone: 'danger' };
  if (s.yielded) return { text: 'Paused for another app', tone: 'warning' };
  return s.listening ? { text: 'Listening', tone: 'success' } : { text: 'Mic on', tone: 'accent' };
}

let page: MicGuard | null = null;

/** The page's guard (installed on first use; this module installs it when it loads). */
export function micGuard(): MicGuard {
  if (!page) page = createMicGuard(globalThis as unknown as Record<string, unknown>);
  return page;
}

/** True while Mic off is on (this page's view; the Android app keeps it in step with the native switch). */
export const micIsOff = (): boolean => micGuard().off();

micGuard();
