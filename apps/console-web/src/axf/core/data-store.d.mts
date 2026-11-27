/** Types for data-store.mjs (data-store@1: the axf-data client; spec framework/spec/DATA-STORE.md). */
export const SCHEMA: 'data-store@1';
export const VERSION: 1;
export const FRAMES: string[];
export type Kind = 'record' | 'blob' | 'journal';
export const KINDS: Kind[];
export const OPS: string[];
export const CHANGE_OPS: Array<'put' | 'delete' | 'append'>;
export type Grant = 'read' | 'write' | 'append' | 'admin';
export const GRANTS: Grant[];
export const SERVICES: string[];
export type Mode = 'local' | 'shadow' | 'cutover' | 'rollback';
export const MODES: Mode[];
export const NAMESPACES: Readonly<Record<string, { label: string; kinds: Kind[]; today: string; open?: boolean; internal?: boolean }>>;
export const LIMITS: Readonly<Record<string, number>>;
export type ErrorCode = 'invalid_key' | 'invalid_body' | 'too_large' | 'precondition_required' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'exists' | 'read_only' | 'cursor_expired' | 'rate_limited' | 'unavailable' | 'internal';
export const ERRORS: Readonly<Record<ErrorCode, { status: number; retry: string }>>;
export const RETRY: Readonly<{ baseMs: number; factor: number; tries: number; maxMs: number; conflictTries: number }>;
export const TOKEN: Readonly<{ alg: string; typ: string; iss: string; aud: string; keys: string; subPrefix: string }>;
export const PATTERNS: Readonly<Record<string, string>>;

export interface DataRecord { $axf: 'data-record@1'; ns: string; path: string; kind: 'record' | 'blob'; rev: number; etag: string; at: string; by: string; size: number; contentType: string; deleted: boolean; data?: unknown }
export interface DataEntry { $axf: 'data-entry@1'; ns: string; path: string; seq: number; at: string; by: string; entry: unknown }
export interface DataEntries { $axf: 'data-entries@1'; ns: string; path: string; entries: DataEntry[]; next: number }
export interface DataAppend { $axf: 'data-append@1'; ns: string; path: string; first: number; last: number; count: number }
export interface DataList { $axf: 'data-list@1'; ns: string; prefix: string; items: DataRecord[]; next: string; total?: number }
export interface DataChange { $axf: 'data-change@1'; cursor: number; ns: string; path: string; kind: Kind; op: 'put' | 'delete' | 'append'; rev: number; etag: string; seq?: number; at: string; by: string }
export interface NamespaceManifest { count: number; bytes: number; hash: string; journals?: Record<string, { entries: number; hash: string }> }
export interface DataManifest { $axf: 'data-manifest@1'; id: string; at: string; by: string; mode: Mode; namespaces: Record<string, NamespaceManifest> }
export interface DataError { $axf: 'data-error@1'; code: ErrorCode; message: string; ns?: string; path?: string; rev?: number; etag?: string; retryAfterMs?: number }
export interface DataHealth { $axf: 'data-health@1'; ok: boolean; cursor: number; uptimeMs: number; volume: { freeBytes: number; totalBytes: number }; keys: { verified: boolean; fetchedAt: string } }

export class DataStoreError extends Error { code: ErrorCode; status: number; ns?: string; path?: string; rev?: number; etag?: string; retryAfterMs?: number; frame(): DataError }
export function errorFrame(code: string, message: string, extra?: Partial<DataError>): DataError;
export function parseKey(key: string): { ns: string; path: string; folder?: string };
export function parseNamespace(ns: string): { ns: string; prefix: string };
export function etagOf(rev: number, body: unknown): string;
export function normIfMatch(v: unknown): string;
export function canonical(v: unknown): string;
export function journalEtag(lines: unknown[]): string;
export function manifestOf(items: Array<{ path: string; etag: string; size?: number; kind?: Kind; entries?: number; deleted?: boolean }>): NamespaceManifest;
export function sameManifest(a: unknown, b: unknown): { equal: boolean; diffs: Array<Record<string, unknown>> };
export function backoffMs(attempt: number, rnd?: () => number, retry?: typeof RETRY): number;
export function registry(): Record<string, unknown>;
export function pluginKey(folder: string, rel: string): string;
export function kindOfFile(rel: string): Kind;

