/**
 * Plan Studio 2.0 voice: one spoken sentence in, one spoken reply out. Listening takes the microphone through
 * mic-lease@1 (`globalThis.__axfMicLease`, shared with dictation, notes and Agent voice; a copy of the lease is made
 * when this loads first), then the browser's recognizer. Speaking goes through agent-voice@1 when installed
 * (`axf:agent-voice.say`), else Web Speech synthesis. What was said is sent to the server's `say` (tree.mjs parseVoice).
 */
export const OWNER = 'plan-studio-2';
const LEASE_KEY = '__axfMicLease';

export interface MicLease { readonly $axf: 'mic-lease@1'; holder(): string | null; take(owner: string, ttlMs?: number): boolean; release(owner: string): void; on(fn: (holder: string | null) => void): () => void }
function createLease(): MicLease {
  let who: string | null = null; let until = 0;
  const fns = new Set<(h: string | null) => void>();
  const tell = () => fns.forEach((f) => { try { f(who); } catch { /* a listener's problem */ } });
  return {
    $axf: 'mic-lease@1', holder: () => who,
    take(owner, ttlMs = 120_000) { const t = Date.now(); if (who && who !== owner && t < until) return false; const changed = who !== owner; who = owner; until = t + Math.max(1, ttlMs); if (changed) tell(); return true; },
    release(owner) { if (who === owner) { who = null; until = 0; tell(); } },
    on(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
  };
}
export function micLease(): MicLease {
  const g = globalThis as unknown as Record<string, unknown>;
  const have = g[LEASE_KEY] as MicLease | undefined;
  if (have && have.$axf === 'mic-lease@1') return have;
  const made = createLease(); g[LEASE_KEY] = made; return made;
}

type Rec = { lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null };
const win = () => (typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>));
const webRecognizer = () => ((win()?.SpeechRecognition ?? win()?.webkitSpeechRecognition ?? null) as (new () => Rec) | null);
export const canListen = () => !!webRecognizer();

/** One utterance from the device (Web Speech); '' when nothing was heard. */
export function listenOnce(lang = 'en-US', timeoutMs = 12_000): Promise<string> {
  const R = webRecognizer();
  if (!R) return Promise.reject(new Error('This device has no speech recognizer.'));
  return new Promise((done) => {
    const rec = new R();
    rec.lang = lang; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
    let text = '';
    const t = setTimeout(() => { try { rec.stop(); } catch { /* already stopped */ } }, timeoutMs);
    rec.onresult = (e) => { const r = e.results[e.results.length - 1]; if (r?.isFinal) text = r[0]?.transcript ?? text; };
    rec.onerror = () => { /* onend follows */ };
    rec.onend = () => { clearTimeout(t); done(text); };
    try { rec.start(); } catch { clearTimeout(t); done(''); }
  });
}

/** Say it: agent-voice@1, else Web Speech. Resolves when done (estimated for agent-voice). */
export async function speakOut(text: string, { agentVoice = false, lang = 'en-US' } = {}): Promise<void> {
  if (!text) return;
  const w = win();
  if (agentVoice && w) {
    window.dispatchEvent(new CustomEvent('axf:agent-voice.say', { detail: { agentId: OWNER, agentName: 'Plan Studio 2.0', text } }));
    await new Promise((r) => setTimeout(r, Math.min(20_000, 500 + text.split(/\s+/).length * 350)));
    return;
  }
  const synth = w?.speechSynthesis as SpeechSynthesis | undefined;
  const U = w?.SpeechSynthesisUtterance as (new (t: string) => SpeechSynthesisUtterance) | undefined;
  if (!synth || !U) return;
  await new Promise<void>((done) => { const u = new U(text); u.lang = lang; u.onend = () => done(); u.onerror = () => done(); synth.speak(u); });
}

/** "stop", "that's all", "done" end a listening loop. */
export const isEnd = (t: string) => /^(stop( listening)?|that'?s (all|it)|i'?m done|done|goodbye|bye|cancel|never mind)[.!]?$/i.test(t.trim());
