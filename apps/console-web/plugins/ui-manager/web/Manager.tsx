/*
 * The UI Manager window (tab kind `ui-manager`, opened floating by web/window.ts). Every operation goes through the
 * plugin's server part (lib/core.mjs), the same code the CLI, the REST routes and the MCP tools run.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Note } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { getUi, subscribeUi } from './state';

export const FOLDER = 'ui-manager';

export interface ElementRow { id: string; label: string; kind: string; category: string; overrides: number; plugin?: string; address?: string; selector?: string; assetType?: string }
export interface ElementsAnswer { items?: ElementRow[]; total?: number; error?: string }

export const useUi = () => useSyncExternalStore(subscribeUi, getUi, getUi);

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  return j as T;
}

export function Manager() {
  const ui = useUi();
  const [server, setServer] = useState<ElementsAnswer | null>(null);
  const load = () => fetchJson<ElementsAnswer>('elements').then(setServer, () => setServer({ error: 'The UI Manager server part is not answering.' }));
  useEffect(() => { void load(); }, [ui.rev]);
  const items = server?.items ?? [];
  return (
    <div className="axp-uim" data-help="view:ui-manager">
      <div className="axp-uim__bar" role="toolbar" aria-label="UI Manager">
        <Button size="sm" icon="refresh" onClick={() => void load()}>Refresh</Button>
        <span className="fx-small fx-muted">{items.length} elements</span>
      </div>
      {server?.error ? <Note>{server.error}</Note> : null}
      <ul className="axp-uim__list">
        {items.map((e) => <li key={e.id} className="fx-row" data-fx-row><span>{e.label}</span><span className="fx-small fx-muted">{e.kind} · {e.category}</span></li>)}
      </ul>
    </div>
  );
}
