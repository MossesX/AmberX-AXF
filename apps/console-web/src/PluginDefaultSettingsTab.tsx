/**
 * The generic settings sub-tab every plugin can have (build every-plugin-screen-gets-a-settings-gear): Settings →
 * Plugins → <plugin> with on/off, recent logs and info (version, the model that built it, dependencies from the
 * plugin-inventory@1 engine), next to the shared Install & uninstall panel.
 *
 * A plugin gets it by declaring in plugin.json:
 *   "settingsTab": { "default": true }            (optional label / icon / order)
 * The console (App.tsx → withDefaultSettingsTab) adds the sub-tab when the plugin has none (id = its folder, parent
 * always 'plugins'), else puts these panels at the top of its first own tab, so the plugin's real settings stay where
 * they are. Every press here is a REST call the CLI, MCP and voice make too: POST /api/plugins/<folder>/enabled, the
 * Plugin Manager's own inventory and logs routes (found by what it provides, never by folder), and
 * GET /api/console-control/plugins/<folder>/settings.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AxfWebLibrary } from './axf/react/library';
import { Button, Chip, ModelBadge, Note, Switch, useRuntime } from './axf/react';
import { post } from './api';
import { PluginLifecyclePanel } from './pluginLifecycle';
import { PLUGINS_CHANGED, pluginFetch, pluginProviding, type PluginManifest } from './plugins';
import './pluginSettingsGear.css';

interface Dep { kind: string; name: string; required: boolean; status: string; detail: string }
interface Item { folder: string; name?: string; version?: string; enabled?: boolean; builtWith?: { model?: string; builtAt?: string }; dependencies?: Dep[]; dependents?: { folder: string; name: string; required: boolean }[] }
interface LogLine { at: number; channel: string; level: string; text: string }

/** The plugin that runs the plugin-inventory@1 engine (the Plugin Manager), by what it provides. */
const manager = () => pluginProviding('view:plugin-manager');

/** One plugin's row from the plugin-inventory@1 engine (the Plugin Manager's server part), or null when it isn't running. */
async function loadItem(folder: string): Promise<Item | null> {
  const pm = manager();
  if (!pm) return null;
  try {
    const r = await pluginFetch(pm, 'inventory');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return ((await r.json()) as { items: Item[] }).items.find((i) => i.folder === folder) ?? null;
  } catch { return null; }
}

async function loadLogs(folder: string): Promise<LogLine[]> {
  const pm = manager();
  if (!pm) return [];
  try {
    const r = await pluginFetch(pm, `logs/${folder}?limit=20`);
    return r.ok ? ((await r.json()) as { lines: LogLine[] }).lines : [];
  } catch { return []; }
}

const depTone = (d: Dep) => (d.status === 'met' || d.status === 'ok' ? 'success' : d.required ? 'danger' : 'warning');

