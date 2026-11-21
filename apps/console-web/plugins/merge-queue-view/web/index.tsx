/**
 * Merge queue (merge-queue@2): every build waiting to land, read-only, live from the builds store (Pipeline 2.0, Brett
 * Nov 18 2026: "Keep the merge queue, but it's effectively read-only ... read from the same single source of truth the
 * orchestrator reads from. No separate state of its own."). One row a build (`grid:merge-queue/row:<build>`): its status
 * (failed shows the attempt) with how long it has been in it, its PRs, and its steps under the row ("added to PR #N").
 * No toolbar and no actions: the lander (deploy/lander/run.mjs) lands everything by itself.
 * With the Build orchestrator on, the view shows its builds table filtered to the merging statuses (slot
 * `builds.merge-queue`), so the queue is the same rows as the Builds table; without it, this plugin's own grid.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chip, Container, Slot, useControlTargets, useSlotFilled, type ControlTargetDef } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';

const FOLDER = 'merge-queue-view';
const REFRESH_MS = 10000;

interface Step { id: string; status: string; prNumber: number | null; model: string; slot: number | null }
interface Row {
  build: string; title: string; status: string; attempt: number; statusAt: string;
  failure: { kind: string; status: string; why: string; retry: string; notBefore: string } | null;
  prs: { pr: number; steps: string[]; state: 'open' | 'merged' | 'closed' }[]; waiting: string[]; steps: Step[];
}
interface Queue { at: string; landing: string; rows: Row[] }

const LABEL: Record<string, string> = { building: 'building', 'build-complete': 'build complete', 'merging-pr': 'merging to one PR', 'pr-pulling-main': 'pulling in main', 'running-ci': 'running CI', 'merging-main': 'merging into main', failed: 'failed' };
const statusLabel = (r: Row) => (r.status === 'failed' ? `failed, attempt ${r.attempt || 1}` : LABEL[r.status] ?? r.status);
const tone = (s: string) => (s === 'failed' ? 'danger' : s === 'building' ? undefined : s === 'build-complete' ? 'warning' : 'accent');
const RETRY: Record<string, string> = { rerun: 're-running the failed CI jobs', split: 'splitting into one PR per step', fix: 'a fix session on the PR branch', 'pull-main': 'pulling main again', same: 'trying the same phase again' };

/** "12 min", "1 h 5 min" since an ISO time, at `now`. */
function since(iso: string, now: number): string {
  const t = Date.parse(iso); if (!iso || !Number.isFinite(t)) return '';
  const m = Math.max(0, Math.floor((now - t) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function useQueue(): { q: Queue | null; error: string } {
  const [q, setQ] = useState<Queue | null>(null);
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const load = () => pluginFetch(FOLDER, 'queue').then((r) => r.json()).then((j: Queue & { ok?: boolean; message?: string }) => {
      if (!live.current) return;
      if (j.ok === false) setError(j.message || 'the merge queue could not be read'); else { setQ(j); setError(''); }
    }, (e: Error) => live.current && setError(e.message));
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => { live.current = false; window.clearInterval(t); };
  }, []);
  return { q, error };
}

function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

/** This plugin's own grid, from its read-only `queue` route. */
function OwnQueue() {
  const { q, error } = useQueue();
  const now = useNow();
  const [expanded, setExpanded] = useState<string[]>([]);
  const rows = q?.rows ?? [];
  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'panel:merge-queue', kind: 'panel', label: 'Merge queue', keywords: ['merge', 'queue', 'landing', 'waiting'], get: () => (q ? { landing: q.landing, waiting: q.rows.map((r) => ({ build: r.build, status: statusLabel(r) })) } : null) },
  ], [q]);
  useControlTargets(targets, q?.at ?? '');

  const cols: GridColumn<Row>[] = [
    { id: 'build', label: 'Build', width: 'calc(var(--fx-space) * 80)', fixed: true, sortable: true, sortValue: (r) => r.build, render: (r) => (
      <span className="fx-stack"><strong>{r.build}</strong><span className="fx-muted fx-small">{r.title}</span></span>
    ) },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-space) * 40)', sortable: true, sortValue: (r) => r.status, render: (r) => (
      <span className="fx-stack"><span data-status={r.status}><Chip tone={tone(r.status)}>{statusLabel(r)}</Chip></span>{r.statusAt && <span className="fx-muted fx-small">{since(r.statusAt, now)}</span>}</span>
    ) },
    { id: 'prs', label: 'PRs', width: 'calc(var(--fx-space) * 30)', render: (r) => (
      <span className="fx-stack"><span>{r.prs.length ? r.prs.map((p) => `#${p.pr}${p.state === 'merged' ? ' merged' : p.state === 'closed' ? ' closed' : ''}`).join(', ') : 'none yet'}</span><span className="fx-muted fx-small">{r.waiting.length} step(s) not in a PR</span></span>
    ) },
    { id: 'why', label: 'Now', width: 'calc(var(--fx-space) * 100)', render: (r) => (
      <span className="fx-stack">{r.failure ? <><span>{r.failure.why}</span><span className="fx-muted fx-small">next: {RETRY[r.failure.retry] ?? r.failure.retry}{r.failure.notBefore ? ` at ${new Date(r.failure.notBefore).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}</span></> : <span className="fx-muted">{r.build === q?.landing ? 'landing now' : 'waiting its turn'}</span>}</span>
    ) },
  ];
  const detail = (r: Row) => (
    <div className="fx-stack" data-axf-target={`panel:merge-queue.steps=${r.build}`}>
      {r.steps.map((s) => (
        <span key={s.id} className="fx-row" data-status-row><span data-status={s.status || 'pending'}><Chip tone={s.status === 'in-pr' ? 'success' : s.status === 'failed' ? 'danger' : undefined}>{s.status === 'in-pr' && s.prNumber ? `added to PR #${s.prNumber}` : s.status || 'pending'}</Chip></span><strong>{s.id}</strong><span className="fx-muted fx-small">{[s.model, s.slot != null ? `slot ${s.slot}` : ''].filter(Boolean).join(' · ')}</span></span>
      ))}
    </div>
  );

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Builds</p><h1>Merge queue</h1><p className="fx-muted">Every build waiting to land, live from the builds store; the lander lands each one by itself.</p></div></header>
      <Container title="Landing now" icon="branch">
        <p className="fx-muted">{error ? error : !q ? 'Loading the merge queue…' : q.landing ? `${q.landing} is landing; ${Math.max(0, rows.length - 1)} more waiting. Everything here lands by itself.` : rows.length ? `${rows.length} build(s) waiting. Everything here lands by itself.` : 'Nothing waits to land.'}</p>
      </Container>
      <DataGrid<Row>
        id="merge-queue" label="Builds waiting to land" groups={[{ id: 'merge-queue', title: `Waiting to land (${rows.length})`, rows, groups: [] }]} columns={cols}
        rowId={(r) => r.build} rowLabel={(r) => `${r.build}: ${statusLabel(r)}`} hidden={[]} rowTone={(r) => tone(r.status) ?? 'muted'}
        expanded={expanded} onToggleExpand={(id) => setExpanded((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))} renderDetail={detail}
        selected={null} empty={<p className="fx-muted">{q ? 'Nothing waits to land.' : 'Loading…'}</p>}
      />
    </div>
  );
}

/** The orchestrator's merging-statuses table when it is on (one table, one source), else the plugin's own grid. */
function MergeQueueView() {
  if (!useSlotFilled('builds.merge-queue')) return <OwnQueue />;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div>
        <p className="fx-eyebrow">Builds · read-only</p>
        <h1>Merge queue</h1>
        <p className="fx-muted">Builds merging to one PR, pulling main, running CI and merging into main: the same rows as the Builds table, from the same store. Everything here lands by itself.</p>
      </div></header>
      <Slot name="builds.merge-queue" />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.merge-queue',
  label: 'Merge queue',
  version: '2.0.0',
  appMenu,
  views: { 'merge-queue': { title: 'Merge queue', icon: 'branch', render: () => <MergeQueueView /> } },
  nav: { label: 'Builds', items: [{ id: 'merge-queue', label: 'Merge queue', icon: 'branch', view: 'merge-queue' }] },
  settingsTabs: [{ id: 'merge-queue', label: 'Merge queue', icon: 'branch', order: 90, parent: 'plugins' }],
  settingsPanels: [{ id: 'merge-queue.lifecycle', tab: 'merge-queue', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
