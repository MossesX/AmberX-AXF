import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AgentAvatar, Button, Chip, Icon, IconButton, flashWhenReady, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { registerRowRefTarget, rowHooks, useDatasetsRevision } from '@console/axf/libs/datagrid';
import * as rq from './requests-core.mjs';
import type { Request, RequestsRes } from './requests-core.mjs';

/*
 * The requests ledger (request@1): every single thing Brett asked for, one line each — short title, status chip, place
 * in line, agent, age. Tapping a line opens the full row: his exact words, where it lives now, the queue and slot it
 * is in, the PR, cost, steps, its family (addenda, what replaced it), the history and the hooks that open each of those.
 * Live: polls the server while the page is visible (only a fingerprint comes back when nothing moved) and flashes rows
 * whose status or place changed.
 */

export const FOLDER = 'build-breaker';
export const REQUEST_TARGET = 'axp-build-breaker-request';
const api = pluginApi(FOLDER, 'Build Breaker', { unavailable: 'Build Breaker is switched off or its server part is not running.' });
const POLL_MS = 15_000;

/* ---------------------------------------------------------------- one shared store (page + banner badge) */

type State = { res: RequestsRes | null; error: string; changed: Set<string>; at: number };
let state: State = { res: null, error: '', changed: new Set(), at: 0 };
const subs = new Set<() => void>();
const emit = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
let inflight: Promise<void> | null = null;

