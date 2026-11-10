/*
 * Build manager: Pending and Complete (Brett, Nov 9 2026: "Build manager will have pending and complete. Orchestrator
 * will have active and queued. They need to be sent to the orchestrator, so they gotta be sent from somewhere.").
 *
 * Pending  = builds not sent yet: add, edit, prioritise (the priority tag), Send to orchestrator (→ its Queued tab).
 * Complete = what the orchestrator sent back when it finished: the account that built it, model, cost, PR, land status.
 * Rows come from GET /api/plugins/build-manager/flow, which reads the one builds store through the orchestrator's
 * capability (axf.build-dispatch@1). Same actions: REST (/flow, /flow/create, /flow/edit, /flow/send), MCP and CLI
 * (plugin commands builds-flow / builds-create / builds-edit / builds-send), voice (the same commands) and the deep
 * links build-manager.pending / build-manager.complete.
 */
import { useEffect, useMemo, useState } from 'react';
import { BuildOrigin, Button, Chip, Icon, Note, PriorityTag, SelectField, Slot, TabGroup, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { CellDates, CellSteps, CellTitle, DataGrid, DetailChecklist, DetailFacts, DetailSections, DetailTimeline, RowHookButtons, spanBetween, type ChecklistItem, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';

export const FLOW_TAB_KEY = 'axp-build-manager:flow-tab';
export const FLOW_TAB_EVENT = 'axf:build-manager-tab';
export type FlowTab = 'pending' | 'complete';
const api = pluginApi('build-manager', 'Build manager', { unavailable: 'The Build manager is switched off or its server part is not running.' });

type Pipe = { route?: string; held?: string; account?: string; model?: string; lastRun?: { at: string; outcome: string; account: string } | null; split?: { provider: string; steps: number } | null } | null;
export type FlowRow = { id: string; title: string; status: string; priority: string; steps: { done: number; total: number; left: number }; minutesLeft: number; nextModel: string; nextStep: string; needsApproval: boolean; needsSplit: boolean;
  pipeline: Pipe; said: string; branch: string; pr: string; createdAt: string; updatedAt: string; builtAt?: string; mergedAt?: string; cost?: number; costEstimated?: boolean; builtBy?: string; accounts?: string[]; models?: string[]; startedAt?: string; stepList?: { id: string; text: string; done: boolean; skip: boolean; model: string; doneAt: string }[]; recent?: { at: string; text: string }[] };
type Flow = { ok: boolean; pending: FlowRow[]; complete: FlowRow[]; counts: { queued: number; active: number } };

const readTab = (): FlowTab => { try { return localStorage.getItem(FLOW_TAB_KEY) === 'complete' ? 'complete' : 'pending'; } catch { return 'pending'; } };
const fmtDate = (v?: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const fmtMin = (m: number) => (!m ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const toggle = (list: readonly string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const nextSort = (cur: GridSort, col: string | null): GridSort => (!col ? null : cur?.col === col ? (cur.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 });
const landed = (r: FlowRow) => r.status === 'complete' || !!r.mergedAt;
const prNumber = (pr: string) => (/(\d+)\s*$/.exec(pr)?.[1] ?? '');

const model = (m?: string) => (m ? <span key={m} className={`oc-model is-${m.toLowerCase()}`}>{m}</span> : null);
const stepItems = (r: FlowRow): ChecklistItem[] => (r.stepList ?? []).map((st) => ({ id: st.id, text: st.text, done: st.done, skip: st.skip, at: st.doneAt, tag: model(st.model) ?? undefined }));
const TITLE_W = 'minmax(calc(var(--fx-font-size) * 16), calc(var(--fx-font-size) * 22))';
/** The sections every expanded row has (Brett's words, steps, latest notes); each tab adds its own first. */
const commonSections = (r: FlowRow) => [
  { id: 'steps', title: 'Steps', icon: 'check-circle', count: `${r.steps.done}/${r.steps.total}`, content: <DetailChecklist items={stepItems(r)} empty="No steps yet: the orchestrator splits it when it is sent." /> },
  { id: 'said', title: 'Brett said', icon: 'mic', content: r.said ? <BuildOrigin origin={{ said: r.said }} showEmpty={false} /> : null },
  { id: 'log', title: 'Latest notes', icon: 'list', count: r.recent?.length || undefined, open: false, content: r.recent?.length ? <DetailTimeline items={r.recent} /> : null },
];

export function FlowView() {
  const rt = useRuntime();
  const [tab, setTab0] = useState<FlowTab>(readTab);
  const setTab = (t: FlowTab) => { setTab0(t); try { localStorage.setItem(FLOW_TAB_KEY, t); } catch { /* private window */ } };
  const [data, setData] = useState<Flow | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const load = async () => {
    try { const r = await api.call<Flow & { error?: string }>('flow'); if (!r.ok) throw new Error(r.error); setData(r); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    void load();
    const on = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (t === 'pending' || t === 'complete') setTab0(t); };
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(tick, 20_000);
    globalThis.addEventListener?.(FLOW_TAB_EVENT, on);
    return () => { window.clearInterval(timer); globalThis.removeEventListener?.(FLOW_TAB_EVENT, on); };
  }, []);
  const post = async (path: string, body: Record<string, unknown>, what: string) => {
    setBusy(String(body.id ?? path));
    try { const r = await api.post<{ ok?: boolean; error?: string; detail?: string }>(path, body); if (r.ok === false) throw new Error(r.error || r.detail); rt.toast(what, 'success'); rt.terminal.log('build-manager', what, 'ok'); await load(); return true; }
    catch (e) { rt.toast((e as Error).message, 'danger'); rt.terminal.log('build-manager', (e as Error).message, 'error'); return false; }
    finally { setBusy(''); }
  };
  const q = query.trim().toLowerCase();
  const hit = (r: FlowRow) => !q || `${r.title} ${r.id} ${r.said} ${r.branch} ${r.pr} ${r.builtBy ?? ''} ${(r.models ?? []).join(' ')}`.toLowerCase().includes(q);
  const pending = useMemo(() => (data?.pending ?? []).filter(hit), [data, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const complete = useMemo(() => (data?.complete ?? []).filter(hit), [data, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalCost = complete.reduce((t, r) => t + (r.cost ?? 0), 0);

  return (
    <div className="fx-page axp-build-manager">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">{data ? `${data.pending.length} pending · ${data.counts.queued} queued and ${data.counts.active} active in the orchestrator · ${data.complete.length} complete` : 'Loading…'}</p>
          <h1>Build manager</h1>
          <p className="fx-muted axp-build-manager__lede">Builds before and after the orchestrator: add and prioritise them in Pending, send them to the orchestrator, and find them in Complete when it sends them back.</p>
        </div>
        <div className="fx-row axp-build-manager__headacts" role="toolbar" aria-label="Build manager">
          <Button icon="layers" onClick={() => rt.dispatch('build-orchestrator.open:queued')} title="Queued and Active builds are in the Build orchestrator">Orchestrator</Button>
          <Button icon="refresh" onClick={() => void load()}>Refresh</Button>
          <Slot name="builds.toolbar" props={{ page: 'build-manager' }} />
        </div>
      </header>
      {error && <Note tone="warning">{error}</Note>}
      <div className="axp-build-manager__search" role="search">
        <Icon name="search" size={14} />
        <input className="fx-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search builds: title, id, Brett's words, branch, PR, account…" aria-label="Search pending and complete builds" />
      </div>
      <TabGroup id="build-manager.flow" label="Build manager" value={tab} onChange={setTab}
        tabs={[{ value: 'pending', label: 'Pending', icon: 'clock', badge: data ? pending.length : undefined }, { value: 'complete', label: 'Complete', icon: 'check-circle', badge: data ? complete.length : undefined }]} />
      {!data ? <div className="fx-empty">{error ? 'The builds could not be read.' : 'Loading the builds…'}</div>
        : tab === 'pending' ? <PendingTab rows={pending} busy={busy} post={post} />
          : <CompleteTab rows={complete} totalCost={totalCost} />}
    </div>
  );
}

type Post = (path: string, body: Record<string, unknown>, what: string) => Promise<boolean>;

function PendingTab({ rows, busy, post }: { rows: FlowRow[]; busy: string; post: Post }) {
  const [open, setOpen] = useState<string[]>([]);
  const [sort, setSort] = useState<GridSort>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  // two-line rows, no timer (Brett, Nov 9 2026: "Pending isn't gonna have a timer. They should have dates ... how many
  // steps, how many completed."): created / updated dates, steps with a meter, the estimate, priority and Send.
  const cols: GridColumn<FlowRow>[] = [
    { id: 'title', label: 'Build', width: TITLE_W, fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(),
      render: (r) => <CellTitle title={r.title} badges={<>{r.needsSplit && <Chip tone="warning">Needs split</Chip>}{r.needsApproval && <Chip tone="warning">Needs approval</Chip>}{r.pipeline?.held && <Chip tone="warning">Held</Chip>}</>}
        sub={[<span key="id" className="fx-mono">{r.id}</span>, r.pipeline?.lastRun ? `last run ${r.pipeline.lastRun.outcome}` : '', r.said ? <span key="said" className="bm-said" title={r.said}>“{r.said}”</span> : '']} /> },
    { id: 'priority', label: 'Priority', width: 'calc(var(--fx-font-size) * 8)', sortable: true, sortValue: (r) => r.priority, render: (r) => <PriorityTag build={r.id} /> },
    { id: 'dates', label: 'Dates', width: 'calc(var(--fx-font-size) * 10)', sortable: true, sortValue: (r) => r.createdAt,
      render: (r) => <CellDates dates={[{ label: 'Created', at: r.createdAt }, { label: 'Updated', at: r.updatedAt !== r.createdAt ? r.updatedAt : '' }]} /> },
    { id: 'steps', label: 'Steps', width: 'calc(var(--fx-font-size) * 12)', sortable: true, sortValue: (r) => r.steps.total, render: (r) => <CellSteps done={r.steps.done} total={r.steps.total} /> },
    { id: 'left', label: 'Estimate', width: 'calc(var(--fx-font-size) * 7)', sortable: true, sortValue: (r) => r.minutesLeft,
      render: (r) => <span className="bm-stack"><span className="fx-small">{fmtMin(r.minutesLeft) || '—'}</span>{r.nextModel && <span className="fx-small fx-muted">{model(r.nextModel)} next</span>}</span> },
    { id: 'send', label: '', width: 'calc(var(--fx-font-size) * 7)', align: 'end',
      render: (r) => <span onClick={(e) => e.stopPropagation()}><Button size="sm" tone="primary" icon="arrow-right" disabled={busy === r.id} title="Send to orchestrator (its Queued tab)" aria-label={`Send ${r.title} to the orchestrator`} onClick={() => void post('flow/send', { id: r.id }, `${r.title} → orchestrator (Queued)`)}>Send</Button></span> },
  ];
  const groups: GridGroup<FlowRow>[] = [{ id: 'pending', title: `Pending (${rows.length})`, icon: 'clock', rows, groups: [], fixed: true }];
  return (
    <div className="fx-stack">
      <AddBuild busy={busy === 'flow/create'} post={post} />
      {rows.length === 0 ? <div className="fx-empty">Nothing pending.</div> : (
        <div className="oc-grid">
          <DataGrid<FlowRow> id="bm-pending" label="Pending builds" groups={groups} columns={cols} rowId={(r) => r.id} rowLabel={(r) => r.title}
            rowTone={(r) => (r.needsSplit ? 'warning' : 'muted')}
            hidden={hidden} onToggleColumn={(c) => setHidden((h) => toggle(h, c))} onShowAll={() => setHidden([])}
            sort={sort} onSort={(c) => setSort((s) => nextSort(s, c))}
            expanded={open} onToggleExpand={(id) => setOpen((o) => toggle(o, id))} onRowClick={(r) => setOpen((o) => toggle(o, r.id))}
            rowCtx={(r) => ({ target: 'axf-orchestrator-build', payload: r.id })} rowRef={(r) => ({ kind: 'orchestrator', id: r.id })}
            tall renderDetail={(r) => <DetailSections label={`${r.title}: details`} sections={[{ id: 'actions', title: 'Actions', icon: 'zap', wide: true, content: <PendingDetail r={r} busy={busy === r.id} post={post} /> }, ...commonSections(r)]} />} />
        </div>
      )}
    </div>
  );
}

function PendingDetail({ r, busy, post }: { r: FlowRow; busy: boolean; post: Post }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(r.title);
  const [detail, setDetail] = useState('');
  return (
    <div className="oc-detail fx-stack">
      {r.nextStep && <p className="fx-small fx-muted">Next: {r.nextStep}</p>}
      {editing ? (
        <div className="fx-stack">
          <TextField label="Title" value={title} onChange={setTitle} />
          <TextField label="Details (empty keeps the current ones)" value={detail} onChange={setDetail} rows={4} />
          <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Save the edit">
            <Button size="sm" tone="primary" icon="save" disabled={busy || !title.trim()} onClick={async () => { if (await post('flow/edit', { id: r.id, title, ...(detail.trim() ? { detail } : {}) }, `${r.id} saved`)) setEditing(false); }}>Save</Button>
            <Button size="sm" tone="neutral" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="fx-row fx-row--wrap" role="toolbar" aria-label={`Actions for ${r.title}`}>
          <Button size="sm" tone="primary" icon="arrow-right" disabled={busy} onClick={() => void post('flow/send', { id: r.id }, `${r.title} → orchestrator (Queued)`)}>Send to orchestrator</Button>
          <Button size="sm" tone="neutral" icon="edit" onClick={() => { setTitle(r.title); setDetail(''); setEditing(true); }}>Edit</Button>
          <PriorityTag build={r.id} />
          <RowHookButtons rowRef={{ kind: 'orchestrator', id: r.id }} />
        </div>
      )}
    </div>
  );
}

function AddBuild({ busy, post }: { busy: boolean; post: Post }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [said, setSaid] = useState('');
  const [priority, setPriority] = useState('');
  return (
    <details className="pd-add">
      <summary>Add a build</summary>
      <div className="fx-stack">
        <TextField label="Title" value={title} onChange={setTitle} placeholder="What to build" required />
        <TextField label="What Brett said (verbatim, optional)" value={said} onChange={setSaid} rows={2} />
        <TextField label="Details" value={detail} onChange={setDetail} rows={3} placeholder="Scope, files touched, acceptance notes" />
        <SelectField label="Priority" value={priority} onChange={setPriority} empty="Normal" options={[{ value: 'P0', label: 'Urgent' }, { value: 'P1', label: 'High' }, { value: 'P3', label: 'Low' }]} />
        <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Add the build">
          <Button tone="primary" icon="plus" disabled={busy || !title.trim()} onClick={async () => { if (await post('flow/create', { title, detail, said, priority }, `Added “${title}” to Pending`)) { setTitle(''); setDetail(''); setSaid(''); setPriority(''); } }}>Add to Pending</Button>
        </div>
      </div>
    </details>
  );
}

function CompleteTab({ rows, totalCost }: { rows: FlowRow[]; totalCost: number }) {
  const [sort, setSort] = useState<GridSort>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  // two-line rows: when it started and finished, how long it took, what it cost, the account that built it, PR / land
  const cols: GridColumn<FlowRow>[] = [
    { id: 'title', label: 'Build', width: TITLE_W, fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(),
      render: (r) => <CellTitle title={r.title} lead={<span className={`bm-land is-${landed(r) ? 'landed' : 'open'}`}><Icon name={landed(r) ? 'check-circle' : 'branch'} size={16} /></span>}
        sub={[<span key="id" className="fx-mono">{r.id}</span>, r.said ? <span key="said" className="bm-said" title={r.said}>“{r.said}”</span> : '']} /> },
    { id: 'land', label: 'PR / land', width: 'calc(var(--fx-font-size) * 9)', sortable: true, sortValue: (r) => (landed(r) ? 1 : 0),
      render: (r) => <span className="bm-stack"><span className={`pd-badge oc-badge is-${landed(r) ? 'complete' : 'built'}`}>{landed(r) ? 'Landed' : 'Awaiting merge'}</span><span className="fx-small fx-mono">{r.pr ? `PR #${prNumber(r.pr) || r.pr}` : 'no PR'}</span></span> },
    { id: 'dates', label: 'Dates', width: 'calc(var(--fx-font-size) * 10)', sortable: true, sortValue: (r) => r.builtAt ?? '',
      render: (r) => <CellDates dates={[{ label: 'Started', at: r.startedAt }, { label: 'Finished', at: r.builtAt }, { label: 'Took', at: '', value: spanBetween(r.startedAt, r.builtAt) || undefined, title: "From the first run's start to finished" }, { label: 'Merged', at: r.mergedAt }]} /> },
    { id: 'steps', label: 'Steps', width: 'calc(var(--fx-font-size) * 11)', sortable: true, sortValue: (r) => r.steps.total, render: (r) => <CellSteps done={r.steps.done} total={r.steps.total} /> },
    { id: 'builtBy', label: 'Built by', width: 'calc(var(--fx-font-size) * 10)', sortable: true, sortValue: (r) => r.builtBy ?? '',
      render: (r) => <span className="bm-stack"><span className="fx-small" title={(r.accounts ?? []).length > 1 ? `Runs on ${(r.accounts ?? []).join(', ')}` : undefined}>{r.builtBy || <span className="fx-muted">—</span>}</span>{r.models?.length ? <span className="fx-row">{r.models.map(model)}</span> : null}</span> },
    { id: 'cost', label: 'Cost', width: 'calc(var(--fx-font-size) * 5)', align: 'end', sortable: true, sortValue: (r) => r.cost ?? 0,
      render: (r) => <span className="fx-small" title={r.costEstimated ? 'Includes estimates' : 'From the headless run records'}>{r.cost ? `${r.costEstimated ? '~' : ''}$${r.cost.toFixed(2)}` : '—'}</span> },
  ];
  const groups: GridGroup<FlowRow>[] = [
    { id: 'awaiting', title: 'Awaiting merge', icon: 'clock', rows: rows.filter((r) => !landed(r)), groups: [], collapsed: collapsed.includes('awaiting') },
    { id: 'landed', title: 'Landed', icon: 'check-circle', rows: rows.filter(landed), groups: [], collapsed: collapsed.includes('landed') },
  ].filter((g) => g.rows.length).map((g) => ({ ...g, title: `${g.title} (${g.rows.length})` }));
  if (!rows.length) return <div className="fx-empty">Nothing complete yet. The orchestrator sends a build here when it finishes.</div>;
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted">{rows.length} builds · ${totalCost.toFixed(2)} in recorded run costs</p>
      <div className="oc-grid">
        <DataGrid<FlowRow> id="bm-complete" label="Complete builds" groups={groups} columns={cols} rowId={(r) => r.id} rowLabel={(r) => r.title}
          rowTone={(r) => (landed(r) ? 'success' : 'accent')}
          hidden={hidden} onToggleColumn={(c) => setHidden((h) => toggle(h, c))} onShowAll={() => setHidden([])}
          sort={sort} onSort={(c) => setSort((s) => nextSort(s, c))} onToggleGroup={(id) => setCollapsed((c) => toggle(c, id))}
          expanded={open} onToggleExpand={(id) => setOpen((o) => toggle(o, id))} onRowClick={(r) => setOpen((o) => toggle(o, r.id))}
          rowCtx={(r) => ({ target: 'axf-orchestrator-build', payload: r.id })} rowRef={(r) => ({ kind: 'orchestrator', id: r.id })}
          tall renderDetail={(r) => (
            <DetailSections label={`${r.title}: details`} sections={[
              { id: 'run', title: 'Run', icon: 'play', content: <DetailFacts facts={[['Branch', r.branch ? <span className="fx-mono">{r.branch}</span> : ''], ['PR', r.pr ? `#${prNumber(r.pr) || r.pr}` : ''], ['Land', landed(r) ? `Landed ${fmtDate(r.mergedAt)}` : 'Awaiting merge'], ['Took', spanBetween(r.startedAt, r.builtAt)], ['Cost', r.cost ? `${r.costEstimated ? '~' : ''}$${r.cost.toFixed(2)}` : ''], ['Accounts', (r.accounts ?? []).join(', ')], ['Models', (r.models ?? []).join(', ')], ['Last run', r.pipeline?.lastRun ? r.pipeline.lastRun.outcome : '']]} /> },
              ...commonSections(r),
              { id: 'actions', title: 'Actions', icon: 'zap', content: <div className="fx-row fx-row--wrap" role="toolbar" aria-label={`Actions for ${r.title}`}><RowHookButtons rowRef={{ kind: 'orchestrator', id: r.id }} /></div> },
            ]} />
          )} />
      </div>
    </div>
  );
}
