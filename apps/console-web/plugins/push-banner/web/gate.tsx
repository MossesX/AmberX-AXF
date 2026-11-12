/**
 * Merge gate in the console (build auto-rebuild-failed-merges, Brett Nov 11 2026: "Yellow that it's being rebuilt,
 * green when it passes, red if it fails three times. And why."). Two parts:
 *   - MergeGateGroups: the push banner's gate groups (Auto-fixing / Rebuilding, Failed - needs you, Fixed and merged),
 *     one entry per build updated in place, the why on every state, an X per entry and Clear per group;
 *   - MergeLogPage (view `merge-log`): every entry ever, cleared or not, in the framework grid: sort, filter by state,
 *     search, column hide, expandable rows (each attempt with its why, timeline, who worked it, cost, tests), links to
 *     what's related and the row commands (buttons, right-click, multi-select).
 * Everything comes from GET /merge-log (land/merge-gate.mjs log --json, the same file the CLI and the host runner use);
 * commands are POST /merge-log/<cmd>. Colours are theme tones only.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Icon, IconButton, useRuntime } from '@console/axf/react';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { DataGrid, registerRowRefTarget, type GridColumn, type GridSort } from '@console/axf/libs/datagrid';
import { api } from './store';

export const LOG_VIEW = 'merge-log';
export const LOG_TARGET = 'axp-merge-log';
const POLL_MS = 60_000;
const REPO_URL = 'https://github.com/MossesX/AmberX-AXF';

export interface Attempt { n: number; kind: 'fix' | 'rebuild'; why: string; failedWhy?: string; result: 'running' | 'passed' | 'failed'; startedAt: string; endedAt: string; branch: string; changed: string; tests: string; trigger?: { kind: string; files: string[]; checks: string[]; errors: string[]; runUrl: string; behind: number }; job?: { build: string; branch: string; session: string; account: string; cost: number | null; mergedMain: boolean } }
export interface Entry { id: string; build: string; title: string; repo: string; branch: string; pr: number | null; state: string; attempts: Attempt[]; timeline: { at: string; text: string }[]; links?: { chain?: { build: string; branch: string; pr: number | null; supersededBy: string; at: string }[] }; banner?: { cleared: boolean }; archived: boolean; createdAt: string; updatedAt: string; outcome: string; autoMerge: boolean | null; agent: string; mergedSha?: string; capExtra?: number }
export interface BannerEntry { id: string; build: string; pr: number | null; branch: string; state: string; tone: string; label: string; title: string; why: string; lines: string[] }
export interface Row { id: string; build: string; title: string; state: string; label: string; tone: string; attempts: number; branch: string; pr: number | null; createdAt: string; updatedAt: string; outcome: string; why: string; cleared: boolean; archived: boolean; lastKind: string; agent: string }
export interface GateDoc { entries: Entry[]; rows: Row[]; groups: { id: string; title: string; clear: string; entries: BannerEntry[] }[]; settings: { on: boolean; cap: number; behindLimit: number }; at?: string }

// ------------------------------------------------------------------ the store (one poll for the banner and the page)

let doc: GateDoc | null = null; let err = ''; let archivedToo = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** The last merge log read (actions outside React use it). */
export const gateDoc = (): GateDoc | null => doc;
export async function loadGate(): Promise<void> {
  try { doc = await api.call<GateDoc>(`merge-log${archivedToo ? '?archived=true' : ''}`); err = ''; } catch (e) { err = (e as Error).message; }
  emit();
}
let timer: ReturnType<typeof setInterval> | null = null;
export function useGate(): { doc: GateDoc | null; error: string } {
  useEffect(() => { if (!timer) { void loadGate(); timer = setInterval(() => void loadGate(), POLL_MS); } }, []);
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => doc);
  return { doc, error: err };
}
export async function gateCommand(cmd: string, body: { ids?: (string | number)[]; group?: string }): Promise<string> {
  const r = await api.post<GateDoc & { note?: string }>(`merge-log/${cmd}`, body);
  doc = { ...(doc ?? r), ...r }; emit();
  if (archivedToo) void loadGate();
  return r.note ?? '';
}

