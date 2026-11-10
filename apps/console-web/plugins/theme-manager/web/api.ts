/* Theme manager — web API layer (saved themes + roll presets live on the console server, in the plugin's data folder). */
import { pluginApi } from '@console/plugins';

export const FOLDER = 'theme-manager';
export const ID = 'ai.amberx.axf.console.theme-manager';

export interface SavedTheme { $axf: 'asset@1'; type: string; id: string; name: string; version: string; description?: string; author?: string; tags?: string[]; data: Record<string, unknown> }

const api = pluginApi(FOLDER, 'The theme manager');
export const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);
export const post = <T,>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' });

/* ---- skin-sections@1: the slice library, skins from sections, export / import (server routes → REST, MCP, CLI by themselves) ---- */
export interface SliceRow { section: string; type: string; id: string; name: string; description: string; tags: string[]; source: string; usedBy: string[]; preview: { swatches?: string[]; facts?: string[] } }
export const listSlices = (category = '', q = '') => call<SliceRow[]>(`skins/sections?${new URLSearchParams({ ...(category ? { category } : {}), ...(q ? { q } : {}) })}`);
export const saveSection = (body: { section: string; id: string; name: string; description?: string; tags?: string[]; from?: string; data?: unknown }) => post<SavedTheme & { file: string }>('skins/sections', body);
export const buildSkin = (body: { id: string; name: string; description?: string; tags?: string[]; from?: string; sections: Record<string, string> }) => post<SavedTheme & { file: string }>('skins/build', body);
export const exportSkin = (id: string) => call<{ $axf: string; skin: SavedTheme; sections: SavedTheme[]; missing: string[] }>(`skins/export/${encodeURIComponent(id)}`);
export const importSkin = (pkg: unknown) => post<{ id: string; saved: string[]; notIncluded: string[] }>('skins/import', { package: pkg });
export const deleteTheme = (type: string, id: string) => del<{ ok: boolean }>(`themes/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
