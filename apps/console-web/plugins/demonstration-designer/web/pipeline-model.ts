/**
 * Pipelines mode of the Demonstration Designer: the web store. The demo list, the one demo playing, its timeline, the
 * player (pure rules in ../pipelines.mjs playerReduce; this file only runs the clock), the console following each
 * chapter to its screen (focus mode), the behind-the-scenes panel (lines played so far, filter, dock) and live runs
 * (the server runs the chapter probes for real on the test-sandbox data and answers the recording).
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import * as P from '../pipelines.mjs';
import type { Dock, Mode, Player, PlayerAction, PipelineDemo, PipelineSummary, Timeline, TimelineEvent } from '../pipelines.mjs';
import { VIEW, api } from './model';

export type DesignerMode = 'pitch' | 'pipelines';
export interface PipelinesState {
  mode: DesignerMode;
  demos: PipelineSummary[]; loaded: boolean; error: string;
  /** the demo open in the page (selected or being edited) */
  open: string;
  /** the demo the player has, its timeline and when its recording was made ('' = the script) */
  demo: PipelineDemo | null; timeline: Timeline | null; recordedAt: string;
  player: Player;
  /** the behind-the-scenes panel */
  kinds: string[]; q: string; follow: boolean; panel: boolean;
  /** a live run is on the server */
  running: boolean; note: string;
}
const KEY_DOCK = 'axf.demonstration-designer.pipelines.dock';
let rt: AxfRuntime | null = null;
let st: PipelinesState = { mode: 'pitch', demos: [], loaded: false, error: '', open: '', demo: null, timeline: null, recordedAt: '', player: P.playerInit(), kinds: [], q: '', follow: true, panel: true, running: false, note: '' };
const subs = new Set<() => void>();
const set = (p: Partial<PipelinesState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const usePipelines = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
export const getPipelines = () => st;
export const setMode = (mode: DesignerMode) => set({ mode });
export const setOpen = (open: string) => set({ open });

/* ---------------- the list and one demo (REST over pipeline-demos.mjs) ---------------- */

export async function loadPipelines(force = false) {
  if (st.loaded && !force) return;
  try { set({ demos: (await api.call<{ items: PipelineSummary[] }>('pipelines')).items, loaded: true, error: '' }); } catch (e) { set({ error: (e as Error).message, loaded: true }); }
}
export const getPipeline = (id: string) => api.call<PipelineDemo>(`pipeline?id=${encodeURIComponent(id)}`);
export async function savePipeline(demo: PipelineDemo): Promise<PipelineDemo> { const d = await api.post('pipeline', { demo }) as PipelineDemo; await loadPipelines(true); return d; }
export async function copyPipeline(id: string, as = ''): Promise<PipelineDemo> { const d = await api.post('pipeline/copy', { id, as }) as PipelineDemo; await loadPipelines(true); return d; }
export async function deletePipeline(id: string) { await api.del(`pipeline?id=${encodeURIComponent(id)}`); await loadPipelines(true); }

/* ---------------- the player ---------------- */

let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let lastChapter = -1;

function dispatch(a: PlayerAction) {
  if (!st.timeline) return;
  const before = st.player;
  const player = P.playerReduce(before, a, st.timeline);
  set({ player });
  if (player.status === 'playing' && !timer) { last = performance.now(); timer = setInterval(tick, 200); }
  if (player.status !== 'playing' && timer) { clearInterval(timer); timer = null; }
  follow();
}
function tick() {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  dispatch({ type: 'tick', dt });
}

/** Focus mode: when the player enters a chapter that names a screen, the console moves there and outlines the element. */
function follow() {
  if (!st.timeline || !rt || st.player.status === 'idle') return;
  const i = P.chapterAt(st.timeline, st.player.at);
  if (i === lastChapter) return;
  lastChapter = i;
  const c = st.timeline.chapters[i];
  if (!c?.view || !st.follow) return;
  const known = rt.search.entries().some((e) => e.kind === 'view' && (e.focus as { view?: string } | undefined)?.view === c.view);
  if (!known && c.view !== 'home') { set({ note: `${P.screenLabel(c.view)} isn't installed in this console; the walkthrough stays here.` }); return; }
  rt.navigate(c.view);
  if (c.selector) setTimeout(() => { try { document.querySelector(c.selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* a bad selector shows nothing */ } }, 400);
}

/** Load a demo into the player: replay plays the recording of the last live run when there is one, else the script. */
export async function loadPlayer(id: string, opts: { recorded?: boolean } = {}) {
  const r = await api.call<{ demo: PipelineDemo; timeline: Timeline; recordedAt: string }>(`pipeline/timeline?id=${encodeURIComponent(id)}${opts.recorded === false ? '&script=1' : ''}`);
  stopTimer();
  lastChapter = -1;
  set({ demo: r.demo, timeline: r.timeline, recordedAt: r.recordedAt, player: P.playerInit({ id, speed: st.player.speed, dock: st.player.dock, mode: st.player.mode }), note: '' });
  return r;
}

/** Play a demo: mode replay (instant, offline) or live (the probes run for real first, then the recording plays). */
export async function runPipeline(id: string, opts: { mode?: Mode; speed?: number } = {}) {
  const mode = opts.mode ?? st.player.mode;
  if (opts.speed) set({ player: { ...st.player, speed: opts.speed } });
  set({ player: { ...st.player, mode }, panel: true });
  if (mode === 'live') {
    set({ running: true, note: 'Running the probes for real on the test-sandbox project…' });
    try { await api.post('pipeline/live', { id }); set({ note: '' }); } catch (e) { set({ note: `The live run failed (${(e as Error).message}); playing the script instead.` }); } finally { set({ running: false }); }
  }
  await loadPipelines(true);
  await loadPlayer(id);
  dispatch({ type: 'play' });
}

export const pPlay = () => dispatch({ type: st.player.status === 'done' ? 'restart' : 'play' });
export const pPause = () => dispatch({ type: 'pause' });
export const pResume = () => dispatch({ type: 'resume' });
export const pToggle = () => dispatch({ type: 'toggle' });
export const pNext = () => dispatch({ type: 'next' });
export const pPrev = () => dispatch({ type: 'prev' });
export const pChapter = (index: number) => dispatch({ type: 'chapter', index });
export const pRestart = () => { lastChapter = -1; dispatch({ type: 'restart' }); };
export const pSpeed = (speed: number) => { if (st.timeline) dispatch({ type: 'speed', speed }); else set({ player: { ...st.player, speed } }); };
export const pMode = (mode: Mode) => set({ player: { ...st.player, mode } });
export function pDock(dock: Dock) { set({ player: { ...st.player, dock }, panel: true }); try { rt?.settings.set(KEY_DOCK, dock); } catch { /* settings unavailable */ } }
function stopTimer() { if (timer) clearInterval(timer); timer = null; }
export function pStop() { stopTimer(); lastChapter = -1; set({ player: P.playerInit({ speed: st.player.speed, dock: st.player.dock, mode: st.player.mode }), demo: null, timeline: null }); }

/* ---------------- the behind-the-scenes panel ---------------- */

export const setKinds = (kinds: string[]) => set({ kinds });
export const toggleKind = (k: string) => set({ kinds: st.kinds.includes(k) ? st.kinds.filter((x) => x !== k) : [...st.kinds, k] });
export const setQuery = (q: string) => set({ q });
export const setFollow = (follow: boolean) => set({ follow });
export const setPanel = (panel: boolean) => set({ panel });
/** The lines played so far that the filter keeps. */
export function visibleLines(s: PipelinesState = st): TimelineEvent[] {
  if (!s.timeline) return [];
  return P.filterEvents(P.eventsUntil(s.timeline, s.player.at), { kinds: s.kinds, q: s.q });
}

/** What the API reads (console state of this feature). */
export function pipelineState() {
  const tl = st.timeline;
  const i = tl ? P.chapterAt(tl, st.player.at) : -1;
  return { mode: st.mode, demo: st.demo?.id ?? '', status: st.player.status, at: Math.round(st.player.at * 10) / 10, total: tl?.total ?? 0, speed: st.player.speed, playMode: st.player.mode, dock: st.player.dock, panel: st.panel, chapter: i >= 0 ? { index: i, id: tl!.chapters[i]!.id, title: tl!.chapters[i]!.title, view: tl!.chapters[i]!.view } : null, lines: visibleLines().length, kinds: st.kinds, q: st.q, follow: st.follow, recordedAt: st.recordedAt };
}

export function registerPipelines(runtime: AxfRuntime) {
  rt = runtime;
  try { const d = runtime.settings.get(KEY_DOCK); if (typeof d === 'string' && (P.DOCKS as readonly string[]).includes(d)) set({ player: { ...st.player, dock: d as Dock } }); } catch { /* defaults */ }
}
export const openDesignerOnPipelines = (id = '') => { set({ mode: 'pipelines', ...(id ? { open: id } : {}) }); rt?.navigate(VIEW); };
