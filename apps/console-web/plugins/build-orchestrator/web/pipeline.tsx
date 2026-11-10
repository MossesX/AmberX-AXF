import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Icon, Note, PriorityTag, Switch, useRuntime } from '@console/axf/react';
import { WatchLiveFor } from '@console/watchLive';
import { TAB_LABEL, type PipelineTab as BuildTab } from '@console/axf/core/build-pipeline.mjs';

/*
 * Nov 10 2026 (build retire-build-manager-the-orchestrator-is-the-onl): the orchestrator is the only place that browses
 * and manages builds. The build tabs are Pending, Queue, Active, Incomplete, Complete, Errors (tabOf() in
 * framework/core/build-pipeline.mjs), each one view of GET /pipeline; the Queue shows every build's steps with the
 * planned model + account, Active the account that took it. Accounts is the accounts tab: the 5-minute health sweep
 * (sign-in, credits, Fable), the self-check and each account's controls.
 *
 * Pipeline tab (Brett, Nov 8 2026): the three tables of the build pipeline, Pending / Queue / Building, the Claude
 * accounts the dispatcher can use (Fable yes or no, how many run on each), the agent slots and what the dispatcher's
 * next tick starts or why it waits. The orchestrator is the only thing that starts builds (Brett, Nov 9 2026). API jobs:
 * the API overflow switch (off by default) and each build's route (Auto / API / Subscriptions) decide when a build may
 * run on an API-key account; API accounts show their key, caps and room. Every number comes from GET /pipeline (pipeline.mjs status on the VPS), refreshed
 * while the tab is on screen; Queue / Back to Pending / Split now go through the same CLI under the store lock.
 */

