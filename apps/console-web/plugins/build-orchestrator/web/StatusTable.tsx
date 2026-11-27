/**
 * The one builds table (status-table@1, Pipeline 2.0; Brett, Nov 18-19 2026): builds as rows, expandable to their
 * steps, driven only by status. No tabs: filters sit on the toolbar (status, account, model, date, words). The merge
 * queue is the same table, read-only, filtered to merging-pr through merging-main (mode="queue").
 *
 * Rows come from GET /table (status-table.mjs → the builds store on Postgres), one page at a time (paging.tsx): the
 * status filter and the page go to the server (?status=&limit=&offset=), the rest of the list loads when its foot
 * scrolls into view or on "Load more", and the table never holds more than the pages it has shown. It re-reads them the moment the
 * builds live channel says `builds.updated` (live.ts: GET /api/builds/events), when the window gets the focus back, and
 * on a poll while the page is visible (every POLL_MS without the channel, every LIVE_POLL_MS with it: a missed event
 * still shows). A read that finds the store at the same rev carries nothing.
 *
 * pipeline-status@1 (Brett, Nov 23 2026): every row and its detail show the build number in its own column, the state
 * badge, the plain line saying what the VPS is doing now, the reason a build waits with a link to the build holding the
 * active place, its place in the merge line with "Merge together", who split it ("Split by Fable on the VPS") and, per
 * step, the step's unique id in its own column and the model the triage gate gave it (pipeline-view-core.mjs). The timers tick client-side from each row's
 * status `at` on one shared clock. Phone first: on a phone the grid keeps Build, Status, Steps, Timer and PR and
 * the rest moves into the expanded row.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Chip, Icon, PageToolbar, SelectField, Switch, TextField, flashWhenReady, useIsPhone, usePublishPageState, useRuntime, useToolbarHandlers } from '@console/axf/react';
import * as consoleApi from '@console/api';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import type { pluginApi } from '@console/plugins';
import * as T from './status-table-core.mjs';
import { StepDeps } from './StepDeps';
import type { StepRow, TableRow } from './status-table-core.mjs';
import { buildRowSelector, focusBuild, settleFocus, useFocusedBuild } from './focus';
import { liveOpen, onBuildsUpdated } from './live';
import { mergeTogether, mergeTogetherLine } from './mergeTogether';
import { waitingToMerge, type PipelineView } from './pipeline-view-core.mjs';
import { LoadMore, PAGE_SIZE, addPage, pageOf, pageQuery, readWindow, type Paged } from './paging';
import './status-table.css';

type Api = ReturnType<typeof pluginApi>;
type TableRes = Paged & { ok: boolean; error?: string; unchanged?: boolean; rev?: number; updatedAt?: string; rows?: TableRow[] };
export type Filters = { status: string; account: string; model: string; date: string; text: string; landed: boolean };
export const NO_FILTERS: Filters = { status: '', account: '', model: '', date: '', text: '', landed: false };
const POLL_MS = 5_000;
/** The poll while the live channel is connected: only a safety net for a missed event. */
const LIVE_POLL_MS = 30_000;
/** How far the table reads on by itself to reach a build that was asked for (a deep link, a search hit). */
const FOCUS_SCAN_ROWS = 1000;

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

/** The state badge of a build: one per pipeline state, from the store's view (label and tone); failed carries its attempt. */
export function StateBadge({ view }: { view: PipelineView }) {
  return <span className={`pd-badge st-badge tone-${view.tone} is-${view.state}`} data-status={view.state} data-tone={view.tone} title={view.line || view.label}>{view.label}</span>;
}

/** "Split by Fable on the VPS": the VPS split this build (or this step) into steps. */
export function SplitBadge({ label, at = '' }: { label: string; at?: string }) {
  if (!label) return null;
  return <span className="st-split" title={at ? `${label}, ${new Date(at).toLocaleString()}` : label}><Chip tone="accent">{label}</Chip></span>;
}

/** The build number, in its own column ("—" until the store gives the build one). */
const BuildNo = ({ n }: { n: string }) => (n ? <span className="st-no fx-small fx-mono" title={`Build number ${n}`}>{n}</span> : <span className="fx-muted" title="No build number yet">—</span>);

