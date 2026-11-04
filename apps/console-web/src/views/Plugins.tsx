import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, useRuntime } from '../axf/react';
import { isBackendUp, post } from '../api';
import { bundledPlugins, fetchPluginStatus, PLUGINS_CHANGED, type PluginStatus } from '../plugins';

/** Settings → Plugins: the console's plugins, whether each runs, and whether its server part loaded. */
export function PluginsPanel() {
  const rt = useRuntime();
  const [status, setStatus] = useState<PluginStatus[] | null>(null);
  const [busy, setBusy] = useState('');
  const reload = useCallback(async () => setStatus(await fetchPluginStatus()), []);
  useEffect(() => { void reload(); }, [reload]);

  const toggle = async (folder: string, enabled: boolean) => {
    setBusy(folder);
    const r = await post(`plugins/${folder}/enabled`, { enabled });
    setBusy('');
    if (!r.ok) {
      rt.toast(String(r.error ?? 'Could not change the plugin.'), 'danger', 'Plugins');
      return;
    }
    await reload();
    globalThis.dispatchEvent(new Event(PLUGINS_CHANGED));
    rt.toast(`${enabled ? 'Enabled' : 'Disabled'} ${folder}.`, 'success', 'Plugins');
  };

  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ marginTop: 0 }}>
        Plugins add tabs and server routes to the console. They live in <code>apps/console-web/plugins/</code>; copy
        <code> plugins/_template</code> to write one.
      </p>
      {!isBackendUp() && <p className="fx-muted">Without the console API, plugins enabled by default run, and their server parts are unavailable.</p>}
      {bundledPlugins.length === 0 && <p className="fx-muted" style={{ margin: 0 }}>No plugins installed.</p>}
      {bundledPlugins.map((p) => {
        const s = status?.find((x) => x.folder === p.folder);
        const enabled = s ? s.enabled : p.manifest.enabledByDefault !== false;
        return (
          <div key={p.folder} className="fx-stack" style={{ borderTop: 'var(--fx-border-w) solid var(--fx-border)', paddingTop: 'var(--fx-dens-gap-2xl)' }}>
            <strong>{p.manifest.name}</strong> <span className="fx-muted">{p.manifest.version}</span>
            {p.manifest.description && <p className="fx-muted" style={{ margin: 0 }}>{p.manifest.description}</p>}
            <p className="fx-mono fx-small" style={{ margin: 0 }}>{p.manifest.id} · plugins/{p.folder}</p>
            <div className="fx-row fx-row--wrap">
              <Chip tone={enabled ? 'success' : undefined}>{enabled ? 'enabled' : 'disabled'}</Chip>
              {s?.server === 'loaded' && <Chip tone="accent">server part loaded</Chip>}
              {s?.server === 'error' && <Chip tone="danger">server part failed</Chip>}
              {p.problem && <Chip tone="danger">web part: {p.problem}</Chip>}
              {s && (
                <Button tone={enabled ? 'neutral' : 'primary'} icon={enabled ? 'x' : 'check'} disabled={busy === p.folder} onClick={() => void toggle(p.folder, !enabled)}>
                  {enabled ? 'Disable' : 'Enable'}
                </Button>
              )}
            </div>
            {s?.error && <p className="fx-mono fx-small" style={{ color: 'var(--fx-danger)', margin: 0 }}>{s.error}</p>}
          </div>
        );
      })}
    </div>
  );
}
