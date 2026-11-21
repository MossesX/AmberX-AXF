export type RowKind = 'pending' | 'queued' | 'building' | 'merge-queue' | 'ui-review';
export type Action = 'keep' | 'complete' | 'remove';
export type Reason = 'invalid-row' | 'live' | 'pr-merged' | 'on-main' | 'build-complete' | 'pr-closed' | 'build-failed' | 'build-cancelled' | 'own-status' | 'no-facts' | 'open';
export interface Row { kind: RowKind | ''; id: string; build: string; pr: number; branch: string; status: string }
export interface Facts {
  pr: { number: number; state: 'open' | 'closed' | 'merged' | null; mergedAt: string; mergeCommit: string; url: string } | null;
  main: { landed: boolean | null; commit: string; by: '' | 'merge-commit' | 'squash' | 'cherry-pick' | 'fast-forward' } | null;
  build: { id: string; status: string; deleted: boolean; mergedAt: string } | null;
  branch: { name: string; exists: boolean | null } | null;
  session: { alive: boolean | null; id: string } | null;
}
export interface Verdict { $axf: 'stale-row@1'; action: Action; reason: Reason; evidence: string[] }
export interface RowVerdict extends Verdict { row: Row }
export interface LogRecord {
  $axf: 'stale-row-log@1'; id: string; kind: RowKind; rowId: string; build: string; pr: number; branch: string;
  action: Action; reason: Reason; evidence: string[]; at: string; by: string; dry?: boolean; note?: string;
}
export const FRAME: 'stale-row@1';
export const RECORD_FRAME: 'stale-row-log@1';
export const KINDS: readonly RowKind[];
export const KIND_LABEL: Readonly<Record<RowKind, string>>;
export const BUILD_KINDS: readonly RowKind[];
export const LIST_KINDS: readonly RowKind[];
export const ACTIONS: readonly Action[];
export const ACTION_LABEL: Readonly<Record<Action, string>>;
export const REASONS: Readonly<Record<Reason, { action: Action; label: string }>>;
export const REASON_CODES: readonly Reason[];
export function prNumber(pr: unknown): number;
export function normKind(v: unknown): RowKind | '';
export function kindOfBuild(b: unknown): RowKind | '';
export function normRow(r: unknown): Row;
export function normFacts(f: unknown): Facts;
export function noFacts(f: unknown): boolean;
export function classify(row: unknown, facts?: unknown): Verdict;
export function classifyRows(rows: unknown[], factsFor?: Record<string, unknown> | ((row: Row) => unknown)): RowVerdict[];
export function rowKey(row: unknown): string;
export function summarize(verdicts: Verdict[]): { complete: Verdict[]; remove: Verdict[]; keep: number };
export function logRecord(row: unknown, v: Verdict, opts?: { at?: string; by?: string; dry?: boolean; note?: string }): LogRecord;
export function validateRecord(rec: unknown): { ok: boolean; errors: string[] };
export function describe(row: unknown, v: Verdict): string;
