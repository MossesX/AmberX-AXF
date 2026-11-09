/**
 * Job routing (build workers-api-routing, Nov 8 2026): which Claude account takes a headless job. Every subscription
 * login is a worker unless stopped, the console's own account takes jobs after them (a switch), 3 build and 5 wait per
 * account, and API-key accounts take only the jobs a rule sends them, under daily / weekly spend caps.
 *
 * One settings panel in categorized collapsible sections (Account status, Workers & limits, API accounts & spend caps,
 * Routing rules, Test a job). How the sections are laid out is a `settings` asset (three ship in ../assets/settings, the
 * UI Review options; the pick is the setting axf.claude-accounts.routing.view). Every change goes to the server, which
 * runs the same router as the launcher (deploy/worker-routing.mjs), so the preview is what a launch would do.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Button, Checkbox, Chip, Container, Meter, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import sections from '../assets/settings/claude-accounts-routing-sections.json';
import statusFirst from '../assets/settings/claude-accounts-routing-status-first.json';
import ruleCards from '../assets/settings/claude-accounts-routing-rule-cards.json';

const FOLDER = 'claude-accounts';
export const VIEW_KEY = 'axf.claude-accounts.routing.view';
export const ROUTING_ASSETS = [sections, statusFirst, ruleCards] as const;
type ViewName = 'sections' | 'status-first' | 'rule-cards';

interface When { jobTypes: string[]; models: string[]; priorities: string[]; profiles: string[]; minSteps: number; maxSteps: number; maxMinutes: number; subs: 'any' | 'busy' }
export interface Rule { id: string; name: string; enabled: boolean; to: 'api' | 'subscription'; accounts: string[]; when: When }
interface ApiCfg { label: string; enabled: boolean; dailyCapUsd: number; weeklyCapUsd: number; alertAt: number }
interface Config { interactiveTakesJobs: boolean; limits: { building: number; queue: number }; api: Record<string, ApiCfg>; rules: Rule[]; excluded: string[] }
interface Spend { day: number; week: number; dayCap: number; weekCap: number; alertAt: number; state: 'ok' | 'warn' | 'capped'; why: string }
export interface RoutingAccount {
  name: string; label: string; kind: 'subscription' | 'api'; role: string; active: boolean; hasKey: boolean; email: string;
  limited: { until: string; kind: string; reason: string } | null; running: string[]; queued: number; building: number; queue: number;
  costToday: number; costWeek: number; spend: Spend | null; why: string;
}
interface Alert { account: string; level: 'warn' | 'error'; kind: string; text: string }
interface Routing { ok: boolean; ready: boolean; why: string; config: Config; accounts: RoutingAccount[]; alerts: Alert[]; fields: { jobTypes: string[]; models: string[]; priorities: string[]; profiles: string[] } }
interface Decision { account: string; label: string; kind: string; state: 'run' | 'queue' | 'none'; ruleName: string; position: number; why: string; considered: { rule: string; name: string; match: boolean; why: string }[] }

const usd = (n: number) => `$${(n ?? 0).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

async function call<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T> {
  const r = await pluginFetch(FOLDER, path, method === 'GET' ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string; message?: string; ok?: boolean };
  if (!r.ok || j.ok === false) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
  return j;
}

/* ---------------- one shared poll ---------------- */

let shared: Routing | null = null;
const subs = new Set<(r: Routing | null) => void>();
const publish = (r: Routing | null) => { shared = r; for (const s of subs) s(r); };
export const loadRouting = () => call<Routing>('routing').then(publish);

function useRouting() {
  const [data, setData] = useState<Routing | null>(shared);
  const [error, setError] = useState('');
  const refresh = useCallback(() => loadRouting().then(() => setError(''), (e: Error) => setError(e.message)), []);
  useEffect(() => { subs.add(setData); void refresh(); return () => { subs.delete(setData); }; }, [refresh]);
  return { data, error, refresh };
}

/** The API-key accounts set up in Job routing ({name, label, enabled}), live: for pickers in other plugins (axf.job-routing@1). */
export function useApiAccounts(): { name: string; label: string; enabled: boolean }[] {
  const { data } = useRouting();
  return Object.entries(data?.config.api ?? {}).map(([name, c]) => ({ name, label: c.label || name, enabled: c.enabled }));
}

