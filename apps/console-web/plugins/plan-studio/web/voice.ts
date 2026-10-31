/**
 * Plan Studio voice conversation (Brett, Oct 30 2026: "do all this planning through the [AmberX] app with voice like
 * I'm talking to you"). Tap, talk, and the plan AI edits plans, answers, and talks back, turn after turn, until you
 * say you're done.
 *
 * Nobody imports anybody:
 *  - the microphone is taken through mic-lease@1 (`globalThis.__axfMicLease`, the same object AmberX's dictation,
 *    notes and Agent voice use); this file carries its own copy of the lease for when it loads first (same contract,
 *    same key as apps/amberx-droid/src/miclease.ts on the agent-voice branch);
 *  - listening: AmberX's native speech (`Capacitor.Plugins.AmberxNative.listen`) inside the Android shell, else the
 *    browser's Web Speech recognizer;
 *  - speaking: agent-voice@1 when installed (`axf:agent-voice.say` window event; it picks the voice), else AmberX's
 *    native speak, else Web Speech synthesis.
 * The loop itself (runConversation) takes these as plain functions, so tests drive it with fake speech in and out.
 */

export const OWNER = 'plan-studio';
export const LEASE_KEY = '__axfMicLease';

/* ---------------------------------------------------------------- mic-lease@1 */

