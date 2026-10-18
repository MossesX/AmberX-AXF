/* Settings → Plugins → Container access panels. Theme tokens only, axp-container-access prefix. */
import { useEffect, useState } from 'react';
import { Button, Chip, Icon } from '@console/axf/react';
import { ChangeBatchCard, type Batch } from '@console/changeBatch';
import { batchActions, call, kb, put, when, type AuditEntry, type Container, type Entry, type Settings, type Status } from './api';

const P = 'axp-container-access';

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [v, setV] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const load = () => fn().then((x) => { setV(x); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { v, err, load, setV };
}

export function StatusPanel() {
  const { v: s, err, load } = useLoad(() => call<Status>('status'));
  if (err) return <p className={`${P}__bad`}>{err}</p>;
  if (!s) return <p className="fx-muted">Checking…</p>;
  return (
    <div className="fx-stack">
      <div className={`${P}__note ${s.proxy.ok ? 'is-ok' : 'is-warn'}`}>
        <Icon name={s.proxy.ok ? 'check-circle' : 'alert'} size={16} />
        <span className="fx-grow">
          {s.proxy.ok
            ? <>Docker socket proxy reachable at <span className="fx-mono">{s.proxy.url}</span> (Docker {s.proxy.docker}, API {s.proxy.api}).</>
            : <>Docker socket proxy not reachable{s.proxy.url ? <> at <span className="fx-mono">{s.proxy.url}</span></> : ''}: {s.proxy.error}. On the VPS run <span className="fx-mono">bash /opt/axf/deploy/install-console.sh</span>; it starts the proxy and connects the console to it.</>}
        </span>
        <Button tone="ghost" icon="refresh" onClick={() => void load()}>Check</Button>
      </div>
      <div className={`${P}__note ${s.snapshots ? 'is-ok' : 'is-warn'}`}>
        <Icon name={s.snapshots ? 'check-circle' : 'alert'} size={16} />
        <span>{s.snapshots ? 'Snapshot Manager is installed: approved changes are snapshotted first and can be undone.' : 'Snapshot Manager isn’t installed or enabled, so no change can be approved (nothing is written without a snapshot). Reading still works.'}</span>
      </div>
      <div className={`${P}__note ${s.coolify ? 'is-ok' : ''}`}>
        <Icon name={s.coolify ? 'check-circle' : 'info'} size={16} />
        <span>{s.coolify ? 'Coolify API configured: Coolify apps can be redeployed through Coolify.' : 'Coolify API not configured (Systems check → Coolify). Coolify apps can still be restarted, not redeployed.'}</span>
      </div>
    </div>
  );
}

function Browser({ c, close }: { c: Container; close: () => void }) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [file, setFile] = useState<{ path: string; content: string; encoding: string; truncated: boolean; size: number } | null>(null);
  const [err, setErr] = useState('');
  const go = async (p: string) => {
    setErr(''); setFile(null);
    try { const r = await call<{ path: string; entries: Entry[] }>(`containers/${encodeURIComponent(c.name)}/dir?path=${encodeURIComponent(p)}`); setPath(r.path); setEntries(r.entries); }
    catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => {
    void call<{ workdir: string }>(`containers/${encodeURIComponent(c.name)}/workdir`).then((r) => go(r.workdir || '/'), () => go('/'));
  }, [c.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (p: string) => {
    setErr('');
    try { setFile(await call(`containers/${encodeURIComponent(c.name)}/file?path=${encodeURIComponent(p)}`)); } catch (e) { setErr((e as Error).message); }
  };
  const up = path.replace(/\/[^/]*$/, '') || '/';
  return (
    <div className={`${P}__browser fx-stack`}>
      <div className={`${P}__row`}>
        <strong className="fx-grow"><Icon name="folder" size={14} /> {c.name}: <span className="fx-mono">{path || '…'}</span></strong>
        <Button tone="ghost" icon="arrow-left" disabled={path === '/'} onClick={() => void go(up)}>Up</Button>
        <Button tone="ghost" icon="x" onClick={close}>Close</Button>
      </div>
      <p className="fx-small fx-muted">Read-only. Changes go through an agent’s approved change batch (or the terminal).</p>
      {err && <p className={`${P}__bad`}>{err}</p>}
      {file ? (
        <div className="fx-stack">
          <div className={`${P}__row`}><span className="fx-mono fx-grow">{file.path}</span><span className="fx-small fx-muted">{kb(file.size)}{file.truncated ? ' (cut short)' : ''}</span><Button tone="ghost" onClick={() => setFile(null)}>Back to folder</Button></div>
          <pre className={`${P}__code`}>{file.encoding === 'utf8' ? file.content : '(binary file)'}</pre>
        </div>
      ) : (
        <ul className={`${P}__entries`}>
          {(entries ?? []).map((e) => (
            <li key={e.name}>
              <button type="button" onClick={() => void (e.type === 'dir' ? go(`${path === '/' ? '' : path}/${e.name}`) : open(`${path === '/' ? '' : path}/${e.name}`))}>
                <Icon name={e.type === 'dir' ? 'folder' : 'file'} size={14} /><span className="fx-grow fx-mono">{e.name}{e.type === 'link' ? ' →' : ''}</span>
                {e.type === 'file' && <span className="fx-small fx-muted">{kb(e.size)}</span>}
              </button>
            </li>
          ))}
          {entries && !entries.length && <li className="fx-muted fx-small">Empty folder.</li>}
        </ul>
      )}
    </div>
  );
}

export function ContainersPanel() {
  const { v, err, load } = useLoad(() => call<{ items: Container[] }>('containers').then((r) => r.items));
  const [browse, setBrowse] = useState<Container | null>(null);
  if (err) return <p className={`${P}__bad`}>{err}</p>;
  if (!v) return <p className="fx-muted">Loading containers…</p>;
  if (browse) return <Browser c={browse} close={() => setBrowse(null)} />;
  return (
    <div className="fx-stack">
      <div className={`${P}__row`}>
        <span className="fx-grow fx-small fx-muted">{v.filter((c) => c.reachable).length} reachable · {v.filter((c) => c.protected).length} protected · {v.length} total</span>
        <Button tone="ghost" icon="refresh" onClick={() => void load()}>Refresh</Button>
      </div>
      <ul className={`${P}__list`}>
        {v.map((c) => (
          <li key={c.id} className={`${P}__container ${c.reachable ? '' : 'is-off'}`}>
            <div className={`${P}__row`}>
              <Icon name={c.protected ? 'lock' : 'box'} size={15} />
              <strong className="fx-grow fx-mono">{c.name}</strong>
              {c.protected ? <Chip tone="danger">protected</Chip> : c.reachable ? <Chip tone="success">reachable</Chip> : <Chip>not on your list</Chip>}
              {c.coolify && <Chip tone="accent">Coolify</Chip>}
              <Chip tone={c.state === 'running' ? undefined : 'warning'}>{c.state}</Chip>
            </div>
            <div className="fx-small fx-muted fx-mono">{c.image}</div>
            {c.protected && <div className="fx-small fx-muted">{c.protected.label}</div>}
            {c.reachable && c.state === 'running' && <div><Button tone="ghost" icon="folder" onClick={() => setBrowse(c)}>Browse files</Button></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProtectionPanel() {
  const { v: s, err } = useLoad(() => call<Status>('status'));
  const [draft, setDraft] = useState<Partial<Settings> & { protectText?: string; allowText?: string }>({});
  const [msg, setMsg] = useState('');
  if (err) return <p className={`${P}__bad`}>{err}</p>;
  if (!s) return <p className="fx-muted">Loading…</p>;
  const cur = { ...s.settings, ...draft };
  const protectText = draft.protectText ?? s.settings.protect.join('\n');
  const allowText = draft.allowText ?? s.settings.allow.join('\n');
  const save = async () => {
    setMsg('Saving…');
    try {
      const lines = (t: string) => t.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
      const r = await put<Settings>('settings', { reach: cur.reach, protect: lines(protectText), allow: lines(allowText), maxReadKb: cur.maxReadKb, execTimeout: cur.execTimeout, terminalUser: cur.terminalUser });
      s.settings = r; setDraft({}); setMsg('✓ Saved');
    } catch (e) { setMsg(`✗ ${(e as Error).message}`); }
  };
  return (
    <div className="fx-stack">
      <div>
        <strong>Always protected (locked)</strong>
        <ul className={`${P}__locked`}>
          {s.builtinProtected.map((r) => <li key={r.id}><Icon name="lock" size={13} /> {r.label}</li>)}
        </ul>
        <p className="fx-small fx-muted">Enforced on the server: nothing reads, writes or runs commands in these. Only the terminal can open one, after an extra confirm.</p>
      </div>
      <label className={`${P}__field`}><span>Also protect (one name or pattern per line, * and ? allowed; matches the name or image)</span>
        <textarea className="fx-input" rows={3} value={protectText} onChange={(e) => setDraft({ ...draft, protectText: e.target.value })} placeholder="axhub*\nmy-prod-*" />
      </label>
      <fieldset className={`${P}__field`}>
        <span>Reach</span>
        <label className={`${P}__opt`}><input type="radio" name="reach" checked={cur.reach === 'all'} onChange={() => setDraft({ ...draft, reach: 'all' })} /> Every container except the protected ones</label>
        <label className={`${P}__opt`}><input type="radio" name="reach" checked={cur.reach === 'list'} onChange={() => setDraft({ ...draft, reach: 'list' })} /> Only these containers:</label>
        {cur.reach === 'list' && <textarea className="fx-input" rows={3} value={allowText} onChange={(e) => setDraft({ ...draft, allowText: e.target.value })} placeholder="xgallery*\nstudiox" />}
      </fieldset>
      <div className={`${P}__cols`}>
        <label className={`${P}__field`}><span>Largest file to read (KB)</span><input className="fx-input" type="number" min={16} max={8192} value={cur.maxReadKb} onChange={(e) => setDraft({ ...draft, maxReadKb: Number(e.target.value) })} /></label>
        <label className={`${P}__field`}><span>Command timeout (seconds)</span><input className="fx-input" type="number" min={10} max={3600} value={cur.execTimeout} onChange={(e) => setDraft({ ...draft, execTimeout: Number(e.target.value) })} /></label>
        <label className={`${P}__field`}><span>Terminal user</span><input className="fx-input" value={cur.terminalUser} onChange={(e) => setDraft({ ...draft, terminalUser: e.target.value })} /></label>
      </div>
      <div className={`${P}__row`}><Button tone="primary" icon="save" onClick={() => void save()}>Save</Button><span className="fx-small">{msg}</span></div>
    </div>
  );
}

export function BatchesPanel() {
  const [filter, setFilter] = useState('pending');
  const { v, err, load } = useLoad(() => call<{ items: Batch[] }>(`batches?status=${filter}&limit=30`).then((r) => r.items), [filter]);
  return (
    <div className="fx-stack">
      <div className={`${P}__row`}>
        <div className={`${P}__seg`} role="tablist">
          {['pending', 'applied', 'partial', 'failed', 'rejected', 'undone', ''].map((f) => (
            <button key={f || 'all'} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{f || 'all'}</button>
          ))}
        </div>
        <span className="fx-grow" />
        <Button tone="ghost" icon="refresh" onClick={() => void load()}>Refresh</Button>
      </div>
      <p className="fx-small fx-muted">Changes agents proposed. The same cards show in the assistant’s chat; approve or reject them here or there.</p>
      {err && <p className={`${P}__bad`}>{err}</p>}
      {v?.map((b) => <ChangeBatchCard key={b.id} batch={b} actions={batchActions(b.id)} />)}
      {v && !v.length && <p className="fx-muted fx-small">No {filter || ''} batches.</p>}
    </div>
  );
}

const OP_ICON: Record<string, string> = { write: 'edit', delete: 'trash', exec: 'terminal', restart: 'refresh', redeploy: 'rocket', restore: 'undo', terminal: 'terminal', settings: 'settings' };

export function AuditPanel() {
  const [q, setQ] = useState({ container: '', op: '' });
  const { v, err, load } = useLoad(() => call<{ items: AuditEntry[] }>(`audit?limit=300&container=${encodeURIComponent(q.container)}&op=${q.op}`).then((r) => r.items), [q.container, q.op]);
  return (
    <div className="fx-stack">
      <div className={`${P}__row`}>
        <input className={`fx-input ${P}__narrow`} placeholder="Container" value={q.container} onChange={(e) => setQ({ ...q, container: e.target.value })} />
        <select className={`fx-input ${P}__narrow`} value={q.op} onChange={(e) => setQ({ ...q, op: e.target.value })}>
          {['', 'write', 'delete', 'exec', 'restart', 'redeploy', 'restore', 'terminal', 'batch-approve', 'batch-reject', 'batch-undo', 'settings'].map((o) => <option key={o} value={o}>{o || 'every action'}</option>)}
        </select>
        <span className="fx-grow" />
        <Button tone="ghost" icon="refresh" onClick={() => void load()}>Refresh</Button>
      </div>
      {err && <p className={`${P}__bad`}>{err}</p>}
      <ul className={`${P}__audit`}>
        {(v ?? []).map((e, i) => (
          <li key={`${e.at}-${i}`} className={e.ok === false ? 'is-bad' : undefined}>
            <Icon name={OP_ICON[e.op] ?? (e.op.startsWith('batch') ? 'shield' : 'info')} size={13} />
            <span className="fx-small fx-muted">{when(e.at)}</span>
            <strong>{e.op}</strong>
            {e.container && <span className="fx-mono">{e.container.name}</span>}
            {e.path && <span className="fx-mono">{e.path}</span>}
            {e.command && <code className="fx-mono">{String(e.command).slice(0, 120)}</code>}
            {e.exitCode != null && <span className="fx-small">exit {e.exitCode}</span>}
            <span className="fx-small fx-muted">by {e.actor?.name ?? '?'}</span>
            {e.snapshot && <span className="fx-small fx-mono">snap {e.snapshot}</span>}
            {e.error && <span className={`${P}__bad fx-small`}>{e.error}</span>}
          </li>
        ))}
        {v && !v.length && <li className="fx-muted fx-small">Nothing logged yet.</li>}
      </ul>
    </div>
  );
}
