/**
 * Build docs — the browser's store: the builds the right-click menus offer (index), the jobs, the dialog choices.
 * The server is the only source; this keeps what the menus need synchronously (contextExtras can't wait).
 */
import { useSyncExternalStore } from 'react';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'build-docs';
export const ID = 'ai.amberx.axf.console.build-docs';
export const VIEW = 'build-docs';
export const api = pluginApi(FOLDER, 'Build docs');

export interface StepRef { id: string; text: string; done: boolean }
export interface BuildRef { id: string; title: string; status: string; profile: string; branch: string; pr: string; planId: string; pendingId: string; steps: StepRef[] }
export interface Target { build: string; step: string }
export interface JobOutputs {
  docs: { path: string; build: string; url: string }[]; pr: { number: number; url: string; branch: string } | null;
  video: string; captions: string; poster: string; script: string; transcript: string; duration: number; plans: string[];
}
export interface Job {
  id: string; kind: 'docs' | 'video'; title: string; targets: Target[]; options: Record<string, unknown>; state: string; progress: number;
  message: string; mode: string; by: string; rerunOf: string; createdAt: string; updatedAt: string; finishedAt: string; cancel: boolean;
  log: { at: string; text: string }[]; outputs: JobOutputs;
}
export interface Scene { say: string; do: { op: string; [k: string]: unknown }[] }
export interface Chapter { id: string; title: string; url?: string; scenes: Scene[] }
export interface Script { title: string; chapters: Chapter[]; length: number; speed: number; [k: string]: unknown }
export interface Options {
  docs: Record<string, unknown>; video: Record<string, unknown>;
  audiences: { id: string; label: string; about: string }[]; depths: { id: string; label: string }[];
  lengths: { id: number; label: string }[]; lengthRange: { min: number; max: number };
  viewports: string[]; voices: string[]; speedRange: { min: number; max: number };
  themes: { id: string; label: string }[]; layouts: { id: string; label: string }[];
}

export const ACTIVE = ['queued', 'gathering', 'writing', 'planning', 'recording', 'rendering', 'publishing'];
export const FINAL = ['done', 'failed', 'cancelled'];
export const STATE_LABEL: Record<string, string> = {
  queued: 'Queued', gathering: 'Reading the build', writing: 'Writing', planning: 'Planning the script', 'script-ready': 'Script ready — approve it',
  recording: 'Recording', rendering: 'Rendering', publishing: 'Publishing', done: 'Done', failed: 'Failed', cancelled: 'Cancelled',
};

interface State { builds: BuildRef[]; plans: Record<string, string>; changes: Record<string, string>; focus: string; jobs: Job[]; options: Options | null; loaded: boolean; error: string }
let st: State = { builds: [], plans: {}, changes: {}, focus: '', jobs: [], options: null, loaded: false, error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const getState = () => st;
export const useStore = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

/** Built enough to document: built / complete, or any step done (a step: that step done). */
export function documentable(b: BuildRef | undefined, step = ''): boolean {
  if (!b) return false;
  if (step) return b.steps.some((s) => s.id === step && s.done);
  return b.status === 'built' || b.status === 'complete' || b.steps.some((s) => s.done);
}
export const findBuild = (id: string) => st.builds.find((b) => b.id === id);
export const targetKey = (t: Target) => (t.step ? `${t.build}/${t.step}` : t.build);
export function parseTarget(s: string): Target | null {
  const [build, step = ''] = String(s ?? '').split('/');
  return build ? { build, step } : null;
}

export async function loadIndex(): Promise<void> {
  try {
    const r = await api.call<{ builds: BuildRef[]; plans?: Record<string, string>; changes?: Record<string, string> }>('index');
    set({ builds: r.builds ?? [], plans: r.plans ?? {}, changes: r.changes ?? {}, loaded: true, error: '' });
  } catch (e) { set({ error: (e as Error).message, loaded: true }); }
}
export async function loadOptions(): Promise<Options | null> {
  if (st.options) return st.options;
  try { const o = await api.call<Options>('options'); set({ options: o }); return o; } catch (e) { set({ error: (e as Error).message }); return null; }
}
export async function loadJobs(): Promise<void> {
  try { const r = await api.call<{ jobs: Job[] }>('jobs'); set({ jobs: r.jobs ?? [], error: '' }); } catch (e) { set({ error: (e as Error).message }); }
}
/** Open this job on the Docs & videos page (a plan's Docs link, a search hit). */
export function setFocus(id: string) { set({ focus: id }); }
export const jobById = (id: string) => st.jobs.find((j) => j.id === id);
export function putJob(j: Job) { set({ jobs: [j, ...st.jobs.filter((x) => x.id !== j.id)] }); }

/** Poll the jobs: every few seconds while anything runs (or a dialog watches one), else once a minute. */
let timer: ReturnType<typeof setTimeout> | null = null;
let watchers = 0;
export function watch(): () => void {
  watchers += 1;
  if (!timer) tick();
  return () => { watchers = Math.max(0, watchers - 1); };
}
function tick() {
  const busy = st.jobs.some((j) => ACTIVE.includes(j.state));
  timer = setTimeout(async () => {
    if (document.visibilityState === 'visible' && (watchers > 0 || busy)) await loadJobs();
    tick();
  }, busy || watchers > 0 ? 4000 : 60_000);
}

/* ---------------- actions ---------------- */

export async function createDocs(targets: Target[], options: Record<string, unknown>): Promise<Job> {
  const r = await api.post<{ job: Job }>('docs', { targets: targets.map(targetKey), options });
  putJob(r.job); return r.job;
}
export async function createVideo(targets: Target[], options: Record<string, unknown>): Promise<Job> {
  const r = await api.post<{ job: Job }>('video', { targets: targets.map(targetKey), options });
  putJob(r.job); return r.job;
}
export async function getJob(id: string): Promise<{ job: Job; script: Script | null; docs: { key: string; path: string; text: string }[] }> {
  const r = await api.call<{ job: Job; script: Script | null; docs: { key: string; path: string; text: string }[] }>(`job?id=${encodeURIComponent(id)}`);
  putJob(r.job); return r;
}
export async function editScript(id: string, edits: { lines: Record<string, string>; remove: string[] }): Promise<Script> {
  return (await api.post<{ script: Script }>('script', { id, edits })).script;
}
export async function approve(id: string): Promise<string> {
  const r = await api.post<{ job: Job; message: string }>('approve', { id }); putJob(r.job); return r.message;
}
export async function cancel(id: string): Promise<void> { const r = await api.post<{ job: Job }>('cancel', { id }); putJob(r.job); }
export async function rerun(id: string, tweaks: { options?: Record<string, unknown>; targets?: string[] }): Promise<Job> {
  const r = await api.post<{ job: Job }>('rerun', { id, tweaks }); putJob(r.job); return r.job;
}
export async function removeJob(id: string): Promise<void> { await api.post('remove', { id }); set({ jobs: st.jobs.filter((j) => j.id !== id) }); }
export async function featuresFor(t: Target): Promise<{ id: string; label: string; group: string }[]> {
  try { return (await api.call<{ features: { id: string; label: string; group: string }[] }>(`source?target=${encodeURIComponent(targetKey(t))}`)).features ?? []; } catch { return []; }
}
export const fileUrl = (id: string, name: string) => `file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
export async function fileBlob(id: string, name: string): Promise<string> { return URL.createObjectURL(await api.blob(fileUrl(id, name))); }
export async function download(id: string, name: string, as: string): Promise<void> { await api.download(fileUrl(id, name), as); }
