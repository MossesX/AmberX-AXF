export type PendingStatus = 'pending' | 'unsafe' | 'broken' | 'failed' | 'complete';
export type PendingModel = 'Fable' | 'Opus' | 'Sonnet';
export type PendingSort = 'status' | 'added' | 'built';
/** `estimate` = build time, a short string: "45 min", "2 h", "1.5 d" (Oct 20 2026). */
export interface PendingEntry { text: string; at: string; estimate?: string }
export interface PendingItem {
  id: string; title: string; detail: string; model: PendingModel; status: PendingStatus;
  notes: PendingEntry[]; subPrompts: PendingEntry[];
  createdAt: string; builtAt: string; updatedAt: string; planId?: string; estimate?: string; source: string;
}
export interface PendingState { $axf: 'pending@1'; updatedAt: string; artifact: string; items: PendingItem[] }
export type PendingAction =
  | { action: 'add'; title: string; detail?: string; model?: PendingModel; status?: PendingStatus; planId?: string; estimate?: string; source?: string; id?: string }
  | { action: 'update'; id: string; title?: string; detail?: string; model?: PendingModel; status?: PendingStatus; planId?: string; estimate?: string; subEstimates?: string[] }
  | { action: 'status'; id: string; status: PendingStatus }
  | { action: 'note' | 'sub'; id: string; text: string; estimate?: string }
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
