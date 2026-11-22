/**
 * The one builds table (status-table@1, Pipeline 2.0; Brett, Nov 18-19 2026): builds as rows, expandable to their
 * steps, driven only by status. No tabs: filters sit on the toolbar (status, account, model, date, words). The merge
 * queue is the same table, read-only, filtered to merging-pr through merging-main (mode="queue").
 *
 * Rows come from GET /table (status-table.mjs → the builds store on Postgres), polled every POLL_MS while the page is
 * visible; a poll that finds the store at the same rev carries nothing. The timers tick client-side from each row's
 * status `at` on one shared clock. Phone first: on a phone the grid keeps Build, Status, Steps, Timer and PR and
 * the rest moves into the expanded row.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, PageToolbar, SelectField, Switch, TextField, flashWhenReady, useIsPhone, usePublishPageState, useRuntime, useToolbarHandlers } from '@console/axf/react';
import * as consoleApi from '@console/api';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import type { pluginApi } from '@console/plugins';
import * as T from './status-table-core.mjs';
import type { StepRow, TableRow } from './status-table-core.mjs';
import { buildRowSelector, focusBuild, settleFocus, useFocusedBuild } from './focus';
import { FileBuildForm } from './file-build';
import { parallelAskOf, parallelChoices } from './orchestrator-core.mjs';
import './status-table.css';

type Api = ReturnType<typeof pluginApi>;
type TableRes = { ok: boolean; error?: string; unchanged?: boolean; rev?: number; updatedAt?: string; rows?: TableRow[] };
export type Filters = { status: string; account: string; model: string; date: string; text: string; landed: boolean };
export const NO_FILTERS: Filters = { status: '', account: '', model: '', date: '', text: '', landed: false };
const POLL_MS = 5_000;

/** Another part of the console (an action, a deep link) asks for a filter: the table takes it. */
export const FILTER_EVENT = 'axf:orchestrator-filter';
export function setTableFilter(f: Partial<Filters>): void {
  consoleApi.writeLocal('orch-table-filters', { ...consoleApi.readLocal<Filters>('orch-table-filters', NO_FILTERS), ...f });
  window.dispatchEvent(new CustomEvent(FILTER_EVENT, { detail: f }));
}

/* ---------------- one shared clock for every timer on the page ---------------- */
const tickers = new Set<(n: number) => void>();
let clock: ReturnType<typeof setInterval> | null = null;
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    tickers.add(setNow);
    if (!clock) clock = setInterval(() => { const n = Date.now(); for (const f of tickers) f(n); }, 1000);
    return () => { tickers.delete(setNow); if (!tickers.size && clock) { clearInterval(clock); clock = null; } };
  }, []);
  return now;
}

/** The status badge: one colour per contract status; failed carries its attempt. */
export function StatusBadge({ status, attempt = 0 }: { status: string; attempt?: number }) {
  return <span className={`pd-badge st-badge is-${status}`} data-status={status}>{T.statusLabel(status, attempt)}</span>;
}

/** The Emergency badge: Brett sent this build to the emergency slots (it skips the line and lands first). */
export function EmergencyBadge({ by = '' }: { by?: string }) {
  return <span className="pd-badge st-badge is-emergency" data-emergency="true" title={`Emergency build${by ? `, sent by ${by}` : ''}: skips the line, builds in the emergency slots, lands first`}>Emergency</span>;
}

/**
 * Send to emergency: Brett's own signed-in console only (the server refuses the console token, MCP, voice and sessions).
 * Never a toolbar button or a registered action, and its words sit in a <span> so the button is no console-control
 * target either (react/controlTargets.ts only registers buttons with plain-text words): nothing outside the page (MCP,
 * voice, a remote press) can press it for him. Two clicks: the first arms it, the second sends.
 */
