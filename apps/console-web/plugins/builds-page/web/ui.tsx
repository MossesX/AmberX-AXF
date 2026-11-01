import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Checkbox, Chip, Icon, IconButton, Meter, Segmented, SelectField, Slot, Switch, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup } from '@console/axf/libs/datagrid';
import { pluginApi } from '@console/plugins';
import './builds.css';

/*
 * The Builds page (master cleanup, Oct 31 2026): one page over the one builds store (builds@1). Views:
 *   Builds  one row per build: live progress bar, status, steps, time left; rename in place; drag to reorder.
 *   Steps   every atomic step as its own stored record, for one build or the whole profile. Multi-select, drag to
 *           reorder steps and builds, divide, harvest / split into N, Restore default, rename. All a DRAFT until
 *           Apply (saved on the server, survives a restart); Discard drops it.
 * Framework controls only (Button, IconButton, Segmented, SelectField, Checkbox, Switch, Meter, DataGrid, fx-* classes);
 * every size and colour comes from theme tokens (builds.css lays things out).
 */

export const FOLDER = 'builds-page';
export const VIEW = 'builds';
export const KEYS = { banner: 'builds.banner', select: 'builds.select', view: 'builds.view', profile: 'builds.profile', filter: 'builds.filter', scope: 'builds.scope' } as const;
export const api = pluginApi(FOLDER, 'Builds', { unavailable: 'The Builds page is switched off or its server part is not running.' });

export type Progress = { total: number; done: number; pct: number; active: boolean; status?: string };
export type StepV = { uid: string; id: string; title: string; text: string; model: 'Fable' | 'Opus'; why: string; phase: string; group: string; estimate: string; files: string[]; checks: string[]; done: boolean; doneAt: string; skip: boolean; note: string; rev: number; origin?: { build: string; step: string; how: string }; index: number; build: string; buildTitle: string; kind: string; target: string; next: boolean };
export type BuildV = { id: string; title: string; category: string; detail: string; status: string; kind: string; planRef: string; branch: string; pr: string; profiles: string[]; order: number; rev: number; createdAt: string; updatedAt: string; builtAt: string; hidden: boolean; rearranged: boolean; hasDefault: boolean; notes: { text: string; at: string }[]; pendingStatus: string; progress: Progress; minutesLeft: number; steps: StepV[] };
type ProfileV = { id: string; name: string; base: boolean; builds: number; progress: Progress & { builds: number; complete: number } };
export type Op = Record<string, unknown> & { op: string };
type StateV = { ok: boolean; error?: string; rev: number; profile: string; active: string; profiles: ProfileV[]; progress: Progress & { builds: number; complete: number }; builds: BuildV[]; draft: { ops: Op[]; count: number; updatedAt: string; log: string[] }; log?: string[] };

/* ---------------- one shared store (page, banner) ---------------- */

let st: { state: StateV | null; error: string; busy: boolean } = { state: null, error: '', busy: false };
const subs = new Set<() => void>();
const set = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const useBuilds = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);
let wantProfile = '';
export async function reload(profile = wantProfile) {
  wantProfile = profile;
  try { const r = await api.call<StateV>(`state${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`); if (!r.ok) throw new Error(r.error); set({ state: r, error: '' }); }
  catch (e) { set({ error: (e as Error).message }); }
}
async function send(path: string, body: Record<string, unknown>, toast?: (m: string, k?: 'danger' | 'success' | 'info') => void): Promise<boolean> {
  set({ busy: true });
  try {
    const r = await api.post<StateV>(path, { profile: st.state?.profile, ...body });
    if (!r.ok) { toast?.(r.error ?? 'Change refused', 'danger'); return false; }
    set({ state: r, error: '' });
    return true;
  } catch (e) { toast?.((e as Error).message, 'danger'); return false; }
  finally { set({ busy: false }); }
}

const STATUS_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { running: 'accent', complete: 'success', waiting: 'warning', blocked: 'warning', failed: 'danger' };
const STATUS_LABEL: Record<string, string> = { pending: 'Pending', running: 'Running', waiting: 'Needs approval', blocked: 'Blocked', failed: 'Failed', complete: 'Complete', archived: 'Archived' };
const fmtMin = (m: number) => (!m ? '' : m < 60 ? `${m} min` : `${Math.round(m / 30) / 2} h`);
const stepName = (s: StepV): string => s.title || (s.text.split('\n')[0] ?? '');
const isPhone = () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

/* ---------------- inline rename: double-click / double-tap, or right-click / long-press → Rename ---------------- */

