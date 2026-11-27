/**
 * Demonstration Designer: the web model. One store (topics, demos, settings, what a deep link asked for, the
 * record-by-doing session) and the calls to the plugin's own server routes; the pure rules are ../engine.mjs, shared
 * with the CLI and the server so every surface behaves the same.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';
import * as E from '../engine.mjs';
import type { PitchData, PitchFacts, PitchPlan, PitchStep, RecordEvent, Settings, SettingsPatch, Topic } from '../engine.mjs';

export const FOLDER = 'demonstration-designer';
export const PLUGIN_ID = 'ai.amberx.axf.console.demonstration-designer';
export const VIEW = 'demonstration-designer';
export const SETTINGS_TAB = 'demonstration-designer';
/** The settings interface layout picked in UI Review (one of ../assets/settings/*.json). */
export const SETTINGS_VIEW_KEY = 'axf.demonstration-designer.settings.view';
/** The page layout picked in UI Review (one of ../assets/settings/demonstration-designer-page-*.json). */
export const PAGE_VIEW_KEY = 'axf.demonstration-designer.page.view';
export const api = pluginApi(FOLDER, 'Demonstration Designer');

export interface Summary { id: string; name: string; description: string; steps: number; seconds: number; minutes: number; topic: string; topicLabel: string; narrator: string; chain: string[]; clips: number; updatedAt: string }
export interface DemoRecord { $axf: 'asset@1'; type: 'demonstration'; id: string; name: string; version: string; description: string; author?: string; tags?: string[]; data: PitchData; updatedAt?: string; pitch?: PitchFacts & { plan?: PitchPlan } }
export interface MediaRow { id: string; name: string; demo: string; video: string; seconds: number; recordedAt: string; mp4: boolean }
export interface Walk { $axf: 'walkthrough@1'; id: string; title: string; app: string; steps: PitchStep[]; parts?: string[] }
export interface Uploaded { clip: string; file: string; bytes: number; keywords: number; mp4?: string; note?: string }

interface State {
  topics: Topic[]; registry: Topic[]; topicsLoaded: boolean;
  demos: Summary[]; demosLoaded: boolean;
  settings: Settings; settingsLoaded: boolean;
  error: string;
  /** what `?axf-demo=` or a `pitch.open` action asked for; the page takes it */
  wanted: { id: string; play: boolean } | null;
  recording: boolean; events: RecordEvent[];
  /** cloud narrator voices (axf.speech@1 through GET narrators); why = the reason there are none */
  narrators: Narrator[]; narratorsLoaded: boolean; narratorsWhy: string;
}
let st: State = { topics: [], registry: [], topicsLoaded: false, demos: [], demosLoaded: false, settings: E.normalizeSettings({}), settingsLoaded: false, error: '', wanted: null, recording: false, events: [], narrators: [], narratorsLoaded: false, narratorsWhy: '' };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const useModel = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
export const getModel = () => st;

/* ---------------- topics: the registry (rich) merged with the live search index (complete) ---------------- */

export async function loadTopics(rt: AxfRuntime, force = false) {
  if (st.topicsLoaded && !force) return;
  let registry = st.registry;
  try { registry = (await api.call<{ items: Topic[] }>('registry')).items.map((t) => E.normalizeTopic(t)); } catch (e) { set({ error: (e as Error).message }); }
  const live = E.topicsFromSearch(rt.search.entries() as unknown as unknown[]);
  set({ registry, topics: E.mergeTopics(registry, live), topicsLoaded: true });
}
export const findTopic = (id: string) => st.topics.find((t) => t.id === id);

/* ---------------- demos ---------------- */

export async function loadDemos(force = false) {
  if (st.demosLoaded && !force) return;
  try { set({ demos: (await api.call<{ items: Summary[] }>('demos')).items, demosLoaded: true, error: '' }); } catch (e) { set({ error: (e as Error).message, demosLoaded: true }); }
}
export const getDemo = (id: string) => api.call<DemoRecord>(`demo?id=${encodeURIComponent(id)}`);
export async function generate(topic: string, opts: { minutes?: number; voice?: string; speed?: number; save?: boolean } = {}): Promise<DemoRecord> {
  const a = await api.post('generate', { topic, ...opts }) as DemoRecord;
  if (opts.save !== false) await loadDemos(true);
  return a;
}
export async function saveDemo(asset: DemoRecord): Promise<DemoRecord> { const a = await api.post('demo', { asset }) as DemoRecord; await loadDemos(true); return a; }
export async function deleteDemo(id: string) { await api.del(`demo?id=${encodeURIComponent(id)}`); await loadDemos(true); }
export async function applyScript(id: string, text: string): Promise<DemoRecord> { const a = await api.post('script', { id, text }) as DemoRecord; await loadDemos(true); return a; }
export async function setChain(id: string, chain: string[]): Promise<Summary> { const s = await api.post('chain', { id, chain }) as Summary; await loadDemos(true); return s; }
export const walkthroughOf = (id: string) => api.call<Walk>(`walkthrough?id=${encodeURIComponent(id)}`);
export const shareOf = (id: string) => api.call<{ id: string; path: string; play: string; url: string; view: string }>(`share?id=${encodeURIComponent(id)}`);

/* ---------------- settings (pitch-settings@1, kept on the server so the API and the CLI see the same values) ---------------- */

export async function loadSettings(force = false) {
  if (st.settingsLoaded && !force) return;
  try { set({ settings: E.normalizeSettings(await api.call('settings')), settingsLoaded: true }); } catch (e) { set({ error: (e as Error).message, settingsLoaded: true }); }
}
export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const s = E.normalizeSettings(await api.post('settings', patch));
  set({ settings: s, settingsLoaded: true });
  return s;
}

