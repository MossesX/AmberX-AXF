/**
 * Crew view: every agent working right now, one dense row each (framework DataGrid: sort, search, filter, collapsible
 * rows, phone first), live from the plugin's server-sent events. A row opens to what the agent is doing this second,
 * its steps, the files it changed with their live diff, its recent tool calls with their cost, links and Stop.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AgentAvatar, Button, Icon, IconButton, ModelBadge, PriorityTag, Segmented, TextField, setAgentDirectory, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import { followSse, sseJson } from '@console/axf/core/sse';
import { layoutViewports } from '@console/axf/core/engines/layout';
import type { LayoutData } from '@console/axf/core/types';
import * as consoleApi from '@console/api';
import { pluginFetch } from '@console/plugins';
import {
  KIND_TONE, STATUS_LABEL, STATUS_TONE, directoryOf, elapsed, filterRuns, highlight, isSnapshot, sortRuns, stepLine, tokensText, usd,
  type CrewAgent, type FileChange, type Hunk, type Run, type RunStatus, type Snapshot, type Sort,
} from './core';

export const FOLDER = 'crew-live';
export const VIEW = 'crew';
/** Window event the crew.agent action sends (agent id or run): the view opens that row. */
export const FOCUS_EVENT = 'axf-crew:focus';

let lastSnap: Snapshot | null = null;
const subs = new Set<(s: Snapshot) => void>();
let stopLive: (() => void) | null = null;
let liveState: 'connecting' | 'live' | 'down' = 'connecting';

export function publish(s: Snapshot) {
  lastSnap = s;
  setAgentDirectory('crew', directoryOf(s));
  for (const f of subs) f(s);
}

/** One live feed per console, however many Crew views, avatars or menus listen. */
export function useCrew(): { snap: Snapshot | null; live: typeof liveState } {
  const [snap, setSnap] = useState<Snapshot | null>(lastSnap);
  const [live, setLive] = useState(liveState);
  useEffect(() => {
    const on = (s: Snapshot) => { setSnap(s); setLive(liveState); };
    subs.add(on);
    if (!stopLive) {
      void pluginFetch(FOLDER, 'agents').then((r) => (r.ok ? r.json() : null)).then((j) => { if (isSnapshot(j)) publish(j); }).catch(() => undefined);
      stopLive = followSse((signal) => pluginFetch(FOLDER, 'live', { signal }), (f) => {
        const j = sseJson(f);
        if (f.event === 'crew' && isSnapshot(j)) { liveState = 'live'; publish(j); }
      }, { onOpen: () => { liveState = 'live'; setLive('live'); }, onDrop: () => { liveState = 'down'; setLive('down'); } });
    }
    return () => {
      subs.delete(on);
      if (!subs.size && stopLive) { stopLive(); stopLive = null; liveState = 'connecting'; }
    };
  }, []);
  return { snap, live };
}

