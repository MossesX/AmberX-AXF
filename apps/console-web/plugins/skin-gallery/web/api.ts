/** The Skins plugin's REST routes (server/__init__.py): the same skin-switch@1 commands the CLI, MCP and voice send. */
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'skin-gallery';
export const PLUGIN_ID = 'ai.amberx.axf.console.skin-gallery';

export interface SkinRow { id: string; name: string; kind: 'skin' | 'design-package'; description: string; iconPack: string; parts: string[]; inForceAt: string[]; coverage: { covered: number; total: number } }
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
export interface AppRow { id: string; look: boolean }
type Answer<T> = { ok: true; result: T } | { ok: false; error: string; code?: string };

/** The acting app ('' = the console itself): its look document keeps the one undo record. */
let actingApp = '';
export const setActingApp = (app: string) => { actingApp = app; };
export const getActingApp = () => actingApp;

async function call<T>(path: string, body?: Record<string, string | boolean>): Promise<T> {
  const withApp = body ? { ...body, ...(actingApp ? { app: actingApp } : {}) } : null;
  const q = !body && actingApp ? `${path.includes('?') ? '&' : '?'}app=${encodeURIComponent(actingApp)}` : '';
  const r = await pluginFetch(FOLDER, `${path}${q}`, withApp ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withApp) } : {});
  const j = (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as Answer<T>;
  if (!j.ok) throw new Error(j.error);
  return j.result;
}

export const listSkins = () => call<SkinRow[]>('skins');
export const listApps = () => pluginFetch(FOLDER, 'apps').then((r) => r.json() as Promise<Answer<AppRow[]>>).then((j) => (j.ok ? j.result : []));
export const listScopes = () => call<string[]>('scopes');
export const readState = (scope: string) => call<ScopeView>(`state?scope=${encodeURIComponent(scope)}`);
export const useSkinAt = (skin: string, scope: string) => call<ScopeView>('use', { skin, scope });
export const backAt = (scope: string, slot = '') => call<ScopeView>('back', { scope, ...(slot ? { slot } : {}) });
export const restoreAt = (scope: string) => call<ScopeView>('restore', { scope });
export const undoLast = () => call<ScopeView>('undo', {});
export const followAt = (scope: string, follow: boolean) => call<ScopeView>('scope', { scope, follow });

/** How a scope reads to a person. */
export const scopeLabel = (s: string) => (s === 'hub' || s === 'global' ? 'the whole hub' : s.startsWith('app') ? (s.includes(':') ? `app ${s.slice(4)}` : 'this app') : s.startsWith('ui:') ? `screen ${s.slice(3)}` : s.startsWith('plugin:') ? `plugin ${s.slice(7)}` : s);
