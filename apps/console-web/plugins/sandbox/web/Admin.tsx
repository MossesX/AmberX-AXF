/** Sandbox management (Settings → Plugins → Sandbox): who may use it, which repositories, limits, every workspace, clear. */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, Switch, TextField } from '@console/axf/react';
import { api, errText, fmtAgo, fmtBytes, type AdminState, type SandboxConfig } from './api';

export function AdminPanel() {
  const [st, setSt] = useState<AdminState | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [repos, setRepos] = useState('');
  const [confirm, setConfirm] = useState<Record<string, string>>({});
  const [allConfirm, setAllConfirm] = useState('');

  const load = useCallback(() => api.call<AdminState>('admin/state').then((s) => { setSt(s); setRepos(s.config.repos.join('\n')); setErr(''); }, (e) => setErr(errText(e))), []);
  useEffect(() => { void load(); }, [load]);

  const put = (patch: Partial<SandboxConfig>) => api.put<SandboxConfig>('admin/config', patch)
    .then((cfg) => { setSt((s) => (s ? { ...s, config: cfg } : s)); setRepos(cfg.repos.join('\n')); setNote('Saved.'); setErr(''); }, (e) => setErr(errText(e)));
  const clear = (workspace: string, typed: string) => api.post<{ cleared: number }>('admin/clear', { workspace, confirm: typed })
    .then((r) => { setNote(`Cleared ${r.cleared} sandbox${r.cleared === 1 ? '' : 'es'}.`); setConfirm({}); setAllConfirm(''); void load(); }, (e) => setErr(errText(e)));

  if (err && !st) return <Note tone={/admins/.test(err) ? 'warning' : 'danger'}>{err}</Note>;
  if (!st) return <p className="fx-small fx-muted">Loading…</p>;
  const c = st.config;
  const total = st.workspaces.reduce((n, w) => n + w.bytes, 0);

  return (
    <div className="fx-stack">
      {err && <Note tone="danger">{err}</Note>}
      {note && <Note tone="success">{note}</Note>}
      <Container title="Access" icon="shield">
        <div className="fx-stack">
          <Switch label="Sandbox open" hint="Off: only admins can use it." checked={c.enabled} onChange={(v) => void put({ enabled: v })} />
          <SelectField label="Who may use it" value={c.openTo} onChange={(v) => void put({ openTo: v as SandboxConfig['openTo'] })} options={[
            { value: 'everyone', label: 'Everyone signed in to the console' },
            { value: 'permission', label: 'Hub accounts with console.sandbox' },
            { value: 'admins', label: 'Admins only' },
          ]} hint="Grant console.sandbox on the hub's users page." />
        </div>
      </Container>
      <Container title="GitHub (read-only)" icon="github" actions={<Chip tone={st.hub.ready ? 'success' : 'warning'}>{st.hub.ready ? 'axHub connected' : 'axHub not set up'}</Chip>}>
        <div className="fx-stack">
          {!st.hub.ready && <Note tone="warning">{st.hub.reason}</Note>}
          <TextField label="Repositories the sandbox may read (owner/name, one per line)" value={repos} onChange={setRepos} rows={4} mono />
          <div className="fx-row"><Button tone="primary" icon="save" onClick={() => void put({ repos: repos.split(/\s+/).filter(Boolean) })}>Save repositories</Button></div>
          <p className="fx-small fx-muted">The sandbox can only send these axHub tools: <span className="fx-mono">{st.readTools.join(', ')}</span>. Write tools don't exist in it.</p>
        </div>
      </Container>
      <Container title="Limits per person" icon="sliders">
        <div className="axp-sandbox__grid">
          <LimitField label="Files" value={c.maxFiles} onSave={(v) => put({ maxFiles: v })} />
          <LimitField label="File size (KB)" value={c.maxFileKb} onSave={(v) => put({ maxFileKb: v })} />
          <LimitField label="Total (MB)" value={c.maxTotalMb} onSave={(v) => put({ maxTotalMb: v })} />
        </div>
      </Container>
      <Container title={`Workspaces (${st.workspaces.length})`} icon="folder" actions={<span className="fx-small fx-muted">{fmtBytes(total)}</span>}>
        <div className="fx-stack">
          <p className="fx-small fx-muted">Sandbox files stay until you clear them here. Type the workspace id to clear one.</p>
          <ul className="axp-sandbox__list">
            {st.workspaces.map((w) => (
              <li key={w.id} className="axp-sandbox__item">
                <div className="axp-sandbox__grow">
                  <div className="axp-sandbox__title">{w.user} <span className="fx-small fx-muted fx-mono">({w.id})</span></div>
                  <div className="fx-small fx-muted">{w.files} files · {fmtBytes(w.bytes)} · last used {fmtAgo(w.lastUsedAt)}</div>
                </div>
                <input className="axp-sandbox__confirm" aria-label={`Type ${w.id} to clear`} placeholder={w.id} value={confirm[w.id] ?? ''} onChange={(e) => setConfirm({ ...confirm, [w.id]: e.target.value })} />
                <Button tone="danger" icon="trash" disabled={confirm[w.id] !== w.id} onClick={() => void clear(w.id, w.id)}>Clear</Button>
              </li>
            ))}
            {!st.workspaces.length && <li className="fx-small fx-muted">No one has used the sandbox yet.</li>}
          </ul>
          {st.workspaces.length > 0 && (
            <div className="axp-sandbox__bar">
              <TextField label='Clear every sandbox: type "clear all"' value={allConfirm} onChange={setAllConfirm} />
              <Button tone="danger" icon="trash" disabled={allConfirm !== 'clear all'} onClick={() => void clear('*', 'clear all')}>Clear all</Button>
            </div>
          )}
        </div>
      </Container>
      <Container title="Activity" icon="clock" actions={<Button tone="ghost" icon="refresh" onClick={() => void load()}>Refresh</Button>}>
        <ul className="axp-sandbox__list">
          {st.log.slice(0, 60).map((e, i) => (
            <li key={i} className="axp-sandbox__item"><span className="fx-small fx-muted">{fmtAgo(e.at)}</span><span className="axp-sandbox__grow"><b>{e.user}</b> {e.action} <span className="fx-mono fx-small">{e.detail}</span></span></li>
          ))}
          {!st.log.length && <li className="fx-small fx-muted">Nothing yet.</li>}
        </ul>
      </Container>
    </div>
  );
}

function LimitField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => Promise<unknown> }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const n = Number(v);
  return (
    <div className="axp-sandbox__bar">
      <TextField label={label} value={v} onChange={setV} type="number" />
      <Button icon="save" disabled={!Number.isInteger(n) || n === value} onClick={() => void onSave(n)}>Set</Button>
    </div>
  );
}
