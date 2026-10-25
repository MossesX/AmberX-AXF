// Types for history.mjs (the view imports it from TypeScript).
import type { Row } from './merge.mjs';

export interface ChangeSummary {
  id: string; title: string; kind: string; model: string; state: string; createdAt: string; updatedAt: string;
  steps: { total: number; done: number; failed: number; running: string }; result: { state: string; summary: string } | null; closed: string | null;
  repos: string[]; where: string; status?: string; buildRef?: { kind: string; id: string }; surface?: string; host?: string;
  startedAt?: string; finishedAt?: string; lastSeenAt?: string; estimate?: { minutes?: number; costUsd?: number };
  actual?: { minutes?: number; costUsd?: number; inputTokens?: number; outputTokens?: number; source?: string }; costEstimated?: boolean;
  branch?: string; areas?: string[]; parent?: string; progress?: number; doing?: string; verify?: { state: string; summary?: string };
  commits?: string[]; links?: Record<string, string>; asked?: string; session?: string; user?: string;
}
export interface ChangeLive {
  id: string; changeId: string; title: string; state: string; activityState: string; startedAt: number; finishedAt: number; url: string; source: string;
  surface: string; host: string; model: string; modelRaw: string; runningStep: string; doing: string; progress: number | null; row: Row | null; via: string;
  estimate: number | null; elapsed: number | null; currentStep: string; over: number; costEstimate: number | null; costActual: number | null;
  stepsDone: number; stepsTotal: number; stale: boolean; lastSeenAt: number; branch: string; areas: string[]; parent: string;
}
export interface BuiltRow {
  id: string; title: string; model: string; modelRaw: string; status: string; resultState: string; at: number; day: string; week: string; surface: string; host: string;
  minutes: number | null; minutesEstimated: boolean; cost: number | null; costEstimated: boolean; tokens: number | null; branch: string; commits: string[];
  links: Record<string, string>; ref: { kind: string; id: string } | null; verify: string; summary: string; repos: string[]; kind: string;
}
export type SessionItemStatus = 'running' | 'queued' | 'done' | 'failed' | 'question' | 'stalled';
export interface SessionItem {
  id: string; title: string; kind: string; asked: string; status: SessionItemStatus; resultState: string; summary: string; model: string; modelRaw: string;
  at: number; finishedAt: number; minutes: number | null; minutesEstimated: boolean; cost: number | null; costEstimated: boolean; tokens: number | null;
  stepsDone: number; stepsTotal: number; branch: string; ref: { kind: string; id: string } | null; repos: string[]; commits: string[]; parent: string; surface: string;
}
export interface SessionRow {
  key: string; kind: 'recorded' | 'backfill' | 'unrecorded'; session: string; label: string; host: string; surface: string; surfaceLabel: string; where: string; user: string;
  models: string[]; model: string; firstAt: number; lastAt: number; day: string; count: number; requests: number; questions: number;
  done: number; failed: number; running: number; stalled: number; status: 'running' | 'stalled' | 'failed' | 'done';
  minutes: number; minutesEstimated: boolean; cost: number; costEstimated: boolean; tokens: number | null; repos: string[]; items: SessionItem[];
  title: string; detail: string; id: string;
}
export interface Total { count: number; minutes: number; cost: number; estimatedCost: number; estimatedMinutes: number }
export type Period = 'all' | '7d' | '30d' | 'week';

export const STALE_MS: number;
export const SURFACE_LABEL: Record<string, string>;
export const PERIODS: Period[];
export const PERIOD_LABEL: Record<Period, string>;
export function modelOf(m: unknown): string;
export function statusOf(s: Partial<ChangeSummary>): string;
export function isStale(s: Partial<ChangeSummary>, now?: number): boolean;
export function figures(s: Partial<ChangeSummary>): { minutes: number | null; minutesEstimated: boolean; cost: number | null; costEstimated: boolean; tokens: number | null };
export function rowFor(s: Partial<ChangeSummary>, rows: Row[]): Row | null;
export function liveFromChanges(summaries: ChangeSummary[], rows?: Row[], now?: number): ChangeLive[];
export function builtRows(summaries: ChangeSummary[]): BuiltRow[];
export function isoWeek(t: number): string;
export function builtTotals(rows: BuiltRow[]): { all: Total; byModel: Record<string, Total>; byWeek: Record<string, Total> };
export function filterBuilt(rows: BuiltRow[], f?: { model?: string; period?: Period; cost?: '' | 'actual' | 'estimated'; surface?: string; status?: string }, now?: number): BuiltRow[];
export const ITEM_STATUS_LABEL: Record<SessionItemStatus, string>;
export function sessionKeyOf(s: Partial<ChangeSummary>, byId?: Map<string, Partial<ChangeSummary>>): string;
export function sessionItem(s: ChangeSummary, now?: number): SessionItem;
export function sessionsFromChanges(summaries: ChangeSummary[], now?: number): SessionRow[];
export function filterSessions(rows: SessionRow[], f?: { model?: string; period?: Period; status?: string; surface?: string; kind?: string }, now?: number): SessionRow[];
export function searchText(x: object): string;
export function matches(query: string, x: object): boolean;
export function money(v: number | null | undefined): string;
