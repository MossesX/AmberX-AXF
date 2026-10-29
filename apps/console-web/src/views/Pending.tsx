import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, Slot, useRuntime } from '../axf/react';
import * as api from '../api';
import * as core from '../axf/plan/pending-core.mjs';
import pricing from '../axf/schemas/model-pricing.json';
import { RowHookButtons, registerRowRefTarget } from '../axf/libs/datagrid';
import type { PendingAction, PendingItem, PendingModel, PendingSort, PendingState, PendingStatus } from '../axf/plan/pending-core.mjs';

/** Estimated dollars for `minutes` on a model (the pricing file's price per working minute), '' without a price. */
const usdFor = (model: string, minutes: number | null | undefined) => (minutes ? core.formatUsd(core.costForMinutes(model, minutes, pricing)) : '');

/*
 * Pending builds: work parked until its model (usually Fable) is available. The list lives in
 * framework/plan/pending.json (pending@1) and mirrors the claude.ai "AXF Pending Builds" page field for field.
 * Every row shows its date: when it was added, or when it was built once complete. Sort by status or either date.
 * All list logic is framework/plan/pending-core.mjs, shared with the API, the CLI and the MCP tools.
 */

const LOCAL_KEY = 'pending';
const fmtDate = (v: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const SORT_LABEL: Record<PendingSort, string> = { status: 'Status', added: 'Date added', built: 'Date built' };
type Mode = 'note' | 'sub' | 'confirm' | 'edit' | null;

export function Pending() {
  const rt = useRuntime();
  const log = (t: string, l: 'info' | 'ok' | 'warn' | 'error' = 'info') => rt.terminal.log('pending', t, l);
  const [state, setState] = useState<PendingState | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<PendingSort>(() => api.readLocal<PendingSort>('pending-sort', 'status'));
  const [dir, setDir] = useState<'asc' | 'desc'>(() => api.readLocal<'asc' | 'desc'>('pending-dir', 'asc'));
  const [filter, setFilter] = useState<PendingStatus | ''>('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const local = api.isBackendUp() ? null : api.readLocal<PendingState | null>(LOCAL_KEY, null);
      setState(core.normalizeState(local ?? (await api.loadPending())));
      setError('');
    } catch (e) { setError((e as Error).message); setState(core.emptyPending()); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { api.writeLocal('pending-sort', sort); api.writeLocal('pending-dir', dir); }, [sort, dir]);

  /** Through the API (repo file) when it answers; otherwise this browser's copy. */
  const act = async (change: PendingAction): Promise<boolean> => {
    setBusy(true);
    try {
      if (api.isBackendUp()) {
        const r = await api.pendingPost(change);
        if (!r.ok) { log(r.error ?? 'failed', 'error'); rt.toast(r.error ?? 'Change failed', 'danger'); return false; }
        for (const l of r.log ?? []) log(l);
        if (r.state) setState(core.normalizeState(r.state));
        return true;
      }
      const r = core.apply(state ?? core.emptyPending(), change);
      api.writeLocal(LOCAL_KEY, r.state); setState(r.state);
      for (const l of r.log) log(`${l} (this browser only: API offline)`, 'warn');
      return true;
    } catch (e) { log((e as Error).message, 'error'); rt.toast((e as Error).message, 'danger'); return false; }
    finally { setBusy(false); }
  };

  const items = useMemo(() => {
    const all = state?.items ?? [];
    return core.sortItems(filter ? all.filter((i) => i.status === filter) : all, sort, dir);
  }, [state, sort, dir, filter]);
  if (!state) return <div className="fx-empty">Loading pending builds…</div>;
  const counts = core.counts(state.items);
  const pickSort = (k: PendingSort) => { if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(k); setDir(k === 'status' ? 'asc' : 'desc'); } };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Pending builds · {state.items.length} items{state.updatedAt ? ` · updated ${fmtTime(state.updatedAt)}` : ''}</p>
          <h1>Pending builds</h1>
          <p className="fx-muted">Builds parked until their model is available. Check this list before starting any build. Each item shows the date it was added, or the date it was built once complete.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" disabled={busy} onClick={() => load().then(() => log('reloaded', 'ok'))}>Reload</Button>
          <Slot name="builds.toolbar" props={{ page: 'pending' }} />
          <a className="fx-btn" href={state.artifact || core.ARTIFACT_URL} target="_blank" rel="noreferrer"><Icon name="external" size={15} />claude.ai list</a>
        </div>
      </header>

      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}

      <div className="pd-strip" role="group" aria-label="Filter by status">
        {core.STATUSES.map((s) => (
          <button key={s} className={`pd-count is-${s}`} aria-pressed={filter === s} onClick={() => setFilter((f) => (f === s ? '' : s))}>
            <b>{counts[s]}</b><span>{core.STATUS_LABEL[s]}</span>
          </button>
        ))}
      </div>

      <div className="pd-sortbar" role="group" aria-label="Sort">
        <span className="fx-small fx-muted">Sort by</span>
        {core.SORTS.map((k) => (
          <button key={k} className="pd-sort" aria-pressed={sort === k} onClick={() => pickSort(k)} title={sort === k ? 'Click again to reverse' : undefined}>
            {SORT_LABEL[k]}{sort === k && <Icon name={dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={13} />}
          </button>
        ))}
        {filter && <button className="pd-sort" onClick={() => setFilter('')}><Icon name="x" size={13} />{core.STATUS_LABEL[filter]} only</button>}
      </div>

      <div className="pd-list" role="list">
        {items.length === 0
          ? <div className="fx-empty">{filter ? `No ${core.STATUS_LABEL[filter].toLowerCase()} builds.` : 'Nothing parked. Add a build below.'}</div>
          : items.map((it) => <PendingRow key={it.id} it={it} busy={busy} act={act} />)}
      </div>

      <AddForm busy={busy} onAdd={(c) => act({ action: 'add', ...c })} />
    </div>
  );
}

