// Types for queue-log-core.mjs (queue-log@1).
export type LogKind = 'pending' | 'queue' | 'plan';
export interface LogEvent {
  kind: LogKind; op: string; id: string; title: string; from?: unknown; to?: unknown; field?: string; index?: number; position?: number;
  text?: string; added?: string[]; removed?: string[]; again?: boolean; at?: string; estimate?: string; snapshot?: Record<string, unknown>;
}
export interface LogBatch {
  id: string; at: string; source: 'tool' | 'outside'; by?: string; surface?: string; op?: string; reason?: string; reasonBy?: string; reasonAt?: string;
  prompt?: string; changeId?: string; session?: string; files: string[]; events: LogEvent[];
}
export interface FlatEvent extends LogEvent { key: string; batch: string; at: string; by?: string; surface?: string; source?: 'tool' | 'outside'; reason?: string; prompt?: string; changeId?: string; wop?: string }
export interface LogSummary { total: number; batches: number; ops: Record<string, number>; kinds: Record<string, number>; sources: Record<string, number>; by: Record<string, number> }
export interface LogView { events: FlatEvent[]; more: number; summary: LogSummary; totals: LogSummary; item?: FlatEvent[]; days: number }
export const LOG_KINDS: LogKind[];
export const KIND_LABEL: Record<LogKind, string>;
export const OP_LABEL: Record<string, string>;
export const OP_GROUPS: Record<'structure' | 'state' | 'fields' | 'steps' | 'notes', string[]>;
export const LIMITS: Record<string, number>;
export function hash(v: unknown): string;
export function snapshotOf(kind: LogKind, doc: unknown): Record<string, unknown>;
export function moves(before: string[], after: string[]): { id: string; from: number; to: number }[];
export function diff(kind: LogKind, before: unknown, after: unknown, titles?: Record<string, string>): LogEvent[];
export function describe(e: LogEvent): string;
export function cleanMeta(m?: Record<string, unknown>): Record<string, string>;
export function batchId(at: string, seed?: string): string;
export function flatten(batches: LogBatch[]): FlatEvent[];
export function filterEvents(events: FlatEvent[], f?: Record<string, unknown>): FlatEvent[];
export function itemHistory(events: FlatEvent[], id: string, kind?: LogKind): FlatEvent[];
export function summarize(events: FlatEvent[]): LogSummary;
