import { useSyncExternalStore } from 'react';
import * as consoleApi from '@console/api';

/*
 * What the Build orchestrator page shows (Brett, Nov 9 2026: "Is there no search bar in the orchestrator? I need to
 * collapse all."): the tab, the search words, which section headers (Accounts, Pending, Queue, Building, the Builds
 * grid's categories) are collapsed and whether rows (Pipeline cards, Builds grid rows) are folded. One store, so the
 * page, the console actions (build-orchestrator.search / collapse-all / expand-all / section / open, reached by REST,
 * MCP console_action, the CLI and voice) and the read-back (build-orchestrator.view-state) all say the same thing.
 * Tab, sections and the row mode are remembered across reloads; the search is not.
 *
 * A section is collapsed when `sectionsAll` XOR the id is in `sectionFlip`; a Pipeline card is folded when `rowsAll` XOR
 * `p:<id>` is in `rowFlip`; a Builds grid row is open when `gridOpenAll` XOR `g:<id>` is in `rowFlip`. Collapse all / Expand all set the "all" flag and clear the flips, so they work on rows and sections
 * that appear later too.
 */

export const TAB_IDS = ['pipeline', 'builds', 'approvals', 'rules'] as const;
export type Tab = (typeof TAB_IDS)[number];
export type ViewState = { tab: Tab; query: string; sectionsAll: boolean; sectionFlip: string[]; rowsAll: boolean; gridOpenAll: boolean; rowFlip: string[] };

const KEY = 'orch-view-state';
const saved = consoleApi.readLocal<Partial<ViewState>>(KEY, {});
let st: ViewState = {
  tab: TAB_IDS.includes(saved.tab as Tab) ? (saved.tab as Tab) : consoleApi.readLocal<Tab>('orch-tab', 'pipeline'),
  query: '',
  sectionsAll: !!saved.sectionsAll,
  sectionFlip: Array.isArray(saved.sectionFlip) ? saved.sectionFlip.filter((x) => typeof x === 'string') : [],
  rowsAll: !!saved.rowsAll,
  gridOpenAll: !!saved.gridOpenAll,
  rowFlip: [],
};
const subs = new Set<() => void>();
function set(patch: Partial<ViewState>) {
  st = { ...st, ...patch };
  const { tab, sectionsAll, sectionFlip, rowsAll, gridOpenAll } = st;
  consoleApi.writeLocal(KEY, { tab, sectionsAll, sectionFlip, rowsAll, gridOpenAll });
  for (const f of subs) f();
}
const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export const viewState = () => st;
export function useViewState(): ViewState { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st); }
export const setTab = (tab: Tab) => set({ tab });
/** Search words; a search on Approvals or Rules moves to the Builds tab (those tabs don't filter). */
export const setQuery = (query: string) => set({ query: query.slice(0, 200), ...(query && (st.tab === 'approvals' || st.tab === 'rules') ? { tab: 'builds' as Tab } : {}) });
export const isSectionCollapsed = (s: ViewState, id: string) => s.sectionsAll !== s.sectionFlip.includes(id);
/** A Pipeline card (open by default). */
export const isRowFolded = (s: ViewState, id: string) => s.rowsAll !== s.rowFlip.includes(`p:${id}`);
/** A Builds grid row (closed by default: its detail is the whole step grid). */
export const isGridOpen = (s: ViewState, id: string) => s.gridOpenAll !== s.rowFlip.includes(`g:${id}`);
export const toggleSection = (id: string) => set({ sectionFlip: flip(st.sectionFlip, id) });
export const toggleRow = (id: string) => set({ rowFlip: flip(st.rowFlip, `p:${id}`) });
export const toggleGridRow = (id: string) => set({ rowFlip: flip(st.rowFlip, `g:${id}`) });
export type Scope = 'all' | 'rows' | 'sections';
/** Collapse all / Expand all: rows, sections or both (the page's buttons do both). */
export function collapseAll(op: 'collapse' | 'expand', scope: Scope = 'all') {
  const on = op === 'collapse';
  set({ ...(scope !== 'rows' ? { sectionsAll: on, sectionFlip: [] } : {}), ...(scope !== 'sections' ? { rowsAll: on, gridOpenAll: !on, rowFlip: [] } : {}) });
}
/** Collapse, expand or toggle one section by id (pl:accounts, pl:pending, pl:queued, pl:building, cat:<category>). */
export function setSection(id: string, op: 'collapse' | 'expand' | 'toggle' = 'toggle') {
  const want = op === 'toggle' ? !isSectionCollapsed(st, id) : op === 'collapse';
  if (want !== isSectionCollapsed(st, id)) toggleSection(id);
}
/** One line for voice and the read-back action. */
export function describe(s: ViewState = st): string {
  const sec = s.sectionsAll ? `sections collapsed${s.sectionFlip.length ? ` except ${s.sectionFlip.join(', ')}` : ''}` : s.sectionFlip.length ? `collapsed: ${s.sectionFlip.join(', ')}` : 'every section open';
  const rows = s.rowsAll && !s.gridOpenAll ? 'rows collapsed' : !s.rowsAll && s.gridOpenAll ? 'rows expanded' : 'rows as picked';
  const some = s.rowFlip.length ? ` (${s.rowFlip.length} toggled by hand)` : '';
  return `Orchestrator: ${s.tab} tab · ${s.query ? `search "${s.query}"` : 'no search'} · ${sec} · ${rows}${some}`;
}
