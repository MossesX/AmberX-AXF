/** Types for build-live.mjs (build-live@1, spec/BUILD-LIVE.md). */

export type LiveKind = 'change' | 'liveness' | 'watchdog' | 'snapshot';
export type Alive = 'alive' | 'stale' | 'dead' | 'unknown' | 'none';
export type LiveState = 'idle' | 'running' | 'stale' | 'broke' | 'done';
export type WatchdogAction = '' | 'none' | 'requeue' | 'retry' | 'retry-other-account' | 'kill-retry' | 'give-up';
export type Cause = '' | 'usage-limit' | 'auth-failed' | 'exit-clean' | 'exit-killed' | 'exit-oom' | 'exit-failed' | 'tmux-missing' | 'pid-gone' | 'stale-heartbeat' | 'starting' | 'live' | 'unknown';
export type ChangeEvent = '' | 'created' | 'steps-added' | 'step-done' | 'status' | 'pr-opened' | 'pr-merged' | 'addendum' | 'cancelled' | 'restored' | 'shipped';

export interface LiveStep { id: string; title: string; phase: string; index: number; total: number }
export interface LiveLastStep { id: string; title: string; doneAt: string }
export interface LiveWatchdog { action: WatchdogAction; attempt: number; note: string; at: string }
export interface LiveStale { action: 'keep' | 'complete' | 'remove'; reason: string }
export interface LiveBroke { at: string; cause: Cause; exit: number | null; signal: string; what: string; recovering: boolean }
export interface LiveChange { event: ChangeEvent; at: string; by: string }

export interface LiveEvent {
  $axf: 'build-live-event@1'; id: string; seq: number; kind: LiveKind; build: string; title: string; at: string; by: string;
  status: string; step: LiveStep | null; lastStep: LiveLastStep | null; alive: Alive; cause: Cause; exit: number | null; signal: string;
  watchdog: LiveWatchdog; stale: LiveStale | null; change: ChangeEvent; everySec: number; note: string;
}
export interface LiveBuildState {
  $axf: 'build-live-state@1'; build: string; title: string; status: string; state: LiveState; step: LiveStep | null; lastStep: LiveLastStep | null;
  alive: Alive; cause: Cause; exit: number | null; signal: string; watchdog: LiveWatchdog; stale: LiveStale | null;
  broke: LiveBroke | null; lastBroke: LiveBroke | null; recovering: boolean; lastChange: LiveChange | null;
  at: string; checkedAt: string; seen: Record<LiveKind, string>; seq: number; events: number; note: string; line: string;
}
export interface LiveSnapshot { $axf: 'build-live-snapshot@1'; at: string; seq: number; everySec: number; builds: LiveBuildState[] }
export interface FoldResult { state: LiveBuildState; changed: boolean; dropped: '' | 'invalid' | 'other-build' | 'replay' | 'older' }

export const SCHEMA: 'build-live@1';
export const EVENT: 'build-live-event@1';
export const STATE: 'build-live-state@1';
export const SNAPSHOT: 'build-live-snapshot@1';
export const VERSION: number;
export const SSE_EVENT: 'build-live';
export const KINDS: readonly LiveKind[];
export const ALIVE: readonly Alive[];
export const STATES: readonly LiveState[];
export const STATE_LABEL: Readonly<Record<LiveState, string>>;
export const LIVE_STATUSES: readonly string[];
export const BROKE_STATUSES: readonly string[];
export const DONE_STATUSES: readonly string[];
export const RECOVERING_ACTIONS: readonly WatchdogAction[];
export const DEFAULT_EVERY_SEC: number;
export const EVERY_SEC_RANGE: readonly [number, number];
export const STALE_PASSES: number;
export const LIVE_RING: number;
export const NOTIFY: Readonly<{ broke: 'build-live.broke' }>;
export const TARGETS: Readonly<{ row: (build: string) => string; dialog: (build: string) => string }>;
export const REGISTRY: Readonly<Record<string, unknown>>;

export function iso(v: unknown): string;
export function eventId(build: string, kind: LiveKind, seq: number): string;
export function aliveOf(cause: string, processAlive?: boolean | null, markedRunning?: boolean): Alive;
export function normEvent(raw: unknown): LiveEvent | null;
export function validateEvent(raw: unknown): string[];
export function stepOf(build: unknown): LiveStep | null;
export function lastStepOf(build: unknown): LiveLastStep | null;
export function livenessEvent(build: unknown, cause: unknown, opts: { seq: number; at?: string; decision?: unknown; stale?: unknown; everySec?: number; markedRunning?: boolean }): LiveEvent | null;
export function changeEvent(build: unknown, buildEvent: unknown, opts: { seq: number; alive?: Alive }): LiveEvent | null;
export function watchdogEvent(build: unknown, recovery: unknown, opts: { seq: number; alive?: Alive }): LiveEvent | null;
export function snapshotEvent(state: unknown, opts: { seq: number; at?: string; everySec?: number }): LiveEvent | null;
export function markedRunning(status: string, alive: string): boolean;
export function stateOf(s: { status?: string; alive?: string; cause?: string; watchdog?: { action?: string } | null }): LiveState;
export function brokeWhat(s: { status?: string; cause?: string; exit?: number | null; signal?: string; watchdog?: LiveWatchdog | null; note?: string }): string;
export function stateLine(s: LiveBuildState): string;
export function emptyState(build: string): LiveBuildState;
export function fold(state: LiveBuildState | null | undefined, raw: unknown): FoldResult;
export function foldAll(events: unknown[], states?: Map<string, LiveBuildState>): Map<string, LiveBuildState>;
export function snapshot(states: Map<string, LiveBuildState> | LiveBuildState[], opts?: { at?: string; seq?: number; everySec?: number }): LiveSnapshot;
export function channelStale(lastLivenessAt: string, now: string, everySec?: number): boolean;
export function jsonSchema(): Record<string, unknown>;
