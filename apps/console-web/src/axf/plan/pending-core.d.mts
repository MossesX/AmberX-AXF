export type PendingStatus = 'pending' | 'unsafe' | 'broken' | 'failed' | 'complete';
export type PendingModel = 'Fable' | 'Opus' | 'Sonnet';
export type PendingSort = 'status' | 'added' | 'built';
/**
 * `estimate` = build time, a short string: "45 min", "2 h", "1.5 d" (Oct 20 2026).
 * Sub prompts are the item's steps (Oct 21 2026): `done` / `doneAt` (ISO) once ticked off.
 */
export interface PendingEntry { text: string; at: string; estimate?: string; done?: boolean; doneAt?: string }
export interface PendingItem {
  id: string; title: string; detail: string; model: PendingModel; status: PendingStatus;
  notes: PendingEntry[]; subPrompts: PendingEntry[];
  createdAt: string; builtAt: string; updatedAt: string; planId?: string; estimate?: string; source: string;
}
export interface PendingState { $axf: 'pending@1'; updatedAt: string; artifact: string; items: PendingItem[] }
export type PendingAction =
  | { action: 'add'; title: string; detail?: string; model?: PendingModel; status?: PendingStatus; planId?: string; estimate?: string; source?: string; id?: string }
  | { action: 'update'; id: string; title?: string; detail?: string; model?: PendingModel; status?: PendingStatus; planId?: string; estimate?: string; subEstimates?: string[]; subPrompts?: { text: string; at?: string; estimate?: string; done?: boolean; doneAt?: string }[] }
  | { action: 'status'; id: string; status: PendingStatus }
  | { action: 'note' | 'sub'; id: string; text: string; estimate?: string }
  | { action: 'step'; id: string; index: number; done?: boolean; text?: string; estimate?: string }
  | { action: 'remove'; id: string };

export const STATUSES: PendingStatus[];
export const STATUS_LABEL: Record<PendingStatus, string>;
export const MODELS: PendingModel[];
export const SORTS: PendingSort[];
export const ARTIFACT_URL: string;
export function emptyPending(): PendingState;
export function iso(v: unknown): string;
export function slug(s: string): string;
export function normalize(raw: unknown, now?: string): PendingItem;
export function normalizeState(raw: unknown, now?: string): PendingState;
export function apply(state: PendingState | null | undefined, a: PendingAction, now?: string): { state: PendingState; item?: PendingItem; log: string[] };
export function sortItems(items: PendingItem[], key?: PendingSort, dir?: 'asc' | 'desc'): PendingItem[];
export function counts(items: PendingItem[]): Record<PendingStatus, number>;
export function shownDate(it: PendingItem): { label: 'Added' | 'Built'; at: string };
export function fromArtifact(doc: Record<string, unknown>): PendingItem;
export function toArtifact(it: PendingItem): Record<string, unknown>;
/** Minutes in an estimate string, null when it isn't one. */
export function estimateMinutes(text: unknown): number | null;
export function formatMinutes(min: number | null | undefined): string;
/** The item's own estimate, else its sub prompts' added up, else ''. */
export function itemEstimate(it: PendingItem): string;
/** Build time in minutes: every step estimated → the steps added up; else its own estimate; null when nothing gives one. */
export function entryMinutes(entry: { estimate?: string; subPrompts?: { estimate?: string }[]; steps?: { estimate?: string }[] }): number | null;
export interface PricingDoc { models?: Record<string, { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }>; heuristic?: { tokensPerMinute?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } } }
/** USD of one working minute on a model (model-pricing.json heuristic), null without a price. */
export function minuteCostUsd(model: string, pricing: PricingDoc | unknown): number | null;
/** USD for `minutes` on a model, rounded to cents; null without a price or a time. */
export function costForMinutes(model: string, minutes: number | null | undefined, pricing: PricingDoc | unknown): number | null;
/** "$0.84", "$23", "$1,234"; '' for null. */
export function formatUsd(v: number | null | undefined): string;

/** Small steps for big builds (Oct 21 2026): builds over this many minutes are split into steps of at most this many. */
export const SPLIT_LIMIT_MINUTES: number;
/** Anything with `estimate` and either `subPrompts` (pending item) or `steps` (build-queue step record). */
export type Splittable = { estimate?: string; subPrompts?: { estimate?: string; done?: boolean }[]; steps?: { estimate?: string; done?: boolean }[] };
export interface SplitCheck { needsSplit: boolean; totalMinutes: number | null; steps: number; reasons: string[] }
export function splitCheck(entry: Splittable, limit?: number): SplitCheck;
export function needsSplit(entry: Splittable, limit?: number): boolean;
export interface StepsProgress { done: number; total: number; minutesTotal: number; minutesLeft: number; minutesDone: number }
export function stepsProgress(entry: Splittable): StepsProgress;
