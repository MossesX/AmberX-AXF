/** Types for bb-core.mjs (build-asks@1). Every object keeps unknown fields. */
export interface Ask {
  id: string; app: string; plugin?: string | null; title: string; plain?: string; quote?: string;
  askedAt: string; timeApprox?: boolean | null; status: string; model?: string; minutes?: number | null;
  costUsd?: number | null; costEstimated?: boolean; branch?: string; pr?: number | null; profile?: string;
  sources?: string[]; note?: string; updatedAt?: string;
  [k: string]: unknown;
}
export interface Owner { id: string; name: string; plain?: string; app?: string; [k: string]: unknown }
export interface Doc { $axf: string; generatedAt?: string; sources?: unknown[]; gaps?: string[]; apps: Owner[]; plugins: Owner[]; asks: Ask[]; skipped?: number; [k: string]: unknown }
export interface StatusInfo { id: string; label: string; icon: string; tone: '' | 'accent' | 'success' | 'warning' | 'danger'; bucket: string }
export interface Filter { q?: string; statuses?: string[]; models?: string[]; range?: string; from?: string; to?: string }
export interface ModelTotals { asks: number; minutes: number; cost: number }
export interface Totals { asks: number; minutes: number; cost: number; buckets: Record<string, number>; statuses: Record<string, number>; models: Record<string, ModelTotals> }
export interface Group { id: string; label: string; asks: Ask[] }
export type Section = Owner & { asks: Ask[] };
export interface RowRef { kind: string; id: string }

export const SCHEMA: string;
export const REPO: string;
export const STATUSES: StatusInfo[];
export const BUCKETS: { id: string; label: string }[];
export const MODELS: string[];
export const RANGES: { id: string; label: string; days: number }[];
export const SORTS: { id: string; label: string }[];
export const GROUPS: { id: string; label: string }[];
export const PRICE_PER_MIN: Record<string, number>;
export function statusInfo(id: unknown): StatusInfo;
export function normStatus(s: unknown): string;
export function normModel(m: unknown): string;
export function parseJsonl(text: string): Doc;
export function parseAny(text: string): Doc;
export function toJsonl(doc: Doc): string;
export function mergeDocs(seed: Doc | null, mirror: Doc | null): Doc;
export function slug(s: unknown): string;
export function checkAsk(a: Ask, doc?: Doc): string[];
export function checkDoc(doc: Doc): string[];
export function makeAsk(input: Record<string, unknown>, doc?: Doc, now?: string): Ask;
export function patchAsk(doc: Doc, id: string, patch: Record<string, unknown>, now?: string): Doc;
export function askTime(a: Ask): number;
export function searchText(a: Ask): string;
export function filterAsks(asks: Ask[], f?: Filter, now?: number): Ask[];
export function sortAsks(asks: Ask[], sort?: string): Ask[];
export function dayKey(a: Ask): string;
export function groupAsks(asks: Ask[], by?: string): Group[];
export function totals(asks: Ask[]): Totals;
export function sections(doc: Doc, asks: Ask[], kind: 'app' | 'plugin'): Section[];
export function prUrl(pr: unknown): string;
export function branchUrl(b: unknown): string;
export function refFor(a: Ask): RowRef | null;
export function sourceLabel(s: unknown): { kind: string; text: string };
export function fmtMinutes(n: unknown): string;
export function fmtHours(n: unknown): string;
export function fmtCost(n: unknown, opts?: { whole?: boolean }): string;
