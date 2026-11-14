/**
 * UI Directory console plugin (ai.amberx.axf.console.ui-directory).
 *
 * One live data set (ui-directory@1, framework/core/ui-directory.mjs) of every UI surface across every app, built by
 * the plugin's collector (directory.mjs) from the registries and rebuilt on every build event. This step ships the
 * data set, its API and the settings tab (status, rebuild, install & uninstall); the directory page follows.
 */
import { useEffect, useState } from 'react';
import { Button } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

/** The folder name under plugins/ — this plugin's server routes live at /api/plugins/<FOLDER>/. */
const FOLDER = 'ui-directory';
const ID = 'ai.amberx.axf.console.ui-directory';

interface Stats { generatedAt?: string; total?: number; counts?: { kinds?: Record<string, number>; apps?: Record<string, number>; statuses?: Record<string, number> } }

function StatusPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = () => pluginFetch(FOLDER, 'stats').then((r) => r.json()).then((j: Stats) => setStats(j), () => setNote('The server part is unavailable.'));
  useEffect(() => { void load(); }, []);
  const rebuild = async () => {
    setBusy(true);
    try {
      const r = await pluginFetch(FOLDER, 'rebuild', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'settings' }) });
      const j = (await r.json()) as { wrote?: boolean; total?: number; diff?: { added?: number; changed?: number; removed?: number } };
      setNote(j.wrote ? `Rebuilt: ${j.total} rows (+${j.diff?.added ?? 0} new, ${j.diff?.changed ?? 0} changed, -${j.diff?.removed ?? 0} gone).` : `Up to date: ${j.total} rows.`);
      await load();
    } catch { setNote('The rebuild did not run.'); } finally { setBusy(false); }
  };
  const kinds = Object.entries(stats?.counts?.kinds ?? {});
  const apps = Object.entries(stats?.counts?.apps ?? {});
  return (
    <div className="fx-stack">
      <p className="fx-muted">Every screen, tab, dialog, settings interface, settings panel, plugin UI and banner of every app, read from the registries. New UIs appear by themselves; removed ones drop out. Rebuilt on every build.</p>
      {stats ? (
        <dl className="fx-stack fx-small" data-axf-target="ui-directory.stats">
          <div className="fx-row fx-row--wrap"><dt className="fx-muted">Rows</dt><dd>{stats.total ?? 0}</dd></div>
          <div className="fx-row fx-row--wrap"><dt className="fx-muted">Built</dt><dd>{stats.generatedAt ?? '—'}</dd></div>
          <div className="fx-row fx-row--wrap"><dt className="fx-muted">Kinds</dt><dd>{kinds.map(([k, n]) => `${k} ${n}`).join(' · ')}</dd></div>
          <div className="fx-row fx-row--wrap"><dt className="fx-muted">Apps</dt><dd>{apps.map(([k, n]) => `${k} ${n}`).join(' · ')}</dd></div>
        </dl>
      ) : <p className="fx-small fx-muted">Loading the directory…</p>}
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label="UI Directory">
        <Button icon="refresh" busy={busy} onClick={() => void rebuild()}>Rebuild now</Button>
        <Button icon="refresh" tone="neutral" onClick={() => void load()}>Refresh</Button>
      </div>
      {note ? <p className="fx-small fx-muted">{note}</p> : null}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'UI Directory',
  version: '0.1.0',
  appMenu,
  // Plugins never ship their own settings screen: a sub-tab of Settings → Plugins with the shared lifecycle panel.
  settingsTabs: [{ id: 'ui-directory', label: 'UI Directory', icon: 'map', order: 52, parent: 'plugins', description: 'The live data set of every UI surface in every app: size, rebuild, install & uninstall.' }],
  settingsPanels: [
    { id: 'ui-directory.status', tab: 'ui-directory', title: 'Directory', icon: 'map', order: 10, render: () => <StatusPanel /> },
    { id: 'ui-directory.lifecycle', tab: 'ui-directory', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
