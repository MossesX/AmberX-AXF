/* Fable rebuilds — web API layer plus a small cache the context menu reads synchronously. */
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'fable-rebuilds';
export const ID = 'ai.amberx.axf.console.fable-rebuilds';

export interface Rebuild {
  id: string; title: string; detail: string; status: string; model: string; planId?: string; source?: string; createdAt: string; builtAt: string;
  notes: { text: string; at: string }[]; subPrompts: { text: string; at: string }[];
  replaces: { folder: string; name: string; uninstall: string } | null;
  branch: string; report: boolean; android: boolean; log: string[]; brief: string;
}
export interface Data { items: Rebuild[]; counts: Record<string, number>; log: string[]; byPlugin: Record<string, string>; byPlan: Record<string, string> }

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Settings → Account & security).');
  if (r.status === 404 && !j.detail) throw new Error('Fable rebuilds is switched off or its server part is not running.');
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.statusText));
  return j;
}

let data: Data | null = null;
let focus = '';
const subs = new Set<() => void>();
export const getData = () => data;
export const onData = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const setFocus = (id: string) => { focus = id; subs.forEach((f) => f()); };
export const takeFocus = () => { const f = focus; focus = ''; return f; };
export async function refresh(): Promise<Data | null> {
  try { data = await call<Data>('items'); } catch { data = null; }
  subs.forEach((f) => f());
  return data;
}
export async function park(body: { plugin?: string; planId?: string; title?: string; note?: string }) {
  const r = await call<{ item: Rebuild }>('park', { method: 'POST', body: JSON.stringify(body) });
  await refresh();
  window.dispatchEvent(new CustomEvent('axf:pending-changed'));
  return r.item;
}
