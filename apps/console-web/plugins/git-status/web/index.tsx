/**
 * Git status console plugin (ai.amberx.axf.console.git-status).
 *
 * Where everything stands in git, as framework grids with expandable rows: Needs push, Needs pull, In CI, Ready to
 * merge, Held, Merged today, Deployed, Stale, and push Batches with a PR sub-grid each. Every row leads with the PR
 * number and a plain-English line of what it does; a row expands to what blocks it (and what clears that), its checks
 * with the failing lines, commits, files and diffs, its build and steps and its UI Review item, with the actions. Live:
 * the page asks the server every LIVE_MS while it is visible and the server answers "same" until something changes.
 * Every action is a plugin command too (REST + MCP + CLI). Zero tokens.
 */
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, IconButton, Note, Segmented, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { DataGrid, registerRowHook, type GridColumn } from '@console/axf/libs/datagrid';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { actionsFor, aheadBehind, ageText, chipTone, ciLook, filterRows, matchesFocus, money, reposOf, type BatchView, type Board, type Row, type SectionId, type Sort } from './core';
import { appMenu } from './menu';
import './git-status.css';

const FOLDER = 'git-status';
const ID = 'ai.amberx.axf.console.git-status';
const VIEW = 'git-status';
const LIVE_MS = 20_000;
const api = pluginApi(FOLDER, 'Git status');

/* ---------------- the board store: one copy for the page, the context menu and the row hooks ---------------- */

interface State { board: Board | null; error: string; loading: boolean; focus: string; tab: SectionId | 'batches' }
let st: State = { board: null, error: '', loading: false, focus: '', tab: 'ready' };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useStore = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

let inflight = false;
export async function load(force = false): Promise<void> {
  if (inflight && !force) return;
  inflight = true;
  set({ loading: true });
  try {
    const since = !force && st.board ? `since=${encodeURIComponent(st.board.stamp)}` : '';
    const j = await api.call<Board & { same?: boolean }>(`board?${since}${force ? 'refresh=true' : ''}`);
    if (!j.same) set({ board: j, error: '' });
  } catch (e) { set({ error: (e as Error).message }); }
  finally { inflight = false; set({ loading: false }); }
}

function useLive() {
  useEffect(() => {
    void load();
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const t = window.setInterval(tick, LIVE_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, []);
}

async function act(rt: ReturnType<typeof useRuntime>, path: string, body: Record<string, unknown>, done: string): Promise<void> {
  try {
    const j = await api.post<Record<string, unknown>>(path, body);
    const text = typeof j.text === 'string' ? j.text : typeof j.error === 'string' ? j.error : done;
    rt.toast(text, 'success');
  } catch (e) { rt.toast((e as Error).message, 'danger'); }
  void load(true);
}

/* ---------------- small parts ---------------- */

function CiDot({ ci }: { ci: string }) {
  const l = ciLook(ci);
  return <span className={`axp-git-status__dot axp-git-status__dot--${l.tone}`} title={l.label} aria-label={l.label} role="img" />;
}

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="axp-git-status__line"><span className="fx-small fx-muted axp-git-status__k">{k}</span><div className="fx-grow axp-git-status__v">{children}</div></div>;
}

function Lead({ r }: { r: Row }) {
  return (
    <span className="axp-git-status__lead">
      <strong title={r.lead}>{r.lead}</strong>
      <span className="fx-small fx-muted axp-git-status__meta">{[r.branch, r.agent, aheadBehind(r), ageText(r.at), money(r.cost)].filter(Boolean).join(' · ')}</span>
    </span>
  );
}

interface Detail { row: Row; commits: { sha: string; subject: string; author?: string; date?: string; url?: string }[]; checks: { name: string; status?: string; conclusion?: string; url?: string; lines?: string[] }[]; body?: string; files?: number | null; error?: string }
interface FileDiff { file: string; status: string; additions: number; deletions: number; patch: string }

function Files({ r }: { r: Row }) {
  const [files, setFiles] = useState<FileDiff[] | null | 'error'>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.call<{ files: FileDiff[] }>(`files?repo=${encodeURIComponent(r.repo)}&number=${r.number}`).then((j) => live && setFiles(j.files), () => live && setFiles('error'));
    return () => { live = false; };
  }, [r.repo, r.number]);
  if (files === null) return <span className="fx-small fx-muted">Loading files…</span>;
  if (files === 'error') return <span className="fx-small fx-muted">Files unavailable.</span>;
  return (
    <ul className="axp-git-status__files">
      {files.map((f) => (
        <li key={f.file}>
          <button type="button" data-fx-row className="axp-git-status__file" onClick={() => setOpen(open === f.file ? null : f.file)} aria-expanded={open === f.file}>
            <Icon name={open === f.file ? 'chevron-down' : 'chevron-right'} size={12} />
            <span className="fx-mono fx-small fx-grow">{f.file}</span>
            <span className="fx-small axp-git-status__add">+{f.additions}</span><span className="fx-small axp-git-status__del">−{f.deletions}</span>
          </button>
          {open === f.file ? <pre className="axp-git-status__diff">{f.patch ? f.patch.split('\n').map((ln, i) => <span key={i} className={ln.startsWith('+') ? 'is-add' : ln.startsWith('-') ? 'is-del' : ln.startsWith('@@') ? 'is-hunk' : ''}>{ln}{'\n'}</span>) : 'No text diff (binary or too large).'}</pre> : null}
        </li>
      ))}
    </ul>
  );
}

