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
  lastRun: PipelineRun | null; split: PipelineSplit | null; splitRequested: string; note: string;
  route: '' | 'api' | 'subscription'; dispatchedAt: string;
  /** The orchestrator's plan, made at split time; the final pick (account, pickedAt) can differ. */
  planned: PipelinePlan | null; tried: string[]; pickedAt: string;
  /** On hold: stays in the Queue, the dispatcher skips it until released ('' = not held). */
  heldAt: string; heldBy: string; heldWhy: string;
}
export interface PipelinePlan { model: string; account: string; kind: '' | 'api' | 'subscription'; at: string; why: string }
export type PipelineTab = 'pending' | 'queue' | 'active' | 'incomplete' | 'complete' | 'errors' | 'archive' | 'deleted';
export type BuildAction = 'unqueue' | 'hold' | 'release' | 'archive' | 'unarchive' | 'delete' | 'restore';
export const BUILD_ACTIONS: BuildAction[];
type BuildLike = { status?: string; deleted?: boolean; hidden?: boolean; mergedAt?: string; steps?: { done?: boolean; skip?: boolean }[]; pipeline?: Partial<BuildPipeline> | null } | null | undefined;
export function isHeld(b: BuildLike): boolean;
export function canHold(b: BuildLike): boolean;
export function isLive(b: BuildLike): boolean;
export function canArchive(b: BuildLike): boolean;
export function canDelete(b: BuildLike): boolean;
export function unarchivedStatus(b: BuildLike): 'built' | 'complete' | 'pending';
export function actionsFor(b: BuildLike): BuildAction[];
export const TABS: PipelineTab[];
export const TAB_LABEL: Readonly<Record<PipelineTab, string>>;
export function tabOf(b: { status?: string; deleted?: boolean; hidden?: boolean; steps?: { done?: boolean }[]; pipeline?: Partial<BuildPipeline> | null } | null | undefined): '' | PipelineTab;
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
