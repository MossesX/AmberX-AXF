import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BuildOrigin, Button, Chip, Icon, Note, PriorityTag, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { WatchLiveFor } from '@console/watchLive';
import { CellDates, CellSteps, CellTitle, DataGrid, DetailChecklist, DetailFacts, DetailSections, DetailTimeline, Elapsed, LivePulse, fmtDateTime, type ChecklistItem, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';

/*
 * Pipeline tab (Brett, Nov 8 2026): the three tables of the build pipeline, Pending / Queue / Building, the Claude
 * accounts the dispatcher can use (Fable yes or no, how many run on each), the agent slots and what the dispatcher's
 * next tick starts or why it waits. The orchestrator is the only thing that starts builds (Brett, Nov 9 2026). API jobs:
 * the API overflow switch (off by default) and each build's route (Auto / API / Subscriptions) decide when a build may
 * run on an API-key account; API accounts show their key, caps and room. Every number comes from GET /pipeline (pipeline.mjs status on the VPS), refreshed
 * while the tab is on screen; every action goes through the same CLI under the store lock.
 *
 * Split pages (Brett, Nov 9 2026: "Build manager will have pending and complete. Orchestrator will have active and
 * queued."): the orchestrator shows only what Build Manager sent it. view = queued | active (a DataGrid each: steps,
 * assigned / actual account, model, progress; a row opens its steps and the actions route, assign account, hold /
 * resume, send back to Pending) or accounts (the accounts, slots and dispatcher log). Pending and Complete live in
 * Build Manager; a finished build goes back there.
 */

type Pipeline = { route?: string; held?: string; heldBy?: string; pin?: string; queuedAt: string; queuedBy: string; account: string; session: string; model: string; launchedAt: string; runs: number; note: string; splitRequested: string; split: { at: string; by: string; provider: string; steps: number; note: string } | null; lastRun: { at: string; exit: number | null; outcome: string; stepsLeft: number; account: string } | null } | null;
export type Row = { id: string; title: string; status: string; priority: string; steps: { done: number; total: number; left: number }; minutesLeft: number; nextModel: string; nextStep: string; needsApproval: boolean; needsSplit: boolean; pipeline: Pipeline; said: string; branch: string; pr: string; createdAt: string; updatedAt: string; held?: boolean; builtAt?: string; mergedAt?: string; cost?: number; costEstimated?: boolean; builtBy?: string; accounts?: string[]; models?: string[]; startedAt?: string; stepList?: { id: string; text: string; done: boolean; skip: boolean; model: string; doneAt: string }[]; recent?: { at: string; text: string }[] };
type Account = { name: string; email: string; plan: string; role: string; kind?: string; label?: string; fable: boolean; fableFrom: string; parallel: number; running: number; free: number; usable: boolean; why: string; api?: { usable: boolean; why: string; spend: { day: number; week: number; dayCap: number; weekCap: number; state: string } | null } | null };
type Status = {
  ok: boolean; at: string; table: { pending: Row[]; queued: Row[]; building: Row[]; active: Row[]; complete: Row[] }; accounts: Account[];
  slots: { used: number; cap: number; free: number; queued: number; unavailable: boolean };
  plan: { launches: { id: string; account: string; model: string; phase: string; kind?: string; rule?: string }[]; waits: { id: string; why: string }[]; queue: string[]; idle: { reason: string; kind: string } | null };
  settings: { parallelPerAccount: number; autoQueue: boolean; splitProvider: string; idleAfterMin: number; maxRuns: number; apiOverflow?: boolean };
  state: { at: string; idle: { reason: string; kind: string; since: string } | null; alerts: { key: string; at: string }[]; recent: { at: string; event: string; id: string; account?: string; model?: string; error?: string }[] };
};
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
const REFRESH_MS = 10_000;
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ago = (v: string) => { const ms = Date.now() - new Date(v).getTime(); if (!Number.isFinite(ms)) return ''; const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export type FlowView = 'queued' | 'active' | 'accounts';
export function PipelineTab({ api, log, view, steps }: { api: Api; log: (t: string, l?: 'info' | 'ok' | 'warn' | 'error') => void; view: FlowView; steps?: (id: string) => ReactNode }) {
  const rt = useRuntime();
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const timer = useRef<number | null>(null);
  const load = async () => {
    try { const r = await api.call<Status & { error?: string }>('pipeline'); if (!r.ok) throw new Error(r.error); setS(r); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    void load();
    // one timer, only while the page is on screen (the console's pollers once starved the picture fetches: never per render)
    const tickIt = () => { if (document.visibilityState === 'visible') void load(); };
    timer.current = window.setInterval(tickIt, REFRESH_MS);
    document.addEventListener('visibilitychange', tickIt);
    return () => { if (timer.current) window.clearInterval(timer.current); document.removeEventListener('visibilitychange', tickIt); };
  }, []);
  const act = async (path: string, body: Record<string, unknown>, what: string) => {
    setBusy(String(body.id ?? body.name ?? path));
    try { const r = await api.post<{ ok: boolean; error?: string }>(path, body); if (!r.ok) throw new Error(r.error); log(what, 'ok'); rt.toast(what, 'success'); await load(); }
    catch (e) { log((e as Error).message, 'error'); rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(''); }
  };
  if (!s) return <div className="fx-empty">{error ? `Pipeline: ${error}` : 'Loading the pipeline…'}</div>;
  const waitsFor = (id: string) => s.plan.waits.find((w) => w.id === id)?.why ?? '';
  const launchFor = (id: string) => s.plan.launches.find((l) => l.id === id);
  const idle = s.state.idle ?? s.plan.idle;
  const tickAge = s.state.at ? ago(s.state.at) : '';
  const accountsBlock = (
      <section className="fx-stack">
        <h2 className="pd-card__title">Claude accounts on the VPS <span className="fx-muted fx-small">· the dispatcher sends Fable phases to accounts with Fable, the rest to Opus</span></h2>
        {s.accounts.length === 0 ? <div className="fx-empty">No Claude account is signed in on the VPS.</div> : (
          <div className="pl-cols pl-cols--accounts">
            {s.accounts.map((a) => (
              <article key={a.name} className={`pd-card pl-acct ${a.usable || a.api?.usable ? '' : 'is-off'}`}>
                <div className="pd-card__top">
                  <h3 className="pd-card__title">{a.label || a.name}<span className="fx-muted fx-small"> · {a.kind === 'api' ? 'API key' : a.role}{a.plan ? ` · ${a.plan}` : ''}</span></h3>
                  <span className={`oc-model is-${a.fable ? 'fable' : 'opus'}`} title={`Fable access from the ${a.fableFrom}`}>{a.fable ? 'Fable' : 'Opus only'}</span>
                </div>
                {a.email && <p className="fx-small fx-muted">{a.email}</p>}
                <div className="pd-meta">
                  <span title="Sessions running on this account / its parallel cap"><Icon name="play" size={13} />{a.running}/{a.parallel} running</span>
                  {a.kind === 'api' && a.api?.spend && <span title="Spend today / this week against the caps"><Icon name="chart" size={13} />${a.api.spend.day.toFixed(2)}{a.api.spend.dayCap ? `/${a.api.spend.dayCap}` : ''} today · ${a.api.spend.week.toFixed(2)}{a.api.spend.weekCap ? `/${a.api.spend.weekCap}` : ''} week</span>}
                  {a.kind === 'api' ? (a.api?.usable ? <span title="Takes a build set to API, or overflow when it is on"><Icon name="check" size={13} />ready for API jobs</span> : <span className="oc-flag" title={a.api?.why}><Icon name="alert" size={13} />{a.api?.why}</span>)
                    : !a.usable && <span className="oc-flag" title={a.why}><Icon name="alert" size={13} />{a.why}</span>}
                </div>
                <div className="fx-row fx-row--wrap">
                  <Button size="sm" tone="neutral" icon="zap" disabled={busy === a.name} title={`Fable access is from the ${a.fableFrom}; tap to set it by hand (on, off) or back to auto`} onClick={() => act('pipeline/account', { name: a.name, fable: a.fableFrom === 'override' ? 'auto' : a.fable ? 'off' : 'on' }, `${a.name}: Fable ${a.fableFrom === 'override' ? 'auto' : a.fable ? 'off' : 'on'}`)}>Toggle Fable</Button>
                  <Button size="sm" tone="neutral" icon="minus" disabled={busy === a.name || a.parallel <= 1} onClick={() => act('pipeline/account', { name: a.name, parallel: a.parallel - 1 }, `${a.name}: ${a.parallel - 1} at once`)}>Less parallel</Button>
                  <Button size="sm" tone="neutral" icon="plus" disabled={busy === a.name || a.parallel >= 12} onClick={() => act('pipeline/account', { name: a.name, parallel: a.parallel + 1 }, `${a.name}: ${a.parallel + 1} at once`)}>More parallel</Button>
                  <Button size="sm" tone="neutral" icon={a.why === 'switched off for the pipeline' ? 'check' : 'x'} disabled={busy === a.name} onClick={() => act('pipeline/account', { name: a.name, use: a.why === 'switched off for the pipeline' ? 'on' : 'off' }, `${a.name}: ${a.why === 'switched off for the pipeline' ? 'back in' : 'off'}`)}>Toggle use</Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
  );
  return (
    <div className="fx-stack fx-stack--lg">
      {error && <Note tone="warning">{error}</Note>}
      <div className="pl-strip">
        <span className="pl-stat" title="Agent slots on the VPS (agent-slots@1): sessions running / the cap"><Icon name="layers" size={14} /><b>{s.slots.used}/{s.slots.cap}</b> slots{s.slots.unavailable ? ' (no slots store)' : ''}</span>
        <span className="pl-stat" title="Active: building, waiting for an approval, blocked or failed"><Icon name="play" size={14} /><b>{s.table.active.length}</b> active</span>
        <span className="pl-stat" title="Builds Build Manager sent, waiting in the Queue"><Icon name="list" size={14} /><b>{s.table.queued.length}</b> queued</span>
        <span className="pl-stat fx-muted" title={s.state.at ? `Last dispatcher tick ${fmtTime(s.state.at)}` : 'The dispatcher has not run yet on this VPS'}><Icon name="refresh" size={14} />{s.state.at ? `tick ${tickAge}` : 'no tick yet'}</span>
        {s.settings.autoQueue && <Chip tone="accent">Launch without asking: new builds queue by themselves</Chip>}
        <Switch label="API overflow" text="Every subscription account full or out → an API-key account (billed per token, under its caps)" checked={!!s.settings.apiOverflow} disabled={busy === 'pipeline/settings'} onChange={(on) => act('pipeline/settings', { apiOverflow: on }, `API overflow ${on ? 'on' : 'off'}`)} />
      </div>
      {idle && <Note tone={idle.kind === 'stuck' ? 'warning' : 'info'}>{idle.reason}{(idle as { since?: string }).since ? ` (since ${fmtTime((idle as { since?: string }).since ?? '')})` : ''}</Note>}
      {s.plan.launches.length > 0 && <Note tone="success">Next tick starts {s.plan.launches.map((l) => `${l.id} on ${l.account} (${l.model}${l.phase ? `, ${l.phase}` : ''})`).join(', ')}.</Note>}
      {view === 'accounts' ? accountsBlock : <FlowGrid rows={view === 'queued' ? s.table.queued : s.table.active} view={view} accounts={s.accounts} busy={busy} waitsFor={waitsFor} launchFor={launchFor} act={act} steps={steps} />}
      {view === 'accounts' && s.state.recent.length > 0 && (
        <details className="pd-add"><summary>Dispatcher log ({s.state.recent.length})</summary>
          <div className="fx-stack">{[...s.state.recent].reverse().map((e, i) => <p key={i} className="fx-small fx-mono">{fmtTime(e.at)} · {e.event} {e.id}{e.account ? ` → ${e.account} (${e.model})` : ''}{e.error ? ` · ${e.error}` : ''}</p>)}</div>
        </details>
      )}
    </div>
  );
}

type RouteStep = { to: string; label: string };
const ROUTE_AUTO: RouteStep = { to: 'api', label: 'Auto' };
const ROUTE_NEXT: Record<string, RouteStep> = { '': ROUTE_AUTO, api: { to: 'subscription', label: 'API' }, subscription: { to: 'auto', label: 'Subscriptions' } };
const routeOf = (r?: string): RouteStep => ROUTE_NEXT[r ?? ''] ?? ROUTE_AUTO;

type Launch = { account: string; model: string; phase: string; kind?: string; rule?: string };
type ActFn = (path: string, body: Record<string, unknown>, what: string) => Promise<void>;
const toggle = (list: readonly string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const STATUS_TEXT: Record<string, string> = { queued: 'Queued', running: 'Running', waiting: 'Needs approval', blocked: 'Blocked', failed: 'Failed' };
const TONE: Record<string, string> = { queued: 'muted', running: 'accent', waiting: 'warning', blocked: 'warning', failed: 'danger' };

/** Queued or Active as a DataGrid: one row per build; a row opens its steps and the actions. */
function FlowGrid({ rows, view, accounts, busy, waitsFor, launchFor, act, steps }: { rows: Row[]; view: 'queued' | 'active'; accounts: Account[]; busy: string; waitsFor: (id: string) => string; launchFor: (id: string) => Launch | undefined; act: ActFn; steps?: (id: string) => ReactNode }) {
  const [open, setOpen] = useState<string[]>([]);
  const [sort, setSort] = useState<GridSort>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  // two-line rows (Brett, Nov 9 2026: "it can be a double wide row... make it look good, like a professional website";
  // "The active ones need an animated thing in the row"): Queued says where it is in line, why it waits and what it will
  // run on; Active shows the live pulse, a running timer, steps with a moving meter, the current step and the account.
  const pos = new Map(rows.map((r, i) => [r.id, i + 1]));
  const planned = (r: Row) => { const l = launchFor(r.id); return { account: l?.account || r.pipeline?.pin || '', model: l?.model || r.nextModel, kind: l?.kind === 'api' ? 'API key' : '' }; };
  const titleCol: GridColumn<Row> = { id: 'title', label: 'Build', width: 'minmax(calc(var(--fx-font-size) * 16), calc(var(--fx-font-size) * 22))', fixed: true, sortable: true, sortValue: (r) => (view === 'queued' ? pos.get(r.id) ?? 0 : r.title.toLowerCase()),
    render: (r) => (
      <CellTitle title={r.title}
        lead={view === 'active' ? <LivePulse tone={PULSE[r.status] ?? 'accent'} still={r.status !== 'running' || !!r.held} label={STATUS_TEXT[r.status] ?? r.status} /> : <span className="oc-pos" title="Place in the start order">#{pos.get(r.id)}</span>}
        badges={<><PriorityTag build={r.id} />{view === 'active' && r.status !== 'running' && <span className={`pd-badge oc-badge is-${r.status}`}>{STATUS_TEXT[r.status] ?? r.status}</span>}{r.held && <Chip tone="warning">Held</Chip>}{r.needsSplit && <Chip tone="warning">Needs split</Chip>}</>}
        sub={[<span key="id" className="fx-mono">{r.id}</span>, r.pipeline?.runs ? `run ${r.pipeline.runs}` : '', r.said ? <span key="said" className="oc-said" title={r.said}>“{r.said}”</span> : '']} />
    ) };
  const stepsCol: GridColumn<Row> = { id: 'progress', label: 'Steps', width: 'calc(var(--fx-font-size) * 12)', sortable: true, sortValue: (r) => (r.steps.total ? r.steps.done / r.steps.total : 0),
    render: (r) => <CellSteps done={r.steps.done} total={r.steps.total} active={view === 'active' && r.status === 'running'} current={view === 'active' ? r.nextStep : undefined} /> };
  const cols: GridColumn<Row>[] = view === 'queued' ? [
    titleCol,
    { id: 'dates', label: 'Dates', width: 'calc(var(--fx-font-size) * 10)', sortable: true, sortValue: (r) => r.pipeline?.queuedAt || r.createdAt,
      render: (r) => <CellDates dates={[{ label: 'Created', at: r.createdAt }, { label: 'Queued', at: r.pipeline?.queuedAt }, { label: 'Last run', at: r.pipeline?.lastRun?.at }]} /> },
    stepsCol,
    { id: 'plan', label: 'Planned', width: 'calc(var(--fx-font-size) * 10)', sortable: true, sortValue: (r) => planned(r).account,
      render: (r) => { const p = planned(r); return <span className="oc-stack">{p.model ? <span className={`oc-model is-${p.model.toLowerCase()}`}>{p.model}</span> : <span className="fx-muted">—</span>}<span className="fx-small" title={r.pipeline?.pin ? `Assigned to ${r.pipeline.pin}` : 'The dispatcher picks the account'}>{p.account || <span className="fx-muted">Any account</span>}{p.kind ? ` · ${p.kind}` : ''}</span><span className="fx-small fx-muted">{routeOf(r.pipeline?.route).label}</span></span>; } },
    { id: 'wait', label: 'Why it waits', width: 'minmax(calc(var(--fx-font-size) * 12), calc(var(--fx-font-size) * 16))',
      render: (r) => { const l = launchFor(r.id); const w = waitsFor(r.id); return l ? <span className="oc-why is-next"><Icon name="play" size={13} />Starts next tick on {l.account}</span> : <span className="oc-why">{w || r.pipeline?.note || 'Waiting for the next dispatcher tick'}</span>; } },
  ] : [
    titleCol,
    { id: 'elapsed', label: 'Running for', width: 'calc(var(--fx-font-size) * 10)', sortable: true, sortValue: (r) => r.pipeline?.launchedAt || '',
      render: (r) => <span className="oc-stack">{r.status === 'running' ? <Elapsed since={r.pipeline?.launchedAt} /> : <span className="fx-small fx-muted">{r.pipeline?.lastRun ? `Last run ${r.pipeline.lastRun.outcome}` : 'Not running'}</span>}<span className="fx-small fx-muted" title={fmtDateTime(r.pipeline?.launchedAt)}>{r.pipeline?.launchedAt ? `This run ${fmtDateTime(r.pipeline.launchedAt)}` : ''}</span></span> },
    stepsCol,
    { id: 'account', label: 'Account', width: 'calc(var(--fx-font-size) * 10)', sortable: true, sortValue: (r) => r.pipeline?.account || '',
      render: (r) => { const m = r.pipeline?.model || r.nextModel; return <span className="oc-stack"><span className="fx-small" title={r.pipeline?.session ? `Session ${r.pipeline.session}` : undefined}>{r.pipeline?.account || <span className="fx-muted">—</span>}</span>{m && <span className={`oc-model is-${m.toLowerCase()}`}>{m}</span>}{r.pipeline?.pin && r.pipeline.pin !== r.pipeline.account && <span className="fx-small fx-muted">assigned {r.pipeline.pin}</span>}</span>; } },
    { id: 'dates', label: 'Dates', width: 'calc(var(--fx-font-size) * 10)', sortable: true, sortValue: (r) => r.startedAt || r.createdAt,
      render: (r) => <CellDates dates={[{ label: 'Created', at: r.createdAt }, { label: 'Started', at: r.startedAt }]} /> },
  ];
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const order = view === 'queued' ? ['queued'] : ['running', 'waiting', 'blocked', 'failed'];
  const groups: GridGroup<Row>[] = order.map((st) => {
    const g = rows.filter((r) => r.status === st);
    const done = g.reduce((t, r) => t + r.steps.done, 0); const total = g.reduce((t, r) => t + r.steps.total, 0);
    return { id: `st:${st}`, title: `${STATUS_TEXT[st] ?? st} (${g.length})`, icon: st === 'queued' ? 'list' : st === 'running' ? 'play' : 'alert', rows: g, groups: [], fixed: view === 'queued',
      collapsed: collapsed.includes(`st:${st}`), progress: total ? (done / total) * 100 : undefined, summary: `${done}/${total} steps${g.some((r) => r.held) ? ` · ${g.filter((r) => r.held).length} held` : ''}` };
  }).filter((g) => g.rows.length);
  if (!rows.length) return <div className="fx-empty">{view === 'queued' ? 'Nothing queued. Build Manager → Pending → Send to orchestrator puts a build here.' : 'Nothing active.'}</div>;
  return (
    <div className="fx-stack">
      <div className="pd-sortbar" role="toolbar" aria-label={view === 'queued' ? 'Queued builds' : 'Active builds'}>
        <Button size="sm" tone="neutral" icon={open.length ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen(open.length ? [] : rows.map((r) => r.id))}>{open.length ? 'Collapse all' : 'Expand all'}</Button>
        <span className="fx-small fx-muted">{view === 'queued' ? 'In start order · ' : ''}tap a row for its steps and actions</span>
      </div>
      <div className="oc-grid">
        <DataGrid<Row> id={`orch-${view}`} label={view === 'queued' ? 'Queued builds' : 'Active builds'} groups={groups} columns={cols} onToggleGroup={(id) => setCollapsed((c) => toggle(c, id))} rowId={(r) => r.id} rowLabel={(r) => r.title}
          rowTone={(r) => (r.held ? 'warning' : TONE[r.status] ?? 'muted')}
          hidden={hidden} onToggleColumn={(c) => setHidden((h) => toggle(h, c))} onShowAll={() => setHidden([])}
          sort={sort} onSort={(c) => setSort((cur) => (!c ? null : cur?.col === c ? (cur.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}
          expanded={open} onToggleExpand={(id) => setOpen((o) => toggle(o, id))} onRowClick={(r) => setOpen((o) => toggle(o, r.id))}
          rowCtx={(r) => ({ target: 'axf-orchestrator-build', payload: r.id })} rowRef={(r) => ({ kind: 'orchestrator', id: r.id })}
          tall rowLive={(r) => view === 'active' && r.status === 'running' && !r.held}
          renderDetail={(r) => (
            <DetailSections label={`${r.title}: details`} sections={[
              { id: 'actions', title: 'Actions', icon: 'zap', wide: true, content: <PipelineCard r={r} table={view} busy={busy === r.id} wait={waitsFor(r.id)} launch={launchFor(r.id)} accounts={accounts} act={act} /> },
              { id: 'steps', title: 'Steps', icon: 'check-circle', count: `${r.steps.done}/${r.steps.total}`, wide: true, content: steps?.(r.id) ?? <DetailChecklist items={stepItems(r)} empty="No steps yet: the orchestrator splits it." /> },
              { id: 'said', title: 'Brett said', icon: 'mic', content: r.said ? <BuildOrigin origin={{ said: r.said }} showEmpty={false} /> : null },
              { id: 'run', title: 'Run', icon: 'play', content: <DetailFacts facts={[['Branch', r.branch ? <span className="fx-mono">{r.branch}</span> : ''], ['PR', r.pr ? `#${r.pr}` : ''], ['Runs', r.pipeline?.runs ? String(r.pipeline.runs) : ''], ['Accounts', (r.accounts ?? []).join(', ')], ['Cost so far', r.cost ? `${r.costEstimated ? '~' : ''}$${r.cost.toFixed(2)}` : ''], ['Time left', r.minutesLeft ? `${r.minutesLeft} min` : '']]} /> },
              { id: 'log', title: 'Latest notes', icon: 'list', count: r.recent?.length || undefined, content: r.recent?.length ? <DetailTimeline items={r.recent} /> : null },
            ]} />
          )} />
      </div>
    </div>
  );
}

const PULSE: Record<string, 'accent' | 'warning' | 'danger'> = { running: 'accent', waiting: 'warning', blocked: 'warning', failed: 'danger' };

/** A build's steps for DetailChecklist (the model of each step as its tag). */
const stepItems = (r: Row): ChecklistItem[] => (r.stepList ?? []).map((st) => ({ id: st.id, text: st.text, done: st.done, skip: st.skip, at: st.doneAt, tag: st.model ? <span className={`oc-model is-${st.model.toLowerCase()}`}>{st.model}</span> : undefined }));

function PipelineCard({ r, table, busy, wait, launch, accounts, act }: { r: Row; table: 'queued' | 'active'; busy: boolean; wait: string; launch?: Launch; accounts: Account[]; act: ActFn }) {
  const p = r.pipeline;
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  const running = r.status === 'running';
  return (
    <article className={`pd-card oc-embedded is-${table === 'active' ? 'running' : 'pending'}`} data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={r.id}>
      <div className="pd-card__top">
        <h3 className="pd-card__title">{r.title}<span className="fx-muted fx-small fx-mono"> {r.id}</span></h3>
        <PriorityTag build={r.id} />
      </div>
      {r.said && <p className="fx-small fx-muted">“{r.said}”</p>}
      <div className="pd-meta">
        <span title={r.nextStep}><Icon name="check-circle" size={13} />{r.steps.done}/{r.steps.total} steps</span>
        {r.nextModel && <span className={`oc-model is-${r.nextModel.toLowerCase()}`} title="The model of the next step: a Fable step needs an account with Fable">{r.nextModel} next</span>}
        {r.needsSplit && <span className="pd-split" title="No steps yet, a step over 30 min or one without an estimate: the orchestrator splits it (or tap Split now)"><Icon name="alert" size={13} />needs split</span>}
        {r.needsApproval && <span className="oc-flag"><Icon name="alert" size={13} />needs your upgrade approval</span>}
        {p?.account && table === 'active' && <span title={`Session ${p.session || '(queued in agent slots)'}`}><Icon name="user" size={13} />{p.account} · run {p.runs}{p.model ? ` · ${p.model}` : ''}</span>}
        {p?.launchedAt && table === 'active' && <span className="fx-muted" title={fmtTime(p.launchedAt)}><Icon name="clock" size={13} />{ago(p.launchedAt)}</span>}
        {p?.queuedAt && table === 'queued' && <span className="fx-muted" title={`Queued ${fmtTime(p.queuedAt)} by ${p.queuedBy}`}><Icon name="clock" size={13} />queued {ago(p.queuedAt)}</span>}
        {p?.lastRun && table !== 'active' && <span className="fx-muted" title={`Last run ended ${fmtTime(p.lastRun.at)}`}><Icon name="clock" size={13} />last run: {p.lastRun.outcome}{p.lastRun.exit != null ? ` (exit ${p.lastRun.exit})` : ''}</span>}
        {table === 'active' && <WatchLiveFor branch={r.branch} text={r.id} />}
      </div>
      {launch && <p className="fx-small"><Icon name="play" size={13} /> Next tick: starts on <b>{launch.account}</b> ({launch.model}{launch.phase ? `, ${launch.phase}` : ''}){launch.kind === 'api' ? ` · API key, ${launch.rule === 'override' ? 'set to API' : 'overflow'}` : ''}</p>}
      {!launch && wait && table === 'queued' && <p className="fx-small fx-muted"><Icon name="clock" size={13} /> {wait}</p>}
      {p?.note && <p className="fx-small fx-muted">{p.note}</p>}
      {p?.held && <Note tone="warning">On hold{p.heldBy ? ` (${p.heldBy})` : ''}{running ? ': stops after the current run' : ': the dispatcher skips it until you resume it'}.</Note>}
      {ask ? (
        <div className="fx-stack pd-confirm">
          <TextField label="Why it goes back to Pending (optional)" value={reason} onChange={setReason} />
          <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Confirm send back">
            <Button size="sm" tone="danger" icon="arrow-left" disabled={busy} onClick={() => { setAsk(false); void act('pipeline/return', { id: r.id, reason }, `${r.id} → Build Manager (Pending)`); }}>Send back to Pending</Button>
            <Button size="sm" tone="neutral" onClick={() => setAsk(false)}>Keep it here</Button>
          </div>
        </div>
      ) : (
        <div className="fx-row fx-row--wrap" role="toolbar" aria-label={`Actions for ${r.title}`}>
          <Button size="sm" tone="neutral" icon={p?.held ? 'play' : 'pause'} disabled={busy} title={p?.held ? 'Let the dispatcher start it again' : running ? 'Stop after the current run, then wait' : 'The dispatcher skips it until you resume it'} onClick={() => act('pipeline/hold', { id: r.id, on: !p?.held }, `${r.id}: ${p?.held ? 'resumed' : 'on hold'}`)}>{p?.held ? 'Resume' : 'Hold'}</Button>
          <Button size="sm" tone="neutral" icon="arrow-left" disabled={busy || running} title={running ? 'Running: Hold it first, it can go back when the current run ends' : 'Cancel here and send it back to Build Manager → Pending'} onClick={() => { setReason(''); setAsk(true); }}>Back to Pending</Button>
          {!running && <Button size="sm" tone="neutral" icon="zap" disabled={busy} title="Where this build may run: Auto (subscriptions, API only by overflow), API (API-key accounts only, billed per token) or Subscriptions (never API). Tap to switch." onClick={() => { const n = routeOf(p?.route); void act('pipeline/route', { id: r.id, route: n.to }, `${r.id}: route ${n.to}`); }}>Runs on: {routeOf(p?.route).label}</Button>}
          {!running && <Button size="sm" tone="neutral" icon="edit" disabled={busy || !!p?.splitRequested} title={p?.splitRequested ? 'Split asked for: the dispatcher does it within a minute' : 'Ask the orchestrator to (re)split this build into steps of 30 min or less'} onClick={() => act('pipeline/split', { id: r.id }, `${r.id}: split on the next tick`)}>{p?.splitRequested ? 'Splitting…' : 'Split now'}</Button>}
          <SelectField label="Account" value={p?.pin || ''} disabled={busy} empty="Auto (the dispatcher picks)" options={accounts.map((a) => ({ value: a.name, label: `${a.label || a.name}${a.fable ? ' · Fable' : ''}${a.kind === 'api' ? ' · API' : ''}` }))}
            onChange={(v) => void act('pipeline/assign', { id: r.id, account: v || 'auto' }, `${r.id}: account ${v || 'auto'}`)} />
        </div>
      )}
    </article>
  );
}