function useSaid() {
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (p: Promise<{ message?: string } | unknown>) => {
    setBusy(true); setSaid(null);
    return p.then((r) => { setSaid({ text: (r as { message?: string })?.message || 'Saved.', bad: false }); return loadRouting(); }, (e: Error) => setSaid({ text: e.message, bad: true })).finally(() => setBusy(false));
  };
  return { said, busy, run, note: said ? <Note tone={said.bad ? 'danger' : 'info'}>{said.text}</Note> : null };
}

function useView(): ViewName {
  const rt = useRuntime();
  const id = useSyncExternalStore((fn) => rt.settings.subscribe(fn), () => String(rt.settings.get(VIEW_KEY) ?? ''), () => '');
  const asset = ROUTING_ASSETS.find((a) => a.id === id) ?? sections;
  return asset.data.view as ViewName;
}

/* ---------------- account status ---------------- */

const ROLE_LABEL: Record<string, string> = { interactive: 'Console', worker: 'Worker', saved: 'Stopped', 'api-worker': 'API', 'api-off': 'API · off' };

function SpendMeter({ s }: { s: Spend }) {
  const parts = [s.dayCap ? { label: `${usd(s.day)} of ${usd(s.dayCap)} today`, v: (s.day / s.dayCap) * 100 } : null, s.weekCap ? { label: `${usd(s.week)} of ${usd(s.weekCap)} this week`, v: (s.week / s.weekCap) * 100 } : null].filter(Boolean) as { label: string; v: number }[];
  if (!parts.length) return <p className="axp-ca-row__sub">No spend cap</p>;
  return <div className="axp-ca-spend">{parts.map((p) => <Meter key={p.label} value={p.v} small label={p.label} />)}<p className="axp-ca-row__sub">{parts.map((p) => p.label).join(' · ')}</p></div>;
}

export function StatusRow({ a }: { a: RoutingAccount }) {
  const tone = a.role === 'interactive' ? 'success' : a.role === 'worker' || a.role === 'api-worker' ? 'accent' : undefined;
  return (
    <div className="axp-ca-row" data-account={a.name}>
      <div className="axp-ca-row__who">
        <b>{a.label || a.name}</b>{a.label && <span className="axp-ca-row__sub"> · {a.name}</span>}
        <p className="axp-ca-row__sub">{[`${a.running.length}/${a.building} running`, `${a.queued}/${a.queue} waiting`, `${usd(a.costToday)} today`, `${usd(a.costWeek)} this week`].join(' · ')}</p>
        {a.spend && <SpendMeter s={a.spend} />}
        {a.why && !a.limited && <p className="axp-ca-row__sub">{a.why}</p>}
      </div>
      <div className="axp-ca-row__actions">
        <Chip tone={tone}>{ROLE_LABEL[a.role] ?? a.role}</Chip>
        {a.kind === 'api' && !a.hasKey && <Chip tone="warning">No key</Chip>}
        {a.limited && <Chip tone="warning">Out until {when(a.limited.until)}</Chip>}
        {a.spend && a.spend.state !== 'ok' && <Chip tone={a.spend.state === 'capped' ? 'danger' : 'warning'}>{a.spend.state === 'capped' ? 'Capped' : 'Near cap'}</Chip>}
      </div>
    </div>
  );
}

function StatusTable({ data }: { data: Routing }) {
  return (
    <div className="fx-stack">
      {data.alerts.map((a) => <Note key={`${a.account}-${a.kind}`} tone={a.level === 'error' ? 'danger' : 'warning'}>{a.text}</Note>)}
      <div>{data.accounts.map((a) => <StatusRow key={a.name} a={a} />)}</div>
    </div>
  );
}

/* ---------------- workers & limits ---------------- */

