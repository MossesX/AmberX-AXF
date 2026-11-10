import { useEffect, useState } from 'react';
import { Button } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';

/** Settings → Plugins → Molly menus: what Molly shows now and where the API is. Every row here is also a REST route. */
const FOLDER = 'molly-menus';

interface Choice { id: string; label: string; value: string; values: string[] }
interface State { skin?: { id: string; name: string }; choices?: Choice[]; status?: Record<string, { state: string; text: string }>; links?: { skinPicker: string; molly: string } }

function StatePanel() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const load = () => pluginFetch(FOLDER, 'state').then((r) => r.json()).then((j: State) => { setS(j); setErr(''); }, () => setErr('The server part is not answering.'));
  useEffect(() => { void load(); }, []);
  return (
    <div className="fx-stack">
      {err && <p className="fx-muted">{err}</p>}
      {s && (
        <div className="fx-stack">
          {[['Skin', s.skin?.name ?? ''], ...(s.choices ?? []).filter((c) => c.id !== 'skin').map((c) => [c.label, c.value]), ...Object.entries(s.status ?? {}).map(([k, v]) => [k, v.text])].map(([k, v]) => (
            <div key={k} className="fx-row"><span className="fx-muted">{k}</span><span>{v}</span></div>
          ))}
        </div>
      )}
      <div className="fx-row">
        <Button icon="refresh" onClick={() => void load()}>Refresh</Button>
        {s?.links && <Button icon="external" onClick={() => window.open(s.links!.skinPicker, '_blank', 'noopener')}>Open Molly's skin picker</Button>}
      </div>
      <p className="fx-muted">REST /api/plugins/molly-menus · MCP molly-menus_* · CLI axf molly-menus · voice: “Molly, use the night skin”.</p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.molly-menus',
  label: 'Molly menus',
  version: '0.1.0',
  settingsTabs: [{ id: 'molly-menus', label: 'Molly menus', icon: 'menu', order: 90, parent: 'plugins', description: "Molly's skin, look choices, live status and menu API." }],
  settingsPanels: [
    { id: 'molly-menus.state', tab: 'molly-menus', title: 'Molly now', icon: 'palette', order: 10, render: () => <StatePanel /> },
    { id: 'molly-menus.lifecycle', tab: 'molly-menus', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
