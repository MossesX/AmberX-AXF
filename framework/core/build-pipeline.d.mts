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
  /** Brett's stop on this build (single Queued): absent unless one stands. */
  stop?: PipelineStop;
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

/** Single Queued (Nov 25 2026): one build in the Queue, Pending builds move up by themselves, Brett's stops stick. */
export type StopKind = 'hold' | 'cancel' | 'unqueue';
export interface PipelineStop { kind: StopKind; at: string; by: string; why: string; from: string }
export const QUEUE_MAX: 1;
export const STOP_KINDS: readonly StopKind[];
export const STOP_LABEL: Readonly<Record<StopKind, string>>;
export const BRETT_ACTORS: readonly string[];
export const STOPPED_MAY_BE: readonly string[];
type QueueBuild = NonNullable<BuildLike> & { id: string; createdAt?: string; kind?: string; priority?: string };
type Prio<B> = (b: B) => string;
export function speaksForBrett(by: unknown): boolean;
export function normStop(s: unknown): PipelineStop | null;
export function stopOf(b: BuildLike): PipelineStop | null;
export function isStopped(b: BuildLike): boolean;
export function queuedBuilds<B extends QueueBuild>(builds: B[], priorityOf?: Prio<B>): B[];
export function canPromote(b: BuildLike): boolean;
export function promotable<B extends QueueBuild>(builds: B[], priorityOf?: Prio<B>): B[];
export function canQueueNow<B extends QueueBuild>(builds: B[], id: string, opts?: { by?: string; priorityOf?: Prio<B> }): { ok: boolean; why: string; queued: string };
export function queueOne<B extends QueueBuild>(builds: B[], id: string, opts?: { at?: string; by?: string; priorityOf?: Prio<B> }): { ok: boolean; why: string; builds: B[]; id: string };
export function promote<B extends QueueBuild>(builds: B[], opts?: { at?: string; by?: string; priorityOf?: Prio<B> }): { builds: B[]; promoted: string; why: string };
export function settleQueue<B extends QueueBuild>(builds: B[], opts?: { at?: string; by?: string; priorityOf?: Prio<B> }): { builds: B[]; kept: string; demoted: string[] };
export function stopsFor(b: BuildLike): StopKind[];
export function stopBuild<B extends QueueBuild>(b: B, kind: StopKind, opts?: { at?: string; by?: string; why?: string }): { ok: boolean; why: string; build: B; kill: boolean; already?: boolean };
export function releaseStop<B extends QueueBuild>(b: B, opts?: { by?: string }): { ok: boolean; why: string; build: B };
export function stoppedExit(b: BuildLike, status: string): string;
export function guardStop(before: BuildLike, after: BuildLike, by?: string): { ok: boolean; why: string };
export function keepStops<B extends QueueBuild>(before: B[], after: B[], opts?: { by?: string; at?: string; priorityOf?: Prio<B> }): { builds: B[]; kept: { id: string; why: string }[] };
