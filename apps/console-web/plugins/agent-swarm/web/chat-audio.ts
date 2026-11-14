import * as A from '../../../../../framework/core/engines/chat-audio.mjs';
import type { AudioSettings, Cast, Queue, Utterance } from '../../../../../framework/core/engines/chat-audio.mjs';
import { mentionHits } from './chat-watch.mjs';
import { api } from './ui-types';

/*
 * Group chat audio player (one per device): polls the room for new lines (GET chat/heard), runs them through the
 * chat-audio@1 queue (core/engines/chat-audio.mjs: who is spoken, which voice, in order, never overlapping) and speaks
 * them. The speech engine is the platform's: AmberX's native TTS bridge when the app provides one (background audio,
 * earbuds), else the browser's speechSynthesis. The room's settings are shared (server, every surface); whether this
 * device plays is a device setting (KEYS.device).
 */

export const AUDIO_KEYS = { device: 'agent-swarm.audio.device' } as const;
const FAST = 3000;
const SLOW = 15000;

type Heard = { ok: boolean; error?: string; audio: AudioSettings; casts: unknown[]; cast: string; names: Record<string, string>; chatOn: boolean; last: string; messages: { id: string; from: string; kind: string; text: string }[] };
export type PlayerStatus = { settings: AudioSettings; device: boolean; speaking: Utterance | null; waiting: number; dropped: number; paused: boolean; engine: 'native' | 'browser' | 'none'; error: string };

/** The native bridge AmberX may expose (Capacitor plugin `AxfTts`): speak resolves when the line has been said. */
type NativeTts = { speak(o: { text: string; lang: string; rate: number; pitch: number; volume: number; voice?: string }): Promise<void>; stop(): Promise<void>; voices?(): Promise<{ voices: { name: string; lang: string; gender?: string }[] }> };
const native = (): NativeTts | null => (globalThis as { Capacitor?: { Plugins?: { AxfTts?: NativeTts } } }).Capacitor?.Plugins?.AxfTts ?? null;
const synth = (): SpeechSynthesis | null => (typeof globalThis.speechSynthesis === 'object' ? globalThis.speechSynthesis : null);

let queue: Queue = A.emptyQueue();
let settings: AudioSettings = A.normSettings({});
let casts: unknown[] = [];
let castPick = '';
let names: Record<string, string> = {};
let device = true;
let error = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let skinPick = (): string => '';
let nativeVoices: { name: string; lang: string; gender?: string }[] = [];
const listeners = new Set<() => void>();
let snapshot: PlayerStatus | null = null;

const isMention = (t: string) => mentionHits(t).length > 0;
const engine = (): PlayerStatus['engine'] => (native() ? 'native' : synth() ? 'browser' : 'none');
function emit() { snapshot = null; for (const fn of listeners) fn(); }

export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function status(): PlayerStatus {
  snapshot ??= { settings, device, speaking: queue.speaking, waiting: queue.items.length, dropped: queue.dropped, paused: queue.paused, engine: engine(), error };
  return snapshot;
}

function currentCast(): Cast {
  const ids = casts.map((c) => (c as { id: string }).id);
  const id = A.castId(settings, skinPick(), ids);
  return A.normCast(casts.find((c) => (c as { id: string }).id === id));
}

function deviceVoices(): { name: string; lang: string; gender?: string }[] {
  if (native()) return nativeVoices;
  try { return (synth()?.getVoices() ?? []).map((v) => ({ name: v.name, lang: v.lang })); } catch { return []; }
}

