/* Icon Browser — web API layer: the library is read from the console server (never bundled); packs are cached per id. */
import { pluginApi } from '@console/plugins';
import { FOLDER, cleanConfig, type Config, type IconRecord, type Library } from './model';

const api = pluginApi(FOLDER, 'The Icon Browser');
export const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);

export interface SearchResult { total: number; offset: number; items: IconRecord[]; categories: Record<string, number> }
export interface IconPackAsset { $axf: 'asset@1'; type: 'icon-pack'; id: string; name: string; version: string; description?: string; author?: string; tags?: string[]; data: { style: string; grid: number; stroke?: number; linecap?: string; fallback?: string; glyphs: Record<string, unknown> } }
export interface IconMapAsset { $axf: 'asset@1'; type: 'icon-map'; id: string; name: string; version: string; description?: string; author?: string; tags?: string[]; data: { scope: { app?: string; ui?: string; plugin?: string }; extends?: string; pack?: string; slots: Record<string, string> }; shipped?: string }
export interface IconSourceAsset { $axf: 'asset@1'; type: 'icon-source'; id: string; name: string; version: string; description?: string; author?: string; tags?: string[]; data: { kind: string; label?: string; root: string; auth?: { mode: string; secretRef?: string }; options?: Record<string, unknown>; format?: string; enabled?: boolean } }

let library: Promise<Library> | null = null;
export function loadLibrary(fresh = false): Promise<Library> {
  if (fresh || !library) { library = call<Library>('library'); library.catch(() => { library = null; }); }
  return library;
}

export function search(p: { q?: string; set?: string; category?: string; style?: string; limit?: number; offset?: number; sort?: string }): Promise<SearchResult> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
  return call<SearchResult>(`search?${qs.toString()}`);
}

const packs = new Map<string, Promise<IconPackAsset>>();
/** One icon-pack asset (library or saved), once per page load. */
export function loadPack(id: string): Promise<IconPackAsset> {
  let p = packs.get(id);
  if (!p) { p = call<IconPackAsset>(`pack/${encodeURIComponent(id)}`); p.catch(() => packs.delete(id)); packs.set(id, p); }
  return p;
}
export const forgetPack = (id: string) => { packs.delete(id); };

export const loadConfig = async (): Promise<Config> => cleanConfig(await call<unknown>('config'));
export const saveConfig = async (patch: Partial<Config>): Promise<Config> => cleanConfig(await call<unknown>('config', { method: 'PUT', body: JSON.stringify(patch) }));

export const listPacks = () => call<{ items: IconPackAsset[] }>('packs').then((r) => r.items ?? []);
export const savePack = (a: IconPackAsset) => call<{ ok: true; id: string; count: number }>(`packs/${encodeURIComponent(a.id)}`, { method: 'PUT', body: JSON.stringify(a) }).then((r) => { forgetPack(a.id); library = null; return r; });
export const deletePack = (id: string) => call<{ ok: true; removed: boolean }>(`packs/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => { forgetPack(id); library = null; return r; });

export const listMaps = () => call<{ items: IconMapAsset[] }>('maps').then((r) => r.items ?? []);
export const saveMap = (a: IconMapAsset) => call<{ ok: true; id: string; slots: number }>(`maps/${encodeURIComponent(a.id)}`, { method: 'PUT', body: JSON.stringify(a) });
export const deleteMap = (id: string) => call<{ ok: true; removed: boolean }>(`maps/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const listSources = () => call<{ items: IconSourceAsset[] }>('sources').then((r) => r.items ?? []);
export const saveSource = (a: IconSourceAsset) => call<{ ok: true; id: string }>(`sources/${encodeURIComponent(a.id)}`, { method: 'PUT', body: JSON.stringify(a) });
export const deleteSource = (id: string) => call<{ ok: true; removed: boolean }>(`sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const testSource = (id: string) => call<{ ok: boolean; detail: string }>(`sources/${encodeURIComponent(id)}/test`, { method: 'POST', body: '{}' });
export const listSecrets = () => call<{ refs: string[] }>('secrets').then((r) => r.refs ?? []);
export const setSecret = (ref: string, value: string) => call<{ ok: true; ref: string }>(`secrets/${encodeURIComponent(ref)}`, { method: 'POST', body: JSON.stringify({ value }) });
export const deleteSecret = (ref: string) => call<{ ok: true; removed: boolean }>(`secrets/${encodeURIComponent(ref)}`, { method: 'DELETE' });
export const importFolder = (body: { source?: string; folder?: string; id: string; name?: string; style?: string; grid?: number; stroke?: number; category?: string }) => call<{ ok: true; count?: number; skipped?: Record<string, number>; packs?: { id: string; count: number }[] }>('import', { method: 'POST', body: JSON.stringify(body) }).then((r) => { library = null; return r; });
