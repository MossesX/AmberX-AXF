import { useEffect, useState } from 'react';
import { Button, Chip } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';

/** The folder name under plugins/: this plugin's server routes live at /api/plugins/<FOLDER>/. */
const FOLDER = 'app-style';

interface Value { kind: string; name: string; axhubName?: string | null; ownName?: string | null }
interface Part { id: 'design' | 'colors'; label: string; overriding: boolean; values: Value[] }
interface App { app: string; label: string; source: boolean; parts: Part[] }
interface State { axhub: { design: string | null; colors: string | null; updatedBy: string }; apps: App[] }

const slotOf = (p: Part) => p.values.find((v) => v.kind === 'slot' && v.name !== 'design-package');

/** Settings → Plugins → App style: every app's design and colours against axHub's, with Follow axHub and Reload. */
function AppStyleTable() {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const load = () => pluginFetch(FOLDER, 'get').then((r) => r.json()).then((j: State & { ok?: boolean; error?: string }) => { if (j.ok === false) setErr(j.error ?? 'failed'); else { setSt(j); setErr(''); } }, () => setErr('server part unavailable'));
  const post = (path: string, body: object) => pluginFetch(FOLDER, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(() => load());
  useEffect(() => { void load(); }, []);
  if (err) return <p className="fx-muted">{err}</p>;
  if (!st) return <p className="fx-muted">Reading axHub's look…</p>;
  return (
    <div className="axf-settings__rows" data-help="app-style-table">
      <p className="fx-muted axf-settings__desc">axHub: design {st.axhub.design ?? '—'} · colours {st.axhub.colors ?? '—'}. Each app inherits them unless it overrides them in its Settings → Appearance → axHub style.</p>
      {st.apps.map((a) => (
        <div key={a.app} className="axf-settings__row">
          <div className="axf-settings__label"><span>{a.label}</span><span className="fx-muted axf-settings__hint">{a.app}</span></div>
          <div className="axf-settings__control">
            {a.source ? <Chip tone="accent">Is axHub's look</Chip> : a.parts.map((p) => (
              <div key={p.id}>
                {p.label}: {p.overriding ? <><Chip tone="warning">Overriding axHub</Chip> {slotOf(p)?.ownName ?? '—'} <span className="fx-muted">(axHub: {slotOf(p)?.axhubName ?? '—'})</span> <Button size="sm" tone="quiet" data-help="app-style-follow" onClick={() => void post('override', { app: a.app, part: p.id, on: false })}>Follow axHub</Button></> : <Chip>Inherited from axHub</Chip>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div><Button size="sm" tone="quiet" icon="refresh" data-help="app-style-reload" onClick={() => void post('reload', { app: 'axf-console' })}>Reload from axHub in every open app</Button></div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.app-style', // must equal plugin.json "id"
  label: 'App style',
  version: '0.1.0',
  // Plugins never ship their own settings screen: a sub-tab of Settings → Plugins, with the shared lifecycle panel.
  settingsTabs: [{ id: 'app-style', label: 'App style', icon: 'palette', order: 60, parent: 'plugins', description: 'Which apps inherit axHub\'s design and colours, and which override them.' }],
  settingsPanels: [
    { id: 'app-style.apps', tab: 'app-style', title: 'Every app', icon: 'palette', order: 10, render: () => <AppStyleTable /> },
    { id: 'app-style.lifecycle', tab: 'app-style', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