function WorkersLimits({ data }: { data: Routing }) {
  const c = data.config;
  const [building, setBuilding] = useState(String(c.limits.building));
  const [queue, setQueue] = useState(String(c.limits.queue));
  const s = useSaid();
  useEffect(() => { setBuilding(String(c.limits.building)); setQueue(String(c.limits.queue)); }, [c.limits.building, c.limits.queue]);
  const subsRows = data.accounts.filter((a) => a.kind === 'subscription');
  return (
    <div className="fx-stack">
      <p className="axp-ca-help">Every saved subscription login takes headless jobs unless you stop it on its row. Jobs go to the least busy worker; when all are full they wait in an account's queue.</p>
      <Switch label="Console account takes headless jobs" hint="After the workers are busy. Off = the console's account only runs what you start in it." checked={c.interactiveTakesJobs} disabled={s.busy}
        onChange={(v) => void s.run(call('routing/settings', 'POST', { interactiveTakesJobs: v }))} />
      <div className="axp-ca-save">
        <TextField label="Jobs building at once, per account" value={building} hint="Default 3." onChange={setBuilding} />
        <TextField label="Jobs waiting, per account" value={queue} hint="Default 5." onChange={setQueue} />
        <Button tone="primary" icon="save" busy={s.busy} disabled={s.busy} onClick={() => void s.run(call('routing/settings', 'POST', { building: num(building), queue: num(queue) }))}>Save limits</Button>
      </div>
      <div>{subsRows.map((a) => (
        <div key={a.name} className="axp-ca-row">
          <div className="axp-ca-row__who"><b>{a.label || a.name}</b><p className="axp-ca-row__sub">{a.email || a.name} · {ROLE_LABEL[a.role] ?? a.role}</p></div>
          <div className="axp-ca-row__actions">
            {!a.active && <Switch label="Takes jobs" checked={a.role === 'worker'} disabled={s.busy} onChange={(v) => void s.run(call('role', 'POST', { name: a.name, role: v ? 'worker' : 'saved' }))} />}
            {a.active && <Chip tone="success">Console account</Chip>}
          </div>
        </div>
      ))}</div>
      {s.note}
    </div>
  );
}

/* ---------------- API accounts & spend caps ---------------- */

function ApiRow({ name, cfg, acc }: { name: string; cfg: ApiCfg; acc?: RoutingAccount }) {
  const [daily, setDaily] = useState(String(cfg.dailyCapUsd));
  const [weekly, setWeekly] = useState(String(cfg.weeklyCapUsd));
  const [alertAt, setAlertAt] = useState(String(Math.round(cfg.alertAt * 100)));
  const s = useSaid();
  return (
    <div className="axp-ca-row" data-api={name}>
      <div className="axp-ca-row__who">
        <b>{cfg.label || name}</b><span className="axp-ca-row__sub"> · {name}</span>
        {acc?.spend ? <SpendMeter s={acc.spend} /> : null}
        {acc && !acc.hasKey && <p className="axp-ca-row__sub">No key saved yet: Terminal → VPS host → <code>claude-account savekey {name}</code>, paste the key at the hidden prompt.</p>}
        <div className="axp-ca-save">
          <TextField label="Daily cap (USD)" value={daily} onChange={setDaily} />
          <TextField label="Weekly cap (USD)" value={weekly} onChange={setWeekly} />
          <TextField label="Alert at (% of a cap)" value={alertAt} onChange={setAlertAt} />
          <Button icon="save" busy={s.busy} disabled={s.busy} onClick={() => void s.run(call('routing/api', 'POST', { op: 'caps', name, dailyCapUsd: num(daily), weeklyCapUsd: num(weekly), alertAt: num(alertAt) / 100 }))}>Save caps</Button>
        </div>
        {s.note}
      </div>
      <div className="axp-ca-row__actions">
        <Switch label="Takes jobs" checked={cfg.enabled} disabled={s.busy} onChange={(v) => void s.run(call('routing/api', 'POST', { op: v ? 'enable' : 'disable', name }))} />
        <Button tone="danger" icon="trash" busy={s.busy} confirm={`Stop using ${cfg.label || name} for jobs? The key stays saved on the VPS.`} onClick={() => void s.run(call('routing/api', 'POST', { op: 'remove', name }))}>Remove</Button>
      </div>
    </div>
  );
}

