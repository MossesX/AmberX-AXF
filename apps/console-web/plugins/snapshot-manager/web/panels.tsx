/* Settings → Plugins → Snapshots panels. Theme tokens only, axp-snapshot-manager prefix. */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import { call, del, getFocus, onFocus, post, put, size, when, type DiffEntry, type FileDiff, type Settings, type Snapshot, type Usage } from './api';

const P = 'axp-snapshot-manager';

function FileDiffView({ sid, file, close }: { sid: string; file: string; close: () => void }) {
  const [d, setD] = useState<FileDiff | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void call<FileDiff>(`snapshots/${sid}/diff?file=${encodeURIComponent(file)}`).then(setD, (e: Error) => setErr(e.message)); }, [sid, file]);
  return (
    <div className="fx-stack">
      <div className={`${P}__row`}><strong className="fx-grow fx-mono">{file}</strong><Button tone="ghost" icon="x" onClick={close}>Close diff</Button></div>
      {err && <p className={`${P}__bad`}>{err}</p>}
      {d && (d.diff.binary ? <p className="fx-muted fx-small">Binary file.</p> : !d.diff.text ? <p className="fx-muted fx-small">No difference.</p> : (
        <pre className={`${P}__diff`}>
          {d.diff.text.split('\n').map((l, i) => <span key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'is-add' : l.startsWith('-') && !l.startsWith('---') ? 'is-del' : l.startsWith('@@') ? 'is-hunk' : undefined}>{l}{'\n'}</span>)}
        </pre>
      ))}
      {d && !d.then && <p className="fx-small fx-muted">Didn’t exist at snapshot time.</p>}
      {d && !d.now && <p className="fx-small fx-muted">Gone now.</p>}
    </div>
  );
}

function Changes({ s }: { s: Snapshot }) {
  const [d, setD] = useState<DiffEntry[] | null>(null);
  const [err, setErr] = useState('');
  const [file, setFile] = useState('');
  useEffect(() => { void call<{ entries: DiffEntry[] }>(`snapshots/${s.id}/diff`).then((r) => setD(r.entries), (e: Error) => setErr(e.message)); }, [s.id]);
  if (file) return <FileDiffView sid={s.id} file={file} close={() => setFile('')} />;
  if (err) return <p className={`${P}__bad`}>{err}</p>;
  if (!d) return <p className="fx-muted fx-small">Comparing with the container now…</p>;
  const files = (label: string, tone: string, xs: string[] | undefined) => !!xs?.length && (
    <div><span className="fx-small fx-muted">{label}</span>
      <ul className={`${P}__files`}>{xs.map((f) => <li key={f}><button type="button" className={`is-${tone}`} onClick={() => setFile(f)}>{f}</button></li>)}</ul>
    </div>
  );
  return (
    <div className="fx-stack">
      {d.map((e) => (
        <div key={e.path} className={`${P}__changes`}>
          <strong className="fx-mono">{e.path}</strong>
          {!e.existed ? <span className="fx-small"> {e.existsNow ? 'didn’t exist then, exists now (restore removes it)' : 'didn’t exist then, still doesn’t'}</span>
            : !e.existsNow ? <span className="fx-small"> gone now (restore brings it back)</span>
              : e.counts && !e.counts.added && !e.counts.removed && !e.counts.changed ? <span className="fx-small fx-muted"> unchanged</span>
                : <>
                  {files(`Changed (${e.counts?.changed})`, 'chg', e.changed)}
                  {files(`Added since (${e.counts?.added}): restore removes these`, 'add', e.added)}
                  {files(`Removed since (${e.counts?.removed}): restore brings these back`, 'del', e.removed)}
                </>}
        </div>
      ))}
    </div>
  );
}

