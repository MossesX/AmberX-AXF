/**
 * Agent voice — the speech engines and the speaker (s3).
 *
 *  - device: AmberX's native text-to-speech when the page runs in the AmberX app (Capacitor plugin `AmberxNative`,
 *    reached through globalThis so this console plugin never imports AmberX code), else the browser's Web Speech.
 *  - cloud: the server's /tts (OpenAI or ElevenLabs), played as audio; falls back to the device voice when allowed.
 *
 * The speaker owns one queue for the whole page: replies are narrated chunk by chunk (core.narrate), with the pauses,
 * per-chunk speed and the profile's pitch/volume. Pause / resume / skip / stop work on every engine; `interrupt`
 * decides what a new reply does to the one being spoken. State is one small store the live light, the Assistant
 * title bar and the console all read.
 */
import { pluginFetch } from '@console/plugins';
import { estimateMs, narrate, type Chunk, type Pronunciation, type VoiceProfile } from './core';

export const FOLDER = 'agent-voice';

/* ---------------------------------------------------------------- state */

export interface SpeakerState {
  speaking: boolean;
  paused: boolean;
  listening: boolean;
  agentId: string;
  agentName: string;
  /** the chunk being said */
  line: string;
  index: number;
  total: number;
  queued: number;
  engine: 'device' | 'cloud' | '';
  error: string;
}

const IDLE: SpeakerState = { speaking: false, paused: false, listening: false, agentId: '', agentName: '', line: '', index: 0, total: 0, queued: 0, engine: '', error: '' };
let state: SpeakerState = { ...IDLE };
const subs = new Set<(s: SpeakerState) => void>();
export const speakerState = (): SpeakerState => state;
export function onSpeaker(fn: (s: SpeakerState) => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }
export function setSpeaker(patch: Partial<SpeakerState>): void {
  const next = { ...state, ...patch };
  if (Object.keys(next).every((k) => next[k as keyof SpeakerState] === state[k as keyof SpeakerState])) return;
  state = next;
  subs.forEach((f) => { try { f(state); } catch { /* a listener's problem */ } });
}

/* ---------------------------------------------------------------- the AmberX bridge */

interface NativeVoice { id: string; name: string; lang: string; quality?: number; network?: boolean }
interface NativeTts {
  speak(o: { text: string; lang: string; voice?: string; rate?: number; pitch?: number; volume?: number; id?: string; holdMic?: boolean; queue?: boolean }): Promise<void>;
  stopSpeaking?(): Promise<void>;
  ttsVoices?(): Promise<{ voices: NativeVoice[] }>;
  addListener?(event: 'spoken', fn: (e: { id: string; done: boolean; error?: string }) => void): Promise<{ remove: () => Promise<void> }>;
  micPermission?(): Promise<{ state: 'granted' | 'denied' | 'prompt' }>;
}

/** AmberX's native plugin when this page runs inside the AmberX app, else null. */
export function amberxNative(): NativeTts | null {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const p = cap.Plugins?.AmberxNative as NativeTts | undefined;
  return p && typeof p.speak === 'function' ? p : null;
}

export const isAmberX = (): boolean => amberxNative() !== null;

/* ---------------------------------------------------------------- voices */

export interface DeviceVoice { id: string; name: string; lang: string; local: boolean }

export async function deviceVoices(): Promise<DeviceVoice[]> {
  const nat = amberxNative();
  if (nat?.ttsVoices) {
    try { return (await nat.ttsVoices()).voices.map((v) => ({ id: v.id, name: v.name || v.id, lang: v.lang, local: !v.network })); } catch { /* older AmberX: no list */ }
  }
  const synth = globalThis.speechSynthesis;
  if (!synth) return [];
  const read = () => synth.getVoices().map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
  let list = read();
  if (!list.length) {
    await new Promise<void>((done) => { const t = setTimeout(done, 1200); synth.addEventListener?.('voiceschanged', () => { clearTimeout(t); done(); }, { once: true }); });
    list = read();
  }
  return list;
}