type Planned = { model: string; account: string; kind: string; at: string; why: string } | null;
type Health = { at: string; startedAt: string; line: string; problems: string[]; accounts: { name: string; kind: string; signedIn: boolean | null; credits: boolean | null; fable: boolean | null; error: string; skipped?: boolean; at: string }[] } | null;
type Pipeline = { route?: string; planned?: Planned; tried?: string[]; pickedAt?: string; queuedAt: string; queuedBy: string; account: string; session: string; model: string; launchedAt: string; runs: number; note: string; splitRequested: string; split: { at: string; by: string; provider: string; steps: number; note: string } | null; lastRun: { at: string; exit: number | null; outcome: string; stepsLeft: number; account: string } | null } | null;
type StepRow = { id: string; text: string; model: string; estimate: string; done: boolean; skip: boolean };
type Row = { id: string; title: string; status: string; tab: BuildTab | ''; stepList: StepRow[]; builtAt: string; priority: string; steps: { done: number; total: number; left: number }; minutesLeft: number; nextModel: string; nextStep: string; needsApproval: boolean; needsSplit: boolean; pipeline: Pipeline; said: string; branch: string; pr: string; createdAt: string; updatedAt: string };
type Account = { name: string; email: string; plan: string; role: string; kind?: string; label?: string; fable: boolean; fableFrom: string; parallel: number; running: number; free: number; usable: boolean; why: string; api?: { usable: boolean; why: string; spend: { day: number; week: number; dayCap: number; weekCap: number; state: string } | null } | null };
type Status = {
  ok: boolean; at: string; table: { pending: Row[]; queued: Row[]; building: Row[] }; tabs?: Record<BuildTab, Row[]>; health?: Health; accounts: Account[];
  slots: { used: number; cap: number; free: number; queued: number; unavailable: boolean };
  plan: { launches: { id: string; account: string; model: string; phase: string; kind?: string; rule?: string }[]; waits: { id: string; why: string }[]; queue: string[]; idle: { reason: string; kind: string } | null;
    mergeLaunches?: { id: string; build: string; account: string; model: string }[]; mergeWaits?: { id: string; why: string }[]; crew?: Crew };
  merges?: MergeJob[];
  settings: { parallelPerAccount: number; autoQueue: boolean; splitProvider: string; idleAfterMin: number; maxRuns: number; apiOverflow?: boolean; healthEveryMin?: number; mergeFirst?: boolean; mergers?: number; builders?: number };
  accountsFrom?: { source: 'host' | 'snapshot' | 'none'; at: string; ageMin: number | null; why: string };
  state: { at: string; idle: { reason: string; kind: string; since: string } | null; alerts: { key: string; at: string }[]; recent: { at: string; event: string; id: string; account?: string; model?: string; error?: string }[]; selfCheck?: SelfCheck | null; selfCheckRequested?: string };
};
type MergeJob = { id: string; build: string; pr: string; branch: string; title: string; reason: string; state: 'waiting' | 'running' | 'done' | 'failed'; stage: string; account: string; session: string; runs: number; at: string; launchedAt: string; endedAt: string; note: string };
type Crew = { mergeFirst: boolean; mergers: number; builders: number; mergesRunning: number; buildsRunning: number };
const STAGE_LABEL: Record<string, string> = { queued: 'Waiting for a merger', rebase: 'Rebasing on main', conflicts: 'Fixing conflicts', test: 'Running tests', push: 'Pushing', landing: 'In the merge queue' };
type Finding = { name: string; kind: string; role: string; state: 'ready' | 'busy' | 'standby' | 'blocked'; running: number; parallel: number; note: string };
type SelfCheck = { at: string; reason: string; by: string; line: string; fixes: string[]; problems: string[]; findings: Finding[]; notified: boolean };
const CHECK_TONE: Record<Finding['state'], 'success' | 'accent' | undefined | 'danger'> = { ready: 'success', busy: 'accent', standby: undefined, blocked: 'danger' };
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
const REFRESH_MS = 10_000;
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ago = (v: string) => { const ms = Date.now() - new Date(v).getTime(); if (!Number.isFinite(ms)) return ''; const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export type PipelineView = BuildTab | 'accounts' | 'merging';
const EMPTY: Record<BuildTab, string> = { pending: 'Nothing pending.', queue: 'The Queue is empty.', active: 'Nothing is building.', incomplete: 'Nothing stopped half way.', complete: 'Nothing finished yet.', errors: 'No errors.' };
const yn = (v: boolean | null | undefined) => (v == null ? '?' : v ? 'yes' : 'no');

export function PipelineTab({ api, log, view }: { api: Api; log: (t: string, l?: 'info' | 'ok' | 'warn' | 'error') => void; view: PipelineView }) {
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
    // console load: the dispatcher checks every account on its next tick (quietly: no toast)
    void api.post('pipeline/selfcheck', { reason: 'console-load' }).catch(() => undefined);
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
  const check = s.state.selfCheck ?? null;
  const from = s.accountsFrom;
  const asked = !!s.state.selfCheckRequested && (!check || s.state.selfCheckRequested > check.at);
  return (
    <div className="fx-stack fx-stack--lg">
      {error && <Note tone="warning">{error}</Note>}
      <div className="pl-strip">
        <span className="pl-stat" title="Agent slots on the VPS (agent-slots@1): sessions running / the cap"><Icon name="layers" size={14} /><b>{s.slots.used}/{s.slots.cap}</b> slots{s.slots.unavailable ? ' (no slots store)' : ''}</span>
        <span className="pl-stat" title="Builds the dispatcher is running"><Icon name="play" size={14} /><b>{s.table.building.length}</b> building</span>
        <span className="pl-stat" title="Builds waiting in the Queue"><Icon name="list" size={14} /><b>{s.table.queued.length}</b> queued</span>
        <span className="pl-stat" title="Builds waiting in Pending for you"><Icon name="clock" size={14} /><b>{s.table.pending.length}</b> pending</span>
        <span className="pl-stat fx-muted" title={s.state.at ? `Last dispatcher tick ${fmtTime(s.state.at)}` : 'The dispatcher has not run yet on this VPS'}><Icon name="refresh" size={14} />{s.state.at ? `tick ${tickAge}` : 'no tick yet'}</span>
        {s.settings.autoQueue && <Chip tone="accent">Launch without asking: new builds queue by themselves</Chip>}
        <Switch label="Then any API" text="Subscriptions first; when every subscription account is full or out, an API-key account takes it (billed per token, under its caps)" checked={!!s.settings.apiOverflow} disabled={busy === 'pipeline/settings'} onChange={(on) => act('pipeline/settings', { apiOverflow: on }, `API overflow ${on ? 'on' : 'off'}`)} />
      </div>
      <CrewBar s={s} busy={busy} act={act} />
      {idle && <Note tone={idle.kind === 'stuck' ? 'warning' : 'info'}>{idle.reason}{(idle as { since?: string }).since ? ` (since ${fmtTime((idle as { since?: string }).since ?? '')})` : ''}</Note>}
      {s.plan.launches.length > 0 && <Note tone="success">Next tick starts {s.plan.launches.map((l) => `${l.id} on ${l.account} (${l.model}${l.phase ? `, ${l.phase}` : ''})`).join(', ')}.</Note>}
      {view === 'accounts' && <section className="fx-stack">
        <article className="pd-card pl-selfcheck" aria-label="Account health">
          <div className="pd-card__top">
            <h3 className="pd-card__title">Account health<span className="fx-muted fx-small">{s.health ? ` · ${ago(s.health.at)}` : ' · not run yet'}{s.settings.healthEveryMin ? ` · every ${s.settings.healthEveryMin} min` : ' · off'}</span></h3>
            <Button size="sm" tone="neutral" icon="refresh" disabled={busy === 'pipeline/health'} title="One tiny headless Fable call per account on a private copy of its login: can it sign in, has it credits, does it take Fable. Never touches a running build, never signs anything out." onClick={() => act('pipeline/health', {}, 'Health check asked for: the dispatcher starts it within a minute')}>Check health now</Button>
          </div>
          {s.health ? <>
            <p className="fx-small">{s.health.line}</p>
            {s.health.problems.map((p) => <p key={p} className="fx-small oc-flag"><Icon name="alert" size={13} /> {p}</p>)}
            <div className="fx-row fx-row--wrap">{s.health.accounts.map((a) => <span key={a.name} title={a.error || `checked ${fmtTime(a.at)}`}><Chip tone={a.signedIn === false || a.credits === false ? 'danger' : a.fable === false ? undefined : a.signedIn ? 'success' : undefined}>{a.name}: sign-in {yn(a.signedIn)} · credits {yn(a.credits)} · Fable {yn(a.fable)}{a.skipped ? ' (kept)' : ''}</Chip></span>)}</div>
          </> : <p className="fx-small fx-muted">The dispatcher checks every account in the background every few minutes; the dispatcher never tests an account at launch time.</p>}
        </article>
        <h2 className="pd-card__title">Claude accounts on the VPS <span className="fx-muted fx-small">· the dispatcher sends Fable phases to accounts with Fable, the rest to Opus{from?.source === 'snapshot' && from.at ? ` · as the dispatcher saw them ${ago(from.at)}` : ''}</span></h2>
        {from?.why && <Note tone="warning">{from.why}</Note>}
        <article className="pd-card pl-selfcheck" aria-label="Dispatcher self-check">
          <div className="pd-card__top">
            <h3 className="pd-card__title">Self-check<span className="fx-muted fx-small">{check ? ` · ${ago(check.at)} (${check.reason})` : ' · not run yet'}</span></h3>
            <Button size="sm" tone="neutral" icon="refresh" disabled={busy === 'pipeline/selfcheck' || asked} title="Check every account one by one (signed in, limited, key, free slots) and release slots and builds held by ended sessions. Runs on the VPS on the next tick." onClick={() => act('pipeline/selfcheck', { reason: 'on demand' }, 'Self-check asked for: the dispatcher runs it within a minute')}>{asked ? 'Checking…' : 'Check accounts now'}</Button>
          </div>
          {check ? <>
            <p className="fx-small">{check.line}{check.notified ? ' · AmberX told' : ''}</p>
            {check.fixes.map((f) => <p key={f} className="fx-small"><Icon name="check" size={13} /> Fixed: {f}</p>)}
            {check.problems.map((p) => <p key={p} className="fx-small oc-flag"><Icon name="alert" size={13} /> Can't use {p}</p>)}
            <div className="fx-row fx-row--wrap">{check.findings.map((f) => <span key={f.name} title={f.note}><Chip tone={CHECK_TONE[f.state]}>{f.name}: {f.state} {f.running}/{f.parallel}</Chip></span>)}</div>
          </> : <p className="fx-small fx-muted">The dispatcher checks every account when queued builds wait and nothing starts, on console load and when asked.</p>}
        </article>
        {s.accounts.length === 0 ? <div className="fx-empty">{from?.why || 'No Claude account is signed in on the VPS.'}</div> : (
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
      </section>}
      {(view === 'merging' || view === 'active') && <MergeList jobs={(s.merges ?? []).filter((j) => (view === 'active' ? j.state === 'running' : true))} waits={s.plan.mergeWaits ?? []} launches={s.plan.mergeLaunches ?? []} busy={busy} act={act} active={view === 'active'} />}
      {view !== 'accounts' && view !== 'merging' && (() => {
        const rows = s.tabs?.[view] ?? [];
        return (
          <section className="fx-stack" aria-label={TAB_LABEL[view]}>
            <h2 className="pd-card__title">{TAB_LABEL[view]} <span className="oc-count">{rows.length}</span>
              {view === 'pending' && <span className="fx-muted fx-small"> · split as soon as filed, model and account planned · tap Queue to send one to the dispatcher</span>}
              {view === 'queue' && <span className="fx-muted fx-small"> · in start order · the final account pick happens when its turn comes</span>}
              {view === 'incomplete' && <span className="fx-muted fx-small"> · started, then stopped with steps left</span>}
            </h2>
            {rows.length === 0 ? <div className="fx-empty">{EMPTY[view]}</div>
              : <div className="pl-cols">{rows.map((r) => <PipelineCard key={r.id} r={r} busy={busy === r.id} wait={waitsFor(r.id)} launch={launchFor(r.id)} act={act} showSteps={view === 'queue' || view === 'pending'} />)}</div>}
          </section>
        );
      })()}
      {s.state.recent.length > 0 && (
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

function PipelineCard({ r, busy, wait, launch, act, showSteps }: { r: Row; busy: boolean; wait: string; launch?: { account: string; model: string; phase: string; kind?: string; rule?: string }; act: (path: string, body: Record<string, unknown>, what: string) => Promise<void>; showSteps: boolean }) {
  const p = r.pipeline;
  const table = r.status === 'queued' ? 'queued' : r.status === 'running' || r.status === 'waiting' ? 'building' : r.status === 'pending' ? 'pending' : 'done';
  const pl = p?.planned ?? null;
  return (
    <article className={`pd-card is-${table === 'building' ? 'running' : 'pending'}`} data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={r.id}>
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
        {p?.account && table === 'building' && <span title={`Session ${p.session || '(queued in agent slots)'}`}><Icon name="user" size={13} />{p.account} · run {p.runs}{p.model ? ` · ${p.model}` : ''}</span>}
        {p?.launchedAt && table === 'building' && <span className="fx-muted" title={fmtTime(p.launchedAt)}><Icon name="clock" size={13} />{ago(p.launchedAt)}</span>}
        {p?.queuedAt && table === 'queued' && <span className="fx-muted" title={`Queued ${fmtTime(p.queuedAt)} by ${p.queuedBy}`}><Icon name="clock" size={13} />queued {ago(p.queuedAt)}</span>}
        {p?.lastRun && table !== 'building' && <span className="fx-muted" title={`Last run ended ${fmtTime(p.lastRun.at)}`}><Icon name="clock" size={13} />last run: {p.lastRun.outcome}{p.lastRun.exit != null ? ` (exit ${p.lastRun.exit})` : ''}</span>}
        {table === 'building' && <WatchLiveFor branch={r.branch} text={r.id} />}
      </div>
      {pl && table !== 'building' && table !== 'done' && <p className="fx-small" title={pl.why}><Icon name="layers" size={13} /> Planned: <b>{pl.model}</b> on <b>{pl.account || 'no account yet'}</b>{pl.kind === 'api' ? ' (API key)' : ''}</p>}
      {p?.account && p.pickedAt && (table === 'building' || table === 'done') && <p className="fx-small" title={`Picked ${fmtTime(p.pickedAt)}`}><Icon name="user" size={13} /> Taken by <b>{p.account}</b>{pl && pl.account && pl.account !== p.account ? ` (planned ${pl.account})` : ''}{p.tried?.length ? ` · refused: ${p.tried.join(', ')}` : ''}</p>}
      {table === 'done' && p?.tried?.length ? <p className="fx-small oc-flag"><Icon name="alert" size={13} /> Refused by {p.tried.join(', ')}</p> : null}
      {showSteps && r.stepList.length > 0 && (
        <ol className="pl-steps" aria-label={`${r.id} steps`}>
          {r.stepList.map((x) => <li key={x.id} className={x.done || x.skip ? 'oc-done' : ''}><span className={`oc-model is-${x.model.toLowerCase()}`}>{x.model}</span> <span className="fx-small">{x.id} · {x.text}{x.estimate ? ` · ${x.estimate}` : ''}</span></li>)}
        </ol>
      )}
      {launch && <p className="fx-small"><Icon name="play" size={13} /> Next tick: starts on <b>{launch.account}</b> ({launch.model}{launch.phase ? `, ${launch.phase}` : ''}){launch.kind === 'api' ? ` · API key, ${launch.rule === 'override' ? 'set to API' : 'overflow'}` : ''}</p>}
      {!launch && wait && table === 'queued' && <p className="fx-small fx-muted"><Icon name="clock" size={13} /> {wait}</p>}
      {p?.note && <p className="fx-small fx-muted">{p.note}</p>}
      <div className="fx-row fx-row--wrap">
        {table === 'pending' && <Button size="sm" tone="primary" icon="arrow-right" disabled={busy} onClick={() => act('pipeline/queue', { id: r.id }, `${r.id} → Queue`)}>Queue</Button>}
        {table === 'queued' && <Button size="sm" tone="neutral" icon="arrow-left" disabled={busy} onClick={() => act('pipeline/unqueue', { id: r.id }, `${r.id} → Pending`)}>Back to Pending</Button>}
        {(table === 'pending' || table === 'queued') && <Button size="sm" tone="neutral" icon="zap" disabled={busy} title="Where this build may run: Auto (subscriptions first, then any API), API (API-key accounts only, billed per token) or Subscriptions (never API). Tap to switch." onClick={() => { const n = routeOf(p?.route); void act('pipeline/route', { id: r.id, route: n.to }, `${r.id}: route ${n.to}`); }}>Runs on: {routeOf(p?.route).label}</Button>}
        {r.status === 'built' && r.pr && <Button size="sm" tone="neutral" icon="branch" disabled={busy} title="Give this PR to a merger: rebase on main, fix conflicts, test, push; the merge queue lands it" onClick={() => act('pipeline/merge', { id: r.id }, `${r.id}: given to a merger`)}>Merge it</Button>}
        {(table === 'pending' || table === 'queued') && <Button size="sm" tone="neutral" icon="edit" disabled={busy || !!p?.splitRequested} title={p?.splitRequested ? 'Split asked for: the dispatcher does it within a minute' : 'Ask the orchestrator to (re)split this build into steps of 30 min or less'} onClick={() => act('pipeline/split', { id: r.id }, `${r.id}: split on the next tick`)}>{p?.splitRequested ? 'Splitting…' : 'Split now'}</Button>}
      </div>
    </article>
  );
}

/** Merge first + Mergers N + Builders N (pipeline-settings@1 mergeFirst / mergers / builders): one slot pool, two kinds of work. */
function CrewBar({ s, busy, act }: { s: Status; busy: string; act: (path: string, body: Record<string, unknown>, what: string) => Promise<void> }) {
  const st = s.settings; const c = s.plan.crew;
  const mergers = st.mergers ?? 12; const builders = st.builders ?? 12;
  const off = busy === 'pipeline/crew';
  const step = (k: 'mergers' | 'builders', v: number) => act('pipeline/crew', { [k]: v }, `${k === 'mergers' ? 'Mergers' : 'Builders'}: ${v}`);
  return (
    <div className="pl-strip pl-crew" role="toolbar" aria-label="Mergers and builders">
      <Switch label="Merge first" text="Free slots go to merge jobs (rebase, conflicts, tests, push) before new builds" checked={!!st.mergeFirst} disabled={off} onChange={(on) => act('pipeline/crew', { mergeFirst: on }, `Merge first ${on ? 'on' : 'off'}`)} />
      <span className="pl-stat" title="Merge sessions running / the most at once"><Icon name="branch" size={14} />Mergers <b>{c?.mergesRunning ?? 0}/{mergers}</b></span>
      <Button size="sm" tone="neutral" icon="minus" disabled={off || mergers <= 0} title="One merger fewer" onClick={() => step('mergers', mergers - 1)}>Fewer mergers</Button>
      <Button size="sm" tone="neutral" icon="plus" disabled={off || mergers >= 12} title="One merger more" onClick={() => step('mergers', mergers + 1)}>More mergers</Button>
      <span className="pl-stat" title="Build sessions running / the most at once"><Icon name="play" size={14} />Builders <b>{c?.buildsRunning ?? 0}/{builders}</b></span>
      <Button size="sm" tone="neutral" icon="minus" disabled={off || builders <= 0} title="One builder fewer" onClick={() => step('builders', builders - 1)}>Fewer builders</Button>
      <Button size="sm" tone="neutral" icon="plus" disabled={off || builders >= 12} title="One builder more" onClick={() => step('builders', builders + 1)}>More builders</Button>
      <Button size="sm" tone="primary" icon="branch" disabled={off || (st.mergeFirst && builders === 0 && mergers === 12)} title="Merge first on, Mergers 12, Builders 0: every slot goes to merging" onClick={() => act('pipeline/crew', { mergeFirst: true, mergers: 12, builders: 0 }, 'All slots on merging')}>All on merging</Button>
    </div>
  );
}

/** Merge jobs (merge-job@1): each one given to an account like a build, with its stage. */
function MergeList({ jobs, waits, launches, busy, act, active }: { jobs: MergeJob[]; waits: { id: string; why: string }[]; launches: { id: string; account: string; model: string }[]; busy: string; act: (path: string, body: Record<string, unknown>, what: string) => Promise<void>; active: boolean }) {
  const open = jobs.filter((j) => j.state === 'waiting' || j.state === 'running');
  const rest = active ? [] : jobs.filter((j) => j.state === 'done' || j.state === 'failed').slice(-10).reverse();
  if (active && !open.length) return null;
  return (
    <section className="fx-stack" aria-label="Merge jobs">
      <h2 className="pd-card__title">Merging <span className="oc-count">{open.length}</span><span className="fx-muted fx-small"> · built PRs that can't land as is, each given to a merger account like a build · the merge queue lands them</span></h2>
      {!open.length && !rest.length ? <div className="fx-empty">No merge work: every built PR can land as is.</div> : (
        <div className="pl-cols">{[...open, ...rest].map((j) => {
          const l = launches.find((x) => x.id === j.id); const w = waits.find((x) => x.id === j.id);
          return (
            <article key={j.id} className={`pd-card is-${j.state === 'running' ? 'running' : 'pending'}`} data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={j.build}>
              <div className="pd-card__top"><h3 className="pd-card__title">{j.title || j.build}<span className="fx-muted fx-small fx-mono"> {j.build}</span></h3><Chip tone={j.state === 'failed' ? 'danger' : j.state === 'done' ? 'success' : j.state === 'running' ? 'accent' : undefined}>{j.state === 'running' || j.state === 'waiting' ? STAGE_LABEL[j.stage] ?? j.stage : j.state}</Chip></div>
              <div className="pd-meta">
                {j.pr && <span><Icon name="branch" size={13} />PR {j.pr.replace(/^.*\//, '#')}</span>}
                {j.account && <span title={j.session ? `Session ${j.session}` : ''}><Icon name="user" size={13} />{j.account}{j.runs ? ` · run ${j.runs}` : ''}</span>}
                {j.launchedAt && j.state === 'running' && <span className="fx-muted"><Icon name="clock" size={13} />{ago(j.launchedAt)}</span>}
              </div>
              {j.reason && <p className="fx-small">{j.reason}</p>}
              {l && <p className="fx-small"><Icon name="play" size={13} /> Next tick: starts on <b>{l.account}</b> ({l.model})</p>}
              {!l && w && j.state === 'waiting' && <p className="fx-small fx-muted"><Icon name="clock" size={13} /> {w.why}</p>}
              {j.note && <p className="fx-small fx-muted">{j.note}</p>}
              <div className="fx-row fx-row--wrap">
                {(j.state === 'waiting' || j.state === 'running') && <Button size="sm" tone="neutral" icon="x" disabled={busy === j.build} onClick={() => act('pipeline/merge/cancel', { id: j.build }, `${j.build}: merge job cancelled`)}>Cancel</Button>}
                {(j.state === 'done' || j.state === 'failed') && <Button size="sm" tone="neutral" icon="refresh" disabled={busy === j.build} onClick={() => act('pipeline/merge', { id: j.build }, `${j.build}: given to a merger again`)}>Merge again</Button>}
              </div>
            </article>
          );
        })}</div>
      )}
    </section>
  );
}
