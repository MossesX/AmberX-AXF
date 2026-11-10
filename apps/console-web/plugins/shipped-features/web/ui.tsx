import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Checkbox, Chip, Icon, ModelBadge, Segmented, SelectField, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import * as L from '@console/axf/core/feature-ledger.mjs';
import type { Manifest } from '@console/axf/core/shipped-manifest.mjs';
import './shipped-features.css';

/*
 * Shipped features (feature-ledger@1). Three levels on one grid:
 *   1. groups (View by: PR, build, day, app, plugin, type, repo, or flat) with counts that follow the filters
 *   2. features: status chip, edited chip, app / plugin, type, planned / merged / live dates, last edited
 *   3. details: what Brett said (verbatim), builds, PRs, live per target, the Edits timeline (newest first, each
 *      opens to its prompt, summary, files and links) and earlier versions (the original is kept), and the shipped
 *      manifest the orchestrator sent when the build landed (shipped-manifest@1: his prompt first, then collapsible
 *      sections: brief, steps, models and accounts, branch / PR / commit, files, tests, UI Review, cost, report, open)
 * Deep link: ?shipped=<build or feature id> (or #…?shipped=…) opens the grid on that build with its rows expanded.
 * Every rule (filter, sort, group, chips, export) is the framework's: framework/core/feature-ledger.mjs.
 * The view (grouping, sort, quick filters, open rows) is remembered per device.
 */

export const FOLDER = 'shipped-features';
export const VIEW = 'shipped-features';
const api = pluginApi(FOLDER, 'Shipped features', { unavailable: 'Shipped features is switched off or its server part is not running.' });
const VIEW_KEY = 'axp-shipped-features.view';
type Ledger = L.Ledger & { meta?: { syncing?: boolean; importing?: boolean; empty?: boolean; error?: string; counts?: Record<string, number>; importedAt?: string } };
type Detail = { feature: L.Feature; edits: L.Edit[]; prompts: L.Prompt[]; history: { rev: number; at: string; why: string; doc: L.Feature }[]; manifests?: Manifest[] };

/** Deep link + the shipped-features.show action: the build or feature to open the grid on. */
const FOCUS_EVENT = 'axp-shipped-focus';
let pendingFocus = '';
export function focusShipped(id: string) { pendingFocus = id.trim(); window.dispatchEvent(new CustomEvent(FOCUS_EVENT)); }
const focusFromUrl = () => { const read = (k: string) => new URLSearchParams(location.search).get(k) ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get(k); return (read('shipped') ?? '').trim(); };

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

