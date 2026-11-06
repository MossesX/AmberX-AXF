import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Icon, ModelBadge, Segmented, SelectField, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import * as L from '@console/axf/core/feature-ledger.mjs';
import './shipped-features.css';

/*
 * Shipped features (feature-ledger@1). Three levels on one grid:
 *   1. groups (View by: PR, build, day, app, plugin, type, repo, or flat) with counts that follow the filters
 *   2. features: status chip, edited chip, app / plugin, type, planned / merged / live dates, last edited
 *   3. details: what Brett said (verbatim), builds, PRs, live per target, the Edits timeline (newest first, each
 *      opens to its prompt, summary, files and links) and earlier versions (the original is kept)
 * Every rule (filter, sort, group, chips, export) is the framework's: framework/core/feature-ledger.mjs.
 * The view (grouping, sort, quick filters, open rows) is remembered per device.
 */

export const FOLDER = 'shipped-features';
export const VIEW = 'shipped-features';
const api = pluginApi(FOLDER, 'Shipped features', { unavailable: 'Shipped features is switched off or its server part is not running.' });
const VIEW_KEY = 'axp-shipped-features.view';
type Ledger = L.Ledger & { meta?: { syncing?: boolean; importing?: boolean; empty?: boolean; error?: string; counts?: Record<string, number>; importedAt?: string } };
type Detail = { feature: L.Feature; edits: L.Edit[]; prompts: L.Prompt[]; history: { rev: number; at: string; why: string; doc: L.Feature }[] };

