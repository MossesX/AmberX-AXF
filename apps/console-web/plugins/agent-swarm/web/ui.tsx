import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import * as consoleApi from '@console/api';
import * as core from './swarm-core.mjs';
import { CrewTab } from './cards';
import { ChatTab } from './chat';
import { FOLDER, ModelChip, api, fmtTime, statusText, useSwarm, type Act, type Agent, type AgentState, type Job, type Pay, type Res, type Slot, type Spend, type StatusDef, type SwarmState } from './ui-types';
import './swarm.css';

export { FOLDER };

/*
 * Agent swarm page: a tab group. Jobs = a build split into jobs (agent, model, budget, leases, waves); Cost = the
 * cost meter per agent, build and job. All rules are in swarm-core.mjs; the server reads through swarm.mjs.
 */

const TABS = [{ id: 'crew', label: 'Crew', icon: 'grid' }, { id: 'agents', label: 'Agents', icon: 'user' }, { id: 'jobs', label: 'Jobs', icon: 'layers' }, { id: 'cost', label: 'Cost', icon: 'chart' }, { id: 'chat', label: 'Group chat', icon: 'bell' }] as const;
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
      {tab === 'agents' && <AgentsTab state={state} act={doAct} />}
      {tab === 'jobs' && <JobsTab state={state} />}
      {tab === 'cost' && <CostTab state={state} />}
      {tab === 'chat' && <ChatTab state={state} act={doAct} />}
    </div>
  );
}

/** One row per agent: status dropdown + note (custom name / works, medical-leave return date). */
type SpendSort = 'name' | 'all' | 'week' | 'today' | 'avg';
function AgentsTab({ state, act }: { state: SwarmState; act: Act }) {
  const notices = state.swarm.notices.slice(-5).reverse();
  const [sort, setSort] = useState<SpendSort>(() => consoleApi.readLocal('swarm-agent-sort', 'name'));
  useEffect(() => { consoleApi.writeLocal('swarm-agent-sort', sort); }, [sort]);
  const val = (id: string) => { const s = state.spend[id]; return !s ? 0 : sort === 'avg' ? s.avgPerJob : sort === 'name' ? 0 : s[sort].usd; };
  const agents = [...state.roster.agents].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : val(b.id) - val(a.id)));
  const th = (k: SpendSort, t: string) => <th className="is-num" aria-sort={sort === k ? 'descending' : 'none'}><button onClick={() => setSort(k)}>{t}{sort === k ? ' ↓' : ''}</button></th>;
  return (
    <div className="fx-stack">
      {notices.length > 0 && <div className="pl-note"><Icon name="bell" size={14} />{notices.map((n) => `${fmtTime(n.at)} ${n.text}`).join(' · ')}</div>}
      <div className="sw-bar">
        <label className="fx-muted" htmlFor="sw-rq">Rage-quit after</label>
        <input id="sw-rq" className="fx-input sw-num" type="number" min={1} max={50} defaultValue={state.swarm.rules.rageQuitAfter} key={state.swarm.rules.rageQuitAfter} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== state.swarm.rules.rageQuitAfter) void act({ action: 'rules', rageQuitAfter: v }); }} />
        <span className="fx-muted">failed jobs in a row</span>
      </div>
      <div className="sw-scroll"><table className="sw-table">
        <thead><tr><th aria-sort={sort === 'name' ? 'ascending' : 'none'}><button onClick={() => setSort('name')}>Agent</button></th><th>Status</th><th>Note</th>{th('all', 'All time')}{th('week', 'Week')}{th('today', 'Today')}{th('avg', 'Avg / job')}<th className="is-num">Salary / week</th></tr></thead>
        <tbody>{agents.map((a) => <AgentRow key={a.id} a={a} as={state.swarm.agents[a.id]!} sp={state.spend[a.id]} defs={state.statuses} pickable={state.pickable} pay={state.pay[a.id]} act={act} />)}</tbody>
      </table></div>
      <p className="fx-muted">{Object.values(state.statuses).map((d) => `${d.label}: ${d.about}`).join(' · ')} Salary is the agent's weekly budget: spent it all = broke, no new jobs till payday (Monday) or a top-up. A higher salary is a raise, a lower one docks it.</p>
    </div>
  );
}

