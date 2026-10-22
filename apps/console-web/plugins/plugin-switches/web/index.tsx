/**
 * Plugin switches console plugin (ai.amberx.axf.console.plugin-switches).
 *
 * A pop-up dialog with a plain list of every plugin and an on/off switch for each. This plugin's own row is greyed
 * out, so it can't switch itself off from its own list (turn it off in the Plugin Manager or Settings → Plugins).
 * Switching off a plugin that a running plugin needs asks first. Uses the console's own enable route, so it works
 * for every plugin; it has no server part and stores nothing.
 *
 * Opened from the default context menu (right-click / long-press anywhere), the action `plugin-switches.open`,
 * search, or Settings → Plugins → Plugin switches. All of these are runtime contributions, so uninstalling the
 * plugin removes every trace of it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Icon, Switch, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { post } from '@console/api';
import { bundledPlugins, fetchPluginStatus, PLUGINS_CHANGED, type PluginStatus } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './plugin-switches.css';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.plugin-switches';
/** This plugin's folder under plugins/ — its row is the greyed-out one. */
const FOLDER = 'plugin-switches';
const DIALOG = 'plugin-switches';

interface Row { folder: string; name: string; description: string; enabled: boolean; problem: string | null; provides: string[]; requires: string[] }

/** What the manifests say a plugin provides and requires (capability services only, e.g. service:axf.llm@1). */
function capabilities(folder: string): { provides: string[]; requires: string[] } {
  const m = bundledPlugins.find((p) => p.folder === folder)?.manifest as { provides?: string[]; requires?: string[] } | undefined;
  const svc = (xs?: string[]) => (xs ?? []).filter((x) => x.startsWith('service:'));
  return { provides: svc(m?.provides), requires: svc(m?.requires) };
}