const loadView = (): L.View => { try { return L.normView(JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')); } catch { return L.normView({}); } };
const saveView = (v: L.View) => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* private window: the view just isn't remembered */ } };
const TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { ok: 'success', warn: 'warning', accent: 'accent', info: 'accent', danger: 'danger', muted: undefined };
const fmtDay = (v: string, guessed = false) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : `${guessed ? '~' : ''}${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`; };
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const firstLiveGuessed = (f: L.Feature) => { const e = Object.values(f.liveAt).sort((a, b) => a.at.localeCompare(b.at))[0]; return !!e?.guessed; };
const prUrl = (repo: string, n: number) => (L.REPOS[repo] ? `https://github.com/${L.REPOS[repo].github}/pull/${n}` : '');

export function StatusChip({ rec }: { rec: { status: string; stalled?: boolean; liveAt?: Record<string, L.LiveEntry>; mergedAtGuessed?: boolean } }) {
  const c = L.statusChip(rec); return <Chip tone={TONE[c.tone]}>{c.label}</Chip>;
}
export function EditedChip({ f }: { f: L.Feature }) {
  const c = L.editedChip(f); return c ? <Chip tone={TONE[c.tone]}>{c.label}</Chip> : null;
}

/** Quick filters: hide completed / pending, status multi-select, edit filters. Each change is remembered on this device. */
function Filters({ view, set }: { view: L.View; set: (p: Partial<L.View>) => void }) {
  const toggleStatus = (s: L.Status) => set({ statuses: view.statuses.includes(s) ? view.statuses.filter((x) => x !== s) : [...view.statuses, s] });
  return (
    <div className="axp-shipped__filters" role="toolbar" aria-label="Shipped features filters">
      <Checkbox label="Hide completed" checked={view.hideCompleted} onChange={(v) => set({ hideCompleted: v })} title="Hide Merged, Live and Removed features (and edits)" />
      <Checkbox label="Hide pending" checked={view.hidePending} onChange={(v) => set({ hidePending: v })} title="Hide Planned, Queued, Building and In PR features (and edits)" />
      <Checkbox label="Show cancelled" checked={!view.hideCancelled} onChange={(v) => set({ hideCancelled: !v })} title="Cancelled builds keep their features as Cancelled; hidden by default" />
      <Checkbox label="Has edits" checked={view.hasEdits === true} onChange={(v) => set({ hasEdits: v ? true : null })} title="Only features something later changed" />
      <Checkbox label="Being edited now" checked={view.beingEdited} onChange={(v) => set({ beingEdited: v })} title="Only features with an edit still in progress" />
      <span className="axp-shipped__statuses" role="group" aria-label="Status">
        {L.STATUSES.map((s) => (
          <button key={s} type="button" className={`fx-chip ${view.statuses.includes(s) ? 'fx-chip--accent' : ''}`} aria-pressed={view.statuses.includes(s)} onClick={() => toggleStatus(s)} title={`Show only ${L.STATUS_LABEL[s]} (pick several)`}>{L.STATUS_LABEL[s]}</button>
        ))}
      </span>
      <SelectField label="Edit status" value={view.editStatus} onChange={(v) => set({ editStatus: v as L.Status | '' })} options={[{ value: '', label: 'Any edit status' }, ...L.STATUSES.map((s) => ({ value: s, label: L.STATUS_LABEL[s] }))]} />
      {(view.statuses.length || view.hideCompleted || view.hidePending || !view.hideCancelled || view.hasEdits !== null || view.beingEdited || view.editStatus || view.search) ? <Button icon="x" onClick={() => set({ ...L.DEFAULT_VIEW, by: view.by, sort: view.sort, expanded: view.expanded })}>Clear filters</Button> : null}
    </div>
  );
}

/** Level 3: one feature's details, fetched when its row opens. */
function FeatureDetail({ f, ledger }: { f: L.Feature; ledger: Ledger }) {
  const [d, setD] = useState<Detail | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { let on = true; api.call<Detail>(`feature/${encodeURIComponent(f.id)}`).then((r) => { if (on) setD(r); }, (e: Error) => { if (on) setErr(e.message); }); return () => { on = false; }; }, [f.id, f.rev]);
  const prompts = d?.prompts ?? ledger.prompts;
  const said = L.saidBlock(f, prompts);
  const builds = new Map(ledger.builds.map((b) => [b.key, b]));
  const editPrompt = (id: string) => prompts.find((p) => p.id === id);
  const original = d?.history[0]?.doc;
  return (
    <div className="axp-shipped__detail">
      {f.description ? <p className="axp-shipped__desc">{f.description}</p> : null}
      <section aria-label="What Brett said">
        <h4><Icon name="mic" /> What Brett said</h4>
        {said.length ? said.map((p) => (
          <blockquote key={p.id} className="axp-shipped__said" title={p.verbatim ? 'His exact words' : 'May be paraphrased'}>
            {p.highlight ? <>{p.said.slice(0, p.highlight[0])}<mark>{p.said.slice(p.highlight[0], p.highlight[1])}</mark>{p.said.slice(p.highlight[1])}</> : p.said}
            <footer className="fx-muted">{p.kind === 'addendum' ? `Addendum ${p.index}` : 'Started it'}{p.at ? ` · ${fmtTime(p.at)}` : ''}{p.source ? ` · ${p.source}` : ''}{p.verbatim ? '' : ' · may be paraphrased'}</footer>
          </blockquote>
        )) : <p className="fx-muted">No prompt recorded (imported from history).</p>}
      </section>
      <dl className="axp-shipped__facts">
        <dt>Builds</dt><dd>{f.builds.length ? f.builds.map((b) => <span key={`${b.profile}:${b.id}`} className="axp-shipped__ref">{builds.get(L.buildKey(b.profile, b.id))?.title || b.id}{b.profile ? ` (${b.profile})` : ''} · {b.role}</span>) : '—'}</dd>
        <dt>Pull requests</dt><dd>{f.prs.length ? f.prs.filter((p, i, a) => a.findIndex((x) => x.repo === p.repo && x.number === p.number) === i).map((p) => <a key={`${p.repo}#${p.number}`} className="axp-shipped__ref" href={prUrl(p.repo, p.number)} target="_blank" rel="noreferrer">{L.REPOS[p.repo]?.label ?? p.repo} #{p.number}</a>) : '—'}</dd>
        <dt>Live</dt><dd>{Object.keys(f.liveAt).length ? Object.entries(f.liveAt).map(([t, e]) => <span key={t} className="axp-shipped__ref">{t}: {fmtDay(e.at, e.guessed)}</span>) : '—'}</dd>
        <dt>Model / agent</dt><dd>{f.model ? <ModelBadge model={f.model} /> : '—'}{f.agent ? ` · ${f.agent}` : ''}{f.session ? ` · ${f.session}` : ''}</dd>
        <dt>Commit</dt><dd>{f.mergeCommit ? <code>{f.mergeCommit.slice(0, 10)}</code> : '—'}</dd>
        {f.files.length ? <><dt>Files</dt><dd className="axp-shipped__files">{f.files.slice(0, 12).join(', ')}{f.files.length > 12 ? ` +${f.files.length - 12}` : ''}</dd></> : null}
      </dl>
      <section aria-label="Edits">
        <h4><Icon name="clock" /> Edits {d ? `(${d.edits.length})` : ''}</h4>
        {err ? <p className="fx-muted">{err}</p> : !d ? <LoadingSkeleton rows={2} label="Loading edits" /> : d.edits.length ? (
          <ol className="axp-shipped__timeline">
            {d.edits.map((e) => {
              const isOpen = open.includes(e.id); const p = editPrompt(e.prompt);
              return (
                <li key={e.id} className={`axp-shipped__edit ${isOpen ? 'is-open' : ''}`}>
                  <button type="button" data-fx-row className="axp-shipped__edithead" aria-expanded={isOpen} onClick={() => setOpen((o) => (isOpen ? o.filter((x) => x !== e.id) : [...o, e.id]))}>
                    <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} /> <span>{fmtDay(e.at)}</span> <StatusChip rec={e} /> <span className="axp-shipped__editsum">{e.summary}</span>
                  </button>
                  {isOpen ? (
                    <div className="axp-shipped__editbody">
                      {p ? <blockquote className="axp-shipped__said">{p.said}<footer className="fx-muted">{p.verbatim ? 'His exact words' : 'May be paraphrased'}{p.at ? ` · ${fmtTime(p.at)}` : ''}</footer></blockquote> : null}
                      <p>{e.kind} · {e.build ? `build ${e.build}` : ''}{e.pr ? ` · ` : ''}{e.pr ? <a href={prUrl(e.repo, e.pr)} target="_blank" rel="noreferrer">PR #{e.pr}</a> : null}{e.commit ? <> · <code>{e.commit.slice(0, 10)}</code></> : null}{e.model ? <> · <ModelBadge model={e.model} /></> : null}{e.agent ? ` · ${e.agent}` : ''}{e.session ? ` · ${e.session}` : ''}</p>
                      {e.files.length ? <p className="axp-shipped__files fx-muted">{e.files.slice(0, 10).join(', ')}{e.files.length > 10 ? ` +${e.files.length - 10}` : ''}</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : <p className="fx-muted">Never edited.</p>}
      </section>
      {original && d && d.history.length ? (
        <details className="axp-shipped__history">
          <summary>Earlier versions ({d.history.length}) · original: {original.name} ({L.STATUS_LABEL[original.status]}, {fmtDay(original.plannedAt || original.createdAt)})</summary>
          <ul>{d.history.map((h) => <li key={h.rev}>v{h.rev} · {fmtTime(h.at)} · {h.why || 'changed'} · {L.STATUS_LABEL[h.doc.status]}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

export function ShippedFeaturesPage() {
  const rt = useRuntime();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  const [view, setViewState] = useState<L.View>(loadView);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<L.View>) => setViewState((v) => { const n = L.normView({ ...v, ...p }); saveView(n); return n; });

  const load = async () => { try { setLedger(await api.call<Ledger>('ledger')); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 60_000); return () => window.clearInterval(t); }, []);
  useEffect(() => { if (ledger?.meta?.importing || ledger?.meta?.syncing) { const t = window.setTimeout(() => { void load(); }, 5_000); return () => window.clearTimeout(t); } return undefined; }, [ledger]);

  const ctx = useMemo(() => (ledger ? { prompts: ledger.prompts, edits: ledger.edits, prs: ledger.prs, builds: ledger.builds } : {}), [ledger]);
  const shown = useMemo(() => (ledger ? L.filterFeatures(ledger.features, view, ctx) : []), [ledger, view, ctx]);
  const groups = useMemo(() => (ledger ? L.groupFeatures(shown, view, ctx) : []), [ledger, shown, view, ctx]);
  const total = useMemo(() => ({ all: ledger?.features.length ?? 0, pending: shown.filter((f) => L.isPending(f.status)).length, live: shown.filter((f) => f.status === 'live').length, editing: shown.filter((f) => f.beingEdited).length }), [ledger, shown]);

  const sync = async () => { setBusy(true); try { await api.post('sync', {}); rt.toast('Syncing builds, PRs and deploys…', 'info'); window.setTimeout(() => { void load(); }, 4000); } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); } };
  const exportAs = (kind: 'csv' | 'md') => { void api.download(`export?kind=${kind}&view=${encodeURIComponent(JSON.stringify(view))}`, `shipped-features.${kind}`).catch((e: Error) => rt.toast(e.message, 'danger')); };

  if (!ledger && !error) return <LoadingSkeleton rows={6} label="Loading shipped features" />;
  if (!ledger) return <EmptyState icon="alert">{error}</EmptyState>;

  const sortCol = ({ name: 'name', status: 'status', app: 'app', type: 'type', planned: 'plannedAt', merged: 'mergedAt', live: 'liveAt', edited: 'lastEditAt', edits: 'editCount' } as Record<string, L.SortKey>);
  const colOf: Record<string, string> = Object.fromEntries(Object.entries(sortCol).map(([k, v]) => [v, k]));
  const sortedCol = colOf[view.sort.by];
  const sort: GridSort = sortedCol ? { col: sortedCol, dir: view.sort.dir === 'asc' ? 1 : -1 } : null;
  const onSort = (col: string | null) => { const by = col ? sortCol[col] : undefined; if (!by) return set({ sort: L.DEFAULT_VIEW.sort }); set({ sort: { by, dir: view.sort.by === by && view.sort.dir === 'desc' ? 'asc' : 'desc' } }); };
  const W = (n: number) => `calc(var(--fx-space) * ${n})`;
  const columns: GridColumn<L.Feature>[] = [
    { id: 'name', label: 'Feature', width: `minmax(${W(30)}, 3fr)`, fixed: true, sortable: true, render: (f) => <span className="axp-shipped__name">{f.name}</span> },
    { id: 'status', label: 'Status', width: W(14), sortable: true, render: (f) => <StatusChip rec={f} /> },
    { id: 'edits', label: 'Edited', width: W(18), sortable: true, sortValue: (f) => f.editCount, render: (f) => <EditedChip f={f} /> },
    { id: 'app', label: 'App / plugin', width: W(18), sortable: true, render: (f) => <span className="fx-muted">{[f.app, f.plugin].filter(Boolean).join(' · ') || '—'}</span> },
    { id: 'type', label: 'Type', width: W(14), sortable: true, render: (f) => L.TYPE_LABEL[f.type] },
    { id: 'planned', label: 'Planned', width: W(13), sortable: true, render: (f) => fmtDay(f.plannedAt) },
    { id: 'merged', label: 'Merged', width: W(13), sortable: true, render: (f) => fmtDay(f.mergedAt, f.mergedAtGuessed) },
    { id: 'live', label: 'Live', width: W(13), sortable: true, render: (f) => fmtDay(f.firstLiveAt, firstLiveGuessed(f)) },
    { id: 'edited', label: 'Last edited', width: W(13), sortable: true, render: (f) => fmtDay(f.lastEditAt) },
  ];
  const gridGroups: GridGroup<L.Feature>[] = groups.map((g) => ({
    id: `g:${g.key}`, title: g.label, rows: g.features, groups: [], collapsed: !view.expanded.includes(`g:${g.key}`) && groups.length > 1,
    counts: <span className="axp-shipped__counts">{g.count} · {g.counts.pending} pending · {g.counts.completed} done{g.counts.cancelled ? ` · ${g.counts.cancelled} cancelled` : ''}{g.counts.edited ? ` · ${g.counts.edited} edited` : ''}</span>,
  }));
  const toggle = (id: string) => set({ expanded: view.expanded.includes(id) ? view.expanded.filter((x) => x !== id) : [...view.expanded, id] });
  const m = ledger.meta ?? {};
  return (
    <div className="fx-stack axp-shipped">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AmberX-AXF + axHub · {shown.length} of {total.all} features · {total.pending} pending · {total.live} live{total.editing ? ` · ${total.editing} being edited` : ''}{m.syncing ? ' · syncing…' : ''}{m.importing ? ' · importing history…' : ''}</p>
          <h1>Shipped features</h1>
          <p className="fx-muted">Every feature from the moment a build plans it to when it went live, with every later edit. ~ marks a date reconstructed from history.</p>
        </div>
        <div className="axp-shipped__actions" role="toolbar" aria-label="Shipped features actions">
          <Button icon="refresh" disabled={busy || m.syncing} onClick={() => void sync()} title="Pick up new build events, merged PRs and deploys now">Sync</Button>
          <Button icon="download" onClick={() => exportAs('csv')} title="The rows you see, as CSV">CSV</Button>
          <Button icon="file" onClick={() => exportAs('md')} title="The rows you see, as a Markdown table">Markdown</Button>
        </div>
      </header>
      {m.error ? <p className="axp-shipped__warn" role="status"><Icon name="alert" /> Last sync failed: {m.error}</p> : null}
      <div className="axp-shipped__bar" role="toolbar" aria-label="Shipped features view">
        <Segmented size="sm" label="View by" value={view.by} onChange={(by) => set({ by })} options={L.GROUPINGS.map((g) => ({ value: g, label: L.GROUPING_LABEL[g] }))} />
        <TextField label="Search" type="search" placeholder="Search names, prompts, PR #, builds…" value={view.search} onChange={(search) => set({ search })} />
      </div>
      <Filters view={view} set={set} />
      {m.empty ? <EmptyState icon="clock">Building the ledger from history (builds journal, merged PRs, early commits)… this takes a minute the first time.</EmptyState> : (
        <DataGrid<L.Feature>
          id="shipped-features" label="Shipped features" groups={gridGroups} columns={columns} rowId={(f) => f.id} rowLabel={(f) => f.name}
          hidden={view.hiddenColumns} onToggleColumn={(c, show) => set({ hiddenColumns: show === false || (show === undefined && !view.hiddenColumns.includes(c)) ? [...view.hiddenColumns, c] : view.hiddenColumns.filter((x) => x !== c) })}
          onShowAll={() => set({ hiddenColumns: [] })} sort={sort} onSort={onSort}
          expanded={view.expanded} onToggleExpand={toggle} onToggleGroup={toggle}
          renderDetail={(f) => <FeatureDetail f={f} ledger={ledger} />}
          rowTone={(f) => ({ ok: 'success', warn: 'warning', accent: 'accent', info: 'info', danger: 'danger', muted: 'muted' } as Record<string, string>)[L.statusChip(f).tone] ?? 'muted'}
          rowRef={(f) => ({ kind: 'feature', id: f.id })}
          empty={<EmptyState icon="search" compact>No feature matches these filters.</EmptyState>}
        />
      )}
    </div>
  );
}
