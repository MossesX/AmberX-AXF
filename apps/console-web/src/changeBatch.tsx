/**
 * Shared approval card for a change batch (change-batch@1, provided by a plugin that offers axf.containers@1).
 * Generic: it never names a plugin. The caller passes how to approve / reject / undo (its own routes), so the
 * assistant's chat, the container settings tab and the feature planner all show the same card.
 *
 *   <ChangeBatchCard batch={b} actions={{ approve: (ids, onEvent) => …, reject: () => …, undo: () => … }} />
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Icon } from './axf/react';
import './changeBatch.css';

export interface BatchItem {
  id: string; kind: 'write' | 'delete' | 'exec' | 'restart' | 'redeploy'; status: string; container: string; reason?: string;
  path?: string; created?: boolean; bytes?: number; diff?: { added: number; removed: number; text: string; truncated?: boolean; binary?: boolean; tooLarge?: boolean }; unseen?: boolean;
  recursive?: boolean; exists?: boolean; isDir?: boolean; command?: string; workdir?: string; paths?: string[];
  exitCode?: number | null; output?: string; error?: string; snapshot?: string;
}
export interface Batch {
  id: string; status: string; title?: string; createdAt: number; actor: { kind: string; id: string; name: string };
  items: BatchItem[]; snapshots: string[]; error?: string; conversation?: string;
}
export interface BatchEvent { type: string; item?: string; text?: string; stream?: string; ok?: boolean; error?: string; container?: string; id?: string; paths?: string[]; batch?: Batch; status?: string; bytes?: number }
export interface BatchActions {
  /** `acceptUnseen`: the approver accepted changes the card can't fully show (the server refuses them otherwise). */
  approve: (items: string[], onEvent: (e: BatchEvent) => void, opts: { acceptUnseen: boolean }) => Promise<Batch | null>;
  reject: () => Promise<Batch>;
  undo?: () => Promise<Batch>;
  /** Optional: open a snapshot (e.g. in the snapshot manager). */
  openSnapshot?: (id: string) => void;
}

/** Read a text/event-stream response (data: JSON lines) and hand each event over. */
export async function readEventStream(r: Response, onEvent: (e: BatchEvent) => void): Promise<void> {
  if (!r.ok || !r.body) {
    const j = (await r.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(typeof j.detail === 'string' ? j.detail : `request failed (${r.status})`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) if (line.startsWith('data: ')) { try { onEvent(JSON.parse(line.slice(6)) as BatchEvent); } catch { /* skip */ } }
    }
  }
}

const KIND: Record<string, { icon: string; label: string }> = {
  write: { icon: 'edit', label: 'Write' }, delete: { icon: 'trash', label: 'Delete' }, exec: { icon: 'terminal', label: 'Run' },
  restart: { icon: 'refresh', label: 'Restart' }, redeploy: { icon: 'rocket', label: 'Redeploy' },
};
const TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  pending: 'warning', applying: 'accent', applied: 'success', partial: 'warning', failed: 'danger', rejected: undefined, undone: undefined,
  skipped: undefined, invalid: 'danger',
};

function Diff({ d }: { d: NonNullable<BatchItem['diff']> }) {
  if (d.binary) return <p className="fx-small fx-muted">Binary file: no text diff. Approving replaces it with the proposed text.</p>;
  if (d.tooLarge) return <p className="fx-small fx-muted">Very large file: no diff shown. Approving replaces all of it.</p>;
  return (
    <pre className="cl-batch__diff">
      {d.text.split('\n').map((l, i) => (
        <span key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'is-add' : l.startsWith('-') && !l.startsWith('---') ? 'is-del' : l.startsWith('@@') ? 'is-hunk' : undefined}>{l}{'\n'}</span>
      ))}
      {d.truncated && <span className="is-hunk">… diff cut short</span>}
    </pre>
  );
}

