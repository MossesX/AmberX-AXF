/** Claude handoff: one plugin-wide store (status, prompt, claude.ai list), polled every 5 min while visible + on focus. */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'claude-handoff';
export const ID = 'ai.amberx.axf.console.claude-handoff';
export const VERSION = '0.2.0';
export const VIEW = 'claude-handoff';
export const api = pluginApi(FOLDER, 'The Claude handoff plugin');

export interface Changes { added: string[]; changed: string[]; removed: string[]; count: number }
export interface Machine { host: string; collectedAt: string; files: number; inKit: boolean }
export interface Status {
  kit: { generatedAt: string; commit: string; fingerprint: string; files: number } | null;
  fingerprint: string; current: boolean; changes: Changes; machines: Machine[];
  claudeAi: { items: number; memory: boolean; updatedAt: string }; sources: number; head: string; branch: string;
  state: { lastPublishedAt?: number; lastPublishSha?: string; lastAssembledAt?: number };
  reminder: { open: boolean; everyHours: number; lastRemindedAt?: number; dueAt: number; reason: string };
  config: Config; canPublish: boolean;
}
export interface Config { remindHours: number; onlyWhenChanged: boolean; autoPublish: boolean; collectConsole: boolean; context: string[] }
export interface ClaudeItem { id: string; kind: string; name: string; url: string; notes: string; recreate: string }
export interface ClaudeAi { items: ClaudeItem[]; memory: string; projectInstructions: string; updatedAt?: string }
export interface Assembled { prompt: string; current: boolean; note: string; published: { pushed?: boolean; sha?: string } | null }
/** How the installer's run went (sent when it finishes, kept with the last assembly). */
export interface RunSummary { elapsed: number; read: number; written: number; filesDone: number; failed: string; log: string[] }
/** The last assembly on this console (GET last-assembly): its result, the plan its installer walked and the run. */
export interface LastAssembly { at: number; result: Assembled & { kit?: Status['kit'] }; plan: import('./installer-core').Plan | null; run: RunSummary | null }

interface State { status: Status | null; error: string; busy: '' | 'publish' | 'assemble' | 'preview' | 'save'; assembled: Assembled | null; bannerHidden: boolean }
let st: State = { status: null, error: '', busy: '', assembled: null, bannerHidden: false };
const subs = new Set<() => void>();
export const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const getStore = () => st;
export const useStore = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

let rt: AxfRuntime | null = null;
const toast = (text: string, tone: 'success' | 'info' | 'warning' | 'danger' = 'info') => rt?.toast(text, tone, 'Claude handoff');

let checking = false;
export async function refresh(): Promise<void> {
  if (checking) return;
  checking = true;
  try { set({ status: await api.call<Status>('status'), error: '' }); }
  catch (e) { set({ error: (e as Error).message }); }
  finally { checking = false; }
}

export async function publish(): Promise<void> {
  set({ busy: 'publish' });
  try {
    const r = await api.post<{ pushed: boolean; sha?: string; files: number }>('publish', {});
    toast(r.pushed ? `Kit published (${r.sha}, ${r.files} files)` : 'GitHub already has this kit', 'success');
  } catch (e) { toast((e as Error).message, 'danger'); }
  finally { set({ busy: '' }); await refresh(); }
}

/** The button: make the kit current on GitHub, then show the prompt and copy it. */
export async function assemble(copy = true): Promise<void> {
  set({ busy: 'assemble' });
  try {
    const r = await api.post<Assembled>('assemble', { publish: true });
    set({ assembled: r });
    if (copy) await navigator.clipboard?.writeText(r.prompt).then(() => toast('Prompt copied: paste it into a new session on the new account', 'success'), () => undefined);
    if (r.note) toast(r.note, 'warning');
  } catch (e) { toast((e as Error).message, 'danger'); }
  finally { set({ busy: '' }); await refresh(); }
}

export async function dismissReminder(): Promise<void> {
  set({ bannerHidden: true });
  try { await api.post('reminder/dismiss', {}); } catch { /* the banner stays hidden here; the server retries in 6 h */ }
  await refresh();
}

let started = false;
export function start(runtime: AxfRuntime): void {
  rt = runtime;
  if (started) return;
  started = true;
  void refresh();
  window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5 * 60_000);
  window.addEventListener('focus', () => { if (Date.now() - lastFocus > 60_000) { lastFocus = Date.now(); void refresh(); } });
}
let lastFocus = Date.now();

export const ago = (ms?: number | string): string => {
  if (!ms) return 'never';
  const t = typeof ms === 'string' ? Date.parse(ms) : ms;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};
export const until = (ms: number): string => {
  const m = Math.round((ms - Date.now()) / 60000);
  if (m <= 0) return 'now';
  return m < 60 ? `in ${m} min` : `in ${Math.round(m / 6) / 10} h`;
};
