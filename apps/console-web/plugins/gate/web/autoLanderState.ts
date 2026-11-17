/**
 * The server auto-lander (auto-lander@1, framework/spec/AUTO-LANDER.md) as the gate page sees it: the REST answer's
 * types, its paths, and the build whose attempt log is open (deep links `row:<build>`, the gate.auto-lander.open
 * action and the escalation banner's link all land here).
 */
export type AutoLanderState = 'waiting' | 'merging-main' | 'fixing' | 'ci-running' | 'landing' | 'landed' | 'escalated';
export interface AutoLanderAttempt { build: string; kind: 'clash' | 'red-ci' | 'land'; n: number; account: string; session: string; branch: string; head: string; pr: number; result: 'started' | 'ok' | 'failed' | 'timeout' | 'skipped'; log: string; at: string; endedAt: string }
export interface AutoLanderCount { attempts: number; ok: number; failed: number; timeout: number; skipped: number; started: number; failures: number }
export interface AutoLanderBuild {
  build: string; pr: number; branch: string; head: string; state: AutoLanderState; since: string; reason: string;
  escalation: { at: string; kind: string; attempts: number; why: string } | null;
  last: { action: string; waitReason: string; notBefore: string; at: string } | null;
  count: Record<'clash' | 'red-ci' | 'land', AutoLanderCount> & { total: number };
  attempts: AutoLanderAttempt[];
}
export interface AutoLanderSettings { enabled: boolean; maxAttempts: number; backoffBaseMin: number; backoffFactor: number; backoffMaxMin: number; attemptTimeoutMin: number; pushOnEscalation: boolean }
export interface AutoLanderStatus {
  at: string;
  service: { up: boolean; lastTick: string; minutesSinceTick: number | null; mode: string; paused: boolean; pausedBy: string; pausedAt: string };
  current: string; queue: string[]; settings: AutoLanderSettings; builds: AutoLanderBuild[]; escalated: string[];
  escalations: { build: string; pr: number; kind: string; attempts: number; why: string; since: string; log: string }[];
}
export interface AutoLanderBuildDetail { build: string; record: AutoLanderBuild | null; attempts: AutoLanderAttempt[]; count: AutoLanderBuild['count'] }

/** A REST path under the gate plugin: auto-lander[/sub]. */
export const autoLanderPath = (sub = ''): string => `auto-lander${sub ? `/${sub}` : ''}`;

type Listener = (build: string) => void;
const listeners = new Set<Listener>();
let wanted = '';
/** Open one build's attempt log in the Auto-lander tab (it may not be mounted yet: it reads takeAutoLanderBuild). */
export function showAutoLanderBuild(build: string): void { wanted = build; for (const l of listeners) l(build); }
export function takeAutoLanderBuild(): string { const b = wanted; wanted = ''; return b; }
export function onShowAutoLanderBuild(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
