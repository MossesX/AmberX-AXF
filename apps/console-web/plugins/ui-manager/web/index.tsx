import { useEffect, useState } from 'react';
import { Button, Container } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

/** The folder name under plugins/: this plugin's server routes live at /api/plugins/<FOLDER>/. */
const FOLDER = 'ui-manager';

interface ElementRow { id: string; label: string; kind: string; category: string; overrides: number }
interface CategoryRow { id: string; label: string; icon: string; live: boolean; count: number }
interface ElementsAnswer { items?: ElementRow[]; total?: number; tree?: CategoryRow[]; error?: string }

/**
 * Phase 1 page: the element registry and its categories, read from the server part (lib/core.mjs). The floating window,
 * the expanding row and the pickers are the Opus phase of this build; every operation they will call is already on the
 * server (props, choices, set, reset, preview, apply, changes, undo) and on the CLI / MCP through plugin-commands@1.
 */
function UiManagerView() {
  const [answer, setAnswer] = useState<ElementsAnswer | null>(null);
  const load = () => pluginFetch(FOLDER, 'elements').then((r) => r.json()).then((j: ElementsAnswer) => setAnswer(j), () => setAnswer({ error: 'server part unavailable' }));
  useEffect(() => { void load(); }, []);
  const categories = answer?.tree ?? [];
  const items = answer?.items ?? [];
  return (
    <div className="fx-stack fx-stack--lg" data-help="view:ui-manager">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>UI Manager</h1></div></header>
      <Container title="Element categories" icon="layers" data-help="ui-manager.tree">
        {answer?.error ? <p className="fx-muted">{answer.error}</p> : null}
        <ul className="fx-stack">
          {categories.map((c) => <li key={c.id} className="fx-row"><span>{c.label}</span><span className="fx-small fx-muted">{c.count}{c.live ? ' · live' : ''}</span></li>)}
        </ul>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void load()}>Refresh</Button>
          <span className="fx-small fx-muted">{answer?.total ?? 0} elements. Each one opens to every property and token it reads, edited from predetermined values.</span>
        </div>
      </Container>
      <Container title="Elements" icon="sliders" data-help="ui-manager.row">
        <ul className="fx-stack">
          {items.slice(0, 200).map((e) => <li key={e.id} className="fx-row" data-fx-row><span>{e.label}</span><span className="fx-small fx-muted">{e.kind} · {e.category}{e.overrides ? ` · ${e.overrides} overridden` : ''}</span></li>)}
        </ul>
      </Container>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.ui-manager', // must equal plugin.json "id"
  label: 'UI Manager',
  version: '0.1.0',
  appMenu,
  views: { 'ui-manager': { title: 'UI Manager', icon: 'sliders', render: () => <UiManagerView /> } },
  nav: { label: 'Plugins', items: [{ id: 'ui-manager', label: 'UI Manager', icon: 'sliders', view: 'ui-manager' }] },
  settingsTabs: [{ id: 'ui-manager', label: 'UI Manager', icon: 'sliders', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'ui-manager.lifecycle', tab: 'ui-manager', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