/* ---------------------------------------------------------------- one utterance per engine */

interface Playing { stop(): void; pause?(): void; resume?(): void }
let playing: Playing | null = null;
let nativeListener: Promise<{ remove: () => Promise<void> }> | null = null;
const nativeWaits = new Map<string, () => void>();

function ensureNativeListener(nat: NativeTts) {
  if (nativeListener || !nat.addListener) return;
  nativeListener = nat.addListener('spoken', (e) => { const f = nativeWaits.get(e.id); if (f) { nativeWaits.delete(e.id); f(); } });
}

const sleep = (ms: number, signal: { stopped: boolean }) => new Promise<void>((done) => {
  if (ms <= 0 || signal.stopped) { done(); return; }
  const t = setTimeout(done, ms);
  const check = setInterval(() => { if (signal.stopped) { clearTimeout(t); clearInterval(check); done(); } }, 50);
  setTimeout(() => clearInterval(check), ms + 10);
});

let seq = 0;

async function speakDevice(chunk: Chunk, p: VoiceProfile, holdMic: boolean, signal: { stopped: boolean }): Promise<void> {
  const rate = Math.max(0.3, Math.min(3, p.rate * chunk.rateMul));
  const nat = amberxNative();
  if (nat) {
    ensureNativeListener(nat);
    const id = `av-${++seq}`;
    const done = new Promise<void>((res) => {
      nativeWaits.set(id, res);
      // Older AmberX builds don't send `spoken`: fall back to the estimate (+ slack).
      setTimeout(() => { if (nativeWaits.delete(id)) res(); }, estimateMs([chunk], rate) + (nat.addListener ? 8000 : 400));
    });
    playing = { stop: () => { void nat.stopSpeaking?.(); const f = nativeWaits.get(id); nativeWaits.delete(id); f?.(); } };
    await nat.speak({ text: chunk.text, lang: p.device.lang, voice: p.device.voice || undefined, rate, pitch: p.pitch, volume: p.volume, id, holdMic, queue: false });
    if (!signal.stopped) await done;
    return;
  }
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('This browser has no speech voice.');
  const u = new SpeechSynthesisUtterance(chunk.text);
  u.lang = p.device.lang;
  u.rate = rate;
  u.pitch = p.pitch;
  u.volume = p.volume;
  if (p.device.voice) { const v = synth.getVoices().find((x) => x.voiceURI === p.device.voice || x.name === p.device.voice); if (v) u.voice = v; }
  await new Promise<void>((res, rej) => {
    u.onend = () => res();
    u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? res() : rej(new Error(`speech: ${e.error}`)));
    playing = { stop: () => synth.cancel(), pause: () => synth.pause(), resume: () => synth.resume() };
    synth.speak(u);
  });
}

async function speakCloud(chunk: Chunk, p: VoiceProfile): Promise<void> {
  const r = await pluginFetch(FOLDER, 'tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: p.agentId, text: chunk.text, rate: p.rate * chunk.rateMul }) });
  if (!r.ok) {
    let msg = `cloud voice ${r.status}`;
    try { const j = (await r.json()) as { detail?: string }; if (j.detail) msg = j.detail; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await r.blob());
  try {
    const a = new Audio(url);
    a.volume = p.volume;
    await new Promise<void>((res, rej) => {
      a.onended = () => res();
      a.onerror = () => rej(new Error('the cloud audio would not play'));
      playing = { stop: () => { a.pause(); res(); }, pause: () => a.pause(), resume: () => void a.play() };
      a.play().catch(rej);
    });
  } finally { URL.revokeObjectURL(url); }
}

/** A short two-note chime (Web Audio; no file). */
export async function chime(volume = 0.4): Promise<void> {
  const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (const [i, f] of [660, 880].entries()) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0, now + i * 0.12); g.gain.linearRampToValueAtTime(volume * 0.3, now + i * 0.12 + 0.02); g.gain.linearRampToValueAtTime(0, now + i * 0.12 + 0.11);
      o.connect(g).connect(ctx.destination); o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.12);
    }
    await new Promise((r) => setTimeout(r, 300));
    void ctx.close();
  } catch { /* no audio */ }
}