function Actions({ r }: { r: Row }) {
  const rt = useRuntime();
  const { board } = useStore();
  const [busy, setBusy] = useState('');
  const run = (id: string, path: string, body: Record<string, unknown>, done: string) => { setBusy(id); void act(rt, path, body, done).finally(() => setBusy('')); };
  const a = actionsFor(r);
  const key = { key: r.key };
  return (
    <div className="axp-git-status__actions" role="toolbar" aria-label="Actions">
      {a.includes('merge') ? <Button size="sm" tone="primary" icon="git-merge" busy={busy === 'merge'} onClick={() => run('merge', 'merge', key, `Merged #${r.number}`)}>Merge</Button> : null}
      {a.includes('hold') ? <Button size="sm" icon="pause" busy={busy === 'hold'} onClick={() => run('hold', 'hold', key, r.hold ? 'Released' : 'On hold')}>{r.hold ? 'Release hold' : 'Hold'}</Button> : null}
      {a.includes('update') ? <Button size="sm" icon="download" busy={busy === 'update'} onClick={() => run('update', 'update', key, 'Pulling main in')}>Update from main</Button> : null}
      {a.includes('rerun') ? <Button size="sm" icon="refresh" busy={busy === 'rerun'} onClick={() => run('rerun', 'rerun', key, 'Re-running CI')}>Re-run CI</Button> : null}
      {a.includes('fix') ? <Button size="sm" icon="wrench" busy={busy === 'fix'} onClick={() => run('fix', 'fix', key, 'Sent to Merge Max')}>Fix</Button> : null}
      {a.includes('land') ? <Button size="sm" icon="send" busy={busy === 'land'} onClick={() => run('land', 'land', key, 'Sent to Landin’ Lenny')}>Land</Button> : null}
      {a.includes('batch') && board?.batches.length ? (
        <select className="fx-input axp-git-status__batchpick" aria-label="Add to batch" value={r.batch} onChange={(e) => e.target.value && run('batch', 'batches/add', { id: e.target.value, key: r.key }, 'Added to batch')}>
          <option value="">Add to batch…</option>
          {board.batches.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
      ) : a.includes('batch') ? <Button size="sm" icon="layers" busy={busy === 'batch'} onClick={() => run('batch', 'batches', { title: '', items: [r.key] }, 'New batch made')}>New batch</Button> : null}
      {a.includes('close') ? <Button size="sm" tone="danger" icon="x" confirm={`Close PR #${r.number} without merging?`} busy={busy === 'close'} onClick={() => run('close', 'close', key, `Closed #${r.number}`)}>Close</Button> : null}
      {a.includes('kill') ? <Button size="sm" tone="danger" icon="trash" confirm={`Delete branch ${r.branch} on GitHub?`} busy={busy === 'kill'} onClick={() => run('kill', 'kill', key, `Deleted ${r.branch}`)}>Kill</Button> : null}
      {a.includes('github') ? <a className="fx-btn fx-btn--sm" href={r.url} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> GitHub</a> : null}
    </div>
  );
}

function RowDetail({ r }: { r: Row }) {
  const rt = useRuntime();
  const [d, setD] = useState<Detail | null | 'error'>(null);
  const [files, setFiles] = useState(false);
  useEffect(() => {
    let live = true;
    if (r.kind === 'deploy' || r.kind === 'merged') { setD({ row: r, commits: [], checks: [] }); return; }
    api.call<Detail>(`item?key=${encodeURIComponent(r.key)}`).then((j) => live && setD(j), () => live && setD('error'));
    return () => { live = false; };
  }, [r.key, r.sha]);
  const red = d && d !== 'error' ? d.checks.filter((c) => ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(c.conclusion ?? '')) : [];
  const running = d && d !== 'error' ? d.checks.filter((c) => c.status && c.status !== 'completed') : [];
  return (
    <div className="fx-stack axp-git-status__detail">
      {r.detailLine ? <p className="fx-small fx-muted">{r.detailLine}</p> : null}
      {r.blockers.length ? (
        <Line k="Blocking">
          <ul className="axp-git-status__list">{r.blockers.map((b, i) => <li key={i}><strong>{b.why}</strong><span className="fx-muted"> → {b.clears}</span></li>)}</ul>
        </Line>
      ) : null}
      <Actions r={r} />
      {d === null ? <p className="fx-small fx-muted">Loading details…</p> : d === 'error' ? <p className="fx-small fx-muted">Details unavailable right now.</p> : (
        <>
          {d.error ? <Note tone="warning">{d.error}</Note> : null}
          {d.checks.length ? (
            <Line k="Checks">
              <span className="fx-small">{d.checks.length - red.length - running.length} passed{red.length ? ` · ${red.length} failed` : ''}{running.length ? ` · ${running.length} running` : ''}</span>
              <ul className="axp-git-status__list">
                {[...red, ...running].map((c, i) => (
                  <li key={i}>
                    <CiDot ci={red.includes(c) ? 'failure' : 'running'} /> {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
                    {c.lines?.length ? <pre className="axp-git-status__errs">{c.lines.join('\n')}</pre> : null}
                  </li>
                ))}
              </ul>
            </Line>
          ) : null}
          {d.commits.length ? (
            <Line k="Commits">
              <ul className="axp-git-status__list">{d.commits.slice(0, 12).map((c) => <li key={c.sha}><span className="fx-mono fx-small">{c.sha.slice(0, 8)}</span> {c.subject}{c.author ? <span className="fx-muted fx-small"> · {c.author}</span> : null}</li>)}</ul>
            </Line>
          ) : null}
          {r.kind === 'pr' ? (
            <Line k="Files">{files ? <Files r={r} /> : <Button size="sm" icon="file" onClick={() => setFiles(true)}>{typeof d.files === 'number' ? `${d.files} files changed: show` : 'Show files'}</Button>}</Line>
          ) : null}
          {d.body ? <Line k="PR text"><p className="fx-small axp-git-status__body">{d.body}</p></Line> : null}
        </>
      )}
      {r.build ? (
        <Line k="Build">
          <span className="fx-small"><strong>{r.build.title}</strong> · {r.build.status} · {r.build.done}/{r.build.total} steps</span>
          <ul className="axp-git-status__list">{r.build.steps.map((s) => <li key={s.id} className="fx-small">{s.done ? '✓' : '○'} {s.text} <span className="fx-muted">{s.model}</span></li>)}</ul>
        </Line>
      ) : null}
      {r.ui ? (
        <Line k="UI Review">
          <span className="fx-small"><Chip tone={r.ui.holds ? 'warning' : 'success'}>{r.ui.state}</Chip> {r.ui.items.map((i) => i.title || i.id).join(', ')}</span>{' '}
          <Button size="sm" icon="image" onClick={() => rt.navigate('ui-review')}>Open UI Review</Button>
        </Line>
      ) : null}
      {r.batch ? <Line k="Batch"><span className="fx-small">{st.board?.batches.find((b) => b.id === r.batch)?.title ?? r.batch}</span></Line> : null}
      {r.dependsOn.length ? <Line k="Depends on"><span className="fx-small">{r.dependsOn.map((n) => `#${n}`).join(', ')}</span></Line> : null}
      {r.path ? <Line k="Folder"><span className="fx-mono fx-small">{r.path}</span></Line> : null}
      {r.image ? <Line k="Image"><span className="fx-mono fx-small">{r.image}</span></Line> : null}
    </div>
  );
}

/* ---------------- the grids ---------------- */

const columns: GridColumn<Row>[] = [
  { id: 'lead', label: 'What', width: 'minmax(calc(var(--fx-space) * 30), 4fr)', fixed: true, sortable: true, sortValue: (r) => r.lead, render: (r) => <Lead r={r} /> },
  { id: 'status', label: 'Status', width: 'calc(var(--fx-space) * 14)', sortable: true, sortValue: (r) => r.status, render: (r) => <Chip tone={chipTone(r.tone)}>{r.status}</Chip> },
  { id: 'ci', label: 'CI', width: 'calc(var(--fx-space) * 5)', sortable: true, sortValue: (r) => r.ci, render: (r) => (r.ci ? <CiDot ci={r.ci} /> : null) },
  { id: 'branch', label: 'Branch', width: 'minmax(calc(var(--fx-space) * 16), 2fr)', sortable: true, sortValue: (r) => r.branch, render: (r) => <span className="fx-mono fx-small axp-git-status__clip" title={r.branch}>{r.branch}</span> },
  { id: 'agent', label: 'Agent', width: 'calc(var(--fx-space) * 14)', sortable: true, sortValue: (r) => r.agent, render: (r) => (r.agent ? <span className="fx-small axp-git-status__agent"><Icon name="user" size={12} />{r.agent}</span> : null) },
  { id: 'ab', label: '↑↓', width: 'calc(var(--fx-space) * 12)', sortable: true, sortValue: (r) => r.behind ?? -1, render: (r) => <span className="fx-small fx-mono axp-git-status__nowrap">{aheadBehind(r)}</span> },
  { id: 'age', label: 'Age', width: 'calc(var(--fx-space) * 5)', sortable: true, align: 'end', sortValue: (r) => -(Date.parse(r.at) || 0), render: (r) => <span className="fx-small">{ageText(r.at)}</span> },
  { id: 'cost', label: 'Cost', width: 'calc(var(--fx-space) * 7)', sortable: true, align: 'end', sortValue: (r) => r.cost ?? -1, render: (r) => <span className="fx-small">{money(r.cost)}</span> },
];

function Grid({ id, title, icon, rows, expanded, onToggle }: { id: string; title: string; icon: string; rows: Row[]; expanded: string[]; onToggle: (k: string) => void }) {
  const [hidden, setHidden] = useState<string[]>([]);
  return (
    <DataGrid<Row> id={id} label={title} compact
      groups={[{ id: 'all', title: `${title} (${rows.length})`, icon, rows, groups: [], fixed: true }]}
      columns={columns} rowId={(r) => r.key} rowLabel={(r) => r.lead} rowTone={(r) => r.tone}
      hidden={hidden} onToggleColumn={(c, show) => setHidden(show === true || (show === undefined && hidden.includes(c)) ? hidden.filter((x) => x !== c) : [...hidden, c])} onShowAll={() => setHidden([])}
      expanded={expanded} onToggleExpand={onToggle} renderDetail={(r) => <RowDetail r={r} />} onRowClick={(r) => onToggle(r.key)}
      rowCtx={(r) => ({ target: 'axf-git-status-row', payload: r.key })}
      rowRef={(r) => (r.build ? { kind: 'orchestrator', id: r.build.id } : null)}
      empty="Nothing here right now." />
  );
}

function Batches({ batches, expanded, onToggle }: { batches: BatchView[]; expanded: string[]; onToggle: (k: string) => void }) {
  const rt = useRuntime();
  const { board } = useStore();
  const ready = (board?.rows ?? []).filter((r) => r.kind === 'pr' && r.sections.includes('ready') && !r.batch).map((r) => r.key);
  const move = (b: BatchView, k: string, dir: -1 | 1) => {
    const items = b.items.map((x) => x.key); const i = items.indexOf(k); const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    items.splice(j, 0, ...items.splice(i, 1));
    void act(rt, 'batches/order', { id: b.id, items }, 'Order saved');
  };
  return (
    <div className="fx-stack">
      <div className="axp-git-status__bar">
        <Button size="sm" icon="layers" disabled={!ready.length} onClick={() => void act(rt, 'batches', { title: '', items: ready }, 'Batch made from every ready PR')}>New batch from ready ({ready.length})</Button>
      </div>
      {!batches.length ? <p className="fx-empty">No push batches yet. Make one from the ready PRs, or with “New batch” on a PR row.</p> : null}
      {batches.map((b) => (
        <section key={b.id} className="fx-stack axp-git-status__batch" data-fx-ctx-target="axf-git-status-batch" data-fx-ctx-payload={b.id}>
          <header className="axp-git-status__batchhead">
            <strong className="fx-grow">{b.title}</strong>
            <span className="axp-git-status__badges">
              {b.badges.ready ? <Chip tone="success">{b.badges.ready} ready</Chip> : null}
              {b.badges.ci ? <Chip tone="accent">{b.badges.ci} in CI</Chip> : null}
              {b.badges.failed ? <Chip tone="danger">{b.badges.failed} red</Chip> : null}
              {b.badges.held ? <Chip tone="warning">{b.badges.held} held</Chip> : null}
              {b.badges.gone ? <Chip>{b.badges.gone} merged / gone</Chip> : null}
            </span>
            <Button size="sm" tone="primary" icon="git-merge" disabled={b.state !== 'ready'} onClick={() => void act(rt, 'batches/merge-next', { id: b.id }, 'Done')}>Merge next</Button>
            <IconButton icon="trash" label="Remove batch" onClick={() => void act(rt, 'batches/remove', { id: b.id }, 'Batch removed')} />
          </header>
          <ol className="axp-git-status__order">
            {b.items.map((r, i) => (
              <li key={r.key} className="axp-git-status__orderrow">
                <span className="fx-small fx-muted">{i + 1}.</span>
                <span className="fx-grow"><button type="button" data-fx-row className="axp-git-status__linkbtn" onClick={() => onToggle(r.key)}>{r.lead}</button></span>
                <Chip tone={chipTone(r.tone)}>{r.status}</Chip>
                {r.ci ? <CiDot ci={r.ci} /> : null}
                <IconButton icon="chevron-up" label="Earlier" disabled={i === 0} onClick={() => move(b, r.key, -1)} />
                <IconButton icon="chevron-down" label="Later" disabled={i === b.items.length - 1} onClick={() => move(b, r.key, 1)} />
                <IconButton icon="x" label="Take out of batch" onClick={() => void act(rt, 'batches/take-out', { id: b.id, key: r.key }, 'Taken out')} />
              </li>
            ))}
          </ol>
          <Grid id={`git-status-batch-${b.id}`} title="PRs in this batch" icon="git-pull-request" rows={b.items.filter((r) => r.kind !== 'gone')} expanded={expanded} onToggle={onToggle} />
        </section>
      ))}
    </div>
  );
}

function GitStatusView() {
  useLive();
  const s = useStore();
  const [q, setQ] = useState('');
  const [repo, setRepo] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [expanded, setExpanded] = useState<string[]>([]);
  const b = s.board;
  useEffect(() => { // "Show in Git status": jump to the tab holding the row and open it
    if (!s.focus || !b) return;
    const hit = b.rows.find((r) => matchesFocus(r, s.focus));
    if (hit) { set({ tab: hit.sections[0] ?? 'ready', focus: '' }); setExpanded((x) => (x.includes(hit.key) ? x : [...x, hit.key])); }
    else { setQ(s.focus); set({ focus: '' }); }
  }, [s.focus, b]);
  const rows = useMemo(() => (b && s.tab !== 'batches' ? filterRows(b.rows, { section: s.tab, q, repo, sort }) : []), [b, s.tab, q, repo, sort]);
  const toggle = (k: string) => setExpanded((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const tabs = [...(b?.sections ?? []).map((x) => ({ value: x.id as SectionId | 'batches', label: `${x.label} ${b?.counts[x.id] ?? 0}` })), { value: 'batches' as const, label: `Batches ${b?.batches.length ?? 0}` }];
  const sec = b?.sections.find((x) => x.id === s.tab);
  const errs = Object.entries(b?.errors ?? {});
  return (
    <div className="fx-stack axp-git-status">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Builds{b ? ` · checked ${ageText(b.checkedAt)} ago · live` : ' · loading…'}</p>
          <h1>Git status</h1>
          <p className="fx-muted axp-git-status__lede">What needs pushing, pulling, CI, merging, what is held and why, what merged and what runs where.</p>
        </div>
        <IconButton icon="refresh" label="Check now" onClick={() => void load(true)} disabled={s.loading} />
      </header>
      <div className="axp-git-status__tabs"><Segmented label="Section" size="sm" value={s.tab} onChange={(v) => set({ tab: v })} options={tabs} /></div>
      {s.tab !== 'batches' ? (
        <div className="axp-git-status__bar" role="toolbar" aria-label="Filter">
          <input className="fx-input axp-git-status__search" type="search" placeholder="Search PR #, line, branch, agent, build…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <select className="fx-input axp-git-status__sel" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repo">
            <option value="">All repos</option>{reposOf(b?.rows ?? []).map((x) => <option key={x} value={x}>{x.split('/')[1]}</option>)}
          </select>
          <select className="fx-input axp-git-status__sel" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="behind">Most behind</option><option value="cost">Cost</option><option value="name">Name</option>
          </select>
          <IconButton icon="chevron-up" label="Collapse all" onClick={() => setExpanded([])} disabled={!expanded.length} />
        </div>
      ) : null}
      {s.error ? <Note tone="danger">{s.error}</Note> : null}
      {errs.length ? <Note tone="warning">{errs.map(([k, v]) => <Fragment key={k}><strong>{k}:</strong> {v}<br /></Fragment>)}</Note> : null}
      {!b ? <p className="fx-empty">Loading…</p>
        : s.tab === 'batches' ? <Batches batches={b.batches} expanded={expanded} onToggle={toggle} />
          : <Grid id={`git-status-${s.tab}`} title={sec?.label ?? s.tab} icon={sec?.icon ?? 'list'} rows={rows} expanded={expanded} onToggle={toggle} />}
    </div>
  );
}

/* ---------------- plugin ---------------- */

const rowActions: [string, string, string][] = [['merge', 'Merge', 'git-merge'], ['hold', 'Hold / release', 'pause'], ['update', 'Update from main', 'download'], ['rerun', 'Re-run CI', 'refresh'], ['fix', 'Fix (Merge Max)', 'wrench'], ['land', 'Land', 'send']];

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Git status',
  version: '0.1.0',
  appMenu,
  register(rt) {
    const show = (what?: string) => { set({ focus: what ? decodeURIComponent(what) : '' }); rt.navigate(VIEW); };
    rt.actions.register('git-status.open', () => rt.navigate(VIEW), { label: 'Open Git status' });
    rt.actions.register('git-status.show', ([what]) => show(what), { label: 'Show in Git status' });
    for (const [id, label] of rowActions) {
      rt.actions.register(`git-status.${id}`, ([key]) => { if (key) void act(rt, id, { key: decodeURIComponent(key) }, label); }, { label: `Git status: ${label}` });
    }
    // "Show in Git status" wherever a PR, branch or build appears (right-click / long-press)
    rt.contextExtras.set('*:git-status', (target, payload) => {
      if (!payload || (target ?? '').startsWith('axf-git-status')) return [];
      const p = String(payload);
      const known = st.board?.rows.some((r) => matchesFocus(r, p));
      const looks = /^#?\d{1,7}$/.test(p) || /^(claude|fable|rebuild|harvest|feat|fix)\//.test(p) || /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+[#:]/.test(p);
      return known || looks ? [{ id: 'git-status.show', label: 'Show in Git status', icon: 'git-branch', action: `git-status.show:${encodeURIComponent(p)}` }] : [];
    });
    registerRowHook({ id: 'git-status.show', owner: ID, label: 'Show in Git status', icon: 'git-branch', kinds: ['orchestrator', 'pending', 'queue', 'change', 'pr', 'branch'], button: false, order: 60, run: (ref) => show(ref.id) });
  },
  views: { [VIEW]: { title: 'Git status', icon: 'git-branch', keywords: ['git', 'push', 'pull', 'merge', 'ci', 'pr', 'pull request', 'branch', 'held', 'deployed', 'stale', 'batch'], render: () => <GitStatusView /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Git status', icon: 'git-branch', view: VIEW }] },
  contextMenu: [
    { id: 'git-status.default', target: 'default', order: 94, items: [{ id: 'git-status', label: 'Git status', icon: 'git-branch', action: 'git-status.open' }] },
    { id: 'git-status.row', target: 'axf-git-status-row', items: rowActions.map(([id, label, icon]) => ({ id, label, icon, action: `git-status.${id}:{payload}` })) },
  ],
  settingsTabs: [{ id: 'git-status', label: 'Git status', icon: 'git-branch', parent: 'plugins', order: 46, description: 'Every PR, branch and worktree in grids: push, pull, CI, merge, held, deployed, stale.' }],
  settingsPanels: [{ id: 'git-status.lifecycle', tab: 'git-status', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
