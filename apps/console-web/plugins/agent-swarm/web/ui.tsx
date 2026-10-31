import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridSort } from '@console/axf/libs/datagrid';
import * as consoleApi from '@console/api';
import * as core from './swarm-core.mjs';
import { Avatar, CrewTab } from './cards';
import { CardsTab } from './idcards';
import { ChatTab } from './chat';
import { ChatSettingsTab } from './chat-settings';
import { FOLDER, ModelChip, api, fmtTime, statusText, useSwarm, type Act, type Agent, type AgentState, type Job, type Pay, type Res, type Slot, type Spend, type StatusDef, type SwarmState } from './ui-types';
import './swarm.css';

export { FOLDER };

/*
 * Agent swarm page: a tab group. Jobs = a build split into jobs (agent, model, budget, leases, waves); Cost = the
 * cost meter per agent, build and job. All rules are in swarm-core.mjs; the server reads through swarm.mjs.
 */

const TABS = [{ id: 'crew', label: 'Crew', icon: 'grid' }, { id: 'cards', label: 'ID cards', icon: 'star' }, { id: 'agents', label: 'Agents', icon: 'user' }, { id: 'jobs', label: 'Jobs', icon: 'layers' }, { id: 'cost', label: 'Cost', icon: 'chart' }, { id: 'chat', label: 'Group chat', icon: 'bell' }, { id: 'chat-settings', label: 'Chat settings', icon: 'sliders' }] as const;
type Tab = (typeof TABS)[number]['id'];

