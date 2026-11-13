/*
 * UI Manager window state: one small store shared by the floating window, the page, the actions (rt.dispatch, voice,
 * the console API) and the picker, so "select the main toolbar" from any of them lands in the same place. Pure data,
 * no React.
 */

export type ViewMode = 'row' | 'panel' | 'grid';
export type SortKey = 'label' | 'kind' | 'category' | 'overrides';

export interface UiState {
  /** the selected element id (a shortcut in On screen now selects the element it points at, never a copy) */
  selected: string;
  view: ViewMode;
  q: string;
  sort: SortKey;
  desc: boolean;
  /** multi-filter: kinds, categories, plugins (empty = all), and "only what carries overrides" / "only on screen" */
  kinds: string[];
  categories: string[];
  plugins: string[];
  overriddenOnly: boolean;
  onScreenOnly: boolean;
  /** collapsed category ids (the tree starts with every category open except the big ones) */
  collapsed: string[];
  /** property search / filter inside the opened element */
  propQ: string;
  propGroups: string[];
  /** inspector: the next click on the console picks an element */
  picking: boolean;
  /** bumps when something outside (an action, the API) changed the saved overrides, so open rows reload */
  rev: number;
}

export const DEFAULT_STATE: UiState = {
  selected: '', view: 'row', q: '', sort: 'label', desc: false, kinds: [], categories: [], plugins: [], overriddenOnly: false, onScreenOnly: false,
  collapsed: [], propQ: '', propGroups: [], picking: false, rev: 0,
};

const KEY = 'ui-manager.window';
const PERSIST: (keyof UiState)[] = ['view', 'sort', 'desc', 'collapsed'];

function load(): UiState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<UiState>;
    const out = { ...DEFAULT_STATE };
    for (const k of PERSIST) if (raw[k] !== undefined) (out as Record<string, unknown>)[k] = raw[k];
    return out;
  } catch { return { ...DEFAULT_STATE }; }
}

let state: UiState = typeof localStorage === 'undefined' ? { ...DEFAULT_STATE } : load();
const listeners = new Set<() => void>();

export const getUi = (): UiState => state;
export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(PERSIST.map((k) => [k, state[k]])))); } catch { /* private mode */ }
  listeners.forEach((f) => f());
}
export const subscribeUi = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
