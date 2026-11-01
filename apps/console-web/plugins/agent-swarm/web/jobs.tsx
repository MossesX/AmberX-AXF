import { useEffect, useState } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import * as core from './swarm-core.mjs';
import { ModelChip, api, fmtTime, type Res } from './ui-types';

/*
 * Breakroom → Jobs: recurring job types (job-type@1) and the hired agent who owns each one. One card per job type:
 * owner and status, trigger, last run, next scheduled run, cost; Run (with its inputs, Preview brief first) routes
 * one run to the owner through jobs.mjs; a job type nobody owns shows "Unassigned job" with a one-tap Hire.
 */

export type JobView = {
  id: string; name: string; description: string; specialty: string; model: string; readOnly: boolean; errors: string[];
  trigger: { kind: string; every: string; at: string; event: string };
  budget: { tokens: number; maxTurns: number; usd: number };
  inputs: { id: string; label: string; required: boolean; default: string; about: string }[];
  outputs: { report: string; uiReviewGroup: string };
  owners: { id: string; name: string; status: string }[]; routed: string; routeWhy: string; unassigned: boolean;
  lastRun: { at: string; status: string; agent: string; usd: number; runId: string } | null; next: string; due: boolean;
  cost: { runs: number; usd: number };
};

/** The job types, loaded once per page (finished runs are swept on every read). */
export function useJobs() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try { const r = await api.call<Res<{ jobs: JobView[] }>>('jobs'); if (!r.ok) throw new Error(r.error); setJobs(r.jobs); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  return { jobs, error, load };
}

export const triggerText = (t: JobView['trigger']) => (t.kind === 'schedule' ? (t.every ? `every ${t.every}` : `daily ${t.at} UTC`) : t.kind === 'event' ? `on ${t.event}` : 'on demand');

export function JobTypesTab({ jobs, error, reload, onAgent }: { jobs: JobView[] | null; error: string; reload: () => Promise<void>; onAgent: (id: string) => void }) {
  if (!jobs) return <div className="fx-empty">{error || 'Loading the jobs…'}</div>;
  const total = jobs.reduce((t, j) => t + j.cost.usd, 0); const open = jobs.filter((j) => j.unassigned).length;
  return (
    <div className="fx-stack">
      <p className="fx-muted">{jobs.length} job types · {open ? `${open} unassigned · ` : ''}{core.fmtUsd(total)} spent on jobs. Recurring work goes to the agent who owns it: <code>node framework/cli/agent-job.mjs &lt;job-type&gt;</code>.</p>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <div className="sw-cards" role="list">{jobs.map((j) => <JobCard key={j.id} j={j} reload={reload} onAgent={onAgent} />)}</div>
    </div>
  );
}

