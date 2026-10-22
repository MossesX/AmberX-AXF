/* Build manager — the view (live tracker + everything still to build), the banner and the settings panel. Theme tokens only. */
import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { filterRows, GONE_LABEL, goneRows, MODELS, SORT_LABEL, SORTS, SOURCE_LABEL, SOURCES, sortRows, statusesOf, totalsByModel, type GoneKind, type LiveEntry, type Row, type SortKey, type Source } from './merge.mjs';
import { bannerOn, defaultSort, enabledSources, fmt, hideBanner, loadList, loadLive, takeFocus, takeOff, tickStep, useStore, onStore, type Store } from './store';

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

export function LiveTracker({ compact }: { compact?: boolean }) {
  const s = useStore();
  const now = useNow(s.live.length > 0 || s.finished.length > 0);
  const live = compact ? s.live.filter((e) => e.row) : s.live;
  const fin = compact ? s.finished.filter((e) => e.row) : s.finished;
  return (
    <section className="axp-build-manager__tracker" aria-label="Building now" aria-live="polite">
      <div className="axp-build-manager__tracker-head">
        <span className={live.length ? 'axp-build-manager__spin' : ''} aria-hidden><Icon name={live.length ? 'refresh' : 'check-circle'} size={16} /></span>
        <strong>{live.length ? `${live.length} building now` : 'Nothing building right now'}</strong>
        {s.liveAvailable === false && <Badge tone="muted" title={s.liveError || 'The activity feed (axf.activity@1) isn’t available: install or switch on the Activity plugin for GitHub runs, console updates, assistant replies and VPS jobs.'}>build list only</Badge>}
        <button type="button" className="axp-build-manager__act" onClick={() => void loadLive()} title="Check now"><Icon name="refresh" size={11} />Check</button>
      </div>
      {(live.length > 0 || fin.length > 0) && (
        <ul className="axp-build-manager__live-list">
          {live.map((e) => <TrackerEntry key={e.id} e={e} now={now} />)}
          {fin.map((e) => <TrackerEntry key={`f-${e.id}`} e={e} now={now} finished />)}
        </ul>
      )}
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
          <ModelChip model={row.model} />
          {(row.building || row.statusLabel !== SOURCE_LABEL[row.source]) && <Badge tone={row.status === 'unsafe' || row.status === 'broken' || row.status === 'failed' || row.status === 'rework' ? 'warn' : row.building ? 'ok' : undefined}>{row.building ? 'Building' : row.statusLabel}</Badge>}
          <SplitBadge row={row} />
          {row.gone && <Badge icon={row.gone.kind === 'built' ? 'check' : 'trash'} tone="muted" title={`Looks ${row.gone.kind}: ${row.gone.why}`}>Looks {row.gone.kind}</Badge>}
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

export function BuildManagerView() {
  const s = useStore();
  const [model, setModel] = useState('');
  const [sources, setSources] = useState<Source[]>(() => enabledSources());
  const [status, setStatus] = useState('');
  const [split, setSplit] = useState(false);
  const [sort, setSort] = useState<SortKey>(() => defaultSort());
  const [open, setOpen] = useState<Set<string>>(() => { const f = takeFocus(); return new Set(f ? [f] : []); });
  useEffect(() => { void loadList(); }, []);
  // A focus request (search, context menu, tracker) opens and scrolls to the row.
  useEffect(() => onStore(() => { const f = takeFocus(); if (f) { setOpen((o) => new Set([...o, f])); setTimeout(() => document.getElementById(`axp-bm-${f.replace(/[^a-z0-9-]/gi, '-')}`)?.scrollIntoView({ block: 'center' }), 50); } }), []);
  useEffect(() => { const f = [...open][0]; if (f) setTimeout(() => document.getElementById(`axp-bm-${f.replace(/[^a-z0-9-]/gi, '-')}`)?.scrollIntoView({ block: 'center' }), 50); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const allowed = enabledSources();
  const base = useMemo(() => s.rows.filter((r) => allowed.includes(r.source)), [s.rows, allowed.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => sortRows(filterRows(base, { model, sources, status, split }), sort), [base, model, sources, status, split, sort]);
  const statuses = useMemo(() => statusesOf(base), [base]);
  const t = totalsByModel(base);
  const gone = useMemo(() => goneRows(base), [base]);
  const [cleaning, setCleaning] = useState(false);
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
          <Button icon="refresh" onClick={() => { void loadList(); void loadLive(); }}>Refresh</Button>
        </div>
      </header>

      {cleaning && <CleanUp rows={gone} onClose={() => setCleaning(false)} />}
      <LiveTracker />
      <Totals rows={base} />

      <div className="axp-build-manager__filters" role="group" aria-label="Filter and sort">
        <label className="axp-build-manager__field"><span>Model</span>
          <select className="fx-input" value={model} onChange={(e) => setModel(e.target.value)}><option value="">All</option>{MODELS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <label className="axp-build-manager__field"><span>Status</span>
          <select className="fx-input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{statuses.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
        </label>
        <label className="axp-build-manager__field"><span>Sort</span>
          <select className="fx-input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>{SORTS.map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}</select>
        </label>
        <div className="axp-build-manager__toggles">
          {SOURCES.filter((x) => allowed.includes(x)).map((x) => (
            <button key={x} type="button" className={`axp-build-manager__toggle${sources.includes(x) ? ' is-on' : ''}`} aria-pressed={sources.includes(x)}
              onClick={() => setSources((cur) => (cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x]))}>
              <Icon name={SOURCE_ICON[x]} size={11} />{SOURCE_LABEL[x]} <span className="fx-muted">{base.filter((r) => r.source === x).length}</span>
            </button>
          ))}
          <button type="button" className={`axp-build-manager__toggle${split ? ' is-on' : ''}`} aria-pressed={split} onClick={() => setSplit(!split)}>
            <Icon name="alert" size={11} />Needs split <span className="fx-muted">{base.filter((r) => r.needsSplit).length}</span>
          </button>
        </div>
      </div>

      {s.error && <p className="fx-small axp-build-manager__error" role="alert">{s.error}</p>}
      {s.offline && <p className="fx-small fx-muted">The console API is offline: showing the snapshot that came with the page.</p>}
      {!s.loaded ? <div className="fx-empty">Loading the build list…</div>
        : shown.length === 0 ? <div className="fx-empty">{base.length ? 'Nothing matches these filters.' : 'Nothing left to build.'}</div>
          : <ul className="axp-build-manager__list" aria-label={`${shown.length} builds`}>{shown.map((r) => <BuildRow key={r.key} row={r} open={open.has(r.key)} onToggle={() => toggle(r.key)} canTick={canTick(r)} />)}</ul>}
    </div>
  );
}

/* ---------------- the banner ---------------- */

export function BuildBanner() {
  const rt = useRuntime();
  const s = useStore();
  const now = useNow(true);
  const live = s.live.filter((e) => e.row);
  const fin = s.finished.filter((e) => e.row);
  if (!bannerOn() || (!live.length && !fin.length)) return null;
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
          <span className="axp-build-manager-banner__meta">
            <ModelChip model={first.row!.model} />
            <Badge icon="clock">{dur(elapsed)}{first.estimate ? ` / ~${fmt(first.estimate)}` : ''}</Badge>
            {first.row!.stepsTotal > 0 && <Badge icon="list">{first.row!.stepsDone}/{first.row!.stepsTotal}</Badge>}
            {live.length > 1 && <Badge>+{live.length - 1} more</Badge>}
          </span>
          {pct != null && <Bar value={pct} label="Build progress" />}
        </span>
      </button>
      <button type="button" className="fx-iconbtn" aria-label="Hide until a new build starts" title="Hide until a new build starts" onClick={() => hideBanner(key)}><Icon name="x" size={16} /></button>
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
