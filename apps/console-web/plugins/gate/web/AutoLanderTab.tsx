/**
 * Gate → Auto-lander: two tabs in one framework TabGroup (settings id `gate.auto-lander.tabs`):
 *   Server       the server auto-lander (auto-lander@1, deploy/auto-lander/auto-lander.mjs on the VPS): service status, the
 *                build it works on, every build it tracks (`grid:gate.auto-lander`, one row a build:
 *                `grid:gate.auto-lander/row:<build>`) with its state, attempts and last decision, and the attempt log
 *                under each row. Toolbar (role="toolbar", `gate.auto-lander`): Run now, Retry and Fix (the selected
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
import { autoLanderPath, onShowAutoLanderBuild, takeAutoLanderBuild, type AutoLanderAttempt, type AutoLanderBuild, type AutoLanderStatus } from './autoLanderState';
import { useGridRows } from './rows';
import { usePoll } from './usePoll';

type Sub = 'server' | 'line';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const STATE_LABEL: Record<string, string> = { waiting: 'waiting', 'merging-main': 'merging main', fixing: 'fixing', 'ci-running': 'CI running', landing: 'landing', landed: 'landed', escalated: 'needs a hand' };
const stateTone = (s: string) => (s === 'escalated' ? 'danger' : s === 'fixing' || s === 'merging-main' ? 'warning' : s === 'landing' || s === 'ci-running' ? 'accent' : s === 'landed' ? 'success' : undefined);
const resultTone = (r: string) => (r === 'ok' ? 'success' : r === 'failed' || r === 'timeout' ? 'danger' : r === 'started' ? 'accent' : undefined);
const KIND: Record<string, string> = { clash: 'merge main', 'red-ci': 'fix red CI', land: 'land' };

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
  const builds = useMemo(() => [...(s?.builds ?? [])].sort((a, b) => Number(b.state === 'escalated') - Number(a.state === 'escalated') || b.since.localeCompare(a.since)), [s]);

  const act = async (key: string, path: string, done: string) => {
    setBusy(key);
    try { await gateCall(autoLanderPath(path), 'POST', {}); rt.toast(done, 'success', 'Auto-lander'); await st.reload(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Auto-lander'); } finally { setBusy(''); }
  };
  const run = () => act('run', 'run', 'The auto-lander runs within a minute.');
  const retry = (b: string) => act(`retry-${b}`, `retry/${encodeURIComponent(b)}`, `${b}: attempts reset, it tries again.`);
  const fix = (b: string) => act(`fix-${b}`, `fix/${encodeURIComponent(b)}`, `${b}: a fix session starts within a minute.`);
  const pause = () => act('pause', 'pause', 'The server auto-lander is paused.');
  const resume = () => act('resume', 'resume', 'The server auto-lander is running again.');

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'panel:gate.auto-lander', kind: 'panel', label: 'Server auto-lander status', keywords: ['auto-lander', 'server', 'service', 'escalated', 'fix'], get: () => (s ? { up: s.service.up, paused: s.service.paused, current: s.current, builds: s.builds.length, escalated: s.escalated } : null) },
  ], [s]);
  useControlTargets(targets, s?.at ?? '');

  const cols: GridColumn<AutoLanderBuild>[] = [
    { id: 'build', label: 'Build', width: 'calc(var(--fx-space) * 80)', fixed: true, sortable: true, sortValue: (b) => b.build, render: (b) => (
      <span className="axp-gate__cell"><strong>{b.build}</strong>{rows === 2 && <span className="axp-gate__sub">{b.pr ? `#${b.pr} · ` : ''}{b.branch}</span>}</span>
    ) },
    { id: 'state', label: 'State', width: 'calc(var(--fx-space) * 28)', sortable: true, sortValue: (b) => b.state, render: (b) => <Chip tone={stateTone(b.state)}>{STATE_LABEL[b.state] ?? b.state}</Chip> },
    { id: 'attempts', label: 'Attempts', width: 'calc(var(--fx-space) * 30)', sortable: true, sortValue: (b) => b.count.total, render: (b) => (
      <span className="axp-gate__cell"><span>{b.count.total} ({b.count.clash.failures + b.count['red-ci'].failures + b.count.land.failures} failed)</span>{rows === 2 && <span className="axp-gate__sub">merge {b.count.clash.attempts} · fix {b.count['red-ci'].attempts} · land {b.count.land.attempts}</span>}</span>
    ) },
    { id: 'reason', label: 'Last result', width: 'calc(var(--fx-space) * 110)', render: (b) => (
      <span className="axp-gate__cell">{b.reason}{rows === 2 && b.last && <span className="axp-gate__sub">{when(b.last.at)}: {b.last.action}{b.last.notBefore ? `, next try ${when(b.last.notBefore)}` : ''}</span>}</span>
    ) },
  ];
  const attemptLog = (b: AutoLanderBuild) => (
    <div className="axp-gate__cell" data-axf-target={`panel:gate.auto-lander.log=${b.build}`}>
      {!b.attempts.length ? <span className="axp-gate__sub">No attempts yet.</span> : b.attempts.slice().reverse().map((a: AutoLanderAttempt) => (
        <div key={`${a.kind}-${a.n}-${a.at}`} className="axp-gate__detail">
          <span className="axp-gate__cell axp-gate__cell--row"><Chip tone={resultTone(a.result)}>{a.result}</Chip><strong>{KIND[a.kind] ?? a.kind} #{a.n}</strong></span>
          <span className="axp-gate__sub">{when(a.at)}{a.endedAt ? ` → ${when(a.endedAt)}` : ''}{a.account ? ` · ${a.account}` : ''}{a.session ? ` · ${a.session}` : ''}{a.head ? ` · ${a.head.slice(0, 9)}` : ''}</span>
          {a.log && <pre className="axp-gate__pre">{a.log}</pre>}
        </div>
      ))}
    </div>
  );
  const sel = builds.find((b) => b.build === selected) ?? null;

  return (
    <>
      <div className="axp-gate__bar" role="toolbar" aria-label="Server auto-lander" data-axf-toolbar="gate.auto-lander">
        <Button id="gate-al-run" icon="play" busy={busy === 'run'} disabled={!s || s.service.paused} onClick={() => void run()}>Run now</Button>
        <span className="axp-gate__bar-end">
          <Button id="gate-al-retry" icon="refresh" disabled={!sel} busy={!!sel && busy === `retry-${sel.build}`} onClick={() => sel && void retry(sel.build)}>{sel ? `Retry ${sel.build}` : 'Retry'}</Button>
          <Button id="gate-al-fix" icon="hammer" tone="primary" disabled={!sel} busy={!!sel && busy === `fix-${sel.build}`} confirm={sel ? `Reset ${sel.build} and start a fix session for it now?` : undefined} onClick={() => sel && void fix(sel.build)}>Fix</Button>
          {s?.service.paused
            ? <Button id="gate-al-resume" icon="play" busy={busy === 'resume'} onClick={() => void resume()}>Resume</Button>
            : <Button id="gate-al-pause" icon="pause" busy={busy === 'pause'} disabled={!s} onClick={() => void pause()}>Pause</Button>}
        </span>
      </div>
      {st.error && <p className="axp-gate__err" role="alert">{st.error}</p>}
      <Container title="Server auto-lander" icon="monitor">
        {!s ? <p className="axp-gate__sub">Loading the auto-lander…</p> : (
          <div className="axp-gate__status">
            <div className="axp-gate__stat"><span className="axp-gate__label">Service</span><span><Chip tone={s.service.paused ? 'warning' : s.service.up ? 'success' : 'danger'}>{s.service.paused ? 'paused' : s.service.up ? 'up' : 'down'}</Chip></span><span className="axp-gate__sub">{s.service.lastTick ? `last tick ${when(s.service.lastTick)}` : 'never ticked'}</span></div>
            <div className="axp-gate__stat"><span className="axp-gate__label">Working on</span><span>{s.current || 'nothing right now'}</span><span className="axp-gate__sub">{s.queue.length} in its queue</span></div>
            <div className="axp-gate__stat"><span className="axp-gate__label">Needs a hand</span><span>{s.escalations.length ? s.escalations.map((e) => e.build).join(', ') : 'nothing'}</span><span className="axp-gate__sub">after {s.settings.maxAttempts} failed tries</span></div>
            <div className="axp-gate__stat"><span className="axp-gate__label">Tracked</span><span>{s.builds.length} builds</span><span className="axp-gate__sub">{s.builds.filter((b) => b.state === 'landed').length} landed</span></div>
          </div>
        )}
      </Container>
      <GateList<AutoLanderBuild>
        id="gate.auto-lander" label="Builds in the auto-lander" title={`Builds (${builds.length})`} rows={builds} columns={cols}
        rowId={(b) => b.build} rowLabel={(b) => `${b.build}: ${STATE_LABEL[b.state] ?? b.state}`} hidden={[]}
        expanded={expanded} onToggleExpand={(id) => setExpanded((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))} renderDetail={attemptLog}
        selected={selected} onRowClick={(b) => { setSelected((cur) => (cur === b.build ? null : b.build)); setExpanded((cur) => (cur.includes(b.build) ? cur : [...cur, b.build])); }} rowTone={(b) => stateTone(b.state) ?? 'muted'}
        empty={<p className="axp-gate__sub">{s ? 'No finished builds yet: the auto-lander picks them up as they are built.' : 'Loading…'}</p>}
      />
    </>
  );
}
