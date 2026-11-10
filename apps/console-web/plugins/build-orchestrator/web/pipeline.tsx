import { useEffect, useRef, useState } from 'react';
import { Button, Chip, Icon, Note, PriorityTag, Switch, useRuntime } from '@console/axf/react';
import { WatchLiveFor } from '@console/watchLive';
import { TABLE_LABEL } from '@console/axf/core/build-pipeline.mjs';

/*
 * Pipeline tab (Brett, Nov 8 2026): the three tables of the build pipeline, Pending / Queue / Building, the Claude
 * accounts the dispatcher can use (Fable yes or no, how many run on each), the agent slots and what the dispatcher's
 * next tick starts or why it waits. The orchestrator is the only thing that starts builds (Brett, Nov 9 2026). API jobs:
 * the API overflow switch (off by default) and each build's route (Auto / API / Subscriptions) decide when a build may
 * run on an API-key account; API accounts show their key, caps and room. Every number comes from GET /pipeline (pipeline.mjs status on the VPS), refreshed
 * while the tab is on screen; Queue / Back to Pending / Split now go through the same CLI under the store lock.
 * Live slots (Nov 10 2026, slot-registry@1): configured / in use / free for the VPS, per account and per model, counted
 * from live session heartbeats only, with the silent sessions and the ghost builds the reaper fixes. Deep link:
 * console_show("orchestrator", highlight="#pl-slots"); the same data: GET /pipeline/slots, pipeline.mjs slots.
 */

