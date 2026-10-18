/* Theme manager — web API layer (saved themes + roll presets live on the console server, in the plugin's data folder). */
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'theme-manager';
export const ID = 'ai.amberx.axf.console.theme-manager';

export interface SavedTheme { $axf: 'asset@1'; type: string; id: string; name: string; version: string; description?: string; author?: string; tags?: string[]; data: Record<string, unknown> }

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Settings → Account & security).');
  if (r.status === 404 && !j.detail) throw new Error('The theme manager is disabled or its server part is not running.');
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.statusText));
  return j;
}
export const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' });