export function SwarmPage() {
  const rt = useRuntime();
  const { state, error, load, act } = useSwarm();
  const [tab, setTab] = useState<Tab>(() => consoleApi.readLocal<Tab>('swarm-tab', 'crew'));
  const stats = useMemo(() => (state ? Object.fromEntries(state.roster.agents.map((a) => [a.id, core.agentStats(state.runs, a.id, state.prices)])) : {}), [state]);
  const doAct: Act = async (c) => { const l = await act(c); for (const x of l ?? []) rt.terminal.log('swarm', x, 'ok'); return l; };
  useEffect(() => { consoleApi.writeLocal('swarm-tab', tab); }, [tab]);
  if (!state) return <div className="fx-empty">{error || 'Loading the agent swarm…'}</div>;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Agent swarm · {state.roster.agents.length} agents · {state.meter.total.runs} runs · {core.fmtUsd(state.meter.total.usd)}</p>
          <h1>Agent swarm</h1>
          <p className="fx-muted">Specialist agents run headless, one job each, on the cheapest model that can do it.</p>
        </div>
        <div className="fx-row fx-row--wrap"><Button icon="refresh" onClick={() => load().then(() => rt.terminal.log('swarm', 'reloaded', 'ok'))}>Reload</Button></div>
      </header>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      {state.problems.length > 0 && <div className="pl-note is-warn"><Icon name="alert" size={14} />{state.problems.join(' · ')}</div>}
      <div className="fx-tabs" role="tablist" aria-label="Agent swarm">
        {TABS.map((t) => <button key={t.id} role="tab" className="fx-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}><Icon name={t.icon} size={14} />{t.label}</button>)}
      </div>
      {tab === 'crew' && <CrewTab state={state} stats={stats} act={doAct} onFeed={() => setTab('cost')} />}
      {tab === 'cards' && <CardsTab state={state} stats={stats} act={doAct} photo={(a) => <Avatar a={a} size={120} />} />}
      {tab === 'agents' && <AgentsTab state={state} act={doAct} />}
      {tab === 'jobs' && <JobsTab state={state} />}
      {tab === 'cost' && <CostTab state={state} />}
      {tab === 'chat' && <ChatTab state={state} act={doAct} />}
      {tab === 'chat-settings' && <ChatSettingsTab state={state} act={doAct} />}
    </div>
  );
}

/** One row per agent: status dropdown + note (custom name / works, medical-leave return date). */
const toggleIn = (list: string[], v: string, show?: boolean) => ((show ?? list.includes(v)) ? list.filter((x) => x !== v) : [...list, v]);
/** Click a header: ascending, then descending, then the original order. */
export function sortFor(sort: GridSort, col: string | null): GridSort {
  if (!col) return null;
  return sort?.col === col ? (sort.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 };
}
/** Grid sort, filter and hidden columns, kept on this device per grid. */
function useGridPrefs(key: string, initial: GridSort) {
  const [sort, setSort] = useState<GridSort>(() => consoleApi.readLocal(`swarm-${key}-sort`, initial));
  const [hidden, setHidden] = useState<string[]>(() => consoleApi.readLocal(`swarm-${key}-hidden`, []));
  useEffect(() => { consoleApi.writeLocal(`swarm-${key}-sort`, sort); }, [key, sort]);
  useEffect(() => { consoleApi.writeLocal(`swarm-${key}-hidden`, hidden); }, [key, hidden]);
  return { sort, onSort: (c: string | null) => setSort(sortFor(sort, c)), hidden, onToggleColumn: (c: string, show?: boolean) => setHidden(toggleIn(hidden, c, show)), onShowAll: () => setHidden([]) };
}

const money = (u: { usd: number; tokens: number } | undefined) => (u ? <><b>{core.fmtUsd(u.usd)}</b><br /><span className="fx-muted">{core.fmtTokens(u.tokens)}</span></> : '—');
const W = (n: number) => `calc(var(--fx-space) * ${n})`;
type AgentLine = { a: Agent; as: AgentState; sp: Spend | undefined; pay: Pay | undefined };

function AgentsTab({ state, act }: { state: SwarmState; act: Act }) {
  const notices = state.swarm.notices.slice(-5).reverse();
  const prefs = useGridPrefs('agents', { col: 'name', dir: 1 });
  const [q, setQ] = useState(() => consoleApi.readLocal('swarm-agents-q', ''));
  const [only, setOnly] = useState(() => consoleApi.readLocal('swarm-agents-status', ''));
  useEffect(() => { consoleApi.writeLocal('swarm-agents-q', q); consoleApi.writeLocal('swarm-agents-status', only); }, [q, only]);
  const lines: AgentLine[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.roster.agents.map((a) => ({ a, as: state.swarm.agents[a.id]!, sp: state.spend[a.id], pay: state.pay[a.id] }))
      .filter((l) => (!only || l.as.status === only) && (!needle || `${l.a.name} ${l.a.role} ${l.a.specialty} ${l.as.note}`.toLowerCase().includes(needle)));
  }, [state, q, only]);
  const defs = state.statuses;
  const columns: GridColumn<AgentLine>[] = [
    { id: 'name', label: 'Agent', width: `minmax(${W(10)}, 2fr)`, fixed: true, sortable: true, sortValue: (l) => l.a.name.toLowerCase(), render: (l) => <span><b>{l.a.name}</b><br /><span className="fx-muted">{l.a.role}</span></span> },
    { id: 'status', label: 'Status', width: `minmax(${W(11)}, 2fr)`, sortable: true, sortValue: (l) => statusText(l.as, defs), render: (l) => <StatusCell l={l} defs={defs} pickable={state.pickable} act={act} /> },
    { id: 'note', label: 'Note', width: `minmax(${W(9)}, 2fr)`, sortable: true, sortValue: (l) => l.as.note, render: (l) => <NoteCell l={l} act={act} /> },
    { id: 'all', label: 'All time', width: W(7), align: 'end', sortable: true, sortValue: (l) => l.sp?.all.usd ?? 0, render: (l) => money(l.sp?.all) },
    { id: 'week', label: 'Week', width: W(7), align: 'end', sortable: true, sortValue: (l) => l.sp?.week.usd ?? 0, render: (l) => money(l.sp?.week) },
    { id: 'today', label: 'Today', width: W(7), align: 'end', sortable: true, sortValue: (l) => l.sp?.today.usd ?? 0, render: (l) => money(l.sp?.today) },
    { id: 'avg', label: 'Avg / job', width: W(7), align: 'end', sortable: true, sortValue: (l) => l.sp?.avgPerJob ?? 0, render: (l) => <span>{l.sp?.jobs ? core.fmtUsd(l.sp.avgPerJob) : '—'}<br /><span className="fx-muted">{l.sp?.jobs ?? 0} jobs</span></span> },
    { id: 'salary', label: 'Salary / week', width: W(9), align: 'end', sortable: true, sortValue: (l) => l.pay?.salary ?? l.a.salary, render: (l) => <SalaryCell l={l} act={act} /> },
  ];
  return (
    <div className="fx-stack">
      {notices.length > 0 && <div className="pl-note"><Icon name="bell" size={14} />{notices.map((n) => `${fmtTime(n.at)} ${n.text}`).join(' · ')}</div>}
      <div className="sw-bar">
        <input className="fx-input sw-bar__pick" type="search" aria-label="Filter agents" placeholder="Filter by name, role, specialty, note" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="fx-input sw-bar__pick" aria-label="Only this status" value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="">Every status</option>
          {Object.entries(defs).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
        </select>
        <label className="fx-muted" htmlFor="sw-rq">Rage-quit after</label>
        <input id="sw-rq" className="fx-input sw-num" type="number" min={1} max={50} defaultValue={state.swarm.rules.rageQuitAfter} key={state.swarm.rules.rageQuitAfter} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== state.swarm.rules.rageQuitAfter) void act({ action: 'rules', rageQuitAfter: v }); }} />
        <span className="fx-muted">failed jobs in a row</span>
      </div>
      <div className="sw-scroll">
        <DataGrid<AgentLine> id="agent-swarm-agents" label="Agents" compact
          groups={[{ id: 'all', title: `Agents (${lines.length} of ${state.roster.agents.length})`, icon: 'user', rows: lines, groups: [], fixed: true }]}
          columns={columns} rowId={(l) => l.a.id} rowLabel={(l) => l.a.name} rowTone={(l) => (l.as.status === 'fired' ? 'muted' : TONE_EDGE[defs[l.as.status]?.tone ?? ''] ?? 'muted')}
          {...prefs} empty="No agents match the filter." />
      </div>
      <p className="fx-muted">{Object.values(defs).map((d) => `${d.label}: ${d.about}`).join(' · ')} Salary is the agent's weekly budget: spent it all = broke, no new jobs till payday (Monday) or a top-up. A higher salary is a raise, a lower one docks it.</p>
    </div>
  );
}
const TONE_EDGE: Record<string, string> = { success: 'success', warning: 'warning', danger: 'danger', accent: 'accent' };

