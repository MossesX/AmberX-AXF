/**
 * Talk mode for the companion (rebuilt Nov 6 2026, Fable, build gizmo-rebuild-fable).
 *
 * The listening half runs in AmberX's native `TalkService` (a foreground microphone service: `native.talkStart`),
 * so a conversation keeps going with the screen off or AmberX in the background, and its notification's Stop ends it
 * here too. The service listens one utterance at a time and sends `talk` events (what it hears, pauses for a call or
 * another app, stop); this page keeps the conversation, sends what was heard to Gizmo, speaks the reply as it streams
 * (sentence by sentence, claude-session `readyToSpeak`) and tells the service its half of the turn (`talkPhase`:
 * thinking → speaking → listening). In a browser the same calls run Web Speech turns while the tab is open. An older
 * APK without `talkStart` falls back to the first build's loop: one `native.listen` per turn through the mic lease.
 *
 * Interrupt-to-stop: while Gizmo talks the service keeps a turn open (when "Stop talking when I talk over Gizmo" is
 * on); anything heard that isn't Gizmo's own voice coming back (voice plugin `heardEcho`) and is a stop word
 * (`isInterrupt`) stops speech at once, and nothing said over him is sent as a message.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { isInterrupt, readyToSpeak, sentences, speakable } from '../../../axf/libs/claude-session';
import { policyKeys } from '../../../axf/libs/listeners';
import { Subscriptions } from '../../../listeners';
import { withMic } from '../../../miclease';
import { isNative, native, type TalkEvent } from '../../../native';
import { mayMakeSound } from '../../../sound';
import { heardEcho } from '../../voice/web';
import { K } from './keys';

export type TalkPhase = 'off' | 'listening' | 'thinking' | 'speaking' | 'paused';
interface TalkState {
  on: boolean;
  phase: TalkPhase;
  heard: string;
  /** the native service runs it: it keeps going with the screen off, Stop is on the notification */
  background: boolean;
  /** why it is paused (plain words), '' otherwise */
  paused: string;
  /** why it last stopped by itself ('' = it didn't) */
  stopped: string;
}
let state: TalkState = { on: false, phase: 'off', heard: '', background: false, paused: '', stopped: '' };
const subs = new Set<() => void>();
const set = (p: Partial<TalkState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useTalk = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
export const talkState = () => state;

const lang = (rt: AxfRuntime) => { const v = rt.settings.get('amberx.voice.lang'); return typeof v === 'string' && v ? v : 'en-US'; };
const rate = (rt: AxfRuntime) => { const v = Number(rt.settings.get(K.rate)); return Number.isFinite(v) && v >= 0.5 && v <= 2 ? v : 1; };
const interruptOn = (rt: AxfRuntime) => rt.settings.get(K.interrupt) !== false;

/** Which path runs the listening: the native/browser talk service, or the first build's one-utterance loop. */
type Path = 'service' | 'legacy' | null;
let path: Path = null;
const nativeSubs = new Subscriptions();
/** The error Capacitor gives for a method an older APK doesn't have. */
const unimplemented = (msg: string) => /not implemented|not found|unimplemented|is not a function/i.test(msg);

/* ---------------------------------------------------------------- speaking */

let queue: string[] = [];
let speaking = false;
let spokenUpTo = 0;
let sayN = 0;
let stopped = false;
const waiting = new Map<string, () => void>();

function bindSpoken() {
  nativeSubs.bind('spoken', () => native.addListener('spoken', ({ id }) => { waiting.get(id)?.(); }));
}

async function speakOne(rt: AxfRuntime, text: string) {
  const id = `companion-say-${++sayN}`;
  const done = new Promise<void>((res) => {
    const t = setTimeout(() => { waiting.delete(id); res(); }, 1500 + text.length * 90);
    waiting.set(id, () => { clearTimeout(t); waiting.delete(id); res(); });
  });
  const voice = rt.settings.get(K.voice);
  // holdMic only on the legacy path and when talking over it can't stop it: the talk service owns the mic itself,
  // and with interrupt on the listener stays open (echo is filtered).
  const holdMic = path !== 'service' && !interruptOn(rt);
  await native.speak({ text, lang: lang(rt), id, rate: rate(rt), ...(typeof voice === 'string' && voice ? { voice } : {}), holdMic });
  await done;
}

/** Tell the service our half of the turn (nothing on the legacy path or when talk mode is off). */
function phaseToService(phase: 'listening' | 'thinking' | 'speaking', line = '') {
  if (path !== 'service' || !state.on) return;
  void native.talkPhase({ phase, line: line.slice(0, 120) }).catch(() => undefined);
}

async function pump(rt: AxfRuntime) {
  if (speaking) return;
  speaking = true;
  bindSpoken();
  try {
    while (queue.length && !stopped) {
      const next = queue.shift()!;
      if (state.on && state.phase !== 'paused') { set({ phase: 'speaking' }); phaseToService('speaking', next); }
      await speakOne(rt, next).catch(() => undefined);
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

/** A final utterance from either path: an interrupt while speaking, an echo, or the next message for Gizmo. */
function heardFinal(rt: AxfRuntime, text: string): 'sent' | 'interrupt' | 'ignored' {
  const t = (text ?? '').trim();
  const echo = heardEcho(t);
  if (state.phase === 'speaking' || speaking) {
    if (t && !echo && interruptOn(rt) && isInterrupt(t)) { stopSpeaking(); return 'interrupt'; }
    return 'ignored';
  }
  if (!t || echo || state.phase !== 'listening' || !state.on) return 'ignored';
  set({ heard: t, phase: 'thinking' });
  send?.(t);
  return 'sent';
}

/** The talk service's events (native TalkService, or the browser's twin in native.ts). */
function onTalkEvent(rt: AxfRuntime, e: TalkEvent) {
  if (!state.on) return;
  switch (e.kind) {
    case 'started': set({ phase: state.phase === 'off' ? 'listening' : state.phase, paused: '', stopped: '' }); break;
    case 'heard': {
      const text = e.text ?? '';
      if (!e.final) { if (!(state.phase === 'speaking' || speaking) && !heardEcho(text)) set({ heard: text }); break; }
      const r = heardFinal(rt, text);
      // The service went to "thinking" on a final result; nothing sent = listen again now.
      if (r !== 'sent' && state.phase !== 'speaking' && !speaking) phaseToService('listening');
      break;
    }
    case 'paused': set({ phase: 'paused', paused: e.label || 'Paused: the microphone is in use', heard: '' }); break;
    case 'resumed': set({ phase: speaking ? 'speaking' : 'listening', paused: '' }); break;
    case 'error': rt.toast(e.error || 'Talk mode hit an error.', 'warning', 'Gizmo'); break;
    case 'stopped': {
      const why = e.why ?? '';
      const reason = e.reason || e.error || '';
      stopTalkLocal(why === 'app' ? '' : reason || 'Talk mode stopped.');
      if (why && why !== 'app') rt.toast(reason || (why === 'notification' ? 'Talk mode stopped from the notification.' : 'Talk mode stopped.'), why === 'error' || why === 'refused' ? 'warning' : 'info', 'Gizmo');
      break;
    }
  }
}

function bindTalk(rt: AxfRuntime) {
  nativeSubs.bind('talk', () => native.addListener('talk', (e) => onTalkEvent(rt, e)));
}

/** Legacy hands-free `heard` events (an older APK's wake listener while the app is on screen): interrupts while speaking. */
function bindHeard(rt: AxfRuntime) {
  nativeSubs.bind('heard', () => native.addListener('heard', ({ text, final }) => {
    if (!state.on || path === 'service') return;
    if (state.phase === 'speaking') { heardFinal(rt, text ?? ''); return; }
    if (heardEcho(text ?? '')) return;
    set({ heard: text ?? '' });
    if (final && state.phase === 'listening' && rt.settings.get(K.handsFree) !== false && (text ?? '').trim()) heardFinal(rt, text);
  }));
}

/** The legacy path: one utterance through the native recognizer (the next turn when hands-free isn't listening). */
async function listenNext(rt: AxfRuntime) {
  if (!state.on || state.phase === 'thinking' || speaking) return;
  if (path === 'service') { set({ phase: state.phase === 'paused' ? 'paused' : 'listening', heard: '' }); phaseToService('listening'); return; }
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

/** Talk mode on: the service listens (screen off too), what's heard is sent, the reply spoken, then it listens again. */
export function startTalk(rt: AxfRuntime, onText: (t: string) => void) {
  send = onText;
  resetSpeech();
  set({ on: true, phase: 'listening', heard: '', paused: '', stopped: '', background: false });
  bindHeard(rt);
  void (async () => {
    try {
      bindTalk(rt);
      const st = await native.talkStart({ lang: lang(rt), listenWhileSpeaking: interruptOn(rt), sound: rt.settings.get(policyKeys('talk').sound) === true });
      if (!state.on) return;
      path = 'service';
      set({ background: isNative() && st.running });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      nativeSubs.unbind('talk');
      if (unimplemented(msg)) { path = 'legacy'; void listenNext(rt); return; }
      rt.toast(msg, 'warning', 'Gizmo');
      stopTalkLocal(msg);
    }
  })();
}

/** Talk mode off on this side only (the service already stopped, or is being told separately). */
function stopTalkLocal(stoppedWhy = '') {
  set({ on: false, phase: 'off', heard: '', paused: '', background: false, stopped: stoppedWhy });
  stopSpeaking();
  send = null;
  nativeSubs.unbind('talk');
  path = null;
}

/** Leave talk mode: this page and the service (its notification goes). */
export function stopTalk() {
  const wasService = path === 'service';
  stopTalkLocal('');
  if (wasService) void native.talkStop({ reason: 'Stopped in the chat.' }).catch(() => undefined);
}

/** The reply finished (or failed): talk mode listens again once speech ends. */
export function replyDone(rt: AxfRuntime) {
  if (!state.on) return;
  if (!speaking && !queue.length) { if (state.phase !== 'paused') set({ phase: 'listening' }); void listenNext(rt); }
}
export function replyStarted() { if (state.on && state.phase !== 'paused') { set({ phase: 'thinking' }); phaseToService('thinking'); } }

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

/** For tests: which listening path runs (service | legacy | null). */
export const talkPath = () => path;
