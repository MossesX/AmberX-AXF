/* Build manager — the banner, its live tracker and the settings panel (the page itself is flow.tsx: Pending + Complete). Theme tokens only. */
import { useEffect, useMemo, useState } from 'react';
import { WatchLiveFor } from '@console/watchLive';
import { Button, Icon, RefText, useBannerLaunchOpen, useRuntime, BannerIcon } from '@console/axf/react';
import {  totalsByModel, type LiveEntry, type Row } from './merge.mjs';
import { abandonBuild, bannerOn, isStuckLive, fmt, loadChanges, loadLive, planBuild, startBuild, useStore, usd, type StartPlan, type Store } from './store';
import {  liveFromChanges, matches, money, type ChangeLive } from './history.mjs';
import {  registerRowRefTarget } from '@console/axf/libs/datagrid';

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
        <span className="axp-build-manager__live-title"><RefText text={e.row ? e.row.title : e.title} /></span>
        {e.row && <ModelChip model={e.row.model} />}
      </div>
      <div className="axp-build-manager__live-meta">
        {finished ? <Badge icon={failed ? 'x' : 'check'} tone={failed ? 'danger' : 'ok'}>{failed ? 'Failed' : 'Finished'}</Badge> : null}
        <Badge icon={isStuckLive(e, now) ? 'alert' : 'clock'} tone={over || isStuckLive(e, now) ? 'warn' : undefined} title="Elapsed vs estimate">{dur(elapsed)}{e.estimate ? ` / ~${fmt(e.estimate)}` : ''}</Badge>
        {e.row && e.row.stepsTotal > 0 && <Badge icon="list">{e.row.stepsDone}/{e.row.stepsTotal} steps</Badge>}
        {!e.row && <Badge tone="muted" title="Not linked to anything on the build list">{e.source || 'Running'}</Badge>}
        {e.row && e.via && <Badge tone="muted" title="How this was linked to the build">{e.via}</Badge>}
        {e.row && <Button size="sm" tone="neutral" icon="arrow-right" onClick={() => rt.dispatch(`build-manager.open:${encodeURIComponent(e.row!.key)}`)}>Item</Button>}
        {e.url && <a className="fx-btn fx-btn--neutral fx-btn--sm axp-build-manager__act" href={e.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={11} />Open</a>}
      </div>
      {e.currentStep && !finished && <p className="axp-build-manager__live-step"><Icon name="chevron-right" size={12} />{e.currentStep}</p>}
      {pct != null && !finished && <Bar value={pct} label={`${e.title} progress`} />}
    </li>
  );
}

