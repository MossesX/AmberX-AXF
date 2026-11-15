/*
 * The UI Manager window (tab kind `ui-manager`, opened floating by web/window.ts). Left: the collapsible tree of every
 * element in the console (web/Tree.tsx; On screen now = shortcuts). Selecting one, or picking it on screen, opens it in
 * the chosen view: an expanding row under it (default), a side panel, or a grid of cards (web/Props.tsx). Every read
 * and write goes through the plugin's server part (lib/core.mjs), the same code the CLI, REST and MCP tools run.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Button, Note, Segmented, useRuntime } from '@console/axf/react';
import { facets as facetsOf, queryElements, queryTree } from '../lib/query.mjs';
import { refreshLive } from './apply';
import { pullState, shareSelection } from './bridge';
import { startPicker } from './picker';
import { ElementFilters } from './Filters';
import { Props } from './Props';
import { getUi, setUi, subscribeUi, type ViewMode } from './state';
import { Tree } from './Tree';
import { knownElements, useElements, type ElementRow } from './useElements';

export { FOLDER } from './useElements';
export const useUi = () => useSyncExternalStore(subscribeUi, getUi, getUi);

export const VIEWS: { value: ViewMode; label: string; icon: string; title: string }[] = [
  { value: 'row', label: 'Row', icon: 'list', title: 'Expanding row under the element' },
  { value: 'panel', label: 'Panel', icon: 'layout', title: 'Side panel' },
  { value: 'grid', label: 'Grid', icon: 'grid', title: 'Grid of property cards' },
];

/** Select an element and make it visible in the tree (its category opens). */
export function selectElement(id: string, category = ''): void {
  setUi((s) => ({ selected: id, picking: false, collapsed: category ? s.collapsed.filter((c) => c !== category) : s.collapsed }));
}

export function Manager() {
  const rt = useRuntime();
  const ui = useUi();
  const { all, visible, error } = useElements(rt, ui.rev);
  const byId = useMemo(() => new Map<string, ElementRow>(all.map((e) => [e.id, e])), [all]);
  // search / sort / multi-filter (lib/query.mjs): the same function the CLI, REST and MCP tools run
  const query = { q: ui.q, kinds: ui.kinds, categories: ui.categories, plugins: ui.plugins, overriddenOnly: ui.overriddenOnly, onScreenOnly: ui.onScreenOnly, sort: ui.sort, desc: ui.desc };
  const qKey = JSON.stringify(query);
  const shown = useMemo(() => queryElements(all, query, visible).length, [all, visible, qKey]);
  const tree = useMemo(() => queryTree(all, query, visible), [all, visible, qKey]);
  const facets = useMemo(() => facetsOf(all), [all]);
  const selected = byId.get(ui.selected) ?? null;
  useEffect(() => { void refreshLive(); }, []);
  // the server's selection and view (set through REST / MCP / CLI / voice) reach the open window; the window's reach the server
  useEffect(() => { void pullState(); const t = window.setInterval(() => void pullState(), 3000); return () => clearInterval(t); }, []);
  useEffect(() => { if (ui.selected) shareSelection(ui.selected); }, [ui.selected]);
  // picker: the next click on the console selects the element under it
  useEffect(() => {
    if (!ui.picking) return;
    return startPicker(knownElements, (e) => {
      if (e) selectElement(e.id, e.category); else setUi({ picking: false });
      if (!e) rt.toast('Nothing selectable there.', 'info');
    });
  }, [ui.picking, rt]);
  const inline = ui.view === 'row';
  return (
    <div className="axp-uim" data-help="view:ui-manager">
      <div className="axp-uim__bar" role="toolbar" aria-label="UI Manager">
        <Button size="sm" icon="search" tone={ui.picking ? 'primary' : 'neutral'} aria-pressed={ui.picking} onClick={() => setUi((s) => ({ picking: !s.picking }))}>{ui.picking ? 'Click an element… (Esc)' : 'Pick on screen'}</Button>
        <Segmented size="sm" label="View" value={ui.view} options={VIEWS} onChange={(v) => setUi({ view: v })} />
        <span className="axp-uim__grow fx-small fx-muted">{all.length} elements · {visible.length} on screen</span>
        <Button size="sm" icon="refresh" onClick={() => setUi((s) => ({ rev: s.rev + 1 }))}>Refresh</Button>
      </div>
      <ElementFilters ui={ui} facets={facets} shown={shown} total={all.length} />
      {error ? <Note>{error}</Note> : null}
      <div className={`axp-uim__body${inline ? ' is-stacked' : ''}`}>
        <nav className="axp-uim__tree" aria-label="Element categories">
          <Tree tree={tree} byId={byId} ui={ui} expand={inline ? (id) => <Props id={id} ui={ui} /> : undefined} />
        </nav>
        {!inline && (
          <section className="axp-uim__detail" aria-label="Selected element">
            {selected ? <Props id={selected.id} ui={ui} /> : <p className="fx-muted">Select an element on the left, or pick one on screen.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
