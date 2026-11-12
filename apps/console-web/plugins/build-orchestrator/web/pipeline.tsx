import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Chip, Icon, Note, PriorityTag, Switch, flashWhenReady, useRuntime } from '@console/axf/react';
import { buildRowSelector, settleFocus, useFocusedBuild } from './focus';
import { WatchLiveFor } from '@console/watchLive';
import { TAB_LABEL, type BuildAction, type PipelineTab as BuildTab } from '@console/axf/core/build-pipeline.mjs';

/*
 * Nov 10 2026 (build retire-build-manager-the-orchestrator-is-the-onl): the orchestrator is the only place that browses
 * and manages builds. The build tabs are Pending, Queue, Active, Incomplete, Complete, Errors (tabOf() in
 * framework/core/build-pipeline.mjs), each one view of GET /pipeline; the Queue shows every build's steps with the
 * planned model + account, Active the account that took it. Accounts is the accounts tab: the 5-minute health sweep
 * (sign-in, credits, Fable), the self-check and each account's controls.
 *
 * Nov 10 2026 (build orchestrator-hold-status-archive-tab-deleted-tab): every build card offers the actions its state
 * allows (actionsFor(): Back to Pending, Hold / Release, Archive / Unarchive, Delete / Restore) through POST
 * pipeline/action; cards can be selected and the bulk toolbar runs one action on every selected build. Archive holds every
 * completed and archived build, Deleted every soft-deleted build (kept in the builds store forever, restorable).
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
type Pipeline = { route?: string; planned?: Planned; tried?: string[]; pickedAt?: string; heldAt?: string; heldBy?: string; heldWhy?: string; queuedAt: string; queuedBy: string; account: string; session: string; model: string; launchedAt: string; runs: number; note: string; splitRequested: string; split: { at: string; by: string; provider: string; steps: number; note: string } | null; lastRun: { at: string; exit: number | null; outcome: string; stepsLeft: number; account: string; email?: string; costUsd?: number } | null; failovers?: Failover[]; builtBy?: BuiltBy[] } | null;
/** One hop of the failover chain (an account's login failed or it hit its limit; to '' = nothing was left). */
type Failover = { at: string; from: string; to: string; kind: string; hit: string; why: string };
/** One login that ran the build, with its cost and the steps it ticked. */
type BuiltBy = { account: string; email: string; kind: string; model: string; from: string; to: string; costUsd: number; steps: string[]; outcome: string };
type StepRow = { id: string; text: string; model: string; estimate: string; done: boolean; skip: boolean };
type Row = { id: string; title: string; status: string; tab: BuildTab | ''; stepList: StepRow[]; builtAt: string; priority: string; steps: { done: number; total: number; left: number }; minutesLeft: number; nextModel: string; nextStep: string; needsApproval: boolean; needsSplit: boolean; pipeline: Pipeline; said: string; branch: string; pr: string; createdAt: string; updatedAt: string; held?: boolean; actions?: BuildAction[]; deleted?: boolean; deletedAt?: string };
type Account = { name: string; email: string; plan: string; role: string; kind?: string; label?: string; fable: boolean; fableFrom: string; parallel: number; running: number; free: number; usable: boolean; why: string; api?: { usable: boolean; why: string; spend: { day: number; week: number; dayCap: number; weekCap: number; state: string } | null } | null };
type Status = {
  ok: boolean; at: string; table: { pending: Row[]; queued: Row[]; building: Row[] }; tabs?: Record<BuildTab, Row[]>; health?: Health; accounts: Account[];
  slots: { used: number; cap: number; free: number; queued: number; unavailable: boolean };
  plan: { launches: { id: string; account: string; model: string; phase: string; kind?: string; rule?: string }[]; waits: { id: string; why: string }[]; queue: string[]; idle: { reason: string; kind: string } | null };
  settings: { parallelPerAccount: number; autoQueue: boolean; splitProvider: string; idleAfterMin: number; maxRuns: number; apiOverflow?: boolean; healthEveryMin?: number };
  accountsFrom?: { source: 'host' | 'snapshot' | 'none'; at: string; ageMin: number | null; why: string };
  state: { at: string; idle: { reason: string; kind: string; since: string } | null; alerts: { key: string; at: string }[]; recent: { at: string; event: string; id: string; account?: string; model?: string; error?: string }[]; selfCheck?: SelfCheck | null; selfCheckRequested?: string };
};
type Finding = { name: string; kind: string; role: string; state: 'ready' | 'busy' | 'standby' | 'blocked'; running: number; parallel: number; note: string };
type SelfCheck = { at: string; reason: string; by: string; line: string; fixes: string[]; problems: string[]; findings: Finding[]; notified: boolean };
const CHECK_TONE: Record<Finding['state'], 'success' | 'accent' | undefined | 'danger'> = { ready: 'success', busy: 'accent', standby: undefined, blocked: 'danger' };
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
const REFRESH_MS = 10_000;
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ago = (v: string) => { const ms = Date.now() - new Date(v).getTime(); if (!Number.isFinite(ms)) return ''; const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export type PipelineView = BuildTab | 'accounts';
const EMPTY: Record<BuildTab, string> = { pending: 'Nothing pending.', queue: 'The Queue is empty.', active: 'Nothing is building.', incomplete: 'Nothing stopped half way.', complete: 'Nothing waiting to merge.', errors: 'No errors.', archive: 'The Archive is empty.', deleted: 'Nothing deleted.' };
/** How each build action shows (the order is the order on a card and in the bulk toolbar). */
const ACTION: Record<BuildAction, { label: string; icon: string; tone: 'neutral' | 'danger'; done: string; title: string }> = {
  unqueue: { label: 'Back to Pending', icon: 'arrow-left', tone: 'neutral', done: 'back in Pending', title: 'Take it out of the Queue: it waits in Pending again' },
  hold: { label: 'Hold', icon: 'pause', tone: 'neutral', done: 'on hold', title: 'Keep it in the Queue, in its place; the dispatcher skips it until you release it' },
  release: { label: 'Release', icon: 'play', tone: 'neutral', done: 'released', title: 'Take it off hold: the dispatcher may start it when its turn comes' },
  archive: { label: 'Archive', icon: 'package', tone: 'neutral', done: 'archived', title: 'Move it to the Archive (out of every working tab; Unarchive brings it back)' },
  unarchive: { label: 'Unarchive', icon: 'undo', tone: 'neutral', done: 'back from the Archive', title: 'Bring it back: Pending, or Complete when every step is done' },
  delete: { label: 'Delete', icon: 'trash', tone: 'danger', done: 'deleted (kept in Deleted)', title: 'Delete it: it moves to the Deleted tab and stays saved there for good; Restore brings it back' },
  restore: { label: 'Restore', icon: 'undo', tone: 'neutral', done: 'restored', title: 'Bring the deleted build back where it was' },
};
const ACTION_ORDER = Object.keys(ACTION) as BuildAction[];
type ActionResult = { ok: boolean; error?: string; done?: { id: string; tab: string }[]; refused?: { id: string; error: string }[] };
const yn = (v: boolean | null | undefined) => (v == null ? '?' : v ? 'yes' : 'no');

export function PipelineTab({ api, log, view }: { api: Api; log: (t: string, l?: 'info' | 'ok' | 'warn' | 'error') => void; view: PipelineView }) {
  const rt = useRuntime();
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState<Set<string>>(() => new Set());
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
  /** One build action on one build or many (bulk): the builds that can't take it are refused one by one, the rest go. */
  const runAction = async (action: BuildAction, ids: string[]) => {
    if (!ids.length) return;
    setBusy(ids.length === 1 ? (ids[0] ?? 'bulk') : 'bulk');
    try {
      const r = await api.post<ActionResult>('pipeline/action', { action, ids });
      if (!r.ok) throw new Error(r.error);
      const done = r.done ?? []; const refused = r.refused ?? [];
      const what = done.length === 1 ? `${done[0]?.id}: ${ACTION[action].done}` : `${done.length} builds ${ACTION[action].done}`;
      if (done.length) { log(what, 'ok'); rt.toast(what, 'success'); }
      for (const x of refused) log(`${x.id}: ${x.error}`, 'warn');
      if (refused.length) rt.toast(refused.length === 1 ? (refused[0]?.error ?? '') : `${refused.length} builds refused: ${refused.map((x) => x.id).join(', ')}`, 'warning');
      setSel((cur) => { const n = new Set(cur); for (const d of done) n.delete(d.id); return n; });
      await load();
    } catch (e) { log((e as Error).message, 'error'); rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(''); }
  };
  const toggle = (id: string, on: boolean) => setSel((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n; });
  // a build asked for (console command, search, menu): once this tab lists it, scroll it into view and flash it; the
  // card stays expanded (its steps) and marked as the current one
  const focusId = useFocusedBuild();
  const hasFocus = !!focusId && !!s && view !== 'accounts' && (s.tabs?.[view] ?? []).some((r) => r.id === focusId);
  useEffect(() => {
    if (!hasFocus) return;
    flashWhenReady(() => document.querySelector(buildRowSelector(focusId)), 5000);
    settleFocus(focusId);
  }, [hasFocus, focusId, view]);
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
      {view !== 'accounts' && (() => {
        const rows = s.tabs?.[view] ?? [];
        const chosen = rows.filter((r) => sel.has(r.id));
        const offered = ACTION_ORDER.filter((a) => rows.some((r) => r.actions?.includes(a)));
        return (
          <section className="fx-stack" aria-label={TAB_LABEL[view]}>
            <h2 className="pd-card__title">{TAB_LABEL[view]} <span className="oc-count">{rows.length}</span>
              {view === 'pending' && <span className="fx-muted fx-small"> · split as soon as filed, model and account planned · tap Queue to send one to the dispatcher</span>}
              {view === 'queue' && <span className="fx-muted fx-small"> · in start order · the final account pick happens when its turn comes</span>}
              {view === 'incomplete' && <span className="fx-muted fx-small"> · started, then stopped with steps left</span>}
              {view === 'complete' && <span className="fx-muted fx-small"> · built, waiting for its PR to merge · merged builds move to the Archive</span>}
              {view === 'archive' && <span className="fx-muted fx-small"> · every completed and archived build</span>}
              {view === 'deleted' && <span className="fx-muted fx-small"> · kept saved for good · Restore brings one back</span>}
            </h2>
            {rows.length > 0 && offered.length > 0 && (
              <div className="pl-bulk" role="toolbar" aria-label={`${TAB_LABEL[view]}: bulk actions`}>
                <Checkbox label={chosen.length ? `${chosen.length} selected` : 'Select all'} checked={chosen.length === rows.length} indeterminate={chosen.length > 0 && chosen.length < rows.length} disabled={busy === 'bulk'} onChange={(on) => setSel(on ? new Set(rows.map((r) => r.id)) : new Set())} />
                {offered.map((a) => {
                  const ids = chosen.filter((r) => r.actions?.includes(a)).map((r) => r.id);
                  return <Button key={a} size="sm" tone={ACTION[a].tone} icon={ACTION[a].icon} disabled={!ids.length || busy === 'bulk'} title={ids.length ? `${ACTION[a].title} (${ids.length} selected)` : 'Select builds first'} onClick={() => void runAction(a, ids)}>{ACTION[a].label}{ids.length ? ` (${ids.length})` : ''}</Button>;
                })}
              </div>
            )}
            {rows.length === 0 ? <div className="fx-empty">{EMPTY[view]}</div>
              : <div className="pl-cols">{rows.map((r) => <PipelineCard key={r.id} r={r} busy={busy === r.id || busy === 'bulk'} wait={waitsFor(r.id)} launch={launchFor(r.id)} act={act} run={runAction} selected={sel.has(r.id)} onSelect={(on) => toggle(r.id, on)} showSteps={view === 'queue' || view === 'pending' || r.id === focusId} focused={r.id === focusId} />)}</div>}
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
const HIT_LABEL: Record<string, string> = { auth: 'login failed', usage: 'limit', rate: 'rate limited' };
/** The failover chain's hops, oldest first: "w1 (limit) → w2 · w2 (login failed) → nothing left". */
const failoverLine = (hops: Failover[]) => hops.map((h) => `${h.from} (${HIT_LABEL[h.hit] ?? h.hit}) → ${h.to ? `${h.to}${h.kind === 'api' ? ' [API]' : ''}` : 'nothing left'}`).join(' · ');
const failoverTitle = (hops: Failover[]) => hops.map((h) => `${fmtTime(h.at)} ${h.from} → ${h.to || 'none'}: ${h.why}`).join('\n');
/** Every login that ran the build, oldest first: account, email, model, cost, steps ticked. */
const builtByTitle = (runs: BuiltBy[]) => runs.map((x) => `${fmtTime(x.from)} ${x.account}${x.kind === 'api' ? ' [API]' : ''}${x.email ? ` (${x.email})` : ''} · ${x.model || '?'}${x.costUsd > 0 ? ` · $${x.costUsd.toFixed(2)}` : ''}${x.steps.length ? ` · ${x.steps.join(', ')}` : ''}${x.outcome === 'limited' ? ' · stopped, moved on' : ''}`).join('\n');

function PipelineCard({ r, busy, wait, launch, act, run, selected, onSelect, showSteps, focused = false }: { r: Row; busy: boolean; wait: string; launch?: { account: string; model: string; phase: string; kind?: string; rule?: string }; act: (path: string, body: Record<string, unknown>, what: string) => Promise<void>; run: (action: BuildAction, ids: string[]) => Promise<void>; selected: boolean; onSelect: (on: boolean) => void; showSteps: boolean; focused?: boolean }) {
  const p = r.pipeline;
  const table = r.deleted ? 'done' : r.status === 'queued' ? 'queued' : r.status === 'running' || r.status === 'waiting' ? 'building' : r.status === 'pending' ? 'pending' : 'done';
  const pl = p?.planned ?? null;
  return (
    <article className={`pd-card is-${table === 'building' ? 'running' : 'pending'}${focused ? ' is-focused' : ''}`} aria-current={focused ? 'true' : undefined} data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={r.id}>
      <div className="pd-card__top">
        <h3 className="pd-card__title">{r.title}<span className="fx-muted fx-small fx-mono"> {r.id}</span></h3>
        {r.held && <Chip tone="warning">On hold</Chip>}
        {r.deleted ? <Chip tone="danger">Deleted</Chip> : <PriorityTag build={r.id} />}
        {(r.actions?.length ?? 0) > 0 && <Checkbox label="Select" checked={selected} onChange={onSelect} />}
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
      {(p?.failovers?.length ?? 0) > 0 && <p className={`fx-small${p!.failovers!.at(-1)!.to ? '' : ' oc-flag'}`} title={failoverTitle(p!.failovers!)}><Icon name="refresh" size={13} /> Failover: {failoverLine(p!.failovers!)}</p>}
      {(p?.builtBy?.length ?? 0) > 0 && <p className="fx-small fx-muted" title={builtByTitle(p!.builtBy!)}><Icon name="user" size={13} /> Built by {[...new Set(p!.builtBy!.map((x) => `${x.account}${x.kind === 'api' ? ' (API)' : ''}`))].join(' → ')}</p>}
      {showSteps && r.stepList.length > 0 && (
        <ol className="pl-steps" aria-label={`${r.id} steps`}>
          {r.stepList.map((x) => <li key={x.id} className={x.done || x.skip ? 'oc-done' : ''}><span className={`oc-model is-${x.model.toLowerCase()}`}>{x.model}</span> <span className="fx-small">{x.id} · {x.text}{x.estimate ? ` · ${x.estimate}` : ''}</span></li>)}
        </ol>
      )}
      {launch && <p className="fx-small"><Icon name="play" size={13} /> Next tick: starts on <b>{launch.account}</b> ({launch.model}{launch.phase ? `, ${launch.phase}` : ''}){launch.kind === 'api' ? ` · API key, ${launch.rule === 'override' ? 'set to API' : 'overflow'}` : ''}</p>}
      {!launch && wait && table === 'queued' && <p className="fx-small fx-muted"><Icon name="clock" size={13} /> {wait}</p>}
      {r.held && p?.heldAt && <p className="fx-small" title={fmtTime(p.heldAt)}><Icon name="pause" size={13} /> On hold since {fmtTime(p.heldAt)}{p.heldBy ? ` (${p.heldBy})` : ''}{p.heldWhy ? `: ${p.heldWhy}` : ''}</p>}
      {r.deleted && r.deletedAt && <p className="fx-small fx-muted"><Icon name="trash" size={13} /> Deleted {fmtTime(r.deletedAt)} · status before: {r.status}</p>}
      {p?.note && <p className="fx-small fx-muted">{p.note}</p>}
      <div className="fx-row fx-row--wrap">
        {table === 'pending' && <Button size="sm" tone="primary" icon="arrow-right" disabled={busy} onClick={() => act('pipeline/queue', { id: r.id }, `${r.id} → Queue`)}>Queue</Button>}
        {(table === 'pending' || table === 'queued') && <Button size="sm" tone="neutral" icon="zap" disabled={busy} title="Where this build may run: Auto (subscriptions first, then any API), API (API-key accounts only, billed per token) or Subscriptions (never API). Tap to switch." onClick={() => { const n = routeOf(p?.route); void act('pipeline/route', { id: r.id, route: n.to }, `${r.id}: route ${n.to}`); }}>Runs on: {routeOf(p?.route).label}</Button>}
        {(table === 'pending' || table === 'queued') && <Button size="sm" tone="neutral" icon="edit" disabled={busy || !!p?.splitRequested} title={p?.splitRequested ? 'Split asked for: the dispatcher does it within a minute' : 'Ask the orchestrator to (re)split this build into steps of 30 min or less'} onClick={() => act('pipeline/split', { id: r.id }, `${r.id}: split on the next tick`)}>{p?.splitRequested ? 'Splitting…' : 'Split now'}</Button>}
        {ACTION_ORDER.filter((a) => r.actions?.includes(a)).map((a) => <Button key={a} size="sm" tone={ACTION[a].tone} icon={ACTION[a].icon} disabled={busy} title={ACTION[a].title} onClick={() => void run(a, [r.id])}>{ACTION[a].label}</Button>)}
      </div>
    </article>
  );
}
