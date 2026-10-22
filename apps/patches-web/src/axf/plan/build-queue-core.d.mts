// Types for build-queue-core.mjs (the console imports it from TypeScript).
export type ModelId = 'fable' | 'opus' | 'sonnet';
export type StepState = 'done' | 'rework' | 'active' | 'queued' | 'blocked' | 'dropped' | 'missing';
export interface QFeature { id: string; title: string; kind: string; status: string; dependsOn?: string[]; catalog?: string[]; epic?: string; model?: string; modelReason?: string; area?: string; priority?: string; wave?: number; effort?: string; summary?: string; acceptance?: { text: string; done: boolean }[] }
export interface Rework { reasons: string[]; at: string; by: string }
/** One small step of a big build (Oct 21 2026): same shape as a pending item's sub prompt, minus `at`. */
export interface SmallStep { text: string; estimate?: string; done?: boolean; doneAt?: string }
export interface StepRecord { completedAt?: string; completedBy?: string; deps?: string[]; rework?: Rework | null; reopenedAt?: string; reworkedAt?: string; estimate?: string; steps?: SmallStep[] }
export interface QueueState { $axf: 'build-queue@1'; order: string[]; steps: Record<string, StepRecord>; dirty: boolean; updatedAt: string; history: { at: string; by: string; text: string }[] }
export interface StepView {
  id: string; position: number; title: string; area: string; status: string; state: StepState; priority: string; wave: number; effort: string; summary: string;
  model: ModelId; modelLabel: string; modelReason: string; epicModel?: string;
  deps: { id: string; title: string; status: string; position: number | null; done: boolean }[]; ready: boolean; violations: string[]; missing: string[];
  features: { id: string; title: string; status: string; model?: string; modelReason?: string }[]; progress: number; acceptance: { text: string; done: boolean }[];
  completedAt: string | null; completedBy: string | null; rework: Rework | null;
  /** Build time: the record's own estimate, else its small steps added up ('' when neither). */
  estimate: string; steps: SmallStep[]; stepsDone: number; minutesTotal: number; minutesLeft: number; needsSplit: boolean; splitReasons: string[];
}
export interface QueueView { steps: StepView[]; order: string[]; next: string | null; counts: Partial<Record<StepState, number>>; byModel: Partial<Record<ModelId, number>>; minutesLeftByModel: Partial<Record<ModelId, number>>; unsplit: string[]; violations: number; rework: number; dirty: boolean; updatedAt: string }
export interface Proposal { order: string[]; moves: { id: string; title: string; from: number; to: number; reason: string }[]; rework: { id: string; title: string; reasons: string[]; model: string; already: boolean }[]; cycles: { id: string; title: string }[]; changed: boolean }
export interface StatusChange { id: string; status: string; note: string }
export type StepAction = 'start' | 'complete' | 'resolve-rework' | 'reopen' | 'status';
/** Edits to a step's estimate and small steps (see stepsAction in build-queue-core.mjs). */
export interface StepsEdit { id: string; estimate?: string | null; steps?: SmallStep[]; add?: { text: string; estimate?: string }; index?: number; done?: boolean; text?: string; stepEstimate?: string | null; removeIndex?: number }
export const MODEL_TIER: Record<ModelId, number>;
export const MODEL_LABEL: Record<ModelId, string>;
export function emptyQueue(): QueueState;
export function computeQueue(features: QFeature[], queue: QueueState | null): QueueView;
export function proposeReprocess(features: QFeature[], queue: QueueState | null): Proposal;
export function applyReprocess(features: QFeature[], queue: QueueState | null, now?: string, by?: string): { queue: QueueState; proposal: Proposal };
export function reorder(features: QFeature[], queue: QueueState | null, order: string[], now?: string, by?: string): QueueState;
export function stepAction(features: QFeature[], queue: QueueState | null, a: { id: string; action: StepAction; status?: string; by?: string; note?: string }, now?: string): { changes: StatusChange[]; queue: QueueState };
export function syncQueue(features: QFeature[], queue: QueueState | null, now?: string, by?: string): { changes: StatusChange[]; queue: QueueState; log: string[]; first: boolean };
export function recordSteps(rec: StepRecord | null | undefined): SmallStep[];
export function stepsAction(features: QFeature[], queue: QueueState | null, a: StepsEdit, now?: string, by?: string): QueueState;
export function unsplitSteps(features: QFeature[], queue: QueueState | null): { id: string; title: string; estimate: string; reasons: string[] }[];
export function estimateMinutes(text: unknown): number | null;
export function formatMinutes(min: number | null | undefined): string;