function toRows(status: PluginStatus[] | null): Row[] {
  if (status) {
    return status.map((s) => ({
      folder: s.folder, name: s.name ?? s.folder, description: s.description ?? '', enabled: s.enabled,
      problem: s.server === 'error' ? (s.error ?? 'server part failed to load') : null, ...capabilities(s.folder),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  // No backend: show the bundled plugins, read-only.
  return bundledPlugins.map((p) => ({
    folder: p.folder, name: p.manifest.name, description: p.manifest.description ?? '', enabled: p.manifest.enabledByDefault !== false,
    problem: p.problem ?? null, ...capabilities(p.folder),
  }));
}

/** Running plugins that need something only `row` provides. */
function neededBy(row: Row, rows: Row[]): Row[] {
  if (!row.provides.length) return [];
  return rows.filter((r) => r.enabled && r.folder !== row.folder && r.requires.some((need) =>
    row.provides.includes(need) && !rows.some((o) => o.enabled && o.folder !== row.folder && o.provides.includes(need))));
}

/** Requirements of `row` that no running plugin provides. */
function unmet(row: Row, rows: Row[]): string[] {
  return row.requires.filter((need) => !rows.some((o) => o.enabled && o.folder !== row.folder && o.provides.includes(need)));
}

const serviceName = (s: string) => s.replace(/^service:/, '');

function SwitchList() {
  const rt = useRuntime();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<{ row: Row; needers: Row[] } | null>(null);

  const load = useCallback(async () => {
    const status = await fetchPluginStatus();
    setOffline(status === null);
    setRows(toRows(status));
  }, []);

  useEffect(() => {
    void load();
    const again = () => void load();
    globalThis.addEventListener(PLUGINS_CHANGED, again);
    return () => globalThis.removeEventListener(PLUGINS_CHANGED, again);
  }, [load]);

  const apply = async (row: Row, on: boolean) => {
    setConfirm(null);
    setBusy(row.folder);
    const r = await post(`plugins/${row.folder}/enabled`, { enabled: on });
    setBusy('');
    if (!r.ok) {
      rt.toast(String(r.error ?? 'Could not change the plugin (is the console token set, and are you an admin?).'), 'danger', 'Plugin switches');
      return;
    }
    setRows((xs) => xs?.map((x) => (x.folder === row.folder ? { ...x, enabled: on } : x)) ?? xs);
    globalThis.dispatchEvent(new Event(PLUGINS_CHANGED));
    rt.toast(`${on ? 'Turned on' : 'Turned off'} ${row.name}.`, 'success', 'Plugin switches');
  };

  const flip = (row: Row, on: boolean) => {
    if (row.folder === FOLDER || offline || busy) return;
    const needers = on ? [] : neededBy(row, rows ?? []);
    if (needers.length) { setConfirm({ row, needers }); return; }
    void apply(row, on);
  };

  const counts = useMemo(() => ({ on: rows?.filter((r) => r.enabled).length ?? 0, total: rows?.length ?? 0 }), [rows]);

  if (!rows) return <div className="axp-plugin-switches"><p className="axp-plugin-switches__empty">Loading plugins…</p></div>;

  return (
    <div className="axp-plugin-switches">
      <p className="axp-plugin-switches__summary">{counts.on} of {counts.total} plugins on</p>
      {offline && <p className="axp-plugin-switches__notice"><Icon name="alert" size={14} /> The console API isn't reachable, so switches are read-only.</p>}
      {confirm && (
        <div className="axp-plugin-switches__confirm" role="alertdialog" aria-label={`Turn off ${confirm.row.name}?`}>
          <p className="axp-plugin-switches__confirm-text">
            <strong>{confirm.needers.map((n) => n.name).join(', ')}</strong> {confirm.needers.length === 1 ? 'needs' : 'need'} {confirm.row.name}. Turn it off anyway?
          </p>
          <div className="fx-row fx-row--wrap">
            <Button tone="danger" icon="pause" onClick={() => void apply(confirm.row, false)}>Turn off</Button>
            <Button tone="ghost" onClick={() => setConfirm(null)}>Keep it on</Button>
          </div>
        </div>
      )}
      <ul className="axp-plugin-switches__list">
        {rows.map((r) => {
          const self = r.folder === FOLDER;
          const missing = r.enabled ? unmet(r, rows) : [];
          const locked = self || offline || (busy !== '' && busy !== r.folder);
          return (
            <li key={r.folder} className={`axp-plugin-switches__row ${self ? 'is-self' : ''} ${r.enabled ? 'is-active' : ''}`}>
              <div className="axp-plugin-switches__text">
                <span className="axp-plugin-switches__name">{r.name}</span>
                {self && <span className="axp-plugin-switches__note">This list — turn it off in the Plugin Manager</span>}
                {!self && r.problem && <span className="axp-plugin-switches__note is-error">{r.problem}</span>}
                {!self && missing.length > 0 && <span className="axp-plugin-switches__note is-warn">Needs {missing.map(serviceName).join(', ')}</span>}
              </div>
              <Switch hideLabel label={`${r.name} ${r.enabled ? 'on' : 'off'}`} title={self ? "Can't switch itself off" : r.enabled ? 'Turn off' : 'Turn on'}
                checked={r.enabled} disabled={locked || busy === r.folder} onChange={(on) => flip(r, on)} className="axp-plugin-switches__switch" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>A quick pop-up list of every plugin with an on/off switch. Its own switch is greyed out.</p>
      <p className="fx-muted" style={{ margin: 0 }}>Also in the right-click / long-press menu anywhere in the console.</p>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="sliders" onClick={() => rt.openDialog(DIALOG)}>Open plugin switches</Button>
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Plugin switches',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('plugin-switches.open', () => rt.openDialog(DIALOG), { label: 'Plugin switches' });
  },
  dialogs: {
    [DIALOG]: { title: 'Plugin switches', icon: 'sliders', render: () => <SwitchList /> },
  },
  contextMenu: [
    { id: 'plugin-switches.default', target: 'default', order: 91, items: [{ id: 'plugin-switches', label: 'Plugin switches', icon: 'sliders', action: 'plugin-switches.open' }] },
  ],
  settingsTabs: [{ id: 'plugin-switches', label: 'Plugin switches', icon: 'sliders', order: 6, parent: 'plugins' }],
  settingsPanels: [
    { id: 'plugin-switches.open', tab: 'plugin-switches', title: 'Plugin switches', icon: 'sliders', order: 5, render: () => <OpenPanel /> },
    { id: 'plugin-switches.lifecycle', tab: 'plugin-switches', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
