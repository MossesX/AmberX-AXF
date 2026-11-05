import { useEffect, useState } from 'react';
import { Button, Container, LayoutToolbar, useScreenLayout } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

/** The folder name under plugins/ — this plugin's server routes live at /api/plugins/<FOLDER>/. */
const FOLDER = 'example';
/** Must equal plugin.json "id". */
const PLUGIN_ID = 'ai.amberx.axf.console.example';
/** The page's view id (plugin.json provides "view:example", screens.example). */
const VIEW = 'example';

/**
 * Three layouts per screen (screen-layouts@1, Brett Nov 4 2026): every plugin screen declares three presets of itself
 * and a default, mirrored in plugin.json "screens". The shared layout-switcher toolbar (hidden by default; right-click
 * the title → Show layout toolbar) picks one, remembered per screen per device. Rename these to what fits the screen
 * (List / Grid / Split, …) and branch the page on `screen.layout`.
 */
const LAYOUTS = [
  { id: 'compact', label: 'Compact', icon: 'list', description: 'Tight rows, more on one screen.' },
  { id: 'standard', label: 'Standard', icon: 'layout', description: 'The everyday arrangement.' },
  { id: 'spacious', label: 'Spacious', icon: 'grid', description: 'Room around every block, big targets.' },
];

function ExampleView() {
  const screen = useScreenLayout(VIEW);
  const [answer, setAnswer] = useState('…');
  const load = () => pluginFetch(FOLDER, 'hello').then((r) => r.json()).then((j: { message?: string }) => setAnswer(j.message ?? 'no answer'), () => setAnswer('server part unavailable'));
  useEffect(() => { void load(); }, []);
  return (
    <div className="fx-stack fx-stack--lg" {...screen.rootProps}>
      <header className="fx-pagehead"><div {...screen.headProps}><p className="fx-eyebrow">Plugin</p><h1>Example</h1></div></header>
      <LayoutToolbar view={VIEW} plugin={PLUGIN_ID} />
      {screen.layout === 'compact'
        ? <p className="fx-small" style={{ marginTop: 0 }}>Server says: {answer} <Button size="sm" icon="refresh" onClick={() => void load()}>Ask again</Button></p>
        : <Container title="Server says" icon="cloud"><p style={{ marginTop: 0 }}>{answer}</p><Button icon="refresh" onClick={() => void load()}>Ask again</Button></Container>}
      {screen.layout === 'spacious' && <Container title="About this layout" icon="layout"><p className="fx-muted" style={{ marginTop: 0 }}>Spacious: one block per row with room to breathe. Pick another from the layout toolbar or the title's right-click.</p></Container>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID, // must equal plugin.json "id"
  label: 'Example',
  version: '0.1.0',
  appMenu, // web/menu.ts: its entries in the console's application menu
  views: { [VIEW]: { title: 'Example', icon: 'box', render: () => <ExampleView />, layouts: LAYOUTS, defaultLayout: 'standard' } },
  nav: { label: 'Plugins', items: [{ id: 'example', label: 'Example', icon: 'box', view: VIEW }] },
  // Plugins never ship their own settings screen: they add a tab to the app's settings, with the shared lifecycle panel.
  settingsTabs: [{ id: 'example', label: 'Example', icon: 'box', order: 90, parent: 'plugins' }], // a sub-tab of Settings → Plugins
  settingsPanels: [{ id: 'example.lifecycle', tab: 'example', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