const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`);
const usd = (n: number) => `$${n.toFixed(2)}`;
const RESULT_TONE: Record<string, 'success' | 'danger' | 'warning' | undefined> = { pass: 'success', fail: 'danger', skip: 'warning', unknown: undefined };

/** A collapsible manifest section (native details: keyboard and screen readers get it for free). */
function Section({ title, count, open = false, children }: { title: string; count?: number | string; open?: boolean; children: ReactNode }) {
  return (
    <details className="axp-shipped__msec" open={open}>
      <summary>{title}{count !== undefined && count !== '' ? <span className="fx-muted"> · {count}</span> : null}</summary>
      <div className="axp-shipped__msecbody">{children}</div>
    </details>
  );
}

/** The shipped manifest of a build: Brett's prompt first and highlighted, then every fact in its own collapsible section. */
export function ManifestPanel({ m }: { m: Manifest }) {
  const done = m.steps.filter((s) => s.done);
  const est = m.steps.reduce((a, s) => a + s.estimateMin, 0); const act = done.reduce((a, s) => a + s.actualMin, 0);
  const t = m.cost.tokens;
  return (
    <section className="axp-shipped__manifest" aria-label={`Shipped manifest of ${m.build.title || m.build.id}`}>
      <h4><Icon name="package" /> Shipped manifest <span className="fx-muted">{m.build.id} · rev {m.rev} · {m.source}</span></h4>
      <blockquote className="axp-shipped__said axp-shipped__prompt" title={m.said.verbatim ? 'His exact words' : 'From the build (may be paraphrased)'}>
        <mark>{m.said.text}</mark>
        <footer className="fx-muted">{m.said.verbatim ? 'The prompt that created it (his exact words)' : 'From the build detail (no verbatim prompt recorded)'}{m.said.at ? ` · ${fmtTime(m.said.at)}` : ''}{m.said.source ? ` · ${m.said.source}` : ''}</footer>
      </blockquote>
      {m.said.addenda.map((a, i) => <blockquote key={i} className="axp-shipped__said">{a.text}<footer className="fx-muted">Addendum {i + 1}{a.at ? ` · ${fmtTime(a.at)}` : ''}</footer></blockquote>)}
      <div className="axp-shipped__chips">
        {m.pr.number ? <a className="fx-chip" href={m.pr.url} target="_blank" rel="noreferrer">PR #{m.pr.number}</a> : null}
        {m.landedCommit ? <Chip tone="success">Landed {m.landedCommit.slice(0, 9)}{m.landedAt ? ` · ${fmtTime(m.landedAt)}` : ''}</Chip> : null}
        {m.models.map((x) => <ModelBadge key={x} model={x} />)}
        {m.tests.length ? <Chip tone={m.tests.some((x) => x.result === 'fail') ? 'danger' : 'success'}>{m.tests.filter((x) => x.result === 'pass').length}/{m.tests.length} test lines pass</Chip> : null}
        {m.cost.usd ? <Chip>{usd(m.cost.usd)}{m.cost.estimated ? ' (est.)' : ''}</Chip> : null}
        {m.open.length ? <Chip tone="warning">{m.open.length} still open</Chip> : null}
      </div>
      {m.brief ? <Section title="Full brief" count={`${m.brief.length.toLocaleString()} chars`}><pre className="axp-shipped__pre">{m.brief}</pre></Section> : null}
      <Section title="Steps" count={`${done.length}/${m.steps.length} · est. ${mins(est)} · actual ${mins(act)}`}>
        <ol className="axp-shipped__steps">{m.steps.map((s) => <li key={s.id}><b>{s.id}</b> <ModelBadge model={s.model} /> <span className="fx-muted">est. {s.estimate || '—'} · {s.done ? `took ${mins(s.actualMin)}${s.doneAt ? ` · done ${fmtTime(s.doneAt)}` : ''}` : 'not done'}</span><p>{s.text}</p></li>)}</ol>
      </Section>
      <Section title="Models and accounts" count={m.accounts.join(', ') || '—'}>
        <ul className="axp-shipped__list">{m.runs.length ? m.runs.map((r) => <li key={r.session}><code>{r.session}</code> · {r.account || '?'} · {r.model || '?'} · {fmtTime(r.startedAt)}{r.endedAt ? ` → ${fmtTime(r.endedAt)}` : ''}{r.exit !== null ? ` · exit ${r.exit}` : ''}{r.costUsd ? ` · ${usd(r.costUsd)}` : ''}</li>) : <li className="fx-muted">No session record found.</li>}</ul>
      </Section>
      <Section title="Branch, PR and commits" count={m.commits.length}>
        <dl className="axp-shipped__facts">
          <dt>Branch</dt><dd>{m.branch ? <code>{m.branch}</code> : '—'}</dd>
          <dt>Pull request</dt><dd>{m.pr.number ? <a href={m.pr.url} target="_blank" rel="noreferrer">{L.REPOS[m.pr.repo]?.label ?? m.pr.repo} #{m.pr.number}</a> : '—'}</dd>
          <dt>Landed</dt><dd>{m.landedCommit ? <code>{m.landedCommit.slice(0, 12)}</code> : '—'}{m.landedAt ? ` · ${fmtTime(m.landedAt)}` : ''}</dd>
          <dt>Commits</dt><dd>{m.commits.length ? m.commits.map((c) => <code key={c}>{c.slice(0, 9)}</code>) : '—'}</dd>
        </dl>
      </Section>
      <Section title="Files and areas" count={`${m.files.length} files · ${m.areas.length} areas`}>
        <ul className="axp-shipped__list">{m.areas.map((a) => <li key={`${a.kind}:${a.id}`}><b>{a.kind}</b> {a.id} <span className="fx-muted">({a.files.length})</span><p className="axp-shipped__files fx-muted">{a.files.join(', ')}</p></li>)}</ul>
      </Section>
      <Section title="Tests" count={m.tests.length || 'none recorded'}>
        <ul className="axp-shipped__list">{m.tests.map((x, i) => <li key={i}><Chip tone={RESULT_TONE[x.result]}>{x.result}</Chip> {x.name}{x.command ? <> · <code>{x.command}</code></> : null}</li>)}</ul>
      </Section>
      <Section title="UI Review" count={m.uiReview.length || 'none'}>
        <ul className="axp-shipped__list">{m.uiReview.map((r) => <li key={r.id || r.name}>{r.name || r.id} · <span className="fx-muted">{r.status}{r.group ? ` · ${r.group}` : ''}</span></li>)}</ul>
      </Section>
      <Section title="Cost and tokens" count={m.cost.usd ? usd(m.cost.usd) : '—'}>
        <p>{usd(m.cost.usd)}{m.cost.estimated ? ' (estimated)' : ''} · input {t.input.toLocaleString()} · output {t.output.toLocaleString()} · cache read {t.cacheRead.toLocaleString()} · cache write {t.cacheWrite.toLocaleString()}</p>
      </Section>
      <Section title="Report" count={m.report ? '1' : 'none'}>{m.report ? <code>{m.report}</code> : <p className="fx-muted">No report found.</p>}</Section>
      <Section title="Still open" count={m.open.length} open={m.open.length > 0}>
        {m.open.length ? <ul className="axp-shipped__list">{m.open.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="fx-muted">Nothing open.</p>}
      </Section>
    </section>
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
      {d?.manifests?.length ? d.manifests.map((m) => <ManifestPanel key={m.id} m={m} />) : null}
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
  // deep link (?shipped=<build or feature id>) and the shipped-features.show action: group by build, search it, open its rows
  const [focus, setFocus] = useState(() => { const u = focusFromUrl(); if (u) pendingFocus = u; return pendingFocus; });
  useEffect(() => { const on = () => setFocus(pendingFocus); window.addEventListener(FOCUS_EVENT, on); return () => window.removeEventListener(FOCUS_EVENT, on); }, []);
  useEffect(() => {
    if (!ledger || !focus) return;
    const id = focus.toLowerCase();
    const hits = ledger.features.filter((f) => f.id === id || f.builds.some((b) => b.id === id));
    const groups = hits.flatMap((f) => (f.builds.length ? f.builds.map((b) => `g:${b.profile || 'main-framework'}:${b.id}`) : []));
    set({ by: 'build', search: hits.length && !hits.some((f) => f.id === id) ? id : hits[0]?.name ?? id, hideCancelled: false, hideCompleted: false, hidePending: false, statuses: [], expanded: [...new Set([...hits.map((f) => f.id), ...groups])] });
    pendingFocus = ''; setFocus('');
  }, [ledger, focus]); // eslint-disable-line react-hooks/exhaustive-deps
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
