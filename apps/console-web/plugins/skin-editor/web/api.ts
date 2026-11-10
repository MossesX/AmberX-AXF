/*
 * Skin editor: web API layer. Every read and action goes through the plugin's REST routes (/api/plugins/<folder>/checker),
 * which run the skin checker's one core, so the panel shows and does exactly what REST, MCP, the CLI and voice do.
 */
import { pluginApi } from '@console/plugins';
import type { SkinCheckResult } from '../../../../../packages/skin-checker/src/contract.ts';
import type { SkinCheckSettings } from '../../../../../packages/skin-checker/src/settings-schema.ts';

export const FOLDER = 'skin-editor';
export const ID = 'ai.amberx.axf.console.skin-editor';
export const VIEW = 'skin-editor';
/** The console action behind the deep link: `skin-editor.checker:<skin>:<issueId>` (issue ids contain ':'). */
export const OPEN_ACTION = 'skin-editor.checker';

export interface SkinListing { id: string; name: string; kind: 'skin' | 'design-package'; fixed: boolean; last: { score: number; grade: string; pass: boolean } | null }
export interface SettingsAnswer { settings: SkinCheckSettings; flat: Record<string, number | boolean>; changed: string[] }
export interface Applied { writes: { token: { type: string; id: string; path: string }; value: unknown }[]; fixed: string[]; unfixable: string[]; files: string[] }

const api = pluginApi(FOLDER, 'The skin editor');
const enc = encodeURIComponent;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listSkins = () => api.call<{ skins: SkinListing[] }>('checker/skins');
export const getState = (skin: string) => api.call<{ result: SkinCheckResult; cached: boolean }>(`checker/${enc(skin)}`);
export const runCheck = (skin: string) => api.call<{ result: SkinCheckResult }>(`checker/${enc(skin)}/check`, { method: 'POST' });
export const fixIssues = (skin: string, issues: string[]) => api.call<{ applied: Applied; result: SkinCheckResult }>(`checker/${enc(skin)}/fix`, json('POST', { issues }));
export const fixAll = (skin: string) => api.call<{ applied: Applied; result: SkinCheckResult }>(`checker/${enc(skin)}/fix-all`, { method: 'POST' });
export const setToken = (skin: string, token: string, value: string | number) => api.call<{ result: SkinCheckResult }>(`checker/${enc(skin)}/set`, json('POST', { token, value }));
export const getSettings = () => api.call<SettingsAnswer>('checker/settings');
export const putSetting = (key: string, value: unknown) => api.call<SettingsAnswer>('checker/settings', json('PUT', { key, value }));
export const resetSettings = () => api.call<SettingsAnswer>('checker/settings', { method: 'DELETE' });

/* The deep link: an action or `?skin=&issue=` in the address asks the panel for a skin and an issue. */
type Want = { skin: string; issue: string };
let want: Want | null = null;
const listeners = new Set<(w: Want) => void>();
export function requestOpen(skin: string, issue = ''): void {
  want = { skin, issue };
  for (const l of listeners) l(want);
}
export function takeRequest(): Want | null {
  const read = (k: string) => new URLSearchParams(globalThis.location?.search ?? '').get(k) ?? new URLSearchParams((globalThis.location?.hash ?? '').split('?')[1] ?? '').get(k);
  const w = want ?? (read('skin') ? { skin: read('skin') ?? '', issue: read('issue') ?? '' } : null);
  want = null;
  return w;
}
export function onRequest(fn: (w: Want) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
