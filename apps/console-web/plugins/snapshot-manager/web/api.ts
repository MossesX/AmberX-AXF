/* Snapshot Manager — web API layer. */
import { pluginApi } from '@console/plugins';

export const FOLDER = 'snapshot-manager';
export const ID = 'ai.amberx.axf.console.snapshot-manager';

export interface Entry { n: number; path: string; existed: boolean; isDir?: boolean; files?: number; skipped?: number; rawBytes?: number; bytes?: number }
export interface Snapshot {
  id: string; container: string; paths: string[]; entries: Entry[]; bytes: number; createdAt: number; reason: string; batch?: string | null;
  actor: { kind: string; id: string; name: string }; meta?: Record<string, unknown>; restores?: { at: number; by: { name: string }; before: string }[];
}
export interface Usage { count: number; bytes: number; capBytes: number; keepDays: number; oldest: number | null }
export interface Settings { keepDays: number; maxGb: number; maxSnapshotMb: number; exclude: string[] }
export interface DiffEntry { path: string; existed: boolean; existsNow: boolean; added?: string[]; removed?: string[]; changed?: string[]; counts?: { added: number; removed: number; changed: number } }
export interface FileDiff { file: string; then: boolean; now: boolean; diff: { text: string; truncated?: boolean; binary?: boolean; added: number; removed: number } }

const api = pluginApi(FOLDER, 'Snapshot Manager');
export const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);
export const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' });

export const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

/* The snapshot the settings tab should open (set by the `snapshots.show:<id>` action). */
let focus = '';
const subs = new Set<() => void>();
export const setFocus = (id: string) => { focus = id; subs.forEach((f) => f()); };
export const getFocus = () => focus;
export const onFocus = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