export function ChangeBatchCard({ batch: initial, actions, onChange }: { batch: Batch; actions: BatchActions; onChange?: (b: Batch) => void }) {
  const [b, setB] = useState(initial);
  useEffect(() => setB(initial), [initial]);
  const valid = useMemo(() => b.items.filter((i) => i.status === 'pending'), [b]);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(valid.map((i) => i.id)));
  const [open, setOpen] = useState<Set<string>>(() => new Set(b.items.length <= 2 ? b.items.map((i) => i.id) : []));
  const [live, setLive] = useState<Record<string, { status?: string; out: string; error?: string }>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [acceptUnseen, setAcceptUnseen] = useState(false);
  const unseenTicked = valid.some((i) => i.unseen && ticked.has(i.id));
  const update = (nb: Batch) => { setB(nb); onChange?.(nb); };

  const approve = async () => {
    setBusy('approve'); setErr(''); setLog([]);
    try {
      const nb = await actions.approve([...ticked], (e) => {
        if (e.type === 'snapshot-start') setLog((l) => [...l, `Snapshot of ${e.container}: ${(e.paths ?? []).join(', ') || 'nothing to cover'}…`]);
        else if (e.type === 'snapshot') setLog((l) => [...l, `✓ snapshot ${e.id} (${Math.round((e.bytes ?? 0) / 1024)} KB)`]);
        else if (e.type === 'item-start' && e.item) setLive((s) => ({ ...s, [e.item!]: { status: 'applying', out: '' } }));
        else if (e.type === 'output' && e.item) setLive((s) => ({ ...s, [e.item!]: { ...s[e.item!], out: ((s[e.item!]?.out ?? '') + (e.text ?? '')).slice(-20000) } }));
        else if (e.type === 'item-done' && e.item) setLive((s) => ({ ...s, [e.item!]: { ...s[e.item!], out: s[e.item!]?.out ?? '', status: e.ok ? 'applied' : 'failed', error: e.error } }));
        else if (e.type === 'error') setErr(e.error ?? 'failed');
        else if (e.type === 'batch' && e.batch) update(e.batch);
      }, { acceptUnseen });
      if (nb) update(nb);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); }
  };
  const simple = async (kind: 'reject' | 'undo') => {
    const fn = actions[kind];
    if (!fn) return;
    setBusy(kind); setErr('');
    try { update(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const pending = b.status === 'pending';
  const canUndo = !!actions.undo && ['applied', 'partial', 'failed'].includes(b.status) && b.snapshots.length > 0;

  return (
    <div className={`cl-batch is-${b.status}`}>
      <div className="cl-batch__head">
        <Icon name="shield" size={15} />
        <strong className="fx-grow">{b.title || `${b.items.length} change${b.items.length === 1 ? '' : 's'} from ${b.actor.name}`}</strong>
        <Chip tone={TONE[b.status]}>{b.status}</Chip>
      </div>
      {pending && <p className="fx-small fx-muted">Nothing has changed yet. Approving takes a snapshot of every path below first, then runs the ticked items in order (it stops at the first failure).</p>}
      <ul className="cl-batch__items">
        {b.items.map((it) => {
          const lv = live[it.id];
          const st = lv?.status ?? it.status;
          const k = KIND[it.kind] ?? { icon: 'box', label: it.kind };
          const isOpen = open.has(it.id);
          return (
            <li key={it.id} className={`cl-batch__item is-${st}`}>
              <div className="cl-batch__row">
                {pending && it.status === 'pending'
                  ? <input type="checkbox" aria-label={`Include ${k.label} ${it.path ?? it.command ?? ''}`} checked={ticked.has(it.id)} onChange={() => setTicked((s) => toggle(s, it.id))} />
                  : <Icon name={st === 'applied' ? 'check-circle' : st === 'failed' || st === 'invalid' ? 'x-circle' : 'minus'} size={14} />}
                <button type="button" className="cl-batch__toggle" aria-expanded={isOpen} onClick={() => setOpen((s) => toggle(s, it.id))}>
                  <Icon name={k.icon} size={14} />
                  <span className="cl-batch__what">
                    <strong>{k.label}</strong> <span className="fx-mono">{it.container}</span>
                    {it.path && <> · <span className="fx-mono">{it.path}</span></>}
                    {it.kind === 'write' && it.diff && <span className="fx-muted"> {it.created ? '(new file)' : ''} +{it.diff.added} −{it.diff.removed}</span>}
                    {it.unseen && <Chip tone="warning">not fully shown</Chip>}
                    {it.kind === 'delete' && <span className="fx-muted"> {it.exists === false ? '(already gone)' : it.isDir ? '(folder, everything in it)' : ''}</span>}
                    {it.kind === 'exec' && <> · <code className="fx-mono">{(it.command ?? '').slice(0, 80)}{(it.command ?? '').length > 80 ? '…' : ''}</code></>}
                  </span>
                  <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                </button>
                {st !== 'pending' && <Chip tone={TONE[st]}>{st}</Chip>}
              </div>
              {isOpen && (
                <div className="cl-batch__body">
                  {it.reason && <p className="fx-small">{it.reason}</p>}
                  {it.kind === 'write' && it.diff && <Diff d={it.diff} />}
                  {it.kind === 'exec' && (
                    <>
                      <pre className="cl-batch__cmd">{it.workdir ? `cd ${it.workdir} && ` : ''}{it.command}</pre>
                      <p className="fx-small fx-muted">Snapshot covers: {it.paths?.length ? it.paths.join(', ') : 'nothing (no paths declared)'}</p>
                    </>
                  )}
                  {(lv?.out || it.output) && <pre className="cl-batch__out">{lv?.out || it.output}</pre>}
                  {it.exitCode != null && <p className="fx-small fx-muted">Exit code {it.exitCode}</p>}
                </div>
              )}
              {(lv?.error || it.error) && <p className="cl-batch__err">{lv?.error || it.error}</p>}
            </li>
          );
        })}
      </ul>
      {log.length > 0 && <pre className="cl-batch__out">{log.join('\n')}</pre>}
      {b.error && <p className="cl-batch__err">{b.error}</p>}
      {err && <p className="cl-batch__err">{err}</p>}
      {b.snapshots.length > 0 && (
        <p className="fx-small fx-muted">
          Snapshot{b.snapshots.length > 1 ? 's' : ''}:{' '}
          {b.snapshots.map((s) => actions.openSnapshot ? <button key={s} type="button" className="cl-batch__link" onClick={() => actions.openSnapshot!(s)}>{s}</button> : <span key={s} className="fx-mono">{s} </span>)}
        </p>
      )}
      <div className="cl-batch__actions">
        {pending && unseenTicked && (
          <label className="cl-batch__accept">
            <input type="checkbox" checked={acceptUnseen} onChange={(e) => setAcceptUnseen(e.target.checked)} />
            Some ticked changes can't be fully shown here (diff cut short, binary or very large file). Accept what I can't see.
          </label>
        )}
        {pending && (
          <>
            <Button tone="primary" icon="check" disabled={!!busy || ticked.size === 0 || (unseenTicked && !acceptUnseen)} onClick={() => void approve()}>
              {busy === 'approve' ? 'Applying…' : ticked.size === valid.length ? `Approve all (${ticked.size})` : `Approve ${ticked.size} of ${valid.length}`}
            </Button>
            <Button tone="ghost" icon="x" disabled={!!busy} onClick={() => void simple('reject')}>Reject</Button>
            {valid.length > 1 && <Button tone="ghost" disabled={!!busy} onClick={() => setTicked(ticked.size === valid.length ? new Set() : new Set(valid.map((i) => i.id)))}>{ticked.size === valid.length ? 'Untick all' : 'Tick all'}</Button>}
          </>
        )}
        {canUndo && <Button tone="ghost" icon="undo" disabled={!!busy} onClick={() => void simple('undo')}>{busy === 'undo' ? 'Undoing…' : 'Undo (restore snapshot)'}</Button>}
      </div>
    </div>
  );
}