function SendToEmergency({ api, id, onSent }: { api: Api; id: string; onSent: () => void }) {
  const rt = useRuntime();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; error?: string; already?: boolean }>('pipeline/emergency', { id });
      if (!r.ok) throw new Error(r.error ?? 'not sent');
      rt.toast(r.already ? `${id} is already an emergency build` : `${id} sent to emergency`, 'success', 'Build orchestrator'); onSent();
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Build orchestrator'); } finally { setBusy(false); setArmed(false); }
  };
  return (
    <p className="st-emergency fx-small">
      <Button size="sm" tone={armed ? 'danger' : undefined} icon="zap" disabled={busy} onClick={() => void send()}><span>{armed ? 'Confirm: send to emergency' : 'Send to emergency'}</span></Button>
      {armed && <Button size="sm" tone="quiet" onClick={() => setArmed(false)}>Cancel</Button>}
      <span className="fx-muted">Skips the line, builds in the 2 emergency slots and lands first.</span>
    </p>
  );
}

/** Time in the current status and total time, ticking from the row's `at`. */
function Timer({ row }: { row: { status: string; at: string; createdAt: string } }) {
  const now = useNow();
  const t = T.timers(row, now);
  return (
    <span className="st-timer fx-small" title={`In this status since ${row.at ? new Date(row.at).toLocaleString() : 'unknown'}`}>
      {t.inStatus != null && <b className="fx-mono">{T.formatElapsed(t.inStatus)}</b>}
      <span className="fx-mono fx-muted">{t.inStatus != null ? ' / ' : ''}{T.formatElapsed(t.total)}</span>
    </span>
  );
}

