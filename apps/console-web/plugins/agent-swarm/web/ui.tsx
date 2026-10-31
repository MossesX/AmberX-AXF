import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import * as core from './swarm-core.mjs';
import './swarm.css';

/*
 * Agent swarm page: a tab group. Jobs = a build split into jobs (agent, model, budget, leases, waves); Cost = the
 * cost meter per agent, build and job. All rules are in swarm-core.mjs; the server reads through swarm.mjs.
 */

export const FOLDER = 'agent-swarm';
export const api = pluginApi(FOLDER, 'Agent swarm', { unavailable: 'The agent swarm is switched off or its server part is not running.' });

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type Agent = { id: string; name: string; role: string; skill: string; specialty: string; models: string[]; tools: string[]; maxTurns: number; tokenBudget: number; salary: number; hiredAt: string; avatar: { face: string; hair: number; gear: string; hue: number }; catchphrase: string; bio: string };
export type Run = { jobId: string; buildId: string; stepId: string; agent: string; model: string; startedAt: string; endedAt: string; status: string; reason: string; usage: Usage | null; reportedCost: number | null; turns: number; budget: { tokens: number; maxTurns: number }; report: { summary: string } | null };
export type Slot = { runs: number; tokens: number; usd: number; done: number; failed: number };
export type Meter = { total: Slot; byAgent: Record<string, Slot>; byJob: Record<string, Slot>; byBuild: Record<string, Slot>; byModel: Record<string, Slot> };
export type SwarmState = { roster: { agents: Agent[] }; skills: Record<string, { id: string; title: string; body: string }>; problems: string[]; runs: Run[]; meter: Meter; prices: Record<string, unknown>; builds: { id: string; title: string; status: string; open: number }[]; tracker: string };
export type Job = { id: string; buildId: string; stepId: string; text: string; estimate: string; agent: string; skill: string; tier: string; model: string; leases: string[]; leaseKind: string; shared: string[]; budget: { tokens: number; maxTurns: number }; wave: number; after: string[] };
type Res<T> = { ok: boolean; error?: string } & T;

export const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
export const ModelChip = ({ m }: { m: string }) => <span className={`sw-model is-${m}`}>{core.MODEL_LABEL[m] ?? m}</span>;

export function useSwarm() {
  const [state, setState] = useState<SwarmState | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try { const r = await api.call<Res<{ state: SwarmState }>>('state'); if (!r.ok) throw new Error(r.error); setState(r.state); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  return { state, error, load, setState };
}

const TABS = [{ id: 'jobs', label: 'Jobs', icon: 'layers' }, { id: 'cost', label: 'Cost', icon: 'chart' }] as const;
type Tab = (typeof TABS)[number]['id'];

export function SwarmPage() {
  const rt = useRuntime();
  const { state, error, load } = useSwarm();
  const [tab, setTab] = useState<Tab>(() => consoleApi.readLocal<Tab>('swarm-tab', 'jobs'));
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
      {tab === 'jobs' && <JobsTab state={state} />}
      {tab === 'cost' && <CostTab state={state} />}
    </div>
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