export function InlineName({ value, onSave, label, longPress = 'menu', className }: { value: string; onSave: (v: string) => Promise<boolean> | boolean; label: string; longPress?: 'menu' | 'none'; className?: string }) {
  const rt = useRuntime();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastTap = useRef(0);
  useEffect(() => { if (!editing) setText(value); }, [value, editing]);
  const start = () => { setMenu(null); setText(value); setEditing(true); };
  const save = async () => {
    const v = text.trim();
    if (!v) { rt.toast(`${label} can't be empty`, 'danger'); return; }
    if (v === value) { setEditing(false); return; }
    if (await onSave(v)) setEditing(false);
  };
  const key = (e: RKeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setText(value); } };
  const down = (e: RPointerEvent) => {
    if (longPress === 'none' || e.pointerType === 'mouse') return;
    const { clientX: x, clientY: y } = e; window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMenu({ x, y }), 550);
  };
  const up = () => window.clearTimeout(timer.current);
  const tap = (e: RPointerEvent) => { if (e.pointerType === 'mouse') return; const now = Date.now(); if (now - lastTap.current < 350) start(); lastTap.current = now; };
  if (editing) {
    return <input className="fx-input axp-builds__rename" aria-label={`Rename ${label.toLowerCase()}`} autoFocus value={text} maxLength={300} onChange={(e) => setText(e.target.value)} onKeyDown={key} onBlur={() => { setEditing(false); setText(value); }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />;
  }
  return (
    <>
      <span className={`axp-builds__name ${className ?? ''}`} title={`${value} — double-click to rename`} onDoubleClick={(e) => { e.stopPropagation(); start(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
        onPointerDown={down} onPointerUp={(e) => { up(); tap(e); }} onPointerLeave={up} onPointerCancel={up}>{value}</span>
      {menu && createPortal(
        <div className="fx-backdrop axp-builds__menu-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="fx-menu axp-builds__menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" role="menuitem" className="fx-menu__item" autoFocus onClick={start}><Icon name="edit" size={14} /> Rename</button>
          </div>
        </div>, document.body)}
    </>
  );
}

/* ---------------- dialogs (fx-dialog) ---------------- */

function Dialog({ title, icon, onClose, children, foot }: { title: string; icon: string; onClose: () => void; children: ReactNode; foot: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <div className="fx-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fx-dialog axp-builds__dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="fx-dialog__head"><Icon name={icon} size={18} /><h2>{title}</h2><IconButton icon="x" label="Close" onClick={onClose} /></header>
        <div className="fx-dialog__body axp-builds__dialog-body">{children}<div className="axp-builds__dialog-foot">{foot}</div></div>
      </div>
    </div>, document.body);
}

type Proposed = { title: string; uids: string[]; steps: { uid: string; id: string; title: string; text: string; estimate: string; model: string }[] };

/** Harvest: the selected steps into ONE new build, or have them split into N (rows you can rename, expand and drag). */
function HarvestDialog({ picked, onClose }: { picked: StepV[]; onClose: () => void }) {
  const rt = useRuntime();
  const [mode, setMode] = useState<'one' | 'split'>('one');
  const [n, setN] = useState(2);
  const [rows, setRows] = useState<(Proposed & { name: string; open: boolean })[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const k = mode === 'one' ? 1 : Math.max(2, Math.min(n, picked.length));
  useEffect(() => {
    let live = true;
    void api.post<{ ok: boolean; builds: Proposed[] }>('propose', { profile: st.state?.profile, uids: picked.map((s) => s.uid), n: k }).then((r) => { if (live && r.ok) setRows(r.builds.map((b) => ({ ...b, name: '', open: k > 1 }))); });
    return () => { live = false; };
  }, [k, picked]);
  const move = (from: number, to: number) => { if (to < 0 || to >= rows.length || from === to) return; const x = [...rows]; const [r] = x.splice(from, 1); if (r) x.splice(to, 0, r); setRows(x); };
  const ok = async () => {
    const into = rows.map((r) => ({ title: (r.name.trim() || r.title).trim(), uids: r.uids }));
    if (await send('draft', { op: { op: 'harvest', from: picked.map((s) => ({ build: s.build, uid: s.uid })), into } }, rt.toast)) { rt.toast(`Harvest added to the draft (${into.length} new build${into.length > 1 ? 's' : ''}). Apply to make it real.`, 'info'); onClose(); }
  };
  return (
    <Dialog title="Harvest into a new build" icon="cut" onClose={onClose} foot={<><span className="fx-small fx-muted">{picked.length} step(s) · the source builds are refactored on Apply</span><Button onClick={onClose}>Cancel</Button><Button tone="primary" icon="check" disabled={!rows.length} onClick={() => void ok()}>Add to draft</Button></>}>
      <Segmented label="How" value={mode} onChange={setMode} options={[{ value: 'one', label: 'One build', icon: 'box' }, { value: 'split', label: 'Split into N builds', icon: 'layers', disabled: picked.length < 2 }]} />
      {mode === 'split' && (
        <label className="axp-builds__n"><span>How many builds</span>
          <input className="fx-input" type="number" min={2} max={picked.length} value={n} onChange={(e) => setN(Math.max(2, Math.min(picked.length, Number(e.target.value) || 2)))} />
        </label>
      )}
      <p className="fx-small fx-muted">The grey name is the one picked to match what the steps do; tap the box to type your own, leave it to keep the grey one.{k > 1 ? ' Drag rows (or use the arrows) to set their order.' : ''}</p>
      <div className="axp-builds__proposals">
        {rows.map((r, i) => (
          <div key={r.uids.join(',')} className={`axp-builds__proposal${drag === i ? ' is-dragging' : ''}`} draggable={k > 1}
            onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag != null) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}>
            <div className="axp-builds__proposal-head">
              {k > 1 && <Icon name="move" size={14} />}
              <input className="fx-input" aria-label={`Name of new build ${i + 1}`} placeholder={r.title} value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <span className="fx-small fx-muted">{r.steps.length} step(s)</span>
              {k > 1 && <><IconButton icon="chevron-up" label="Earlier" disabled={i === 0} onClick={() => move(i, i - 1)} /><IconButton icon="chevron-down" label="Later" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} /></>}
              <IconButton icon={r.open ? 'chevron-up' : 'chevron-down'} label={r.open ? 'Hide steps' : 'Show steps'} onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, open: !x.open } : x)))} />
            </div>
            {r.open && <ol className="axp-builds__proposal-steps">{r.steps.map((s) => <li key={s.uid}><span>{s.title || s.text}</span>{s.estimate && <span className="fx-small fx-muted"> · ~{s.estimate}</span>}</li>)}</ol>}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Divide one step further: the server proposes parts (or says why it can't); edit one part per line. */
function DivideDialog({ step, onClose }: { step: StepV; onClose: () => void }) {
  const rt = useRuntime();
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  useEffect(() => { void api.post<{ ok: boolean; can: boolean; why: string; parts: string[] }>('divide', { profile: st.state?.profile, build: step.build, uid: step.uid }).then((r) => { if (r.ok) { setText(r.parts.join('\n')); setWhy(r.can ? '' : r.why); } }); }, [step]);
  const parts = text.split('\n').map((x) => x.trim()).filter(Boolean);
  const ok = async () => { if (await send('draft', { op: { op: 'divide-step', build: step.build, uid: step.uid, parts: parts.map((t) => ({ text: t })) } }, rt.toast)) onClose(); };
  return (
    <Dialog title="Divide this step" icon="layout" onClose={onClose} foot={<><span className="fx-small fx-muted">{parts.length} part(s)</span><Button onClick={onClose}>Cancel</Button><Button tone="primary" icon="check" disabled={parts.length < 2} onClick={() => void ok()}>Add to draft</Button></>}>
      <p className="fx-small"><strong>{step.id}</strong> {stepName(step)}</p>
      {why && <p className="fx-small fx-muted" role="status"><Icon name="info" size={12} /> {why} You can still split it by hand below.</p>}
      <label className="axp-builds__n axp-builds__n--wide"><span>One part per line</span>
        <textarea className="fx-input" rows={8} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </label>
    </Dialog>
  );
}

function ConfirmDialog({ title, text, yes, onYes, onClose }: { title: string; text: string; yes: string; onYes: () => void; onClose: () => void }) {
  return <Dialog title={title} icon="alert" onClose={onClose} foot={<><Button onClick={onClose}>Cancel</Button><Button tone="danger" icon="refresh" onClick={() => { onYes(); onClose(); }}>{yes}</Button></>}><p>{text}</p></Dialog>;
}

/* ---------------- the page ---------------- */

type View = 'builds' | 'steps';
type Filter = 'open' | 'all' | 'complete' | 'archived' | 'queue';
const FILTERS: { value: Filter; label: string; title: string }[] = [
  { value: 'open', label: 'Open', title: 'Pending, running, waiting, blocked, failed' },
  { value: 'queue', label: 'Queue', title: 'Plan epics in queue order' },
  { value: 'complete', label: 'Done', title: 'Complete' },
  { value: 'archived', label: 'Archived', title: 'Archived (merged into another build, recovered from history)' },
  { value: 'all', label: 'All', title: 'Every build of the profile' },
];
const keep = (f: Filter) => (b: BuildV) => f === 'all' ? true : f === 'complete' ? b.status === 'complete' : f === 'archived' ? b.status === 'archived' : f === 'queue' ? b.kind === 'epic' || !!b.planRef : !['complete', 'archived'].includes(b.status);

export function BuildsPage() {
  const rt = useRuntime();
  const s = useBuilds();
  const [view, setView] = useState<View>(() => (rt.settings.get(KEYS.view) as View) || 'builds');
  const [filter, setFilter] = useState<Filter>(() => (rt.settings.get(KEYS.filter) as Filter) || 'open');
  useEffect(() => { rt.settings.set(KEYS.view, view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { rt.settings.set(KEYS.filter, filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => rt.actions.register('builds.view', ([v]) => { if (v === 'steps' || v === 'builds') setView(v); }, { label: 'Builds page view', params: true }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // live: poll while the page is visible, and again on focus
  useEffect(() => {
    void reload((rt.settings.get(KEYS.profile) as string) || '');
    const tick = () => { if (document.visibilityState === 'visible') void reload(); };
    const t = window.setInterval(tick, 5000);
    addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const state = s.state;
  if (!state) return <div className="fx-page axp-builds"><p className="fx-muted">{s.error || 'Loading the builds store…'}</p></div>;
  const prof = state.profiles.find((p) => p.id === state.profile);
  const builds = state.builds.filter(keep(filter));
  return (
    <div className="fx-page axp-builds">
      <header className="fx-pagehead axp-builds__head">
        <div>
          <p className="fx-eyebrow">Builds · one store for every profile · rev {state.rev}</p>
          <h1 className="axp-builds__title"><InlineName label="Profile name" value={prof?.name ?? state.profile} onSave={(name) => send('rename-profile', { id: state.profile, name }, rt.toast)} /><span className="fx-small fx-muted fx-mono">{state.profile}</span><span className="axp-builds__pct" data-active={state.progress.active || undefined} aria-label={`Profile ${state.progress.pct}% built`}>{state.progress.pct}%</span></h1>
          <p className="fx-muted axp-builds__sub">{state.progress.complete}/{state.progress.builds} builds complete · {state.progress.done}/{state.progress.total} steps{state.profile !== state.active ? ` · the console's active profile is ${state.active}` : ''}</p>
        </div>
      </header>
      <Meter value={state.progress.pct} active={state.progress.active} done={state.progress.pct === 100} label={`${prof?.name ?? state.profile}: ${state.progress.done} of ${state.progress.total} steps`} />
      <div className="axp-builds__bar">
        <SelectField label="Profile" value={state.profile} options={state.profiles.map((p) => ({ value: p.id, label: `${p.name} — ${p.progress.pct}%` }))} onChange={(v) => { rt.settings.set(KEYS.profile, v); void reload(v); }} className="axp-builds__pick" />
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'builds', label: 'Builds', icon: 'list' }, { value: 'steps', label: 'Steps', icon: 'layers' }]} />
        <Segmented label="Show" size="sm" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, label: `${f.label} ${state.builds.filter(keep(f.value)).length}` }))} />
      </div>
      <DraftBar state={state} />
      {/* other plugins' panels above the list (e.g. agent-slots: the queue of headless runs waiting for a slot) */}
      <Slot name="builds.top" props={{ profile: state.profile }} />
      {s.error && <p className="fx-small" role="alert"><Icon name="alert" size={14} /> {s.error}</p>}
      {view === 'builds' ? <BuildsView state={state} builds={builds} /> : <StepsView state={state} builds={builds} />}
    </div>
  );
}

/** Unsaved changes of the Steps view: count, what they do, Apply / Discard. */
function DraftBar({ state }: { state: StateV }) {
  const rt = useRuntime();
  const [open, setOpen] = useState(false);
  if (!state.draft.count) return null;
  return (
    <div className="axp-builds__draft" role="status">
      <Icon name="edit" size={16} />
      <strong>{state.draft.count} unsaved change{state.draft.count > 1 ? 's' : ''}</strong>
      <span className="fx-small fx-muted">Draft — nothing touches the builds, the orchestrator or any queue until you Apply.</span>
      <IconButton icon={open ? 'chevron-up' : 'chevron-down'} label={open ? 'Hide changes' : 'Show changes'} onClick={() => setOpen(!open)} />
      <span className="axp-builds__grow" />
      <Button icon="x" disabled={st.busy} onClick={() => void send('discard', {}, rt.toast)}>Discard</Button>
      <Button tone="primary" icon="check" disabled={st.busy} onClick={() => void send('apply', {}, rt.toast).then((ok) => ok && rt.toast('Applied: the orchestrator refactored the builds (versioned).', 'success'))}>Apply</Button>
      {open && <ul className="axp-builds__draft-log fx-small">{state.draft.log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}

function StatusChip({ b }: { b: BuildV }) { return <Chip tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status] ?? b.status}</Chip>; }
function Bar({ p, label }: { p: Progress; label: string }) {
  return <span className="axp-builds__bar-cell"><Meter small value={p.pct} active={p.active} done={p.pct === 100} label={label} /><span className="fx-small axp-builds__num" data-active={p.active || undefined}>{p.pct}%</span></span>;
}

function BuildsView({ state, builds }: { state: StateV; builds: BuildV[] }) {
  const rt = useRuntime();
  const [expanded, setExpanded] = useState<string[]>([]);
  const rename = (b: BuildV) => (title: string) => send('ops', { ops: [{ op: 'rename-build', id: b.id, title }] }, rt.toast);
  const columns: GridColumn<BuildV>[] = [
    { id: 'title', label: 'Build', width: 'minmax(calc(var(--fx-space) * 30), 4fr)', fixed: true, sortable: true, sortValue: (b) => b.title.toLowerCase(),
      render: (b) => <span className="axp-builds__cell-title"><InlineName label="Build name" value={b.title} onSave={rename(b)} /><span className="fx-small fx-muted fx-mono">{b.id}{b.profiles.length > 1 ? ` · also in ${b.profiles.filter((p) => p !== state.profile).join(', ')}` : ''}</span></span> },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-space) * 14)', sortable: true, sortValue: (b) => b.status, render: (b) => <StatusChip b={b} /> },
    { id: 'progress', label: 'Progress', width: 'calc(var(--fx-space) * 22)', sortable: true, sortValue: (b) => b.progress.pct, render: (b) => <Bar p={b.progress} label={`${b.title}: ${b.progress.done} of ${b.progress.total} steps`} /> },
    { id: 'steps', label: 'Steps', width: 'calc(var(--fx-space) * 9)', align: 'end', sortable: true, sortValue: (b) => b.progress.total, render: (b) => <span className="fx-small">{b.progress.done}/{b.progress.total}</span> },
    { id: 'left', label: 'Left', width: 'calc(var(--fx-space) * 10)', align: 'end', sortable: true, sortValue: (b) => b.minutesLeft, render: (b) => <span className="fx-small">{fmtMin(b.minutesLeft)}</span> },
  ];
  const groups: GridGroup<BuildV>[] = [{ id: 'all', title: `${builds.length} build(s)`, rows: builds, groups: [], fixed: true, progress: state.progress.pct }];
  return (
    <DataGrid<BuildV> id="builds.builds" label="Builds" groups={groups} columns={columns} rowId={(b) => b.id} rowLabel={(b) => b.title} hidden={[]}
      expanded={expanded} onToggleExpand={(id) => setExpanded(expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id])}
      rowTone={(b) => (b.status === 'complete' ? 'success' : b.status === 'running' ? 'accent' : b.status === 'failed' ? 'danger' : ['blocked', 'waiting'].includes(b.status) ? 'warning' : 'muted')}
      rowRef={(b) => ({ kind: 'build', id: b.id })}
      onMove={(item, target, pos) => {
        if (item.kind !== 'row' || target.kind !== 'row' || item.id === target.id) return;
        const ids = state.builds.map((b) => b.id).filter((id) => id !== item.id);
        const at = ids.indexOf(target.id) + (pos === 'after' ? 1 : 0);
        ids.splice(at, 0, item.id);
        void send('ops', { ops: [{ op: 'reorder-builds', ids }] }, rt.toast);
      }}
      renderDetail={(b) => <BuildDetail b={b} />}
      empty={<p className="fx-muted">No builds here.</p>} />
  );
}

function BuildDetail({ b }: { b: BuildV }) {
  return (
    <div className="axp-builds__detail">
      {b.detail && <p className="axp-builds__text">{b.detail}</p>}
      <p className="fx-small fx-muted">{b.kind === 'epic' ? `Plan epic ${b.planRef} · ` : ''}{b.branch ? `branch ${b.branch} · ` : ''}{b.pr ? `PR ${b.pr} · ` : ''}rev {b.rev}{b.rearranged ? ' · rearranged (Restore default in the Steps view)' : ''}</p>
      <ol className="axp-builds__steps">
        {b.steps.map((s) => (
          <li key={s.uid} className={s.done ? 'is-done' : s.next ? 'is-next' : ''}>
            <Bar p={{ total: 1, done: s.done ? 1 : 0, pct: s.done ? 100 : 0, active: s.next && b.status === 'running' }} label={`${s.id}: ${s.done ? 'done' : s.next ? 'next' : 'to do'}`} />
            <span className="fx-mono fx-small">{s.id}</span> <Chip tone={s.model === 'Fable' ? 'accent' : undefined}>{s.model}</Chip> <span>{stepName(s)}</span>{s.estimate && <span className="fx-small fx-muted"> · ~{s.estimate}</span>}
          </li>
        ))}
      </ol>
      {b.notes.length > 0 && <ul className="fx-small fx-muted axp-builds__notes">{b.notes.map((n, i) => <li key={i}>{n.text}</li>)}</ul>}
    </div>
  );
}

/* ---------------- Steps view ---------------- */

function StepsView({ state, builds }: { state: StateV; builds: BuildV[] }) {
  const rt = useRuntime();
  const [scope, setScope] = useState<string>(() => (rt.settings.get(KEYS.scope) as string) || '');
  const [sel, setSel] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | { kind: 'harvest' } | { kind: 'divide'; step: StepV } | { kind: 'restore'; id: string | null }>(null);
  const selectMode = (rt.settings.get(KEYS.select) as string) || 'off';
  const press = useRef<number | undefined>(undefined);
  useEffect(() => { rt.settings.set(KEYS.scope, scope); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = scope ? state.builds.filter((b) => b.id === scope) : builds;
  const all = useMemo(() => shown.flatMap((b) => b.steps), [shown]);
  useEffect(() => { setSel((x) => x.filter((u) => all.some((s) => s.uid === u))); }, [all]);
  const picked = all.filter((s) => sel.includes(s.uid));
  const draft = (op: Op) => send('draft', { op }, rt.toast);
  const toggle = (uid: string) => setSel((x) => (x.includes(uid) ? x.filter((u) => u !== uid) : [...x, uid]));
  const click = (s: StepV, e: RMouseEvent) => {
    if (e.shiftKey && anchor) { const a = all.findIndex((x) => x.uid === anchor); const b = all.findIndex((x) => x.uid === s.uid); const [i, j] = a < b ? [a, b] : [b, a]; setSel([...new Set([...sel, ...all.slice(i, j + 1).map((x) => x.uid)])]); return; }
    if (e.ctrlKey || e.metaKey || isPhone() || selectMode !== 'off') toggle(s.uid); else setSel(sel.length === 1 && sel[0] === s.uid ? [] : [s.uid]);
    setAnchor(s.uid);
  };
  const selCol: GridColumn<StepV>[] = selectMode === 'off' ? [] : [{ id: 'sel', label: '', width: 'calc(var(--fx-space) * 5)', fixed: true,
    render: (s) => <span onClick={(e) => e.stopPropagation()}>{selectMode === 'switches' ? <Switch label="Select" hideLabel checked={sel.includes(s.uid)} onChange={() => toggle(s.uid)} /> : <Checkbox label="" title="Select" checked={sel.includes(s.uid)} onChange={() => toggle(s.uid)} />}</span> }];
  const columns: GridColumn<StepV>[] = [
    ...selCol,
    { id: 'step', label: 'Step', width: 'minmax(calc(var(--fx-space) * 30), 4fr)', fixed: true,
      render: (s) => (
        <span className="axp-builds__cell-title" onPointerDown={(e) => { if (e.pointerType === 'mouse') return; window.clearTimeout(press.current); press.current = window.setTimeout(() => toggle(s.uid), 550); }} onPointerUp={() => window.clearTimeout(press.current)} onPointerLeave={() => window.clearTimeout(press.current)}>
          <InlineName label="Step name" longPress="none" value={stepName(s)} onSave={(title) => draft({ op: 'rename-step', build: s.build, uid: s.uid, title })} />
          <span className="fx-small fx-muted fx-mono">{s.id}{s.origin ? ` · ${s.origin.how} from ${s.origin.build}` : ''}</span>
        </span>) },
    { id: 'build', label: 'Source build', width: 'minmax(calc(var(--fx-space) * 16), 2fr)', sortable: true, sortValue: (s) => s.buildTitle, render: (s) => <span className="fx-small">{s.buildTitle}</span> },
    { id: 'profile', label: 'Profile', width: 'calc(var(--fx-space) * 12)', render: () => <span className="fx-small fx-mono">{state.profile}</span> },
    { id: 'kind', label: 'Kind', width: 'calc(var(--fx-space) * 10)', sortable: true, sortValue: (s) => s.kind, render: (s) => <Chip tone={s.kind === 'fix' ? 'warning' : s.kind === 'removal' ? 'danger' : s.kind === 'creation' ? 'success' : undefined}>{s.kind}</Chip> },
    { id: 'target', label: 'Target', width: 'minmax(calc(var(--fx-space) * 12), 2fr)', render: (s) => <span className="fx-small fx-mono">{s.target}</span> },
    { id: 'model', label: 'Model', width: 'calc(var(--fx-space) * 9)', sortable: true, sortValue: (s) => s.model, render: (s) => <Chip tone={s.model === 'Fable' ? 'accent' : undefined}>{s.model}</Chip> },
    { id: 'estimate', label: 'Time', width: 'calc(var(--fx-space) * 8)', align: 'end', render: (s) => <span className="fx-small">{s.estimate}</span> },
    { id: 'progress', label: 'Progress', width: 'calc(var(--fx-space) * 16)', render: (s) => <Bar p={{ total: 1, done: s.done ? 1 : 0, pct: s.done ? 100 : 0, active: s.next && state.builds.find((b) => b.id === s.build)?.status === 'running' }} label={`${s.id} ${s.done ? 'done' : 'to do'}`} /> },
  ];
  const groups: GridGroup<StepV>[] = shown.map((b) => ({ id: b.id, title: b.title, rows: b.steps, groups: [], collapsed: collapsed.includes(b.id), progress: b.progress.pct, counts: <span className="fx-small">{b.progress.done}/{b.progress.total}{b.rearranged ? ' · rearranged' : ''}</span> }));
  const one = picked.length === 1 ? picked[0] : null;
  const scopedBuild = scope ? state.builds.find((b) => b.id === scope) ?? null : one ? state.builds.find((b) => b.id === one.build) ?? null : null;
  const rearranged = shown.filter((b) => b.rearranged && b.hasDefault);
  return (
    <div className="axp-builds__steps-view">
      <div className="axp-builds__bar">
        <SelectField label="Scope" value={scope} empty="Every build in the profile" options={state.builds.map((b) => ({ value: b.id, label: b.title }))} onChange={(v) => { setScope(v); setSel([]); }} className="axp-builds__pick" />
        <span className="fx-small fx-muted">{sel.length ? `${sel.length} selected` : isPhone() ? 'Long-press or tap to select' : 'Ctrl+click to select more, Shift+click for a range'}</span>
        <span className="axp-builds__grow" />
        <Button size="sm" icon="check-circle" disabled={!all.length} onClick={() => setSel(sel.length === all.length ? [] : all.map((s) => s.uid))}>{sel.length === all.length && all.length ? 'Select none' : 'Select all'}</Button>
        <Button size="sm" icon="layout" disabled={!one} title="Divide the selected step further" onClick={() => one && setDialog({ kind: 'divide', step: one })}>Divide</Button>
        <Button size="sm" icon="cut" disabled={!picked.length} title="Take the selected steps into a new build (or split them into N)" onClick={() => setDialog({ kind: 'harvest' })}>Harvest</Button>
        {scopedBuild && <span className="axp-builds__inline"><Icon name="edit" size={12} /><InlineName label="Build name" value={scopedBuild.title} onSave={(title) => draft({ op: 'rename-build', id: scopedBuild.id, title })} /></span>}
        <Button size="sm" icon="refresh" disabled={scopedBuild ? !scopedBuild.rearranged : !rearranged.length} title="Put the build(s) back to the breakdown the orchestrator first made" onClick={() => setDialog({ kind: 'restore', id: scopedBuild?.id ?? null })}>Restore default</Button>
      </div>
      <DataGrid<StepV> id="builds.steps" label="Steps" groups={groups} columns={columns} rowId={(s) => s.uid} rowLabel={stepName} hidden={[]} multi={sel}
        onRowClick={click} expanded={expanded} onToggleExpand={(id) => setExpanded(expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id])}
        onToggleGroup={(id) => setCollapsed(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id])}
        rowTone={(s) => (s.done ? 'success' : s.next ? 'accent' : s.kind === 'fix' ? 'warning' : 'muted')}
        rowRef={(s) => ({ kind: 'build-step', id: s.uid })}
        onMove={(item, target, pos) => {
          if (item.kind === 'group' && target.kind === 'group') {
            const ids = state.builds.map((b) => b.id).filter((id) => id !== item.id); ids.splice(ids.indexOf(target.id) + (pos === 'after' ? 1 : 0), 0, item.id);
            void draft({ op: 'reorder-builds', ids }); return;
          }
          if (item.kind !== 'row' || target.kind !== 'row' || item.id === target.id) return;
          const a = all.find((s) => s.uid === item.id); const t = all.find((s) => s.uid === target.id);
          if (!a || !t) return;
          if (a.build !== t.build) { rt.toast('A step moves to another build through Harvest (select it, then Harvest).', 'info'); return; }
          const b = state.builds.find((x) => x.id === a.build)!;
          const uids = b.steps.map((s) => s.uid).filter((u) => u !== a.uid); uids.splice(uids.indexOf(t.uid) + (pos === 'after' ? 1 : 0), 0, a.uid);
          void draft({ op: 'reorder-steps', build: b.id, uids }).then((ok) => ok && rt.toast(`Changing the order refactors “${b.title}” when you Apply.`, 'info'));
        }}
        renderDetail={(s) => <StepDetail s={s} />}
        empty={<p className="fx-muted">No steps here.</p>} />
      {dialog?.kind === 'harvest' && <HarvestDialog picked={picked} onClose={() => { setDialog(null); setSel([]); }} />}
      {dialog?.kind === 'divide' && <DivideDialog step={dialog.step} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'restore' && (
        <ConfirmDialog title="Restore default" yes="Restore default" onClose={() => setDialog(null)}
          text={dialog.id ? `Put “${state.builds.find((b) => b.id === dialog.id)?.title}” back to the breakdown the orchestrator first made? This undoes its reordering, divisions and harvests (done ticks are kept). It goes into the draft; nothing changes until Apply.` : `Put all ${rearranged.length} rearranged build(s) in this view back to their default breakdown? It goes into the draft; nothing changes until Apply.`}
          onYes={() => { const ids = dialog.id ? [dialog.id] : rearranged.map((b) => b.id); void (async () => { for (const id of ids) await draft({ op: 'restore-default', id }); })(); }} />
      )}
    </div>
  );
}

function StepDetail({ s }: { s: StepV }) {
  return (
    <div className="axp-builds__detail">
      <p className="axp-builds__text">{s.text}</p>
      {s.kind === 'fix' && <p className="fx-small"><strong>Fix:</strong> {s.why || 'where it broke, where it came from and what raised the alarm are not recorded on this step yet'}{s.note ? ` · ${s.note}` : ''}</p>}
      {s.kind !== 'fix' && s.why && <p className="fx-small"><strong>Why:</strong> {s.why}</p>}
      {s.files.length > 0 && <p className="fx-small"><strong>Files:</strong> <span className="fx-mono">{s.files.join(', ')}</span></p>}
      {s.checks.length > 0 && <p className="fx-small"><strong>Checks:</strong> <span className="fx-mono">{s.checks.join(' · ')}</span></p>}
      <p className="fx-small fx-muted">{s.phase ? `phase ${s.phase} · ` : ''}{s.group ? `group ${s.group} · ` : ''}record {s.uid} rev {s.rev}{s.done && s.doneAt ? ` · done ${new Date(s.doneAt).toLocaleString()}` : ''}</p>
    </div>
  );
}

/* ---------------- settings panel ---------------- */

export function StorePanel() {
  const s = useBuilds();
  useEffect(() => { if (!s.state) void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fx-stack">
      <p className="fx-small" style={{ margin: 0 }}>One builds store for every profile: <code className="fx-mono">_claude/builds/store.json</code>, every write versioned in <code className="fx-mono">_claude/builds/journal/</code>. The old Pending, queue and orchestrator files are read-only exports of it.</p>
      {s.state && <ul className="fx-small axp-builds__notes">{s.state.profiles.map((p) => <li key={p.id}><strong>{p.name}</strong> <span className="fx-mono">{p.id}</span>: {p.builds} builds, {p.progress.pct}% ({p.progress.done}/{p.progress.total} steps)</li>)}</ul>}
    </div>
  );
}
