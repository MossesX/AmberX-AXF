/* Asset designer — web API layer. Designed assets live on the console server, in the plugin's data folder. */
import { pluginApi } from '@console/plugins';
import type { AxfRuntime } from '@console/axf/core/runtime';

export const FOLDER = 'asset-designer';
export const ID = 'ai.amberx.axf.console.asset-designer';
export const VIEW = 'asset-designer';
/** The runtime origin every asset this plugin registers carries. */
export const ORIGIN = 'asset-designer';

export interface DesignedManifest { $axf: 'designed@1'; uid: string; ref: string; type: string; id: string; name: string; version: string; addon: string; designer: string; app?: string; by?: string; createdAt: string; updatedAt: string; revision: number; registry: { kind: string; id: string; aliases: string[] }; hash: string; extras?: Record<string, unknown>; origin?: Record<string, unknown> }
export interface SavedAsset { $axf: 'asset@1'; type: string; id: string; name: string; version: string; description?: string; author?: string; tags?: string[]; roll?: boolean; data: Record<string, unknown>; designed?: DesignedManifest }
export interface ValidateResult { ok: boolean; errors: string[] }

const api = pluginApi(FOLDER, 'The asset designer');
export const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);
export const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' });

/** Every saved asset, registered into the running console (origin asset-designer) so slots, pickers and skins see them. */
export async function loadSaved(rt: AxfRuntime): Promise<SavedAsset[]> {
  const r = await call<{ items: SavedAsset[] }>('assets').catch(() => ({ items: [] as SavedAsset[] }));
  for (const a of r.items) rt.registry.register(a, 'imported', ORIGIN);
  return r.items;
}
