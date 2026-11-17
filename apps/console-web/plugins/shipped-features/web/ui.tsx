import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Checkbox, Chip, Container, Icon, IconButton, ModelBadge, Segmented, SelectField, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { DataGrid, type GridColumn, type GridGroup } from '@console/axf/libs/datagrid';
import * as L from '@console/axf/core/feature-ledger.mjs';
import type { Manifest } from '@console/axf/core/shipped-manifest.mjs';
import * as T from '../ledger/table.mjs';
import './shipped-features.css';

/*
 * Shipped features: one table of every feature on the shared framework grid (lib-datagrid), rows from
 * ../ledger/table.mjs (shipped-table@1; the same projection REST GET /table, the MCP tool, the CLI and voice read).
 *   - groups: plugin / area (default), date, build, PR, status or none; collapsible headers with counts per status
 *   - columns: feature, area, description, status, build, PR, commit, shipped, on main, deployed, how to reach it,
 *     settings key, help, version, who asked, tests; shown / hidden and reordered in the column picker
 *   - sort: tap a header (again to reverse), shift-click or the header menu's "Then by" (long-press) for more keys
 *   - search, filter chips (status, has API, not deployed, plugin, date range), row count, CSV of what is shown
 *   - each row expands (status, reach, settings, tests, then the feature's prompt, edits and shipped manifest);
 *     right-click / long-press a row or a cell: open feature, open build, open PR, copy link, mark removed
 * The view is remembered per viewer (this browser). Deep link: ?shipped=<feature, build or PR>.
 */

export const FOLDER = 'shipped-features';
export const VIEW = 'shipped-features';
const api = pluginApi(FOLDER, 'Shipped features', { unavailable: 'Shipped features is switched off or its server part is not running.' });
type Ledger = L.Ledger & { manifests?: T.ManifestSummary[]; meta?: { syncing?: boolean; importing?: boolean; empty?: boolean; error?: string; counts?: Record<string, number>; importedAt?: string } };
type Detail = { feature: L.Feature; edits: L.Edit[]; prompts: L.Prompt[]; history: { rev: number; at: string; why: string; doc: L.Feature }[]; manifests?: Manifest[] };

/** Deep link + the shipped-features.show action: the build or feature to open the grid on. */
const FOCUS_EVENT = 'axp-shipped-focus';
let pendingFocus = '';
export function focusShipped(id: string) { pendingFocus = id.trim(); window.dispatchEvent(new CustomEvent(FOCUS_EVENT)); }
const focusFromUrl = () => { const read = (k: string) => new URLSearchParams(location.search).get(k) ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get(k); return (read('shipped') ?? '').trim(); };

const TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { ok: 'success', warn: 'warning', accent: 'accent', info: 'accent', danger: 'danger', muted: undefined };
const fmtDay = (v: string, guessed = false) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : `${guessed ? '~' : ''}${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`; };
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const prUrl = (repo: string, n: number) => (L.REPOS[repo] ? `https://github.com/${L.REPOS[repo].github}/pull/${n}` : '');

