/**
 * Hands-free voice (build ai-assistant-in-molly-console-drives-by-api-open, Nov 10 2026; Brett: "Easy to reach, hands
 * free. A setting in AI assistant.").
 *
 * One switch, kept on the console server (`GET|PUT /api/plugins/ai-assistant/hands-free`) so the settings tab, the mic
 * toggle in every chat header, REST, MCP, the CLI and AmberX flip the same thing; every open chat polls it. While it is
 * on, this page listens all the time with the browser's speech recognition:
 *   wake mode   a sentence that starts with a wake word (the assistant's name, "Molly", "Amber", "hey …") is the message
 *   talk mode   every sentence is a message
 * and the words go to the chat window used last through the voice bridge (`axf:assistant.input`, chat.tsx), exactly as
 * the Agent voice plugin's microphone does. Finished replies (`axf:assistant.reply`) are read out loud with the device's
 * speech synthesis unless another voice plugin is already speaking; listening pauses while speaking so the assistant
 * never hears itself. A screen wake lock keeps a phone awake while hands-free is on (browsers stop the recognizer when
 * the screen goes dark; inside the AmberX app the native recognizer keeps going with the screen off).
 *
 * Only the visible page listens (two tabs would send every sentence twice); when the page is hidden the recognizer
 * stops and starts again when it comes back.
 */
import { useSyncExternalStore } from 'react';
import { call, put } from './api';

export interface HandsFree { on: boolean; mode: 'wake' | 'talk'; wakeWords: string[]; speak: boolean; keepScreenOn: boolean }
export interface HandsFreeState {
  cfg: HandsFree;
  /** the recognizer is open right now */
  listening: boolean;
  /** a reply is being read out */
  speaking: boolean;
  /** the browser can't listen (no speech recognition) */
  supported: boolean;
  /** the last sentence heard (for the header's tooltip) */
  heard: string;
  error: string;
  /** the server answered at least once */
  loaded: boolean;
}

export const DEFAULT_HANDS_FREE: HandsFree = { on: false, mode: 'wake', wakeWords: [], speak: true, keepScreenOn: true };
const BUILT_IN_WAKE = ['molly', 'amber', 'assistant'];
const POLL_MS = 20_000;

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start(): void; stop(): void; abort(): void;
};
type RecCtor = new () => Rec;

const recognizer = (): RecCtor | null => {
  const g = globalThis as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
};

let state: HandsFreeState = { cfg: DEFAULT_HANDS_FREE, listening: false, speaking: false, supported: recognizer() !== null, heard: '', error: '', loaded: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (patch: Partial<HandsFreeState>) => { state = { ...state, ...patch }; emit(); };

export const handsFreeState = (): HandsFreeState => state;
export function onHandsFree(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }
export const useHandsFree = (): HandsFreeState => useSyncExternalStore(onHandsFree, handsFreeState, handsFreeState);

/** The assistant's name (status) so "Amber, open the builds" works whatever it is called. */
let assistantName = '';
export function setAssistantName(n: string): void { assistantName = (n || '').trim(); }

/* ---------------------------------------------------------------- the server switch */

let attached = 0;
let poll: ReturnType<typeof setInterval> | null = null;

export async function loadHandsFree(): Promise<HandsFree> {
  try {
    const r = await call<{ handsFree: HandsFree }>('hands-free');
    apply(r.handsFree);
  } catch (e) {
    set({ error: (e as Error).message });
  }
  return state.cfg;
}

/** Change the switch (and anything else) for everyone: saved on the server, applied here at once. */
export async function setHandsFree(change: Partial<HandsFree> & { toggle?: boolean }): Promise<HandsFree> {
  const r = await put<{ handsFree: HandsFree }>('hands-free', change);
  apply(r.handsFree);
  return r.handsFree;
}

function apply(cfg: HandsFree): void {
  const was = state.cfg.on;
  set({ cfg, loaded: true, error: '' });
  if (cfg.on && !was) void begin();
  else if (!cfg.on && was) end();
  else if (cfg.on) void lock();
}

/** A chat window is on screen: follow the switch while it is (polling the server, listening when on). → detach. */
export function attachHandsFree(): () => void {
  attached++;
  if (attached === 1) {
    void loadHandsFree();
    poll = setInterval(() => { if (document.visibilityState === 'visible') void loadHandsFree(); }, POLL_MS);
    window.addEventListener('axf:assistant.reply', onReply);
    document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    attached = Math.max(0, attached - 1);
    if (attached === 0) {
      if (poll) clearInterval(poll); poll = null;
      window.removeEventListener('axf:assistant.reply', onReply);
      document.removeEventListener('visibilitychange', onVisibility);
      end();
    }
  };
}

function onVisibility(): void {
  if (!state.cfg.on) return;
  if (document.visibilityState === 'visible') void begin(); else pause();
}

/* ---------------------------------------------------------------- listening */

let rec: Rec | null = null;
let wanted = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

async function begin(): Promise<void> {
  wanted = true;
  await lock();
  if (document.visibilityState !== 'visible') return;
  listen();
}

function end(): void {
  wanted = false;
  pause();
  unlock();
  stopSpeaking();
}

function pause(): void {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  const r = rec; rec = null;
  if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch { /* already closed */ } }
  if (state.listening) set({ listening: false });
}