/* ---------------------------------------------------------------- the speaker */

export interface SpeakJob { profile: VoiceProfile; agentName: string; text: string; global?: Pronunciation[]; holdMic?: boolean; onDone?: () => void }
const queue: SpeakJob[] = [];
let current: { signal: { stopped: boolean; skip: boolean }; job: SpeakJob } | null = null;
let resumeWait: (() => void) | null = null;

/** Say a reply (or anything) in an agent's voice. Returns false when the profile doesn't allow speaking. */
export function speak(job: SpeakJob): boolean {
  if (!job.profile.enabled || !job.profile.permissions.speak || !job.text.trim()) return false;
  const mode = job.profile.interrupt;
  if (current && (mode === 'barge-in' || mode === 'replace')) { queue.length = 0; stopCurrent(); }
  queue.push(job);
  setSpeaker({ queued: queue.length });
  if (!current) void run();
  return true;
}

function stopCurrent() {
  if (!current) return;
  current.signal.stopped = true;
  playing?.stop();
  playing = null;
  resumeWait?.();
}

export function stopSpeaking(): void {
  queue.length = 0;
  stopCurrent();
  setSpeaker({ speaking: false, paused: false, line: '', index: 0, total: 0, queued: 0 });
}

export function skipLine(): void { if (current) { current.signal.skip = true; playing?.stop(); } }

export function pauseSpeaking(): void {
  if (!current || state.paused) return;
  playing?.pause?.();
  setSpeaker({ paused: true });
}

export function resumeSpeaking(): void {
  if (!state.paused) return;
  playing?.resume?.();
  setSpeaker({ paused: false });
  resumeWait?.();
}

async function run(): Promise<void> {
  while (queue.length) {
    const job = queue.shift()!;
    const signal = { stopped: false, skip: false };
    current = { signal, job };
    const chunks = narrate(job.text, job.profile, { agentName: job.agentName, global: job.global, maxChunk: job.profile.engine === 'cloud' ? 900 : 380 });
    let engine: 'device' | 'cloud' = job.profile.engine === 'cloud' && job.profile.permissions.cloud ? 'cloud' : 'device';
    setSpeaker({ speaking: true, paused: false, agentId: job.profile.agentId, agentName: job.agentName, total: chunks.length, index: 0, queued: queue.length, engine, error: '' });
    if (job.profile.narrator.chime) await chime(job.profile.volume);
    for (let i = 0; i < chunks.length && !signal.stopped; i++) {
      const c = chunks[i]!;
      setSpeaker({ line: c.text, index: i + 1 });
      // paused between lines on engines that can't pause mid-line (native): wait here
      while (state.paused && !signal.stopped) await new Promise<void>((r) => { resumeWait = r; });
      resumeWait = null;
      signal.skip = false;
      try {
        if (engine === 'cloud') await speakCloud(c, job.profile);
        else await speakDevice(c, job.profile, job.holdMic !== false, signal);
      } catch (e) {
        if (engine === 'cloud' && job.profile.fallback) {
          engine = 'device';
          setSpeaker({ engine, error: `Cloud voice failed, using the device voice: ${(e as Error).message}` });
          i -= 1;
          continue;
        }
        setSpeaker({ error: (e as Error).message });
        break;
      }
      playing = null;
      if (!signal.skip) await sleep(c.pause, signal);
    }
    current = null;
    job.onDone?.();
  }
  setSpeaker({ speaking: false, paused: false, line: '', index: 0, total: 0, queued: 0 });
}
