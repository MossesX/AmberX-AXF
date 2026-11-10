/**
 * The plugin's server calls and the shapes they answer (server/__init__.py → engine.mjs). Every UI action goes through
 * these, the same routes the plugin commands (REST, MCP, CLI) and the voice commands reach.
 */
import { pluginApi } from '@console/plugins';

export const FOLDER = 'inline-edit';
export const api = pluginApi(FOLDER, 'Inline edit');

/** Fired on window after anything here changes overrides, so the applier, the dialog and the list refresh at once. */
export const CHANGED_EVENT = 'axf:inline-edit-changed';
export const changed = () => globalThis.dispatchEvent(new Event(CHANGED_EVENT));

export type Scope = 'item' | 'parent';
export type ViewKind = 'tree' | 'classic' | 'grid';
export type TokenValue = string | number | boolean | null;

export interface ModeState { on: boolean; by: string; at: string; changed?: boolean }
export interface TokenSource { layer: string; where: string; detail?: string; key?: string; path?: string; scope?: Scope; by?: string; at?: string; id?: string }
export interface TokenRow {
  token: string; label: string; group: string; kind: string; default: TokenValue; value: TokenValue; axHubValue: TokenValue;
  source: TokenSource; axHubSource: TokenSource; overridden: boolean; overriddenAt?: string;
  options?: string[]; min?: number; max?: number; step?: number; unit?: string;
}
export interface ElementNode { path: string; role: string; kind: string; instance: string; type: string | null; label: string; rootText: string; tokens: TokenRow[] }
export interface ElementTokens { path: string; root: string; chain: ElementNode[]; note: string; scope: Scope }
export interface ElementUi { path: string; scope: Scope; view: ViewKind }

export interface OverrideItem {
  id: string; root: string; path: string; scope: Scope; token: string; asset: string | null; value: TokenValue; axHubValue: TokenValue;
  by: string; at: string; reason: string; kind: string; kindLabel: string; role: string; label: string; tokenLabel: string; tokenKind: string; group: string; app: string;
}
export interface TreeNode { path: string; label: string; role: string; count: number; records: string[]; children: TreeNode[] }
export interface OverridesTab { id: string; root: string; label: string }
export type Filter = Partial<Record<'app' | 'kind' | 'role' | 'tokenKind' | 'group' | 'token' | 'scope' | 'by' | 'since' | 'until', string>>;
export interface OverridesList {
  total: number; shown: number; q: string; filter: Filter; root: string; tab: string; tabs: OverridesTab[];
  items: OverrideItem[]; tree: TreeNode[]; roots: { path: string; count: number; depth: number }[];
  rootKinds: { kind: string; label: string; type: string }[]; facets: Record<string, { value: string; count: number }[]>; filters: string[];
}

export const getMode = () => api.call<ModeState>('mode');
export const setMode = (state: 'on' | 'off' | 'toggle') => api.put<ModeState>('mode', { state });
export const getTokens = (path: string) => api.call<ElementTokens>(`tokens?path=${encodeURIComponent(path)}`);
export const setToken = (b: { path: string; token: string; value: TokenValue; scope: Scope; reason?: string }) => api.put<unknown>('tokens', { ...b, app: 'console-web' }).then((r) => { changed(); return r; });
export const unsetToken = (b: { path: string; token: string; scope: Scope }) => api.post<unknown>('tokens/unset', b).then((r) => { changed(); return r; });
export const getElementUi = () => api.call<ElementUi>('element');
export const setElementUi = (b: Partial<ElementUi>) => api.put<ElementUi>('element', b);
export const listOverrides = (q: { root?: string; q?: string; filter?: Filter; tab?: string } = {}) => {
  const p = new URLSearchParams();
  if (q.root !== undefined) p.set('root', q.root);
  if (q.q !== undefined) p.set('q', q.q);
  if (q.filter !== undefined) p.set('filter', JSON.stringify(q.filter));
  if (q.tab !== undefined) p.set('tab', q.tab);
  const s = p.toString();
  return api.call<OverridesList>(`overrides${s ? `?${s}` : ''}`);
};
export const setOverridesState = (b: { q?: string; filter?: Filter; root?: string; tab?: string }) => api.put<unknown>('overrides/state', b);
export const addTab = (root: string, label?: string) => api.post<{ tab: OverridesTab; tabs: OverridesTab[] }>('overrides/tabs', { root, ...(label ? { label } : {}) });
export const removeTab = (id: string) => api.post<{ tabs: OverridesTab[] }>('overrides/tabs/close', { id });
export const resetItem = (id: string) => api.post<{ now: string }>('overrides/reset', { id }).then((r) => { changed(); return r; });

/** A deep-link argument: "path=…&scope=…&view=…" (console_open / console_dialog arg) or a bare element path. */
export function parseArg(arg: unknown): { path?: string; scope?: Scope; view?: ViewKind; root?: string; q?: string; filter?: string; tab?: string } {
  if (typeof arg !== 'string' || !arg.trim()) return {};
  const s = arg.trim().replace(/^\?/, '');
  if (!s.includes('=')) return { path: s };
  const p = new URLSearchParams(s);
  const out: Record<string, string> = {};
  for (const [k, v] of p) if (v) out[k] = v;
  return out as ReturnType<typeof parseArg>;
}

/** A deep-link argument for the overrides page → the list state it sets (root, q, filter, tab). */
export function overridesPatch(arg: string): { q?: string; filter?: Filter; root?: string; tab?: string } {
  const a = parseArg(arg);
  const patch: { q?: string; filter?: Filter; root?: string; tab?: string } = {};
  if (a.tab) patch.tab = a.tab;
  if (a.root !== undefined) patch.root = a.root;
  if (a.q !== undefined) patch.q = a.q;
  if (a.filter !== undefined) { try { patch.filter = JSON.parse(a.filter) as Filter; } catch { patch.filter = Object.fromEntries(new URLSearchParams(a.filter)) as Filter; } }
  return patch;
}
/** The window event the console client fires when a screen is opened with an argument (console-commands CONSOLE_VIEW_ARG_EVENT). */
export const VIEW_ARG_EVENT = 'axf:view-arg';
/** Take (and clear) the argument a deep link left for a screen. */
export function takeViewArg(view: string): string {
  const g = globalThis as unknown as { AXF_VIEW_ARGS?: Record<string, string> };
  const a = g.AXF_VIEW_ARGS?.[view] ?? '';
  if (g.AXF_VIEW_ARGS) delete g.AXF_VIEW_ARGS[view];
  return a;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
