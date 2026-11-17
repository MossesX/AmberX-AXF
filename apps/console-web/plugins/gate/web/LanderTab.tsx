/**
 * Auto-lander tab: the one Merge queue on/off switch (`setting:gate.lander.mergeQueue`), the status card (running /
 * paused / idle / off, since when, the PR landing now, the line), the grid of everything waiting to be merged
 * (`grid:gate.waiting`, lander-grid@1: ONE row per build, every original column (# · PR + title · build · held by ·
 * why · land next) plus "Commits behind main", each sortable; at most two lines a row), the last runs
 * (`grid:gate.runs`) and two toolbars (role="toolbar"): gate.lander (Merge queue, Land now, Pause / Resume) and
 * gate.lander.grid (filter e.g. "behind > 500", Select + bulk Archive, Show stale, Clean stale). Each row's menu
 * (`button:gate-row-menu-<build>`) holds Open, Merge main + fix, Hold / Release and Archive: the console actions
 * lander.row.* that voice uses too. Every press is the REST route the CLI (`axf gate lander …`) and MCP (lander_*) use.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, IconButton, MenuList, Switch, TextField, useControlTargets, useRuntime, type ControlTargetDef } from '@console/axf/react';
import type { GridSort } from '@console/axf/libs/datagrid';
import type { GridColumn } from '@console/axf/libs/datagrid';
import { GateList } from './GateList';
import { confirmed, gateCall, onGridChanged, type GridRow, type LanderGrid, type LanderStatus, type Run } from './api';
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
  const [filter, setFilter] = useState('');
  const [showStale, setShowStale] = useState(false);
  const wt = usePoll<LanderGrid>(`lander/grid?filter=${encodeURIComponent(filter)}${showStale ? '&stale=true' : ''}`, refreshSec);
  const [sort, setSort] = useState<GridSort>({ col: 'behind', dir: -1 });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const rn = usePoll<{ items: Run[] }>('lander/runs?limit=30', refreshSec);
  const [selected, setSelected] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState('');
  const s = st.data;
  const waiting = wt.data?.items ?? [];
  const runs = rn.data?.items ?? [];
  const reloadAll = async () => { await Promise.all([st.reload(), wt.reload(), rn.reload()]); };
  useEffect(() => onGridChanged(() => { setPicked([]); setMenuFor(null); void reloadAll(); }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key: string, run: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await run(); rt.toast(done, 'success', 'Auto-lander'); await reloadAll(); }
    catch (e) { rt.toast((e as Error).message, 'danger', 'Auto-lander'); } finally { setBusy(''); }
  };
  const setMode = (on: boolean) => act('mode', () => gateCall('lander/mode', 'POST', { mergeQueue: on, reason: `Merge queue ${on ? 'on' : 'off'} from the Auto-lander tab` }), on ? 'Merge queue on: PRs go through the stacked merge queue.' : 'Merge queue off: the auto-lander lands one build at a time.');
  const landNow = (pr: number) => act(`land-${pr}`, () => confirmed('lander/land-now', { pr, reason: 'Land now from the Auto-lander tab' }), `#${pr} lands next.`);
  const pause = () => act('pause', () => gateCall('lander/pause', 'POST', { why: why || 'paused from the console' }), 'The auto-lander is paused: what is in flight finishes, nothing new starts.');
  const resume = () => act('resume', () => gateCall('lander/resume', 'POST', {}), 'The auto-lander is running again.');
  const archivePicked = () => act('archive', () => confirmed('lander/archive', { builds: picked, reason: `Bulk archive of ${picked.length} build(s) from the Auto-lander grid` }), `Archived ${picked.length} build(s); their open PRs are being closed (branches kept).`).then(() => setPicked([]));
  const clean = () => act('clean', () => gateCall('lander/clean', 'POST', { reason: 'Clean stale records from the Auto-lander grid' }), 'Stale records (no PR, no branch) are off the list.');
  const onSort = (col: string | null) => setSort((cur) => (!col ? null : cur?.col === col ? { col, dir: cur.dir === 1 ? -1 : 1 } : { col, dir: col === 'behind' ? -1 : 1 }));
  const rowMenu = (w: GridRow) => [
    { id: 'open', label: w.pr ? `Open PR #${w.pr}` : 'Open (no PR yet)', icon: 'external', action: `lander.row.open:${w.build}` },
    { id: 'merge-main', label: 'Merge main + fix', icon: 'branch', action: `lander.row.merge-main:${w.build}` },
    { id: 'hold', label: w.held ? 'Release' : 'Hold', icon: w.held ? 'play' : 'pause', action: `lander.row.hold:${w.build}${w.held ? ':off' : ''}` },
    { id: 's1', separator: true },
    { id: 'archive', label: 'Archive (closes the PR, keeps the branch)', icon: 'box', action: `lander.row.archive:${w.build}` },
  ];

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'setting:gate.lander.mergeQueue', kind: 'setting', label: 'Merge queue on / off', keywords: ['gate', 'lander', 'merge queue', 'one at a time'], get: () => s?.mergeQueue ?? null, set: (v: unknown) => setMode(v === true || v === 'on' || v === 'true') },
  ], [s?.mergeQueue]); // eslint-disable-line react-hooks/exhaustive-deps
  useControlTargets(targets, String(s?.mergeQueue));

  const menuButton = (w: GridRow) => !selecting && <IconButton id={`gate-row-menu-${w.build}`} icon="more" label={`Actions for ${w.build}`} aria-expanded={menuFor === w.build} onClick={(e) => { e.stopPropagation(); setMenuFor((cur) => (cur === w.build ? null : w.build)); }} />;
  // Every original waiting column stays (Brett, Nov 16 2026: keep them all), plus "Commits behind main"; all sortable.
  const waitCols: GridColumn<GridRow>[] = [
    { id: 'position', label: '#', width: 'calc(var(--fx-space) * 10)', sortable: true, sortValue: (w) => w.position ?? Number.MAX_SAFE_INTEGER, render: (w) => <span>{w.position ?? '—'}</span> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-space) * 88)', fixed: true, sortable: true, sortValue: (w) => w.pr ?? 0, render: (w) => (
      <span className="axp-gate__cell axp-gate__cell--row">
        <span className="axp-gate__cell">
          <strong className="axp-gate__line">{w.pr ? `#${w.pr} ` : ''}{w.title || w.what || w.build}</strong>
          {rows === 2 && <span className="axp-gate__sub axp-gate__line">{w.build || w.branch}</span>}
        </span>
        {menuButton(w)}
      </span>
    ) },
    { id: 'build', label: 'Build', width: 'calc(var(--fx-space) * 48)', sortable: true, sortValue: (w) => w.build, render: (w) => <span className="axp-gate__sub axp-gate__line">{w.build}</span> },
    { id: 'rule', label: 'Held by', width: 'calc(var(--fx-space) * 28)', sortable: true, sortValue: (w) => w.rule || (w.held ? 'hold' : w.state), render: (w) => (w.rule ? <Chip tone="warning">{w.rule}</Chip> : w.held ? <Chip tone="warning">hold</Chip> : <span className="axp-gate__sub">{w.state}</span>) },
    { id: 'reason', label: 'Why', width: 'calc(var(--fx-space) * 100)', sortable: true, sortValue: (w) => w.reason || '', render: (w) => (
      <span className="axp-gate__cell"><span className="axp-gate__line">{w.reason}</span>{rows === 2 && w.gate && !w.gate.pass && w.gate.reasons[0] && w.gate.reasons[0] !== w.reason && <span className="axp-gate__sub axp-gate__line">{w.gate.reasons[0]}</span>}</span>
    ) },
    { id: 'behind', label: 'Commits behind main', width: 'calc(var(--fx-space) * 30)', align: 'end', sortable: true, sortValue: (w) => w.behind ?? -1, render: (w) => <span title={w.onRemote ? `${w.branch} vs main` : `${w.branch} is not on GitHub`}>{w.behind ?? '?'}</span> },
    { id: 'act', label: 'Land', width: 'calc(var(--fx-space) * 28)', sortable: true, sortValue: (w) => (w.gate?.pass ? 1 : 0), render: (w) => (w.pr ? <Button size="sm" id={`gate-land-now-${w.pr}`} busy={busy === `land-${w.pr}`} confirm={`Land #${w.pr} next? It still has to pass every rule.`} onClick={(e) => { e.stopPropagation(); void landNow(w.pr as number); }}>Land next</Button> : <span className="axp-gate__sub">no PR</span>) },
  ];
  const runCols: GridColumn<Run>[] = [
    { id: 'startedAt', label: 'When', width: 'calc(var(--fx-space) * 36)', fixed: true, sortable: true, sortValue: (r) => r.startedAt, render: (r) => <span>{when(r.startedAt)}</span> },
    { id: 'result', label: 'Result', width: 'calc(var(--fx-space) * 24)', sortable: true, sortValue: (r) => r.result, render: (r) => <Chip tone={r.result === 'landed' ? 'success' : r.result === 'error' ? 'danger' : undefined}>{r.result}</Chip> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-space) * 112)', sortable: true, sortValue: (r) => r.landing?.pr ?? 0, render: (r) => <span className="axp-gate__cell">{r.landing ? <strong>#{r.landing.pr} {r.landing.title || r.landing.build}</strong> : <span className="axp-gate__sub">nothing landed</span>}{rows === 2 && r.reasonText && <span className="axp-gate__sub">{r.reasonText}</span>}</span> },
    { id: 'mode', label: 'Mode', width: 'calc(var(--fx-space) * 32)', sortable: true, sortValue: (r) => r.mode, render: (r) => <span className="axp-gate__sub">{r.mode === 'serial' ? 'one at a time' : 'merge queue'}</span> },
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
      <div className="axp-gate__bar" role="toolbar" aria-label="Waiting to merge" data-axf-toolbar="gate.lander.grid">
        <TextField label="Filter" value={filter} onChange={setFilter} placeholder="behind > 500, pr:712, held, words" />
        <Switch label="Show stale" checked={showStale} onChange={setShowStale} hint={`Records with no PR and no branch on GitHub (${wt.data?.stale ?? 0} hidden).`} />
        <span className="axp-gate__bar-end">
          {!!wt.data?.stale && <Button id="gate-clean-stale" icon="trash" busy={busy === 'clean'} confirm={`Drop ${wt.data.stale} stale record(s) (no PR, no branch) from the list?`} onClick={() => void clean()}>Clean stale</Button>}
          <Button id="gate-select" icon="check" tone={selecting ? 'primary' : undefined} onClick={() => { setSelecting((v) => !v); setPicked([]); setMenuFor(null); }}>{selecting ? 'Done' : 'Select'}</Button>
          {selecting && <Button id="gate-archive-selected" icon="box" disabled={!picked.length} busy={busy === 'archive'} confirm={`Archive ${picked.length} build(s)? Their open PRs are closed with a note; the branches are kept.`} onClick={() => void archivePicked()}>{`Archive ${picked.length || ''}`.trim()}</Button>}
        </span>
      </div>
      <GateList<GridRow>
        id="gate.waiting" label="Waiting to merge" title={`Waiting to merge (${waiting.length}${wt.data && wt.data.total !== waiting.length ? ` of ${wt.data.total}` : ''})`} rows={waiting} columns={waitCols}
        rowId={(w) => w.build} rowLabel={(w) => `${w.pr ? `#${w.pr} ` : ''}${w.build}`}
        sort={sort} onSort={onSort} multi={picked}
        expanded={menuFor ? [menuFor] : []} renderDetail={(w) => (
          <div className="axp-gate__rowmenu fx-popover" role="menu" aria-label={`Actions for ${w.build}`}><MenuList items={rowMenu(w)} onDone={() => setMenuFor(null)} /></div>
        )}
        selected={selecting ? null : waiting.find((w) => w.pr === selected)?.build ?? null}
        onRowClick={(w) => (selecting ? setPicked((cur) => (cur.includes(w.build) ? cur.filter((x) => x !== w.build) : [...cur, w.build])) : setSelected((cur) => (cur === w.pr || !w.pr ? null : w.pr)))}
        rowTone={(w) => stateTone(w.held ? 'held' : w.state)}
        empty={<p className="axp-gate__sub">{wt.data ? (filter ? 'Nothing matches the filter.' : 'Nothing waits to merge.') : 'Loading…'}</p>}
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
