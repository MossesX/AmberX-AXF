export type PendingStatus = 'pending' | 'broken' | 'failed' | 'complete';
export type PendingModel = 'Fable' | 'Opus' | 'Sonnet';
export type PendingSort = 'status' | 'added' | 'built';
export interface PendingEntry { text: string; at: string }
export interface PendingItem {
  id: string; title: string; detail: string; model: PendingModel; status: PendingStatus;
  notes: PendingEntry[]; subPrompts: PendingEntry[];
  createdAt: string; builtAt: string; updatedAt: string; planId?: string; source: string;
}
export interface PendingState { $axf: 'pending@1'; updatedAt: string; artifact: string; items: PendingItem[] }
export type PendingAction =
  | { action: 'add'; title: string; detail?: string; model?: PendingModel; status?: PendingStatus; planId?: string; source?: string; id?: string }
  | { action: 'update'; id: string; title?: string; detail?: string; model?: PendingModel; status?: PendingStatus; planId?: string }
  | { action: 'status'; id: string; status: PendingStatus }
  | { action: 'note' | 'sub'; id: string; text: string }
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