function Detail({ s, onChanged }: { s: Snapshot; onChanged: () => void }) {
  const rt = useRuntime();
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const restore = async () => {
    setBusy('restore'); setMsg('');
    try { const r = await post<{ before: string }>(`snapshots/${s.id}/restore`, { confirm: 'restore' }); setMsg(`✓ Restored. The state before the restore is snapshot ${r.before}, so this can be undone.`); setConfirm(false); rt.toast('Snapshot restored', 'success', 'Snapshots'); onChanged(); }
    catch (e) { setMsg(`✗ ${(e as Error).message}`); } finally { setBusy(''); }
  };
  const remove = async () => {
    setBusy('delete');
    try { await del(`snapshots/${s.id}`); onChanged(); } catch (e) { setMsg(`✗ ${(e as Error).message}`); setBusy(''); }
  };
  return (
    <div className="fx-stack">
      <dl className={`${P}__facts`}>
        <dt>Container</dt><dd className="fx-mono">{s.container}</dd>
        <dt>When</dt><dd>{when(s.createdAt)}</dd>
        <dt>By</dt><dd>{s.actor.name} ({s.actor.kind})</dd>
        <dt>Why</dt><dd>{s.reason || '—'}</dd>
        {s.batch && <><dt>Change batch</dt><dd className="fx-mono">{s.batch}</dd></>}
        {typeof s.meta?.restoreOf === 'string' && <><dt>Taken before restoring</dt><dd className="fx-mono">{s.meta.restoreOf}</dd></>}
        <dt>Paths</dt><dd>{s.entries.map((e) => <div key={e.n} className="fx-mono">{e.path} <span className="fx-muted">{e.existed ? `${e.isDir ? `${e.files} items` : 'file'}${e.skipped ? `, ${e.skipped} skipped (excluded folders)` : ''}` : '(didn’t exist)'}</span></div>)}</dd>
        <dt>Size</dt><dd>{size(s.bytes)}</dd>
        {!!s.restores?.length && <><dt>Restored</dt><dd>{s.restores.map((r) => <div key={r.at}>{when(r.at)} by {r.by.name} (before-restore snapshot <span className="fx-mono">{r.before}</span>)</div>)}</dd></>}
      </dl>
      <div className={`${P}__row`}>
        <Button tone="ghost" icon="eye" onClick={() => setShow(!show)}>{show ? 'Hide changes' : 'What changed since?'}</Button>
        {!confirm && <Button icon="undo" disabled={!!busy} onClick={() => setConfirm(true)}>Restore…</Button>}
        <Button tone="ghost" icon="trash" disabled={!!busy} onClick={() => void remove()}>Delete</Button>
      </div>
      {confirm && (
        <div className={`${P}__note is-warn`}>
          <Icon name="alert" size={16} />
          <span className="fx-grow">Put {s.paths.length === 1 ? s.paths[0] : `${s.paths.length} paths`} in <span className="fx-mono">{s.container}</span> back to how they were {when(s.createdAt)}? Files added since are removed; excluded folders (node_modules…) aren’t touched. The current state is snapshotted first.</span>
          <Button tone="danger" icon="undo" disabled={!!busy} onClick={() => void restore()}>{busy === 'restore' ? 'Restoring…' : 'Restore now'}</Button>
          <Button tone="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      )}
      {msg && <p className="fx-small">{msg}</p>}
      {show && <Changes s={s} />}
    </div>
  );
}

export function SnapshotsPanel() {
  const [items, setItems] = useState<Snapshot[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState('');
  const [container, setContainer] = useState('');
  const [openId, setOpenId] = useState(getFocus());
  const load = () => call<{ items: Snapshot[]; usage: Usage }>('snapshots?limit=500').then((r) => { setItems(r.items); setUsage(r.usage); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); return onFocus(() => setOpenId(getFocus())); }, []);
  const groups = useMemo(() => {
    const g = new Map<string, Map<string, Snapshot[]>>();
    for (const s of items ?? []) {
      if (container && s.container !== container) continue;
      const day = new Date(s.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
      const byDay = g.get(s.container) ?? new Map<string, Snapshot[]>();
      byDay.set(day, [...(byDay.get(day) ?? []), s]);
      g.set(s.container, byDay);
    }
    return g;
  }, [items, container]);
  if (err) return <p className={`${P}__bad`}>{err}</p>;
  if (!items) return <p className="fx-muted">Loading snapshots…</p>;
  const names = [...new Set(items.map((s) => s.container))].sort();
  return (
    <div className="fx-stack">
      <div className={`${P}__row`}>
        <select className={`fx-input ${P}__narrow`} value={container} onChange={(e) => setContainer(e.target.value)} aria-label="Container">
          <option value="">Every container</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="fx-grow fx-small fx-muted">{usage ? `${usage.count} snapshots · ${size(usage.bytes)} of ${size(usage.capBytes)} · kept ${usage.keepDays} days` : ''}</span>
        <Button tone="ghost" icon="refresh" onClick={() => void load()}>Refresh</Button>
      </div>
      {!items.length && <p className="fx-muted fx-small">No snapshots yet. One is taken before every approved change.</p>}
      {[...groups.entries()].map(([c, days]) => (
        <details key={c} className={`${P}__group`} open>
          <summary><Icon name="box" size={14} /> <strong className="fx-mono">{c}</strong> <span className="fx-muted fx-small">{[...days.values()].reduce((a, b) => a + b.length, 0)}</span></summary>
          {[...days.entries()].map(([day, list]) => (
            <div key={day} className="fx-stack">
              <span className="fx-small fx-muted">{day}</span>
              <ul className={`${P}__list`}>
                {list.map((s) => (
                  <li key={s.id} className={openId === s.id ? 'is-open' : undefined}>
                    <button type="button" className={`${P}__item`} aria-expanded={openId === s.id} onClick={() => setOpenId(openId === s.id ? '' : s.id)}>
                      <Icon name={s.meta?.restoreOf ? 'undo' : s.batch ? 'shield' : 'save'} size={14} />
                      <span className="fx-grow">{new Date(s.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' })} · {s.reason || 'snapshot'}</span>
                      <span className="fx-small fx-muted">{s.actor.name}</span>
                      {!!s.restores?.length && <Chip tone="accent">restored</Chip>}
                      <span className="fx-small fx-muted">{size(s.bytes)}</span>
                    </button>
                    {openId === s.id && <Detail s={s} onChanged={() => void load()} />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}

export function TakePanel() {
  const [cs, setCs] = useState<{ name: string }[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [f, setF] = useState({ container: '', paths: '', reason: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => { void call<{ items: { name: string }[]; available: boolean }>('containers').then((r) => { setCs(r.items); setAvailable(r.available); }, (e: Error) => setMsg(e.message)); }, []);
  if (!available) return <p className="fx-muted fx-small">Container access isn’t installed or enabled, so there’s nothing to snapshot.</p>;
  const take = async () => {
    setMsg('Taking…');
    try { const s = await post<Snapshot>('snapshots', { container: f.container, paths: f.paths.split('\n').map((x) => x.trim()).filter(Boolean), reason: f.reason || 'manual snapshot' }); setMsg(`✓ ${s.id} (${size(s.bytes)})`); }
    catch (e) { setMsg(`✗ ${(e as Error).message}`); }
  };
  return (
    <div className="fx-stack">
      <label className={`${P}__field`}><span>Container</span>
        <select className="fx-input" value={f.container} onChange={(e) => setF({ ...f, container: e.target.value })}>
          <option value="">Choose…</option>{(cs ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </label>
      <label className={`${P}__field`}><span>Paths (one per line, absolute)</span><textarea className="fx-input" rows={3} value={f.paths} onChange={(e) => setF({ ...f, paths: e.target.value })} placeholder="/app/src\n/app/package.json" /></label>
      <label className={`${P}__field`}><span>Why</span><input className="fx-input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="before I try something" /></label>
      <div className={`${P}__row`}><Button tone="primary" icon="save" disabled={!f.container || !f.paths.trim()} onClick={() => void take()}>Take snapshot</Button><span className="fx-small">{msg}</span></div>
    </div>
  );
}

export function RetentionPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [ex, setEx] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => call<{ settings: Settings; usage: Usage }>('status').then((r) => { setS(r.settings); setUsage(r.usage); setEx(r.settings.exclude.join('\n')); }, (e: Error) => setMsg(e.message));
  useEffect(() => { void load(); }, []);
  if (!s) return <p className="fx-muted">{msg || 'Loading…'}</p>;
  const save = async () => {
    setMsg('Saving…');
    try { await put('settings', { ...s, exclude: ex.split(/\n|,/).map((x) => x.trim()).filter(Boolean) }); setMsg('✓ Saved (old snapshots pruned to fit)'); void load(); }
    catch (e) { setMsg(`✗ ${(e as Error).message}`); }
  };
  const prune = async () => { const r = await post<{ removed: string[] }>('prune'); setMsg(`Pruned ${r.removed.length}`); void load(); };
  const pct = usage ? Math.min(100, Math.round((usage.bytes / Math.max(1, usage.capBytes)) * 100)) : 0;
  return (
    <div className="fx-stack">
      {usage && (
        <div className="fx-stack">
          <div className={`${P}__meter`} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Snapshot storage used"><span style={{ width: `${pct}%` }} /></div>
          <span className="fx-small fx-muted">{size(usage.bytes)} of {size(usage.capBytes)} ({usage.count} snapshots){usage.oldest ? ` · oldest ${when(usage.oldest)}` : ''}</span>
        </div>
      )}
      <div className={`${P}__cols`}>
        <label className={`${P}__field`}><span>Keep for (days)</span><input className="fx-input" type="number" min={1} value={s.keepDays} onChange={(e) => setS({ ...s, keepDays: Number(e.target.value) })} /></label>
        <label className={`${P}__field`}><span>Cap all snapshots at (GB)</span><input className="fx-input" type="number" min={0.1} step={0.5} value={s.maxGb} onChange={(e) => setS({ ...s, maxGb: Number(e.target.value) })} /></label>
        <label className={`${P}__field`}><span>Largest single snapshot (MB)</span><input className="fx-input" type="number" min={10} value={s.maxSnapshotMb} onChange={(e) => setS({ ...s, maxSnapshotMb: Number(e.target.value) })} /></label>
      </div>
      <label className={`${P}__field`}><span>Skip folders named (one per line; a restore never touches them)</span><textarea className="fx-input" rows={4} value={ex} onChange={(e) => setEx(e.target.value)} /></label>
      <div className={`${P}__row`}><Button tone="primary" icon="save" onClick={() => void save()}>Save</Button><Button tone="ghost" icon="trash" onClick={() => void prune()}>Prune now</Button><span className="fx-small">{msg}</span></div>
      <p className="fx-small fx-muted">Oldest snapshots go first when the cap is reached. Checked after every snapshot and every hour.</p>
    </div>
  );
}

interface Change { at: number; op: string; actor?: { name: string }; container?: { name: string }; path?: string; command?: string; ok?: boolean; error?: string; snapshot?: string; batch?: string }

export function ChangeLogPanel() {
  const [items, setItems] = useState<Change[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [err, setErr] = useState('');
  const load = () => call<{ items: Change[]; available: boolean }>('changes?limit=300').then((r) => { setItems(r.items); setAvailable(r.available); }, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  if (err) return <p className={`${P}__bad`}>{err}</p>;
  if (!available) return <p className="fx-muted fx-small">Container access isn’t installed, so there’s no change log.</p>;
  return (
    <div className="fx-stack">
      <div className={`${P}__row`}><span className="fx-grow fx-small fx-muted">Every write, delete, command, restart, redeploy and restore: who, what, when, and its snapshot.</span><Button tone="ghost" icon="refresh" onClick={() => void load()}>Refresh</Button></div>
      <ul className={`${P}__log`}>
        {(items ?? []).map((c, i) => (
          <li key={`${c.at}-${i}`} className={c.ok === false ? 'is-bad' : undefined}>
            <span className="fx-small fx-muted">{when(c.at)}</span> <strong>{c.op}</strong> {c.container && <span className="fx-mono">{c.container.name}</span>} {c.path && <span className="fx-mono">{c.path}</span>}
            {c.command && <code className="fx-mono"> {c.command.slice(0, 100)}</code>} <span className="fx-small fx-muted">by {c.actor?.name ?? '?'}</span>
            {c.snapshot && c.snapshot !== 'no-paths' && <span className="fx-small fx-mono"> · {c.snapshot}</span>}
            {c.error && <span className={`${P}__bad fx-small`}> {c.error}</span>}
          </li>
        ))}
        {items && !items.length && <li className="fx-muted fx-small">No changes logged yet.</li>}
      </ul>
    </div>
  );
}