function ApiAccounts({ data }: { data: Routing }) {
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [daily, setDaily] = useState('10');
  const [weekly, setWeekly] = useState('50');
  const s = useSaid();
  const entries = Object.entries(data.config.api);
  return (
    <div className="fx-stack">
      <p className="axp-ca-help">API keys bill per token, so they only take jobs a routing rule sends them, and nothing once a daily or weekly cap is reached (the last 24 h / 7 days). An alert goes up at the alert level. Only your own click in the console raises a cap; a session can lower one.</p>
      {!entries.length && <p className="axp-ca-help">No API accounts set up.</p>}
      <div>{entries.map(([n, cfg]) => <ApiRow key={n} name={n} cfg={cfg} acc={data.accounts.find((a) => a.name === n)} />)}</div>
      <Container title="Add an API account" icon="plus" collapsible defaultOpen={false}>
        <div className="axp-ca-save">
          <TextField label="Name on the VPS" value={name} hint="Its folder in ~/.claude-accounts, e.g. hulu-api." onChange={(v) => setName(v.trim().toLowerCase())} />
          <TextField label="Shown as" value={label} onChange={setLabel} />
          <TextField label="Daily cap (USD)" value={daily} onChange={setDaily} />
          <TextField label="Weekly cap (USD)" value={weekly} onChange={setWeekly} />
          <Button tone="primary" icon="plus" busy={s.busy} disabled={s.busy || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)} onClick={() => void s.run(call('routing/api', 'POST', { op: 'add', name, label: label || name, dailyCapUsd: num(daily), weeklyCapUsd: num(weekly) }))}>Add</Button>
        </div>
      </Container>
      {s.note}
    </div>
  );
}

/* ---------------- rules ---------------- */

export function ruleSentence(r: Rule): string {
  const w = r.when; const parts: string[] = [];
  if (w.jobTypes.length) parts.push(`job type is ${w.jobTypes.join(' or ')}`);
  if (w.models.length) parts.push(`model is ${w.models.join(' or ')}`);
  if (w.priorities.length) parts.push(`priority is ${w.priorities.join(' or ')}`);
  if (w.profiles.length) parts.push(`profile is ${w.profiles.join(' or ')}`);
  if (w.minSteps) parts.push(`at least ${w.minSteps} steps left`);
  if (w.maxSteps) parts.push(`at most ${w.maxSteps} steps left`);
  if (w.maxMinutes) parts.push(`at most ${w.maxMinutes} min left`);
  if (w.subs === 'busy') parts.push('no subscription account can start it now');
  const to = r.to === 'api' ? `send it to ${r.accounts.length ? r.accounts.join(' or ') : 'an API account'}` : 'keep it on subscriptions';
  return `${parts.length ? `When ${parts.join(' and ')}` : 'Every job'}: ${to}.`;
}

const EMPTY: Rule = { id: '', name: '', enabled: true, to: 'api', accounts: [], when: { jobTypes: [], models: [], priorities: [], profiles: [], minSteps: 0, maxSteps: 0, maxMinutes: 0, subs: 'any' } };

function RuleForm({ rule, data, onDone }: { rule: Rule; data: Routing; onDone: () => void }) {
  const [r, setR] = useState<Rule>(rule);
  const s = useSaid();
  const w = r.when;
  const setW = (p: Partial<When>) => setR({ ...r, when: { ...w, ...p } });
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const save = () => void s.run(rule.id ? call('routing/rule', 'POST', { op: 'update', id: rule.id, rule: r }) : call('routing/rule', 'POST', { op: 'add', rule: r })).then(onDone);
  return (
    <div className="fx-stack axp-ca-rule-form">
      <div className="axp-ca-save">
        <TextField label="Rule name" value={r.name} onChange={(v) => setR({ ...r, name: v })} />
        <SelectField label="Send matching jobs to" value={r.to} options={[{ value: 'api', label: 'An API account' }, { value: 'subscription', label: 'Subscriptions only' }]} onChange={(v) => setR({ ...r, to: v as Rule['to'] })} />
        {r.to === 'api' && <TextField label="API accounts (empty = any)" value={r.accounts.join(', ')} hint={Object.keys(data.config.api).join(', ') || 'none set up yet'} onChange={(v) => setR({ ...r, accounts: list(v) })} />}
      </div>
      <div className="axp-ca-checks" role="group" aria-label="Job types">
        <span className="axp-ca-row__sub">Job type</span>
        {data.fields.jobTypes.map((t) => <Checkbox key={t} label={t} checked={w.jobTypes.includes(t)} onChange={() => setW({ jobTypes: toggle(w.jobTypes, t) })} />)}
      </div>
      <div className="axp-ca-checks" role="group" aria-label="Models">
        <span className="axp-ca-row__sub">Model</span>
        {data.fields.models.map((m) => <Checkbox key={m} label={m} checked={w.models.includes(m)} onChange={() => setW({ models: toggle(w.models, m) })} />)}
        <span className="axp-ca-row__sub">Priority</span>
        {data.fields.priorities.map((p) => <Checkbox key={p} label={p} checked={w.priorities.includes(p)} onChange={() => setW({ priorities: toggle(w.priorities, p) })} />)}
      </div>
      <div className="axp-ca-save">
        <TextField label="Profiles (empty = any)" value={w.profiles.join(', ')} onChange={(v) => setW({ profiles: list(v) })} />
        <TextField label="Steps left, at least" value={String(w.minSteps || '')} onChange={(v) => setW({ minSteps: num(v) })} />
        <TextField label="Steps left, at most" value={String(w.maxSteps || '')} onChange={(v) => setW({ maxSteps: num(v) })} />
        <TextField label="Minutes left, at most" value={String(w.maxMinutes || '')} onChange={(v) => setW({ maxMinutes: num(v) })} />
      </div>
      <Switch label="Only when subscriptions are full or limited" hint="The fallback: the rule applies only while no subscription account can start the job." checked={w.subs === 'busy'} onChange={(v) => setW({ subs: v ? 'busy' : 'any' })} />
      <p className="axp-ca-help">{ruleSentence(r)}</p>
      <div className="axp-ca-row__actions">
        <Button tone="primary" icon="save" busy={s.busy} disabled={s.busy || !r.name.trim()} onClick={save}>{rule.id ? 'Save rule' : 'Add rule'}</Button>
        <Button tone="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {s.note}
    </div>
  );
}

