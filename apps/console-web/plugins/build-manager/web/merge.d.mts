// Types for merge.mjs (the view imports it from TypeScript).
export type Source = 'pending' | 'queue' | 'plan';
export type Origin = 'prompt' | 'auto';
export type Model = 'Fable' | 'Opus' | 'Sonnet';
export type SortKey = 'order' | 'left' | 'model';
export interface Helpers { estimateMinutes(text: unknown): number | null; formatMinutes(min: number | null | undefined): string; cost?(model: string, minutes: number): number | null }
export interface Step { text: string; estimate: number | null; estimateText: string; done: boolean; doneAt: string }
export interface Timing { total: number | null; left: number | null; stepsDone: number; stepsTotal: number; needsSplit: boolean; estimateText: string }
export interface Row extends Timing {
  key: string; id: string; source: Source; title: string; detail: string; model: Model; status: string; statusLabel: string; order: number;
  /** Who added it: a person's prompt or a tool; addedBy = the pending item's `source` key (addedByKey), or 'build-queue' / 'plan-feature'. */
  origin: Origin; addedBy: string;
  steps: Step[]; planId?: string; queuePosition?: number; effort?: string; features?: { id: string; title: string; status: string }[];
  building: boolean; startedAt: number; fable: boolean; aliases: string[];
  /** Set when the list thinks it's already built or removed (the Clean up button). */
  gone?: { kind: GoneKind; why: string };
  /** USD for the time left / the whole build on its model (helpers.cost), null without a price or a time. */
  costLeft: number | null; costTotal: number | null;
}
export type GoneKind = 'built' | 'removed';
export interface Totals { left: number; cost: number; count: number; noEstimate: number; needsSplit: number }
export interface ActivityItem { id: string; source?: string; title: string; detail?: string; state: string; progress?: number; startedAt: number; updatedAt?: number; finishedAt?: number; url?: string; steps?: { name: string; state: string }[] }
export interface LiveEntry {
  id: string; title: string; state: string; activityState: string; startedAt: number; finishedAt: number; url: string; source: string;
  runningStep: string; progress: number | null; row: Row | null; via: string; estimate: number | null; elapsed: number | null; currentStep: string; over: number;
}
export interface Inputs { pending?: unknown[]; queue?: unknown; queueState?: unknown; features?: unknown[] }

export const SOURCES: Source[];
export const SOURCE_LABEL: Record<Source, string>;
export const ORIGINS: Origin[];
export const ORIGIN_LABEL: Record<Origin, string>;
export const PROMPT_SOURCES: string[];
export function originOf(source: string, addedBy: unknown): Origin;
export const ADDED_BY_LABEL: Record<string, string>;
export function addedByKey(source: unknown): string;
export function addedByLabel(key: string): string;
export function addedByOf(rows: Row[]): { value: string; label: string; count: number }[];
export const MODELS: Model[];
export const SORTS: SortKey[];
export const SORT_LABEL: Record<SortKey, string>;
export const SPLIT_LIMIT_MIN: number;
export function modelName(m: unknown): Model;
export function normId(s: unknown): string;
export function timing(own: unknown, steps: Step[], h: Helpers): Timing;
export function buildRows(inputs: Inputs, h: Helpers): Row[];
export function totalsByModel(rows: Row[]): Record<Model | 'all', Totals>;
export function filterRows(rows: Row[], f?: { model?: string; sources?: string[]; origins?: string[]; addedBy?: string; status?: string; split?: boolean }): Row[];
export function sortRows(rows: Row[], key?: SortKey): Row[];
export function statusesOf(rows: Row[]): { value: string; label: string }[];
export function linkRow(item: ActivityItem, rows: Row[]): { row: Row; via: string } | null;
export function liveEntries(activity: ActivityItem[], rows: Row[], now?: number): LiveEntry[];
export function onBuildList(e: LiveEntry): boolean;
export function tickRequest(row: Pick<Row, 'source' | 'id'>, index: number, done: boolean): { path: 'pending' | 'build-queue/steps'; body: Record<string, unknown> } | null;
export function probeTicks(pendingCore: unknown, queueCore: unknown): { canTickPending: boolean; canTickQueue: boolean };
export const GONE_LABEL: Record<GoneKind, string>;
export function goneRows(rows: Row[]): Row[];
export function takeOffRequests(row: Pick<Row, 'source' | 'id'>, how: GoneKind, feature?: { id: string } & Record<string, unknown>): { path: 'pending' | 'build-queue/step' | 'plan/feature'; body: Record<string, unknown> }[];
