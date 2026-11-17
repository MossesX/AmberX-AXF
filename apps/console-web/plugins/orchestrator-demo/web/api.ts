/**
 * Orchestrator demo web client: the plugin's REST routes (the same ones MCP, the CLI and voice call) and a polling hook
 * on GET /state. Every UI piece reads the run from here; nothing in the browser keeps its own copy of the run.
 */
import { useCallback, useEffect, useState } from 'react';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'orchestrator-demo';
export const VIEW = 'orchestrator-demo';
export const DIALOG_START = 'orchestrator-demo.start';
export const DIALOG_SUMMARY = 'orchestrator-demo.summary';
export const MIN_GAP_S = 30;

export const api = pluginApi(FOLDER, 'Orchestrator demo', { unavailable: 'The Orchestrator demo is switched off or its server part is not running.' });

export interface Focus { app: string; route: string; selector: string; address: string; note: string }
export interface OutlineAct { id: string; title: string }
export interface OutlinePart { part: number; title: string; acts: OutlineAct[] }
export interface CheckItem { actId: string; title: string; mark: string; result: '' | 'pass' | 'fail' | 'skipped'; observed: string; error: string }
export interface Caption { n: number; of: number; actId: string; title: string; text: string; focus: Focus; state: string; nextAt: string; countdownMs: number }
export interface Evidence { kind: string; text: string; ref: string }
export interface ActSummary { actId: string; title: string; result: 'pass' | 'fail' | 'skipped' | 'not-run'; observed: string; error: string; evidence: Evidence[]; focus: string }
export interface Summary { state: string; total: number; done: number; pass: number; fail: number; skipped: number; remaining: number; current: string; failed: { actId: string; title: string; observed: string; error: string }[]; durationMs: number; pause: boolean; minGapMs: number; acts?: ActSummary[] }
export interface Run { id: string; title: string; state: string; pause: boolean; cursor: number; nextAt: string; acts: { id: string; title: string }[] }
export interface Settings { pauseBetweenSteps: boolean; minGapMs: number }
export interface DemoState {
  run: Run | null; summary: Summary | null; checklist: CheckItem[]; caption: Caption | null; held: boolean;
  allowed?: string[]; outline: OutlinePart[]; driverAlive?: boolean; testClock?: boolean;
}
export interface Deps { ok: boolean; missing: { id: string; what: string; for: string }[]; reason: string; skipped: string; source: string }
interface StateRes { ok: boolean; state: DemoState; settings?: Settings; deps?: Deps }

export const TERMINAL = ['done', 'stopped'];
export const isLive = (s: DemoState | null) => !!s?.run && !TERMINAL.includes(s.run.state);

/** Every action the UI offers, one REST call each. */
export const demo = {
  state: () => api.call<StateRes>('state'),
  open: (pause?: boolean) => api.post<StateRes>('open', pause === undefined ? {} : { pause }),
  start: (pause?: boolean) => api.post<StateRes>('start', pause === undefined ? {} : { pause }),
  pause: () => api.post<StateRes>('pause'),
  resume: () => api.post<StateRes>('resume'),
  next: () => api.post<StateRes>('next'),
  skip: () => api.post<StateRes>('skip'),
  stop: () => api.post<StateRes>('stop'),
  setPause: (pause: boolean) => api.put<{ ok: boolean; settings: Settings; state: DemoState | null }>('pause-between-steps', { pause }),
  settings: () => api.call<{ ok: boolean; settings: Settings }>('settings'),
  summary: () => api.call<{ ok: boolean; summary: Summary | null; cleanup: unknown }>('summary'),
  deps: () => api.call<{ ok: boolean; deps: Deps }>('deps'),
};

/** The run, polled every `ms` while a run is live (1 s keeps the countdown honest), every `idleMs` otherwise. */
export function useDemoState(ms = 1000, idleMs = ms) {
  const [state, setState] = useState<DemoState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [deps, setDeps] = useState<Deps | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const r = await demo.state(); setState(r.state); if (r.settings) setSettings(r.settings); if (r.deps) setDeps(r.deps); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  const every = isLive(state) ? ms : idleMs;
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), every); return () => clearInterval(t); }, [refresh, every]);
  return { state, settings, deps, error, refresh, setState };
}

/** Run one action, then take its answer as the new state; the error (a plain reason) is returned for the UI to show. */
export async function act(fn: () => Promise<{ state?: DemoState | null }>, set: (s: DemoState) => void): Promise<string> {
  try { const r = await fn(); if (r?.state) set(r.state); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
}