/** A link to another build's row (the build holding the active place, the build ahead in the merge line). */
function BuildLink({ id, children }: { id: string; children: ReactNode }) {
  return <a className="st-buildlink" href={`#/build-orchestrator/${encodeURIComponent(id)}`} title={`Open ${id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); focusBuild(id); }}>{children}</a>;
}

/** What a build is doing now, in one line: the waiting reason (linked), else its place in the merge line, else the status line. */
function NowLine({ view }: { view: PipelineView }) {
  const w = view.waitingOn; const m = view.mergeLine;
  if (w) return <span className="st-now fx-small" title={w.reason}><Icon name="clock" size={12} />{w.buildId ? <BuildLink id={w.buildId}>{w.reason}</BuildLink> : w.reason}</span>;
  if (m?.text) return <span className="st-now fx-small" title={m.text}><Icon name="branch" size={12} />{m.waitingFor ? <BuildLink id={m.waitingFor}>{m.text}</BuildLink> : m.text}</span>;
  return <span className="st-now fx-small fx-muted" title={view.line}>{view.line || '—'}</span>;
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
const PHONE_HIDDEN = ['number', 'status', 'now', 'steps', 'model', 'account', 'slot', 'timer', 'pr'];
const PHONE_STEP_HIDDEN = ['id', 'uid', 'status', 'split', 'model', 'account', 'slot', 'timer', 'pr'];

/**
 * The rows from GET /table, one page at a time (landed ones only when a filter asks for them; `status` is the status
 * filter the server applies, one or a comma list): the pages already shown are re-read on every `builds.updated` of the
 * live channel, when the window gets the focus back, and on the poll while the page is visible. `more` adds the next page.
 */
function useTableRows(api: Api, landed: boolean, status: string, project = '') {
  const key = `${landed ? 1 : 0}|${status}|${project}`;
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState('');
  const [rev, setRev] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const revRef = useRef<number | null>(null);
  const cur = useRef<{ key: string; rows: TableRow[]; total: number; busy: boolean; added: number }>({ key: '', rows: [], total: 0, busy: false, added: 0 });
  const read = async (limit: number, offset: number, since?: number) => {
    const r = await api.call<TableRes>(pageQuery('table', { status, project, limit, offset }, { landed: landed ? 1 : 0, since }));
    if (!r.ok) throw new Error(r.error ?? 'the builds table did not load');
    return r;
  };
  const put = (list: TableRow[], n: number) => { cur.current.rows = list; cur.current.total = Math.max(n, list.length); setRows(list); setTotal(cur.current.total); setLoadedFor(key); };
  const load = async (fresh = false) => {
    const mine = cur.current; const added = mine.added;
    try {
      const seen = { unchanged: false, rev: null as number | null };
      const w = await readWindow<TableRow>(Math.max(mine.rows.length, PAGE_SIZE), async (limit, offset) => {
        const r = await read(limit, offset, offset === 0 && !fresh && revRef.current != null ? revRef.current : undefined);
        if (r.unchanged) { seen.unchanged = true; return { rows: [], limit, offset, total: 0 }; }
        if (offset === 0) seen.rev = r.rev ?? null;
        return pageOf(r, T.ensureViews(r.rows), { status, limit, offset });
      });
      // a next page that arrived while this re-read ran is kept: the read after it carries both
      if (mine !== cur.current || mine.busy || mine.added !== added) return;
      if (!seen.unchanged) { put(w.rows, w.total); revRef.current = seen.rev; setRev(seen.rev); }
      setError('');
    } catch (e) { if (mine === cur.current) { setError((e as Error).message); setRows((x) => x ?? []); } }
  };
  const more = async () => {
    const mine = cur.current;
    if (mine.busy || mine.rows.length >= mine.total) return;
    mine.busy = true; setBusy(true);
    try {
      const offset = mine.rows.length;
      const r = await read(PAGE_SIZE, offset);
      if (mine !== cur.current || r.unchanged) return;
      const p = pageOf(r, T.ensureViews(r.rows), { status, limit: PAGE_SIZE, offset });
      const next = addPage(mine.rows, p.rows);
      // a page that adds nothing (the list moved under it): stop here, the next re-read puts it right
      mine.added += 1; put(next, next.length > offset ? p.total : next.length);
      setError('');
    } catch (e) { if (mine === cur.current) setError((e as Error).message); }
    finally { mine.busy = false; if (mine === cur.current) setBusy(false); }
  };
  useEffect(() => {
    // a new filter starts a new list: the rows on screen stay until its first page arrives
    cur.current = { key, rows: [], total: 0, busy: false, added: 0 }; setBusy(false);
    revRef.current = null; void load(true);
    let last = Date.now();
    const again = () => { last = Date.now(); void load(); };
    const t = setInterval(() => { if (document.visibilityState !== 'hidden' && Date.now() - last >= (liveOpen() ? LIVE_POLL_MS : POLL_MS) - 250) again(); }, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') again(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', again);
    const off = onBuildsUpdated(again); // closes the stream with the last table on the page
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', again); off(); };
  }, [key]);
  return { rows, total, current: loadedFor === key, error, rev, busy, more, reload: () => load(true) };
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
  // the server filters by status and pages; account, model, date and words filter the pages on screen
  const asked = queue ? (f.status || T.MERGE_QUEUE.join(',')) : f.status;
  const { rows, total, current, error, rev, busy: loadingMore, more, reload } = useTableRows(api, wantLanded, asked);
  const all = rows ?? [];
  const opts = useMemo(() => T.filterOptions(all), [rows]);
  // how many builds each status has: exact once the whole unfiltered list is on screen, and for the status asked for
  // (the server's total); until then a count is what the loaded pages hold, marked "+"
  const known = useRef<{ counts: Partial<Record<string, number>>; exact: boolean }>({ counts: {}, exact: false });
  const counts = useMemo(() => {
    const k = known.current;
    if (!rows || !current) return k;
    if (!f.status) { k.counts = { ...opts.counts }; k.exact = all.length >= total; }
    else k.counts = { ...k.counts, [f.status]: total };
    return { ...k };
  }, [rows, total, current, f.status]);
  const countLabel = (s: string) => { const n = counts.counts[s]; return n === undefined ? '' : ` (${n}${counts.exact || s === f.status ? '' : '+'})`; };
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
  // a build asked for that sits on a page not loaded yet: read on until it shows (up to FOCUS_SCAN_ROWS)
  useEffect(() => { if (focusId && rows && current && !error && !listed && !loadingMore && all.length < total && all.length < FOCUS_SCAN_ROWS) void more(); }, [focusId, rows, current, listed, loadingMore, error]);

  // the Builds page toolbar (page-toolbar@1, assets/toolbar/build-orchestrator-pipeline.json) works on the picked row
  const one = shown.find((r) => r.id === picked);
  const statuses = T.BUILD_STATUSES.filter((s) => (counts.counts[s] ?? 0) > 0 || s === f.status);
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

  const statusOpts = (queue ? T.MERGE_QUEUE : T.BUILD_STATUSES).map((s) => ({ value: s, label: `${T.statusLabel(s)}${s === 'split' ? ' (split)' : ''}${countLabel(s)}` }));
  const filtered = Object.entries(f).some(([k, v]) => k !== 'landed' && v);
  const waiting = useMemo(() => waitingToMerge(all).map((r) => r.id), [rows]);
  const cols: GridColumn<TableRow>[] = [
    { id: 'number', label: 'No.', width: 'calc(var(--fx-font-size) * 5)', sortable: true, sortValue: (r) => r.number, render: (r) => <BuildNo n={r.number} /> },
    { id: 'title', label: 'Build', width: phone ? 'calc(var(--fx-font-size) * 20)' : 'minmax(calc(var(--fx-font-size) * 16), calc(var(--fx-font-size) * 26))', fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(),
      render: (r) => (
        <span className="oc-cell-title" title={r.title}>
          <strong>{r.title}</strong>
          {r.emergency && !phone && <EmergencyBadge by={r.emergencyBy} />}
          {phone ? <><span className="st-rowmeta">{r.number && <BuildNo n={r.number} />}{r.emergency && <EmergencyBadge by={r.emergencyBy} />}<StateBadge view={r.view} /><span className="fx-small fx-mono">{r.done}/{r.total}</span><Timer row={r} /><PrLink n={r.prNumber} href={r.pr} /></span><NowLine view={r.view} /></>
            : <span className="fx-small fx-muted fx-mono">{r.id}</span>}
        </span>
      ) },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-font-size) * 9)', sortable: true, sortValue: (r) => T.BUILD_STATUSES.indexOf(r.status), render: (r) => <StateBadge view={r.view} /> },
    { id: 'now', label: 'Doing now', width: 'minmax(calc(var(--fx-font-size) * 12), calc(var(--fx-font-size) * 22))', render: (r) => <NowLine view={r.view} /> },
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
      {error && <div className="pl-note is-warn" role="status"><Icon name="alert" size={14} />{error}</div>}
      <p className="st-live fx-small fx-muted" aria-live="polite"><span className="st-live__dot" aria-hidden="true" />{rows == null ? 'Loading the builds…' : `Live from the builds store${rev != null ? ` · rev ${rev}` : ''} · ${shown.length} shown · ${all.length} of ${total} loaded${queue ? ' · read-only' : ''}`}</p>
      {rows != null && (
        <div className="oc-grid">
          <DataGrid<TableRow> id={queue ? 'orch-merge-queue' : 'orch-status-table'} label={queue ? 'Merge queue' : 'Builds'} groups={groups} columns={cols} rowId={(r) => r.id} rowLabel={(r) => r.title}
            rowTone={(r) => (r.view.fromStore ? r.view.tone : tone(r.status))} selected={picked || (listed ? focusId : undefined)}
            hidden={gridHidden} onToggleColumn={(c, show) => setHidden((h) => toggleIn(h, c, show))} onShowAll={() => setHidden([])}
            sort={sort} onSort={(c) => setSort((s) => nextSort(s, c))}
            expanded={open} onToggleExpand={(id) => setOpen((o) => toggleIn(o, id))}
            onRowClick={(r) => { setPicked(r.id); setOpen((o) => toggleIn(o, r.id)); }}
            rowCtx={(r) => ({ target: 'axf-orchestrator-build', payload: r.id })} rowRef={(r) => ({ kind: 'orchestrator', id: r.id })}
            empty={<div className="fx-empty">{filtered ? 'No builds match these filters.' : queue ? 'Nothing is waiting to merge.' : 'No builds yet. Plan Studio sends them here.'}</div>}
            renderDetail={(r) => <BuildDetail r={r} phone={phone} api={api} canSend={!queue} waiting={waiting} onChanged={() => void reload()} />} key={phone ? 'phone' : 'wide'} />
        </div>
      )}
      {rows != null && <LoadMore shown={all.length} total={total} busy={loadingMore} onMore={() => void more()} />}
    </div>
  );
}

/**
 * The merge line of a build ("2nd to merge, waiting for B-0123") with "Merge together": the lander combines every
 * waiting build into one branch, runs CI once and merges them in one go (a clashing one lands one at a time).
 */
function MergeLineRow({ r, api, waiting, onChanged }: { r: TableRow; api: Api; waiting: string[]; onChanged: () => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const m = r.view.mergeLine;
  if (!m && r.view.state !== 'waiting-to-merge') return null;
  const ids = waiting.includes(r.id) ? waiting : [...waiting, r.id];
  const alone = ids.length < 2;
  const run = async () => {
    setBusy(true);
    try { rt.toast(mergeTogetherLine(await mergeTogether(api, ids), ids.length), 'success', 'Build orchestrator'); onChanged(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Build orchestrator'); } finally { setBusy(false); }
  };
  return (
    <p className="st-merge fx-small" data-merge-line={r.id}>
      <Icon name="branch" size={14} />
      <span className="st-merge__text">{m?.text || 'Waiting to merge'}{m?.waitingFor && <> (<BuildLink id={m.waitingFor}>{m.waitingForTitle || m.waitingFor}</BuildLink>)</>}</span>
      <Button id={`merge-together-${r.id}`} size="sm" icon="branch" disabled={busy || alone} title={alone ? 'Only one build is waiting to merge: there is nothing to combine.' : `Combine the ${ids.length} waiting builds into one branch, run CI once and merge them in one go`} onClick={() => void run()}>Merge together</Button>
      {!alone && <span className="fx-muted">{ids.length} builds are waiting to merge.</span>}
    </p>
  );
}

/**
 * The clash a build carries (build-clash@1). It never blocks: the pipeline answers it itself and carries on, and a
 * conflict with main is fixed by a session. Run all / Defer answer it by hand (POST pipeline/clash-answer, the same call
 * as MCP, the CLI and voice) until a person has answered.
 */
function ClashRow({ r, api, onChanged }: { r: TableRow; api: Api; onChanged: () => void }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState('');
  const c = r.clash;
  if (!c) return null;
  const answer = async (a: 'run-all' | 'defer') => {
    setBusy(a);
    try {
      const res = await api.post<{ ok?: boolean; error?: string; say?: string }>('pipeline/clash-answer', { id: r.id, answer: a });
      if (res.ok === false) throw new Error(res.error || 'The orchestrator refused.');
      rt.toast(res.say || (a === 'defer' ? 'Deferred.' : 'Running all.'), 'success', 'Build orchestrator'); onChanged();
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Build orchestrator'); } finally { setBusy(''); }
  };
  const answered = c.auto ? 'Carrying on by itself: every step runs, and a conflict with main is fixed by a session.' : `Answered${c.answeredBy ? ` by ${c.answeredBy}` : ''}: ${c.answer === 'defer' ? 'the clashing steps wait for that build to land' : 'every step runs'}.`;
  return (
    <div className="st-clash fx-small" data-clash={r.id} data-clash-answer={c.answer || 'none'} role="group" aria-label={`Clash of ${r.title}`}>
      <Icon name="alert" size={14} />
      <span className="st-clash__text">{c.reason} {answered}</span>
      {c.canAnswer && (
        <span className="st-clash__actions" role="toolbar" aria-label={`Answer the clash of ${r.title}`}>
          <Button id={`clash-run-all-${r.id}`} size="sm" icon="play" disabled={!!busy} title={c.runAllLine || 'Every step runs now'} onClick={() => void answer('run-all')}>{c.runAllLabel}</Button>
          <Button id={`clash-defer-${r.id}`} size="sm" icon="clock" disabled={!!busy} title={c.deferLine || 'The clashing steps wait for the build they clash with'} onClick={() => void answer('defer')}>{c.deferLabel}</Button>
        </span>
      )}
    </div>
  );
}

/**
 * An expanded row: the state badge with the plain line, why it waits (with the build holding the active place), its
 * place in the merge line, who split it, what the phone hides, then every step with its own unique id, status, split
 * badge, triage model, account, slot and timer.
 */
function BuildDetail({ r, phone, api, canSend, waiting, onChanged }: { r: TableRow; phone: boolean; api: Api; canSend: boolean; waiting: string[]; onChanged: () => void }) {
  const v = r.view;
  const modelCell = (s: StepRow) => (s.model
    ? <span className={`oc-model is-${s.model.toLowerCase()}`} title={s.modelBy === 'triage' ? `${s.model}: given by the triage gate` : s.modelBy ? `${s.model}: set by ${s.modelBy}` : s.model}>{s.model}</span>
    : <span className="fx-small fx-muted" title="The triage gate gives each step its model in the assigning models state">not assigned yet</span>);
  const cols: GridColumn<StepRow>[] = [
    { id: 'id', label: '#', width: 'calc(var(--fx-font-size) * 3)', render: (s) => <span className="fx-small fx-mono">{s.id}</span> },
    { id: 'uid', label: 'Step ID', width: 'calc(var(--fx-font-size) * 11)', render: (s) => (s.uid ? <span className="st-uid fx-small fx-mono" title={`Unique step id ${s.uid}`}>{s.uid}</span> : <span className="fx-muted" title="No unique id on this step yet">—</span>) },
    { id: 'title', label: 'Step', width: phone ? 'calc(var(--fx-font-size) * 18)' : 'minmax(calc(var(--fx-font-size) * 12), calc(var(--fx-font-size) * 22))', fixed: true,
      render: (s) => (
        <span className="oc-cell-title" title={s.title}>
          <span>{phone ? `${s.id} · ` : ''}{s.title || s.id}</span>
          {phone && <span className="st-rowmeta">{s.uid && <span className="st-uid fx-small fx-mono">{s.uid}</span>}<StatusBadge status={s.status} attempt={s.attempt} />{modelCell(s)}<SplitBadge label={s.split} />{s.account && <span className="fx-small">{s.account}{s.slot ? ` · slot ${s.slot}` : ''}</span>}<StepTimer s={s} /></span>}
        </span>
      ) },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-font-size) * 8)', render: (s) => <StatusBadge status={s.status} attempt={s.attempt} /> },
    { id: 'model', label: 'Triage model', width: 'calc(var(--fx-font-size) * 7.5)', render: modelCell },
    { id: 'split', label: 'Split', width: 'calc(var(--fx-font-size) * 13)', render: (s) => (s.split ? <SplitBadge label={s.split} /> : <span className="fx-muted">—</span>) },
    { id: 'account', label: 'Account', width: 'calc(var(--fx-font-size) * 7)', render: (s) => <span className="fx-small">{dash(s.account)}</span> },
    { id: 'slot', label: 'Slot', width: 'calc(var(--fx-font-size) * 3)', render: (s) => <span className="fx-small fx-mono">{dash(s.slot)}</span> },
    { id: 'timer', label: 'Timer', width: 'calc(var(--fx-font-size) * 6)', align: 'end', render: (s) => <StepTimer s={s} /> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-font-size) * 3.5)', align: 'end', render: (s) => <PrLink n={s.prNumber} href={s.prNumber === r.prNumber ? r.pr : undefined} /> },
  ];
  const rows = r.steps;
  return (
    <div className="oc-detail" data-build-detail={r.id}>
      <div className="st-state" role="status" data-state={v.state}>
        <div className="st-state__head">
          <BuildNo n={r.number} />
          <StateBadge view={v} />
          <SplitBadge label={r.splitLabel} at={r.split?.at} />
          {r.emergency && <EmergencyBadge by={r.emergencyBy} />}
        </div>
        {v.line && <p className="st-state__line">{v.line}</p>}
        {v.waitingOn && (
          <p className="st-wait fx-small" data-waiting-on={v.waitingOn.buildId}>
            <Icon name="clock" size={14} />
            <span>{v.waitingOn.reason}</span>
            {v.waitingOn.buildId && <Button id={`open-holder-${r.id}`} size="sm" tone="quiet" icon="arrow-right" onClick={() => focusBuild(v.waitingOn?.buildId ?? '')}>{`Open ${v.waitingOn.number || v.waitingOn.title || v.waitingOn.buildId}`}</Button>}
          </p>
        )}
        <ClashRow r={r} api={api} onChanged={onChanged} />
        <MergeLineRow r={r} api={api} waiting={waiting} onChanged={onChanged} />
      </div>
      <dl className="st-facts fx-small">
        <dt>Build number</dt><dd className="fx-mono">{dash(r.number)}</dd>
        <dt>Build id</dt><dd className="fx-mono">{r.id}</dd>
        {r.split && <><dt>Split</dt><dd>{r.splitLabel || `by ${r.split.by}`}{r.split.stepCount ? ` · ${r.split.stepCount} step${r.split.stepCount === 1 ? '' : 's'}` : ''}{r.split.at ? ` · ${new Date(r.split.at).toLocaleString()}` : ''}</dd></>}
        {phone && <><dt>Model</dt><dd>{dash(r.model)}</dd><dt>Account</dt><dd>{dash(r.account)}</dd><dt>Slot</dt><dd>{dash(r.slot)}</dd></>}
        <dt>Status by</dt><dd>{dash(r.by)}</dd>
        {r.emergency && <><dt>Emergency</dt><dd>sent by {dash(r.emergencyBy)}</dd></>}
        {r.branch && <><dt>Branch</dt><dd className="fx-mono">{r.branch}</dd></>}
        {r.prNumber > 0 && <><dt>PR</dt><dd><PrLink n={r.prNumber} href={r.pr} /></dd></>}
      </dl>
      {canSend && T.canSendEmergency(r) && <SendToEmergency api={api} id={r.id} onSent={onChanged} />}
      {rows.length ? (
        <div className="oc-subgrid">
          <DataGrid id={`orch-status-steps-${r.id.replace(/[^a-z0-9-]/gi, '-')}`} rowKind="step" label={`Steps of ${r.title}`} compact dataset={false}
            groups={[{ id: 'steps', title: `Steps ${r.done}/${r.total}`, icon: 'list', rows, groups: [], fixed: true }]} columns={cols}
            rowId={(s) => s.id} rowLabel={(s) => s.title} rowTone={(s) => tone(s.status === 'completed' || s.status === 'in-pr' ? 'landed' : s.status)}
            hidden={phone ? PHONE_STEP_HIDDEN : []} />
          {rows.length > 1 && <StepDeps api={api} build={r.id} />}
        </div>
      ) : <p className="fx-small fx-muted">No steps yet: the build is split into steps in its splitting status.</p>}
    </div>
  );
}
