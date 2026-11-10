/** Types for build-pipeline.mjs (build-pipeline@1: the pipeline record on a build and the Pending / Queue / Building table). */
export const SCHEMA: 'build-pipeline@1';
export const TABLE: Readonly<Record<string, 'pending' | 'queued' | 'building'>>;
export const TABLE_STATES: Array<'pending' | 'queued' | 'building'>;
export const TABLE_LABEL: Readonly<Record<'pending' | 'queued' | 'building', string>>;
export const OUTCOMES: Array<'finished' | 'requeued' | 'returned' | 'failed'>;
export const SPLIT_PROVIDERS: Array<'claude' | 'rules' | 'hand'>;
export const DEFAULT_MAX_RUNS: number;
export const STATUS_AFTER: Readonly<Record<'finished' | 'requeued' | 'returned' | 'failed', string>>;
export interface PipelineRun { at: string; exit: number | null; outcome: 'finished' | 'requeued' | 'returned' | 'failed'; stepsLeft: number; account: string; session: string }
export interface PipelineSplit { at: string; by: string; provider: 'claude' | 'rules' | 'hand'; steps: number; note: string }
export interface BuildPipeline {
  queuedAt: string; queuedBy: string; account: string; session: string; slot: string; model: string; launchedAt: string; runs: number;
  lastRun: PipelineRun | null; split: PipelineSplit | null; splitRequested: string; note: string; route?: string; dispatchedAt?: string; need?: BuildNeed | null;
}
export type NeedKind = 'review' | 'land' | 'signin' | 'credits' | 'key' | 'decision' | 'fable' | 'env' | 'resume';
export interface BuildNeed { kind: NeedKind; text: string; at: string; by: string }
export const NEED_KINDS: NeedKind[];
export const NEED_LABEL: Readonly<Record<NeedKind, string>>;
export const NEED_ACTION: Readonly<Record<NeedKind, { label: string; href?: string; action?: string }>>;
export const NEED_SELF: readonly NeedKind[];
export function needFrom(...texts: string[]): { kind: NeedKind; text: string } | null;
export function normNeed(n: unknown): BuildNeed | null;
export type TruthState = 'running' | 'needs' | 'queued' | 'pending' | 'ready' | 'landed' | 'failed' | 'archived';
export const TRUTH: TruthState[];
export const TRUTH_LABEL: Readonly<Record<TruthState, string>>;
export const TRUTH_TONE: Readonly<Record<TruthState, string>>;
export interface Truth { state: TruthState; label: string; tone: string; need: { kind: NeedKind; label: string; text: string; action: { label: string; href?: string; action?: string } } | null }
export function buildTruth(b: unknown, opts?: { live?: boolean | null }): Truth;
export function accountName(v: unknown): string;
export function emptyPipeline(): BuildPipeline;
export function normPipeline(p: unknown): BuildPipeline | null;
export function tableOf(b: { status?: string } | null | undefined): '' | 'pending' | 'queued' | 'building';
export function canQueue(b: unknown): boolean;
export function canUnqueue(b: unknown): boolean;
export function queueOrder<T extends { status: string; createdAt?: string; pipeline?: { queuedAt?: string } | null }>(builds: T[], priorityOf?: (b: T) => string): T[];
export function openSteps<T extends { done?: boolean; skip?: boolean }>(b: { steps?: T[] } | null | undefined): T[];
export function nextModel(b: { steps?: Array<{ done?: boolean; skip?: boolean; model?: string }> } | null | undefined): string;
export function outcomeOf(run: { exit: number | null; stepsLeft: number; runs: number }, maxRuns?: number): 'finished' | 'requeued' | 'returned' | 'failed';
export function outcomeLine(b: { pipeline?: { runs?: number } | null }, run: PipelineRun): string;