/** A clock that ticks once a second while mounted (the live timers). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}

/** True while the window is as narrow as the layout asset's phone cut-off (data-fx-narrow): the grid drops to agent · time · cost. */
function useNarrow(): boolean {
  const rt = useRuntime();
  const max = layoutViewports(rt.asset('layout').data as LayoutData).find((v) => v.attr === 'data-fx-narrow')?.maxWidth ?? 0;
  const q = max ? `(max-width: ${max}px)` : '';
  return useSyncExternalStore(
    (cb) => { if (!q) return () => undefined; const m = matchMedia(q); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => (q ? matchMedia(q).matches : false), () => false,
  );
}
const NARROW_HIDDEN = ['status', 'model', 'tokens', 'pr'];

const toneClass = (t: string) => `axp-crew__dot is-${t}`;
function StatusDot({ s }: { s: RunStatus }) {
  return <span className={toneClass(STATUS_TONE[s])} role="img" aria-label={STATUS_LABEL[s]} title={STATUS_LABEL[s]} />;
}

function Who({ a, status, line }: { a: CrewAgent; status: RunStatus; line?: string }) {
  return (
    <span className="axp-crew__who">
      <AgentAvatar info={a.known ? { id: a.id, name: a.name, role: a.role, avatar: a.avatar } : null} agent={a.known ? a.id : a.name} />
      <span className="axp-crew__whoText">
        <span className="axp-crew__name"><StatusDot s={status} /> {a.name}</span>
        <span className="fx-small fx-muted axp-crew__role">{line ?? `${STATUS_LABEL[status]}${a.role ? ` · ${a.role}` : ''}`}</span>
      </span>
    </span>
  );
}

function Timer({ r, now }: { r: Run; now: number }) {
  const end = r.status === 'idle' && r.lastEventAt ? Date.parse(r.lastEventAt) : now;
  return (
    <span className="axp-crew__timer" title="Time on the job · time on this step">
      <span className="fx-mono">{elapsed(r.startedAt, end)}</span>
      {r.build?.stepStartedAt && r.status !== 'idle' ? <span className="fx-small fx-muted fx-mono">step {elapsed(r.build.stepStartedAt, end)}</span> : null}
    </span>
  );
}

function PrLink({ r }: { r: Run }) {
  const b = r.build;
  if (!b?.pr) return <span className="fx-muted">—</span>;
  return <a className="fx-link" href={b.prUrl || '#'} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>#{b.pr.replace(/^.*\//, '').replace(/^#/, '')}</a>;
}

// ---------------------------------------------------------------- expanded row

function DiffView({ run, path }: { run: Run; path: string }) {
  const [hunks, setHunks] = useState<Hunk[] | null | 'error' | 'binary'>(null);
  const [shut, setShut] = useState<Set<number>>(new Set());
  const stamp = run.lastEventAt;
  useEffect(() => {
    let alive = true;
    pluginFetch(FOLDER, `agents/${encodeURIComponent(run.id)}/diff?path=${encodeURIComponent(path)}`).then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { hunks?: Hunk[]; binary?: boolean }) => alive && setHunks(j.binary ? 'binary' : j.hunks ?? []), () => alive && setHunks('error'));
    return () => { alive = false; };
  }, [run.id, path, stamp]);
  if (hunks === null) return <p className="fx-small fx-muted">Reading the diff…</p>;
  if (hunks === 'error') return <p className="fx-small fx-muted">The diff can't be read (the worktree may be gone).</p>;
  if (hunks === 'binary') return <p className="fx-small fx-muted">A binary file (an image or archive): no text diff.</p>;
  if (!hunks.length) return <p className="fx-small fx-muted">No change against the base.</p>;
  return (
    <div className="axp-crew__diff" role="region" aria-label={`Diff of ${path}`}>
      {hunks.map((h, i) => (
        <div key={i} className="axp-crew__hunk">
          <button type="button" data-fx-row className="axp-crew__hunkHead fx-mono" aria-expanded={!shut.has(i)} onClick={() => setShut((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
            <Icon name={shut.has(i) ? 'chevron-right' : 'chevron-down'} size={12} /> {h.header.replace(/@@(.*)@@.*/, '@@$1@@')} <span className="fx-muted">{h.context}</span>
            <span className="axp-crew__plus">+{h.added}</span> <span className="axp-crew__minus">−{h.removed}</span>
          </button>
          {shut.has(i) ? null : (
            <pre className="axp-crew__code">
              {h.lines.map((l, j) => (
                <div key={j} className={`axp-crew__ln is-${l.t}`}>
                  <span className="axp-crew__no">{l.t === 'add' ? '' : l.o}</span><span className="axp-crew__no">{l.t === 'del' ? '' : l.n}</span>
                  <span className="axp-crew__sign">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ' '}</span>
                  <span className="axp-crew__src">{highlight(l.text).map((t, k) => <span key={k} className={`axp-crew__tok is-${t.k}`}>{t.v}</span>)}</span>
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function Files({ run }: { run: Run }) {
  const [files, setFiles] = useState<FileChange[] | null | 'error'>(null);
  const [open, setOpen] = useState<string>('');
  const last = useRef(0);
  const stamp = run.lastEventAt;
  useEffect(() => {
    // follows the run: re-read when it writes again, at most every 5 s
    const wait = Math.max(0, 5000 - (Date.now() - last.current));
    let alive = true;
    const t = setTimeout(() => {
      last.current = Date.now();
      pluginFetch(FOLDER, `agents/${encodeURIComponent(run.id)}/files`).then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: { files?: FileChange[] }) => alive && setFiles(j.files ?? []), () => alive && setFiles('error'));
    }, wait);
    return () => { alive = false; clearTimeout(t); };
  }, [run.id, stamp]);
  if (files === null) return <p className="fx-small fx-muted">Reading the worktree…</p>;
  if (files === 'error') return <p className="fx-small fx-muted">The worktree can't be read here.</p>;
  if (!files.length) return <p className="fx-small fx-muted">No files changed yet.</p>;
  return (
    <ul className="axp-crew__files">
      {files.map((f) => (
        <li key={f.path}>
          <button type="button" data-fx-row className="axp-crew__file" aria-expanded={open === f.path} onClick={() => setOpen(open === f.path ? '' : f.path)}>
            <Icon name={open === f.path ? 'chevron-down' : 'chevron-right'} size={12} />
            <span className={`axp-crew__kind is-${KIND_TONE[f.kind]}`}>{f.kind}</span>
            <span className="fx-mono axp-crew__path">{f.path}</span>
            {f.added !== undefined ? <span className="fx-small"><span className="axp-crew__plus">+{f.added}</span> <span className="axp-crew__minus">−{f.removed}</span></span> : null}
          </button>
          {open === f.path ? <DiffView run={run} path={f.path} /> : null}
        </li>
      ))}
    </ul>
  );
}

function Stop({ run }: { run: Run }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  if (run.status === 'idle') return null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await pluginFetch(FOLDER, `agents/${encodeURIComponent(run.id)}/stop`, { method: 'POST' });
      const j = await r.json().catch(() => ({})) as { detail?: string };
      rt.toast(r.ok ? `${run.agent.name} stopped (${run.name}).` : j.detail ?? 'Stop failed', r.ok ? 'success' : 'danger', 'Crew');
    } finally { setBusy(false); }
  };
  return <Button size="sm" tone="danger" icon="x" busy={busy} confirm={`Stop ${run.agent.name}? The run ${run.name} ends now; work already committed stays.`} onClick={() => void go()}>Stop</Button>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="axp-crew__sec"><h4 className="axp-crew__secTitle">{title}</h4>{children}</section>;
}

export function Detail({ r }: { r: Run }) {
  const rt = useRuntime();
  const has = (id: string) => !!rt.actions.get(id);
  return (
    <div className="axp-crew__detail">
      <p className="axp-crew__now"><Icon name={r.toolRunning ? 'clock' : 'play'} size={14} /> {r.now}</p>
      {r.lastText ? <p className="fx-small fx-muted axp-crew__said">“{r.lastText}”</p> : null}
      <div className="axp-crew__links">
        {has('terminal.attach') && r.status !== 'idle' ? <Button size="sm" icon="terminal" onClick={() => rt.actions.dispatch(`terminal.attach:${r.session}:${encodeURIComponent(r.agent.name)}`, { runtime: rt })}>Terminal tab</Button> : null}
        {has('session-history.open') && r.sessionId ? <Button size="sm" icon="list" onClick={() => rt.actions.dispatch(`session-history.open:${r.sessionId}`, { runtime: rt })}>Session browser</Button> : null}
        {has('agent-swarm.profile') && r.agent.known ? <Button size="sm" icon="user" onClick={() => rt.actions.dispatch(`agent-swarm.profile:${r.agent.id}`, { runtime: rt })}>Employee card</Button> : null}
        <Stop run={r} />
      </div>
      {r.build ? (
        <Section title={`Steps · ${r.build.title}`}>
          <ol className="axp-crew__steps">
            {r.build.steps.map((s) => (
              <li key={s.id} className={`axp-crew__step is-${s.state}`}>
                <span className="axp-crew__stepMark" aria-label={s.state}>{s.state === 'done' ? <Icon name="check" size={12} /> : s.state === 'now' ? <Icon name="play" size={12} /> : <Icon name="minus" size={12} />}</span>
                <span className="fx-grow">{s.id} {s.text}</span>
                {s.model ? <ModelBadge model={s.model} compact /> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
      <Section title="Files"><Files run={r} /></Section>
      <Section title="Recent commands">
        {r.tools.length ? (
          <ul className="axp-crew__tools" data-axf-not-toolbar="a list of the agent's recent tool calls">
            {r.tools.map((t) => (
              <li key={t.id} className={`axp-crew__tool is-${t.state}`}>
                <span className="axp-crew__toolName fx-mono">{t.tool}</span>
                <span className="fx-grow axp-crew__toolWhat" title={t.target}>{t.what}{t.target && t.tool === 'Bash' ? <span className="fx-mono fx-muted axp-crew__toolCmd">{t.target}</span> : null}</span>
                <span className="fx-mono fx-small">{usd(t.costUsd)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="fx-small fx-muted">No tool calls yet.</p>}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- the view

const STATUS_OPTS: { value: RunStatus | ''; label: string }[] = [{ value: '', label: 'All' }, { value: 'working', label: 'Working' }, { value: 'waiting', label: 'Waiting' }, { value: 'stuck', label: 'Stuck' }, { value: 'idle', label: 'Idle' }];

export function CrewView() {
  const rt = useRuntime();
  const { snap, live } = useCrew();
  const now = useNow();
  const narrow = useNarrow();
  const [q, setQ] = useState(() => consoleApi.readLocal('crew-q', ''));
  const [only, setOnly] = useState<RunStatus | ''>(() => consoleApi.readLocal('crew-status', ''));
  const [sort, setSort] = useState<GridSort>(() => consoleApi.readLocal('crew-sort', null));
  const [hidden, setHidden] = useState<string[]>(() => consoleApi.readLocal('crew-hidden', []));
  const [expanded, setExpanded] = useState<string[]>(() => consoleApi.readLocal('crew-expanded', []));
  const [groupsShut, setGroupsShut] = useState<string[]>(() => consoleApi.readLocal('crew-groups-shut', ['finished', 'off']));
  useEffect(() => { consoleApi.writeLocal('crew-q', q); consoleApi.writeLocal('crew-status', only); }, [q, only]);
  useEffect(() => { consoleApi.writeLocal('crew-sort', sort); consoleApi.writeLocal('crew-hidden', hidden); }, [sort, hidden]);
  useEffect(() => { consoleApi.writeLocal('crew-expanded', expanded); consoleApi.writeLocal('crew-groups-shut', groupsShut); }, [expanded, groupsShut]);
  // crew.agent:<agent id | run>: open that row
  useEffect(() => {
    const on = (e: Event) => {
      const want = String((e as CustomEvent).detail ?? '');
      const r = lastSnap?.runs.find((x) => x.id === want || x.name === want || (x.agent.id === want && x.status !== 'idle')) ?? lastSnap?.runs.find((x) => x.agent.id === want);
      if (r) { setExpanded((xs) => (xs.includes(r.id) ? xs : [...xs, r.id])); setOnly(''); setQ(''); }
      else rt.toast(`${want} isn't working on anything right now.`, 'info', 'Crew');
    };
    window.addEventListener(FOCUS_EVENT, on);
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, [rt]);

  const runs = useMemo(() => {
    const xs = filterRuns(snap?.runs ?? [], q, only);
    return sort ? sortRuns(xs, sort.col as Sort, sort.dir) : xs;
  }, [snap, q, only, sort]);
  const cols: GridColumn<Run>[] = [
    { id: 'agent', label: 'Agent', width: 'minmax(calc(var(--fx-space) * 18), 2fr)', fixed: true, sortable: true, sortValue: (r) => r.agent.name.toLowerCase(), render: (r) => <Who a={r.agent} status={r.status} line={narrow ? stepLine(r.build) : undefined} /> },
    { id: 'status', label: 'Doing', width: 'minmax(calc(var(--fx-space) * 24), 4fr)', sortable: true, render: (r) => (
      <span className="axp-crew__doing"><span className="axp-crew__step1">{stepLine(r.build)}</span><span className="fx-small fx-muted axp-crew__now1">{r.now}</span></span>
    ) },
    { id: 'priority', label: 'Priority', width: 'calc(var(--fx-space) * 14)', render: (r) => <PriorityTag build={r.build?.id} /> },
    { id: 'model', label: 'Model', width: 'calc(var(--fx-space) * 11)', render: (r) => <ModelBadge model={r.modelKey || r.model} compact /> },
    { id: 'started', label: 'Time', width: 'calc(var(--fx-space) * 18)', sortable: true, sortValue: (r) => r.startedAt ?? '', render: (r) => <Timer r={r} now={now} /> },
    { id: 'cost', label: 'Cost', width: 'calc(var(--fx-space) * 13)', align: 'end', sortable: true, sortValue: (r) => r.costUsd, render: (r) => <span className="fx-mono axp-crew__num" title={r.costExact ? 'Exact (from the run\'s result)' : 'Live, from the usage streamed so far'}>{usd(r.costUsd)}</span> },
    { id: 'tokens', label: 'Tokens', width: 'calc(var(--fx-space) * 11)', align: 'end', sortable: true, sortValue: (r) => r.tokensTotal, render: (r) => <span className="fx-mono axp-crew__num">{tokensText(r.tokensTotal)}</span> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-space) * 8)', render: (r) => <PrLink r={r} /> },
  ];
  const active = runs.filter((r) => r.status !== 'idle');
  const finished = runs.filter((r) => r.status === 'idle');
  const groups: GridGroup<Run>[] = [
    { id: 'working', title: 'On the clock', icon: 'play', rows: active, groups: [], collapsed: groupsShut.includes('working'), counts: <span className="fx-small fx-muted">{active.length}</span> },
    { id: 'finished', title: 'Finished in the last two hours', icon: 'check', rows: finished, groups: [], collapsed: groupsShut.includes('finished'), counts: <span className="fx-small fx-muted">{finished.length}</span> },
  ];
  const t = snap?.totals;
  const off = snap?.offTheClock ?? [];
  return (
    <div className="axp-crew">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Agents · live</p>
          <h1>Crew</h1>
          <p className="fx-muted">Every agent working right now: what it is on, how long, and what it costs.</p>
        </div>
      </header>
      <div className="axp-crew__bar" role="status" aria-live="polite">
        <span className="axp-crew__total"><b>{t?.working ?? 0}</b> working</span>
        <span className="axp-crew__total"><b className="fx-mono">{usd(t?.costRunningUsd)}</b> running now</span>
        <span className="axp-crew__total"><b className="fx-mono">{usd(t?.costTodayUsd)}</b> today</span>
        <span className={`axp-crew__live is-${live}`}><span className={toneClass(live === 'live' ? 'success' : live === 'down' ? 'danger' : 'muted')} /> {live === 'live' ? 'Live' : live === 'down' ? 'Reconnecting' : 'Connecting'}</span>
      </div>
      {snap?.source && !snap.source.headless ? <p className="fx-small fx-muted">The Terminal plugin is off: runs are read from their logs only and can't be stopped from here.</p> : null}
      <div className="axp-crew__tools-row">
        <TextField label="Search" value={q} onChange={setQ} placeholder="Agent, build, step, file…" className="axp-crew__search" />
        <Segmented size="sm" label="Status" value={only} onChange={setOnly} options={STATUS_OPTS} />
      </div>
      <DataGrid<Run>
        id="crew-runs" label="Agents at work" compact groups={groups} columns={narrow ? cols.filter((c) => !NARROW_HIDDEN.includes(c.id)) : cols}
        rowId={(r) => r.id} rowLabel={(r) => `${r.agent.name} ${r.name}`}
        hidden={hidden} onToggleColumn={(c, show) => setHidden((h) => (show ?? h.includes(c)) ? h.filter((x) => x !== c) : [...h, c])} onShowAll={() => setHidden([])}
        sort={sort} onSort={(col) => setSort((s) => (!col ? null : s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }))}
        expanded={expanded} onToggleExpand={(id) => setExpanded((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))}
        onRowClick={(r, e) => { if (!(e.target as HTMLElement).closest('a, button, input')) setExpanded((xs) => (xs.includes(r.id) ? xs.filter((x) => x !== r.id) : [...xs, r.id])); }}
        onToggleGroup={(id) => setGroupsShut((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))}
        renderDetail={(r) => <Detail r={r} />}
        rowTone={(r) => STATUS_TONE[r.status]}
        rowCtx={(r) => (r.agent.known ? { target: 'agent', payload: r.agent.id } : { target: 'crew-run', payload: r.id })}
        empty={<p className="fx-muted">{snap ? 'Nobody is working right now.' : 'Loading the crew…'}</p>}
      />
      <section className="axp-crew__off">
        <button type="button" data-fx-row className="axp-crew__offHead" aria-expanded={!groupsShut.includes('off')} onClick={() => setGroupsShut((xs) => (xs.includes('off') ? xs.filter((x) => x !== 'off') : [...xs, 'off']))}>
          <Icon name={groupsShut.includes('off') ? 'chevron-right' : 'chevron-down'} size={12} /> Off the clock <span className="fx-small fx-muted">{off.length}</span>
        </button>
        {groupsShut.includes('off') ? null : (
          <ul className="axp-crew__offList">
            {off.map((a) => (
              <li key={a.id} className="axp-crew__offItem">
                <AgentAvatar info={{ id: a.id, name: a.name, role: a.role, avatar: a.avatar }} size="small" label />
                <span className="fx-small fx-muted">{a.role}</span>
              </li>
            ))}
            {!off.length ? <li className="fx-small fx-muted">Everyone is working.</li> : null}
          </ul>
        )}
      </section>
      <IconButton icon="refresh" label="Refresh now" className="axp-crew__refresh" onClick={() => void pluginFetch(FOLDER, 'agents').then((r) => r.json()).then((j) => { if (isSnapshot(j)) publish(j); })} />
    </div>
  );
}
