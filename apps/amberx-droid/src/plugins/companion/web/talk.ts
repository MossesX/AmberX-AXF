/**
 * Talk mode for the companion: push-to-talk and hands-free on AmberX's existing listener (native.listen / the
 * hands-free `heard` events), spoken replies as they stream (sentence by sentence, claude-session `readyToSpeak`), and
 * interrupt-to-stop: while Gizmo talks, anything Brett says that isn't Gizmo's own voice coming back (voice plugin's
 * `heardEcho`) and is a stop word (`isInterrupt`) stops speech at once. The microphone goes through the page's
 * mic lease (mic-lease@1) like every other AmberX listener.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { isInterrupt, readyToSpeak, sentences, speakable } from '../../../axf/libs/claude-session';
import { withMic } from '../../../miclease';
import { native } from '../../../native';
import { mayMakeSound } from '../../../sound';
import { heardEcho } from '../../voice/web';
import { K } from './keys';

export type TalkPhase = 'off' | 'listening' | 'thinking' | 'speaking';
interface TalkState { on: boolean; phase: TalkPhase; heard: string }
let state: TalkState = { on: false, phase: 'off', heard: '' };
const subs = new Set<() => void>();
const set = (p: Partial<TalkState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useTalk = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
export const talkState = () => state;

const lang = (rt: AxfRuntime) => { const v = rt.settings.get('amberx.voice.lang'); return typeof v === 'string' && v ? v : 'en-US'; };
const rate = (rt: AxfRuntime) => { const v = Number(rt.settings.get(K.rate)); return Number.isFinite(v) && v >= 0.5 && v <= 2 ? v : 1; };

/* ---------------------------------------------------------------- speaking */

let queue: string[] = [];
let speaking = false;
let spokenUpTo = 0;
let sayN = 0;
let stopped = false;
const waiting = new Map<string, () => void>();
let spokenSub: Promise<{ remove: () => Promise<void> }> | null = null;

function bindSpoken() {
  spokenSub ??= native.addListener('spoken', ({ id }) => { waiting.get(id)?.(); }) as unknown as Promise<{ remove: () => Promise<void> }>;
}

async function speakOne(rt: AxfRuntime, text: string) {
  const id = `companion-say-${++sayN}`;
  const done = new Promise<void>((res) => {
    const t = setTimeout(() => { waiting.delete(id); res(); }, 1500 + text.length * 90);
    waiting.set(id, () => { clearTimeout(t); waiting.delete(id); res(); });
  });
  const voice = rt.settings.get(K.voice);
  // holdMic only when talking over it can't stop it: with interrupt on, the listener stays open (echo is filtered).
  await native.speak({ text, lang: lang(rt), id, rate: rate(rt), ...(typeof voice === 'string' && voice ? { voice } : {}), holdMic: rt.settings.get(K.interrupt) === false });
  await done;
}

async function pump(rt: AxfRuntime) {
  if (speaking) return;
  speaking = true;
  bindSpoken();
  try {
    while (queue.length && !stopped) {
      set({ phase: 'speaking' });
      await speakOne(rt, queue.shift()!).catch(() => undefined);
    }
  } finally {
    speaking = false;
    if (state.phase === 'speaking') set({ phase: state.on ? 'listening' : 'off' });
    if (state.on && !stopped) void listenNext(rt);
  }
}

/** Speak what's ready of a streaming reply (call on every update; `done` on the last). New reply = `reset()` first. */
export function speakStreaming(rt: AxfRuntime, text: string, done: boolean) {
  if (stopped || rt.settings.get(K.speak) === false || !mayMakeSound()) return;
  const r = readyToSpeak(text, spokenUpTo, done);
  spokenUpTo = r.upTo;
  const said = speakable(r.chunk);
  if (said) { queue.push(...sentences(said)); void pump(rt); }
}
/** A new reply: forget what was said of the last one. */
export function resetSpeech() { spokenUpTo = 0; queue = []; stopped = false; }