function StatusCell({ l: { a, as }, defs, pickable, act }: { l: AgentLine; defs: Record<string, StatusDef>; pickable: string[]; act: Act }) {
  const [pick, setPick] = useState(as.status);
  const [until, setUntil] = useState(as.until.slice(0, 10));
  const [name, setName] = useState(as.custom.name);
  const [works, setWorks] = useState(as.custom.works);
  useEffect(() => { setPick(as.status); setUntil(as.until.slice(0, 10)); setName(as.custom.name); setWorks(as.custom.works); }, [as]);
  const needsMore = pick === 'medical-leave' || pick === 'custom';
  const save = (status = pick) => act({ action: 'status', agent: a.id, status, note: as.note, until: until ? new Date(`${until}T09:00:00`).toISOString() : '', name, works });
  return (
    <div className="sw-bar">
      <select className="fx-input sw-bar__pick" aria-label={`${a.name} status`} value={pick} onChange={(e) => { setPick(e.target.value); if (e.target.value !== 'medical-leave' && e.target.value !== 'custom') void save(e.target.value); }}>
        {Object.entries(defs).map(([k, d]) => <option key={k} value={k} disabled={!pickable.includes(k)}>{k === 'custom' && as.status === 'custom' ? statusText(as, defs) : d.label}</option>)}
      </select>
      {pick === 'medical-leave' && <input className="fx-input sw-bar__pick" type="date" aria-label="Back on" value={until} onChange={(e) => setUntil(e.target.value)} />}
      {pick === 'custom' && <><input className="fx-input sw-bar__pick" aria-label="Status name" placeholder="Name it" value={name} onChange={(e) => setName(e.target.value)} /><label className="fx-checkrow"><input type="checkbox" className="fx-check" checked={works} onChange={(e) => setWorks(e.target.checked)} /><span className="fx-checkrow__label">Gets work</span></label></>}
      {needsMore && <Button size="sm" onClick={() => void save()}>Set</Button>}
    </div>
  );
}
function NoteCell({ l: { a, as }, act }: { l: AgentLine; act: Act }) {
  const [note, setNote] = useState(as.note);
  useEffect(() => { setNote(as.note); }, [as.note]);
  return <input className="fx-input" aria-label={`${a.name} note`} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== as.note) void act({ action: 'note', agent: a.id, note }); }} />;
}
function SalaryCell({ l: { a, pay }, act }: { l: AgentLine; act: Act }) {
  const [salary, setSalary] = useState(String(pay?.salary ?? a.salary));
  useEffect(() => { setSalary(String(pay?.salary ?? a.salary)); }, [pay?.salary, a.salary]);
  const top = Math.max(1, Math.round((pay?.salary || 10) / 2));
  return (
    <span>
      <input className="fx-input sw-num" type="number" min={0} step={1} aria-label={`${a.name} weekly salary in dollars`} value={salary} onChange={(e) => setSalary(e.target.value)} onBlur={() => { if (Number(salary) !== pay?.salary) void act({ action: 'salary', agent: a.id, usd: Number(salary) }); }} />
      <br /><span className={pay?.broke ? 'sw-warn' : 'fx-muted'}>{pay ? (pay.broke ? 'broke' : `${core.fmtUsd(pay.left)} left`) : ''}</span>
      {pay?.broke && <><br /><Button size="sm" onClick={() => void act({ action: 'topup', agent: a.id, usd: top })}>Top up {core.fmtUsd(top)}</Button></>}
    </span>
  );
}

