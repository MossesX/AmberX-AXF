import { useEffect, useState } from 'react';
import { Button, Container } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';

/** The folder name under plugins/ — this plugin's server routes live at /api/plugins/<FOLDER>/. */
const FOLDER = 'example';

function ExampleView() {
  const [answer, setAnswer] = useState('…');
  const load = () => pluginFetch(FOLDER, 'hello').then((r) => r.json()).then((j: { message?: string }) => setAnswer(j.message ?? 'no answer'), () => setAnswer('server part unavailable'));
  useEffect(() => { void load(); }, []);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin</p><h1>Example</h1></div></header>
      <Container title="Server says" icon="cloud"><p style={{ marginTop: 0 }}>{answer}</p><Button icon="refresh" onClick={() => void load()}>Ask again</Button></Container>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.example', // must equal plugin.json "id"
  label: 'Example',
  version: '0.1.0',
  views: { example: { title: 'Example', icon: 'box', render: () => <ExampleView /> } },
  nav: { label: 'Plugins', items: [{ id: 'example', label: 'Example', icon: 'box', view: 'example' }] },
  // Plugins never ship their own settings screen: they add a tab to the app's settings, with the shared lifecycle panel.
  settingsTabs: [{ id: 'example', label: 'Example', icon: 'box', order: 90, parent: 'plugins' }], // a sub-tab of Settings → Plugins
  settingsPanels: [{ id: 'example.lifecycle', tab: 'example', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
