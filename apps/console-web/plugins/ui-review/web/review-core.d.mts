/** Types for review-core.mjs (review-item@1). Every object keeps unknown fields. */
export type Device = 'phone' | 'desktop';
export type Status = 'waiting' | 'changes' | 'rejected' | 'approved';
export type Decision = 'approve' | 'changes' | 'reject' | 'reopen';
export interface Shot { src: string; device: Device; name: string; [k: string]: unknown }
export interface HistoryLine { at: string; by: string; action: string; status: Status; comment?: string }
export interface PackInfo { id: string; num: number; round: number; scheme: 'light' | 'dark'; swatches: string[]; font: number; radius: number }
export interface Item {
  $axf: string; id: string; kind: string; title: string; app: string; build: string; branch: string; pr: number | null;
  shots: Shot[]; notes: string; status: Status; comment: string; history: HistoryLine[]; source: string;
  submittedAt: string; updatedAt: string; pack?: PackInfo; [k: string]: unknown;
}
export interface Kind { id: string; label: string; icon: string; order: number; desc: string; unlisted?: boolean }
export interface StatusInfo { id: Status; label: string; icon: string; tone: 'accent' | 'warning' | 'danger' | 'success'; holds: boolean }
export interface Filter { kind?: string; status?: string; app?: string; branch?: string; pr?: number | string | null; q?: string }
export interface Counts { total: number; waiting: number; changes: number; rejected: number; approved: number }
export interface Group { id: string; label: string; items: Item[] }
export interface TreeKind extends Group { apps: Group[] }
export interface ReviewState { $axf: 'ui-review@1'; branch: string; pr: number | null; state: 'none' | Status; holds: boolean; counts: Omit<Counts, 'total'>; items: { id: string; title: string; kind: string; status: Status }[] }

export const SCHEMA: string;
export const MAX_PICKS: number;
export const DESIGN_KIND: string;
export const STATUSES: StatusInfo[];
export const DECISIONS: Record<Decision, Status>;
export const SORTS: { id: string; label: string }[];
export function statusInfo(id: string): StatusInfo;
export function isKind(k: unknown): boolean;
export function isItemId(k: unknown): boolean;
export function labelFromId(id: string): string;
export function mergeKinds(base?: Partial<Kind>[], extra?: Partial<Kind>[], items?: { kind: string }[]): Kind[];
export function deviceOf(name: string): Device;
export function shotName(file: string): string;
export function normItem(raw: unknown, opts?: { now?: string; id?: string }): { item: Item; problems: string[] };
export function newId(now?: string): string;
export function decide(item: Item, decision: Decision | Status, opts?: { comment?: string; by?: string; at?: string }): Item;
export function bulkDecide(items: Item[], ids: string[], decision: Decision | Status, opts?: { comment?: string; by?: string; at?: string }): { items: Item[]; changed: string[]; missing: string[] };
export function packGroups(index: { packs?: unknown[] } | null | undefined): { $axf: 'ui-review-group@1'; id: string; name: string; createdAt: string; source: string }[];
export function packItems(index: { packs?: unknown[] } | null | undefined, overlay?: Record<string, Partial<Item>>): Item[];
export function matches(it: Item, q?: string): boolean;
export function filterItems(items: Item[], f?: Filter): Item[];
export function sortItems(items: Item[], sort?: string): Item[];
export function counts(items: Item[]): Record<string, Counts>;
export function groupItems(items: Item[], by?: 'kind' | 'app' | 'status' | 'build', kinds?: Kind[]): Group[];
export function tree(items: Item[], kinds?: Kind[]): TreeKind[];
export function toggleId(sel: string[], id: string): string[];
export function groupChecked(sel: string[], ids: string[]): 'all' | 'some' | 'none';
export function setGroup(sel: string[], ids: string[], on: boolean): string[];
export function togglePick(picked: string[], id: string, max?: number): { picked: string[]; error: string };
export function reviewState(items: Item[], q?: { branch?: string; pr?: number | string | null }): ReviewState;
export function apps(items: Item[]): string[];