function JobsTab({ state }: { state: SwarmState }) {
  const [build, setBuild] = useState(() => consoleApi.readLocal('swarm-build', state.builds[0]?.id ?? ''));
  const [plan, setPlan] = useState<{ jobs: Job[]; waves: string[][]; warnings: string[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    consoleApi.writeLocal('swarm-build', build); setPlan(null); setErr('');
    if (!build) return;
    api.call<Res<{ plan: { jobs: Job[]; waves: string[][]; warnings: string[] } }>>(`plan/${encodeURIComponent(build)}`).then((r) => (r.ok ? setPlan(r.plan) : setErr(r.error ?? 'failed'))).catch((e) => setErr((e as Error).message));
  }, [build]);
  const agents = new Map(state.roster.agents.map((a) => [a.id, a]));
  const total = plan ? plan.jobs.reduce((t, j) => t + core.budgetUsd(j, state.prices), 0) : 0;
  return (
    <div className="fx-stack">
      <div className="sw-bar">
        <select className="fx-input sw-bar__pick" aria-label="Build" value={build} onChange={(e) => setBuild(e.target.value)}>
          <option value="">Pick a build…</option>
          {state.builds.map((b) => <option key={b.id} value={b.id}>{b.title} ({b.open} open)</option>)}
        </select>
        {plan && <span className="fx-muted">{plan.jobs.length} jobs · {plan.waves.length} waves · budget up to {core.fmtUsd(total)}</span>}
      </div>
      {err && <div className="pl-note is-warn"><Icon name="alert" size={14} />{err}</div>}
      {plan?.warnings.map((w) => <p key={w} className="sw-warn">{w}</p>)}
      {plan && plan.waves.map((w, i) => (
        <div key={i}>
          <p className="sw-wave">Wave {i + 1}{i > 0 ? ' · waits for overlapping jobs' : ' · starts at once'}</p>
          <div className="sw-scroll"><table className="sw-table">
            <thead><tr><th>Step</th><th>Agent</th><th>Model</th><th className="is-num">Budget</th><th>Leases</th></tr></thead>
            <tbody>{w.map((id) => { const j = plan.jobs.find((x) => x.id === id)!; return (
              <tr key={id}>
                <td title={j.text}><b>{j.stepId}</b> {j.text.length > 90 ? `${j.text.slice(0, 87)}…` : j.text}</td>
                <td>{agents.get(j.agent)?.name ?? j.agent}</td>
                <td><ModelChip m={j.model} /></td>
                <td className="is-num">{core.fmtTokens(j.budget.tokens)} · {j.budget.maxTurns} turns · {core.fmtUsd(core.budgetUsd(j, state.prices))}</td>
                <td className="sw-leases fx-mono">{j.leases.join(', ') || 'whole repo (no files named)'}{j.shared.length ? ` · Boss writes: ${j.shared.join(', ')}` : ''}</td>
              </tr>); })}</tbody>
          </table></div>
        </div>
      ))}
    </div>
  );
}

