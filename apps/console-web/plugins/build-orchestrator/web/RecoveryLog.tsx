/**
 * Recovery log (Build orchestrator → Recovery tab; deep link console_show builds/orchestrator/recovery, action
 * build-orchestrator.open:recovery): the latest auto-recovery event per build (cause, exit, action, attempt) with its
 * priority tag, parked builds first, every event of a build in its row's detail, Retry / Park per build and Run now /
 * Dry run on the toolbar. Same calls without the UI: GET recovery, POST recovery/run | retry/<id> | park/<id> (REST and
 * MCP), `recover.mjs status | run | retry | park`, voice recovery.status / recovery.run / recovery.retry.
 * RecoveryBadge is the chip every build view shows when auto-recovery touched the build.
 */
import { useMemo, useState } from 'react';
import * as consoleApi from '@console/api';
import { Button, Chip, Icon, PriorityTag, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import { ACTION_LABEL, CAUSE_LABEL, badgeOf, recoveryApi, useRecovery, type RecoveryBuild, type RecoveryEvent } from './recovery';

const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const toggleIn = (list: readonly string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** The chip a build view shows: "Recovered 2× · Killed", "Parked after 3 retries"; nothing when never recovered. */
export function RecoveryBadge({ build }: { build?: RecoveryBuild }) {
  const b = badgeOf(build);
  if (!b) return null;
  return <span title={build?.lastAt ? `Last auto-recovery ${fmtTime(build.lastAt)}${build.lastExit != null ? ` · exit ${build.lastExit}` : ''}` : undefined}><Chip tone={b.tone}>{b.text}</Chip></span>;
}

type Row = RecoveryBuild & { key: string; last: RecoveryEvent | null; events: RecoveryEvent[] };

/**
 * The three looks sent to UI Review (options as assets under assets/interface/): grouped = one row per build, parked
 * first; timeline = every fix as its own row, newest first; compact = one line per build. Local key
 * `orch-recovery-layout` (default grouped) until Brett picks; then the picked one(s) stay.
 */
export const RECOVERY_LAYOUTS = ['grouped', 'timeline', 'compact'] as const;
type Layout = (typeof RECOVERY_LAYOUTS)[number];
const layoutNow = (): Layout => { const v = consoleApi.readLocal<string>('orch-recovery-layout', 'grouped'); return (RECOVERY_LAYOUTS as readonly string[]).includes(v) ? (v as Layout) : 'grouped'; };

export function RecoveryLog() {
  const rt = useRuntime();
  const { state, error, reload } = useRecovery(15_000);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<GridSort>({ col: 'when', dir: -1 });

  const [layout] = useState<Layout>(layoutNow);
  const rows: Row[] = useMemo(() => {
    if (!state) return [];
    const byBuild = new Map<string, RecoveryEvent[]>();
    for (const e of state.events) byBuild.set(e.build, [...(byBuild.get(e.build) ?? []), e]);
    const builds = new Map(state.builds.map((b) => [b.id, b]));
    if (layout === 'timeline') {
      return state.events.filter((e) => e.action !== 'reset').map((e, i) => {
        const b = builds.get(e.build) ?? { id: e.build, title: e.title || e.build, status: '', attempts: e.attempt, lastAt: e.at, lastCause: e.cause, lastExit: e.exit, nextAt: '', parkedAt: '', parked: false, priority: e.priority || '' };
        return { ...b, key: `${e.id || e.at}:${i}`, last: e, events: byBuild.get(e.build) ?? [e] };
      });
    }
    return state.builds.map((b) => { const ev = byBuild.get(b.id) ?? []; return { ...b, key: b.id, last: ev[0] ?? null, events: ev }; });
  }, [state, layout]);
  const groups: GridGroup<Row>[] = useMemo(() => {
    if (layout === 'timeline') return [{ id: 'fixes', title: `Every fix, newest first (${rows.length})`, icon: 'clock', rows, groups: [] }];
    if (layout === 'compact') return [{ id: 'all', title: `Builds auto-recovery touched (${rows.length})`, icon: 'refresh', rows: [...rows].sort((a, b) => Number(b.parked) - Number(a.parked)), groups: [] }];
    const parked = rows.filter((r) => r.parked); const rest = rows.filter((r) => !r.parked);
    return [
      ...(parked.length ? [{ id: 'parked', title: `Parked: needs you (${parked.length})`, icon: 'alert', rows: parked, groups: [] }] : []),
      { id: 'recovered', title: `Fixed by itself (${rest.length})`, icon: 'refresh', rows: rest, groups: [] },
    ];
  }, [rows, layout]);

  const act = async (what: string, path: string, body: Record<string, unknown> = {}, ok = '') => {
    setBusy(what);
    try {
      const r = await recoveryApi.post<{ message?: string; actions?: { line: string }[] }>(path, body);
      const msg = ok || r.message || (r.actions ? (r.actions.length ? r.actions.map((a) => a.line).join(' ') : 'Nothing stuck right now.') : 'Done');
      rt.toast(msg, 'success');
      await reload();
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(''); }
  };

  const summaryCol: GridColumn<Row> = { id: 'what', label: 'What happened', width: 'minmax(calc(var(--fx-font-size) * 14), 3fr)', sortable: true, sortValue: (r) => r.last?.cause ?? '',
    render: (r) => <span className="fx-small">{CAUSE_LABEL[r.last?.cause ?? r.lastCause] ?? '—'}{(r.last?.exit ?? r.lastExit) != null ? ` · exit ${r.last?.exit ?? r.lastExit}` : ''} · {ACTION_LABEL[r.last?.action ?? ''] ?? '—'} · {r.attempts}/{state?.settings.maxRetries ?? '?'}</span> };
  const all: GridColumn<Row>[] = [
    { id: 'build', label: 'Build', width: 'minmax(calc(var(--fx-font-size) * 14), 3fr)', fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(),
      render: (r) => <span className="oc-cell-title" title={r.last?.line || r.title}><strong>{r.title}</strong><span className="fx-small fx-muted fx-mono">{r.id}</span></span> },
    { id: 'priority', label: 'Priority', width: 'calc(var(--fx-font-size) * 8)', render: (r) => <PriorityTag build={r.id} /> },
    { id: 'cause', label: 'Cause', width: 'calc(var(--fx-font-size) * 9)', sortable: true, sortValue: (r) => r.last?.cause ?? '', render: (r) => <span className="fx-small">{CAUSE_LABEL[r.last?.cause ?? r.lastCause] ?? '—'}</span> },
    { id: 'exit', label: 'Exit', width: 'calc(var(--fx-font-size) * 4)', render: (r) => <span className="fx-small fx-mono">{(r.last?.exit ?? r.lastExit) ?? '—'}</span> },
    { id: 'action', label: 'Action', width: 'calc(var(--fx-font-size) * 9)', render: (r) => <span className="fx-small">{ACTION_LABEL[r.last?.action ?? ''] ?? '—'}</span> },
    { id: 'attempt', label: 'Attempt', width: 'calc(var(--fx-font-size) * 5)', align: 'end', sortable: true, sortValue: (r) => r.attempts,
      render: (r) => <span className="fx-small">{r.attempts}/{state?.settings.maxRetries ?? '?'}</span> },
    { id: 'when', label: 'When', width: 'calc(var(--fx-font-size) * 8)', align: 'end', sortable: true, sortValue: (r) => r.last?.at ?? r.lastAt,
      render: (r) => <span className="fx-small" title={r.nextAt ? `Launches again after ${fmtTime(r.nextAt)}` : undefined}>{fmtTime(r.last?.at ?? r.lastAt)}</span> },
  ];
  const pick = (ids: string[]) => ids.map((id) => (id === 'what' ? summaryCol : all.find((c) => c.id === id)!));
  const cols = layout === 'compact' ? pick(['build', 'priority', 'what', 'when']) : layout === 'timeline' ? pick(['when', 'build', 'priority', 'cause', 'exit', 'action', 'attempt']) : all;

  if (!state) return <div className="fx-empty">{error || 'Loading the recovery log…'}</div>;
  const h = state.health;
  return (
    <div className="oc-rec-log">
      <div className="oc-rec-head">
        <p className={`fx-small ${h.status === 'error' ? 'oc-rec-red' : 'fx-muted'}`}><Icon name={h.status === 'error' ? 'alert' : 'check-circle'} size={14} /> {h.summary}
          {' · '}auto-recovery {state.settings.enabled ? 'on' : 'off'}{state.lastRun ? ` · last round ${fmtTime(state.lastRun.at)}` : ''}{state.requested ? ` · asked ${fmtTime(state.requested.at)}, the dispatcher runs it on its next tick` : ''}</p>
        <div className="oc-rec-tools" role="toolbar" aria-label="Recovery">
          <Button size="sm" icon="refresh" disabled={!!busy} onClick={() => void act('run', 'recovery/run')}>Run now</Button>
          <Button size="sm" tone="neutral" icon="search" disabled={!!busy} onClick={() => void act('dry', 'recovery/run', { dry_run: true })}>Dry run</Button>
          <Button size="sm" tone="quiet" icon="settings" onClick={() => rt.actions.dispatch('settings.open:build-orchestrator', { runtime: rt })}>Settings</Button>
        </div>
      </div>
      <div className="oc-grid">
        <DataGrid<Row> id="orch-recovery" label="Recovery log" compact={layout === 'compact'} groups={groups} columns={cols} rowId={(r) => r.key} rowLabel={(r) => r.title}
          rowTone={(r) => (r.parked ? 'danger' : r.nextAt && Date.parse(r.nextAt) > Date.now() ? 'warning' : 'muted')}
          hidden={hidden} onToggleColumn={(c, show) => setHidden((x) => (show === undefined ? toggleIn(x, c) : show ? x.filter((y) => y !== c) : [...x, c]))} onShowAll={() => setHidden([])}
          sort={sort} onSort={(c) => setSort((s) => (!c ? null : s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}
          expanded={open} onToggleExpand={(id) => setOpen((o) => toggleIn(o, id))} onRowClick={(r) => setOpen((o) => toggleIn(o, r.key))}
          rowCtx={(r) => ({ target: 'axf-orchestrator-build', payload: r.id })}
          empty={<p className="fx-muted fx-small">Nothing has needed fixing yet: no build was stuck.</p>}
          renderDetail={(r) => (
            <div className="oc-detail">
              <div className="oc-rec-tools" role="toolbar" aria-label={`Recovery of ${r.title}`}>
                <RecoveryBadge build={r} />
                <Button size="sm" icon="play" disabled={!!busy} onClick={() => void act(`retry:${r.id}`, `recovery/retry/${encodeURIComponent(r.id)}`, {}, `${r.id} is back in the Queue`)}>Retry now</Button>
                {!r.parked && <Button size="sm" tone="quiet" icon="pause" disabled={!!busy} onClick={() => void act(`park:${r.id}`, `recovery/park/${encodeURIComponent(r.id)}`, { why: 'parked from the Recovery log' }, `${r.id} is parked in Pending`)}>Park</Button>}
                <Button size="sm" tone="quiet" icon="layers" onClick={() => rt.actions.dispatch(`build-orchestrator.open:${encodeURIComponent(r.id)}`, { runtime: rt })}>Open build</Button>
              </div>
              <ul className="pl-steps">
                {r.events.map((e) => <li key={e.id || e.at} className="fx-small"><span className="fx-muted">{fmtTime(e.at)}</span> · {ACTION_LABEL[e.action] ?? e.action}{e.attempt ? ` (try ${e.attempt})` : ''} · {e.line}</li>)}
              </ul>
            </div>
          )} />
      </div>
    </div>
  );
}