/* ---------------- recordings ---------------- */

export const listMedia = () => api.call<{ items: MediaRow[] }>('media').then((r) => r.items);
export async function uploadMedia(id: string, blob: Blob, seconds: number): Promise<Uploaded> {
  const mime = (blob.type || 'video/webm').split(';')[0]!;
  const r = await api.fetch(`media?id=${encodeURIComponent(id)}&seconds=${encodeURIComponent(String(Math.round(seconds * 10) / 10))}&mime=${encodeURIComponent(mime)}`, { method: 'POST', body: blob, headers: { 'Content-Type': mime } });
  const j = (await r.json().catch(() => ({}))) as Uploaded & { detail?: string };
  if (!r.ok) throw new Error(j.detail || `upload failed (${r.status})`);
  await loadDemos(true);
  return j;
}
export const exportMp4 = (clip: string) => api.post('export', { clip }) as Promise<{ clip: string; mp4: string; ffmpeg: string; already?: boolean }>;
export const mediaBlob = (name: string) => api.blob(`media/file?name=${encodeURIComponent(name)}`);

/* ---------------- deep links and actions hand the page what to open ---------------- */

export const want = (id: string, play = false) => set({ wanted: { id, play } });
export const takeWanted = () => { const w = st.wanted; if (w) set({ wanted: null }); return w; };

/* ---------------- record by doing (the Advanced section) ---------------- */

let stopRecord: (() => void) | null = null;

/** Start a session: every screen change and every tap on a control becomes an event (the engine turns them into steps). */
export function startRecording(rt: AxfRuntime) {
  if (stopRecord) return;
  set({ recording: true, events: [] });
  let lastView = rt.getState().view;
  const push = (e: RecordEvent) => set({ events: [...st.events, e].slice(0, 200) });
  const unsub = rt.subscribe(() => {
    const v = rt.getState().view;
    if (v && v !== lastView) {
      lastView = v;
      const label = rt.search.entries().find((e) => e.kind === 'view' && (e.focus as { view?: string }).view === v)?.label ?? v;
      push({ kind: 'nav', view: v, label });
    }
  });
  const onClick = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement | null;
    const el = t?.closest<HTMLElement>('button, a, [role="tab"], [data-fx-row], .fx-switch, .fx-checkrow');
    if (!el || el.closest('.axp-demonstration-designer, .axp-demonstration-designer-stage')) return;
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (label) push({ kind: 'click', label, target: `text=${label}` });
  };
  document.addEventListener('click', onClick, true);
  stopRecord = () => { unsub(); document.removeEventListener('click', onClick, true); stopRecord = null; set({ recording: false }); };
}
export function stopRecording(): RecordEvent[] { stopRecord?.(); return st.events; }
export const clearRecording = () => set({ events: [] });

/* ---------------- cloud narrators (agent voices on the server) ---------------- */

export interface Narrator { value: string; label: string; agentId?: string; provider?: string; voice?: string }
/** A narrator value that speaks through the server (agent:<id>): the audio is mixed into an exported video. */
export const isCloudNarrator = (v: string) => /^agent:/.test(v);
export async function loadNarrators(force = false) {
  if (st.narratorsLoaded && !force) return;
  try {
    const r = await api.call<{ available: boolean; items: Narrator[]; why?: string }>('narrators');
    set({ narrators: r.items ?? [], narratorsLoaded: true, narratorsWhy: r.available ? '' : (r.why ?? '') });
  } catch (e) { set({ narrators: [], narratorsLoaded: true, narratorsWhy: (e as Error).message }); }
}
/** The narrator picker's options: default and captions only, the cloud voices, then this device's voices; the current
 *  value stays listed even when it isn't here. Shared by the page and the settings. */
export function narratorOptions(current: string, device: { value: string; label: string }[], cloud: Narrator[]): { value: string; label: string }[] {
  const out = E.NARRATORS.map((n) => ({ value: n.value, label: n.label }));
  const seen = new Set(out.map((o) => o.value));
  for (const v of [...cloud.map((c) => ({ value: c.value, label: c.label })), ...device]) if (!seen.has(v.value)) { seen.add(v.value); out.push(v); }
  if (current && !seen.has(current)) out.push({ value: current, label: isCloudNarrator(current) ? `${current.slice(6)} (cloud voice not set up)` : `${current} (not on this device)` });
  return out;
}
/** One line in a cloud narrator voice, as mp3 bytes. */
export async function narrate(narrator: string, text: string, speed: number): Promise<ArrayBuffer> {
  const r = await api.fetch('narrate', { method: 'POST', body: JSON.stringify({ narrator, text, speed }), headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) { let why = `${r.status}`; try { const j = await r.json() as { detail?: string }; if (j.detail) why = j.detail; } catch { /* not json */ } throw new Error(why); }
  return r.arrayBuffer();
}

/* ---------------- narrator voices this browser has ---------------- */

export function deviceVoices(): { value: string; label: string }[] {
  try {
    const synth = globalThis.speechSynthesis;
    if (!synth) return [];
    return synth.getVoices().filter((v) => /^en/i.test(v.lang) || v.default).slice(0, 40).map((v) => ({ value: v.name, label: `${v.name} (${v.lang})${v.localService ? '' : ' · online'}` }));
  } catch { return []; }
}

export const fmtSeconds = E.fmtSeconds;