/** A step's clock: time in its current status; a finished step shows when it finished. */
function StepTimer({ s }: { s: StepRow }) {
  const now = useNow();
  if (!s.at) return <span className="fx-muted">—</span>;
  if (s.status === 'completed' || s.status === 'in-pr') return <span className="fx-small fx-muted" title={new Date(s.at).toLocaleString()}>{new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>;
  return <b className="st-timer fx-small fx-mono" title={`In this status since ${new Date(s.at).toLocaleString()}`}>{T.formatElapsed(now - Date.parse(s.at))}</b>;
}

const PrLink = ({ n, href }: { n: number; href?: string }) => (!n ? <span className="fx-muted">—</span>
  : href ? <a className="fx-mono fx-small" href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>#{n}</a>
  : <span className="fx-mono fx-small">#{n}</span>);
const dash = (v: string) => v || '—';
const toggleIn = (list: readonly string[], v: string, on?: boolean) => { const has = list.includes(v); const want = on ?? !has; return want ? (has ? [...list] : [...list, v]) : list.filter((x) => x !== v); };
const nextSort = (cur: GridSort, col: string | null): GridSort => (!col ? null : cur?.col === col ? (cur.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 });
const TONE: Record<string, string> = { failed: 'danger', landed: 'success', building: 'accent', 'build-complete': 'success', pending: 'muted', split: 'muted' };
const tone = (s: string) => TONE[s] ?? (T.MERGE_QUEUE.includes(s as never) ? 'warning' : 'info');
/** On a phone the grid is one Build column: its cell carries status, steps, timer and PR; the rest is in the expanded row. */
const PHONE_HIDDEN = ['status', 'steps', 'model', 'account', 'slot', 'timer', 'pr'];
const PHONE_STEP_HIDDEN = ['id', 'status', 'model', 'account', 'slot', 'timer', 'pr'];

/**
 * A build's own parallel ask (Nov 13 2026: "split into N parallel"): Split settings decide, one build, or split into
 * 2-12 parallel builds, through POST pipeline/parallel. Shown until the build is split in parallel or starts building;
 * a build with no step done is split again on the next tick.
 */
function ParallelAsk({ api, r, onChanged }: { api: Api; r: TableRow; onChanged: () => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const pick = async (v: string) => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string; note?: string; resplit?: boolean }>('pipeline/parallel', { id: r.id, parts: v });
      if (!res.ok) throw new Error(res.error ?? 'not saved');
      rt.toast(`${r.id}: ${res.note ?? v}${res.resplit ? ' (split again on the next tick)' : ''}`, 'success', 'Build orchestrator'); onChanged();
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Build orchestrator'); } finally { setBusy(false); }
  };
  return (
    <div className="st-parallel" data-help="parallel-ask">
      <SelectField className="st-pick" label="Parallel split (this build)" value={parallelAskOf(r.parallelParts)} options={parallelChoices()} disabled={busy} onChange={(v) => void pick(v)}
        hint="This build only: beats the Split settings. Parallel builds run at the same time in separate slots." />
    </div>
  );
}

/** The rows, polled from GET /table while the page is visible (landed ones only when a filter asks for them). */
function useTableRows(api: Api, landed: boolean) {
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [error, setError] = useState('');
  const [rev, setRev] = useState<number | null>(null);
  const revRef = useRef<number | null>(null);
  const load = async (fresh = false) => {
    try {
      const q = `table?landed=${landed ? 1 : 0}${!fresh && revRef.current != null ? `&since=${revRef.current}` : ''}`;
      const r = await api.call<TableRes>(q);
      if (!r.ok) throw new Error(r.error ?? 'the builds table did not load');
      if (!r.unchanged) { setRows(r.rows ?? []); revRef.current = r.rev ?? null; setRev(r.rev ?? null); }
      setError('');
    } catch (e) { setError((e as Error).message); setRows((x) => x ?? []); }
  };
  useEffect(() => {
    revRef.current = null; void load(true);
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [landed]);
  return { rows, error, rev, reload: () => load(true) };
}

export function StatusTable({ api, mode = 'all' }: { api: Api; mode?: 'all' | 'queue' }) {
  const rt = useRuntime();
  const queue = mode === 'queue';
  const phone = useIsPhone();
  const storeKey = queue ? 'orch-queue-filters' : 'orch-table-filters';
  const [f, setF] = useState<Filters>(() => ({ ...NO_FILTERS, ...consoleApi.readLocal<Filters>(storeKey, NO_FILTERS) }));
  useEffect(() => { consoleApi.writeLocal(storeKey, f); }, [f]);
  useEffect(() => { if (queue) return undefined; const on = (e: Event) => setF((x) => ({ ...x, ...(e as CustomEvent<Partial<Filters>>).detail })); window.addEventListener(FILTER_EVENT, on); return () => window.removeEventListener(FILTER_EVENT, on); }, [queue]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const wantLanded = !queue && (f.landed || f.status === 'landed');
  const { rows, error, rev, reload } = useTableRows(api, wantLanded);
  const all = rows ?? [];
  const opts = useMemo(() => T.filterOptions(all), [rows]);
  const shown = useMemo(() => T.filterRows(all, queue ? { ...f, status: f.status || [...T.MERGE_QUEUE], landed: false } : f), [rows, f, queue]);

  const [sort, setSort] = useState<GridSort>(null);
  const [hidden, setHidden] = useState<string[]>(() => consoleApi.readLocal<string[]>(`${storeKey}-hidden`, []));
  useEffect(() => { consoleApi.writeLocal(`${storeKey}-hidden`, hidden); }, [hidden]);
  const [open, setOpen] = useState<string[]>([]);
  const [picked, setPicked] = useState('');
  const focusId = useFocusedBuild();
  const listed = !!focusId && shown.some((r) => r.id === focusId);
  useEffect(() => {
    if (!listed) return;
    setOpen((o) => (o.includes(focusId) ? o : [...o, focusId])); setPicked(focusId);
    flashWhenReady(() => document.querySelector(`.axf-grid-row${buildRowSelector(focusId)}`), 5000);
    settleFocus(focusId);
  }, [listed, focusId]);
  // a build asked for that the filters hide: clear them so it shows (it may be landed: ask for those too)
  useEffect(() => { if (focusId && rows && !listed && !queue && Object.values(f).some(Boolean)) setF({ ...NO_FILTERS, landed: true }); }, [focusId, rows]);

  // the Builds page toolbar (page-toolbar@1, assets/toolbar/build-orchestrator-pipeline.json) works on the picked row
  const one = shown.find((r) => r.id === picked);
  const statuses = T.BUILD_STATUSES.filter((s) => opts.counts[s] > 0);
  const nextStep = one?.steps.find((s) => s.status !== 'completed' && s.status !== 'in-pr' && s.model !== 'Fable');
  usePublishPageState(queue ? null : 'build-orchestrator', {
    tab: 'table',
    selection: {
      count: one ? 1 : 0, id: one?.id ?? '', ids: one ? [one.id] : [], pr: one?.pr ?? '', nextPriority: 'P1',
      canQueue: 0, // Pipeline 2.0: nothing is queued by hand, a ready build starts by itself
      canSplit: !!one && one.status === 'pending',
      canRaise: !!nextStep,
      canRelaunch: !!one && one.status === 'failed',
    },
    statuses: statuses.length, statusFilter: f.status, statusFilterCount: f.status ? shown.length : 0,
  });
  useToolbarHandlers(queue ? null : 'build-orchestrator', {
    'builds.queue-selected': () => { throw new Error('Pipeline 2.0 starts a ready build by itself: there is no queue to put it in.'); },
    'builds.raise-fable': async () => {
      if (!one || !nextStep) throw new Error('no open step below Fable');
      const r = await api.post<{ ok: boolean; error?: string }>('act', { action: 'edit-step', id: one.id, step: nextStep.id, stepData: { model: 'Fable' } });
      if (!r.ok) throw new Error(r.error); rt.toast(`${one.id} ${nextStep.id} → Fable`, 'success'); void reload();
    },
    'builds.show-said': () => { if (one) focusBuild(one.id); return one ? { id: one.id } : null; },
    'builds.open-pr': () => { if (one?.pr) window.open(one.pr, '_blank', 'noopener'); return one?.pr ?? null; },
    'builds.filter-status': () => { const i = statuses.indexOf(f.status as never); const next = statuses[i + 1] ?? ''; set('status', next); return { statusFilter: next }; },
  });

  // Ask for a build (file-build.tsx): POST pipeline/request with the per-build parallel ask; true when it was filed
  const [filing, setFiling] = useState(false);
  const fileBuild = async (body: Record<string, unknown>, what: string): Promise<boolean> => {
    setFiling(true);
    try {
      const r = await api.post<{ ok: boolean; error?: string; id?: string }>('pipeline/request', body);
      if (!r.ok) throw new Error(r.error ?? 'not filed');
      rt.toast(r.id ? `${what}: ${r.id}` : what, 'success', 'Build orchestrator'); void reload(); return true;
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Build orchestrator'); return false; } finally { setFiling(false); }
  };

  const statusOpts = (queue ? T.MERGE_QUEUE : T.BUILD_STATUSES).map((s) => ({ value: s, label: `${T.statusLabel(s)}${s === 'split' ? ' (split)' : ''} (${opts.counts[s] ?? 0})` }));
  const filtered = Object.entries(f).some(([k, v]) => k !== 'landed' && v);
  const cols: GridColumn<TableRow>[] = [
    { id: 'title', label: 'Build', width: phone ? 'calc(var(--fx-font-size) * 20)' : 'minmax(calc(var(--fx-font-size) * 16), calc(var(--fx-font-size) * 26))', fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(),
      render: (r) => (
        <span className="oc-cell-title" title={r.title}>
          <strong>{r.title}</strong>
          {r.emergency && !phone && <EmergencyBadge by={r.emergencyBy} />}
          {phone ? <span className="st-rowmeta">{r.emergency && <EmergencyBadge by={r.emergencyBy} />}<StatusBadge status={r.status} attempt={r.attempt} /><span className="fx-small fx-mono">{r.done}/{r.total}</span><Timer row={r} /><PrLink n={r.prNumber} href={r.pr} /></span>
            : <span className="fx-small fx-muted fx-mono">{r.id}</span>}
        </span>
      ) },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-font-size) * 9)', sortable: true, sortValue: (r) => T.BUILD_STATUSES.indexOf(r.status), render: (r) => <StatusBadge status={r.status} attempt={r.attempt} /> },
    { id: 'steps', label: 'Steps', width: 'calc(var(--fx-font-size) * 4)', sortable: true, sortValue: (r) => (r.total ? r.done / r.total : -1), render: (r) => <span className="fx-small fx-mono">{r.done}/{r.total}</span> },
    { id: 'model', label: 'Model', width: 'calc(var(--fx-font-size) * 5)', sortable: true, sortValue: (r) => r.model, render: (r) => (r.model && r.model !== 'mixed' ? <span className={`oc-model is-${r.model.toLowerCase()}`}>{r.model}</span> : <span className="fx-small fx-muted">{dash(r.model)}</span>) },
    { id: 'account', label: 'Account', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (r) => r.account, render: (r) => <span className="fx-small">{dash(r.account)}</span> },
    { id: 'slot', label: 'Slot', width: 'calc(var(--fx-font-size) * 3.5)', sortable: true, sortValue: (r) => r.slot, render: (r) => <span className="fx-small fx-mono">{dash(r.slot)}</span> },
    { id: 'timer', label: 'Timer', width: 'calc(var(--fx-font-size) * 8)', align: 'end', sortable: true, sortValue: (r) => -(Date.parse(r.at) || 0), render: (r) => <Timer row={r} /> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-font-size) * 4)', align: 'end', sortable: true, sortValue: (r) => r.prNumber, render: (r) => <PrLink n={r.prNumber} href={r.pr} /> },
  ];
  const groups: GridGroup<TableRow>[] = [{ id: 'all', title: queue ? `Merge queue (${shown.length})` : `Builds (${shown.length})`, icon: queue ? 'git-merge' : 'layers', rows: shown, groups: [], fixed: true }];
  const gridHidden = phone ? [...new Set([...hidden, ...PHONE_HIDDEN])] : hidden;

  return (
    <div className="st-page fx-stack">
      <div className="st-toolbar" role="toolbar" aria-label={queue ? 'Merge queue: filters' : 'Builds: filters'} data-axf-toolbar={queue ? 'build-orchestrator.queue-filters' : 'build-orchestrator.filters'}>
        <SelectField className="st-pick" label="Status" value={f.status} empty={queue ? 'Whole merge queue' : 'Any status'} options={statusOpts} onChange={(v) => set('status', v)} />
        {!queue && <SelectField className="st-pick" label="Account" value={f.account} empty="Any account" options={opts.accounts.map((a) => ({ value: a, label: a }))} onChange={(v) => set('account', v)} />}
        {!queue && <SelectField className="st-pick" label="Model" value={f.model} empty="Any model" options={opts.models.map((m) => ({ value: m, label: m }))} onChange={(v) => set('model', v)} />}
        <SelectField className="st-pick" label="Changed" value={f.date} options={Object.entries(T.DATE_RANGES).map(([value, label]) => ({ value, label }))} onChange={(v) => set('date', v)} />
        <TextField className="st-find" label="Find" type="search" value={f.text} placeholder="Id, title or branch" onChange={(v) => set('text', v)} />
        {!queue && <Switch className="st-landed" label="Show landed" checked={f.landed} onChange={(v) => set('landed', v)} />}
        {filtered && <Button size="sm" icon="x" onClick={() => setF((x) => ({ ...NO_FILTERS, landed: x.landed }))}>Clear filters</Button>}
      </div>
      {!queue && <PageToolbar view="build-orchestrator" slot="pipeline" label="Builds: actions on the picked build" />}
      {!queue && <FileBuildForm busy={filing} onFile={fileBuild} />}
      {error && <div className="pl-note is-warn" role="status"><Icon name="alert" size={14} />{error}</div>}
      <p className="st-live fx-small fx-muted" aria-live="polite"><span className="st-live__dot" aria-hidden="true" />{rows == null ? 'Loading the builds…' : `Live from the builds store${rev != null ? ` · rev ${rev}` : ''} · ${shown.length} of ${all.length}${queue ? ' · read-only' : ''}`}</p>
      {rows != null && (
        <div className="oc-grid">
          <DataGrid<TableRow> id={queue ? 'orch-merge-queue' : 'orch-status-table'} label={queue ? 'Merge queue' : 'Builds'} groups={groups} columns={cols} rowId={(r) => r.id} rowLabel={(r) => r.title}
            rowTone={(r) => tone(r.status)} selected={picked || (listed ? focusId : undefined)}
            hidden={gridHidden} onToggleColumn={(c, show) => setHidden((h) => toggleIn(h, c, show))} onShowAll={() => setHidden([])}
            sort={sort} onSort={(c) => setSort((s) => nextSort(s, c))}
            expanded={open} onToggleExpand={(id) => setOpen((o) => toggleIn(o, id))}
            onRowClick={(r) => { setPicked(r.id); setOpen((o) => toggleIn(o, r.id)); }}
            rowCtx={(r) => ({ target: 'axf-orchestrator-build', payload: r.id })} rowRef={(r) => ({ kind: 'orchestrator', id: r.id })}
            empty={<div className="fx-empty">{filtered ? 'No builds match these filters.' : queue ? 'Nothing is waiting to merge.' : 'No builds yet. Plan Studio sends them here.'}</div>}
            renderDetail={(r) => <BuildDetail r={r} phone={phone} api={api} canSend={!queue} onChanged={() => void reload()} />} key={phone ? 'phone' : 'wide'} />
        </div>
      )}
    </div>
  );
}

/** An expanded row: what the phone hides, then every step with its own status, model, account, slot and timer. */
function BuildDetail({ r, phone, api, canSend, onChanged }: { r: TableRow; phone: boolean; api: Api; canSend: boolean; onChanged: () => void }) {
  const cols: GridColumn<StepRow>[] = [
    { id: 'id', label: '#', width: 'calc(var(--fx-font-size) * 3)', render: (s) => <span className="fx-small fx-mono">{s.id}</span> },
    { id: 'title', label: 'Step', width: phone ? 'calc(var(--fx-font-size) * 18)' : 'minmax(calc(var(--fx-font-size) * 12), calc(var(--fx-font-size) * 22))', fixed: true,
      render: (s) => (
        <span className="oc-cell-title" title={s.title}>
          <span>{phone ? `${s.id} · ` : ''}{s.title || s.id}</span>
          {phone && <span className="st-rowmeta"><StatusBadge status={s.status} attempt={s.attempt} />{s.model && <span className={`oc-model is-${s.model.toLowerCase()}`}>{s.model}</span>}{s.account && <span className="fx-small">{s.account}{s.slot ? ` · slot ${s.slot}` : ''}</span>}<StepTimer s={s} /></span>}
        </span>
      ) },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-font-size) * 8)', render: (s) => <StatusBadge status={s.status} attempt={s.attempt} /> },
    { id: 'model', label: 'Model', width: 'calc(var(--fx-font-size) * 4.5)', render: (s) => (s.model ? <span className={`oc-model is-${s.model.toLowerCase()}`}>{s.model}</span> : <span className="fx-muted">—</span>) },
    { id: 'account', label: 'Account', width: 'calc(var(--fx-font-size) * 7)', render: (s) => <span className="fx-small">{dash(s.account)}</span> },
    { id: 'slot', label: 'Slot', width: 'calc(var(--fx-font-size) * 3)', render: (s) => <span className="fx-small fx-mono">{dash(s.slot)}</span> },
    { id: 'timer', label: 'Timer', width: 'calc(var(--fx-font-size) * 6)', align: 'end', render: (s) => <StepTimer s={s} /> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-font-size) * 3.5)', align: 'end', render: (s) => <PrLink n={s.prNumber} href={s.prNumber === r.prNumber ? r.pr : undefined} /> },
  ];
  const rows = r.steps;
  return (
    <div className="oc-detail">
      <dl className="st-facts fx-small">
        {phone && <><dt>Model</dt><dd>{dash(r.model)}</dd><dt>Account</dt><dd>{dash(r.account)}</dd><dt>Slot</dt><dd>{dash(r.slot)}</dd></>}
        <dt>Status by</dt><dd>{dash(r.by)}</dd>
        {r.emergency && <><dt>Emergency</dt><dd>sent by {dash(r.emergencyBy)}</dd></>}
        {r.branch && <><dt>Branch</dt><dd className="fx-mono">{r.branch}</dd></>}
      </dl>
      {canSend && T.canSendEmergency(r) && <SendToEmergency api={api} id={r.id} onSent={onChanged} />}
      {canSend && T.canAskParallel(r) && <ParallelAsk api={api} r={r} onChanged={onChanged} />}
      {rows.length ? (
        <div className="oc-subgrid">
          <DataGrid id={`orch-status-steps-${r.id.replace(/[^a-z0-9-]/gi, '-')}`} rowKind="step" label={`Steps of ${r.title}`} compact dataset={false}
            groups={[{ id: 'steps', title: `Steps ${r.done}/${r.total}`, icon: 'list', rows, groups: [], fixed: true }]} columns={cols}
            rowId={(s) => s.id} rowLabel={(s) => s.title} rowTone={(s) => tone(s.status === 'completed' || s.status === 'in-pr' ? 'landed' : s.status)}
            hidden={phone ? PHONE_STEP_HIDDEN : []} />
        </div>
      ) : <p className="fx-small fx-muted">No steps yet: the build is split into steps in its splitting status.</p>}
    </div>
  );
}
