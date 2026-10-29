/* Brand library — web API layer: the library is read from the console server (never bundled), cached per type. */
import { pluginApi } from '@console/plugins';
import { FOLDER, cleanConfig, type BrandType, type Config, type LibAsset } from './model';

const api = pluginApi(FOLDER, 'The brand library');
export const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);

export interface LibIndex { types: Record<BrandType, { count: number; facets: Record<string, string[]> }> }

const cache = new Map<BrandType, Promise<LibAsset[]>>();

/** Every asset of one type (one request per type per page load). */
export function loadType(t: BrandType): Promise<LibAsset[]> {
  let p = cache.get(t);
  if (!p) {
    p = call<{ items: LibAsset[] }>(`assets/${t}`).then((r) => r.items ?? []);
    p.catch(() => cache.delete(t));
    cache.set(t, p);
  }
  return p;
}

export const loadIndex = () => call<LibIndex>('index');
export const loadClosure = (t: BrandType, id: string) => call<{ items: LibAsset[]; missing: string[] }>(`closure/${t}/${id}`);
export const loadConfig = async (): Promise<Config> => cleanConfig(await call<unknown>('config'));
export const saveConfig = async (patch: Partial<Config>): Promise<Config> => cleanConfig(await call<unknown>('config', { method: 'PUT', body: JSON.stringify(patch) }));
