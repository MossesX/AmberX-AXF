/** Types for build-pipeline.mjs (build-pipeline@1: the pipeline record on a build and the Pending / Queue / Building table). */
export const SCHEMA: 'build-pipeline@1';
export const TABLE: Readonly<Record<string, 'pending' | 'queued' | 'building'>>;
export const TABLE_STATES: Array<'pending' | 'queued' | 'building'>;
export const TABLE_LABEL: Readonly<Record<'pending' | 'queued' | 'building', string>>;
export const OUTCOMES: Array<'finished' | 'requeued' | 'returned' | 'failed'>;
export const SPLIT_PROVIDERS: Array<'claude' | 'rules' | 'hand'>;
export const DEFAULT_MAX_RUNS: number;
export const STATUS_AFTER: Readonly<Record<'finished' | 'requeued' | 'returned' | 'failed', string>>;
export type ExitReason = 'all-done' | 'phase-done' | 'crash' | 'crash-limit' | 'upgrade-blocked' | 'needs-brett' | 'stopped';
export const EXIT_REASONS: ExitReason[];
export interface PipelineRun { at: string; exit: number | null; outcome: 'finished' | 'requeued' | 'returned' | 'failed'; reason: ExitReason | ''; stepsLeft: number; account: string; session: string; phase: string }
export interface PipelineSplit { at: string; by: string; provider: 'claude' | 'rules' | 'hand'; steps: number; note: string }
export interface BuildPipeline {
  queuedAt: string; queuedBy: string; account: string; session: string; slot: string; model: string; phase: string; launchedAt: string; runs: number;
  /** Failed exits so far: the crash limit counts these, never a clean phase end. */
  crashes: number;
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
export interface ExitInput { exit: number | null; stepsLeft: number; runs?: number; crashes?: number; phaseDone?: boolean; upgradeBlocked?: boolean; needsBrett?: boolean }
export interface ExitResult { status: 'built' | 'queued' | 'pending'; outcome: 'finished' | 'requeued' | 'returned' | 'failed'; reason: ExitReason; crashes: number; keepQueue: boolean }
/** The exit transition, pure: a phase done with steps left is queued again ('phase-done'); Pending only for a real stop. */
export function nextStatusOnExit(run: ExitInput, maxRuns?: number): ExitResult;
export function outcomeOf(run: ExitInput & { phaseSwitch?: boolean }, maxRuns?: number): 'finished' | 'requeued' | 'returned' | 'failed';
export function outcomeLine(b: { pipeline?: { runs?: number } | null }, run: PipelineRun): string;

// step-groups@1: one build over several slots (framework/spec/BUILD-GROUPS.md)
export const GROUPS_SCHEMA: 'step-groups@1';
export type GroupState = 'planned' | 'ready' | 'running' | 'ready-to-merge' | 'merging' | 'merged' | 'conflict' | 'failed';
export const GROUP_STATES: GroupState[];
export const GROUP_STATE_LABEL: Readonly<Record<GroupState, string>>;
export const GROUP_LIVE_STATES: GroupState[];
export const IMPLICIT_GROUP: 'g1';
/** One step group on a build: its steps run in sequence in one slot; groups run beside each other and merge in `mergeOrder`. */
export interface BuildGroup {
  id: string; steps: string[]; state: GroupState; dependsOn: string[];
  slot: string; account: string; session: string; branch: string; worktree: string;
  mergeOrder: number; startedAt: string; endedAt: string; mergedAt: string; note: string;
}
type GroupStepLike = { id?: string; done?: boolean; skip?: boolean; group?: string };
type GroupBuildLike = { steps?: GroupStepLike[]; groups?: unknown; branch?: string; mergedAt?: string } | null | undefined;
export function groupId(v: unknown): string;
export function normDependsOn(v: unknown): string[];
export function normGroup(g: unknown, i?: number): BuildGroup | null;
export function normGroups(list: unknown): BuildGroup[];
export function groupStateOfSteps(steps: GroupStepLike[] | undefined): GroupState;
export function implicitGroups(b: GroupBuildLike): BuildGroup[];
export function groupsOf(b: GroupBuildLike): BuildGroup[];
export function isSplit(b: GroupBuildLike): boolean;
export function groupOfStep(b: GroupBuildLike, stepId: string): BuildGroup | null;
export function readyGroups(b: GroupBuildLike): BuildGroup[];