const money = (u: { usd: number; tokens: number } | undefined) => (u ? <><b>{core.fmtUsd(u.usd)}</b><br /><span className="fx-muted">{core.fmtTokens(u.tokens)}</span></> : '—');
function AgentRow({ a, as, sp, pay, defs, pickable, act }: { a: Agent; as: AgentState; sp: Spend | undefined; pay: Pay | undefined; defs: Record<string, StatusDef>; pickable: string[]; act: Act }) {
  const [salary, setSalary] = useState(String(pay?.salary ?? a.salary));
  useEffect(() => { setSalary(String(pay?.salary ?? a.salary)); }, [pay?.salary, a.salary]);
  const [pick, setPick] = useState(as.status);
  const [note, setNote] = useState(as.note);
  const [until, setUntil] = useState(as.until.slice(0, 10));
  const [name, setName] = useState(as.custom.name);
  const [works, setWorks] = useState(as.custom.works);
  useEffect(() => { setPick(as.status); setNote(as.note); setUntil(as.until.slice(0, 10)); setName(as.custom.name); setWorks(as.custom.works); }, [as]);
  const needsMore = pick === 'medical-leave' || pick === 'custom';
  const save = (status = pick) => act({ action: 'status', agent: a.id, status, note, until: until ? new Date(`${until}T09:00:00`).toISOString() : '', name, works });
  return (
    <tr className={as.status === 'fired' ? 'sw-gone' : ''}>
      <td><b>{a.name}</b><br /><span className="fx-muted">{a.role}</span></td>
      <td>
        <div className="sw-bar">
          <select className="fx-input sw-bar__pick" aria-label={`${a.name} status`} value={pick} onChange={(e) => { setPick(e.target.value); if (e.target.value !== 'medical-leave' && e.target.value !== 'custom') void save(e.target.value); }}>
            {Object.entries(defs).map(([k, d]) => <option key={k} value={k} disabled={!pickable.includes(k)}>{k === 'custom' && as.status === 'custom' ? statusText(as, defs) : d.label}</option>)}
          </select>
          {pick === 'medical-leave' && <input className="fx-input sw-bar__pick" type="date" aria-label="Back on" value={until} onChange={(e) => setUntil(e.target.value)} />}
          {pick === 'custom' && <><input className="fx-input sw-bar__pick" aria-label="Status name" placeholder="Name it" value={name} onChange={(e) => setName(e.target.value)} /><label className="fx-checkrow"><input type="checkbox" className="fx-check" checked={works} onChange={(e) => setWorks(e.target.checked)} /><span className="fx-checkrow__label">Gets work</span></label></>}
          {needsMore && <Button size="sm" onClick={() => void save()}>Set</Button>}
        </div>
      </td>
      <td><input className="fx-input" aria-label={`${a.name} note`} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== as.note) void act({ action: 'note', agent: a.id, note }); }} /></td>
      <td className="is-num">{money(sp?.all)}</td><td className="is-num">{money(sp?.week)}</td><td className="is-num">{money(sp?.today)}</td>
      <td className="is-num">{sp?.jobs ? core.fmtUsd(sp.avgPerJob) : '—'}<br /><span className="fx-muted">{sp?.jobs ?? 0} jobs</span></td>
      <td className="is-num"><input className="fx-input sw-num" type="number" min={0} step={1} aria-label={`${a.name} weekly salary in dollars`} value={salary} onChange={(e) => setSalary(e.target.value)} onBlur={() => { if (Number(salary) !== pay?.salary) void act({ action: 'salary', agent: a.id, usd: Number(salary) }); }} />
        <br /><span className={pay?.broke ? 'sw-warn' : 'fx-muted'}>{pay ? (pay.broke ? 'broke' : `${core.fmtUsd(pay.left)} left`) : ''}</span>
        {pay?.broke && <><br /><Button size="sm" onClick={() => void act({ action: 'topup', agent: a.id, usd: Math.max(1, Math.round((pay.salary || 10) / 2)) })}>Top up {core.fmtUsd(Math.max(1, Math.round((pay.salary || 10) / 2)))}</Button></>}</td>
    </tr>
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

type SortKey = 'name' | 'runs' | 'tokens' | 'usd';
function MeterTable({ title, rows, label }: { title: string; rows: Record<string, Slot>; label: (k: string) => string }) {
  const [sort, setSort] = useState<SortKey>('usd');
  const list = useMemo(() => Object.entries(rows).sort((a, b) => (sort === 'name' ? label(a[0]).localeCompare(label(b[0])) : b[1][sort] - a[1][sort])), [rows, sort, label]);
  if (!list.length) return null;
  const th = (k: SortKey, t: string, num = true) => <th className={num ? 'is-num' : ''} aria-sort={sort === k ? 'descending' : 'none'}><button onClick={() => setSort(k)}>{t}{sort === k ? ' ↓' : ''}</button></th>;
  return (
    <section className="fx-stack">
      <h2 className="sw-wave">{title}</h2>
      <div className="sw-scroll"><table className="sw-table">
        <thead><tr>{th('name', 'Name', false)}{th('runs', 'Runs')}{th('tokens', 'Tokens')}{th('usd', 'Dollars')}<th className="is-num">Done / failed</th></tr></thead>
        <tbody>{list.map(([k, v]) => <tr key={k}><td>{label(k)}</td><td className="is-num">{v.runs}</td><td className="is-num">{core.fmtTokens(v.tokens)}</td><td className="is-num">{core.fmtUsd(v.usd)}</td><td className="is-num">{v.done} / {v.failed}</td></tr>)}</tbody>
      </table></div>
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
