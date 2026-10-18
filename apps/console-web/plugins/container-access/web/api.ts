/* Container access — web API layer. */
import { pluginFetch } from '@console/plugins';
import { readEventStream, type Batch, type BatchEvent } from '@console/changeBatch';

export const FOLDER = 'container-access';
export const ID = 'ai.amberx.axf.console.container-access';

export interface Protection { rule: string; label: string; locked: boolean }
export interface Container { id: string; name: string; image: string; state: string; status: string; labels: Record<string, string>; protected: Protection | null; reachable: boolean; coolify: string | null }
export interface Settings { reach: 'all' | 'list'; allow: string[]; protect: string[]; maxReadKb: number; execTimeout: number; terminalUser: string }
export interface Status { proxy: { ok: boolean; url: string; docker?: string; api?: string; error?: string }; snapshots: boolean; coolify: boolean; settings: Settings; builtinProtected: { id: string; label: string }[] }
export interface Entry { name: string; type: 'dir' | 'file' | 'link'; size: number }
export interface AuditEntry { at: number; op: string; actor?: { kind: string; id: string; name: string }; container?: { id: string; name: string }; path?: string; command?: string; ok?: boolean; error?: string; exitCode?: number | null; snapshot?: string; batch?: string; [k: string]: unknown }

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Settings → Account & security).');
  if (r.status === 404 && !j.detail) throw new Error('Container access is disabled or its server part is not running.');
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.statusText));
  return j;
}
export const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const batchActions = (id: string) => ({
  approve: async (items: string[], onEvent: (e: BatchEvent) => void): Promise<Batch | null> => {
    let last: Batch | null = null;
    const r = await pluginFetch(FOLDER, `batches/${id}/approve`, { method: 'POST', body: JSON.stringify({ items }) });
    await readEventStream(r, (e) => { if (e.type === 'batch' && e.batch) last = e.batch; onEvent(e); });
    return last;
  },
  reject: () => post<Batch>(`batches/${id}/reject`),
  undo: () => post<Batch>(`batches/${id}/undo`, { confirm: 'undo' }),
});

export const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
export const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
