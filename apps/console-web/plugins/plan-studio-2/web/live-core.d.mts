/** Types for live-core.mjs (plan-live@1: sent plans read from the builds store). */
import type { Item, Live, State } from './tree-core.mjs';

export type LiveState = 'sent' | 'building' | 'merging' | 'recompiling' | 'ci' | 'waiting' | 'landed' | 'failed';
export type OrchAction = 'queue' | 'hold' | 'release' | 'retry' | 'rebuild' | 'run-ci' | 'land' | 'cancel';
export interface Look { mark: 'box' | 'check' | 'none'; badge: boolean; strike: boolean; tone: string; fill: string; font: string; weight: string; style: string }
export interface Build { id: string; status: string; planRef?: string; flow?: string; steps?: BuildStep[]; [k: string]: unknown }
export interface BuildStep { id: string; status?: string; done?: boolean; text?: string; [k: string]: unknown }
export interface HistoryEntry { id: string; at: string; by: string; build: string; kind: string; title: string; items: Item[]; restoredAt?: string }
/** The planning steps sends replaced, per item id (plan-history@1; its own document beside the tree). */
export interface History { $axf: 'plan-history@1'; items: Record<string, HistoryEntry[]> }
export interface HistoryRow { id: string; at: string; by: string; build: string; title: string; restoredAt: string; steps: { id: string; kind: string; title: string; done: boolean }[] }

/** A reference to another build: its short number, its id, its title (any may be empty). */
export interface BuildRef { buildId: string; number: string; title: string }
/** pipeline-status@1 `pipelineView`, as the builds store works it out on read. Read loosely: any field may be missing. */
export interface PipelineView {
  state?: string; label?: string; tone?: string; icon?: string; line?: string; attempt?: number;
  waitingOn?: { buildId?: string; title?: string; reason?: string; number?: number | string } | null;
  mergeLine?: { position?: number; waitingFor?: unknown; text?: string } | null;
  [k: string]: unknown;
}
export interface SplitInfo { by: string; model: string; at: string; stepCount: number }
export interface ClashStep { step: string; uid: string; title: string; waitsFor: BuildRef | null }
export interface ClashOption { id: string; label: string; line: string; action: string; steps: ClashStep[] }
export interface Clash { rejected: boolean; answer: string; auto: boolean; canAnswer: boolean; answeredBy: string; reason: string; with: BuildRef[]; options: ClashOption[] }
/** The build a plan was sent as (GET plans/<id>/build → build). */
export interface BuildInfo {
  id: string; number: string; title: string; status: string; label: string; state: LiveState; stateLabel: string; attempt: number; at: string;
  pipelineView: PipelineView | null; split: SplitInfo | null; clash: Clash | null; pr: number; prUrl: string; branch: string; held: boolean; landed: boolean; emergency?: boolean;
}
/** One step of that build: `uid` is the step's unique id, `row` the tree row that opens it. */
export interface StepInfo {
  id: string; uid: string; row: string; title: string; text: string; model: string; modelBy: string; splitBy: string; status: string; label: string;
  state: LiveState; stateLabel: string; attempt: number; done: boolean; minutes: number; pr?: number; skipped?: boolean; waitsFor?: BuildRef;
}
export interface BuildDetail { build: BuildInfo; steps: StepInfo[] }
export interface BuildSummary {
  name: string; state: string; label: string; tone: string; icon: string; raw: boolean; line: string; attempt: number;
  waiting: string; waitingOn: BuildRef | null; merge: string; split: string; splitByVps: boolean;
}
export type ClashAction = 'run-all' | 'defer';

export const SCHEMA: 'plan-live@1';
export const CLASH_ACTIONS: readonly ClashAction[];
export function planStatus(b: Build | null | undefined): 'active' | 'done';
export function numberOf(b: unknown): string;
export function buildName(b: unknown): string;
export function buildRef(v: unknown): BuildRef | null;
export function refName(r: BuildRef | null | undefined): string;
export function ordinal(n: number): string;
export function splitOf(b: Build | null | undefined): SplitInfo | null;
export function splitLabel(by: string, model?: string): string;
export function mergeLineText(ml: unknown): string;
export function waitingText(w: unknown): string;
export function clashOf(b: unknown): Clash | null;
export function deferLine(waitsFor: BuildRef | null | undefined): string;
export function stepDetail(b: Build, s: BuildStep): StepInfo;
export function buildDetail(b: Build): BuildDetail;
export function buildSummary(build: Partial<BuildInfo> | null | undefined): BuildSummary;
export function modelText(step: { model?: string } | null | undefined): string;
export function byTriage(step: { model?: string; modelBy?: string } | null | undefined): boolean;
export const ORIGIN: 'orchestrator';
export const ORIGIN_LABEL: string;
export const FLOW: string;
export const HISTORY_SCHEMA: 'plan-history@1';
export const HISTORY_MAX: number;
export function emptyHistory(): History;
export function normHistory(doc: unknown): History;
export const STATES: readonly LiveState[];
export const STATE_LABEL: Record<LiveState, string>;
export const ACTIONS: readonly OrchAction[];
export const ACTION_LABEL: Record<OrchAction, string>;
export const LOOK_MARKS: readonly Look['mark'][];
export const LOOK_TONES: readonly string[];
export const LOOK_FONTS: readonly string[];
export const LOOK_WEIGHTS: readonly string[];
export const LOOK_STYLES: readonly string[];
export const DEFAULT_LOOKS: Record<LiveState, Look>;
export function isLanded(b: Build | null | undefined): boolean;
export function sentBuilds(builds: Build[], itemId: string): Build[];
export function liveBuild(builds: Build[], itemId: string): Build | null;
export function hasSteps(b: Build | null | undefined): boolean;
export function buildState(b: Build): LiveState;
export function stepState(b: Build, s: BuildStep): LiveState;
export function buildLive(b: Build): Live;
export function stepRowId(buildId: string, stepId: string): string;
export function parseStepRowId(id: string): { build: string; step: string } | null;
export function stepRow(b: Build, s: BuildStep, parent: string, order: number): Item;
export function sentStepItems(state: State, itemId: string): Item[];
export function liveView(state: State, builds: Build[]): State;
export function lockOf(state: State, builds: Build[], itemId: string): { item: Item; build: Build } | null;
export function lockedWhy(lock: { item: Item; build: Build }): string;
export function syncSent(state: State, builds: Build[], history?: History, o?: { at?: string; by?: string }): { state: State; history: History; changed: boolean; replaced: { item: string; build: string; steps: number }[]; restored: { item: string; build: string; steps: number }[] };
export function restoreEntry(state: State, history: History, itemId: string, entry?: string, o?: { at?: string; drop?: boolean }): { state: State; history: History; restored: number; entry: string };
export function historyOf(history: History, state: State, itemId: string): HistoryRow[];
export function actionTarget(state: State, builds: Build[], ref: string): { build: Build; step: string; item: Item | null } | null;
export function normLook(v: unknown, state?: string): Look;
export function normLooks(saved: unknown): Record<LiveState, Look>;
export function lookClasses(l: Look): string;
