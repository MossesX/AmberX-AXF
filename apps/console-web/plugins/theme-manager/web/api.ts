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