export function StatusChip({ rec }: { rec: { status: string; stalled?: boolean; liveAt?: Record<string, L.LiveEntry>; mergedAtGuessed?: boolean } }) {
  const c = L.statusChip(rec); return <Chip tone={TONE[c.tone]}>{c.label}</Chip>;
}
export function EditedChip({ f }: { f: L.Feature }) {
  const c = L.editedChip(f); return c ? <Chip tone={TONE[c.tone]}>{c.label}</Chip> : null;
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


/* ------------------------------------------------------------------ the table (shipped-table@1, ../ledger/table.mjs) */

const TABLE_KEY = 'axp-shipped-features.table';
const VIEW_EVENT = 'axp-shipped-view';
let pendingView: Partial<T.TableView> | null = null;
/** The shipped-features.view action (MCP / voice / CLI through the console): merge a view into the open table. */
export function applyShippedView(v: Partial<T.TableView>) { pendingView = v; window.dispatchEvent(new CustomEvent(VIEW_EVENT)); }
const loadTable = (): T.TableView => { try { return T.normTableView(JSON.parse(localStorage.getItem(TABLE_KEY) || 'null') ?? T.DEFAULT_VIEW); } catch { return T.normTableView(T.DEFAULT_VIEW); } };
const saveTable = (v: T.TableView) => { try { localStorage.setItem(TABLE_KEY, JSON.stringify(v)); } catch { /* private window: not remembered */ } };
/** Rows on screen, for the row / cell context menu (index.tsx). */
export const shownRows = new Map<string, T.Row>();
export const ROW_TARGET = 'shipped-features.row';
export const CELL_TARGET = 'shipped-features.cell';
const REACH_ICON: Record<T.Reach, string> = { deeplink: 'external', rest: 'cloud', mcp: 'sparkles', cli: 'terminal', voice: 'mic' };
const COL_LABEL: Record<string, string> = Object.fromEntries(T.COLUMNS.map((c) => [c.id, c.label]));
const fmtHm = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
export const rowLink = (r: T.Row) => `${location.origin}${location.pathname}${r.deepLink}`;

export function ShipBadge({ status }: { status: T.ShipStatus }) { return <Chip tone={T.SHIP_STATUS_TONE[status]}>{T.SHIP_STATUS_LABEL[status]}</Chip>; }
/** A filter chip (framework chip class, pressed state for screen readers). */
const ChipToggle = ({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) => (
  <button type="button" className={`fx-chip ${on ? 'fx-chip--accent' : ''}`} aria-pressed={on} onClick={onClick} title={title}>{children}</button>
);
const YesNo = ({ v, yes, no }: { v: boolean; yes: string; no: string }) => <Chip tone={v ? 'success' : undefined}>{v ? yes : no}</Chip>;

/** Column picker: show / hide every column and move it up or down; remembered with the view. */
function ColumnPicker({ view, set, close }: { view: T.TableView; set: (p: Partial<T.TableView>) => void; close: () => void }) {
  const move = (id: string, d: -1 | 1) => { const o = [...view.order]; const i = o.indexOf(id); const j = i + d; if (j < 1 || j >= o.length) return; [o[i], o[j]] = [o[j]!, o[i]!]; set({ order: o }); };
  return (
    <Container className="axp-shipped__picker">
      <div className="axp-shipped__pickhead" role="toolbar" aria-label="Column picker">
        <b>Columns</b>
        <Button size="sm" onClick={() => set({ hidden: [] })}>Show all</Button>
        <Button size="sm" onClick={() => set({ hidden: [...T.DEFAULT_HIDDEN], order: [...T.COLUMN_IDS] })}>Reset</Button>
        <IconButton icon="x" label="Close the column picker" onClick={close} />
      </div>
      <ol className="axp-shipped__picklist">
        {view.order.map((id, i) => (
          <li key={id}>
            <Checkbox label={COL_LABEL[id] ?? id} checked={id === 'name' || !view.hidden.includes(id)} disabled={id === 'name'} onChange={(on) => set({ hidden: on ? view.hidden.filter((x) => x !== id) : [...view.hidden, id] })} />
            <IconButton icon="chevron-left" label={`Move ${COL_LABEL[id]} left`} disabled={i <= 1} onClick={() => move(id, -1)} />
            <IconButton icon="chevron-right" label={`Move ${COL_LABEL[id]} right`} disabled={i === 0 || i === view.order.length - 1} onClick={() => move(id, 1)} />
          </li>
        ))}
      </ol>
    </Container>
  );
}

/** Filter chips: plugin, status, date range, has API, not deployed. */
function TableFilters({ view, set, plugins }: { view: T.TableView; set: (p: Partial<T.TableView>) => void; plugins: string[] }) {
  const tog = <K extends 'statuses' | 'plugins'>(k: K, v: string) => set({ [k]: (view[k] as string[]).includes(v) ? (view[k] as string[]).filter((x) => x !== v) : [...view[k], v] } as Partial<T.TableView>);
  const any = view.statuses.length || view.plugins.length || view.from || view.to || view.hasApi || view.notDeployed || view.search;
  return (
    <div className="axp-shipped__filters" role="toolbar" aria-label="Shipped features filters">
      <span className="axp-shipped__statuses" role="group" aria-label="Status">
        {T.SHIP_STATUSES.map((s) => <ChipToggle key={s} on={view.statuses.includes(s)} onClick={() => tog('statuses', s)}>{T.SHIP_STATUS_LABEL[s]}</ChipToggle>)}
      </span>
      <ChipToggle on={view.hasApi} onClick={() => set({ hasApi: !view.hasApi })} title="Only features reachable by REST, MCP, CLI or voice">Has API</ChipToggle>
      <ChipToggle on={view.notDeployed} onClick={() => set({ notDeployed: !view.notDeployed })} title="Only features not live anywhere yet">Not deployed</ChipToggle>
      <SelectField label="Plugin" value="" onChange={(v) => v && tog('plugins', v)} options={[{ value: '', label: view.plugins.length ? `${view.plugins.length} picked` : 'Any plugin' }, ...plugins.map((p) => ({ value: p, label: `${view.plugins.includes(p) ? '✓ ' : ''}${p}` }))]} />
      {view.plugins.map((p) => <ChipToggle key={p} on onClick={() => tog('plugins', p)} title={`Stop filtering on ${p}`}>{p} ×</ChipToggle>)}
      <TextField label="From" type="date" className="axp-shipped__date" value={view.from} onChange={(from) => set({ from })} />
      <TextField label="To" type="date" className="axp-shipped__date" value={view.to} onChange={(to) => set({ to })} />
      {any ? <Button icon="x" size="sm" onClick={() => set({ statuses: [], plugins: [], from: '', to: '', hasApi: false, notDeployed: false, search: '' })}>Clear filters</Button> : null}
    </div>
  );
}

function RowDetail({ r, ledger }: { r: T.Row; ledger: Ledger }) {
  const f = ledger.features.find((x) => x.id === r.id);
  return (
    <div className="axp-shipped__detail">
      <dl className="axp-shipped__facts">
        <dt>Status</dt><dd><ShipBadge status={r.status} />{f && L.statusChip(f).label !== T.SHIP_STATUS_LABEL[r.status] ? <span className="fx-muted">ledger: {L.statusChip(f).label}</span> : null}</dd>
        <dt>How to reach it</dt><dd>{r.reach.length ? r.reach.map((x) => <span key={x} className="axp-shipped__ref"><Icon name={REACH_ICON[x]} /> {T.REACH_LABEL[x]}</span>) : '—'}<code>{r.deepLink}</code></dd>
        <dt>Settings key</dt><dd>{r.settings ? <code>{r.settings}</code> : '—'}</dd>
        <dt>Help</dt><dd>{r.help ? <a href={r.help} target="_blank" rel="noreferrer">{r.help}</a> : '—'}</dd>
        <dt>Tests</dt><dd>{r.tests.total ? `${r.tests.pass}/${r.tests.total} pass` : 'none recorded'}</dd>
        <dt>Version</dt><dd>{r.version}{r.duplicates.length ? ` · ${r.duplicates.length} repeated row${r.duplicates.length > 1 ? 's' : ''} folded in` : ''}</dd>
      </dl>
      {f ? <FeatureDetail f={f} ledger={ledger} /> : null}
    </div>
  );
}

export function ShippedFeaturesPage() {
  const rt = useRuntime();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  const [view, setViewState] = useState<T.TableView>(loadTable);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const set = (p: Partial<T.TableView>) => setViewState((v) => { const n = T.normTableView({ ...v, ...p }); saveTable(n); return n; });

  const load = async () => { try { setLedger(await api.call<Ledger>('ledger')); setError(''); } catch (e) { setError((e as Error).message); } };
  const [focus, setFocus] = useState(() => { const u = focusFromUrl(); if (u) pendingFocus = u; return pendingFocus; });
  useEffect(() => { const on = () => setFocus(pendingFocus); window.addEventListener(FOCUS_EVENT, on); return () => window.removeEventListener(FOCUS_EVENT, on); }, []);
  useEffect(() => { const on = () => { if (pendingView) set(pendingView); pendingView = null; }; on(); window.addEventListener(VIEW_EVENT, on); return () => window.removeEventListener(VIEW_EVENT, on); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); const t = window.setInterval(() => { void load(); }, 60_000); return () => window.clearInterval(t); }, []);
  useEffect(() => { if (ledger?.meta?.importing || ledger?.meta?.syncing) { const t = window.setTimeout(() => { void load(); }, 5_000); return () => window.clearTimeout(t); } return undefined; }, [ledger]);

  const all = useMemo(() => (ledger ? T.toRows(ledger, ledger.manifests ?? []) : { rows: [], folded: 0 }), [ledger]);
  const plugins = useMemo(() => [...new Set(all.rows.map((r) => r.area))].sort(), [all]);
  const shown = useMemo(() => T.sortRows(T.filterRows(all.rows, view), view.sorts), [all, view]);
  const groups = useMemo(() => T.groupRows(shown, view.by), [shown, view.by]);
  useEffect(() => { shownRows.clear(); for (const r of all.rows) shownRows.set(r.id, r); }, [all]);
  // deep link (?shipped=<build or feature id>) and shipped-features.show: search it, open its group and rows
  useEffect(() => {
    if (!ledger || !focus) return;
    const id = focus.toLowerCase();
    const hits = all.rows.filter((r) => r.id === id || r.builds.includes(id) || `#${r.pr}` === id || String(r.pr) === id);
    const byBuild = hits.length && !hits.some((r) => r.id === id);
    set({ by: byBuild ? 'build' : view.by, search: byBuild ? id : hits[0]?.name ?? id, statuses: [], plugins: [], from: '', to: '', hasApi: false, notDeployed: false, collapsed: [], expanded: [...new Set([...view.expanded, ...hits.map((r) => r.id)])] });
    pendingFocus = ''; setFocus('');
  }, [ledger, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => { setBusy(true); try { await api.post('sync', {}); rt.toast('Syncing builds, PRs and deploys…', 'info'); window.setTimeout(() => { void load(); }, 4000); } catch (e) { rt.toast((e as Error).message, 'danger'); } finally { setBusy(false); } };
  const exportCsv = () => { void api.download(`table?kind=csv&view=${encodeURIComponent(JSON.stringify(view))}`, 'shipped-features.csv').catch((e: Error) => rt.toast(e.message, 'danger')); };

  if (!ledger && !error) return <LoadingSkeleton rows={6} label="Loading shipped features" />;
  if (!ledger) return <EmptyState icon="alert">{error}</EmptyState>;

  const onSort = (col: string | null, opts?: { add?: boolean }) => {
    if (!col) return set({ sorts: [] });
    const cur = view.sorts.find((s) => s.col === col);
    const flip = (s: T.SortKey): T.SortKey => ({ col, dir: s.dir === 'desc' ? 'asc' : 'desc' });
    if (opts?.add) return set({ sorts: cur ? view.sorts.map((s) => (s.col === col ? flip(s) : s)) : [...view.sorts, { col, dir: 'asc' }] });
    set({ sorts: [cur && view.sorts[0]?.col === col ? flip(cur) : { col, dir: col === 'shipped' || col === 'tests' || col === 'version' ? 'desc' : 'asc' }] });
  };
  const W = (n: number) => `calc(var(--fx-space) * ${n})`;
  const cell = (id: string) => (r: T.Row) => ({ target: CELL_TARGET, payload: `${r.id}|${id}` });
  const sv = (id: string) => (r: T.Row) => T.sortValue(r, id);
  const col = (id: string, width: string, render: (r: T.Row) => ReactNode, extra: Partial<GridColumn<T.Row>> = {}): GridColumn<T.Row> => ({ id, label: COL_LABEL[id] ?? id, width, sortable: true, sortValue: sv(id), render, cellCtx: cell(id), ...extra });
  const columns: GridColumn<T.Row>[] = [
    col('name', W(64), (r) => <span className="axp-shipped__name" title={r.name}>{r.name}</span>, { fixed: true, sub: (r) => r.description || r.asked || null }),
    col('area', W(30), (r) => <span className="axp-shipped__clip" title={r.area}>{r.area}</span>, { sub: (r) => L.TYPE_LABEL[r.type as L.FeatureType] ?? null }),
    col('description', W(56), (r) => <span className="axp-shipped__clip" title={r.description}>{r.description || '—'}</span>),
    col('status', W(24), (r) => <ShipBadge status={r.status} />),
    col('build', W(36), (r) => (r.build ? <a className="axp-shipped__clip" title={r.build} href={`?shipped=${encodeURIComponent(r.build)}`} onClick={(e) => { e.preventDefault(); focusShipped(r.build); }}>{r.build}</a> : '—'), { sub: (r) => (r.builds.length > 1 ? `+${r.builds.length - 1} more` : null), cellCtx: (r) => (r.build ? { target: 'axf-build-item', payload: r.build } : cell('build')(r)) }),
    col('pr', W(16), (r) => (r.pr ? <a href={r.prUrl} target="_blank" rel="noreferrer">#{r.pr}</a> : '—'), { sub: (r) => (r.prs.length > 1 ? `+${r.prs.length - 1}` : null) }),
    col('commit', W(20), (r) => (r.commit ? <code>{r.commit.slice(0, 9)}</code> : '—')),
    col('shipped', W(28), (r) => fmtDay(r.shipped, r.shippedGuessed), { sub: (r) => (r.shipped ? fmtHm(r.shipped) : null) }),
    col('onMain', W(18), (r) => <YesNo v={r.onMain} yes="Yes" no="No" />),
    col('deployed', W(20), (r) => <YesNo v={r.deployed} yes="Yes" no="No" />, { sub: (r) => (r.deployed ? Object.keys(r.liveAt).join(', ') : null) }),
    col('reach', W(26), (r) => (r.reach.length ? <span className="axp-shipped__reach">{r.reach.map((x) => <span key={x} title={T.REACH_LABEL[x]} aria-label={T.REACH_LABEL[x]}><Icon name={REACH_ICON[x]} /></span>)}</span> : <span className="fx-muted">UI only</span>)),
    col('settings', W(40), (r) => (r.settings ? <code className="axp-shipped__clip">{r.settings}</code> : '—')),
    col('help', W(14), (r) => (r.help ? <a href={r.help} target="_blank" rel="noreferrer">Help</a> : '—')),
    col('version', W(14), (r) => r.version),
    col('asked', W(56), (r) => (r.asked ? <span className="axp-shipped__clip" title={r.asked}>“{r.asked}”</span> : '—')),
    col('tests', W(16), (r) => (r.tests.total ? <Chip tone={r.tests.pass === r.tests.total ? 'success' : 'warning'}>{r.tests.pass}/{r.tests.total}</Chip> : '—')),
  ];
  const single = groups.length < 2 || view.by === 'none';
  const gridGroups: GridGroup<T.Row>[] = groups.map((g) => ({
    id: `g:${g.key}`, title: g.title, rows: g.rows, groups: [], collapsed: !single && view.collapsed.includes(`g:${g.key}`), fixed: true,
    counts: <span className="axp-shipped__counts">{g.count} · {T.SHIP_STATUSES.filter((s) => g.counts[s]).map((s) => `${g.counts[s]} ${T.SHIP_STATUS_LABEL[s].toLowerCase()}`).join(' · ')}</span>,
  }));
  const toggleGroup = (id: string) => set({ collapsed: view.collapsed.includes(id) ? view.collapsed.filter((x) => x !== id) : [...view.collapsed, id] });
  const toggleRow = (id: string) => set({ expanded: view.expanded.includes(id) ? view.expanded.filter((x) => x !== id) : [...view.expanded, id] });
  const m = ledger.meta ?? {};
  return (
    <div className="fx-stack axp-shipped">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AmberX-AXF + axHub · {shown.length} of {all.rows.length} features{all.folded ? ` · ${all.folded} repeated rows folded` : ''} · {shown.filter((r) => r.status === 'live').length} live · {shown.filter((r) => !r.deployed).length} not deployed{m.syncing ? ' · syncing…' : ''}{m.importing ? ' · importing history…' : ''}</p>
          <h1>Shipped features</h1>
        </div>
        <div className="axp-shipped__actions" role="toolbar" aria-label="Shipped features actions">
          <Button icon="refresh" disabled={busy || m.syncing} onClick={() => void sync()} title="Pick up new build events, merged PRs and deploys now">Sync</Button>
          <Button icon="sliders" aria-pressed={picker} onClick={() => setPicker((x) => !x)} title="Show, hide and reorder columns">Columns</Button>
          <Button icon="download" onClick={exportCsv} title="The rows and columns you see, as CSV">Export CSV</Button>
        </div>
      </header>
      {m.error ? <p className="axp-shipped__warn" role="status"><Icon name="alert" /> Last sync failed: {m.error}</p> : null}
      <div className="axp-shipped__bar" role="toolbar" aria-label="Shipped features view">
        <TextField label="Search" type="search" placeholder="Name, area, build, PR #, commit, Brett's words…" value={view.search} onChange={(search) => set({ search })} />
        <Segmented size="sm" label="Group by" value={view.by} onChange={(by) => set({ by, collapsed: [] })} options={T.GROUP_BY.map((g) => ({ value: g, label: T.GROUP_LABEL[g] }))} />
        <span className="axp-shipped__count" role="status">{shown.length} row{shown.length === 1 ? '' : 's'}{view.sorts.length ? ` · sorted by ${view.sorts.map((s) => `${COL_LABEL[s.col]} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', then ')}` : ''}</span>
      </div>
      <TableFilters view={view} set={set} plugins={plugins} />
      {picker ? <ColumnPicker view={view} set={set} close={() => setPicker(false)} /> : null}
      {m.empty ? <EmptyState icon="clock">Building the ledger from history (builds journal, merged PRs, early commits)… this takes a minute the first time.</EmptyState> : (
        <DataGrid<T.Row>
          id="shipped-features" label="Shipped features" groups={gridGroups} columns={columns} rowId={(r) => r.id} rowLabel={(r) => r.name}
          hidden={view.hidden} order={view.order}
          onToggleColumn={(c, show) => set({ hidden: show === false || (show === undefined && !view.hidden.includes(c)) ? [...view.hidden, c] : view.hidden.filter((x) => x !== c) })}
          onShowAll={() => set({ hidden: [] })} onChooseColumns={() => setPicker(true)}
          sorts={view.sorts.map((s) => ({ col: s.col, dir: s.dir === 'asc' ? 1 : -1 }))} onSort={onSort}
          expanded={view.expanded} onToggleExpand={toggleRow} onToggleGroup={toggleGroup}
          renderDetail={(r) => <RowDetail r={r} ledger={ledger} />}
          rowTone={(r) => ({ live: 'success', switch: 'accent', partial: 'warning', pending: 'info', removed: 'danger' } as Record<string, string>)[r.status] ?? 'muted'}
          rowCtx={(r) => ({ target: ROW_TARGET, payload: r.id })}
          empty={<EmptyState icon="search" compact>No feature matches these filters.</EmptyState>}
        />
      )}
    </div>
  );
}