const toneClass = (tone: string) => `is-${tone || 'muted'}`;
const fmt = (t?: string) => { const d = t ? new Date(t) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'; };
const prUrl = (n: number | null) => (n ? `${REPO_URL}/pull/${n}` : '');
const branchUrl = (b: string) => (b ? `${REPO_URL}/tree/${b.split('/').map(encodeURIComponent).join('/')}` : '');
const openUrl = (u: string) => { if (u) globalThis.open(u, '_blank', 'noopener'); };

/** The plain text Copy why puts on the clipboard. */
export function whyText(e: Entry): string {
  return [`${e.title || e.build} (${e.build}) - ${e.state}`, ...e.attempts.map((a) => `Attempt ${a.n} (${a.kind}): ${a.why}${a.failedWhy ? ` -> failed: ${a.failedWhy}` : a.result === 'passed' ? ' -> passed' : ''}${a.changed ? ` [${a.changed}]` : ''}`)].join('\n');
}

// ------------------------------------------------------------------ the banner groups

export function MergeGateGroups() {
  const rt = useRuntime();
  const { doc: d } = useGate();
  const [open, setOpen] = useState<string>('');
  const [note, setNote] = useState('');
  if (!d?.groups?.length) return null;
  const run = (cmd: string, body: { ids?: (string | number)[]; group?: string }) => { gateCommand(cmd, body).then(setNote, (e: Error) => setNote(e.message)); };
  return (
    <>
      {d.groups.map((g) => (
        <section key={g.id} className={`axp-push-banner__group axp-gate__group is-${g.id}`} aria-label={g.title}>
          <div className="axp-push-banner__group-head">
            <h4 className="axp-push-banner__group-title">{g.title} <span>{g.entries.length}</span></h4>
            <span className="axp-push-banner__group-act" role="toolbar" aria-label={`${g.title} actions`}>
              {g.clear && <Button size="sm" tone="neutral" icon="x" onClick={() => run('clear', { group: g.id })} title="Off the banner; still in the merge log">{g.clear}</Button>}
              <Button size="sm" tone="quiet" icon="list" onClick={() => rt.navigate(LOG_VIEW)}>View log</Button>
            </span>
          </div>
          <ul className="axp-push-banner__list">
            {g.entries.map((e) => (
              <li key={e.id} className={`axp-push-banner__item axp-gate__item ${toneClass(e.tone)}`} data-fx-ctx-target={LOG_TARGET} data-fx-ctx-payload={e.id}>
                <div className="axp-push-banner__entry">
                  <button type="button" data-fx-row className="axp-push-banner__expand" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? '' : e.id)}>
                    <span className={`axp-gate__pill ${toneClass(e.tone)}`}>{e.label}</span>
                    <span className="axp-push-banner__name is-title">{e.title}</span>
                    {e.pr ? <span className="axp-push-banner__meta">#{e.pr}</span> : null}
                    <Icon name={open === e.id ? 'chevron-up' : 'chevron-down'} size={14} />
                  </button>
                  <span className="axp-push-banner__sub axp-gate__why">{e.why}</span>
                  {open === e.id && (
                    <div className="axp-push-banner__detail">
                      <ul className="axp-gate__lines">{e.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                      <div className="axp-push-banner__acts" role="toolbar" aria-label="Entry actions">
                        <Button size="sm" tone="neutral" icon="layers" onClick={() => rt.dispatch(`build-orchestrator.open:${encodeURIComponent(e.build)}`)}>Open build</Button>
                        {e.state === 'failed' && <Button size="sm" tone="neutral" icon="refresh" onClick={() => run('retry', { ids: [e.id] })}>Retry now</Button>}
                        <Button size="sm" tone="quiet" icon="list" onClick={() => rt.navigate(LOG_VIEW)}>View log</Button>
                      </div>
                    </div>
                  )}
                </div>
                <IconButton icon="x" label={`Clear ${e.title} from the banner`} title="Clear (stays in the merge log)" onClick={() => run('clear', { ids: [e.id] })} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {note && <span className="axp-push-banner__note">{note}</span>}
    </>
  );
}

/** How many gate entries the banner shows (it stays up for them even with no branch waiting). */
export function useGateCount(): number {
  const { doc: d } = useGate();
  return (d?.groups ?? []).reduce((n, g) => n + g.entries.length, 0);
}

// ------------------------------------------------------------------ the merge log page

/** The selection the right-click menu acts on (multi-select aware): the clicked row, or every selected row with it. */
let selection: string[] = [];
export const selectionFor = (id: string) => (selection.includes(id) ? selection : [id]);
registerRowRefTarget(LOG_TARGET, (id) => { const e = doc?.entries.find((x) => x.id === id); return e ? { kind: 'orchestrator', id: e.build } : null; });

/** Row commands: label, icon, what they do. One list for the row buttons, the toolbar and the right-click menu. */
export const ROW_COMMANDS: { cmd: string; label: string; icon: string; server: boolean }[] = [
  { cmd: 'retry', label: 'Retry now', icon: 'refresh', server: true },
  { cmd: 'fix', label: 'Auto-fix now', icon: 'hammer', server: true },
  { cmd: 'rebuild', label: 'Full rebuild now', icon: 'layers', server: true },
  { cmd: 'merge', label: 'Merge', icon: 'branch', server: true },
  { cmd: 'skip', label: 'Skip', icon: 'arrow-right', server: true },
  { cmd: 'automerge', label: 'Toggle auto-merge', icon: 'sliders', server: true },
  { cmd: 'clear', label: 'Clear from banner', icon: 'x', server: true },
  { cmd: 'restore', label: 'Restore to banner', icon: 'undo', server: true },
  { cmd: 'archive', label: 'Archive', icon: 'box', server: true },
];
export const LOCAL_COMMANDS = [
  { id: 'open-build', label: 'Open build', icon: 'layers' }, { id: 'open-pr', label: 'Open PR', icon: 'github' },
  { id: 'view-log', label: 'View log', icon: 'list' }, { id: 'copy-why', label: 'Copy why', icon: 'copy' },
] as const;

export function runLocal(rt: ReturnType<typeof useRuntime>, id: string, e: Entry | undefined) {
  if (!e) return;
  if (id === 'open-build') rt.dispatch(`build-orchestrator.open:${encodeURIComponent(e.build)}`);
  else if (id === 'open-pr') openUrl(prUrl(e.pr));
  else if (id === 'view-log') { rt.navigate(LOG_VIEW); }
  else if (id === 'copy-why') void navigator.clipboard?.writeText(whyText(e)).then(() => rt.toast('Why copied', 'info', 'Merge log'));
}

const STATE_FILTERS = [
  { id: 'working', label: 'Working', states: ['fixing', 'rebuilding'] }, { id: 'failed', label: 'Failed', states: ['failed'] },
  { id: 'passed', label: 'Passed', states: ['passed'] }, { id: 'merged', label: 'Merged', states: ['merged'] }, { id: 'skipped', label: 'Skipped', states: ['skipped'] },
] as const;

export function MergeLogPage() {
  const { doc: d, error } = useGate();
  const [q, setQ] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [archived, setArchived] = useState(archivedToo);
  const [sort, setSort] = useState<GridSort>({ col: 'updated', dir: -1 });
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [multi, setMulti] = useState<string[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => { selection = multi; }, [multi]);
  useEffect(() => { archivedToo = archived; void loadGate(); }, [archived]);
  const byId = useMemo(() => new Map((d?.entries ?? []).map((e) => [e.id, e])), [d]);
  const rows = useMemo(() => {
    const want = STATE_FILTERS.filter((f) => states.includes(f.id)).flatMap((f): string[] => [...f.states]);
    const needle = q.trim().toLowerCase();
    return (d?.rows ?? []).filter((r) => (archived || !r.archived) && (!want.length || want.includes(r.state))
      && (!needle || `${r.build} ${r.title} ${r.branch} ${r.pr ?? ''} ${r.why} ${r.label}`.toLowerCase().includes(needle)));
  }, [d, q, states, archived]);
  const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const run = (cmd: string, ids: string[]) => { setNote(''); gateCommand(cmd, { ids }).then((n) => setNote(`${ROW_COMMANDS.find((c) => c.cmd === cmd)?.label}: ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}. ${n}`), (e: Error) => setNote(e.message)); };

  const cols: GridColumn<Row>[] = [
    { id: 'build', label: 'Build', width: 'minmax(calc(var(--fx-font-size) * 14), calc(var(--fx-font-size) * 20))', fixed: true, sortable: true, sortValue: (r) => r.title,
      render: (r) => <span className="axp-gate__build"><span className="axp-gate__title">{r.title}</span><span className="fx-small fx-muted fx-mono">{r.build}</span></span> },
    { id: 'state', label: 'State', width: 'calc(var(--fx-font-size) * 13)', sortable: true, sortValue: (r) => r.state, render: (r) => <span className={`axp-gate__pill ${toneClass(r.tone)}`}>{r.label}</span> },
    { id: 'attempts', label: 'Attempts', width: 'calc(var(--fx-font-size) * 4.5)', align: 'end', sortable: true, sortValue: (r) => r.attempts, render: (r) => <span className="fx-small">{r.attempts}</span> },
    { id: 'branch', label: 'Branch', width: 'calc(var(--fx-font-size) * 14)', sortable: true, sortValue: (r) => r.branch, render: (r) => <span className="fx-small fx-mono axp-gate__clip">{r.branch}</span> },
    { id: 'pr', label: 'PR', width: 'calc(var(--fx-font-size) * 4)', align: 'end', sortable: true, sortValue: (r) => r.pr ?? 0, render: (r) => (r.pr ? <span className="fx-small">#{r.pr}</span> : <span className="fx-muted">—</span>) },
    { id: 'created', label: 'Started', width: 'calc(var(--fx-font-size) * 7)', align: 'end', sortable: true, sortValue: (r) => r.createdAt, render: (r) => <span className="fx-small">{fmt(r.createdAt)}</span> },
    { id: 'updated', label: 'Updated', width: 'calc(var(--fx-font-size) * 7)', align: 'end', sortable: true, sortValue: (r) => r.updatedAt, render: (r) => <span className="fx-small">{fmt(r.updatedAt)}</span> },
    { id: 'outcome', label: 'Outcome', width: 'calc(var(--fx-font-size) * 5.5)', sortable: true, sortValue: (r) => r.outcome, render: (r) => <span className="fx-small">{r.outcome || (r.cleared ? 'cleared' : '—')}</span> },
    { id: 'why', label: 'Why', width: 'calc(var(--fx-font-size) * 24)', render: (r) => <span className="fx-small fx-muted axp-gate__clip" title={r.why}>{r.why}</span> },
  ];
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.id === sort.col); if (!c?.sortValue) return rows;
    return [...rows].sort((a, b) => { const x = c.sortValue!(a); const y = c.sortValue!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <header className="fx-pagehead">
      <div>
        <p className="fx-eyebrow">Builds · merge gate{d ? ` · ${d.settings.on ? `on, ${d.settings.cap} attempts` : 'off'}` : ''}</p>
        <h1>Merge log</h1>
        <p className="fx-muted">Every build that couldn't merge: auto-fixed, rebuilt on fresh main, passed, merged or held, with why.</p>
      </div>
    </header>
  );
  if (!d && !error) return <div className="fx-stack axp-gate">{head}<LoadingSkeleton rows={6} label="Loading the merge log" /></div>;
  if (!d) return <div className="fx-stack axp-gate">{head}<EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => void loadGate() }}>{error}</EmptyState></div>;
  const sel = multi.length ? multi : [];
  return (
    <div className="fx-stack axp-gate">
      {head}
      <div className="axp-gate__bar" role="toolbar" aria-label="Filter the merge log">
        <label className="fx-search axp-gate__search">
          <Icon name="search" size={13} />
          <input type="search" placeholder="Search build, branch, PR, why…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the merge log" />
        </label>
        {STATE_FILTERS.map((f) => <Button key={f.id} size="sm" tone={states.includes(f.id) ? 'primary' : 'quiet'} aria-pressed={states.includes(f.id)} onClick={() => setStates(toggle(states, f.id))}>{f.label}</Button>)}
        <Button size="sm" tone={archived ? 'primary' : 'quiet'} icon="box" aria-pressed={archived} onClick={() => setArchived(!archived)}>Archived</Button>
        <Button size="sm" tone="quiet" icon={open.length ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen(open.length ? [] : sorted.map((r) => r.id))}>{open.length ? 'Collapse all' : 'Expand all'}</Button>
      </div>
      {sel.length > 0 && (
        <div className="axp-gate__bar" role="toolbar" aria-label="Commands for the selected entries">
          <span className="fx-small">{sel.length} selected</span>
          {ROW_COMMANDS.map((c) => <Button key={c.cmd} size="sm" tone="neutral" icon={c.icon} onClick={() => run(c.cmd, sel)}>{c.label}</Button>)}
          <Button size="sm" tone="quiet" icon="x" onClick={() => setMulti([])}>Clear selection</Button>
        </div>
      )}
      {note && <p className="fx-small axp-gate__note">{note}</p>}
      <span className="fx-small fx-muted">Tap a row for everything about it · Ctrl/⌘-click to select several · right-click for commands · right-click a column to hide it</span>
      <div className="axp-gate__grid">
      <DataGrid<Row> id="merge-log" label="Merge log" groups={[{ id: 'all', title: 'Entries', rows: sorted, groups: [], fixed: true }]} columns={cols}
        rowId={(r) => r.id} rowLabel={(r) => r.title} rowTone={(r) => r.tone}
        hidden={hidden} onToggleColumn={(c, show) => setHidden((h) => (show === true ? h.filter((x) => x !== c) : show === false ? [...h, c] : toggle(h, c)))} onShowAll={() => setHidden([])}
        sort={sort} onSort={(c) => setSort((s) => (!c ? null : s?.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: 1 }))}
        expanded={open} onToggleExpand={(id) => setOpen((o) => toggle(o, id))}
        multi={multi} onRowClick={(r, e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) setMulti((m) => toggle(m, r.id)); else setOpen((o) => toggle(o, r.id)); }}
        rowCtx={(r) => ({ target: LOG_TARGET, payload: r.id })} rowRef={(r) => ({ kind: 'orchestrator', id: r.build })}
        empty={<EmptyState icon="check" compact>{q || states.length ? 'No entries match.' : 'Nothing has failed to merge. The gate logs every build it fixes or rebuilds here.'}</EmptyState>}
        renderDetail={(r) => <EntryDetail e={byId.get(r.id)} run={run} />} />
      </div>
    </div>
  );
}

function EntryDetail({ e, run }: { e: Entry | undefined; run: (cmd: string, ids: string[]) => void }) {
  const rt = useRuntime();
  if (!e) return null;
  const chain = e.links?.chain ?? [];
  const builds = [...new Set([...chain.map((c) => c.build), ...chain.map((c) => c.supersededBy), ...e.attempts.map((a) => a.job?.build ?? '')].filter(Boolean))];
  const go = (action: string) => rt.dispatch(action);
  return (
    <div className="axp-gate__detail">
      <div className="axp-gate__acts" role="toolbar" aria-label="Commands">
        {ROW_COMMANDS.map((c) => <Button key={c.cmd} size="sm" tone="neutral" icon={c.icon} onClick={() => run(c.cmd, [e.id])}>{c.cmd === 'automerge' ? `Auto-merge ${e.autoMerge === false ? 'off' : 'on'}` : c.label}</Button>)}
        {LOCAL_COMMANDS.map((c) => <Button key={c.id} size="sm" tone="quiet" icon={c.icon} disabled={c.id === 'open-pr' && !e.pr} onClick={() => runLocal(rt, c.id, e)}>{c.label}</Button>)}
      </div>
      <section className="axp-gate__sec" aria-label="Attempts">
        <h5>Attempts</h5>
        <ol className="axp-gate__attempts">
          {e.attempts.map((a) => (
            <li key={a.n} className={`axp-gate__attempt is-${a.result}`}>
              <div className="axp-gate__line"><b>{a.n}. {a.kind === 'rebuild' ? 'Full rebuild' : 'Auto-fix'}</b> <span className="fx-small fx-muted">{fmt(a.startedAt)}{a.endedAt ? ` → ${fmt(a.endedAt)}` : ''} · {a.result}</span></div>
              <div>Why: {a.why}</div>
              {a.trigger?.files?.length ? <div className="fx-small">Conflicting files: <span className="fx-mono">{a.trigger.files.join(', ')}</span></div> : null}
              {a.trigger?.checks?.length ? <div className="fx-small">Failing checks: {a.trigger.checks.join(', ')}{a.trigger.runUrl ? <> · <a href={a.trigger.runUrl} target="_blank" rel="noreferrer">run</a></> : null}</div> : null}
              {a.trigger?.errors?.length ? <pre className="axp-gate__pre">{a.trigger.errors.join('\n')}</pre> : null}
              {a.changed ? <div className="fx-small">What it did: {a.changed}</div> : null}
              {a.failedWhy ? <div className="fx-small axp-gate__bad">Failed: {a.failedWhy}</div> : null}
              <div className="fx-small fx-muted">{[a.job?.build ? `${a.kind === 'rebuild' ? 'Rebuild' : 'Fix'} build ${a.job.build}` : 'no session (main merged in only)', a.job?.account ? `Claude account ${a.job.account}` : '', typeof a.job?.cost === 'number' ? `$${a.job.cost.toFixed(2)}` : '', a.tests ? `tests: ${a.tests}` : ''].filter(Boolean).join(' · ')}</div>
            </li>
          ))}
        </ol>
      </section>
      <section className="axp-gate__sec" aria-label="Related">
        <h5>Related</h5>
        <div className="axp-gate__links">
          <Button size="sm" tone="quiet" icon="layers" onClick={() => go(`build-orchestrator.open:${encodeURIComponent(e.build)}`)}>Build {e.build}</Button>
          {builds.filter((b) => b !== e.build).map((b) => <Button key={b} size="sm" tone="quiet" icon="layers" onClick={() => go(`build-orchestrator.open:${encodeURIComponent(b)}`)}>{chain.some((c) => c.build === b) ? 'Superseded' : 'Build'} {b}</Button>)}
          {e.branch && <Button size="sm" tone="quiet" icon="branch" onClick={() => openUrl(branchUrl(e.branch))}>{e.branch}</Button>}
          {chain.filter((c) => c.pr).map((c) => <Button key={`pr${c.pr}`} size="sm" tone="quiet" icon="github" onClick={() => openUrl(prUrl(c.pr))}>Old PR #{c.pr}</Button>)}
          {e.pr ? <Button size="sm" tone="quiet" icon="github" onClick={() => openUrl(prUrl(e.pr))}>PR #{e.pr}</Button> : null}
          <Button size="sm" tone="quiet" icon="file" onClick={() => go(`md-studio.open:_claude/builds/reports/${e.build}.md`)}>Build report</Button>
          <Button size="sm" tone="quiet" icon="terminal" onClick={() => go(`build-orchestrator.open:${encodeURIComponent(e.attempts.at(-1)?.job?.build || e.build)}`)}>Session log</Button>
          <Button size="sm" tone="quiet" icon="layout" onClick={() => go('plan-studio.open')}>Plan Studio</Button>
          <Button size="sm" tone="quiet" icon="user" onClick={() => go('agent-swarm.open')}>Group chat</Button>
          <Button size="sm" tone="quiet" icon="eye" onClick={() => go('ui-review.open')}>UI Review</Button>
        </div>
      </section>
      <section className="axp-gate__sec" aria-label="Timeline">
        <h5>Timeline</h5>
        <ul className="axp-gate__timeline">{[...e.timeline].reverse().map((t, i) => <li key={i}><span className="fx-small fx-muted">{fmt(t.at)}</span> {t.text}</li>)}</ul>
      </section>
    </div>
  );
}
