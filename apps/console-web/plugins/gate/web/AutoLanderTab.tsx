/**
 * Gate → Auto-lander: two tabs in one framework TabGroup (settings id `gate.auto-lander.tabs`):
 *   Server       the lander (lander@1, deploy/lander/run.mjs on the VPS): service status, the build landing, every build
 *                waiting to land, read from the builds store (`grid:gate.auto-lander`, one row a build:
 *                `grid:gate.auto-lander/row:<build>`) with its live status (failed shows the attempt), its PRs, and its
 *                steps under each row ("added to PR #N"). Toolbar (role="toolbar", `gate.auto-lander`): Run now, Retry and Fix (the selected
 *                build; Fix asks first), Pause / Resume (`button:gate-al-run | gate-al-retry | gate-al-fix | gate-al-pause |
 *                gate-al-resume`).
 *   Merge line   the landing line and its Merge queue switch (LanderTab).
 * Deep links: `console_show view:gate/tab:gate.tabs=auto-lander/tab:gate.auto-lander.tabs=server`, a row by its address,
 * action `gate.auto-lander.open:<build>`. Every press is the REST route the CLI (`axf gate auto-lander …`), MCP
 * (gate_auto_lander_*) and voice (gate.auto-lander.*) use.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, TabGroup, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import type { GridColumn } from '@console/axf/libs/datagrid';
import { GateList } from './GateList';
import { LanderTab } from './LanderTab';
import { gateCall } from './api';
import { autoLanderPath, onShowAutoLanderBuild, takeAutoLanderBuild, type AutoLanderBuild, type AutoLanderStatus } from './autoLanderState';
import { useGridRows } from './rows';
import { usePoll } from './usePoll';

type Sub = 'server' | 'line';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const STATUS_LABEL: Record<string, string> = { 'build-complete': 'build complete', 'merging-pr': 'merging to one PR', 'pr-pulling-main': 'pulling in main', 'running-ci': 'running CI', 'merging-main': 'merging into main', landed: 'landed', failed: 'failed', building: 'building' };
const label = (b: AutoLanderBuild) => (b.status === 'failed' ? `failed, attempt ${b.attempt || 1}` : STATUS_LABEL[b.status] ?? b.status);
const statusTone = (s: string) => (s === 'failed' ? 'danger' : s === 'landed' ? 'success' : s === 'merging-main' || s === 'running-ci' || s === 'pr-pulling-main' || s === 'merging-pr' ? 'accent' : undefined);
const RETRY: Record<string, string> = { rerun: 'flaky check: re-run the failed jobs', split: 'split: one PR per step', fix: 'fix session on the PR branch', 'pull-main': 'pull main again', same: 'the same phase again' };
const minutesSince = (iso: string) => (iso ? (Date.now() - Date.parse(iso)) / 60000 : Infinity);

export function AutoLanderTab({ refreshSec }: { refreshSec: number }) {
  const [sub, setSub] = useState<Sub>('server');
  // a deep link to a build always shows the Server tab
  useEffect(() => onShowAutoLanderBuild(() => setSub('server')), []);
  return (
    <TabGroup<Sub> id="gate.auto-lander.tabs" label="Auto-lander" value={sub} onChange={setSub}
      tabs={[{ value: 'server', label: 'Server', icon: 'monitor' }, { value: 'line', label: 'Merge line', icon: 'branch' }]}>
      <div className="axp-gate__panel">
        {sub === 'server' ? <ServerPanel refreshSec={refreshSec} /> : <LanderTab refreshSec={refreshSec} />}
      </div>
    </TabGroup>
  );
}

function ServerPanel({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const rows = useGridRows();
  const st = usePoll<AutoLanderStatus>(autoLanderPath(), Math.min(refreshSec, 30));
  const [selected, setSelected] = useState<string | null>(() => takeAutoLanderBuild() || null);
  const [expanded, setExpanded] = useState<string[]>(() => (selected ? [selected] : []));
  const [busy, setBusy] = useState('');
  useEffect(() => onShowAutoLanderBuild((b) => { setSelected(b); setExpanded((cur) => (cur.includes(b) ? cur : [...cur, b])); }), []);
  const s = st.data;
  const builds = useMemo(() => [...(s?.builds ?? [])], [s]);
  const up = !!s && minutesSince(s.service.lastTick) < 5;

  const act = async (key: string, path: string, done: string) => {
    setBusy(key);
    try { await gateCall(autoLanderPath(path), 'POST', {}); rt.toast(done, 'success', 'Lander'); await st.reload(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Lander'); } finally { setBusy(''); }
  };
  const run = () => act('run', 'run', 'The lander runs within a minute.');
  const retry = (b: string) => act(`retry-${b}`, `retry/${encodeURIComponent(b)}`, `${b}: its next attempt is due now.`);
  const fix = (b: string) => act(`fix-${b}`, `fix/${encodeURIComponent(b)}`, `${b}: its next attempt starts within a minute.`);
  const pause = () => act('pause', 'pause', 'The lander is paused.');
  const resume = () => act('resume', 'resume', 'The lander is running again.');

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'panel:gate.auto-lander', kind: 'panel', label: 'Lander status', keywords: ['auto-lander', 'lander', 'server', 'service', 'failed', 'fix'], get: () => (s ? { up, paused: s.service.paused, current: s.current, builds: s.builds.length, failing: s.failing.map((f) => f.build) } : null) },
  ], [s, up]);
  useControlTargets(targets, s?.at ?? s?.service.lastTick ?? '');

  const cols: GridColumn<AutoLanderBuild>[] = [
    { id: 'build', label: 'Build', width: 'calc(var(--fx-space) * 80)', fixed: true, sortable: true, sortValue: (b) => b.build, render: (b) => (
      <span className="axp-gate__cell"><strong>{b.build}</strong>{rows === 2 && <span className="axp-gate__sub">{b.title}</span>}</span>
    ) },
    { id: 'state', label: 'Status', width: 'calc(var(--fx-space) * 36)', sortable: true, sortValue: (b) => b.status, render: (b) => <Chip tone={statusTone(b.status)}>{label(b)}</Chip> },
    { id: 'attempts', label: 'PRs', width: 'calc(var(--fx-space) * 30)', sortable: true, sortValue: (b) => b.prs.length, render: (b) => (
      <span className="axp-gate__cell"><span>{b.prs.length ? b.prs.map((p) => `#${p.pr}`).join(' ') : 'none yet'}</span>{rows === 2 && <span className="axp-gate__sub">{b.prs.filter((p) => p.state === 'merged').length} merged · {b.waiting.length} step(s) waiting</span>}</span>
    ) },
    { id: 'reason', label: 'Last result', width: 'calc(var(--fx-space) * 110)', render: (b) => (
      <span className="axp-gate__cell">{b.failure ? b.failure.why : b.statusAt ? `${label(b)} since ${when(b.statusAt)}` : ''}{rows === 2 && b.failure && <span className="axp-gate__sub">next: {RETRY[b.failure.retry] ?? b.failure.retry}{b.failure.notBefore ? ` at ${when(b.failure.notBefore)}` : ''}</span>}</span>
    ) },
  ];
  const detail = (b: AutoLanderBuild) => (
    <div className="axp-gate__cell" data-axf-target={`panel:gate.auto-lander.log=${b.build}`}>
      {b.steps.map((x) => (
        <div key={x.id} className="axp-gate__detail">
          <span className="axp-gate__cell axp-gate__cell--row"><Chip tone={x.status === 'in-pr' ? 'success' : x.status === 'failed' ? 'danger' : undefined}>{x.status === 'in-pr' && x.prNumber ? `added to PR #${x.prNumber}` : x.status || 'pending'}</Chip><strong>{x.id}</strong></span>
          <span className="axp-gate__sub">{[x.model, x.slot != null ? `slot ${x.slot}` : ''].filter(Boolean).join(' · ')}</span>
        </div>
      ))}
      {b.failure && <pre className="axp-gate__pre">{`${b.failure.kind} in ${b.failure.status}: ${b.failure.why}${b.failure.fix ? `\nfix session ${b.failure.fix.session || ''} since ${when(b.failure.fix.at)}` : ''}`}</pre>}
    </div>
  );
  const sel = builds.find((b) => b.build === selected) ?? null;

  return (
    <>
      <div className="axp-gate__bar" role="toolbar" aria-label="Server auto-lander" data-axf-toolbar="gate.auto-lander">
        <Button id="gate-al-run" icon="play" busy={busy === 'run'} disabled={!s || s.service.paused} onClick={() => void run()}>Run now</Button>
        <span className="axp-gate__bar-end">
          <Button id="gate-al-retry" icon="refresh" disabled={!sel || sel.status !== 'failed'} busy={!!sel && busy === `retry-${sel.build}`} onClick={() => sel && void retry(sel.build)}>{sel ? `Retry ${sel.build}` : 'Retry'}</Button>
          <Button id="gate-al-fix" icon="hammer" tone="primary" disabled={!sel || sel.status !== 'failed'} busy={!!sel && busy === `fix-${sel.build}`} confirm={sel ? `Start the next attempt for ${sel.build} now instead of after its backoff?` : undefined} onClick={() => sel && void fix(sel.build)}>Fix</Button>
          {s?.service.paused
            ? <Button id="gate-al-resume" icon="play" busy={busy === 'resume'} onClick={() => void resume()}>Resume</Button>
            : <Button id="gate-al-pause" icon="pause" busy={busy === 'pause'} disabled={!s} onClick={() => void pause()}>Pause</Button>}
        </span>
      </div>
      {st.error && <p className="axp-gate__err" role="alert">{st.error}</p>}
      <Container title="Lander" icon="monitor">
        {!s ? <p className="axp-gate__sub">Loading the lander…</p> : (
          <div className="axp-gate__status">
            <div className="axp-gate__stat"><span className="axp-gate__label">Service</span><span><Chip tone={s.service.paused ? 'warning' : up ? 'success' : 'danger'}>{s.service.paused ? 'paused' : up ? 'up' : 'down'}</Chip></span><span className="axp-gate__sub">{s.service.lastTick ? `last tick ${when(s.service.lastTick)}` : 'never ticked'}</span></div>
            <div className="axp-gate__stat"><span className="axp-gate__label">Landing</span><span>{s.current || 'nothing right now'}</span><span className="axp-gate__sub">{s.queue.length} waiting to land</span></div>
            <div className="axp-gate__stat"><span className="axp-gate__label">Failing</span><span>{s.failing.length ? s.failing.map((f) => `${f.build} (attempt ${f.attempt})`).join(', ') : 'nothing'}</span><span className="axp-gate__sub">retries by itself; nobody needs to act</span></div>
            <div className="axp-gate__stat"><span className="axp-gate__label">Size cap</span><span>{s.settings.sizeCapLines} lines a PR</span><span className="axp-gate__sub">bigger builds land as 2, 3 or more PRs</span></div>
          </div>
        )}
      </Container>
      <GateList<AutoLanderBuild>
        id="gate.auto-lander" label="Builds in the lander" title={`Builds (${builds.length})`} rows={builds} columns={cols}
        rowId={(b) => b.build} rowLabel={(b) => `${b.build}: ${label(b)}`} hidden={[]}
        expanded={expanded} onToggleExpand={(id) => setExpanded((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))} renderDetail={detail}
        selected={selected} onRowClick={(b) => { setSelected((cur) => (cur === b.build ? null : b.build)); setExpanded((cur) => (cur.includes(b.build) ? cur : [...cur, b.build])); }} rowTone={(b) => statusTone(b.status) ?? 'muted'}
        empty={<p className="axp-gate__sub">{s ? 'Nothing waits to land: the lander picks a build up at build complete.' : 'Loading…'}</p>}
      />
    </>
  );
}