function RuleRow({ r, i, n, data, cards }: { r: Rule; i: number; n: number; data: Routing; cards: boolean }) {
  const [editing, setEditing] = useState(false);
  const s = useSaid();
  const op = (body: Record<string, unknown>) => void s.run(call('routing/rule', 'POST', { id: r.id, ...body }));
  if (editing) return <RuleForm rule={r} data={data} onDone={() => setEditing(false)} />;
  const body = (
    <>
      <div className="axp-ca-row__who">
        <b>{i + 1}. {r.name}</b>
        <p className="axp-ca-row__sub">{ruleSentence(r)}</p>
      </div>
      <div className="axp-ca-row__actions">
        <Switch label="On" checked={r.enabled} disabled={s.busy} onChange={(v) => op({ op: v ? 'enable' : 'disable' })} />
        <Button size="sm" icon="chevron-up" disabled={s.busy || i === 0} onClick={() => op({ op: 'move', to: 'up' })}>Up</Button>
        <Button size="sm" icon="chevron-down" disabled={s.busy || i === n - 1} onClick={() => op({ op: 'move', to: 'down' })}>Down</Button>
        <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" tone="danger" icon="trash" confirm={`Delete the rule "${r.name}"?`} onClick={() => op({ op: 'remove' })}>Delete</Button>
      </div>
      {s.note}
    </>
  );
  return cards ? <Container className="axp-ca-rule-card" title={r.enabled ? r.to === 'api' ? 'To an API account' : 'Subscriptions only' : 'Switched off'} icon={r.to === 'api' ? 'key' : 'user'}>{body}</Container>
    : <div className={`axp-ca-row${r.enabled ? '' : ' axp-ca-row--off'}`} data-rule={r.id}>{body}</div>;
}

function Rules({ data, cards }: { data: Routing; cards: boolean }) {
  const [adding, setAdding] = useState(false);
  const rules = data.config.rules;
  return (
    <div className="fx-stack">
      <p className="axp-ca-help">The first switched-on rule that matches a job decides. No rule matches = the job stays on the subscriptions. An API account that is capped, off or full passes the job back to the subscriptions.</p>
      {!rules.length && <p className="axp-ca-help">No rules yet: API accounts take no jobs.</p>}
      <div className={cards ? 'axp-ca-cards' : ''}>{rules.map((r, i) => <RuleRow key={r.id} r={r} i={i} n={rules.length} data={data} cards={cards} />)}</div>
      {adding ? <RuleForm rule={EMPTY} data={data} onDone={() => setAdding(false)} /> : <div><Button icon="plus" onClick={() => setAdding(true)}>Add a rule</Button></div>}
    </div>
  );
}

/* ---------------- test a job ---------------- */

