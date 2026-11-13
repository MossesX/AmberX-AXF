/*
 * The UI Manager window (tab kind `ui-manager`, opened floating by web/window.ts). Left: the collapsible tree of every
 * element in the console (web/Tree.tsx; On screen now = shortcuts). Every read and write goes through the plugin's
 * server part (lib/core.mjs), the same code the CLI, the REST routes and the MCP tools run.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Button, Note, useRuntime } from '@console/axf/react';
import { elementTree } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { getUi, setUi, subscribeUi } from './state';
import { Tree } from './Tree';
import { useElements, type ElementRow } from './useElements';

export { FOLDER } from './useElements';
export const useUi = () => useSyncExternalStore(subscribeUi, getUi, getUi);

export function Manager() {
  const rt = useRuntime();
  const ui = useUi();
  const { all, visible, error } = useElements(rt, ui.rev);
  const byId = useMemo(() => new Map<string, ElementRow>(all.map((e) => [e.id, e])), [all]);
  const tree = useMemo(() => elementTree(all, visible), [all, visible]);
  const selected = byId.get(ui.selected) ?? null;
  return (
    <div className="axp-uim" data-help="view:ui-manager">
      <div className="axp-uim__bar" role="toolbar" aria-label="UI Manager">
        <Button size="sm" icon="refresh" onClick={() => setUi((s) => ({ rev: s.rev + 1 }))}>Refresh</Button>
        <span className="fx-small fx-muted">{all.length} elements · {visible.length} on screen</span>
      </div>
      {error ? <Note>{error}</Note> : null}
      <div className="axp-uim__body">
        <nav className="axp-uim__tree" aria-label="Element categories"><Tree tree={tree} byId={byId} ui={ui} /></nav>
        <section className="axp-uim__detail" aria-label="Selected element">
          {selected ? <p><strong>{selected.label}</strong> <span className="fx-muted">{selected.id}</span></p> : <p className="fx-muted">Select an element on the left.</p>}
        </section>
      </div>
    </div>
  );
}
