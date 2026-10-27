/**
 * Plugins from the catalog (axHub decision #101): install a plugin into one of your apps straight from the hub, no Dev
 * Console. The catalog is what the Dev Console publishes (`plugin-catalog@1`); installing writes the plugin's files
 * into the app's repo as one commit, and the app's site rebuilds with it (AmberX: about 5 minutes).
 *
 * `#/plugins[?kind=]`                          the catalog, one card per plugin, Install / Update / Open
 * `#/plugins/install/<kind>/<folder>[?version=]` the confirm page an app (AmberX) opens: what will be written, where,
 *                                              and the Install / Update / Uninstall buttons
 *
 * This page only asks: every check and the commit happen on the hub, which accepts the write only from a signed-in
 * admin on the hub's own page (Origin + the session's CSRF value). Nothing here holds a token.
 */
import { useState } from 'react';
import { Button, Chip, Container, Note, TextField, useRuntime } from '../axf/react';
import { hubPost } from '../hub/api';
import { relTime } from '../hub/core';
import { go, useRouteParams } from '../hub/route';
import { HubGate, TapTwice, useHubJson, when } from './hubPage';

export interface PluginTarget { kind: string; label: string; repo: string; branch: string; dir: string }
export interface PluginItem {
  kind: string; folder: string; id: string; name: string; version: string; versions: string[]; sha256: string;
  bytes: number; files: number; publishedAt: string; description: string; builtWith?: { model?: string; builtAt?: string };
}
interface ListView { targets: PluginTarget[]; reachable: boolean; updatedAt: string; items: PluginItem[] }
interface OneView {
  target: PluginTarget;
  entry: PluginItem;
  package: { version: string; sha256: string; bytes: number; files: { path: string; bytes: number }[]; manifest: { id: string; name: string; description: string } };
  repo: { present?: boolean; id?: string; version?: string; foreign?: boolean; error?: string };
}
interface InstallResult { action: 'installed' | 'updated' | 'uninstalled'; name: string; version: string; commit: string; url: string; files: number; removed: number; repo: string; branch: string; path: string }

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Newer-than for plugin versions (1.10.0 > 1.9.0); prerelease tags only break ties. */
export function versionNewer(a: string, b: string): boolean {
  const pa = a.split(/[-+]/)[0]!.split('.').map(Number);
  const pb = b.split(/[-+]/)[0]!.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

export function Plugins() {
  return <HubGate admin what="plugin installs">{() => <ListPage />}</HubGate>;
}

function ListPage() {
  const rt = useRuntime();
  const params = useRouteParams('plugins');
  const res = useHubJson<ListView>(`/auth/api/plugins${params.kind ? `?kind=${encodeURIComponent(params.kind)}` : ''}`);
  const v = res.data;
  const label = (kind: string) => v?.targets.find((t) => t.kind === kind)?.label ?? kind;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugin catalog</p>
          <h1>Plugins</h1>
          <p className="fx-muted">Install a plugin into one of your apps from here. It's written into the app's repo as one commit and the app picks it up on its next rebuild.</p>
        </div>
        <Button icon="refresh" onClick={() => void res.reload()} disabled={res.loading}>Check again</Button>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {v && !v.reachable && <Note tone="warning" icon="alert">The hub can't see the plugin catalog. The Dev Console publishes it to the shared data folder.</Note>}
      {v && v.targets.length === 0 && <Note tone="warning">No app installs plugins this way yet (AXHUB_PLUGIN_TARGETS on the hub).</Note>}
      {v && v.targets.length > 1 && (
        <div className="fx-row fx-row--wrap">
          <Button size="sm" tone={!params.kind ? 'primary' : 'neutral'} onClick={() => go(rt, 'plugins')}>All</Button>
          {v.targets.map((t) => <Button key={t.kind} size="sm" tone={params.kind === t.kind ? 'primary' : 'neutral'} onClick={() => go(rt, 'plugins', { kind: t.kind })}>{t.label}</Button>)}
        </div>
      )}
      {v && v.reachable && v.items.length === 0 && <p className="fx-muted">Nothing published for {params.kind ? label(params.kind) : 'these apps'} yet.</p>}
      {v?.items.map((it) => (
        <Container key={`${it.kind}/${it.folder}`} title={it.name} icon="package" actions={<Chip>{label(it.kind)}</Chip>}>
          <div className="fx-stack">
            {it.description && <p>{it.description}</p>}
            <p className="fx-muted">
              {it.version} · {it.files} file{it.files === 1 ? '' : 's'} · {size(it.bytes)}{it.publishedAt ? ` · published ${relTime(it.publishedAt)}` : ''}{it.builtWith?.model ? ` · built with ${it.builtWith.model}` : ''}
            </p>
            <div className="fx-row"><Button tone="primary" size="sm" icon="download" onClick={() => go(rt, 'plugin-install', { kind: it.kind, folder: it.folder })}>Open</Button></div>
          </div>
        </Container>
      ))}
    </div>
  );
}

export function PluginInstall() {
  return <HubGate admin what="plugin installs">{() => <InstallPage />}</HubGate>;
}

function InstallPage() {
  const rt = useRuntime();
  const params = useRouteParams('plugin-install');
  const kind = params.kind ?? '';
  const folder = params.folder ?? '';
  const path = kind && folder ? `/auth/api/plugins/${encodeURIComponent(kind)}/${encodeURIComponent(folder)}${params.version ? `?version=${encodeURIComponent(params.version)}` : ''}` : null;
  const res = useHubJson<OneView>(path);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<InstallResult | null>(null);
  const [confirm, setConfirm] = useState('');
  const v = res.data;

  const send = async (route: 'install' | 'uninstall', body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await hubPost<{ ok: boolean; result: InstallResult }>(`/auth/api/plugins/${route}`, body);
      setDone(r.result);
      setConfirm('');
      rt.toast(`${r.result.name} ${r.result.action}.`, 'success', 'Plugins');
      await res.reload();
    } catch (e) {
      rt.toast(e instanceof Error ? e.message : String(e), 'danger', 'Plugins');
    } finally {
      setBusy(false);
    }
  };

  if (!path) return <Note tone="warning">That plugin link isn't complete. <Button size="sm" onClick={() => go(rt, 'plugins')}>All plugins</Button></Note>;
  const repo = v?.repo ?? {};
  const same = !!v && repo.present && !repo.foreign && repo.id === v.package.manifest.id;
  const other = !!v && repo.present && (repo.foreign || repo.id !== v.package.manifest.id);
  const newer = same && !!repo.version && versionNewer(v.package.version, repo.version);
  const current = same && repo.version === v.package.version;

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">{v ? v.target.label : 'Plugin'}</p>
          <h1>{v ? v.package.manifest.name : folder}</h1>
          <p className="fx-muted">{v?.package.manifest.description || 'From the plugin catalog.'}</p>
        </div>
        <Button icon="list" onClick={() => go(rt, 'plugins', { kind })}>All plugins</Button>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {done && (
        <Note tone="success" icon="check">
          <div className="fx-stack">
            <span>
              {done.name} {done.action === 'uninstalled' ? 'was taken out of' : `${done.version} is ${done.action} in`} {done.repo} ({done.path}).
              {done.removed && done.action !== 'uninstalled' ? ` ${done.removed} old file${done.removed === 1 ? '' : 's'} removed.` : ''} The app rebuilds with it in about 5 minutes.
            </span>
            <div className="fx-row"><Button size="sm" icon="external" onClick={() => window.open(done.url, '_blank', 'noopener,noreferrer')}>The commit on GitHub</Button></div>
          </div>
        </Note>
      )}
      {v && (
        <>
          <Container title="What happens" icon="info">
            <div className="fx-stack">
              <p>
                {other ? 'Nothing can be installed here: ' : `${same ? 'Updates' : 'Writes'} `}
                {other
                  ? `${v.target.dir}/${folder} already holds ${repo.foreign ? 'something that isn\'t a plugin of this kind' : `another plugin (${repo.id})`}.`
                  : <>{v.package.files.length} file{v.package.files.length === 1 ? '' : 's'} ({size(v.package.bytes)}) into <code>{v.target.dir}/{folder}</code> on the {v.target.branch} branch of {v.target.repo}, as one commit.</>}
              </p>
              <table className="fx-table"><tbody>
                <tr><th>In the catalog</th><td>{v.package.version}{v.entry.versions.length > 1 ? ` (also ${v.entry.versions.filter((x) => x !== v.package.version).join(', ')})` : ''}</td></tr>
                <tr><th>In the app now</th><td>{repo.error ? `Couldn't check: ${repo.error}` : !repo.present ? 'Not installed' : repo.foreign ? 'Something else' : `${repo.id === v.package.manifest.id ? repo.version || 'installed' : `another plugin (${repo.id})`}`}</td></tr>
                <tr><th>Published</th><td>{when(v.entry.publishedAt)}{v.entry.builtWith?.model ? ` · built with ${v.entry.builtWith.model}` : ''}</td></tr>
                <tr><th>Content hash</th><td className="fx-mono">{v.package.sha256.slice(0, 16)}…</td></tr>
              </tbody></table>
              <div className="fx-row fx-row--wrap">
                {!other && !same && <Button tone="primary" icon="download" disabled={busy || !!repo.error} onClick={() => void send('install', { kind, folder, ...(params.version ? { version: params.version } : {}) })}>{busy ? 'Installing…' : `Install ${v.package.version}`}</Button>}
                {same && !current && (
                  <TapTwice label={newer ? `Update to ${v.package.version}` : `Replace with ${v.package.version}`} again="Tap again to write it" tone="primary" icon="refresh" disabled={busy}
                    onConfirm={() => void send('install', { kind, folder, update: true, ...(params.version ? { version: params.version } : {}) })} />
                )}
                {current && <Chip tone="success">Installed and current</Chip>}
              </div>
            </div>
          </Container>
          <Container title={`Files (${v.package.files.length})`} icon="list" collapsible defaultOpen={false}>
            <table className="fx-table"><tbody>
              {v.package.files.map((f) => <tr key={f.path}><td className="fx-mono">{f.path}</td><td className="fx-muted">{size(f.bytes)}</td></tr>)}
            </tbody></table>
          </Container>
          {same && (
            <Container title="Uninstall" icon="trash" collapsible defaultOpen={false}>
              <div className="fx-stack">
                <p className="fx-muted">Takes {v.target.dir}/{folder} out of {v.target.repo} in one commit. Type <code>{folder}</code> to confirm.</p>
                <TextField label="Folder name" value={confirm} onChange={setConfirm} placeholder={folder} />
                <div className="fx-row"><Button tone="danger" icon="trash" disabled={busy || confirm !== folder} onClick={() => void send('uninstall', { kind, folder, confirm })}>Uninstall</Button></div>
              </div>
            </Container>
          )}
        </>
      )}
    </div>
  );
}