// grid-hook@1: plugins' row hooks for pending items (button + right-click on the card)
registerRowRefTarget('axf-pending-item', (id) => (id ? { kind: 'pending', id } : null));

function PendingRow({ it, busy, act }: { it: PendingItem; busy: boolean; act: (c: PendingAction) => Promise<boolean> }) {
  const rt = useRuntime();
  const [mode, setMode] = useState<Mode>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [text, setText] = useState('');
  const [title, setTitle] = useState(it.title);
  const [detail, setDetail] = useState(it.detail);
  const [model, setModel] = useState<PendingModel>(it.model);
  const [estimate, setEstimate] = useState(it.estimate ?? '');
  const date = core.shownDate(it);
  const progress = core.stepsProgress(it);
  const split = core.splitCheck(it);
  const open = (m: Mode) => { setMode(m); setText(''); setTitle(it.title); setDetail(it.detail); setModel(it.model); setEstimate(it.estimate ?? ''); };
  const save = async () => {
    if (mode === 'note' || mode === 'sub') { if (text.trim() && (await act({ action: mode, id: it.id, text }))) setMode(null); }
    else if (mode === 'edit') { if (await act({ action: 'update', id: it.id, title, detail, model, estimate })) setMode(null); }
  };
  const copy = () => {
    const brief = [`Pending build: ${it.title} (${it.id}) — waits on ${it.model}`, it.planId && `Plan epic: ${it.planId}`, it.detail && `\n${it.detail}`,
      it.subPrompts.length ? `\nSteps (${progress.done}/${progress.total} done; rule: steps of 30 min or less, tick each off with pending_change(action="step", id="${it.id}", index=N, done=true)):\n${it.subPrompts.map((s, i) => `${s.done ? '[x]' : '[ ]'} ${i + 1}. ${s.estimate ? `(~${s.estimate}) ` : ''}${s.text}`).join('\n')}` : '',
      `\nWhen done, mark it complete in the console's Pending view or with the AXF MCP tool pending_change(action="status", id="${it.id}", status="complete").`].filter(Boolean).join('\n');
    navigator.clipboard?.writeText(brief).then(() => rt.toast(`Brief for "${it.title}" copied`, 'success'), () => rt.toast('Clipboard blocked', 'warning'));
  };
  return (
    <article className={`pd-card is-${it.status}`} role="listitem" data-fx-ctx-target="axf-pending-item" data-fx-ctx-payload={it.id}>
      <div className="pd-card__top">
        <h2 className="pd-card__title">{it.title}<span className="fx-muted fx-small fx-mono"> {it.id}</span></h2>
        <button className={`pd-badge is-${it.status}`} aria-expanded={statusOpen} aria-label={`Status: ${core.STATUS_LABEL[it.status]}. Change`} onClick={() => setStatusOpen((o) => !o)}>{core.STATUS_LABEL[it.status]}</button>
      </div>
      <Slot name="pending.item" props={{ item: it }} />
      {statusOpen && (
        <div className="fx-row fx-row--wrap">
          {core.STATUSES.map((s) => <button key={s} className={`pd-badge is-${s}`} disabled={busy || s === it.status} onClick={async () => { if (await act({ action: 'status', id: it.id, status: s })) setStatusOpen(false); }}>{core.STATUS_LABEL[s]}</button>)}
        </div>
      )}
      <div className="pd-meta">
        <span className={`pd-date ${date.label === 'Built' ? 'is-built' : ''}`} title={`Added ${fmtTime(it.createdAt)}${it.builtAt ? ` · built ${fmtTime(it.builtAt)}` : ''}`}><Icon name={date.label === 'Built' ? 'check-circle' : 'clock'} size={13} />{date.label} {fmtDate(date.at)}</span>
        {date.label === 'Built' && <span>Added {fmtDate(it.createdAt)}</span>}
        <span>Waits on {it.model}</span>
        {core.itemEstimate(it) && <span className="pd-est" title={`${progress.total && it.subPrompts.every((sp) => core.estimateMinutes(sp.estimate) != null) ? 'Build time: the steps added up' : 'Build time (estimate)'}${usdFor(it.model, core.entryMinutes(it)) ? ` · about ${usdFor(it.model, core.entryMinutes(it))} on ${it.model}` : ''}`}><Icon name="zap" size={13} />~{core.itemEstimate(it)}{usdFor(it.model, core.entryMinutes(it)) ? ` · ~${usdFor(it.model, core.entryMinutes(it))}` : ''}</span>}
        {progress.total > 0 && it.status !== 'complete' && <span className="pd-est" title={`${progress.done} of ${progress.total} steps done · ${core.formatMinutes(progress.minutesLeft) || '0 min'} left`}><Icon name="check-circle" size={13} />{progress.done}/{progress.total} steps{progress.minutesLeft ? ` · ${core.formatMinutes(progress.minutesLeft)} left${progress.done && usdFor(it.model, progress.minutesLeft) ? ` (~${usdFor(it.model, progress.minutesLeft)})` : ''}` : ''}</span>}
        {split.needsSplit && it.status !== 'complete' && <span className="pd-split" title={`Small steps for big builds: ${split.reasons.join('; ')}`}><Icon name="alert" size={13} />needs splitting</span>}
        {it.planId && <span className="fx-mono">{it.planId}</span>}
      </div>
      {mode === 'edit' ? (
        <div className="fx-stack">
          <label className="pd-field">Title<input className="fx-input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="pd-field">Details<textarea className="fx-input" rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
          <label className="pd-field">Waiting on model<select className="fx-input" value={model} onChange={(e) => setModel(e.target.value as PendingModel)}>{core.MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="pd-field">Build time (e.g. 45 min, 2 h, 1.5 d; blank = the steps added up)<input className="fx-input" value={estimate} onChange={(e) => setEstimate(e.target.value)} /></label>
        </div>
      ) : it.detail && <p className="pd-detail">{it.detail}</p>}
      {it.subPrompts.length > 0 && <Thread label={progress.total > 1 ? 'Steps' : 'Sub prompts'} list={it.subPrompts} model={it.model} mono onTick={it.status === 'complete' ? undefined : (i, done) => void act({ action: 'step', id: it.id, index: i, done })} busy={busy} />}
      {it.notes.length > 0 && <Thread label="Notes" list={it.notes} />}
      {(mode === 'note' || mode === 'sub') && (
        <textarea className="fx-input" rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'note' ? 'Add a note' : 'Add a sub prompt: extra instructions for when this build runs'} />
      )}
      {mode === 'confirm' ? (
        <div className="fx-row fx-row--wrap pd-confirm">Remove this build from the list?
          <Button tone="danger" icon="trash" disabled={busy} onClick={() => act({ action: 'remove', id: it.id })}>Remove</Button>
          <Button onClick={() => setMode(null)}>Keep</Button>
        </div>
      ) : mode ? (
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="save" disabled={busy} onClick={save}>{mode === 'note' ? 'Save note' : mode === 'sub' ? 'Save sub prompt' : 'Save'}</Button>
          <Button onClick={() => setMode(null)}>Cancel</Button>
        </div>
      ) : (
        <div className="fx-row fx-row--wrap">
          <Button icon="edit" onClick={() => open('note')}>Add note</Button>
          <Button icon="terminal" onClick={() => open('sub')}>Sub prompt</Button>
          <Button icon="file" onClick={() => open('edit')}>Edit</Button>
          <Button icon="copy" onClick={copy}>Copy brief</Button>
          <RowHookButtons rowRef={{ kind: 'pending', id: it.id }} />
          <Button icon="trash" onClick={() => setMode('confirm')}>Remove</Button>
        </div>
      )}
    </article>
  );
}