type Pipeline = { route?: string; queuedAt: string; queuedBy: string; account: string; session: string; model: string; launchedAt: string; runs: number; note: string; splitRequested: string; split: { at: string; by: string; provider: string; steps: number; note: string } | null; lastRun: { at: string; exit: number | null; outcome: string; stepsLeft: number; account: string } | null } | null;
type Row = { id: string; title: string; status: string; priority: string; steps: { done: number; total: number; left: number }; minutesLeft: number; nextModel: string; nextStep: string; needsApproval: boolean; needsSplit: boolean; pipeline: Pipeline; said: string; branch: string; pr: string; createdAt: string; updatedAt: string };
type Account = { name: string; email: string; plan: string; role: string; kind?: string; label?: string; fable: boolean; fableFrom: string; parallel: number; running: number; free: number; usable: boolean; why: string; api?: { usable: boolean; why: string; spend: { day: number; week: number; dayCap: number; weekCap: number; state: string } | null } | null };
type RegAccount = { name: string; kind: string; fable: boolean; usable: boolean; why: string; configured: number; inUse: number; free: number; sessions: string[] };
type Registry = { vps: { cap: number; used: number; free: number; queued: number; stale: number }; accounts: RegAccount[]; models: Record<'fable' | 'opus', { configured: number; inUse: number; free: number }>; unassigned: string[]; stale: string[]; ghosts: { id: string; status: string; why: string }[] };
type Status = {
  ok: boolean; at: string; table: { pending: Row[]; queued: Row[]; building: Row[] }; accounts: Account[];
  slots: { used: number; cap: number; free: number; queued: number; stale?: number; unavailable: boolean }; registry?: Registry; reaper?: { at: string; event: string; build: string; session?: string; to: string; stuck: boolean; note: string }[];
  plan: { launches: { id: string; account: string; model: string; phase: string; kind?: string; rule?: string }[]; waits: { id: string; why: string }[]; queue: string[]; idle: { reason: string; kind: string } | null };
  settings: { parallelPerAccount: number; autoQueue: boolean; splitProvider: string; idleAfterMin: number; maxRuns: number; apiOverflow?: boolean };
  state: { at: string; idle: { reason: string; kind: string; since: string } | null; alerts: { key: string; at: string }[]; recent: { at: string; event: string; id: string; account?: string; model?: string; error?: string }[] };
};
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
const REFRESH_MS = 10_000;
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ago = (v: string) => { const ms = Date.now() - new Date(v).getTime(); if (!Number.isFinite(ms)) return ''; const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export function PipelineTab({ api, log }: { api: Api; log: (t: string, l?: 'info' | 'ok' | 'warn' | 'error') => void }) {
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
        <Switch label="API overflow" text="Every subscription account full or out → an API-key account (billed per token, under its caps)" checked={!!s.settings.apiOverflow} disabled={busy === 'pipeline/settings'} onChange={(on) => act('pipeline/settings', { apiOverflow: on }, `API overflow ${on ? 'on' : 'off'}`)} />
      </div>
      {idle && <Note tone={idle.kind === 'stuck' ? 'warning' : 'info'}>{idle.reason}{(idle as { since?: string }).since ? ` (since ${fmtTime((idle as { since?: string }).since ?? '')})` : ''}</Note>}
      {s.plan.launches.length > 0 && <Note tone="success">Next tick starts {s.plan.launches.map((l) => `${l.id} on ${l.account} (${l.model}${l.phase ? `, ${l.phase}` : ''})`).join(', ')}.</Note>}
      {s.registry && <LiveSlots r={s.registry} />}
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
      <div className="pl-cols">
        {(['pending', 'queued', 'building'] as const).map((t) => (
          <section key={t} className="fx-stack pl-col" aria-label={TABLE_LABEL[t]}>
            <h2 className="pd-card__title">{TABLE_LABEL[t]} <span className="oc-count">{s.table[t].length}</span>
              {t === 'pending' && <span className="fx-muted fx-small"> · tap Queue to send one to the dispatcher</span>}
              {t === 'queued' && <span className="fx-muted fx-small"> · in start order</span>}
            </h2>
            {s.table[t].length === 0 ? <div className="fx-empty">{t === 'pending' ? 'Nothing pending.' : t === 'queued' ? 'The Queue is empty.' : 'Nothing is building.'}</div>
              : s.table[t].map((r) => <PipelineCard key={r.id} r={r} table={t} busy={busy === r.id} wait={waitsFor(r.id)} launch={launchFor(r.id)} act={act} />)}
          </section>
        ))}
      </div>
      {(s.reaper?.length ?? 0) > 0 && (
        <details className="pd-add" id="pl-reaper"><summary>Reaper log ({s.reaper?.length})</summary>
          <div className="fx-stack">{[...(s.reaper ?? [])].reverse().map((e, i) => <p key={i} className="fx-small fx-mono">{fmtTime(e.at)} · {e.event} {e.build || e.session}{e.to ? ` → ${e.to}` : ''}{e.stuck ? ' (stuck)' : ''} · {e.note}</p>)}</div>
        </details>
      )}
      {s.state.recent.length > 0 && (
        <details className="pd-add"><summary>Dispatcher log ({s.state.recent.length})</summary>
          <div className="fx-stack">{[...s.state.recent].reverse().map((e, i) => <p key={i} className="fx-small fx-mono">{fmtTime(e.at)} · {e.event} {e.id}{e.account ? ` → ${e.account} (${e.model})` : ''}{e.error ? ` · ${e.error}` : ''}</p>)}</div>
        </details>
      )}
    </div>
  );
}

