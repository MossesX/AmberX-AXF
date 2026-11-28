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

// ---- the single-Queued contract: one build queued, promote on go-live, hold / cancel / unqueue stick
export const QUEUE_MAX: 1;
export type StopKind = 'hold' | 'cancel' | 'unqueue';
export const STOP_KINDS: readonly StopKind[];
export const STOP_LABEL: Readonly<Record<StopKind, string>>;
export const OWNER_ACTORS: readonly string[];
export const AUTOMATION_ACTORS: readonly string[];
export const STOPPABLE: Readonly<Record<StopKind, string[]>>;
export const SENT_STATUSES: readonly string[];
/** A standing hold | cancel | unqueue on `pipeline.stop`: terminal until an owner actor lifts it. */
export interface PipelineStop { kind: StopKind; at: string; by: string; why: string; from: string }
export interface QueueBuild { id: string; status: string; createdAt?: string; deleted?: boolean; hidden?: boolean; steps?: Array<{ id?: string; done?: boolean; skip?: boolean; claim?: unknown }>; pipeline?: (Partial<BuildPipeline> & { stop?: PipelineStop | null; lineAt?: string }) | null; [k: string]: unknown }
export interface QueueChange { id: string; from: string; to: string; why: string }
export interface QueueResult<T extends QueueBuild = QueueBuild> { ok: boolean; why: string; builds: T[]; build: T | null; changes: QueueChange[]; promoted?: string }
export interface CancelKill { session: string; slot: string; account: string; claims: Array<{ step: string; runId: string; slot: string; account: string }> }
export interface QueueOpts { by?: string; why?: string; now?: number | string; promote?: boolean }
export function isOwnerActor(by: unknown): boolean;
export function isSent(b: QueueBuild | null | undefined): boolean;
export function showsInOrchestrator(b: QueueBuild | null | undefined): boolean;
export function normStop(s: unknown): PipelineStop | null;
export function stopOf(b: QueueBuild | null | undefined): PipelineStop | null;
export function isStopped(b: QueueBuild | null | undefined): boolean;
export function queuedBuilds<T extends QueueBuild>(builds: T[]): T[];
export function slotHolders<T extends QueueBuild>(builds: T[]): T[];
export function queuedOne<T extends QueueBuild>(builds: T[]): T | null;
export function slotFree(builds: QueueBuild[]): boolean;
export function promotable(b: QueueBuild | null | undefined): { ok: boolean; why: string };
export function pendingOrder<T extends QueueBuild>(builds: T[]): T[];
export function checkQueue(builds: QueueBuild[]): { ok: boolean; queued: string[]; why: string };
export function queue<T extends QueueBuild>(builds: T[], id: string, opts?: QueueOpts): QueueResult<T>;
export function promote<T extends QueueBuild>(builds: T[], opts?: QueueOpts): QueueResult<T> & { promoted: string };
export function goLive<T extends QueueBuild>(builds: T[], id: string, opts?: QueueOpts): QueueResult<T>;
export function stop<T extends QueueBuild>(builds: T[], id: string, kind: StopKind, opts?: QueueOpts): QueueResult<T> & { kill?: CancelKill | null };
export function hold<T extends QueueBuild>(builds: T[], id: string, opts?: QueueOpts): QueueResult<T>;
export function cancel<T extends QueueBuild>(builds: T[], id: string, opts?: QueueOpts): QueueResult<T> & { kill?: CancelKill | null };
export function unqueue<T extends QueueBuild>(builds: T[], id: string, opts?: QueueOpts): QueueResult<T>;
export function release<T extends QueueBuild>(builds: T[], id: string, opts?: QueueOpts): QueueResult<T>;
/** The gate every automated writer passes its record through: a standing stop wins over the write. */
export function keepStop<T extends QueueBuild>(prev: T | null | undefined, next: T, opts?: { by?: string }): { build: T; kept: boolean; why: string };
/** The reconcile pass: restores one-queued, never revives a stopped build, promotes when the slot is free. Idempotent. */
export function settleQueue<T extends QueueBuild>(builds: T[], opts?: QueueOpts): { ok: true; builds: T[]; changes: QueueChange[]; queued: string };