export interface MicLease {
  readonly $axf: 'mic-lease@1';
  holder(): string | null;
  take(owner: string, ttlMs?: number, now?: () => number): boolean;
  release(owner: string): void;
  on(fn: (holder: string | null) => void): () => void;
}
export function createLease(): MicLease {
  let who: string | null = null;
  let until = 0;
  const fns = new Set<(h: string | null) => void>();
  const tell = () => fns.forEach((f) => { try { f(who); } catch { /* a listener's problem */ } });
  return {
    $axf: 'mic-lease@1',
    holder: () => who,
    take(owner, ttlMs = 120_000, now = Date.now) {
      const t = now();
      if (who && who !== owner && t < until) return false;
      const changed = who !== owner;
      who = owner; until = t + Math.max(1, ttlMs);
      if (changed) tell();
      return true;
    },
    release(owner) { if (who === owner) { who = null; until = 0; tell(); } },
    on(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
  };
}
export function micLease(g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): MicLease {
  const have = g[LEASE_KEY] as MicLease | undefined;
  if (have && have.$axf === 'mic-lease@1') return have;
  const made = createLease();
  g[LEASE_KEY] = made;
  return made;
}
export const HOLDER_LABEL: Record<string, string> = { dictation: 'Dictation', 'voice-command': 'Speak a command', 'agent-voice': 'The Assistant microphone', notes: 'Voice notes', 'plan-studio': 'Plan Studio' };

/* ---------------------------------------------------------------- what was said */

export type Intent = 'end' | 'undo' | 'yes' | 'no' | 'repeat' | 'say';
export function intentOf(text: string): Intent {
  const t = text.trim().toLowerCase().replace(/[.!?,]+$/g, '');
  if (!t) return 'say';
  if (/^(i'?m done|that'?s (all|it)( for now)?|we'?re done|done for now|stop( listening)?|goodbye|bye|end( the)? (conversation|session)|thanks?,? that'?s all|nothing else|i'?m finished)$/.test(t)) return 'end';
  if (/^(undo( that| it| the last( one| change)?)?|take that back|scratch that|revert that)$/.test(t)) return 'undo';
  if (/^(yes|yeah|yep|yup|sure|ok(ay)?|do it|go ahead|confirm(ed)?|please do|correct|right)( please)?$/.test(t)) return 'yes';
  if (/^(no|nope|cancel|don'?t|never mind|nevermind|stop that|leave it)$/.test(t)) return 'no';
  if (/^(say (that|it) again|repeat( that)?|what did you say|pardon|come again)$/.test(t)) return 'repeat';
  return 'say';
}

/* ---------------------------------------------------------------- the turn loop */

export interface TurnResult {
  /** what to say back */
  say: string;
  /** apply this when confirmed (big edits: new plans, removals, Turn into a build) */
  confirm?: { question: string; run: () => Promise<TurnResult> };
  /** undo for what this turn applied */
  undo?: () => Promise<string>;
}
export interface VoiceIo {
  listen(): Promise<string>;
  speak(text: string): Promise<void>;
  lease: MicLease;
  /** shown on screen as the conversation goes */
  onEvent?(e: { kind: 'heard' | 'said' | 'state' | 'error'; text: string }): void;
  /** stop from outside (the Stop button) */
  stopped?(): boolean;
}
export type TurnHandler = (heard: string) => Promise<TurnResult>;

/**
 * Talk until done. Holds the mic lease while listening and lets go while speaking (so a spoken reply never fights the
 * recognizer, and Agent voice / dictation can take it between turns only if this conversation has ended).
 * Returns the turns it ran. `maxTurns` keeps a runaway loop bounded; `maxSilence` empty listens end it.
 */
export async function runConversation(io: VoiceIo, handle: TurnHandler, { maxTurns = 60, maxSilence = 3, greeting = 'Plan Studio here. What would you like to plan?' } = {}): Promise<{ turns: number; ended: 'done' | 'busy' | 'silence' | 'stopped' | 'limit' | 'error' }> {
  const ev = (kind: 'heard' | 'said' | 'state' | 'error', text: string) => { try { io.onEvent?.({ kind, text }); } catch { /* the screen's problem */ } };
  const say = async (text: string) => { ev('said', text); await io.speak(text); };
  if (!io.lease.take(OWNER)) {
    const who = io.lease.holder() ?? '';
    await say(`${HOLDER_LABEL[who] ?? 'Something else'} is using the microphone. Try again when it's finished.`);
    return { turns: 0, ended: 'busy' };
  }
  io.lease.release(OWNER);
  const undos: (() => Promise<string>)[] = [];
  let pending: TurnResult['confirm'] | null = null;
  let last = greeting;
  let silence = 0;
  let turns = 0;
  await say(greeting);
  try {
    while (turns < maxTurns) {
      if (io.stopped?.()) return { turns, ended: 'stopped' };
      if (!io.lease.take(OWNER)) { await say('The microphone was taken by something else. Ending here.'); return { turns, ended: 'busy' }; }
      ev('state', 'listening');
      let heard = '';
      try { heard = (await io.listen()).trim(); } finally { io.lease.release(OWNER); }
      if (io.stopped?.()) return { turns, ended: 'stopped' };
      if (!heard) {
        silence += 1;
        if (silence >= maxSilence) { await say("I didn't hear anything, so I'll stop here. Tap to talk again."); return { turns, ended: 'silence' }; }
        continue;
      }
      silence = 0; turns += 1;
      ev('heard', heard);
      const intent = intentOf(heard);
      if (intent === 'end') { await say(pending ? 'Okay, nothing changed. Talk soon.' : 'Okay. Talk soon.'); return { turns, ended: 'done' }; }
      if (intent === 'repeat') { await say(last); continue; }
      if (pending) {
        if (intent === 'yes') { const p = pending; pending = null; ev('state', 'thinking'); const r = await p.run(); if (r.undo) undos.push(r.undo); last = r.say; await say(r.say); continue; }
        if (intent === 'no') { pending = null; last = "Okay, I won't."; await say(last); continue; }
        pending = null; // something new: drop the question and treat it as a new request
      }
      if (intent === 'undo') {
        const u = undos.pop();
        last = u ? await u() : 'There is nothing to undo.';
        await say(last);
        continue;
      }
      ev('state', 'thinking');
      let r: TurnResult;
      try { r = await handle(heard); } catch (e) { r = { say: `That didn't work: ${(e as Error).message}` }; ev('error', (e as Error).message); }
      if (r.confirm) { pending = r.confirm; last = r.confirm.question; await say(r.confirm.question); continue; }
      if (r.undo) undos.push(r.undo);
      last = r.say;
      await say(r.say);
    }
    await say("That's a long session; I'll stop here. Tap to carry on.");
    return { turns, ended: 'limit' };
  } catch (e) {
    ev('error', (e as Error).message);
    return { turns, ended: 'error' };
  } finally {
    io.lease.release(OWNER);
  }
}

/* ---------------------------------------------------------------- the device's speech */

type Rec = { lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null };
type NativeVoice = { listen(o: { lang: string; prompt?: string }): Promise<{ text: string }>; speak(o: { text: string; lang: string }): Promise<void> };

const win = () => (typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>));
/** AmberX's native speech plugin inside the Android shell (Capacitor), else null. */
export function nativeVoice(): NativeVoice | null {
  const cap = win()?.Capacitor as { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } | undefined;
  if (!cap?.isNativePlatform?.()) return null;
  const n = cap.Plugins?.AmberxNative as NativeVoice | undefined;
  return n && typeof n.listen === 'function' ? n : null;
}
export function webRecognizer(): (new () => Rec) | null {
  const w = win();
  return (w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null) as (new () => Rec) | null;
}
export const canListen = () => !!(nativeVoice() || webRecognizer());

/** One utterance from the device (native first, else Web Speech). */
export function listenOnce(lang = 'en-US', timeoutMs = 15_000): Promise<string> {
  const n = nativeVoice();
  if (n) return n.listen({ lang, prompt: 'Plan Studio is listening' }).then((r) => r?.text ?? '').catch(() => '');
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

/** Is Agent voice (agent-voice@1) installed? `libs` = the runtime's libraries. */
export function hasAgentVoice(libs: { provides?: string[] }[]): boolean { return libs.some((l) => (l.provides ?? []).includes('axf.agent-voice@1')); }

/** Say it: agent-voice@1, else AmberX native speak, else Web Speech. Resolves when done (estimated for agent-voice). */
export async function speakOut(text: string, { agentVoice = false, lang = 'en-US' } = {}): Promise<void> {
  if (!text) return;
  const w = win();
  if (agentVoice && w) {
    window.dispatchEvent(new CustomEvent('axf:agent-voice.say', { detail: { agentId: OWNER, agentName: 'Plan Studio', text } }));
    const words = text.split(/\s+/).length;
    await new Promise((r) => setTimeout(r, Math.min(30_000, 600 + words * 380)));
    const synth = w.speechSynthesis as SpeechSynthesis | undefined;
    for (let i = 0; i < 60 && synth?.speaking; i += 1) await new Promise((r) => setTimeout(r, 250));
    return;
  }
  const n = nativeVoice();
  if (n) { await n.speak({ text, lang }).catch(() => undefined); return; }
  const synth = w?.speechSynthesis as SpeechSynthesis | undefined;
  const U = w?.SpeechSynthesisUtterance as (new (t: string) => SpeechSynthesisUtterance) | undefined;
  if (!synth || !U) return;
  await new Promise<void>((done) => { const u = new U(text); u.lang = lang; u.onend = () => done(); u.onerror = () => done(); synth.speak(u); });
}
