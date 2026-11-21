/**
 * The lander (lander@1, deploy/lander/run.mjs on the VPS; it replaced the auto-lander@1 runner on Nov 19 2026) as the
 * gate page sees it: the REST answer's types, its paths, and the build whose row is open (deep links `row:<build>` and
 * the gate.auto-lander.open action land here). Every row is read from the builds store: the lander keeps no state.
 */
export type LanderStatus = 'build-complete' | 'merging-pr' | 'pr-pulling-main' | 'running-ci' | 'merging-main' | 'landed' | 'failed' | string;
export interface LanderFailure { kind: string; status: string; why: string; head: string; pr: number; at: string; retry: 'rerun' | 'split' | 'fix' | 'pull-main' | 'same'; notBefore: string; failing?: string[]; fix?: { at: string; session: string; head: string } }
export interface LanderPr { pr: number; steps: string[]; state: 'open' | 'merged' | 'closed' }
export interface LanderStep { id: string; status: string; prNumber: number | null; model: string; slot: number | null }
export interface AutoLanderBuild { build: string; title: string; status: LanderStatus; attempt: number; failure: LanderFailure | null; statusAt: string; prs: LanderPr[]; waiting: string[]; steps: LanderStep[]; can?: { retry: boolean; fix: boolean } }
export interface AutoLanderSettings { enabled: boolean; sizeCapLines: number; flakyReruns: number; backoffBaseMin: number; backoffFactor: number; backoffMaxMin: number; ciNoneKickMin: number; ciTimeoutMin: number; fixTimeoutMin: number; notifyAfterAttempts: number; workflow: string; mergeMethod: string }
export interface AutoLanderStatus {
  at?: string;
  /** `state` (up, down, paused) and `can` are decided by the lander, never here */
  service: { lastTick: string; result: string; build: string; error: string; paused: boolean; pausedBy: string; pausedAt: string; up?: boolean; state?: 'up' | 'down' | 'paused' };
  can?: { run: boolean; pause: boolean; resume: boolean };
  current: string; queue: string[]; settings: AutoLanderSettings; builds: AutoLanderBuild[];
  failing: { build: string; attempt: number; kind: string; why: string; since: string; pr: number | null }[];
  escalations: never[];
}
export interface AutoLanderBuildDetail { build: string; status: string; attempt: number; failure: LanderFailure | null; statusLog: { status: string; at: string; by: string; attempt?: number; note?: string }[] }

/** A REST path under the gate plugin: auto-lander[/sub]. */
export const autoLanderPath = (sub = ''): string => `auto-lander${sub ? `/${sub}` : ''}`;

type Listener = (build: string) => void;
const listeners = new Set<Listener>();
let wanted = '';
/** Open one build's attempt log in the Auto-lander tab (it may not be mounted yet: it reads takeAutoLanderBuild). */
export function showAutoLanderBuild(build: string): void { wanted = build; for (const l of listeners) l(build); }
export function takeAutoLanderBuild(): string { const b = wanted; wanted = ''; return b; }
export function onShowAutoLanderBuild(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