/** Read the ledger (or only learn that nothing moved). Rows whose status / place changed are remembered for a flash. */
export function refreshRequests(force = false): Promise<void> {
  if (inflight && !force) return inflight;
  const since = force ? '' : state.res?.fingerprint ?? '';
  inflight = api.call<RequestsRes & { same?: boolean }>(`requests${since ? `?since=${encodeURIComponent(since)}` : ''}`)
    .then((r) => {
      if (!r.ok) throw new Error(r.error || 'no data');
      if (r.same) { emit({ at: Date.now(), error: '', res: state.res ? { ...state.res, summary: r.summary ?? state.res.summary } : state.res }); return; }
      const before = new Map((state.res?.requests ?? []).map((x) => [x.id, `${x.status}|${x.queue?.position ?? ''}|${x.slot?.state ?? ''}`]));
      const changed = new Set(before.size ? r.requests.filter((x) => before.get(x.id) !== `${x.status}|${x.queue?.position ?? ''}|${x.slot?.state ?? ''}`).map((x) => x.id) : []);
      emit({ res: r, error: '', changed, at: Date.now() });
    })
    .catch((e: Error) => emit({ error: e.message, at: Date.now() }))
    .finally(() => { inflight = null; });
  return inflight;
}
export function useRequests(): State {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);
}
/** Poll while visible: every POLL_MS and on focus. */
function useLive() {
  useEffect(() => {
    void refreshRequests();
    const tick = () => { if (document.visibilityState === 'visible') void refreshRequests(); };
    const t = window.setInterval(tick, POLL_MS);
    addEventListener('focus', tick); document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, []);
}

const byId = new Map<string, Request>();
/** Right-click → row hooks of the build a request lives in (grid-hook@1, the kinds the builds grids use). */
registerRowRefTarget(REQUEST_TARGET, (id) => { const r = byId.get(id); const b = r ? rq.buildOf(r) : ''; return b ? { kind: 'orchestrator', id: b } : null; });

/* ---------------------------------------------------------------- the view */

const fmtWhen = (at?: string) => { const d = at ? new Date(at) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'unknown'; };
const SOURCE_LABEL: Record<string, string> = { voice: 'by voice', chat: 'in chat', console: 'in the console', code: 'in Claude Code', memory: 'from memory', unknown: '' };
type Show = 'open' | 'all' | 'closed';

export function LedgerView() {
  useLive();
  const { res, error, changed } = useRequests();
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('open');
  const [status, setStatus] = useState('any');
  const [kind, setKind] = useState('any');
  const [profile, setProfile] = useState('any');
  const [range, setRange] = useState('all');
  const [sort, setSort] = useState('updated');
  const [group, setGroup] = useState('none');
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const all = useMemo(() => res?.requests ?? [], [res]);
  useEffect(() => { byId.clear(); for (const r of all) byId.set(r.id, r); }, [all]);
  const profiles = useMemo(() => [...new Set(all.map((r) => r.profile).filter(Boolean))].sort() as string[], [all]);
  const shown = useMemo(() => rq.sortRequests(rq.filterRequests(all, {
    q, open: show === 'open' ? true : show === 'closed' ? false : undefined, statuses: status === 'any' ? [] : [status], kinds: kind === 'any' ? [] : [kind], profiles: profile === 'any' ? [] : [profile], range,
  }), sort), [all, q, show, status, kind, profile, range, sort]);
  const sum = useMemo(() => rq.summarize(all), [all]);
  const filtering = !!(q || status !== 'any' || kind !== 'any' || profile !== 'any' || range !== 'all');

  if (!res && !error) return <LoadingSkeleton rows={8} label="Loading every request" />;
  if (!res) return <EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => void refreshRequests(true) }}>{error || 'The requests could not be read.'}</EmptyState>;

  const toggle = (id: string) => setOpenRows((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const reset = () => { setQ(''); setStatus('any'); setKind('any'); setProfile('any'); setRange('all'); };
  const groups = rq.groupRequests(shown, group);

  return (
    <div className="axp-build-breaker__ledger">
      <div className="axp-build-breaker__totals" role="list" aria-label="Request totals">
        <span role="listitem" className="axp-build-breaker__stat is-lead"><b>{sum.open}</b> open<span className="fx-muted"> of {sum.total}</span></span>
        <span role="listitem" className="axp-build-breaker__stat"><b>{sum.running}</b> running</span>
        <span role="listitem" className="axp-build-breaker__stat"><b>{sum.queued}</b> queued</span>
        <span role="listitem" className="axp-build-breaker__stat"><b>{sum.awaitingMerge}</b> awaiting merge</span>
        <span role="listitem" className="axp-build-breaker__stat"><b>{rq.fmtUsd(sum.costUsd)}</b> <span className="fx-muted">spent</span></span>
        {error ? <span role="listitem" className="axp-build-breaker__stat fx-muted" title={error}><Icon name="alert" size={12} /> live updates paused</span> : null}
      </div>
      <div className="axp-build-breaker__tools" role="toolbar" aria-label="Request filters">
        <label className="fx-search axp-build-breaker__search">
          <Icon name="search" size={13} />
          <input type="search" placeholder="Search what you asked, in your words…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests" />
        </label>
        <Sel icon="filter" label="Show" value={show} onChange={(v) => setShow(v as Show)} options={[['open', 'Open'], ['all', 'Everything'], ['closed', 'Done / dropped']]} />
        <Sel icon="check-circle" label="Status" value={status} onChange={setStatus} options={[['any', 'Any status'], ...rq.STATUSES.filter((s) => sum.statuses[s.id]).map((s) => [s.id, `${s.label} (${sum.statuses[s.id]})`] as [string, string])]} />
        <Sel icon="layers" label="Kind" value={kind} onChange={setKind} options={[['any', 'Any kind'], ...rq.KINDS.filter((k) => sum.kinds[k.id]).map((k) => [k.id, `${k.label} (${sum.kinds[k.id]})`] as [string, string])]} />
        {profiles.length > 1 && <Sel icon="user" label="Profile" value={profile} onChange={setProfile} options={[['any', 'All profiles'], ...profiles.map((p) => [p, p] as [string, string])]} />}
        <Sel icon="calendar" label="Date range" value={range} onChange={setRange} options={[['all', 'All time'], ['7', '7 days'], ['30', '30 days']]} />
        <Sel icon="list" label="Sort" value={sort} onChange={setSort} options={rq.SORTS.map((s) => [s.id, s.label] as [string, string])} />
        <Sel icon="grid" label="Group by" value={group} onChange={setGroup} options={rq.GROUPS.map((g) => [g.id, g.id === 'none' ? 'No grouping' : `By ${g.label.toLowerCase()}`] as [string, string])} />
        <span className="axp-build-breaker__fold">
          <IconButton icon="refresh" label="Refresh now" onClick={() => void refreshRequests(true)} />
          <IconButton icon="chevron-up" label="Close every row" onClick={() => setOpenRows(new Set())} />
          {filtering && <IconButton icon="x" label="Clear filters" onClick={reset} />}
        </span>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon="search" action={filtering ? { label: 'Clear filters', icon: 'x', onClick: reset } : undefined}>{filtering ? 'No requests match these filters.' : show === 'open' ? 'Nothing open: everything you asked for is done or dropped.' : 'No requests yet.'}</EmptyState>
      ) : (
        <div className="axp-build-breaker__grid is-open is-timeline" role="list" aria-label="Every request">
          {groups.map((g) => (
            <Fragment key={g.id}>
              {group !== 'none' && <div className="axp-build-breaker__sub" role="presentation"><span className="axp-build-breaker__subname">{g.label}</span><span className="axp-build-breaker__n">{g.items.length}</span></div>}
              {g.items.map((r) => <RequestRow key={r.id} r={r} open={openRows.has(r.id)} flash={changed.has(r.id)} onToggle={() => toggle(r.id)} all={all} />)}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function Sel({ icon, label, value, onChange, options }: { icon: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="fx-search axp-build-breaker__sel" title={label}>
      <Icon name={icon} size={12} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  );
}

function StatusChip({ status }: { status: string }) {
  const s = rq.statusInfo(status);
  return <span className="axp-build-breaker__status" title={s.label}><Chip tone={s.tone || undefined}><Icon name={s.icon} size={11} /><span className="axp-build-breaker__slabel">{s.label}</span></Chip></span>;
}

function RequestRow({ r, open, flash, onToggle, all }: { r: Request; open: boolean; flash: boolean; onToggle: () => void; all: Request[] }) {
  const k = rq.kindInfo(r.kind);
  return (
    <div className={`axp-build-breaker__ask axp-build-breaker__req${open ? ' is-open' : ''}${flash ? ' is-changed' : ''}`} role="listitem" data-fx-ctx-target={REQUEST_TARGET} data-fx-ctx-payload={r.id} data-request={r.id}>
      <button type="button" data-fx-row className="axp-build-breaker__row axp-build-breaker__rqrow" aria-expanded={open} onClick={onToggle} title={r.said || r.title}>
        <span className="axp-build-breaker__title"><Icon name={k.icon} size={11} /> {r.title}{r.reversedBy ? <span className="axp-build-breaker__tag"> · reversed</span> : null}</span>
        <StatusChip status={r.status} />
        <span className="axp-build-breaker__qpos" title={r.queue ? `Place ${r.queue.position} of ${r.queue.of} in ${r.queue.list}` : r.slot?.state === 'running' ? 'Running now' : 'Not in line'}>
          {r.slot?.state === 'running' ? <Icon name="refresh" size={11} /> : r.queue ? `#${r.queue.position}` : '—'}
        </span>
        <span className="axp-build-breaker__agent">{r.agent ? <AgentAvatar agent={r.agentId || r.agent} size="small" noMenu /> : null}</span>
        <span className="axp-build-breaker__date" title={fmtWhen(r.at)}>{rq.age(r.at) || '—'}</span>
      </button>
      {open && <RequestDetail r={r} all={all} />}
    </div>
  );
}

/** Opens a console view and flashes the element `find` returns once it has drawn. */
function openAndFlash(rt: ReturnType<typeof useRuntime>, view: string, find: () => Element | null) {
  rt.navigate(view);
  flashWhenReady(find, 6000);
}
const byText = (text: string) => () => [...document.querySelectorAll<HTMLElement>('.fx-main h1, .fx-main h2, .fx-main h3, .fx-main [data-fx-row], .fx-main strong, .fx-main span')].find((el) => (el.innerText || '').trim().toLowerCase() === text.trim().toLowerCase()) ?? null;

function RequestDetail({ r, all }: { r: Request; all: Request[] }) {
  const rt = useRuntime();
  useDatasetsRevision();
  const build = rq.buildOf(r);
  const plan = r.where.find((w) => w.kind === 'plan')?.id ?? '';
  const bug = r.where.find((w) => w.kind === 'bug')?.id ?? '';
  const step = r.steps?.next ?? '';
  const pr = rq.prUrl(r.pr);
  const session = r.slot?.session ?? '';
  const ref = build ? { kind: 'orchestrator', id: build } : null;
  const extra = ref ? rowHooks(ref) : [];
  const parent = all.find((x) => x.id === r.parent);
  const addenda = all.filter((x) => x.parent === r.id);
  const supersededBy = all.find((x) => x.id === r.supersededBy || x.id === r.reversedBy);
  const supersedes = all.filter((x) => (r.supersedes ?? []).includes(x.id) || x.reversedBy === r.id);
  const [busy, setBusy] = useState(false);
  const set = async (status: string) => {
    setBusy(true);
    try { const res = await api.post<{ ok: boolean; error?: string }>('requests/update', { id: r.id, status, by: 'Brett (console)' }); if (!res.ok) throw new Error(res.error); rt.toast(`${r.title}: ${rq.statusInfo(status).label}`, 'success'); await refreshRequests(true); }
    catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); }
  };
  const flashBuild = () => document.querySelector(`[data-fx-ctx-target="axf-orchestrator-build"][data-fx-ctx-payload="${CSS.escape(build)}"]`);

  const facts: [string, React.ReactNode][] = [
    ['Status', <><Icon name={rq.statusInfo(r.status).icon} size={12} /> {rq.statusInfo(r.status).label}</>],
    ['Kind', rq.kindInfo(r.kind).label],
    ['Asked', <>{fmtWhen(r.at)}{SOURCE_LABEL[r.source] ? ` · ${SOURCE_LABEL[r.source]}` : ''}{r.capturedBy ? <span className="fx-muted"> · captured by {r.capturedBy}</span> : null}</>],
    ...(rq.whereLine(r) ? [['Where it is', rq.whereLine(r)] as [string, React.ReactNode]] : []),
    ...(r.queue ? [['In line', `#${r.queue.position} of ${r.queue.of} in ${r.queue.list}`] as [string, React.ReactNode]] : []),
    ...(r.slot ? [['Agent slot', r.slot.state === 'running' ? `running${r.slot.since ? ` since ${fmtWhen(r.slot.since)}` : ''}` : `waiting, #${r.slot.position} of ${r.slot.of}`] as [string, React.ReactNode]] : []),
    ...(r.steps?.total ? [['Steps', `${r.steps.done}/${r.steps.total} done${r.steps.next ? ` · next ${r.steps.next}: ${r.steps.nextText ?? ''}` : ''}`] as [string, React.ReactNode]] : []),
    ...(r.agent ? [['Agent', <AgentAvatar agent={r.agentId || r.agent} size="small" label />] as [string, React.ReactNode]] : []),
    ...(r.pr ? [['Pull request', pr ? <a href={pr} target="_blank" rel="noreferrer">{r.pr} on GitHub</a> : r.pr] as [string, React.ReactNode]] : []),
    ...(r.branch ? [['Branch', <span className="fx-mono">{r.branch}</span>] as [string, React.ReactNode]] : []),
    ...(r.costUsd != null ? [['Cost so far', <>{rq.fmtUsd(r.costUsd)}{r.costEstimated ? <span className="fx-muted"> estimated</span> : null}</>] as [string, React.ReactNode]] : []),
    ...(r.profile ? [['Profile', r.profile] as [string, React.ReactNode]] : []),
    ['Last update', fmtWhen(r.updatedAt)],
    ['Id', <span className="fx-mono">{r.id}</span>],
  ];
  const hooks: { id: string; label: string; icon: string; run: () => void; title?: string }[] = [
    ...(build ? [{ id: 'build', label: 'Open build', icon: 'layers', run: () => openAndFlash(rt, 'build-orchestrator', flashBuild), title: `Build orchestrator: ${build}` }] : []),
    ...(build && step ? [{ id: 'step', label: `Open step ${step}`, icon: 'list', run: () => { openAndFlash(rt, 'build-orchestrator', flashBuild); rt.toast(`${build} · next ${step}: ${r.steps?.nextText ?? ''}`, 'info'); } }] : []),
    ...(pr ? [{ id: 'pr', label: `Open PR ${r.pr}`, icon: 'github', run: () => { globalThis.open(pr, '_blank', 'noopener'); } }] : []),
    ...(bug ? [{ id: 'bug', label: 'Open bug', icon: 'alert', run: () => openAndFlash(rt, 'bugs-board', byText(r.title)) }] : []),
    ...(plan ? [{ id: 'plan', label: 'Open plan', icon: 'layout', run: () => openAndFlash(rt, 'plan-studio', byText(r.title)) }] : []),
    ...(r.queue || r.slot ? [{ id: 'queue', label: 'Jump to queue', icon: 'clock', run: () => (r.slot?.state === 'waiting' ? rt.dispatch('settings.open:agent-slots') : openAndFlash(rt, 'builds', byText(build))), title: r.slot?.state === 'waiting' ? 'The agent cap queue' : 'The builds queue' }] : []),
    ...(build ? [{ id: 'log', label: 'Open log', icon: 'branch', run: () => rt.dispatch(`codebase-changes.open:${encodeURIComponent(build)}`), title: 'Codebase changes log for this build' }] : []),
    ...(session ? [{ id: 'talk', label: 'Talk to agent', icon: 'terminal', run: () => rt.dispatch(`terminal.jump:${session}`), title: `Jump into ${session}` }]
      : r.agentId ? [{ id: 'talk', label: 'Talk to agent', icon: 'user', run: () => rt.dispatch(`agent-swarm.profile:${r.agentId}`), title: `${r.agent}'s card` }] : []),
  ];

  return (
    <div className="axp-build-breaker__detail">
      {r.said ? (
        <blockquote className="axp-build-breaker__quote"><p>{r.said}</p><cite>Brett{SOURCE_LABEL[r.source] ? `, ${SOURCE_LABEL[r.source]}` : ''} · {fmtWhen(r.at)}{r.verbatim ? '' : ' · may be paraphrased'}</cite></blockquote>
      ) : <p className="fx-muted axp-build-breaker__plain">His exact words were not recorded for this one.{r.summary ? ` ${r.summary}` : ''}</p>}
      {r.said && r.summary ? <p className="axp-build-breaker__plain">{r.summary}</p> : null}
      <div className="axp-build-breaker__actions" role="toolbar" aria-label="Request hooks">
        {hooks.map((h) => <Button key={h.id} size="sm" icon={h.icon} onClick={h.run} title={h.title ?? h.label}>{h.label}</Button>)}
        {ref && extra.map((h) => <Button key={`x-${h.id}`} size="sm" icon={h.icon ?? 'link'} onClick={() => h.run(ref, { dataset: 'build-breaker-requests' })}>{h.label}</Button>)}
      </div>
      <dl className="axp-build-breaker__facts">{facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      {(parent || addenda.length > 0 || supersededBy || supersedes.length > 0) && (
        <div className="axp-build-breaker__sources">
          <span className="axp-build-breaker__k">Related</span>
          <ul>
            {parent && <li><span className="fx-muted">Addendum to</span> {parent.title}</li>}
            {addenda.map((a) => <li key={a.id}><span className="fx-muted">Addendum</span> “{a.said.slice(0, 160)}{a.said.length > 160 ? '…' : ''}”</li>)}
            {supersededBy && <li><span className="fx-muted">{r.reversedBy ? 'Reversed by' : 'Replaced by'}</span> {supersededBy.title}{supersededBy.said ? ` — “${supersededBy.said.slice(0, 120)}”` : ''}</li>}
            {supersedes.map((x) => <li key={x.id}><span className="fx-muted">Replaces</span> {x.title}</li>)}
          </ul>
        </div>
      )}
      {r.where.length > 0 && (
        <div className="axp-build-breaker__sources">
          <span className="axp-build-breaker__k">Lives in</span>
          <ul>{r.where.map((w, i) => <li key={`${w.kind}:${w.id}:${i}`}><span className="fx-muted">{w.kind}</span> {w.label || w.id}{w.file ? <span className="fx-mono fx-muted"> {w.file}</span> : null}</li>)}</ul>
        </div>
      )}
      {r.history.length > 0 && (
        <div className="axp-build-breaker__sources">
          <span className="axp-build-breaker__k">History</span>
          <ol className="axp-build-breaker__history">{r.history.slice(-12).map((h, i) => <li key={i}><span className="fx-muted">{fmtWhen(h.at)}</span> {h.text}</li>)}</ol>
        </div>
      )}
      {r.notes?.length ? (
        <div className="axp-build-breaker__sources"><span className="axp-build-breaker__k">Notes</span><ul>{r.notes.map((n, i) => <li key={i}><span className="fx-muted">{fmtWhen(n.at)}{n.by ? ` · ${n.by}` : ''}</span> {n.text}</li>)}</ul></div>
      ) : null}
      <div className="axp-build-breaker__actions" role="toolbar" aria-label="Change this request">
        {r.status !== 'dropped' && <Button size="sm" tone="quiet" icon="x-circle" disabled={busy} onClick={() => void set('dropped')}>Drop it</Button>}
        {r.status === 'merged' && <Button size="sm" tone="quiet" icon="rocket" disabled={busy} onClick={() => void set('live')}>Mark live</Button>}
      </div>
    </div>
  );
}

/** The banner badge's words: "12 open asks" (or nothing while the ledger hasn't loaded). */
export const bannerText = (open: number) => `${open} open ask${open === 1 ? '' : 's'}`;
