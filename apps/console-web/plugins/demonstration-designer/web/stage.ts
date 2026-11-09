/**
 * The stage: plays a pitch on the console's real screens. A full-screen overlay (plain DOM, appended to the body so
 * it rides over every page the demo opens) with a logo intro, then for each step: the console moves (the step's `do`
 * action), the app zooms and pans to the target, a spotlight (or outline) lands on it with its label, the caption shows
 * the words while the narrator says them (the device voice, or captions only), soft synthesised music plays under it,
 * and a logo outro with the call to action closes. Pause / Next / Stop by button, keyboard (space, arrows, Escape) or
 * the console actions pitch.* (voice through AmberX, MCP, CLI). Export records the tab (getDisplayMedia + MediaRecorder,
 * MP4 where the browser can, WebM otherwise) and hands the file to the page, which uploads it as a clip.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { musicPlan, wordCount } from '../engine.mjs';
import type { MusicPlan, PitchStep, Settings } from '../engine.mjs';
import { PLUGIN_ID } from './model';

export type StageStatus = 'idle' | 'intro' | 'playing' | 'paused' | 'outro';
export interface StageState { status: StageStatus; at: number; total: number; title: string; id: string; recording: boolean; error: string; caption: string }
export interface Playable { id: string; title: string; steps: PitchStep[]; cta?: string; product?: string }
export interface Recorded { blob: Blob; mime: string; seconds: number }
interface PlayOpts { settings: Settings; record?: boolean; from?: number; onDone?: (rec: Recorded | null) => void; onRecordError?: (why: string) => void }

let st: StageState = { status: 'idle', at: 0, total: 0, title: '', id: '', recording: false, error: '', caption: '' };
const subs = new Set<() => void>();
const set = (p: Partial<StageState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const useStage = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
export const stageState = () => st;

let rt: AxfRuntime | null = null;
type Running = Playable & { narrator?: string; speed?: number };
let run: { play: Running; opts: PlayOpts; token: number; paused: boolean; resume: (() => void) | null } | null = null;
let seq = 0;
const CLS = 'axp-demonstration-designer-stage';

/* ---------------- DOM ---------------- */

let root: HTMLElement | null = null;
let spot: HTMLElement | null = null; let logo: HTMLElement | null = null; let caption: HTMLElement | null = null; let progress: HTMLElement | null = null; let bar: HTMLElement | null = null;
let targetEl: Element | null = null; let follow = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.className = cls; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.appendChild(e); return e;
}
function button(parent: HTMLElement, label: string, icon: string, onClick: () => void, tone = 'neutral') {
  const b = el('button', `fx-btn fx-btn--${tone} fx-btn--sm`, parent, { type: 'button', 'data-stage-btn': icon }); b.textContent = label; b.addEventListener('click', onClick); return b;
}

