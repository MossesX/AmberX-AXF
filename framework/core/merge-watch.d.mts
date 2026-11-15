/** Types for merge-watch.mjs (merge-watch@1: the VPS watches main and sends a shipped manifest for every merge). */
export const SCHEMA: 'merge-watch@1';
export const ENTRY: 'merge-watch-entry@1';
export const VERSION: 1;
export type Kind = 'pr-merge' | 'batch' | 'build-land' | 'direct';
export type State = 'pending' | 'sent' | 'failed' | 'skipped';
export type SkipReason = 'status-only' | 'revert' | 'folded';
export const KINDS: Kind[]; export const STATES: State[]; export const SKIP_REASONS: SkipReason[];
export const RETRY_MINUTES: number[]; export const MAX_ATTEMPTS: number; export const HOLD_MINUTES: number; export const KEEP_DAYS: number;
export const DEFAULT_REF: string; export const DEFAULT_REPO: string; export const STATE_REL: string;
export const SUBJECTS: Record<'prMerge' | 'squash' | 'batch' | 'buildLand' | 'status' | 'skipCi' | 'revert' | 'buildPrefix', RegExp>;
/** A commit on main's first-parent line as the host reads it from git. */
export interface Commit { sha: string; parents?: string[]; subject?: string; message?: string; at?: string }
export interface Classification { kind: Kind; pr: number; branch: string; build: string; guess: string; skip: SkipReason | ''; merge: boolean }
export interface Entry {
  $axf: 'merge-watch-entry@1'; sha: string; base: string; kind: Kind; at: string; subject: string; pr: number; branch: string; build: string; guess: string; commits: string[];
  state: State; reason: SkipReason | ''; into: string; attempts: number; lastAttemptAt: string; nextRetryAt: string; error: string;
  manifest: { id: string; rev: number } | null; sentAt: string; seenAt: string;
}
export interface WatchState {
  $axf: 'merge-watch@1'; version: 1; repo: string; ref: string; startedFrom: string; lastSeen: { sha: string; at: string; checkedAt: string }; updatedAt: string; entries: Record<string, Entry>;
}
export interface FieldError { field: string; message: string }
export interface Summary {
  repo: string; ref: string; lastSeen: WatchState['lastSeen']; startedFrom: string; total: number; counts: Record<State, number>; due: number;
  oldestPending: { sha: string; at: string; build: string } | null; failed: Array<{ sha: string; build: string; attempts: number; nextRetryAt: string; gaveUp: boolean; error: string }>; lastSent: string;
}
export function sha(v: unknown): string;
export function slug(v: unknown): string;
export function normBranch(v: unknown): string;
export function buildOfBranch(branch: unknown): string;
export function classifyCommit(c: Commit): Classification;
export function normEntry(v: unknown, opts?: { now?: string }): Entry | null;
export function normState(v: unknown, opts?: { now?: string }): WatchState | null;
export function startState(opts?: { repo?: string; ref?: string; from?: { sha?: string; at?: string }; now?: string }): WatchState;
export function validateState(v: unknown): { ok: boolean; errors: FieldError[] };
export function rejection(errors: FieldError[]): string;
export function landingsOf(commits: Commit[], opts?: { now?: string; oldestFirst?: boolean }): Entry[];
export function advance(state: WatchState | null, commits: Commit[], opts?: { now?: string }): { state: WatchState; added: Entry[]; folded: string[] };
export function due(state: WatchState, now: string): Entry[];
export function markSent(state: WatchState, sha: string, manifest: { id: string; rev?: number }, now: string): WatchState;
export function markFailed(state: WatchState, sha: string, error: string, now: string): WatchState;
export function reset(state: WatchState, sha: string, now: string): WatchState;
export function prune(state: WatchState, opts?: { now?: string; keepDays?: number }): WatchState;
export type Known = Set<string> | Record<string, unknown> | null;
export type ByPr = Map<number, string> | Record<number, string> | null;
export function buildIdOf(e: Entry, known?: Known, byPr?: ByPr): string;
export function toManifestOverlay(e: Entry, opts?: { repo?: string; known?: Known; byPr?: ByPr }): Record<string, unknown> | null;
export function fallbackSaid(e: Entry, subjects?: string[]): { text: string; verbatim: false; source: 'git'; at: string } | null;
export function summaryOf(state: WatchState, now?: string): Summary | null;
export const REGISTRY: Readonly<Record<string, unknown>>;
export function jsonSchemas(): Record<string, Record<string, unknown>>;
