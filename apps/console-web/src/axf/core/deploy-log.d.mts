/** Types for deploy-log.mjs (deploy-log@1: what got deployed where, and when). */
export const SCHEMA: 'deploy-log@1';
export const RECORD: 'deploy@1';
export const VERSION: 1;
export const KINDS: Array<'deploy' | 'rollback' | 'publish'>;
export const STATES: Array<'done' | 'failed'>;
export const TARGETS: Record<string, { label: string; url: string; repo: string }>;
export const TARGET_RE: RegExp; export const SHA_RE: RegExp;
export interface Deploy { $axf: 'deploy@1'; id: string; target: string; sha: string; from: string; at: string; who: string; host: string; kind: 'deploy' | 'rollback' | 'publish'; state: 'done' | 'failed'; version: string; note: string; guessed: boolean }
export interface LiveEntry { at: string; guessed: boolean; deploy: string }
export type Contains = ((deploySha: string, mergeSha: string) => boolean) | Map<string, boolean>;
export function iso(v: unknown): string;
export function normTarget(v: unknown): string; export function normSha(v: unknown): string; export function sameSha(a: unknown, b: unknown): boolean; export function deployId(target: string, at: string, sha: string): string;
export function normDeploy(v: unknown, opts?: { now?: string }): Deploy | null;
export function validateDeploy(v: unknown): { ok: boolean; errors: Array<{ field: string; message: string }> }; export function rejection(errors: Array<{ message: string }>): string;
export function parseLog(text: string): { records: Deploy[]; skipped: number }; export function toLine(d: unknown): string;
export function sortDeploys(records: unknown[]): Deploy[]; export function mergeLogs(a: unknown[], b: unknown[]): Deploy[]; export function latestPerTarget(records: unknown[]): Record<string, Deploy>; export function targetsIn(records: unknown[]): string[];
export function firstContaining(records: unknown[], target: string, mergeSha: string, contains: Contains): Deploy | null;
export function liveAt(records: unknown[], mergeSha: string, contains: Contains): Record<string, LiveEntry>; export function firstLive(live: Record<string, LiveEntry> | undefined): string; export function dateMark(at: string, guessed?: boolean): string;
export const REGISTRY: Readonly<Record<string, unknown>>;
export function jsonSchemas(): Record<string, object>;
