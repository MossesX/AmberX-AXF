/*
 * The UI Manager window (tab kind `ui-manager`, opened floating by web/window.ts). Every element in the console is
 * listed (web/useElements.ts); every read and write goes through the plugin's server part (lib/core.mjs), the same
 * code the CLI, the REST routes and the MCP tools run.
 */
import { useSyncExternalStore } from 'react';
import { Button, Note, useRuntime } from '@console/axf/react';
import { getUi, setUi, subscribeUi } from './state';
import { useElements } from './useElements';

export { FOLDER } from './useElements';
export const useUi = () => useSyncExternalStore(subscribeUi, getUi, getUi);

export function Manager() {
  const rt = useRuntime();
  const ui = useUi();
  const { all, visible, error } = useElements(rt, ui.rev);
  return (
    <div className="axp-uim" data-help="view:ui-manager">
      <div className="axp-uim__bar" role="toolbar" aria-label="UI Manager">
        <Button size="sm" icon="refresh" onClick={() => setUi((s) => ({ rev: s.rev + 1 }))}>Refresh</Button>
        <span className="fx-small fx-muted">{all.length} elements · {visible.length} on screen</span>
      </div>
      {error ? <Note>{error}</Note> : null}
      <ul className="axp-uim__list">
        {all.map((e) => (
          <li key={e.id}>
            <button type="button" data-fx-row className={`axp-uim__row${ui.selected === e.id ? ' is-on' : ''}`} aria-pressed={ui.selected === e.id} onClick={() => setUi({ selected: e.id })}>
              <span className="axp-uim__grow">{e.label}</span><span className="fx-small axp-uim__muted">{e.kind} · {e.category}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
