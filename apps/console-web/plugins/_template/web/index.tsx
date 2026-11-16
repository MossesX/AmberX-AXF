import { useEffect, useState } from 'react';
import { Button, Container, PluginScreenHeader, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

/** The folder name under plugins/ — this plugin's server routes live at /api/plugins/<FOLDER>/. */
const FOLDER = 'example';

function ExampleView() {
  const [answer, setAnswer] = useState('…');
  const load = () => pluginFetch(FOLDER, 'hello').then((r) => r.json()).then((j: { message?: string }) => setAnswer(j.message ?? 'no answer'), () => setAnswer('server part unavailable'));
  const rt = useRuntime();
  const every = Number(rt.settings.get('example.refresh')) || 0; // its option (Settings → Plugins → Example)
  useEffect(() => {
    void load();
    if (!every) return undefined;
    const t = window.setInterval(() => void load(), every * 1000);
    return () => window.clearInterval(t);
  }, [every]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fx-stack fx-stack--lg">
      {/* plugin-settings@1: the header slot carries the one gear that opens Settings → Plugins → Example (tab = plugin.json settings.tab) */}
      <PluginScreenHeader tab="example" title="Example" />
      <Container title="Server says" icon="cloud"><p style={{ marginTop: 0 }}>{answer}</p><Button icon="refresh" onClick={() => void load()}>Ask again</Button></Container>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.example', // must equal plugin.json "id"
  label: 'Example',
  version: '0.1.0',
  appMenu, // web/menu.ts: its entries in the console's application menu
  views: { example: { title: 'Example', icon: 'box', render: () => <ExampleView /> } },
  nav: { label: 'Plugins', items: [{ id: 'example', label: 'Example', icon: 'box', view: 'example' }] },
  // Plugins never ship their own settings screen: they add a tab to the app's settings, with the shared lifecycle panel.
  settingsTabs: [{ id: 'example', label: 'Example', icon: 'box', order: 90, parent: 'plugins' }], // a sub-tab of Settings → Plugins
  // Its own options: every key here is listed in plugin.json settings.options, so REST, MCP, the CLI and voice set it too
  // (axf plugin-settings set example example.refresh=60). The console adds enable / info / logs above them.
  settings: [{ id: 'example.prefs', tab: 'example', label: 'Example', icon: 'box', order: 10, settings: [
    { key: 'example.refresh', label: 'Ask the server again every (seconds, 0 = never)', kind: 'number', default: 0, min: 0, max: 3600 },
  ] }],
  settingsPanels: [{ id: 'example.lifecycle', tab: 'example', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