/** Say one line; resolves when it has been said (or failed). */
async function say(u: Utterance): Promise<void> {
  const voice = A.pickDeviceVoice(u.voice, deviceVoices());
  const n = native();
  if (n) { await n.speak({ text: u.text, lang: u.voice.lang, rate: u.voice.rate, pitch: u.voice.pitch, volume: u.volume, ...(voice ? { voice } : {}) }); return; }
  const s = synth(); if (!s) throw new Error('This device has no speech engine.');
  await new Promise<void>((done) => {
    const line = new SpeechSynthesisUtterance(u.text);
    line.lang = u.voice.lang; line.rate = u.voice.rate; line.pitch = u.voice.pitch; line.volume = u.volume;
    const v = voice ? s.getVoices().find((x) => x.name === voice) : undefined; if (v) line.voice = v;
    line.onend = () => done(); line.onerror = () => done();
    s.speak(line);
  });
}

function pump() {
  const r = A.nextUp(queue); queue = r.queue;
  if (!r.next) { emit(); return; }
  emit();
  say(r.next).catch((e: Error) => { error = e.message; }).finally(() => { queue = A.finished(queue); pump(); });
}

async function poll() {
  clearTimeout(timer);
  try {
    const r = await api.call<Heard>(`chat/heard?after=${encodeURIComponent(queue.lastId || '')}`);
    if (!r.ok) throw new Error(r.error ?? 'the group chat could not be read');
    const was = settings.enabled;
    settings = A.normSettings(r.audio); casts = r.casts; castPick = r.cast; names = r.names; error = '';
    if (!queue.lastId || !was || !device) queue = { ...queue, lastId: r.last }; // switching on never reads history
    else if (settings.enabled) queue = A.enqueue(queue, r.messages, settings, currentCast(), names, { isMention });
    queue = A.prune(queue, settings);
    if (!device) queue = { ...queue, items: [] };
    pump();
  } catch (e) { error = (e as Error).message; emit(); }
  timer = setTimeout(() => void poll(), settings.enabled && device ? FAST : SLOW);
}

let started = false;
/** Start the device player (plugin register). `pickSkin` reads the active voice slot (the skin's cast). */
export function start(opts: { device: boolean; skinPick?: () => string }) {
  device = opts.device; if (opts.skinPick) skinPick = opts.skinPick;
  if (started) return; started = true;
  void native()?.voices?.().then((r) => { nativeVoices = r.voices ?? []; }).catch(() => undefined);
  void poll();
}
/** Play (or not) on this device. */
export function setDevice(on: boolean) { device = on; if (!on) stop(); else void poll(); emit(); }
/** Fresh settings from a change made here (no wait for the next poll). */
export function applySettings(s: AudioSettings) { settings = A.normSettings(s); queue = A.prune(queue, settings); if (!settings.enabled) stop(); emit(); void poll(); }
/** Stop: the line being spoken and everything waiting. */
export function stop() { queue = A.clearQueue(queue); try { synth()?.cancel(); } catch { /* fine */ } void native()?.stop().catch(() => undefined); emit(); }
/** Skip the line being spoken; the next one plays. */
export function skip() { try { synth()?.cancel(); } catch { /* fine */ } void native()?.stop().catch(() => undefined); }
export function pause() { queue = { ...queue, paused: true }; try { synth()?.pause(); } catch { /* fine */ } emit(); }
export function resume() { queue = { ...queue, paused: false }; try { synth()?.resume(); } catch { /* fine */ } pump(); }
/** Say a sample line in an agent's voice (the settings' Try button, voice "how does Kat sound"). */
export function sample(agentId: string, text?: string) {
  const name = names[agentId] ?? agentId;
  const u = A.utterance({ id: `sample-${agentId}`, from: agentId, kind: 'banter', text: text ?? `Hey, it's ${name}. This is how I sound in the group chat.` }, { ...settings, enabled: true, sayName: false }, currentCast(), names);
  queue = { ...queue, items: [...queue.items, u] }; pump();
}
/** The cast in force on this device (room pick, else the skin's, else breakroom) and an agent's voice in it. */
export const castInForce = () => A.castId(settings, skinPick(), casts.map((c) => (c as { id: string }).id)) || castPick;
export const voiceOf = (agentId: string) => A.voiceFor(agentId, currentCast(), settings);
