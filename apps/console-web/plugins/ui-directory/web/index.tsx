/**
 * UI Directory console plugin (ai.amberx.axf.console.ui-directory).
 *
 * One live data set (ui-directory@1, framework/core/ui-directory.mjs) of every UI surface across every app, built by
 * the plugin's collector (directory.mjs) from the registries and rebuilt on every build event. This step ships the
 * data set, its API, the directory page (a searchable, filterable grouped tree whose rows open their UI or settings) and
 * the settings tab (status, rebuild, install & uninstall).
 */
import { useEffect, useState } from 'react';
import { Button } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import { dirState, filtersFromArgs, loadDirectory, openRow, openSettings, UiDirectoryPage, VIEW } from './page';

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
  register(rt) {
    const idOf = (args: string[]) => decodeURIComponent(args.join(':'));
    const run = async (args: string[], settings: boolean) => {
      const id = idOf(args);
      if (!id) { rt.toast('Which UI? Give its row id.', 'warning', 'UI Directory'); return; }
      try {
        const dir = await loadDirectory();
        const row = dir.rows.find((r) => r.id === id);
        if (!row) { rt.toast(`No UI row ${id}.`, 'warning', 'UI Directory'); return; }
        const res = settings ? await openSettings(rt, dir.rows, row) : await openRow(rt, row);
        if (!res.ok) rt.toast(res.message, 'warning', 'UI Directory');
      } catch (e) { rt.toast((e as Error).message, 'warning', 'UI Directory'); }
    };
    rt.actions.register('ui-directory.open', () => rt.navigate(VIEW), { label: 'Open the UI Directory', effect: 'navigate' });
    rt.actions.register('ui-directory.show', (args) => { dirState.set(filtersFromArgs(args)); rt.navigate(VIEW); }, { label: 'UI Directory: search and filter (words, app=, kind=, status=, family=)', params: true, effect: 'navigate' });
    rt.actions.register('ui-directory.show-all', () => dirState.set({ q: '', app: '', kind: '', status: '', family: '' }), { label: 'UI Directory: clear the filters' });
    rt.actions.register('ui-directory.expand', () => dirState.set({ all: true }), { label: 'UI Directory: expand every group' });
    rt.actions.register('ui-directory.collapse', () => dirState.set({ all: false, open: [] }), { label: 'UI Directory: collapse every group' });
    rt.actions.register('ui-directory.open-row', (args) => void run(args, false), { label: 'Open a UI from the directory (its row id)', params: true, effect: 'navigate' });
    rt.actions.register('ui-directory.open-settings', (args) => void run(args, true), { label: 'Open the settings of a UI from the directory (its row id)', params: true, effect: 'navigate' });
  },
  views: { [VIEW]: { title: 'UI Directory', icon: 'layers', keywords: ['ui directory', 'every screen', 'every page', 'settings', 'tabs', 'dialogs', 'find a screen', 'where is', 'deep link', 'map of the app'], render: () => <UiDirectoryPage /> } },
  nav: { label: 'Tools', items: [{ id: 'ui-directory', label: 'UI Directory', icon: 'layers', view: VIEW }] },
  // Plugins never ship their own settings screen: a sub-tab of Settings → Plugins with the shared lifecycle panel.
  settingsTabs: [{ id: 'ui-directory', label: 'UI Directory', icon: 'layers', order: 52, parent: 'plugins', description: 'The live data set of every UI surface in every app: size, rebuild, install & uninstall.' }],
  settingsPanels: [
    { id: 'ui-directory.status', tab: 'ui-directory', title: 'Directory', icon: 'layers', order: 10, render: () => <StatusPanel /> },
    { id: 'ui-directory.lifecycle', tab: 'ui-directory', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
