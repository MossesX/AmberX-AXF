// Types for feature-matrix-core.mjs (feature-matrix@1). The console plugin imports these from TypeScript.
export type Model = 'Fable' | 'Opus';
export type ItemState = 'keep' | 'skip';
export type RefKind = 'orchestrator' | 'pending' | 'queue' | 'plan' | 'change';
export type SourceKind = 'step' | 'sub' | 'acceptance' | 'manual';
export type Sort = 'updated' | 'added' | 'cost' | 'title' | 'profile' | 'dirty';
export interface BuildRef { kind: RefKind; id: string }
export interface HistoryLine { at: string; action: string; item?: string; from?: string; to?: string; by?: string }
export interface Item { id: string; name: string; why: string; group: string; minutes: number; model: Model; state: ItemState; addedAt: string; updatedAt: string; source: { kind: SourceKind; id: string }; history: HistoryLine[] }
export interface Matrix { id: string; ref: BuildRef; profile: string; title: string; createdAt: string; updatedAt: string; version: number; appliedVersion: number; appliedAt: string; items: Item[]; history: HistoryLine[] }
export interface State { $axf: 'feature-matrix@1'; updatedAt: string; matrices: Matrix[] }
export interface ModelTotals { kept: number; skipped: number; keptMinutes: number; skippedMinutes: number }
export interface GroupTotals { label: string; items: number; kept: number; skipped: number; keptMinutes: number; skippedMinutes: number }
export interface Totals { items: number; kept: number; skipped: number; keptMinutes: number; skippedMinutes: number; totalMinutes: number; byModel: Record<Model, ModelTotals>; groups: GroupTotals[]; dirty: boolean; applied: boolean }
export interface Row { id: string; ref: BuildRef; profile: string; title: string; addedAt: string; updatedAt: string; version: number; appliedVersion: number; appliedAt: string; dirty: boolean; items: number; kept: number; skipped: number; keptMinutes: number; skippedMinutes: number; cost: string; byModel: Record<Model, ModelTotals> }
export type ItemInput = { id?: string; name: string; why?: string; group?: string; minutes?: number | string; estimate?: string; model?: string; state?: string; source?: { kind: SourceKind; id?: string } };
export type Change =
  | { action: 'add' | 'seed'; ref: BuildRef; profile?: string; title?: string; items?: ItemInput[]; by?: string }
  | { action: 'add-item'; matrix: string; item: ItemInput | string; by?: string }
  | { action: 'keep' | 'skip'; matrix: string; item: string; by?: string }
  | { action: 'set-state'; matrix: string; item: string; state: ItemState; by?: string }
  | { action: 'edit-item'; matrix: string; item: string; data: Partial<Pick<Item, 'name' | 'why' | 'group' | 'minutes' | 'model'>>; by?: string }
  | { action: 'rename'; matrix: string; title: string; by?: string }
  | { action: 'applied'; matrix: string; version?: number; by?: string }
  | { action: 'remove-item'; matrix: string; item: string }
  | { action: 'remove'; matrix: string };
export const SCHEMA: 'feature-matrix@1';
export const MODELS: Model[];
export const STATES: ItemState[];
export const REF_KINDS: RefKind[];
export const SOURCE_KINDS: SourceKind[];
export const SORTS: Sort[];
export const SORT_LABEL: Record<Sort, string>;
export const LIMITS: { items: number; history: number; itemHistory: number; name: number; why: number; group: number; title: number; id: number };
export const APPLIED_PREFIX: string;
export function iso(v: unknown): string;
export function slug(t: unknown): string;
export function formatMinutes(min: number | null | undefined): string;
export function estimateMinutes(e: unknown): number | null;
export function matrixId(ref: BuildRef, profile?: string): string;
export function normRef(ref: unknown): BuildRef | null;
export function emptyState(now?: string): State;
export function normalizeState(raw: unknown, now?: string): State;
export function isDirty(m: Matrix): boolean;
export function isKept(it: Item): boolean;
export function totals(matrix: Matrix | null | undefined): Totals;
export function findMatrix(state: State, ref: BuildRef | string, profile?: string): Matrix | null;
export function grid(state: State, sort?: Sort, dir?: 'asc' | 'desc'): Row[];
export function sortRows(rows: Row[], sort?: Sort, dir?: 'asc' | 'desc'): Row[];
export function itemsFromSteps(steps: unknown[], now?: string): ItemInput[];
export function itemsFromSubPrompts(subPrompts: unknown[], model?: Model, now?: string): ItemInput[];
export function itemsFromAcceptance(acceptance: unknown[], model?: Model, now?: string): ItemInput[];
export function apply(state: State | unknown, change: Change, now?: string): { state: State; matrix?: Matrix; item?: Item; log: string[] };
export function validate(raw: unknown): string[];
