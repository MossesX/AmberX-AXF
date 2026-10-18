/**
 * Shared plugin lifecycle panel (plugin-lifecycle@1). Every plugin shows this in its settings tab:
 * install / repair, stale-code check, backups, and a complete uninstall (data only, or code + data for a clean
 * reinstall of a newer build). It talks to the console's own /api/plugin-lifecycle routes, so it keeps working
 * while the plugin is disabled. Generic: it never names a plugin, so removing one leaves nothing here to clean up.
 *
 *   import { PluginLifecyclePanel } from '@console/pluginLifecycle';
 *   settingsPanels: [{ id: 'x.lifecycle', tab: 'x', title: 'Install & uninstall', render: () => <PluginLifecyclePanel folder="x" /> }]
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon, useRuntime } from './axf/react';
import './pluginLifecycle.css';

interface Ref { file: string; line: number; text: string; managed: boolean }
interface Status {
  folder: string; present: boolean; id: string | null; name: string; version: string | null; dataDir: string;
  data: { files: number; bytes: number }; dataExists: boolean; stateEntry: boolean | null; installed: boolean;
  hasInstallScript: boolean; hasUninstallScript: boolean; backups: string[]; loaded?: boolean; enabled?: boolean;
  references: { managed: Ref[]; stale: Ref[] }; lifecycle: { env?: string[]; mentions?: string[] };
}
interface Result { ok: boolean; log?: string[]; stale?: Ref[]; backup?: string | null; problems?: string[]; checks?: { id: string; ok: boolean; detail: string }[]; restartNeeded?: boolean; published?: { pushed: boolean; sha?: string } | null }

function token(): string {
  try { return localStorage.getItem('axf-console:token') ?? ''; } catch { return ''; }
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  const r = await fetch(`/api/plugin-lifecycle/${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Settings → Account & security).');
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`);
  return j;
}
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function PluginLifecyclePanel({ folder }: { folder: string }) {
  const rt = useRuntime();
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [level, setLevel] = useState<'data' | 'all'>('data');
  const [publish, setPublish] = useState(false);
  const [backup, setBackup] = useState(true);
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const load = () => api<Status>(folder).then((x) => { setS(x); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, [folder]);

  const run = async (label: string, action: string, body: Record<string, unknown>) => {
    setBusy(label); setResult(null);
    try {
      const r = await api<Result>(`${folder}/${action}`, body);
      setResult(r);
      if (action === 'uninstall' && !body.dryRun) { setConfirm(''); rt.toast(r.restartNeeded ? 'Uninstalled. Reload the console (and restart its server) to drop the plugin completely.' : 'Plugin data removed.', 'success', 'Uninstall'); }
      if (action === 'install') rt.toast('Install script finished.', 'success', 'Install');
      await load();
    } catch (e) { setResult({ ok: false, log: [(e as Error).message] }); }
    finally { setBusy(''); }
  };

  if (err) return <div className="cl-life__note is-warn"><Icon name="alert" size={14} />{err}</div>;
  if (!s) return <p className="fx-muted">Loading…</p>;
  const uninstallBody = { [level]: true, publish: level === 'all' && publish, backup };

  return (
    <div className="cl-life fx-stack">
      <div className="cl-life__row">
        <strong className="fx-grow">{s.name}{s.version ? ` ${s.version}` : ''}</strong>
        {s.installed ? <Chip tone="success">installed</Chip> : s.present ? <Chip tone="warning">not installed</Chip> : <Chip tone="danger">code removed</Chip>}
        {s.present && <Chip tone={s.enabled ? 'accent' : undefined}>{s.enabled ? 'enabled' : 'disabled'}</Chip>}
      </div>
      <dl className="cl-life__facts">
        <dt>Data folder</dt><dd className="fx-mono">{s.dataDir} {s.dataExists ? `(${s.data.files} files, ${kb(s.data.bytes)})` : '(none)'}</dd>
        <dt>Code</dt><dd className="fx-mono">apps/console-web/plugins/{folder}/ {s.present ? '' : '(gone)'}</dd>
        <dt>Doc lines</dt><dd>{s.references.managed.length} managed · {s.references.stale.length ? <span className="cl-life__bad">{s.references.stale.length} stale</span> : '0 stale'}</dd>
        {!!s.lifecycle.env?.length && <><dt>Reads env</dt><dd className="fx-mono">{s.lifecycle.env.join(', ')}</dd></>}
      </dl>

      <div className="cl-life__row">
        <Button tone="primary" icon="download" disabled={!!busy || !s.present} onClick={() => void run('install', 'install', {})}>{s.installed ? 'Re-run install (repair)' : 'Install'}</Button>
        <Button icon="search" disabled={!!busy} onClick={() => void run('check', 'check', { afterUninstall: !s.present })}>Check for stale code</Button>
        <Button icon="refresh" disabled={!!busy} onClick={() => void load()}>Refresh</Button>
      </div>

      {s.backups.length > 0 && (
        <details className="cl-life__box">
          <summary>Backups ({s.backups.length})</summary>
          {s.backups.slice(0, 8).map((b) => (
            <div key={b} className="cl-life__row"><span className="fx-mono fx-small fx-grow">{b}</span><Button icon="upload" disabled={!!busy || s.dataExists} onClick={() => void run('restore', 'restore', { backup: `.axf-console/plugin-backups/${b}` })}>Restore</Button></div>
          ))}
          {s.dataExists && <p className="fx-small fx-muted">Restore needs the data folder removed first (uninstall data only).</p>}
        </details>
      )}

      <div className="cl-life__box cl-life__danger fx-stack">
        <strong><Icon name="trash" size={14} /> Uninstall</strong>
        <label className="cl-life__opt"><input type="radio" checked={level === 'data'} onChange={() => setLevel('data')} /> Data only: wipe settings, keys and history and switch it off (code stays; Install starts it fresh)</label>
        <label className="cl-life__opt"><input type="radio" checked={level === 'all'} onChange={() => setLevel('all')} /> Everything: code + data + doc lines, nothing left behind (use before installing a newer build)</label>
        {level === 'all' && <label className="cl-life__opt"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Also commit the removal and push it to GitHub (needs the console's GITHUB_TOKEN), so every clone drops it</label>}
        <label className="cl-life__opt"><input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} /> Back up the data folder first (.axf-console/plugin-backups/)</label>
        <div className="cl-life__row">
          <input className="fx-input cl-life__confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`type ${folder} to confirm`} aria-label="Confirm plugin folder" />
          <Button icon="eye" disabled={!!busy} onClick={() => void run('preview', 'uninstall', { ...uninstallBody, dryRun: true })}>Preview</Button>
          <Button tone="danger" icon="trash" disabled={!!busy || confirm !== folder} onClick={() => void run('uninstall', 'uninstall', { ...uninstallBody, confirm })}>Uninstall</Button>
        </div>
        <p className="fx-small fx-muted">Terminal: <code className="fx-mono">node apps/console-web/plugins/{folder}/uninstall.mjs {level === 'all' ? '--all' : '--data'}{publish && level === 'all' ? ' --publish' : ''}</code> · install: <code className="fx-mono">node apps/console-web/plugins/{folder}/install.mjs</code></p>
      </div>

      {busy && <p className="fx-muted">Working ({busy})…</p>}
      {result && (
        <div className={`cl-life__note ${result.ok ? 'is-ok' : 'is-warn'}`}>
          <div className="fx-stack">
            {(result.log ?? []).map((l, i) => <span key={i} className="fx-small">{l}</span>)}
            {result.backup && <span className="fx-small">Backup: <span className="fx-mono">{result.backup}</span></span>}
            {result.checks?.map((c) => <span key={c.id} className="fx-small">{c.ok ? '✓' : '✗'} {c.id}: {c.detail}</span>)}
            {result.problems?.map((p, i) => <span key={i} className="fx-small cl-life__bad">✗ {p}</span>)}
            {result.problems && result.problems.length === 0 && <span className="fx-small">✓ Clean: no stale references.</span>}
            {result.stale?.map((r, i) => <span key={i} className="fx-small fx-mono cl-life__bad">{r.file}:{r.line} {r.text}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
