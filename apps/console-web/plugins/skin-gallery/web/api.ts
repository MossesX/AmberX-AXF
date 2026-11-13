/** The Skins plugin's REST routes (server/__init__.py): the same skin-switch@1 commands the CLI, MCP and voice send. */
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'skin-gallery';

export interface SkinRow { id: string; name: string; kind: 'skin' | 'design-package'; description: string; iconPack: string; parts: string[]; inForceAt: string[] }
export interface ScopeView {
  app: string;
  scope: string;
  key: string;
  state: { use: string; id: string; overrides: Record<string, string>; colorTheme?: string };
  inForce: { id: string; from: string; colorTheme?: string };
  known: boolean;
  overridden: string[];
  canUndo: boolean;
  undo: { action: string; scope: string; at: string } | null;
  changed?: { look: boolean; global: boolean };
}
type Answer<T> = { ok: true; result: T } | { ok: false; error: string; code?: string };

async function call<T>(path: string, body?: Record<string, string>): Promise<T> {
  const r = await pluginFetch(FOLDER, path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as Answer<T>;
  if (!j.ok) throw new Error(j.error);
  return j.result;
}

export const listSkins = () => call<SkinRow[]>('skins');
export const listScopes = () => call<string[]>('scopes');
export const readState = (scope: string) => call<ScopeView>(`state?scope=${encodeURIComponent(scope)}`);
export const useSkinAt = (skin: string, scope: string) => call<ScopeView>('use', { skin, scope });
export const backAt = (scope: string) => call<ScopeView>('back', { scope });
export const restoreAt = (scope: string) => call<ScopeView>('restore', { scope });
export const undoLast = () => call<ScopeView>('undo', {});