export interface Backend {
  name: string;
  get(ns: string, path: string, o?: { deleted?: boolean }): Promise<{ meta: Omit<DataRecord, '$axf'>; bytes: Uint8Array | null }>;
  put(ns: string, path: string, data: unknown, o?: PutOptions): Promise<DataRecord>;
  delete(ns: string, path: string, o?: { ifMatch?: string | number; force?: boolean; by?: string }): Promise<DataRecord>;
  list(ns: string, o?: ListOptions): Promise<DataList>;
  append(ns: string, path: string, entries: unknown[], o?: { idempotencyKey?: string; by?: string }): Promise<DataAppend>;
  read(ns: string, path: string, o?: { since?: number; limit?: number; tail?: number }): Promise<DataEntries>;
  changes(o?: { since?: number; ns?: string | string[]; prefix?: string; limit?: number }): Promise<{ changes: DataChange[]; cursor: number }>;
  manifest(ns: string): Promise<NamespaceManifest>;
  snapshot(namespaces?: string[], o?: { by?: string; mode?: Mode }): Promise<DataManifest>;
  health(): Promise<DataHealth>;
}
export interface PutOptions { ifMatch?: string | number; create?: boolean; force?: boolean; contentType?: string; by?: string }
export interface ListOptions { prefix?: string; after?: string; limit?: number; deleted?: boolean }
export function engineBackend(storage: Record<string, (...a: unknown[]) => Promise<unknown>>, opts?: { now?: () => string; by?: string; name?: string }): Backend;
export function memoryBackend(opts?: { now?: () => string; by?: string }): Backend;
export function fileBackend(opts?: { dir?: string; now?: () => string; by?: string }): Promise<Backend>;
export function httpBackend(opts: { url: string; token?: string | (() => string); actor?: string; fetch?: typeof fetch }): Backend;

export interface DataStore {
  backend: Backend;
  get(key: string, o?: { deleted?: boolean }): Promise<DataRecord | null>;
  put(key: string, data: unknown, o?: PutOptions): Promise<DataRecord>;
  update(key: string, fn: (data: unknown, record: DataRecord | null) => unknown | Promise<unknown>, o?: { create?: boolean; tries?: number; contentType?: string }): Promise<DataRecord | null>;
  delete(key: string, o?: { ifMatch?: string | number; force?: boolean }): Promise<DataRecord>;
  list(ns: string, o?: ListOptions): Promise<DataList>;
  append(key: string, entries: unknown[], o?: { idempotencyKey?: string }): Promise<DataAppend>;
  read(key: string, o?: { since?: number; limit?: number; tail?: number }): Promise<DataEntries>;
  changes(o?: { since?: number; ns?: string | string[]; prefix?: string; limit?: number }): Promise<{ changes: DataChange[]; cursor: number }>;
  watch(o: { ns?: string | string[]; prefix?: string; since?: number; intervalMs?: number; onError?: (e: Error) => void }, onChange: (c: DataChange) => void | Promise<void>): { close(): void; cursor(): number; ready: Promise<void> };
  snapshot(namespaces?: string[], o?: { mode?: Mode }): Promise<DataManifest>;
  manifest(ns: string): Promise<NamespaceManifest>;
  health(): Promise<DataHealth>;
}
export function createDataStore(o: { backend: Backend; by?: string; onUnauthorized?: (e: DataStoreError) => void | Promise<void>; sleep?: (ms: number) => Promise<void>; rnd?: () => number }): DataStore;