type MeterRow = { k: string; v: Slot };
function MeterTable({ title, rows, label }: { title: string; rows: Record<string, Slot>; label: (k: string) => string }) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const prefs = useGridPrefs(`meter-${id}`, { col: 'usd', dir: -1 });
  const list: MeterRow[] = useMemo(() => Object.entries(rows).map(([k, v]) => ({ k, v })), [rows]);
  if (!list.length) return null;
  const columns: GridColumn<MeterRow>[] = [
    { id: 'name', label: 'Name', width: `minmax(${W(12)}, 3fr)`, fixed: true, sortable: true, sortValue: (r) => label(r.k).toLowerCase(), render: (r) => label(r.k) },
    { id: 'runs', label: 'Runs', width: W(5), align: 'end', sortable: true, sortValue: (r) => r.v.runs, render: (r) => r.v.runs },
    { id: 'tokens', label: 'Tokens', width: W(7), align: 'end', sortable: true, sortValue: (r) => r.v.tokens, render: (r) => core.fmtTokens(r.v.tokens) },
    { id: 'usd', label: 'Dollars', width: W(7), align: 'end', sortable: true, sortValue: (r) => r.v.usd, render: (r) => core.fmtUsd(r.v.usd) },
    { id: 'done', label: 'Done / failed', width: W(8), align: 'end', sortable: true, sortValue: (r) => r.v.failed, render: (r) => `${r.v.done} / ${r.v.failed}` },
  ];
  return (
    <section className="fx-stack">
      <div className="sw-scroll">
        <DataGrid<MeterRow> id={`agent-swarm-${id}`} label={title} compact groups={[{ id: 'all', title, icon: 'chart', rows: list, groups: [], fixed: true }]}
          columns={columns} rowId={(r) => r.k} rowLabel={(r) => label(r.k)} {...prefs} />
      </div>
    </section>
  );
}

function CostTab({ state }: { state: SwarmState }) {
  const m = state.meter; const names = new Map(state.roster.agents.map((a) => [a.id, a.name]));
  const titles = new Map(state.builds.map((b) => [b.id, b.title]));
  return (
    <div className="fx-stack">
      <div className="sw-tiles">
        <div className="sw-tile"><b>{core.fmtUsd(m.total.usd)}</b><span>spent, all runs</span></div>
        <div className="sw-tile"><b>{core.fmtTokens(m.total.tokens)}</b><span>tokens</span></div>
        <div className="sw-tile"><b>{m.total.runs}</b><span>runs ({m.total.done} done)</span></div>
        <div className="sw-tile"><b>{core.fmtUsd(m.total.runs ? m.total.usd / m.total.runs : 0)}</b><span>average per run</span></div>
      </div>
      {m.total.runs === 0 && <div className="fx-empty">No runs yet. Start one with <code>swarm.mjs run &lt;build&gt; &lt;step&gt;</code>.</div>}
      <MeterTable title="By agent" rows={m.byAgent} label={(k) => names.get(k) ?? k} />
      <MeterTable title="By build" rows={m.byBuild} label={(k) => titles.get(k) ?? k} />
      <MeterTable title="By model" rows={m.byModel} label={(k) => core.MODEL_LABEL[k] ?? k} />
      <MeterTable title="By job" rows={m.byJob} label={(k) => k} />
    </div>
  );
}

/** The Builds pages' toolbar (slot builds.toolbar): what the swarm has spent, one tap to its Cost tab. */
export function SwarmCostChip() {
  const rt = useRuntime();
  const { state } = useSwarm();
  if (!state) return null;
  return <Button icon="chart" title="Agent swarm cost meter: tokens and dollars per agent, job and build" onClick={() => { consoleApi.writeLocal('swarm-tab', 'cost'); rt.navigate?.('agent-swarm'); }}>Swarm {core.fmtUsd(state.meter.total.usd)}</Button>;
}