export function PluginDefaultSettingsTab({ folder, manifest }: { folder: string; manifest: Pick<PluginManifest, 'name' | 'version' | 'builtWith'> }): ReactNode {
  const rt = useRuntime();
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => { const [i, l] = await Promise.all([loadItem(folder), loadLogs(folder)]); setItem(i); setLogs(l); }, [folder]);
  useEffect(() => { void reload(); }, [reload]);
  const enabled = item?.enabled ?? true;
  const setOn = async (on: boolean) => {
    setBusy(true);
    const r = await post(`plugins/${folder}/enabled`, { enabled: on });
    setBusy(false);
    if (!r.ok) { rt.toast(String(r.error ?? 'Could not change the plugin (is the console token set?).'), 'danger', manifest.name); return; }
    globalThis.dispatchEvent(new Event(PLUGINS_CHANGED));
    await reload();
  };
  const model = item?.builtWith?.model ?? manifest.builtWith?.model;
  const builtAt = item?.builtWith?.builtAt ?? manifest.builtWith?.builtAt;
  return (
    <div className="fx-stack cw-plugin-default" data-axf-plugin-default={folder}>
      <Switch label={`${manifest.name} is on`} checked={enabled} disabled={busy || item === null} onChange={(v) => void setOn(v)}
        hint={item === null ? 'The Plugin Manager is not running, so on/off is in Settings → Plugins → All plugins.' : 'Off hides its screens, menus and this tab\'s other panels until you switch it back on.'} />
      <dl className="cw-plugin-default__facts">
        <dt>Version</dt><dd>{item?.version ?? manifest.version ?? '—'}</dd>
        <dt>Built with</dt><dd>{model ? <ModelBadge model={model} builtAt={builtAt} /> : '—'}</dd>
        <dt>Folder</dt><dd className="fx-mono">plugins/{folder}</dd>
      </dl>
      <section className="fx-stack" aria-label="Dependencies">
        <h3 className="cw-plugin-default__h">Dependencies</h3>
        {!item?.dependencies?.length
          ? <p className="fx-muted fx-small">{item === undefined ? 'Loading…' : item === null ? 'Shown when the Plugin Manager is running.' : 'Needs nothing else.'}</p>
          : <ul className="cw-plugin-default__list">{item.dependencies.map((d) => <li key={`${d.kind}:${d.name}`}><Chip tone={depTone(d)}>{d.status}</Chip> <span className="fx-mono fx-small">{d.kind}:{d.name}</span>{d.required ? '' : ' (optional)'} <span className="fx-muted fx-small">{d.detail}</span></li>)}</ul>}
        {!!item?.dependents?.length && <p className="fx-small fx-muted">Needed by: {item.dependents.map((d) => d.name).join(', ')}</p>}
      </section>
      <section className="fx-stack" aria-label="Recent logs">
        <h3 className="cw-plugin-default__h">Recent logs</h3>
        {logs.length
          ? <ol className="cw-plugin-default__logs fx-mono fx-small">{logs.slice(-20).map((l, i) => <li key={i} data-level={l.level}>{new Date(l.at).toLocaleTimeString()} {l.level} {l.text}</li>)}</ol>
          : <p className="fx-muted fx-small">No log lines yet.</p>}
        <div className="fx-row fx-row--wrap">
          <Button size="sm" tone="quiet" icon="refresh" onClick={() => void reload()}>Refresh</Button>
          {rt.actions.get('plugin-manager.open') && <Button size="sm" tone="quiet" icon="package" onClick={() => rt.dispatch(`plugin-manager.open:${folder}`)}>Open in Plugin Manager</Button>}
        </div>
      </section>
      {item === null && <Note tone="info">Info and logs come from the Plugin Manager's server part, which is off or not answering.</Note>}
    </div>
  );
}

/** Is a panel the shared Install & uninstall panel? (the plugin already ships it) */
const isLifecycle = (p: { id: string; title?: string }) => /\.lifecycle$/.test(p.id) || p.title === 'Install & uninstall';

/**
 * plugin.json `settingsTab: { default: true }` → the default sub-tab under Settings → Plugins: added as the plugin's
 * tab (id = folder) when it has none, else its panels go to the top of the plugin's first tab. Parent is always 'plugins'.
 */
export function withDefaultSettingsTab(folder: string, m: PluginManifest, lib: AxfWebLibrary): AxfWebLibrary {
  const want = m.settingsTab;
  if (!want || want.default !== true) return lib;
  const own = lib.settingsTabs?.[0];
  const tab = own?.id ?? folder;
  const settingsTabs = own ? lib.settingsTabs! : [{ id: folder, label: want.label ?? m.name, icon: want.icon ?? 'package', order: want.order ?? 80, parent: 'plugins', description: m.description }];
  const panels = lib.settingsPanels ?? [];
  const extra = [
    // first when it is the whole tab; after the plugin's own settings (just above Install & uninstall) when it joins one
    { id: `${folder}.default`, tab, title: own ? `About ${m.name}` : m.name, icon: 'info', order: own ? 85 : 1, render: () => <PluginDefaultSettingsTab folder={folder} manifest={m} /> },
    ...(panels.some((p) => p.tab === tab && isLifecycle(p)) ? [] : [{ id: `${folder}.lifecycle`, tab, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={folder} /> }]),
  ];
  return { ...lib, settingsTabs: settingsTabs.map((t) => ({ ...t, parent: 'plugins' })), settingsPanels: [...extra, ...panels] };
}