/** Live slots: what is really running, from heartbeats; a build's status never holds a slot. */
function LiveSlots({ r }: { r: Registry }) {
  return (
    <section id="pl-slots" className="fx-stack" aria-label="Live slots">
      <h2 className="pd-card__title">Live slots <span className="fx-muted fx-small">· counted from session heartbeats, not build statuses</span></h2>
      <div className="pl-strip">
        <span className="pl-stat" title="Agent slots on the VPS: in use / the cap"><Icon name="layers" size={14} /><b>{r.vps.used}/{r.vps.cap}</b> VPS · {r.vps.free} free</span>
        {(['fable', 'opus'] as const).map((m) => (
          <span key={m} className="pl-stat" title={`${m === 'fable' ? 'Fable' : 'Opus'} sessions running / slots on accounts that run it; free = what the next tick can start`}>
            <span className={`oc-model is-${m}`}>{m === 'fable' ? 'Fable' : 'Opus'}</span><b>{r.models[m].inUse}</b> in use · {r.models[m].free} free of {r.models[m].configured}
          </span>
        ))}
        {r.vps.queued > 0 && <Chip tone="accent">{r.vps.queued} waiting for a slot</Chip>}
        {r.stale.length > 0 && <Chip tone="warning">{r.stale.length} silent: the reaper frees them</Chip>}
      </div>
      <div className="pl-cols pl-cols--accounts">
        {r.accounts.map((a) => (
          <article key={a.name} className={`pd-card pl-acct ${a.usable ? '' : 'is-off'}`}>
            <div className="pd-card__top">
              <h3 className="pd-card__title">{a.name}<span className="fx-muted fx-small"> · {a.kind === 'api' ? 'API key' : 'subscription'}</span></h3>
              <span className="pl-stat"><b>{a.inUse}/{a.configured}</b> in use · {a.free} free</span>
            </div>
            {a.sessions.length > 0 ? <div className="fx-stack">{a.sessions.map((x) => <p key={x} className="fx-small fx-mono">{x}</p>)}</div> : <p className="fx-small fx-muted">No live session.</p>}
            {!a.usable && a.why && <p className="fx-small fx-muted">{a.why}</p>}
          </article>
        ))}
      </div>
      {r.unassigned.length > 0 && <p className="fx-small fx-muted">Running with no account recorded: {r.unassigned.join(', ')}</p>}
      {r.ghosts.length > 0 && <Note tone="warning">Marked running with no live session (the reconcile fixes these): {r.ghosts.map((g) => g.id).join(', ')}</Note>}
    </section>
  );
}

type RouteStep = { to: string; label: string };
const ROUTE_AUTO: RouteStep = { to: 'api', label: 'Auto' };
const ROUTE_NEXT: Record<string, RouteStep> = { '': ROUTE_AUTO, api: { to: 'subscription', label: 'API' }, subscription: { to: 'auto', label: 'Subscriptions' } };
const routeOf = (r?: string): RouteStep => ROUTE_NEXT[r ?? ''] ?? ROUTE_AUTO;

function PipelineCard({ r, table, busy, wait, launch, act }: { r: Row; table: 'pending' | 'queued' | 'building'; busy: boolean; wait: string; launch?: { account: string; model: string; phase: string; kind?: string; rule?: string }; act: (path: string, body: Record<string, unknown>, what: string) => Promise<void> }) {
  const p = r.pipeline;
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
      {launch && <p className="fx-small"><Icon name="play" size={13} /> Next tick: starts on <b>{launch.account}</b> ({launch.model}{launch.phase ? `, ${launch.phase}` : ''}){launch.kind === 'api' ? ` · API key, ${launch.rule === 'override' ? 'set to API' : 'overflow'}` : ''}</p>}
      {!launch && wait && table === 'queued' && <p className="fx-small fx-muted"><Icon name="clock" size={13} /> {wait}</p>}
      {p?.note && <p className="fx-small fx-muted">{p.note}</p>}
      <div className="fx-row fx-row--wrap">
        {table === 'pending' && <Button size="sm" tone="primary" icon="arrow-right" disabled={busy} onClick={() => act('pipeline/queue', { id: r.id }, `${r.id} → Queue`)}>Queue</Button>}
        {table === 'queued' && <Button size="sm" tone="neutral" icon="arrow-left" disabled={busy} onClick={() => act('pipeline/unqueue', { id: r.id }, `${r.id} → Pending`)}>Back to Pending</Button>}
        {table !== 'building' && <Button size="sm" tone="neutral" icon="zap" disabled={busy} title="Where this build may run: Auto (subscriptions, API only by overflow), API (API-key accounts only, billed per token) or Subscriptions (never API). Tap to switch." onClick={() => { const n = routeOf(p?.route); void act('pipeline/route', { id: r.id, route: n.to }, `${r.id}: route ${n.to}`); }}>Runs on: {routeOf(p?.route).label}</Button>}
        {table !== 'building' && <Button size="sm" tone="neutral" icon="edit" disabled={busy || !!p?.splitRequested} title={p?.splitRequested ? 'Split asked for: the dispatcher does it within a minute' : 'Ask the orchestrator to (re)split this build into steps of 30 min or less'} onClick={() => act('pipeline/split', { id: r.id }, `${r.id}: split on the next tick`)}>{p?.splitRequested ? 'Splitting…' : 'Split now'}</Button>}
      </div>
    </article>
  );
}