function listen(): void {
  if (rec || !wanted || state.speaking) return;
  const Ctor = recognizer();
  if (!Ctor) { set({ supported: false, error: 'This browser has no speech recognition; hands-free listens in Chrome, Edge, Safari and the AmberX app.' }); return; }
  const r = new Ctor();
  r.lang = navigator.language || 'en-US';
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;
  let interim = '';
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      const text = (res[0]?.transcript ?? '').trim();
      if (!text) continue;
      if (res.isFinal) { interim = ''; heard(text); } else interim = text;
    }
    if (interim) set({ heard: interim });
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { set({ error: 'The microphone is blocked for this site; allow it in the browser and switch hands-free on again.' }); wanted = false; pause(); unlock(); return; }
    if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'network') return; // the recognizer ends itself; onend starts it again
    set({ error: `Listening stopped: ${e.error}` });
  };
  r.onend = () => {
    if (rec === r) rec = null;
    set({ listening: false });
    if (wanted && !state.speaking && document.visibilityState === 'visible') restartTimer = setTimeout(listen, 400);
  };
  try { r.start(); rec = r; set({ listening: true, error: '' }); } catch (e) { set({ error: (e as Error).message }); }
}

/** The wake words right now: the owner's list, the assistant's name and the built-in ones. */
export function wakeWords(cfg: HandsFree = state.cfg): string[] {
  return [...new Set([...cfg.wakeWords, assistantName, ...BUILT_IN_WAKE].map((w) => w.trim().toLowerCase()).filter(Boolean))];
}

/**
 * The message in a sentence, or null when it isn't one for us (pure: the tests use it). Wake mode wants a wake word at
 * the start (`hey`/`ok`/`okay` before it is fine), followed by anything; the word itself and a comma go.
 */
export function messageFrom(sentence: string, cfg: HandsFree, words: string[] = wakeWords(cfg)): string | null {
  const s = sentence.trim();
  if (!s) return null;
  if (cfg.mode === 'talk') return s;
  const lower = s.toLowerCase().replace(/^(hey|ok|okay)[,\s]+/, '');
  for (const w of words.sort((a, b) => b.length - a.length)) {
    if (lower === w) return '';
    if (lower.startsWith(`${w} `) || lower.startsWith(`${w},`)) {
      const at = s.length - lower.length;
      return s.slice(at + w.length).replace(/^[,\s]+/, '').trim();
    }
  }
  return null;
}

function heard(sentence: string): void {
  set({ heard: sentence });
  const msg = messageFrom(sentence, state.cfg);
  if (msg === null) return;
  if (msg === '') { ding(); return; } // just the name: we're listening
  window.dispatchEvent(new CustomEvent('axf:assistant.input', { detail: { text: msg, send: true, partial: false } }));
}

/** A short tone when the wake word alone was heard (no reply to read, but the owner knows it landed). */
function ding(): void {
  try {
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.12);
    setTimeout(() => void ctx.close(), 300);
  } catch { /* no audio */ }
}

/* ---------------------------------------------------------------- speaking */

let utterance: SpeechSynthesisUtterance | null = null;

function onReply(e: Event): void {
  const d = (e as CustomEvent<{ text?: string }>).detail;
  if (!state.cfg.on || !state.cfg.speak || !d?.text) return;
  // another voice plugin (Agent voice) may already be reading it: give it a moment, then speak only if nobody is
  setTimeout(() => { if (!globalThis.speechSynthesis?.speaking) speak(d.text!); }, 350);
}

/** Markdown → something a voice can say: no code blocks, links as their text, no list markers or heading marks. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
}

export function speak(text: string): void {
  const synth = globalThis.speechSynthesis;
  const say = speakable(text);
  if (!synth || !say) return;
  stopSpeaking();
  pause(); // never hear ourselves
  const u = new SpeechSynthesisUtterance(say);
  u.lang = navigator.language || 'en-US';
  const done = () => { if (utterance === u) utterance = null; set({ speaking: false }); if (wanted && document.visibilityState === 'visible') restartTimer = setTimeout(listen, 250); };
  u.onend = done; u.onerror = done;
  utterance = u;
  set({ speaking: true });
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (!utterance) return;
  utterance = null;
  try { globalThis.speechSynthesis?.cancel(); } catch { /* nothing to cancel */ }
  set({ speaking: false });
}

/* ---------------------------------------------------------------- the screen stays on */

let sentinel: { release(): Promise<void>; addEventListener?(t: string, f: () => void): void } | null = null;

async function lock(): Promise<void> {
  if (!state.cfg.keepScreenOn || sentinel || document.visibilityState !== 'visible') return;
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener?(t: string, f: () => void): void }> } }).wakeLock;
  if (!wl) return;
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener?.('release', () => { sentinel = null; });
  } catch { sentinel = null; }
}

function unlock(): void {
  const s = sentinel; sentinel = null;
  if (s) void s.release().catch(() => undefined);
}