/** Stop talking now (the stop button, an interrupt, leaving talk mode). */
export function stopSpeaking() {
  stopped = true;
  queue = [];
  void native.stopSpeaking().catch(() => undefined);
  waiting.forEach((f) => f());
  if (state.phase === 'speaking') set({ phase: state.on ? 'listening' : 'off' });
}

/* ---------------------------------------------------------------- listening */

let send: ((text: string) => void) | null = null;
let heardSub: Promise<{ remove: () => Promise<void> }> | null = null;

/** Hands-free `heard` events: show what is heard, stop on an interrupt while speaking, send a final phrase in talk mode. */
function bindHeard(rt: AxfRuntime) {
  heardSub ??= native.addListener('heard', ({ text, final }) => {
    if (!state.on) return;
    const echo = heardEcho(text ?? '');
    if (state.phase === 'speaking') {
      if (!echo && rt.settings.get(K.interrupt) !== false && isInterrupt(text ?? '')) stopSpeaking();
      return;
    }
    if (echo) return;
    set({ heard: text ?? '' });
    if (final && state.phase === 'listening' && rt.settings.get(K.handsFree) !== false && (text ?? '').trim()) { set({ phase: 'thinking' }); send?.(text.trim()); }
  }) as unknown as Promise<{ remove: () => Promise<void> }>;
}

/** One utterance through the native recognizer (push-to-talk, or the next turn when hands-free isn't listening). */
async function listenNext(rt: AxfRuntime) {
  if (!state.on || state.phase === 'thinking' || speaking) return;
  set({ phase: 'listening', heard: '' });
  try {
    const { text } = await withMic('companion', () => native.listen({ lang: lang(rt), prompt: 'Talk to Gizmo…' }));
    if (!state.on) return;
    const t = (text ?? '').trim();
    if (!t || heardEcho(t)) { if (rt.settings.get(K.handsFree) !== false) setTimeout(() => void listenNext(rt), 400); else set({ phase: 'listening' }); return; }
    set({ heard: t, phase: 'thinking' });
    send?.(t);
  } catch (e) {
    rt.toast(e instanceof Error ? e.message : String(e), 'warning', 'Gizmo');
    set({ phase: 'listening' });
  }
}

/** Push-to-talk: one utterance now (works with talk mode off too). */
export async function pushToTalk(rt: AxfRuntime, onText: (t: string) => void) {
  stopSpeaking();
  try {
    const { text } = await withMic('companion', () => native.listen({ lang: lang(rt), prompt: 'Talk to Gizmo…' }));
    const t = (text ?? '').trim();
    if (t && !heardEcho(t)) onText(t);
  } catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'warning', 'Gizmo'); }
}

/** Talk mode on: listen, send what's heard, speak the reply, listen again. */
export function startTalk(rt: AxfRuntime, onText: (t: string) => void) {
  send = onText;
  resetSpeech();
  set({ on: true, phase: 'listening', heard: '' });
  bindHeard(rt);
  void listenNext(rt);
}
export function stopTalk() {
  set({ on: false, phase: 'off', heard: '' });
  stopSpeaking();
  send = null;
}
/** The reply finished (or failed): talk mode listens again once speech ends. */
export function replyDone(rt: AxfRuntime) {
  if (!state.on) return;
  if (!speaking && !queue.length) { set({ phase: 'listening' }); void listenNext(rt); }
}
export function replyStarted() { if (state.on) set({ phase: 'thinking' }); }

/** `companion.talk` (voice command, menu): the chat view starts talk mode when it shows (now, or when it mounts). */
let talkWanted = false;
export function requestTalk() { talkWanted = true; window.dispatchEvent(new CustomEvent('axf:companion.talk')); }
export function takeTalkRequest(): boolean { const w = talkWanted; talkWanted = false; return w; }

/** The device's voices for the voice picker. */
export async function voices(): Promise<{ id: string; name: string; lang: string }[]> {
  try { return (await native.ttsVoices()).voices; } catch { return []; }
}
/** Say a sample in the picked voice (Settings → Voice → Try it). */
export async function sample(rt: AxfRuntime) { resetSpeech(); await speakOne(rt, "Hey Brett, it's Gizmo. Say less, I'm on it.").catch(() => undefined); }
