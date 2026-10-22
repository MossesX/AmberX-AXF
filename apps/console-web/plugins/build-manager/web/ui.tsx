/* Build manager — the view (live tracker + everything still to build), the banner and the settings panel. Theme tokens only. */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { addedByLabel, addedByOf, filterRows, GONE_LABEL, goneRows, MODELS, ORIGIN_LABEL, ORIGINS, SORT_LABEL, SORTS, SOURCE_LABEL, SOURCES, sortRows, statusesOf, totalsByModel, type GoneKind, type LiveEntry, type Origin, type Row, type SortKey, type Source } from './merge.mjs';
import { bannerOn, defaultSort, enabledSources, fmt, loadChanges, loadList, loadLive, onStartRequest, planBuild, startBuild, takeFocus, takeOff, tickStep, useStore, onStore, verifyBuild, type StartPlan, type Store } from './store';
import { builtRows, builtTotals, filterBuilt, liveFromChanges, matches, money, PERIOD_LABEL, PERIODS, type ChangeLive, type Period } from './history.mjs';

/* ---------------- time ---------------- */

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(t); }, [on]);
  return now;
}
const dur = (ms: number | null) => {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/* ---------------- small pieces ---------------- */

const SOURCE_ICON: Record<Source, string> = { pending: 'clock', queue: 'play', plan: 'layers' };
const ORIGIN_ICON: Record<Origin, string> = { prompt: 'user', auto: 'zap' };

const ORIGIN_SHORT: Record<Origin, string> = { prompt: 'Prompt', auto: 'Auto' };

/** One toolbar toggle: icon over a short label, the count as a badge on the corner (Brett, Oct 22 2026: style #23 + count badges). */
function ToolToggle({ icon, label, title, count, on, onClick, quiet, pressed }: { icon: string; label: string; title: string; count: number; on: boolean; onClick: () => void; quiet?: boolean; pressed?: boolean | null }) {
  return (
    <button type="button" className={`axp-build-manager__tool${on ? ' is-on' : ''}`} title={title} aria-pressed={pressed === null ? undefined : (pressed ?? on)} aria-label={`${label}${count ? `, ${count}` : ''}`} onClick={onClick}>
      <span className="axp-build-manager__tool-icon"><Icon name={icon} size={18} />{(!quiet || count > 0) && <span className="axp-build-manager__tool-n">{count > 999 ? '999+' : count}</span>}</span>
      <span className="axp-build-manager__tool-label">{label}</span>
    </button>
  );
}

/** Model, Added by, Status and Sort in one dialog (they were four drop-downs above the list). */
function FilterSortDialog(p: { onClose: () => void; model: string; setModel: (v: string) => void; addedBy: string; setAddedBy: (v: string) => void; adders: { value: string; label: string; count: number }[];
  status: string; setStatus: (v: string) => void; statuses: { value: string; label: string }[]; sort: SortKey; setSort: (v: SortKey) => void; shown: number }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => { p.setModel(''); p.setAddedBy(''); p.setStatus(''); p.setSort(defaultSort()); };
  return createPortal(
    <div className="fx-backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="fx-dialog axp-build-manager__dialog" role="dialog" aria-modal="true" aria-label="Filter and sort">
        <header className="fx-dialog__head">
          <Icon name="sliders" size={18} />
          <h2>Filter &amp; sort</h2>
          <button type="button" className="fx-iconbtn" onClick={p.onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </header>
        <div className="fx-dialog__body axp-build-manager__dialog-body">
          <label className="axp-build-manager__field"><span>Model</span>
            <select className="fx-input" value={p.model} onChange={(e) => p.setModel(e.target.value)}><option value="">All</option>{MODELS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          </label>
          <label className="axp-build-manager__field" title="Who or what added the item"><span>Added by</span>
            <select className="fx-input" value={p.addedBy} onChange={(e) => p.setAddedBy(e.target.value)}><option value="">Anyone</option>{p.adders.map((x) => <option key={x.value} value={x.value}>{x.label} ({x.count})</option>)}</select>
          </label>
          <label className="axp-build-manager__field"><span>Status</span>
            <select className="fx-input" value={p.status} onChange={(e) => p.setStatus(e.target.value)}><option value="">All</option>{p.statuses.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
          </label>
          <label className="axp-build-manager__field"><span>Sort</span>
            <select className="fx-input" value={p.sort} onChange={(e) => p.setSort(e.target.value as SortKey)}>{SORTS.map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}</select>
          </label>
          <div className="axp-build-manager__dialog-foot">
            <span className="fx-small fx-muted">{p.shown} shown</span>
            <Button icon="refresh" onClick={reset}>Reset</Button>
            <Button icon="check" onClick={p.onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ModelChip({ model }: { model: string }) {
  return <span className={`axp-build-manager__model is-${model.toLowerCase()}`} title={`Build with ${model}`}>{model}</span>;
}
function Badge({ icon, children, tone, title }: { icon?: string; children: React.ReactNode; tone?: 'warn' | 'ok' | 'muted' | 'danger'; title?: string }) {
  return <span className={`axp-build-manager__badge${tone ? ` is-${tone}` : ''}`} title={title}>{icon && <Icon name={icon} size={11} />}{children}</span>;
}
function Bar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return <span className="axp-build-manager__bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>;
}
function SplitBadge({ row }: { row: Row }) {
  return row.needsSplit ? <Badge icon="alert" tone="warn" title={`Estimated ${fmt(row.total)} with no steps: builds over 30 min are split into steps of 30 min or less (rule, Oct 21 2026)`}>needs split</Badge> : null;
}
function TimeLeft({ row }: { row: Row }) {
  if (row.left == null) return <Badge icon="clock" tone="muted" title="No build-time estimate yet">no estimate</Badge>;
  return <span className="axp-build-manager__left" title={row.total != null ? `${fmt(row.left)} left of ${fmt(row.total)}` : ''}>{row.left === 0 ? 'steps done' : `${fmt(row.left)} left`}</span>;
}

/* ---------------- live tracker ---------------- */

function TrackerEntry({ e, now, finished }: { e: LiveEntry; now: number; finished?: boolean }) {
  const rt = useRuntime();
  const elapsed = e.startedAt ? (e.finishedAt || now) - e.startedAt : null;
  const failed = /failed|stale|cancelled/.test(e.activityState);
  const over = e.estimate && elapsed != null && elapsed > e.estimate * 60_000;
  const pct = e.progress ?? (e.estimate && elapsed != null ? Math.min(0.99, elapsed / (e.estimate * 60_000)) : null);
  return (
    <li className={`axp-build-manager__live${finished ? (failed ? ' is-failed' : ' is-done') : ''}`}>
      <div className="axp-build-manager__live-head">
        <span className={finished ? '' : 'axp-build-manager__spin'} aria-hidden><Icon name={finished ? (failed ? 'x-circle' : 'check-circle') : 'refresh'} size={14} /></span>
        <span className="axp-build-manager__live-title">{e.row ? e.row.title : e.title}</span>
        {e.row && <ModelChip model={e.row.model} />}
      </div>
      <div className="axp-build-manager__live-meta">
        {finished ? <Badge icon={failed ? 'x' : 'check'} tone={failed ? 'danger' : 'ok'}>{failed ? 'Failed' : 'Finished'}</Badge> : null}
        <Badge icon="clock" tone={over ? 'warn' : undefined} title="Elapsed vs estimate">{dur(elapsed)}{e.estimate ? ` / ~${fmt(e.estimate)}` : ''}</Badge>
        {e.row && e.row.stepsTotal > 0 && <Badge icon="list">{e.row.stepsDone}/{e.row.stepsTotal} steps</Badge>}
        {!e.row && <Badge tone="muted" title="Not linked to anything on the build list">{e.source || 'Running'}</Badge>}
        {e.row && e.via && <Badge tone="muted" title="How this was linked to the build">{e.via}</Badge>}
        {e.row && <button type="button" className="axp-build-manager__act" onClick={() => rt.dispatch(`build-manager.open:${encodeURIComponent(e.row!.key)}`)}><Icon name="arrow-right" size={11} />Item</button>}
        {e.url && <a className="axp-build-manager__act" href={e.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={11} />Open</a>}
      </div>
      {e.currentStep && !finished && <p className="axp-build-manager__live-step"><Icon name="chevron-right" size={12} />{e.currentStep}</p>}
      {pct != null && !finished && <Bar value={pct} label={`${e.title} progress`} />}
    </li>
  );
}

/** One build reported by a session (any surface, any machine) through the build log. */
function SessionEntry({ e, now }: { e: ChangeLive; now: number }) {
  const rt = useRuntime();
  const elapsed = e.startedAt ? now - e.startedAt : null;
  const over = e.estimate && elapsed != null && elapsed > e.estimate * 60_000;
  const pct = e.progress ?? (e.estimate && elapsed != null ? Math.min(0.99, elapsed / (e.estimate * 60_000)) : null);
  const quiet = now - (e.lastSeenAt || now);
  return (
    <li className={`axp-build-manager__live${e.stale ? ' is-stale' : ''}${e.parent ? ' is-child' : ''}`}>
      <div className="axp-build-manager__live-head">
        <span className={e.stale || e.state === 'queued' ? '' : 'axp-build-manager__spin'} aria-hidden><Icon name={e.stale ? 'alert' : e.state === 'queued' ? 'clock' : 'refresh'} size={14} /></span>
        <span className="axp-build-manager__live-title">{e.title}</span>
        <ModelChip model={e.model === 'Other' ? 'Opus' : e.model} />
      </div>
      <div className="axp-build-manager__live-meta">
        {e.stale ? <Badge icon="alert" tone="warn" title="No heartbeat from this session for over 10 minutes: it may have stopped">no word for {dur(quiet)}</Badge>
          : e.state === 'queued' ? <Badge icon="clock" tone="warn">Waiting to start</Badge> : null}
        <Badge icon="clock" tone={over ? 'warn' : undefined} title="Elapsed vs estimate">{dur(elapsed)}{e.estimate ? ` / ~${fmt(e.estimate)}` : ' · no estimate'}</Badge>
        <Badge icon="zap" tone={e.costActual != null ? 'ok' : undefined} title={e.costActual != null ? 'Actual cost so far (from the session’s token usage)' : 'Estimated cost'}>
          {e.costActual != null ? money(e.costActual) : e.costEstimate != null ? `~${money(e.costEstimate)}` : 'no cost estimate'}
        </Badge>
        {e.stepsTotal > 0 && <Badge icon="list">{e.stepsDone}/{e.stepsTotal} steps</Badge>}
        <Badge tone="muted" title={`Where it runs${e.host ? `: ${e.host}` : ''}`}>{e.source}{e.host && e.host !== e.source ? ` · ${e.host}` : ''}</Badge>
        {e.branch && <Badge icon="git-branch" tone="muted">{e.branch}</Badge>}
        {e.row && <button type="button" className="axp-build-manager__act" onClick={() => rt.dispatch(`build-manager.open:${encodeURIComponent(e.row!.key)}`)}><Icon name="arrow-right" size={11} />Item</button>}
        {rt.actions.get('codebase-changes.open') && <button type="button" className="axp-build-manager__act" onClick={() => rt.dispatch(`codebase-changes.open:${e.changeId}`)}><Icon name="list" size={11} />Log</button>}
      </div>
      {e.currentStep && <p className="axp-build-manager__live-step"><Icon name="chevron-right" size={12} />{e.currentStep}</p>}
      {pct != null && <Bar value={pct} label={`${e.title} progress`} />}
    </li>
  );
}

/** Everything in progress: builds reported by sessions (through axHub) + activity items + builds marked in progress. */
export function useLive() {
  const s = useStore();
  const sessions = useMemo(() => liveFromChanges(s.changes, s.rows, s.now), [s.changes, s.rows, s.now]);
  // an activity item about the same build as a session entry shows once (the session entry has more detail)
  const coveredRows = new Set(sessions.map((e) => e.row?.key).filter(Boolean));
  const activity = s.live.filter((e) => !(e.row && coveredRows.has(e.row.key) && e.id.startsWith('row:')));
  return { sessions, activity, finished: s.finished };
}

export function LiveTracker({ compact, query = '' }: { compact?: boolean; query?: string }) {
  const s = useStore();
  const { sessions: sess0, activity: act0, finished: fin0 } = useLive();
  const now = useNow(sess0.length > 0 || act0.length > 0 || fin0.length > 0);
  const sessions = sess0.filter((e) => matches(query, e));
  const live = (compact ? act0.filter((e) => e.row) : act0).filter((e) => matches(query, { ...e, ...(e.row ?? {}) }));
  const fin = (compact ? fin0.filter((e) => e.row) : fin0).filter((e) => matches(query, e));
  const n = sessions.length + live.length;
  return (
    <section className="axp-build-manager__tracker" aria-label="Building now" aria-live="polite">
      <div className="axp-build-manager__tracker-head">
        <span className={n ? 'axp-build-manager__spin' : ''} aria-hidden><Icon name={n ? 'refresh' : 'check-circle'} size={16} /></span>
        <strong>{n ? `${n} in progress` : query ? 'Nothing in progress matches' : 'Nothing building right now'}</strong>
        <Badge tone={s.realtime ? 'ok' : 'muted'} icon={s.realtime ? 'zap' : 'clock'} title={s.realtime ? 'Live: updates the moment any session (any machine) reports to axHub' : 'Checking every few seconds (live stream reconnecting)'}>{s.realtime ? 'live' : 'polling'}</Badge>
        {s.changesAvailable === false && <Badge tone="muted" title={s.changesError || 'The build log (axf.changes@1, Codebase changes plugin) isn’t available: sessions’ builds can’t be shown.'}>no build log</Badge>}
        {s.liveAvailable === false && <Badge tone="muted" title={s.liveError || 'The activity feed (axf.activity@1) isn’t available: install or switch on the Activity plugin for GitHub runs, console updates, assistant replies and VPS jobs.'}>no activity feed</Badge>}
        <button type="button" className="axp-build-manager__act" onClick={() => { void loadLive(); void loadChanges(true); }} title="Check now"><Icon name="refresh" size={11} />Check</button>
      </div>
      {(n > 0 || fin.length > 0) && (
        <ul className="axp-build-manager__live-list">
          {sessions.map((e) => <SessionEntry key={e.id} e={e} now={now} />)}
          {live.map((e) => <TrackerEntry key={e.id} e={e} now={now} />)}
          {fin.map((e) => <TrackerEntry key={`f-${e.id}`} e={e} now={now} finished />)}
        </ul>
      )}
      {!compact && !n && !query && <p className="fx-small fx-muted" style={{ margin: 0 }}>Every Claude session (VPS, other computers, claude.ai, launches from here) reports here through axHub before it starts building.</p>}
    </section>
  );
}

/* ---------------- Start build now ---------------- */

const JOB_LABEL: Record<string, string> = { asking: 'Asking axHub…', waiting: 'Waiting for your approval', launching: 'Starting…', launched: 'Running on the VPS', rejected: 'Rejected', expired: 'Approval expired', failed: 'Failed' };

export function StartPanel({ row, onClose }: { row: Row; onClose: () => void }) {
  const rt = useRuntime();
  const s = useStore();
  const [plan, setPlan] = useState<StartPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const job = s.jobs[row.key];
  useEffect(() => { let on = true; planBuild(row.key).then((p) => on && setPlan(p), (e: Error) => on && setErr(e.message)); return () => { on = false; }; }, [row.key]);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await startBuild(row.key);
      if (!r.ok) setPlan(r.plan ?? plan);
      else if (r.job?.approvalUrl) rt.toast('Approve it on axHub to start', 'info');
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="axp-build-manager__start" role="region" aria-label={`Start ${row.title}`}>
      <div className="axp-build-manager__start-head"><Icon name="play" size={14} /><strong>Start build now</strong><span className="fx-grow" /><button type="button" className="fx-iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" size={14} /></button></div>
      {err && <p className="fx-small axp-build-manager__error" role="alert">{err}</p>}
      {!plan && !err && <p className="fx-small fx-muted">Planning: dependencies, what’s running, model…</p>}
      {plan && !plan.ok && <p className="fx-small axp-build-manager__error" role="alert">{plan.refuse ?? plan.wait}</p>}
      {plan && plan.ok && (
        <>
          <dl className="axp-build-manager__facts">
            <dt>Model</dt><dd><ModelChip model={(plan.model ?? 'opus').replace(/^./, (c) => c.toUpperCase())} /></dd>
            <dt>Branch</dt><dd><code>{plan.branch}</code></dd>
            <dt>Estimate</dt><dd>{plan.estimate?.minutes ? `${fmt(plan.estimate.minutes)} · ~${money(plan.estimate.costUsd ?? null)}` : 'none'}</dd>
            <dt>First</dt><dd>{plan.deps?.length ? plan.deps.map((d) => d.title).join(' → ') : 'no unbuilt dependencies'}</dd>
            {plan.order ? <><dt>Queue</dt><dd>reordered so its dependencies build first</dd></> : null}
            <dt>Checks after</dt><dd>{plan.verify?.map((v) => v.name).join(', ')}</dd>
          </dl>
          <p className="fx-small fx-muted" style={{ margin: 0 }}>Runs headless Claude Code on the VPS on its own branch through axHub <code>vps.run</code>. You approve it on axHub first (the page shows the whole command). Nothing is merged.</p>
          {!job || ['rejected', 'expired', 'failed'].includes(job.state)
            ? <div className="axp-build-manager__actions"><Button icon="play" onClick={() => void go()} disabled={busy}>{busy ? 'Starting…' : job ? 'Try again' : 'Start on the VPS'}</Button></div>
            : null}
        </>
      )}
      {job && (
        <div className="axp-build-manager__job">
          <Badge icon={job.state === 'launched' ? 'check' : job.state === 'waiting' ? 'clock' : ['rejected', 'expired', 'failed'].includes(job.state) ? 'x' : 'refresh'} tone={job.state === 'launched' ? 'ok' : job.state === 'waiting' ? 'warn' : ['rejected', 'expired', 'failed'].includes(job.state) ? 'danger' : undefined}>{JOB_LABEL[job.state] ?? job.state}</Badge>
          <span className="fx-small">{job.message}</span>
          {job.approvalUrl && job.state === 'waiting' && <a className="axp-build-manager__act" href={job.approvalUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={11} />Approve on axHub</a>}
          {job.state === 'waiting' && <span className="fx-small fx-muted">Retrying by itself ({job.attempts ?? 0}): every 15 s, then every minute.</span>}
        </div>
      )}
    </div>
  );
}

/* ---------------- Built (history) ---------------- */

function BuiltView({ query }: { query: string }) {
  const rt = useRuntime();
  const s = useStore();
  const [model, setModel] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [cost, setCost] = useState<'' | 'actual' | 'estimated'>('');
  const [group, setGroup] = useState<'model' | 'week'>('model');
  const [limit, setLimit] = useState(40);
  const [busy, setBusy] = useState('');
  const all = useMemo(() => builtRows(s.changes), [s.changes]);
  const shown = useMemo(() => filterBuilt(all, { model, period, cost }).filter((r) => matches(query, r)), [all, model, period, cost, query]);
  const t = builtTotals(shown);
  const models = [...new Set(all.map((r) => r.model))];
  const verify = async (id: string) => { setBusy(id); try { rt.toast(await verifyBuild(id), 'info'); } catch (e) { rt.toast((e as Error).message, 'warning'); } setBusy(''); };
  return (
    <section className="axp-build-manager__built" aria-label="Built">
      <div className="axp-build-manager__totals" role="list" aria-label="Totals">
        <div role="listitem" className="axp-build-manager__total is-all">
          <span className="axp-build-manager__total-label">Built</span>
          <strong>{t.all.count}</strong>
          <span className="fx-small fx-muted">{fmt(t.all.minutes) || '0 min'} · {money(t.all.cost)}{t.all.estimatedCost ? ` (${money(t.all.estimatedCost)} estimated)` : ''}</span>
        </div>
        {Object.entries(group === 'model' ? t.byModel : t.byWeek).slice(0, 8).map(([k, v]) => (
          <div key={k} role="listitem" className={`axp-build-manager__total is-${k.toLowerCase()}`}>
            <span className="axp-build-manager__total-label">{k}</span>
            <strong>{money(v.cost)}</strong>
            <span className="fx-small fx-muted">{v.count} builds · {fmt(v.minutes) || '0 min'}</span>
          </div>
        ))}
      </div>
      <div className="axp-build-manager__filters" role="group" aria-label="Filter the history">
        <label className="axp-build-manager__field"><span>Model</span>
          <select className="fx-input" value={model} onChange={(e) => setModel(e.target.value)}><option value="">All</option>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <label className="axp-build-manager__field"><span>When</span>
          <select className="fx-input" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select>
        </label>
        <label className="axp-build-manager__field"><span>Cost</span>
          <select className="fx-input" value={cost} onChange={(e) => setCost(e.target.value as '' | 'actual' | 'estimated')}><option value="">All</option><option value="actual">Actual</option><option value="estimated">Estimated</option></select>
        </label>
        <label className="axp-build-manager__field"><span>Totals by</span>
          <select className="fx-input" value={group} onChange={(e) => setGroup(e.target.value as 'model' | 'week')}><option value="model">Model</option><option value="week">Week</option></select>
        </label>
      </div>
      {!s.changesLoaded ? <div className="fx-empty">Loading the history…</div>
        : !shown.length ? <div className="fx-empty">{all.length ? 'Nothing built matches.' : s.changesAvailable === false ? 'The build log isn’t available (Codebase changes plugin off?).' : 'Nothing recorded yet.'}</div>
          : (
            <ul className="axp-build-manager__list" aria-label={`${shown.length} builds`}>
              {shown.slice(0, limit).map((r) => (
                <li key={r.id} className={`axp-build-manager__row${r.status === 'failed' ? ' is-failed' : ''}`}>
                  <div className="axp-build-manager__head is-static">
                    <span className="axp-build-manager__title-line"><span className="axp-build-manager__title">{r.title}</span></span>
                    <span className="axp-build-manager__chips">
                      <ModelChip model={r.model === 'Other' ? 'Opus' : r.model} />
                      <Badge icon="calendar" tone="muted">{r.day}</Badge>
                      <Badge icon="clock" title={r.minutesEstimated ? 'Estimated time' : 'Actual time'}>{r.minutes != null ? `${r.minutesEstimated ? '~' : ''}${fmt(r.minutes) || '0 min'}` : '—'}</Badge>
                      <Badge icon="zap" tone={r.costEstimated ? undefined : 'ok'} title={r.costEstimated ? 'Estimated (no token counts for this build)' : 'Actual cost from the session’s token usage'}>{r.cost != null ? `${r.costEstimated ? '~' : ''}${money(r.cost)}` : '—'}</Badge>
                      {r.costEstimated && r.cost != null && <Badge tone="muted">estimated</Badge>}
                      {r.status === 'failed' && <Badge tone="danger" icon="x">{r.resultState || 'failed'}</Badge>}
                      {r.verify && <Badge tone={r.verify === 'verified' ? 'ok' : r.verify === 'broken' ? 'danger' : 'muted'} icon={r.verify === 'verified' ? 'check' : r.verify === 'broken' ? 'alert' : 'clock'}>{r.verify}</Badge>}
                      {r.surface === 'backfill' && <Badge tone="muted" title="Recorded afterwards from the repo’s history">backfill</Badge>}
                    </span>
                    <span className="axp-build-manager__chips">
                      {r.branch && <Badge icon="git-branch" tone="muted">{r.branch}</Badge>}
                      {r.commits.slice(-2).map((c) => <a key={c} className="axp-build-manager__act" href={`https://github.com/${r.repos[0] ?? 'MossesX/AmberX-AXF'}/commit/${c}`} target="_blank" rel="noopener noreferrer"><Icon name="git-commit" size={11} />{c.slice(0, 7)}</a>)}
                      {Object.entries(r.links).slice(0, 3).map(([k, v]) => <a key={k} className="axp-build-manager__act" href={v.startsWith('https://') ? v : `https://github.com/${r.repos[0] ?? 'MossesX/AmberX-AXF'}/blob/main/${v}`} target="_blank" rel="noopener noreferrer"><Icon name="external" size={11} />{k}</a>)}
                      {rt.actions.get('codebase-changes.open') && <button type="button" className="axp-build-manager__act" onClick={() => rt.dispatch(`codebase-changes.open:${r.id}`)}><Icon name="list" size={11} />Log</button>}
                      {r.surface === 'console-launch' && r.status === 'done' && <button type="button" className="axp-build-manager__act" disabled={busy === r.id} onClick={() => void verify(r.id)}><Icon name="check-circle" size={11} />{busy === r.id ? 'Checking…' : 'Check nothing broke'}</button>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
      {shown.length > limit && <div className="axp-build-manager__actions"><Button onClick={() => setLimit(limit + 40)}>Show more ({shown.length - limit})</Button></div>}
    </section>
  );
}

/* ---------------- the list ---------------- */

function StepsList({ row, canTick }: { row: Row; canTick: boolean }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(-1);
  if (!row.steps.length) {
    return <p className="fx-small fx-muted axp-build-manager__none">{row.needsSplit ? 'No steps yet. Split it into steps of 30 minutes or less (each with its own estimate) on its Pending builds / Build queue page.' : row.source === 'plan' ? 'A plan feature: no steps recorded.' : 'No steps: it’s built in one go.'}</p>;
  }
  const tick = async (i: number, done: boolean) => {
    setBusy(i);
    const err = await tickStep(row, i, done);
    setBusy(-1);
    if (err) rt.toast(err, 'warning');
  };
  return (
    <ol className="axp-build-manager__steps">
      {row.steps.map((st, i) => (
        <li key={`${i}-${st.text.slice(0, 20)}`} className={st.done ? 'is-done' : ''}>
          <label className="axp-build-manager__step">
            <input type="checkbox" checked={st.done} disabled={!canTick || busy >= 0} onChange={(e) => void tick(i, e.target.checked)}
              aria-label={`${st.done ? 'Done' : 'Not done'}: step ${i + 1}`} title={canTick ? 'Tick when done' : 'Read-only: this console has no step action yet'} />
            <span className="axp-build-manager__step-text">{st.text}</span>
          </label>
          <span className="axp-build-manager__step-time">{st.estimateText ? `~${st.estimateText}` : <span className="fx-muted">no estimate</span>}</span>
        </li>
      ))}
    </ol>
  );
}

/** What taking a row off does, per source (shown before it happens). */
const takeOffText = (row: Row, how: GoneKind) =>
  row.source === 'pending' ? (how === 'built' ? 'marks the pending item complete' : 'deletes the pending item')
    : row.source === 'queue' ? (how === 'built' ? 'completes the build-queue step (its plan features become built)' : 'drops the step from the plan')
      : how === 'built' ? 'sets the plan feature to built' : 'drops the plan feature';

/** Take one build off the list: Already built / Removed, then a confirm. */
function TakeOffRow({ row }: { row: Row }) {
  const rt = useRuntime();
  const [ask, setAsk] = useState<GoneKind | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (how: GoneKind) => {
    setBusy(true);
    const r = await takeOff([{ row, how }]);
    setBusy(false); setAsk(null);
    rt.toast(r.errors.length ? r.errors.join('\n') : `${row.title}: taken off the list (${GONE_LABEL[how].toLowerCase()}).`, r.errors.length ? 'warning' : 'success');
  };
  if (ask) {
    return (
      <div className="axp-build-manager__takeoff" role="group" aria-label="Take off the list">
        <span className="fx-small">Take off as <strong>{GONE_LABEL[ask].toLowerCase()}</strong>? This {takeOffText(row, ask)}.</span>
        <button type="button" className="axp-build-manager__act is-danger" disabled={busy} onClick={() => void go(ask)}><Icon name="check" size={11} />{busy ? 'Working…' : 'Yes, take it off'}</button>
        <button type="button" className="axp-build-manager__act" disabled={busy} onClick={() => setAsk(null)}><Icon name="x" size={11} />Cancel</button>
      </div>
    );
  }
  return (
    <div className="axp-build-manager__takeoff" role="group" aria-label="Take off the list">
      {row.gone && <span className="fx-small fx-muted">Looks {row.gone.kind}: {row.gone.why}.</span>}
      <button type="button" className="axp-build-manager__act" onClick={() => setAsk('built')}><Icon name="check-circle" size={11} />Already built</button>
      <button type="button" className="axp-build-manager__act" onClick={() => setAsk('removed')}><Icon name="trash" size={11} />Removed</button>
    </div>
  );
}

/** The Clean up panel: every build that looks already built or removed, ticked, taken off in one go. */
function CleanUp({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  const rt = useRuntime();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map((r) => r.key)));
  const [busy, setBusy] = useState(false);
  const list = rows.filter((r) => picked.has(r.key));
  const run = async () => {
    setBusy(true);
    const r = await takeOff(list.map((row) => ({ row, how: row.gone!.kind })));
    setBusy(false);
    rt.toast(r.errors.length ? `Took ${r.done} off; ${r.errors.length} failed:\n${r.errors.join('\n')}` : `Took ${r.done} build${r.done === 1 ? '' : 's'} off the list.`, r.errors.length ? 'warning' : 'success');
    if (!r.errors.length) onClose();
  };
  return (
    <section className="axp-build-manager__cleanup" aria-label="Clean up the build list">
      <div className="axp-build-manager__tracker-head">
        <Icon name="check-circle" size={16} />
        <strong>{rows.length ? `${rows.length} look${rows.length === 1 ? 's' : ''} already built or removed` : 'Nothing looks built or removed'}</strong>
      </div>
      {rows.length > 0 && (
        <>
          <p className="fx-small fx-muted">Untick anything that should stay. Built ones are marked complete or built; removed ones are deleted (pending) or dropped (queue, plan). For anything else, open the build and use <em>Already built</em> or <em>Removed</em>.</p>
          <ul className="axp-build-manager__cleanup-list">
            {rows.map((r) => (
              <li key={r.key}>
                <label className="axp-build-manager__step">
                  <input type="checkbox" checked={picked.has(r.key)} disabled={busy}
                    onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} />
                  <span className="axp-build-manager__step-text"><strong>{r.title}</strong> <span className="fx-muted">· {SOURCE_LABEL[r.source]} · {GONE_LABEL[r.gone!.kind]}: {r.gone!.why}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="axp-build-manager__actions">
        {rows.length > 0 && <button type="button" className="axp-build-manager__act is-danger" disabled={busy || !list.length} onClick={() => void run()}><Icon name="check" size={11} />{busy ? 'Working…' : `Take ${list.length} off the list`}</button>}
        <button type="button" className="axp-build-manager__act" disabled={busy} onClick={onClose}><Icon name="x" size={11} />Close</button>
      </div>
    </section>
  );
}

function BuildRow({ row, open, onToggle, canTick }: { row: Row; open: boolean; onToggle: () => void; canTick: boolean }) {
  const rt = useRuntime();
  const s = useStore();
  const [starting, setStarting] = useState(false);
  useEffect(() => onStartRequest((k) => { if (k === row.key) setStarting(true); }), [row.key]);
  const job = s.jobs[row.key];
  const go = () => rt.navigate(row.source === 'pending' ? 'pending' : row.source === 'queue' ? 'build' : 'plan');
  return (
    <li id={`axp-bm-${row.key.replace(/[^a-z0-9-]/gi, '-')}`} className={`axp-build-manager__row${open ? ' is-open' : ''}${row.building ? ' is-building' : ''}`}
      data-fx-ctx-target="axf-build-item" data-fx-ctx-payload={row.key}>
      <button type="button" className="axp-build-manager__head" aria-expanded={open} onClick={onToggle}>
        <span className="axp-build-manager__title-line">
          <span className="axp-build-manager__title">{row.title}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
        <span className="axp-build-manager__chips">
          <Badge icon={SOURCE_ICON[row.source]}>{SOURCE_LABEL[row.source]}</Badge>
          {row.origin === 'auto' && <Badge icon={ORIGIN_ICON.auto} title={`Added automatically by ${addedByLabel(row.addedBy)}`}>auto</Badge>}
          <ModelChip model={row.model} />
          {(row.building || row.statusLabel !== SOURCE_LABEL[row.source]) && <Badge tone={row.status === 'unsafe' || row.status === 'broken' || row.status === 'failed' || row.status === 'rework' ? 'warn' : row.building ? 'ok' : undefined}>{row.building ? 'Building' : row.statusLabel}</Badge>}
          <SplitBadge row={row} />
          {row.gone && <Badge icon={row.gone.kind === 'built' ? 'check' : 'trash'} tone="muted" title={`Looks ${row.gone.kind}: ${row.gone.why}`}>Looks {row.gone.kind}</Badge>}
          {job && <Badge tone={job.state === 'waiting' ? 'warn' : job.state === 'launched' ? 'ok' : ['failed', 'rejected', 'expired'].includes(job.state) ? 'danger' : undefined} icon="play">{JOB_LABEL[job.state] ?? job.state}</Badge>}
          <span className="fx-grow" />
          <TimeLeft row={row} />
        </span>
        {row.stepsTotal > 0 && (
          <span className="axp-build-manager__progress">
            <Bar value={row.stepsDone / row.stepsTotal} label={`${row.title}: ${row.stepsDone} of ${row.stepsTotal} steps done`} />
            <span className="axp-build-manager__count">{row.stepsDone} of {row.stepsTotal}</span>
          </span>
        )}
      </button>
      <button type="button" className="axp-build-manager__act axp-build-manager__start-btn" onClick={() => setStarting(true)} aria-label={`Start building ${row.title} now`} title="Start build now (dependencies first, never on top of a running build)">
        <Icon name="play" size={11} />Start
      </button>
      {starting && <StartPanel row={row} onClose={() => setStarting(false)} />}
      {open && (
        <div className="axp-build-manager__body">
          {row.detail && <p className="axp-build-manager__detail">{row.detail.length > 400 ? `${row.detail.slice(0, 400)}…` : row.detail}</p>}
          <dl className="axp-build-manager__facts">
            <dt>Id</dt><dd><code>{row.id}</code></dd>
            <dt>Estimate</dt><dd>{row.total != null ? `${fmt(row.total)}${row.estimateText && row.steps.length ? ' (steps added up or its own)' : ''}` : 'none yet'}</dd>
            {row.queuePosition ? <><dt>Build queue</dt><dd>step {row.queuePosition}</dd></> : null}
            {row.planId ? <><dt>Plan</dt><dd><code>{row.planId}</code></dd></> : null}
            {row.effort ? <><dt>Effort</dt><dd>{row.effort}</dd></> : null}
          </dl>
          <StepsList row={row} canTick={canTick} />
          {row.features?.length ? <p className="fx-small fx-muted axp-build-manager__none">Plan features in this step: {row.features.filter((f) => f.status !== 'built').length} to build of {row.features.length}.</p> : null}
          <div className="axp-build-manager__actions">
            <button type="button" className="axp-build-manager__act" onClick={go}><Icon name="arrow-right" size={11} />Open in {row.source === 'pending' ? 'Pending builds' : row.source === 'queue' ? 'Build queue' : 'Plan'}</button>
            {row.fable && rt.actions.get('fable-rebuilds.open') && <button type="button" className="axp-build-manager__act" onClick={() => rt.dispatch(`fable-rebuilds.open:${encodeURIComponent(row.id)}`)}><Icon name="sparkles" size={11} />Fable rebuild</button>}
          </div>
          <TakeOffRow row={row} />
          {!canTick && row.steps.length > 0 && <p className="fx-small fx-muted axp-build-manager__none">Ticks are read-only on this console until the {row.source === 'pending' ? 'pending list' : 'build queue'} gets its step action.</p>}
        </div>
      )}
    </li>
  );
}

function Totals({ rows }: { rows: Row[] }) {
  const t = totalsByModel(rows);
  return (
    <div className="axp-build-manager__totals" role="list" aria-label="Time left by model">
      {MODELS.map((m) => (
        <div key={m} role="listitem" className={`axp-build-manager__total is-${m.toLowerCase()}`}>
          <span className="axp-build-manager__total-label">{m}</span>
          <strong>{fmt(t[m].left) || '0 min'}</strong>
          <span className="fx-small fx-muted">{t[m].count} builds{t[m].noEstimate ? ` · ${t[m].noEstimate} no estimate` : ''}</span>
        </div>
      ))}
      <div role="listitem" className="axp-build-manager__total is-all">
        <span className="axp-build-manager__total-label">All</span>
        <strong>{fmt(t.all.left) || '0 min'}</strong>
        <span className="fx-small fx-muted">{t.all.count} builds{t.all.needsSplit ? ` · ${t.all.needsSplit} need split` : ''}</span>
      </div>
    </div>
  );
}

type Tab = 'remaining' | 'live' | 'built';
const TAB_KEY = 'axp-build-manager:tab';
const readTab = (): Tab => { try { const t = localStorage.getItem(TAB_KEY); return t === 'live' || t === 'built' ? t : 'remaining'; } catch { return 'remaining'; } };

export function BuildManagerView() {
  const s = useStore();
  const [tab, setTab0] = useState<Tab>(readTab);
  const setTab = (t: Tab) => { setTab0(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* private window */ } };
  const [query, setQuery] = useState('');
  const { sessions, activity } = useLive();
  const liveCount = sessions.length + activity.length;
  const builtCount = useMemo(() => builtRows(s.changes).length, [s.changes]);
  const [model, setModel] = useState('');
  const [sources, setSources] = useState<Source[]>(() => enabledSources());
  const [status, setStatus] = useState('');
  const [split, setSplit] = useState(false);
  const [origins, setOrigins] = useState<Origin[]>([...ORIGINS]);
  const [addedBy, setAddedBy] = useState('');
  const [sort, setSort] = useState<SortKey>(() => defaultSort());
  const [open, setOpen] = useState<Set<string>>(() => { const f = takeFocus(); return new Set(f ? [f] : []); });
  useEffect(() => { void loadList(); }, []);
  // A focus request (search, context menu, tracker) opens and scrolls to the row.
  useEffect(() => onStore(() => { const f = takeFocus(); if (f) { setOpen((o) => new Set([...o, f])); setTimeout(() => document.getElementById(`axp-bm-${f.replace(/[^a-z0-9-]/gi, '-')}`)?.scrollIntoView({ block: 'center' }), 50); } }), []);
  useEffect(() => { const f = [...open][0]; if (f) setTimeout(() => document.getElementById(`axp-bm-${f.replace(/[^a-z0-9-]/gi, '-')}`)?.scrollIntoView({ block: 'center' }), 50); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const allowed = enabledSources();
  const base = useMemo(() => s.rows.filter((r) => allowed.includes(r.source)), [s.rows, allowed.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => sortRows(filterRows(base, { model, sources, origins, addedBy, status, split }), sort).filter((r) => matches(query, r)), [base, model, sources, origins, addedBy, status, split, sort, query]);
  // a search that hits only other tabs says so
  const hits = useMemo(() => query ? {
    remaining: base.filter((r) => matches(query, r)).length,
    live: sessions.filter((e) => matches(query, e)).length + activity.filter((e) => matches(query, { ...e, ...(e.row ?? {}) })).length,
    built: builtRows(s.changes).filter((r) => matches(query, r)).length,
  } : null, [query, base, sessions, activity, s.changes]);
  const statuses = useMemo(() => statusesOf(base), [base]);
  const adders = useMemo(() => addedByOf(base), [base]);
  const t = totalsByModel(base);
  const gone = useMemo(() => goneRows(base), [base]);
  const [cleaning, setCleaning] = useState(false);
  const [sorting, setSorting] = useState(false);
  // how many of the dialog's choices differ from their defaults (shown as the Filter & sort badge)
  const picked = [model, addedBy, status].filter(Boolean).length + (sort !== defaultSort() ? 1 : 0);
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const canTick = (r: Row) => (r.source === 'pending' ? s.canTickPending : r.source === 'queue' ? s.canTickQueue : false);

  return (
    <div className="fx-page axp-build-manager">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">{t.all.count} to build · {fmt(t.all.left) || '0 min'} left{t.all.noEstimate ? ` · ${t.all.noEstimate} without an estimate` : ''}{t.all.needsSplit ? ` · ${t.all.needsSplit} need split` : ''}</p>
          <h1>Build manager</h1>
          <p className="fx-muted">Everything still to build, from the pending list, the build queue and the plan, with what’s building right now.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="check-circle" onClick={() => setCleaning(!cleaning)} title="Take off builds that are already built or removed">Clean up{gone.length ? ` (${gone.length})` : ''}</Button>
          <Button icon="refresh" onClick={() => { void loadList(); void loadLive(); void loadChanges(true); }}>Refresh</Button>
        </div>
      </header>

      {cleaning && <CleanUp rows={gone} onClose={() => setCleaning(false)} />}

      <div className="axp-build-manager__search" role="search">
        <Icon name="search" size={14} />
        <input className="fx-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search builds: title, id, notes, model, branch…" aria-label="Search remaining, live and built builds" />
        {query && <button type="button" className="fx-iconbtn" aria-label="Clear the search" onClick={() => setQuery('')}><Icon name="x" size={14} /></button>}
      </div>

      <div className="axp-build-manager__tabs" role="tablist" aria-label="Build manager views">
        {([['remaining', 'Remaining', base.length, 'list'], ['live', 'Live', liveCount, 'refresh'], ['built', 'Built', builtCount, 'check-circle']] as const).map(([id, label, n, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`axp-build-manager__tab${tab === id ? ' is-on' : ''}${id === 'live' && liveCount ? ' is-busy' : ''}`} onClick={() => setTab(id)}>
            <Icon name={icon} size={12} />{label} <span className="axp-build-manager__tab-n">{hits ? `${hits[id]}/${n}` : n}</span>
          </button>
        ))}
      </div>

      {tab === 'live' && <LiveTracker query={query} />}
      {tab === 'built' && <BuiltView query={query} />}
      {tab === 'remaining' && liveCount > 0 && !query && <LiveTracker compact />}
      {tab === 'remaining' && <>
      <Totals rows={base} />

      <div className="axp-build-manager__tools" role="toolbar" aria-label="Filter the builds">
        {SOURCES.filter((x) => allowed.includes(x)).map((x) => (
          <ToolToggle key={x} icon={SOURCE_ICON[x]} label={SOURCE_LABEL[x]} title={`Show builds from the ${SOURCE_LABEL[x].toLowerCase()} list`} count={base.filter((r) => r.source === x).length} on={sources.includes(x)}
            onClick={() => setSources((cur) => (cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]))} />
        ))}
        <span className="axp-build-manager__tools-sep" aria-hidden="true" />
        {ORIGINS.map((x) => (
          <ToolToggle key={x} icon={ORIGIN_ICON[x]} label={ORIGIN_SHORT[x]} count={base.filter((r) => r.origin === x).length} on={origins.includes(x)}
            title={x === 'prompt' ? `${ORIGIN_LABEL[x]}: asked for in a chat or Claude Code session, the Add form or the claude.ai page` : `${ORIGIN_LABEL[x]}: parked by a tool (Fable rebuilds, feature assistant, plan sync), build-queue steps and plan features`}
            onClick={() => setOrigins((cur) => (cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]))} />
        ))}
        <span className="axp-build-manager__tools-sep" aria-hidden="true" />
        <ToolToggle icon="alert" label="Split" title="Only builds over 30 min that still need splitting into steps" count={base.filter((r) => r.needsSplit).length} on={split} onClick={() => setSplit(!split)} />
        <span className="axp-build-manager__tools-sep" aria-hidden="true" />
        <ToolToggle icon="sliders" label="Filter & sort" title="Model, who added it, status and sort order" count={picked} on={picked > 0} quiet onClick={() => setSorting(true)} pressed={null} />
      </div>
      {sorting && <FilterSortDialog onClose={() => setSorting(false)} model={model} setModel={setModel} addedBy={addedBy} setAddedBy={setAddedBy} adders={adders}
        status={status} setStatus={setStatus} statuses={statuses} sort={sort} setSort={setSort} shown={shown.length} />}

      {s.error && <p className="fx-small axp-build-manager__error" role="alert">{s.error}</p>}
      {s.offline && <p className="fx-small fx-muted">The console API is offline: showing the snapshot that came with the page.</p>}
      {!s.loaded ? <div className="fx-empty">Loading the build list…</div>
        : shown.length === 0 ? <div className="fx-empty">{query && hits && (hits.live || hits.built) ? `Nothing remaining matches: ${hits.live} live, ${hits.built} built.` : base.length ? 'Nothing matches these filters.' : 'Nothing left to build.'}</div>
          : <ul className="axp-build-manager__list" aria-label={`${shown.length} builds`}>{shown.map((r) => <BuildRow key={r.key} row={r} open={open.has(r.key)} onToggle={() => toggle(r.key)} canTick={canTick(r)} />)}</ul>}
      </>}
    </div>
  );
}

/* ---------------- the banner ---------------- */

export function BuildBanner() {
  const rt = useRuntime();
  const s = useStore();
  const now = useNow(true);
  const { sessions } = useLive();
  // Launches expanded; "_" folds it to its title line, the chevron unfolds it (Brett, Oct 21 2026: building banners
  // minimize, they don't close).
  const [full, setFull] = useState(true);
  const fold = full
    ? <button type="button" className="fx-iconbtn" aria-label="Minimize" title="Minimize to one line" onClick={() => setFull(false)}><Icon name="minimize" size={16} /></button>
    : <button type="button" className="fx-iconbtn" aria-label="Expand" title="Show the details" aria-expanded={false} onClick={() => setFull(true)}><Icon name="chevron-down" size={16} /></button>;
  const live = s.live.filter((e) => e.row);
  const fin = s.finished.filter((e) => e.row);
  if (!bannerOn()) return null;
  // Builds reported by sessions (any machine, through axHub) come first: they carry estimates, cost and where they run.
  const running = sessions.filter((e) => !e.parent);
  if (running.length) {
    const key = `chg:${running.map((e) => e.changeId).join(',')}`;
    if (key === s.hiddenFor) return null;
    const first = running[0]!;
    const elapsed = first.startedAt ? now - first.startedAt : null;
    const cost = first.costActual ?? first.costEstimate;
    const more = running.length - 1 + live.filter((e) => !running.some((r) => r.row && r.row.key === e.row?.key)).length;
    return (
      <div className={`axp-build-manager-banner${first.stale ? ' is-failed' : ''}`} role="status" aria-live="polite">
        <button type="button" className="axp-build-manager-banner__main" onClick={() => rt.dispatch(first.row ? `build-manager.open:${encodeURIComponent(first.row.key)}` : 'build-manager.live')} title="Open the Build manager (Live)">
          <span className={first.stale ? '' : 'axp-build-manager__spin'} aria-hidden><Icon name={first.stale ? 'alert' : 'refresh'} size={16} /></span>
          <span className="axp-build-manager-banner__text">
            <strong>{first.stale ? 'No word from: ' : first.state === 'queued' ? 'Waiting to start: ' : 'Building: '}{first.title}</strong>
            {full && <span className="axp-build-manager-banner__meta">
              <ModelChip model={first.model === 'Other' ? 'Opus' : first.model} />
              <Badge icon="clock">{dur(elapsed)}{first.estimate ? ` / ~${fmt(first.estimate)}` : ''}</Badge>
              {cost != null && <Badge icon="zap">{first.costActual == null ? '~' : ''}{money(cost)}</Badge>}
              {first.stepsTotal > 0 && <Badge icon="list">{first.stepsDone}/{first.stepsTotal}</Badge>}
              <Badge tone="muted">{first.source}{first.host && first.host !== first.source ? ` · ${first.host}` : ''}</Badge>
              {more > 0 && <Badge>+{more} more</Badge>}
            </span>}
            {full && first.currentStep && <span className="axp-build-manager-banner__step">{first.currentStep}</span>}
            {full && first.progress != null && <Bar value={first.progress} label="Build progress" />}
          </span>
        </button>
        {fold}
      </div>
    );
  }
  if (!live.length && !fin.length) return null;
  const key = live.map((e) => e.id).join(',') || `done:${fin.map((e) => e.id).join(',')}`;
  if (key === s.hiddenFor) return null;
  const first = live[0] ?? fin[0]!;
  const elapsed = first.startedAt ? (first.finishedAt || now) - first.startedAt : null;
  const failed = !live.length && fin.some((e) => /failed|stale|cancelled/.test(e.activityState));
  const pct = live.length ? first.progress : null;
  const summary = live.length ? `Building: ${first.row!.title}` : failed ? `Build failed: ${first.row!.title}` : `Built: ${first.row!.title}`;
  return (
    <div className={`axp-build-manager-banner${live.length ? '' : failed ? ' is-failed' : ' is-done'}`} role="status" aria-live="polite">
      <button type="button" className="axp-build-manager-banner__main" onClick={() => rt.dispatch(`build-manager.open:${encodeURIComponent(first.row!.key)}`)} title="Open the Build manager">
        <span className={live.length ? 'axp-build-manager__spin' : ''} aria-hidden><Icon name={live.length ? 'refresh' : failed ? 'x-circle' : 'check-circle'} size={16} /></span>
        <span className="axp-build-manager-banner__text">
          <strong>{summary}</strong>
          {full && <span className="axp-build-manager-banner__meta">
            <ModelChip model={first.row!.model} />
            <Badge icon="clock">{dur(elapsed)}{first.estimate ? ` / ~${fmt(first.estimate)}` : ''}</Badge>
            {first.row!.stepsTotal > 0 && <Badge icon="list">{first.row!.stepsDone}/{first.row!.stepsTotal}</Badge>}
            {live.length > 1 && <Badge>+{live.length - 1} more</Badge>}
          </span>}
          {full && pct != null && <Bar value={pct} label="Build progress" />}
        </span>
      </button>
      {fold}
    </div>
  );
}

/* ---------------- settings ---------------- */

export function SettingsSummary() {
  const s: Store = useStore();
  const t = totalsByModel(s.rows);
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>Everything still to build in one list (nav → Builds → Build manager), with a live tracker of what’s building and a banner while a build from the list is in progress.</p>
      <p className="fx-small" style={{ margin: 0 }}><strong>{t.all.count} builds · {fmt(t.all.left) || '0 min'} left</strong> · Fable {fmt(t.Fable.left) || '0 min'} · Opus {fmt(t.Opus.left) || '0 min'} · Sonnet {fmt(t.Sonnet.left) || '0 min'}</p>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        Live builds come from the activity feed (<code>axf.activity@1</code>{s.liveAvailable === false ? ': not available right now' : ''}); a run is linked to its build by its branch
        (<code>fable/&lt;id&gt;</code>, <code>rebuild/&lt;id&gt;</code>, <code>harvest/…</code>, <code>pilot/…</code>) or a report naming it.
        Step ticks: pending list {s.canTickPending ? 'on' : 'read-only (no step action yet)'}, build queue {s.canTickQueue ? 'on' : 'read-only (no step action yet)'}.
      </p>
    </div>
  );
}