/** The trash can on a stuck build (no word for 10 min, or running 30+ min): failed (stalled) + closed everywhere. */
function TrashBuild({ e }: { e: ChangeLive }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="fx-iconbtn axp-build-manager__trash" disabled={busy} aria-label={`Remove stuck build "${e.title}"`}
      title="Stuck: mark it failed (stalled) and take it off the banners on every device; it stays in the build log"
      onClick={(ev) => { ev.stopPropagation(); setBusy(true); abandonBuild(e.changeId).catch((x: Error) => { setBusy(false); rt.toast(x.message, 'warning'); }); }}>
      <Icon name="trash" size={14} />
    </button>
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
        <span className="axp-build-manager__live-title"><RefText text={e.title} /></span>
        <ModelChip model={e.model === 'Other' ? 'Opus' : e.model} />
        {isStuckLive(e, now) && <TrashBuild e={e} />}
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
        {e.row && <Button size="sm" tone="neutral" icon="arrow-right" onClick={() => rt.dispatch(`build-manager.open:${encodeURIComponent(e.row!.key)}`)}>Item</Button>}
        {rt.actions.get('codebase-changes.open') && <Button size="sm" tone="neutral" icon="list" onClick={() => rt.dispatch(`codebase-changes.open:${e.changeId}`)}>Log</Button>}
        {!e.finishedAt && <WatchLiveFor change={e.changeId} branch={e.branch} />}
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
        <BannerIcon icon="check-circle" working={n > 0} size={16} />
        <strong>{n ? `${n} in progress` : query ? 'Nothing in progress matches' : 'Nothing building right now'}</strong>
        <Badge tone={s.realtime ? 'ok' : 'muted'} icon={s.realtime ? 'zap' : 'clock'} title={s.realtime ? 'Live: updates the moment any session (any machine) reports to axHub' : 'Checking every few seconds (live stream reconnecting)'}>{s.realtime ? 'live' : 'polling'}</Badge>
        {s.changesAvailable === false && <Badge tone="muted" title={s.changesError || 'The build log (axf.changes@1, Codebase changes plugin) isn’t available: sessions’ builds can’t be shown.'}>no build log</Badge>}
        {s.liveAvailable === false && <Badge tone="muted" title={s.liveError || 'The activity feed (axf.activity@1) isn’t available: install or switch on the Activity plugin for GitHub runs, console updates, assistant replies and VPS jobs.'}>no activity feed</Badge>}
        <Button size="sm" tone="neutral" icon="refresh" onClick={() => { void loadLive(); void loadChanges(true); }} title="Check now">Check</Button>
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

/* ---------------- Send to queue (the orchestrator starts every build; Brett, Nov 9 2026) ---------------- */

const JOB_LABEL: Record<string, string> = { queued: 'In the orchestrator Queue', asking: 'Asking axHub…', waiting: 'Waiting for your approval', launching: 'Starting…', launched: 'Running on the VPS', rejected: 'Rejected', expired: 'Approval expired', failed: 'Failed' };

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
      else rt.toast(`Queued as ${r.build ?? row.title}: the orchestrator starts it`, 'success');
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="axp-build-manager__start" role="region" aria-label={`Send ${row.title} to the queue`}>
      <div className="axp-build-manager__start-head"><Icon name="list" size={14} /><strong>Send to queue</strong><span className="fx-grow" /><button type="button" className="fx-iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" size={14} /></button></div>
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
          <p className="fx-small fx-muted" style={{ margin: 0 }}>Goes to the Build orchestrator’s Queue. The orchestrator is the only thing that starts builds: it splits it, picks the account and model, and starts it when a slot is free. The Build manager tracks it from there.</p>
          {!job || ['rejected', 'expired', 'failed'].includes(job.state)
            ? <div className="axp-build-manager__actions"><Button icon="list" onClick={() => void go()} disabled={busy}>{busy ? 'Sending…' : job ? 'Try again' : 'Send to queue'}</Button></div>
            : null}
        </>
      )}
      {job && (
        <div className="axp-build-manager__job">
          <Badge icon={job.state === 'launched' || job.state === 'queued' ? 'check' : job.state === 'waiting' ? 'clock' : ['rejected', 'expired', 'failed'].includes(job.state) ? 'x' : 'refresh'} tone={job.state === 'launched' ? 'ok' : job.state === 'waiting' ? 'warn' : ['rejected', 'expired', 'failed'].includes(job.state) ? 'danger' : undefined}>{JOB_LABEL[job.state] ?? job.state}</Badge>
          <span className="fx-small">{job.message}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- Built (history) ---------------- */

/* ---------------- Sessions: every session ever, each expanding into what it was asked to build ---------------- */

/* ---------------- the list ---------------- */

// grid-hook@1: a build row's right-click finds the row hooks for its source (pending item, build-queue step, plan feature);
// a change-log entry's row the same way (kind change)
registerRowRefTarget('axf-build-item', (key) => { const i = key.indexOf(':'); return i > 0 ? { kind: key.slice(0, i), id: key.slice(i + 1) } : null; });
registerRowRefTarget('axf-change-entry', (id) => (id ? { kind: 'change', id } : null));

/* ---------------- the banner ---------------- */

/** The way to the full page from an expanded banner build (tapping the banner expands it in place, Brett Oct 25 2026). */
function BannerOpen({ rt, e }: { rt: ReturnType<typeof useRuntime>; e: ChangeLive }) {
  return (
    <div className="axp-build-manager-banner__open">
      <Button size="sm" tone="neutral" icon="arrow-right" onClick={() => rt.dispatch(e.row ? `build-manager.open:${encodeURIComponent(e.row.key)}` : 'build-manager.live')}>Open in Build manager</Button>
      {rt.actions.get('codebase-changes.open') && <Button size="sm" tone="neutral" icon="list" onClick={() => rt.dispatch(`codebase-changes.open:${e.changeId}`)}>Log</Button>}
      <WatchLiveFor change={e.changeId} branch={e.branch} />
    </div>
  );
}

export function BuildBanner() {
  const rt = useRuntime();
  const s = useStore();
  const now = useNow(true);
  const { sessions } = useLive();
  // Launches expanded; "_" folds it to its title line, the chevron unfolds it (Brett, Oct 21 2026: building banners
  // minimize, they don't close).
  const [full, setFull] = useBannerLaunchOpen();
  const [shown, setShown] = useState<string | null>(null);
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
        <button type="button" data-fx-row className="axp-build-manager-banner__main" aria-expanded={full} onClick={() => setFull(!full)} title={full ? 'Hide the details' : 'Show the details'}>
          <span className={first.stale ? '' : 'axp-build-manager__spin'} aria-hidden><Icon name={first.stale ? 'alert' : 'refresh'} size={16} /></span>
          <span className="axp-build-manager-banner__text">
            <strong>{first.stale ? 'No word from: ' : first.state === 'queued' ? 'Waiting to start: ' : 'Building: '}<RefText text={first.title} /></strong>
            {full && <span className="axp-build-manager-banner__meta">
              <ModelChip model={first.model === 'Other' ? 'Opus' : first.model} />
              <Badge icon={isStuckLive(first, now) ? 'alert' : 'clock'} tone={isStuckLive(first, now) ? 'warn' : undefined}>{dur(elapsed)}{first.estimate ? ` / ~${fmt(first.estimate)}` : ''}{first.stale && first.lastSeenAt ? ` · no word ${dur(now - first.lastSeenAt)}` : ''}</Badge>
              {cost != null && <Badge icon="zap">{first.costActual == null ? '~' : ''}{money(cost)}</Badge>}
              {first.stepsTotal > 0 && <Badge icon="list">{first.stepsDone}/{first.stepsTotal}</Badge>}
              <Badge tone="muted">{first.source}{first.host && first.host !== first.source ? ` · ${first.host}` : ''}</Badge>
              {more > 0 && <Badge>+{more} more</Badge>}
            </span>}
            {full && first.currentStep && <span className="axp-build-manager-banner__step"><RefText text={first.currentStep} /></span>}
            {full && first.progress != null && <Bar value={first.progress} label="Build progress" />}
          </span>
        </button>
        {isStuckLive(first, now) && <TrashBuild e={first} />}
        {fold}
        {full && <BannerOpen rt={rt} e={first} />}
        {full && running.length > 1 && (
          // Every other build, each with its own trash can when stuck (Oct 22 2026: trashing the first one used to bring
          // the next stuck build up in the same spot, so it looked like the trash did nothing).
          <ul className="axp-build-manager-banner__more">
            {running.slice(1).map((e) => (
              <li key={e.changeId}>
                <button type="button" data-fx-row className="axp-build-manager-banner__more-head" aria-expanded={shown === e.changeId} onClick={() => setShown(shown === e.changeId ? null : e.changeId)} title={shown === e.changeId ? 'Hide the details' : 'Show the details'}>
                  <Icon name={e.stale ? 'alert' : e.state === 'queued' ? 'clock' : 'refresh'} size={12} />
                  <span className="axp-build-manager-banner__more-title">{e.stale ? 'No word from: ' : e.state === 'queued' ? 'Waiting: ' : ''}<RefText text={e.title} /></span>
                  <Badge icon={isStuckLive(e, now) ? 'alert' : 'clock'} tone={isStuckLive(e, now) ? 'warn' : undefined}>{dur(e.startedAt ? now - e.startedAt : null)}</Badge>
                  <Icon name={shown === e.changeId ? 'chevron-up' : 'chevron-down'} size={12} />
                </button>
                {isStuckLive(e, now) && <TrashBuild e={e} />}
                {shown === e.changeId && (
                  <div className="axp-build-manager-banner__detail">
                    <span className="axp-build-manager-banner__meta">
                      <ModelChip model={e.model === 'Other' ? 'Opus' : e.model} />
                      {e.estimate ? <Badge icon="clock">~{fmt(e.estimate)}</Badge> : null}
                      {(e.costActual ?? e.costEstimate) != null && <Badge icon="zap">{e.costActual == null ? '~' : ''}{money((e.costActual ?? e.costEstimate)!)}</Badge>}
                      {e.stepsTotal > 0 && <Badge icon="list">{e.stepsDone}/{e.stepsTotal}</Badge>}
                      <Badge tone="muted">{e.source}{e.host && e.host !== e.source ? ` · ${e.host}` : ''}</Badge>
                    </span>
                    {e.currentStep && <span className="axp-build-manager-banner__step">{e.currentStep}</span>}
                    {e.progress != null && <Bar value={e.progress} label="Build progress" />}
                    <BannerOpen rt={rt} e={e} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
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
      <button type="button" data-fx-row className="axp-build-manager-banner__main" aria-expanded={full} onClick={() => setFull(!full)} title={full ? 'Hide the details' : 'Show the details'}>
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
      {full && (
        <div className="axp-build-manager-banner__open">
          <Button size="sm" tone="neutral" icon="arrow-right" onClick={() => rt.dispatch(`build-manager.open:${encodeURIComponent(first.row!.key)}`)}>Open in Build manager</Button>
        </div>
      )}
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
      <p className="fx-small" style={{ margin: 0 }}><strong>{t.all.count} builds · {fmt(t.all.left) || '0 min'} left · ~{usd(t.all.cost) || '$0.00'}</strong> · Fable {fmt(t.Fable.left) || '0 min'} (~{usd(t.Fable.cost) || '$0.00'}) · Opus {fmt(t.Opus.left) || '0 min'} (~{usd(t.Opus.cost) || '$0.00'}) · Sonnet {fmt(t.Sonnet.left) || '0 min'} (~{usd(t.Sonnet.cost) || '$0.00'})</p>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        Live builds come from the activity feed (<code>axf.activity@1</code>{s.liveAvailable === false ? ': not available right now' : ''}); a run is linked to its build by its branch
        (<code>fable/&lt;id&gt;</code>, <code>rebuild/&lt;id&gt;</code>, <code>harvest/…</code>) or a report naming it.
        Step ticks: pending list {s.canTickPending ? 'on' : 'read-only (no step action yet)'}, build queue {s.canTickQueue ? 'on' : 'read-only (no step action yet)'}.
      </p>
    </div>
  );
}