function JobCard({ j, reload, onAgent }: { j: JobView; reload: () => Promise<void>; onAgent: (id: string) => void }) {
  const rt = useRuntime();
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [brief, setBrief] = useState('');
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = j.inputs.filter((i) => i.required && !(inputs[i.id] ?? '').trim() && !i.default);
  const post = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    try { return await api.post<Res<Record<string, unknown>>>(path, body); }
    catch (e) { return { ok: false, error: (e as Error).message } as Res<Record<string, unknown>>; }
    finally { setBusy(false); }
  };
  const run = async (dry: boolean) => {
    const r = await post('jobs/run', { jobType: j.id, inputs: Object.fromEntries(Object.entries(inputs).filter(([, v]) => v.trim())), dry });
    if (!r.ok) { setMsg({ text: String(r.why ?? r.error ?? 'failed'), warn: true }); return; }
    if (dry) { setBrief(String((r.brief as { text: string }).text)); setMsg({ text: `Would run as ${String(r.agent)} on ${String(r.model)}, up to ${core.fmtUsd(Number(r.cap))}, session axf-${String(r.session)}.`, warn: false }); return; }
    const run = r.run as { jobId: string; agent: string };
    setMsg({ text: `Started ${run.jobId} (${run.agent}). Watch it in the Terminal.`, warn: false }); setBrief('');
    rt.terminal.log('swarm', `job ${run.jobId} → ${run.agent}`, 'ok'); await reload();
  };
  const hire = async () => {
    const r = await post('jobs/hire', { jobType: j.id });
    if (!r.ok) { setMsg({ text: String(r.error ?? 'failed'), warn: true }); return; }
    const a = r.agent as { name: string }; setMsg({ text: `Hired ${a.name}.`, warn: false }); rt.terminal.log('swarm', `hired ${a.name} for ${j.id}`, 'ok'); await reload();
  };
  return (
    <article role="listitem" className="sw-card sw-job" aria-label={j.name}>
      <div className="sw-job__head">
        <b>{j.name}</b>
        <span className="sw-bar">
          <ModelChip m={j.model} />
          {j.readOnly && <Chip>read-only</Chip>}
          {j.unassigned ? <Chip tone="warning">Unassigned job</Chip> : j.due ? <Chip tone="accent">Due</Chip> : null}
        </span>
      </div>
      <p className="fx-muted sw-job__about">{j.description}</p>
      <dl className="sw-card__stats">
        <div><dt>Owner</dt><dd>{j.owners.length ? j.owners.map((o) => <button key={o.id} type="button" className="fx-btn fx-btn--sm fx-btn--quiet" onClick={() => onAgent(o.id)}>{o.name} · {o.status}</button>) : '—'}</dd></div>
        <div><dt>Trigger</dt><dd>{triggerText(j.trigger)}</dd></div>
        <div><dt>Last run</dt><dd>{j.lastRun ? `${fmtTime(j.lastRun.at)} · ${j.lastRun.status}` : 'never'}</dd></div>
        <div><dt>Next</dt><dd>{j.trigger.kind !== 'schedule' ? '—' : j.due ? 'due now' : fmtTime(j.next)}</dd></div>
        <div><dt>Budget / run</dt><dd>{core.fmtTokens(j.budget.tokens)}{j.budget.usd ? ` · ${core.fmtUsd(j.budget.usd)}` : ''}</dd></div>
        <div><dt>Cost</dt><dd>{j.cost.runs} runs · {core.fmtUsd(j.cost.usd)}</dd></div>
      </dl>
      {j.errors.length > 0 && <p className="sw-warn">{j.errors.join(' · ')}</p>}
      {!j.unassigned && j.routeWhy && <p className="sw-warn">{j.routeWhy}</p>}
      <div className="sw-bar">
        {j.unassigned
          ? <Button icon="plus" disabled={busy} onClick={() => void hire()}>Hire</Button>
          : <Button icon="play" disabled={busy || !!j.routeWhy} onClick={() => setOpen(!open)} aria-expanded={open}>Run</Button>}
      </div>
      {open && !j.unassigned && (
        <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); void run(false); }}>
          {j.inputs.map((i) => (
            <label key={i.id} className="sw-slider">
              <span>{i.label}{i.required ? ' *' : ''}{i.about ? <span className="fx-muted"> · {i.about}</span> : null}</span>
              <input className="fx-input" value={inputs[i.id] ?? ''} placeholder={i.default || (i.required ? 'required' : '')} onChange={(e) => setInputs({ ...inputs, [i.id]: e.target.value })} />
            </label>
          ))}
          <div className="sw-bar">
            <Button type="button" disabled={busy || missing.length > 0} onClick={() => void run(true)}>Preview brief</Button>
            <Button type="submit" tone="primary" disabled={busy || missing.length > 0}>Start</Button>
          </div>
        </form>
      )}
      {msg && <p className={msg.warn ? 'sw-warn' : 'fx-muted'}>{msg.text}</p>}
      {brief && <pre className="sw-skill">{brief}</pre>}
    </article>
  );
}