function mount(s: Settings) {
  if (root) return;
  root = el('div', CLS, document.body, { 'data-axf-plugin': PLUGIN_ID, role: 'region', 'aria-label': 'Demonstration stage', 'data-highlight': s.stage.highlight, 'data-captions': s.narration.captionSize });
  progress = el('div', `${CLS}__progress`, root);
  spot = el('div', `${CLS}__spot`, root, { hidden: '' });
  el('span', `${CLS}__spot-label`, spot);
  logo = el('div', `${CLS}__logo`, root, { hidden: '' });
  caption = el('div', `${CLS}__caption`, root, { 'aria-live': 'polite' });
  el('p', `${CLS}__caption-title`, caption); el('p', `${CLS}__caption-say`, caption);
  bar = el('div', `${CLS}__bar`, root, { role: 'toolbar', 'aria-label': 'Demonstration stage' });
  if (!s.stage.controls) bar.hidden = true;
  button(bar, 'Pause', 'pause', () => (st.status === 'paused' ? resume() : pause()));
  button(bar, 'Back', 'back', () => prev());
  button(bar, 'Next', 'next', () => next(), 'primary');
  button(bar, 'Stop', 'stop', () => stop());
  document.addEventListener('keydown', onKey);
}
function unmount() {
  document.removeEventListener('keydown', onKey);
  root?.remove(); root = spot = logo = caption = progress = bar = null;
}
function onKey(e: KeyboardEvent) {
  if (!run || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
  if (e.key === 'Escape') stop();
  else if (e.key === 'ArrowRight') next();
  else if (e.key === 'ArrowLeft') prev();
  else if (e.key === ' ') { e.preventDefault(); if (st.status === 'paused') resume(); else pause(); }
}
function refreshBar() {
  const b = bar?.querySelector<HTMLButtonElement>('[data-stage-btn="pause"]');
  if (b) b.textContent = st.status === 'paused' ? 'Resume' : 'Pause';
}

/* ---------------- zoom, pan, spotlight ---------------- */

const app = () => document.getElementById('root');
function resetView() {
  const a = app(); if (a) { a.style.transform = ''; a.style.transformOrigin = ''; a.style.transition = ''; a.style.willChange = ''; }
  targetEl = null; if (spot) spot.hidden = true; cancelAnimationFrame(follow);
}

/** The element a target names: `text=Label` (a control by its words), data-axf-view / view links, data-axf-id, else a CSS selector. */
export function findTarget(target: string): Element | null {
  const t = target.trim();
  if (!t) return null;
  if (t.startsWith('text=')) {
    const want = t.slice(5).trim().toLowerCase();
    const scope = app() ?? document;
    const els = scope.querySelectorAll<HTMLElement>('button, a, [role="tab"], label, h1, h2, h3, [data-fx-row], .fx-switch, summary');
    let best: HTMLElement | null = null;
    for (const e of els) {
      if (e.closest(`.${CLS}`) || e.closest('[hidden]')) continue;
      const text = (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!text) continue;
      if (text === want) { best = e; break; }
      if (!best && text.startsWith(want)) best = e;
    }
    return best;
  }
  const esc = t.replace(/["\\]/g, '');
  for (const sel of [`[data-axf-id="${esc}"]`, `[data-axf-view-link="${esc.replace(/^view:/, '')}"]`, `[data-view="${esc}"]`, t]) {
    try { const e = document.querySelector(sel); if (e && !e.closest(`.${CLS}`)) return e; } catch { /* not a selector */ }
  }
  return null;
}

/** Zoom the app around a target (capped by the setting) and pan it to the middle; whole screen when none. */
function zoomTo(target: Element | null, s: Settings) {
  const a = app(); if (!a) return;
  a.style.transformOrigin = '0 0';
  a.style.transition = `transform calc(var(--fx-motion) * 6) var(--fx-ease)`;
  a.style.willChange = 'transform';
  if (!target || !s.stage.zoom) { a.style.transform = ''; return; }
  const r = target.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  // undo the current transform to get the untransformed rect
  const m = new DOMMatrix(getComputedStyle(a).transform === 'none' ? '' : getComputedStyle(a).transform);
  const ux = (r.left - m.e) / (m.a || 1), uy = (r.top - m.f) / (m.d || 1), uw = r.width / (m.a || 1), uh = r.height / (m.d || 1);
  const fit = Math.min(vw / Math.max(uw + 160, 1), vh / Math.max(uh + 220, 1));
  const z = Math.max(1, Math.min(s.stage.maxZoom, fit, uw > vw * 0.7 ? 1.15 : 2.5));
  const cx = ux + uw / 2, cy = uy + uh / 2;
  let tx = vw / 2 - cx * z, ty = vh / 2 - cy * z;
  tx = Math.min(0, Math.max(vw - vw * z, tx)); ty = Math.min(0, Math.max(vh - vh * z, ty));
  a.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${z})`;
}

function followTarget() {
  cancelAnimationFrame(follow);
  const tick = () => {
    if (!spot || !targetEl || !targetEl.isConnected) { if (spot) spot.hidden = true; return; }
    const r = targetEl.getBoundingClientRect();
    spot.hidden = false;
    spot.style.left = `${Math.round(r.left)}px`; spot.style.top = `${Math.round(r.top)}px`; spot.style.width = `${Math.round(r.width)}px`; spot.style.height = `${Math.round(r.height)}px`;
    follow = requestAnimationFrame(tick);
  };
  follow = requestAnimationFrame(tick);
}

function showCaption(title: string, say: string, s: Settings) {
  if (!caption) return;
  caption.hidden = !s.narration.captions;
  caption.querySelector('p:first-child')!.textContent = title;
  caption.querySelector('p:last-child')!.textContent = say;
  set({ caption: say });
}
function showLogo(title: string, sub: string, on: boolean) {
  if (!logo) return;
  logo.hidden = !on;
  if (!on) return;
  const svg = rt?.brandPlace('demo-stage', 96)?.svg ?? '';
  logo.innerHTML = '';
  const mark = el('div', `${CLS}__logo-mark`, logo, { 'aria-hidden': 'true' });
  if (svg) mark.innerHTML = svg; else { mark.classList.add(`${CLS}__logo-mark--word`); mark.textContent = title.slice(0, 1).toUpperCase(); }
  el('h2', `${CLS}__logo-title`, logo).textContent = title;
  if (sub) el('p', `${CLS}__logo-sub`, logo).textContent = sub;
}

/* ---------------- speech ---------------- */

function resolveVoice(name: string): SpeechSynthesisVoice | null {
  try { const vs = globalThis.speechSynthesis?.getVoices() ?? []; return vs.find((v) => v.name === name || v.voiceURI === name) ?? null; } catch { return null; }
}
/** Say the words; resolves when done (or after the time the words take when there is no voice / captions only). */
function say(text: string, s: Settings, narrator: string, speed: number): Promise<void> {
  const silent = narrator === 'silent' || !globalThis.speechSynthesis || !text;
  const ms = ((wordCount(text) / s.script.wpm) * 60000) / (speed || 1);
  if (silent) return wait(Math.max(600, ms));
  return new Promise((done) => {
    const synth = globalThis.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = speed; const v = resolveVoice(narrator); if (v) u.voice = v;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; duck(false); done(); };
    u.onend = finish; u.onerror = finish;
    duck(true);
    try { synth.speak(u); } catch { finish(); }
    // some browsers never fire onend for a cancelled voice: the words' own time is the ceiling
    setTimeout(finish, ms * 1.8 + 2500);
  });
}
const hush = () => { try { globalThis.speechSynthesis?.cancel(); } catch { /* fine */ } };

/* ---------------- music (WebAudio, synthesised: no files) ---------------- */

let ctx: AudioContext | null = null; let master: GainNode | null = null; let musicTimer = 0; let voices: OscillatorNode[] = []; let musicLevel = 0; let mixDest: MediaStreamAudioDestinationNode | null = null;
const audio = () => (ctx ??= new AudioContext());
function startMusic(s: Settings) {
  if (!s.music.on || s.music.volume <= 0) return;
  try {
    const c = audio(); if (c.state === 'suspended') void c.resume();
    master = c.createGain(); musicLevel = (s.music.volume / 100) * 0.35; master.gain.value = 0; master.connect(c.destination); if (mixDest) master.connect(mixDest);
    master.gain.linearRampToValueAtTime(musicLevel, c.currentTime + 2);
    const plan: MusicPlan = musicPlan(s.music.mood);
    let i = 0;
    const chord = () => {
      if (!master) return;
      const now = c.currentTime; const len = (60 / plan.bpm) * plan.beat;
      for (const o of voices) { try { o.stop(now + 1.2); } catch { /* ended */ } }
      voices = [];
      for (const f of plan.chords[i % plan.chords.length]!) {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = plan.wave; o.frequency.value = f / 2;
        g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.18 * plan.gain, now + 1.5); g.gain.setValueAtTime(0.18 * plan.gain, now + len - 1.2); g.gain.linearRampToValueAtTime(0, now + len);
        o.connect(g); g.connect(master); o.start(now); o.stop(now + len + 0.1); voices.push(o);
      }
      i++;
      musicTimer = window.setTimeout(chord, len * 1000);
    };
    chord();
  } catch { /* no audio here */ }
}
function stopMusic() {
  clearTimeout(musicTimer);
  if (master && ctx) { try { master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2); } catch { /* fine */ } const m = master; setTimeout(() => { try { m.disconnect(); } catch { /* fine */ } }, 1500); }
  master = null; voices = [];
}
/** Quieter under the narrator. */
function duck(on: boolean) { if (master && ctx) { try { master.gain.linearRampToValueAtTime(on ? musicLevel * 0.35 : musicLevel, ctx.currentTime + 0.4); } catch { /* fine */ } } }

/* ---------------- recording (export) ---------------- */

let recorder: MediaRecorder | null = null; let recChunks: Blob[] = []; let recStream: MediaStream | null = null; let recStart = 0;
export const recordMime = (pref: Settings['export']['format']) => {
  const mp4 = 'video/mp4', webm = 'video/webm;codecs=vp9,opus', webm2 = 'video/webm';
  const ok = (m: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m);
  if (pref === 'mp4' && ok(mp4)) return mp4;
  if (pref === 'webm') return ok(webm) ? webm : webm2;
  return ok(mp4) ? mp4 : ok(webm) ? webm : webm2;
};
async function startRecording(s: Settings): Promise<string> {
  const md = navigator.mediaDevices;
  if (!md?.getDisplayMedia || typeof MediaRecorder === 'undefined') throw new Error('this browser cannot record the screen; try Chrome or Edge');
  const stream = await md.getDisplayMedia({ video: { displaySurface: 'browser' } as MediaTrackConstraints, audio: true, ...({ preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude' } as Record<string, unknown>) });
  const c = audio(); if (c.state === 'suspended') await c.resume();
  mixDest = c.createMediaStreamDestination();
  for (const t of stream.getAudioTracks()) { try { c.createMediaStreamSource(new MediaStream([t])).connect(mixDest); } catch { /* no tab audio */ } }
  const mixed = new MediaStream([...stream.getVideoTracks(), ...mixDest.stream.getAudioTracks()]);
  const mime = recordMime(s.export.format);
  recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  recChunks = []; recStream = stream; recStart = Date.now();
  recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (run) stop(); });
  recorder.start(1000);
  set({ recording: true });
  return mime;
}
function stopRecording(): Promise<Recorded | null> {
  return new Promise((done) => {
    const r = recorder; recorder = null;
    const finish = () => {
      const mime = (r?.mimeType || 'video/webm').split(';')[0]!;
      const blob = new Blob(recChunks, { type: mime });
      recStream?.getTracks().forEach((t) => t.stop()); recStream = null; mixDest = null;
      set({ recording: false });
      done(blob.size ? { blob, mime, seconds: (Date.now() - recStart) / 1000 } : null);
    };
    if (!r || r.state === 'inactive') { finish(); return; }
    r.onstop = finish; try { r.stop(); } catch { finish(); }
  });
}

/* ---------------- the run ---------------- */

const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
/** Waits while paused (resolves when resumed or stopped). */
const gate = () => (run?.paused ? new Promise<void>((ok) => { run!.resume = ok; }) : Promise.resolve());
const alive = (token: number) => run?.token === token;

async function step(i: number, token: number) {
  if (!run || !alive(token)) return;
  const { play, opts } = run; const s = opts.settings;
  const stp = play.steps[i]; if (!stp) return;
  set({ at: i, status: 'playing' });
  if (progress) progress.style.width = `${Math.round(((i + 0.5) / Math.max(1, play.steps.length)) * 100)}%`;
  showLogo('', '', false);
  if (stp.do && rt) { try { rt.dispatch(stp.do); } catch { /* an action that isn't here: the words still play */ } }
  await wait(420); if (!alive(token)) return; await gate(); if (!alive(token)) return;
  targetEl = findTarget(stp.target);
  if (targetEl) { try { (targetEl as HTMLElement).scrollIntoView?.({ block: 'center', behavior: 'smooth' }); } catch { /* fine */ } }
  await wait(targetEl ? 250 : 0);
  if (!alive(token)) return;
  zoomTo(targetEl, s);
  if (spot) { spot.querySelector('span')!.textContent = stp.highlight ?? ''; spot.hidden = !targetEl; }
  followTarget();
  showCaption(stp.title ?? '', stp.say, s);
  if (stp.wait) { await wait(Math.min(stp.wait, 30000)); if (!alive(token)) return; await gate(); if (!alive(token)) return; }
  await say(stp.say, s, play.narrator ?? s.narration.voice, play.speed ?? s.narration.speed);
  if (!alive(token)) return; await gate(); if (!alive(token)) return;
  await wait(700);
  if (!alive(token)) return;
  if (i + 1 < play.steps.length) void step(i + 1, token); else void finish(token);
}

async function finish(token: number) {
  if (!run || !alive(token)) return;
  const { play, opts } = run; const s = opts.settings;
  resetView(); showCaption('', '', s); if (caption) caption.hidden = true;
  if (progress) progress.style.width = '100%';
  if (s.stage.logoOutro) { set({ status: 'outro' }); showLogo(play.product ?? s.script.product, play.cta ?? s.script.cta, true); await wait(s.stage.logoSeconds * 1000); if (!alive(token)) return; }
  await end(true);
}

async function end(completed: boolean) {
  const r = run; run = null;
  hush(); stopMusic(); resetView();
  const rec = st.recording ? await stopRecording() : null;
  unmount();
  set({ status: 'idle', at: 0, total: 0, caption: '', recording: false, error: completed ? '' : st.error });
  r?.opts.onDone?.(rec);
}

/** Play a pitch on the live console. `record` captures the tab for export (the browser asks which tab once). */
export async function play(playable: Running, opts: PlayOpts) {
  if (!rt) { set({ error: 'the stage is not ready yet' }); return; }
  if (run) await end(false);
  const s = opts.settings;
  const token = ++seq;
  run = { play: playable, opts, token, paused: false, resume: null };
  set({ status: 'intro', at: opts.from ?? 0, total: playable.steps.length, title: playable.title, id: playable.id, error: '', recording: false });
  mount(s);
  if (opts.record) {
    try { await startRecording(s); } catch (e) { opts.onRecordError?.((e as Error).message); if (!alive(token)) return; }
    if (!alive(token)) return;
  }
  startMusic(s);
  if (s.stage.logoIntro && !opts.from) { showLogo(playable.product ?? s.script.product, playable.title, true); if (caption) caption.hidden = true; await wait(s.stage.logoSeconds * 1000); if (!alive(token)) return; }
  if (caption) caption.hidden = !s.narration.captions;
  void step(opts.from ?? 0, token);
}

export function pause() { if (!run || run.paused) return; run.paused = true; hush(); try { globalThis.speechSynthesis?.pause(); } catch { /* fine */ } set({ status: 'paused' }); refreshBar(); }
export function resume() { if (!run || !run.paused) return; run.paused = false; set({ status: 'playing' }); refreshBar(); const r = run.resume; run.resume = null; r?.(); }
export function next() { if (!run) return; const i = st.at + 1; if (i >= run.play.steps.length) { void finish(run.token); return; } jump(i); }
export function prev() { if (!run) return; jump(Math.max(0, st.at - 1)); }
function jump(i: number) { if (!run) return; hush(); run.paused = false; run.resume?.(); run.resume = null; run.token = ++seq; refreshBar(); void step(i, run.token); }
export async function stop() { if (run) await end(false); }

export function registerStage(runtime: AxfRuntime) { rt = runtime; }