function Thread({ label, list, model, mono, onTick, busy }: { label: string; list: { text: string; at: string; estimate?: string; done?: boolean; doneAt?: string }[]; model?: string; mono?: boolean; onTick?: (index: number, done: boolean) => void; busy?: boolean }) {
  return (
    <div className="pd-thread">
      <h3>{label}</h3>
      {list.map((e, i) => (
        <div key={i} className={`pd-entry ${mono ? 'is-mono' : ''} ${e.done ? 'is-done' : ''}`}>
          {onTick && <input type="checkbox" className="pd-tick" checked={!!e.done} disabled={busy} onChange={(ev) => onTick(i, ev.target.checked)} aria-label={`Step ${i + 1} done`} title={e.done && e.doneAt ? `Done ${fmtTime(e.doneAt)}` : 'Mark this step done'} />}
          <time dateTime={e.at}>{onTick ? `${i + 1}.` : fmtDate(e.at)}{e.estimate && <span className="pd-est"> · ~{e.estimate}{model && usdFor(model, core.estimateMinutes(e.estimate)) ? ` · ~${usdFor(model, core.estimateMinutes(e.estimate))}` : ''}</span>}</time>
          <p>{e.text}</p>
        </div>
      ))}
    </div>
  );
}

function AddForm({ busy, onAdd }: { busy: boolean; onAdd: (c: { title: string; detail: string; model: PendingModel; status: PendingStatus; estimate?: string }) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [estimate, setEstimate] = useState('');
  const [detail, setDetail] = useState('');
  const [model, setModel] = useState<PendingModel>('Fable');
  const [status, setStatus] = useState<PendingStatus>('pending');
  return (
    <details className="pd-add">
      <summary>Add a build</summary>
      <form className="fx-stack" onSubmit={async (e) => { e.preventDefault(); if (title.trim() && (await onAdd({ title, detail, model, status, estimate }))) { setTitle(''); setDetail(''); setEstimate(''); } }}>
        <label className="pd-field">Title<input className="fx-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What to build" /></label>
        <label className="pd-field">Details<textarea className="fx-input" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Scope, files touched, acceptance notes" /></label>
        <div className="pd-two">
          <label className="pd-field">Waiting on model<select className="fx-input" value={model} onChange={(e) => setModel(e.target.value as PendingModel)}>{core.MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="pd-field">Build time (e.g. 45 min, 2 h, 1.5 d; blank = the steps added up)<input className="fx-input" value={estimate} onChange={(e) => setEstimate(e.target.value)} /></label>
          <label className="pd-field">Status<select className="fx-input" value={status} onChange={(e) => setStatus(e.target.value as PendingStatus)}>{core.STATUSES.map((s) => <option key={s} value={s}>{core.STATUS_LABEL[s]}</option>)}</select></label>
        </div>
        <div><Button tone="primary" icon="plus" disabled={busy || !title.trim()} type="submit">Add to list</Button></div>
      </form>
    </details>
  );
}
