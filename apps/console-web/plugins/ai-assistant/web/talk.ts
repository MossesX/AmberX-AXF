/**
 * Voice chat for the AI assistant in the browser (Gizmo's talk mode, moved from AmberX, Nov 10 2026): Web Speech
 * recognition listens one utterance at a time, what was heard is sent as the next message, and the reply is spoken
 * sentence by sentence as it streams (claude-session `readyToSpeak`). Hands-free keeps listening after each reply;
 * push-to-talk listens once. While the assistant talks, a stop word ("stop", "wait"…) cuts it off; nothing else said
 * over it is sent. AmberX's native talk service (screen off, notification) stays in AmberX; this is the console half.
 * A browser without speech recognition gets a plain message instead of a dead button.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { isInterrupt, readyToSpeak, speakable } from '@console/axf/libs/claude-session';

export const TALK_KEYS = {
  speak: 'ai-assistant.talk.speak',
  speakAlways: 'ai-assistant.talk.speakAlways',
  handsFree: 'ai-assistant.talk.handsFree',
  interrupt: 'ai-assistant.talk.interrupt',
  rate: 'ai-assistant.talk.rate',
  lang: 'ai-assistant.talk.lang',
} as const;

export type TalkPhase = 'off' | 'listening' | 'thinking' | 'speaking';
export interface TalkState { on: boolean; phase: TalkPhase; heard: string; note: string }
let state: TalkState = { on: false, phase: 'off', heard: '', note: '' };
const subs = new Set<() => void>();
const set = (p: Partial<TalkState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useTalk = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
export const talkState = () => state;

interface Recognition { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
type RecognitionCtor = new () => Recognition;
const Ctor = (): RecognitionCtor | null => {
  const g = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
};
export const canListen = () => !!Ctor();
export const canSpeak = () => typeof globalThis.speechSynthesis !== 'undefined';

const lang = (rt: AxfRuntime) => { const v = rt.settings.get(TALK_KEYS.lang); return typeof v === 'string' && v ? v : (navigator.language || 'en-US'); };
const rate = (rt: AxfRuntime) => { const v = Number(rt.settings.get(TALK_KEYS.rate)); return Number.isFinite(v) && v >= 0.5 && v <= 2 ? v : 1; };

/* ---------------------------------------------------------------- speaking */

let spokenUpTo = 0;
let speakingCount = 0;
export function resetSpeech() { spokenUpTo = 0; }
export function stopSpeaking() {
  if (canSpeak()) globalThis.speechSynthesis.cancel();
  speakingCount = 0;
  if (state.on && state.phase === 'speaking') afterSpeech();
}
/** Speak what is ready of a streaming reply (whole sentences); `done` flushes the rest. */
export function speakStreaming(rt: AxfRuntime, text: string, done: boolean) {
  if (!canSpeak()) return;
  const { chunk, upTo } = readyToSpeak(text, spokenUpTo, done);
  spokenUpTo = upTo;
  const say = speakable(chunk).trim();
  if (!say) { if (done && !speakingCount && state.on) afterSpeech(); return; }
  const u = new SpeechSynthesisUtterance(say);
  u.rate = rate(rt);
  u.lang = lang(rt);
  speakingCount++;
  if (state.on) { set({ phase: 'speaking' }); if (rt.settings.get(TALK_KEYS.interrupt) !== false) listenForStop(rt); }
  u.onend = u.onerror = () => { speakingCount = Math.max(0, speakingCount - 1); if (!speakingCount && done) afterSpeech(); };
  globalThis.speechSynthesis.speak(u);
}

/* ---------------------------------------------------------------- listening */

let rec: Recognition | null = null;
let onHeard: ((text: string) => void) | null = null;
let rtRef: AxfRuntime | null = null;

function listenOnce(rt: AxfRuntime, then: (text: string) => void, interim = true) {
  const C = Ctor();
  if (!C) { set({ note: "This browser can't listen (no speech recognition). Use Chrome or Edge, or AmberX on the phone." }); return; }
  rec?.abort();
  const r = new C();
  rec = r;
  r.lang = lang(rt); r.interimResults = interim; r.continuous = false;
  let final = '';
  r.onresult = (e) => {
    let partial = '';
    for (let i = 0; i < e.results.length; i++) { const res = e.results[i]!; const t = res[0]?.transcript ?? ''; if (res.isFinal) final += t; else partial += t; }
    set({ heard: (final || partial).trim() });
  };
  r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { set({ note: 'The microphone is blocked for this site. Allow it in the browser, then try again.' }); stopTalk(); } };
  r.onend = () => { if (rec === r) rec = null; then(final.trim()); };
  try { r.start(); } catch { /* already started */ }
}

function listenForStop(rt: AxfRuntime) {
  if (rec || !Ctor()) return;
  listenOnce(rt, (t) => {
    if (state.phase !== 'speaking') return;
    if (t && isInterrupt(t)) stopSpeaking();
    else if (speakingCount) listenForStop(rt);
  }, false);
}

function listenTurn() {
  const rt = rtRef;
  if (!rt || !state.on) return;
  set({ phase: 'listening', heard: '' });
  listenOnce(rt, (t) => {
    if (!state.on || state.phase !== 'listening') return;
    if (!t) { listenTurn(); return; } // silence: keep listening
    set({ phase: 'thinking', heard: t });
    onHeard?.(t);
  });
}

function afterSpeech() {
  if (!state.on) return;
  if (rtRef?.settings.get(TALK_KEYS.handsFree) === false) { set({ phase: 'listening', heard: '', note: 'Tap the mic to talk.' }); return; }
  listenTurn();
}

/** Talk mode on: listen, send what is heard, speak the reply, listen again (hands-free). */
export function startTalk(rt: AxfRuntime, heard: (text: string) => void) {
  if (!canListen()) { set({ note: "This browser can't listen (no speech recognition). Use Chrome or Edge, or AmberX on the phone." }); return; }
  rtRef = rt; onHeard = heard;
  set({ on: true, note: '' });
  listenTurn();
}
export function stopTalk() {
  rec?.abort(); rec = null;
  if (canSpeak()) globalThis.speechSynthesis.cancel();
  speakingCount = 0;
  set({ on: false, phase: 'off', heard: '' });
}
/** One utterance, then it is sent (talk mode stays as it was). */
export function pushToTalk(rt: AxfRuntime, heard: (text: string) => void) {
  stopSpeaking();
  listenOnce(rt, (t) => { if (t) heard(t); set({ heard: '' }); });
}
/** A reply started: talk mode waits for it. */
export function replyStarted() { if (state.on) set({ phase: 'thinking' }); }
/** A reply finished: when nothing is being said, talk mode listens again. */
export function replyDone() { if (state.on && !speakingCount && state.phase !== 'speaking') afterSpeech(); }

/** Ask an open chat to start talk mode (the action `ai-assistant.talk`, the voice command, ?talk=1). */
let talkRequested = false;
export function requestTalk() { talkRequested = true; window.dispatchEvent(new Event('axf:ai-assistant.talk')); }
export function takeTalkRequest() { const r = talkRequested; talkRequested = false; return r; }
