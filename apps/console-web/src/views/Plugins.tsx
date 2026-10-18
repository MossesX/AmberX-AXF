import { useState } from 'react';
import { Button, Chip, Container, useRuntime } from '../axf/react';
import { isBackendUp, post } from '../api';
import { bundledPlugins, type PluginStatus } from '../plugins';

/** Manage console plugins: what's installed, whether it runs, and whether its server part loaded. */
export function PluginsView({ status, reload }: { status: PluginStatus[] | null; reload: () => Promise<void> }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState('');

  const toggle = async (folder: string, enabled: boolean) => {
    setBusy(folder);
    const r = await post(`plugins/${folder}/enabled`, { enabled });
    setBusy('');
    if (!r.ok) {
      rt.toast(String(r.error ?? 'Could not change the plugin.'), 'danger', 'Plugins');
      return;
    }
    await reload();
    rt.toast(`${enabled ? 'Enabled' : 'Disabled'} ${folder}.`, 'success', 'Plugins');
  };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Console</p>
          <h1>Plugins</h1>
          <p className="fx-muted">
            Plugins add tabs and server routes to the console. They live in <code>apps/console-web/plugins/</code>;
            see its README to write one.
          </p>
        </div>
      </header>
      {!isBackendUp() && <Container title="No backend" icon="alert"><p style={{ margin: 0 }}>Without the console API, plugins enabled by default run, and their server parts are unavailable.</p></Container>}
      {bundledPlugins.length === 0 && <Container title="No plugins installed" icon="box"><p style={{ margin: 0 }}>Add one under <code>apps/console-web/plugins/&lt;name&gt;/</code>.</p></Container>}
      {bundledPlugins.map((p) => {
        const s = status?.find((x) => x.folder === p.folder);
        const enabled = s ? s.enabled : p.manifest.enabledByDefault !== false;
        return (
          <Container key={p.folder} title={`${p.manifest.name} ${p.manifest.version}`} icon="package">
            <p className="fx-muted" style={{ marginTop: 0 }}>{p.manifest.description}</p>
            <p className="fx-mono" style={{ fontSize: 12 }}>{p.manifest.id} · plugins/{p.folder}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <Chip tone={enabled ? 'success' : undefined}>{enabled ? 'enabled' : 'disabled'}</Chip>
              {s?.server === 'loaded' && <Chip tone="accent">server part loaded</Chip>}
              {s?.server === 'error' && <Chip tone="danger">server part failed</Chip>}
              {p.problem && <Chip tone="danger">web part: {p.problem}</Chip>}
            </div>
            {s?.error && <p className="fx-mono" style={{ color: 'var(--fx-danger, #c33)', fontSize: 12 }}>{s.error}</p>}
            {s && (
              <Button tone={enabled ? undefined : 'primary'} icon={enabled ? 'x' : 'check'} disabled={busy === p.folder} onClick={() => void toggle(p.folder, !enabled)}>
                {enabled ? 'Disable' : 'Enable'}
              </Button>
            )}
          </Container>
        );
      })}
    </div>
  );
}