function TestJob({ data }: { data: Routing }) {
  const [job, setJob] = useState({ jobType: 'build', model: 'opus', priority: 'P2', profile: 'all', steps: '3', minutes: '60' });
  const [d, setD] = useState<Decision | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = () => {
    setBusy(true); setErr('');
    call<Decision>('routing/test', 'POST', { job: { ...job, steps: num(job.steps), minutes: num(job.minutes) } }).then(setD, (e: Error) => setErr(e.message)).finally(() => setBusy(false));
  };
  const opt = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));
  return (
    <div className="fx-stack">
      <div className="axp-ca-save">
        <SelectField label="Job type" value={job.jobType} options={opt(data.fields.jobTypes)} onChange={(v) => setJob({ ...job, jobType: v })} />
        <SelectField label="Model" value={job.model} options={opt(data.fields.models)} onChange={(v) => setJob({ ...job, model: v })} />
        <SelectField label="Priority" value={job.priority} options={opt(data.fields.priorities)} onChange={(v) => setJob({ ...job, priority: v })} />
        <TextField label="Profile" value={job.profile} onChange={(v) => setJob({ ...job, profile: v })} />
        <TextField label="Steps left" value={job.steps} onChange={(v) => setJob({ ...job, steps: v })} />
        <TextField label="Minutes left" value={job.minutes} onChange={(v) => setJob({ ...job, minutes: v })} />
        <Button tone="primary" icon="play" busy={busy} disabled={busy} onClick={go}>Test</Button>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {d && (
        <Note tone={d.state === 'none' ? 'warning' : 'info'}>
          <b>{d.state === 'run' ? `Runs on ${d.label || d.account} (${d.kind === 'api' ? 'API, billed per token' : 'subscription'})` : d.state === 'queue' ? `Waits for ${d.label || d.account} (position ${d.position})` : 'No account can take it'}</b>
          <span>{` · ${d.why}`}</span>
          {d.considered.length > 0 && <ul className="axp-ca-considered">{d.considered.map((c) => <li key={c.rule}>{c.match ? '✓' : '·'} {c.name}: {c.why}</li>)}</ul>}
        </Note>
      )}
    </div>
  );
}

/* ---------------- the panel ---------------- */

const SECTION_ICON: Record<string, string> = { status: 'chart', workers: 'user', api: 'key', rules: 'list', test: 'play' };
const SECTION_TITLE: Record<string, string> = { status: 'Account status', workers: 'Workers & limits', api: 'API accounts & spend caps', rules: 'Routing rules', test: 'Test a job' };

/** Section keys of the Job routing panel; `only` (e.g. the Build orchestrator's settings, through axf.job-routing@1) shows a subset. */
export type RoutingSection = 'status' | 'workers' | 'api' | 'rules' | 'test';

export function JobRouting({ only }: { only?: RoutingSection[] } = {}) {
  const { data, error, refresh } = useRouting();
  const rt = useRuntime();
  const view = useView();
  const asset = ROUTING_ASSETS.find((a) => a.data.view === view) ?? sections;
  if (error) return <Note tone="danger">Job routing unavailable: {error}</Note>;
  if (!data) return <p className="axp-ca-help">Reading job routing…</p>;
  const body: Record<string, ReactNode> = {
    status: <StatusTable data={data} />, workers: <WorkersLimits data={data} />, api: <ApiAccounts data={data} />,
    rules: <Rules data={data} cards={view === 'rule-cards'} />, test: <TestJob data={data} />,
  };
  const order = (asset.data.order as string[]).filter((k) => !only || only.includes(k as RoutingSection));
  const open = new Set<string>(only ? order : asset.data.open);
  return (
    <div className="fx-stack" data-axf-routing-view={view}>
      {!data.ready && <Note tone="warning">Can't read the VPS host: {data.why}</Note>}
      <div className="axp-ca-save">
        <SelectField label="Layout" value={asset.id} options={ROUTING_ASSETS.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => rt.settings.set(VIEW_KEY, v)} hint={asset.description} />
        <Button size="sm" tone="ghost" icon="refresh" onClick={() => void refresh()}>Refresh</Button>
      </div>
      <div className={view === 'rule-cards' ? 'axp-ca-grid' : 'fx-stack'}>
        {order.map((k) => (
          <Container key={`${view}-${k}`} title={SECTION_TITLE[k]} icon={SECTION_ICON[k]} collapsible defaultOpen={open.has(k)} className={`axp-ca-section axp-ca-section--${k}`}>{body[k]}</Container>
        ))}
      </div>
    </div>
  );
}
