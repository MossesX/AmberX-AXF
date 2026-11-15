/**
 * Auto-lander tab: the one Merge queue on/off switch (`setting:gate.lander.mergeQueue`), the status card (running /
 * paused / idle / off, since when, the PR landing now, the line), the PRs waiting (`grid:gate.waiting`, one row a PR:
 * which rule holds it and why), the last runs (`grid:gate.runs`) and the toolbar (role="toolbar", settings id
 * gate.lander): Land now (the selected PR; asks first), Pause / Resume (`button:gate-land-now | gate-pause | gate-resume`).
 * Every press is the REST route the CLI (`axf gate lander …`), MCP (lander_*) and voice use.
 */
import { useMemo, useState } from 'react';
import { Button, Chip, Container, Switch, TextField, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import type { GridColumn } from '@console/axf/libs/datagrid';
import { GateList } from './GateList';
import { confirmed, gateCall, type LanderStatus, type Run, type Waiting } from './api';
import { useGridRows } from './rows';
import { usePoll } from './usePoll';

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const statusTone = (s: string) => (s === 'running' ? 'success' : s === 'paused' ? 'warning' : s === 'error' ? 'danger' : undefined);
const stateTone = (s: string) => (s === 'kicked' ? 'danger' : s === 'held' ? 'warning' : s === 'testing' || s === 'merging' ? 'accent' : 'muted');
const resultTone = (s: string) => (s === 'landed' ? 'success' : s === 'error' ? 'danger' : s === 'landing' ? 'accent' : 'muted');

export function LanderTab({ refreshSec }: { refreshSec: number }) {
  const rt = useRuntime();
  const rows = useGridRows();
  const st = usePoll<LanderStatus>('lander', refreshSec);
  const wt = usePoll<{ items: Waiting[] }>('lander/waiting', refreshSec);
  const rn = usePoll<{ items: Run[] }>('lander/runs?limit=30', refreshSec);
  const [selected, setSelected] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState('');
  const s = st.data;
  const waiting = wt.data?.items ?? [];
  const runs = rn.data?.items ?? [];
  const reloadAll = async () => { await Promise.all([st.reload(), wt.reload(), rn.reload()]); };

  const act = async (key: string, run: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await run(); rt.toast(done, 'success', 'Auto-lander'); await reloadAll(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Auto-lander'); } finally { setBusy(''); }
  };
  const setMode = (on: boolean) => act('mode', () => gateCall('lander/mode', 'POST', { mergeQueue: on, reason: `Merge queue ${on ? 'on' : 'off'} from the Auto-lander tab` }), on ? 'Merge queue on: PRs go through the stacked merge queue.' : 'Merge queue off: the auto-lander lands one build at a time.');
  const landNow = (pr: number) => act(`land-${pr}`, () => confirmed('lander/land-now', { pr, reason: 'Land now from the Auto-lander tab' }), `#${pr} lands next.`);
  const pause = () => act('pause', () => gateCall('lander/pause', 'POST', { why: why || 'paused from the console' }), 'The auto-lander is paused: what is in flight finishes, nothing new starts.');
  const resume = () => act('resume', () => gateCall('lander/resume', 'POST', {}), 'The auto-lander is running again.');

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'setting:gate.lander.mergeQueue', kind: 'setting', label: 'Merge queue on / off', keywords: ['gate', 'lander', 'merge queue', 'one at a time'], get: () => s?.mergeQueue ?? null, set: (v: unknown) => setMode(v === true || v === 'on' || v === 'true') },
  ], [s?.mergeQueue]); // eslint-disable-line react-hooks/exhaustive-deps
  useControlTargets(targets, String(s?.mergeQueue));

  const waitCols: GridColumn<Waiting>[] = [
    { id: 'position', label: '#', width: 'calc(var(--fx-space) * 10)', sortable: true, sortValue: (w) => w.position, render: (w) => <span>{w.position}</span> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-space) * 88)', fixed: true, sortable: true, sortValue: (w) => w.pr, render: (w) => (
      <span className="axp-gate__cell"><strong>#{w.pr} {w.title}</strong>{rows === 2 && <span className="axp-gate__sub">{w.build || w.branch}</span>}</span>
    ) },
    { id: 'build', label: 'Build', width: 'calc(var(--fx-space) * 48)', render: (w) => <span className="axp-gate__sub">{w.build}</span> },
    { id: 'rule', label: 'Held by', width: 'calc(var(--fx-space) * 28)', sortable: true, sortValue: (w) => w.rule, render: (w) => (w.rule ? <Chip tone="warning">{w.rule}</Chip> : <span className="axp-gate__sub">{w.state}</span>) },
    { id: 'reason', label: 'Why', width: 'calc(var(--fx-space) * 100)', render: (w) => <span className="axp-gate__cell">{w.reason}{rows === 2 && w.gate && !w.gate.pass && w.gate.reasons[0] && w.gate.reasons[0] !== w.reason && <span className="axp-gate__sub">{w.gate.reasons[0]}</span>}</span> },
    { id: 'act', label: '', width: 'calc(var(--fx-space) * 28)', render: (w) => <Button size="sm" id={`gate-land-now-${w.pr}`} busy={busy === `land-${w.pr}`} confirm={`Land #${w.pr} next? It still has to pass every rule.`} onClick={(e) => { e.stopPropagation(); void landNow(w.pr); }}>Land next</Button> },
  ];
  const runCols: GridColumn<Run>[] = [
    { id: 'startedAt', label: 'When', width: 'calc(var(--fx-space) * 36)', fixed: true, sortable: true, sortValue: (r) => r.startedAt, render: (r) => <span>{when(r.startedAt)}</span> },
    { id: 'result', label: 'Result', width: 'calc(var(--fx-space) * 24)', render: (r) => <Chip tone={r.result === 'landed' ? 'success' : r.result === 'error' ? 'danger' : undefined}>{r.result}</Chip> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-space) * 112)', render: (r) => <span className="axp-gate__cell">{r.landing ? <strong>#{r.landing.pr} {r.landing.title || r.landing.build}</strong> : <span className="axp-gate__sub">nothing landed</span>}{rows === 2 && r.reasonText && <span className="axp-gate__sub">{r.reasonText}</span>}</span> },
    { id: 'mode', label: 'Mode', width: 'calc(var(--fx-space) * 32)', render: (r) => <span className="axp-gate__sub">{r.mode === 'serial' ? 'one at a time' : 'merge queue'}</span> },
  ];

  return (
    <>
      <div className="axp-gate__bar" role="toolbar" aria-label="Auto-lander" data-axf-toolbar="gate.lander">
        <Switch label="Merge queue" checked={!!s?.mergeQueue} disabled={!s || busy === 'mode'} onChange={(v) => void setMode(v)}
          hint={s?.mergeQueue ? 'On: PRs go through the stacked merge queue; the one-at-a-time lander is off.' : 'Off: the auto-lander lands each finished build one at a time (main merged in first, clashes fixed, then landed).'} />
        <span className="axp-gate__bar-end">
          <Button id="gate-land-now" icon="rocket" disabled={!selected} busy={!!selected && busy === `land-${selected}`} confirm={selected ? `Land #${selected} next? It still has to pass every rule.` : undefined} onClick={() => selected && void landNow(selected)}>{selected ? `Land #${selected} now` : 'Land now'}</Button>
          {s?.paused
            ? <Button id="gate-resume" icon="play" tone="primary" busy={busy === 'resume'} onClick={() => void resume()}>Resume</Button>
            : <><TextField label="Why pause" value={why} onChange={setWhy} placeholder="optional" /><Button id="gate-pause" icon="pause" busy={busy === 'pause'} onClick={() => void pause()}>Pause</Button></>}
        </span>
      </div>
      {(st.error || wt.error) && <p className="axp-gate__err" role="alert">{st.error || wt.error}</p>}
      <Container title="Status" icon="branch">
        {!s ? <p className="axp-gate__sub">Loading the lander…</p> : (
          <div className="axp-gate__status">
            <div className="axp-gate__stat"><span className="axp-gate__label">Lander</span><span><Chip tone={statusTone(s.status)}>{s.status}</Chip></span>{s.paused && s.pause && <span className="axp-gate__sub">since {when(s.pause.at)}{s.pause.why ? `: ${s.pause.why}` : ''}</span>}</div>
            <div className="axp-gate__stat"><span className="axp-gate__label">Mode</span><span>{s.mergeQueue ? `Merge queue (${s.mode})` : 'One at a time'}</span>{s.modeSince && <span className="axp-gate__sub">since {when(s.modeSince)}{s.modeBy ? ` (${s.modeBy})` : ''}</span>}</div>
            <div className="axp-gate__stat"><span className="axp-gate__label">Landing now</span><span>{s.landing ? `#${s.landing.pr} ${s.landing.title || s.landing.build}` : 'nothing'}</span>{s.landing?.since && <span className="axp-gate__sub">since {when(s.landing.since)}</span>}</div>
            <div className="axp-gate__stat"><span className="axp-gate__label">In line</span><span>{s.counts.waiting} waiting</span>{s.lastRun && <span className="axp-gate__sub">last run {when(s.lastRun.startedAt)}: {s.lastRun.result}</span>}</div>
          </div>
        )}
      </Container>
      <GateList<Waiting>
        id="gate.waiting" label="Waiting to land" title={`Waiting (${waiting.length})`} rows={waiting} columns={waitCols}
        rowId={(w) => String(w.pr)} rowLabel={(w) => `#${w.pr} ${w.title}`} hidden={rows === 1 ? ['build'] : []}
        selected={selected ? String(selected) : null} onRowClick={(w) => setSelected((cur) => (cur === w.pr ? null : w.pr))} rowTone={(w) => stateTone(w.state)}
        empty={<p className="axp-gate__sub">{wt.data ? 'Nothing waits to land.' : 'Loading…'}</p>}
      />
      <GateList<Run>
        id="gate.runs" label="Last runs" title={`Last runs (${runs.length})`} rows={runs} columns={runCols}
        rowId={(r) => `${r.startedAt}-${r.landing?.pr ?? ''}-${r.result}`} rowLabel={(r) => `${r.result} ${r.landing ? `#${r.landing.pr}` : ''}`}
        rowTone={(r) => resultTone(r.result)}
        empty={<p className="axp-gate__sub">{rn.data ? 'No runs yet.' : 'Loading…'}</p>}
      />
    </>
  );
}
