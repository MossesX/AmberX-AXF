import { useSyncExternalStore } from 'react';

/*
 * The Build manager's search words and its Collapse all / Expand all (Brett, Nov 9 2026: "I need to collapse all"), in
 * one store so the page and the console actions (build-manager.search / clear-search / collapse-all / expand-all /
 * view-state, reached by REST, MCP console_action, the CLI and voice) do the same thing. A collapse or expand is a
 * numbered command the open list applies to the rows it shows; the open rows are read back through `openCount`.
 */

export type ViewState = { query: string; cmd: { op: 'collapse' | 'expand'; n: number } | null; openCount: number; shown: number };
let st: ViewState = { query: '', cmd: null, openCount: 0, shown: 0 };
const subs = new Set<() => void>();
function set(patch: Partial<ViewState>) { st = { ...st, ...patch }; for (const f of subs) f(); }

export const viewState = () => st;
let applied = 0;
/** The command not yet applied by a list (once each: a list mounted later doesn't replay an old one). */
export function takeCmd(): ViewState['cmd'] { const c = st.cmd; if (!c || c.n === applied) return null; applied = c.n; return c; }
export function useViewState(): ViewState { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st); }
export const setQuery = (query: string) => set({ query: query.slice(0, 200) });
export const collapseAll = (op: 'collapse' | 'expand') => set({ cmd: { op, n: (st.cmd?.n ?? 0) + 1 } });
/** The list reports what it shows, so the read-back says how many rows are open. */
export const reportRows = (openCount: number, shown: number) => { if (openCount !== st.openCount || shown !== st.shown) set({ openCount, shown }); };
export const describe = (s: ViewState = st) => `Build manager: ${s.query ? `search "${s.query}"` : 'no search'} · ${s.shown} rows shown, ${s.openCount} open`;
