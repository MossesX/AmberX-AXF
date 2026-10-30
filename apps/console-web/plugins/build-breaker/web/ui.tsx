import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Icon, IconButton, ModelBadge, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { registerRowRefTarget, rowHooks, useDataset, useDatasetsRevision } from '@console/axf/libs/datagrid';
import * as bb from './bb-core.mjs';
import type { Ask, Doc, Section } from './bb-core.mjs';
import './build-breaker.css';

/*
 * Build Breaker page (build-asks@1): everything Brett asked for, one line per ask. Tabs All · Apps · Plugins · Timeline;
 * a collapsible container of per-app grids and one of per-plugin grids (All shows each ask once: plugin asks sit under
 * Plugins), and a flat timeline. A row opens to the plain description, his own words, sources, branch / PR links and
 * the row hooks of the build it stands for (grid-hook@1: the feature matrix, when that plugin is on).
 */

export const FOLDER = 'build-breaker';
export const VIEW = 'build-breaker';
export const ASK_TARGET = 'axp-build-breaker-ask';
export const KEYS = { tab: 'build-breaker.tab', sort: 'build-breaker.sort', range: 'build-breaker.range' } as const;
const api = pluginApi(FOLDER, 'Build Breaker', { unavailable: 'Build Breaker is switched off or its server part is not running.' });

type Tab = 'all' | 'apps' | 'plugins' | 'timeline';
type Res = { ok: boolean; error?: string; doc?: Doc; files?: { seed: string; mirror: string; mirrorFound: boolean } };

/** Asks by id, for the right-click → row hooks lookup (the grids draw rows that aren't a DataGrid). */
const byId = new Map<string, Ask>();
/** App and plugin ids → their plain names (from the asks file). */
const names = new Map<string, string>();
registerRowRefTarget(ASK_TARGET, (id) => { const a = byId.get(id); return a ? bb.refFor(a) : null; });

const setting = (rt: ReturnType<typeof useRuntime>, k: string, d: string) => { try { const v = rt.settings.get(k); return typeof v === 'string' && v ? v : d; } catch { return d; } };
const dateOf = (a: Ask) => { const t = bb.askTime(a); return t ? new Date(t) : null; };
const fmtDay = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
const fmtClock = (d: Date | null) => (d ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const fmtFull = (d: Date | null) => (d ? d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'unknown');
const fmtDayHead = (key: string) => { const d = new Date(`${key}T12:00:00`); return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
const sum = (asks: Ask[]) => { const t = bb.totals(asks); return [bb.fmtMinutes(t.minutes), bb.fmtCost(t.cost, { whole: true })].filter(Boolean).join(' · '); };

/** The Builds pages' toolbar button (slot builds.toolbar). */
export function OpenBreakerButton() {
  const rt = useRuntime();
  return <Button icon="hammer" className="axp-build-breaker__open" aria-label="Build Breaker" onClick={() => rt.navigate(VIEW)} title="Everything Brett asked for, one line each">Build Breaker</Button>;
}

export function BuildBreakerPage() {
  const rt = useRuntime();
  const [res, setRes] = useState<Res | null>(null);
  const [tab, setTab] = useState<Tab>(() => setting(rt, KEYS.tab, 'all') as Tab);
  const [q, setQ] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [model, setModel] = useState('any');
  const [range, setRange] = useState(() => setting(rt, KEYS.range, 'all'));
  const [sort, setSort] = useState(() => setting(rt, KEYS.sort, 'newest'));
  const [group, setGroup] = useState('none');
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [grids, setGrids] = useState<Record<string, boolean>>({});
  const [gridDefault, setGridDefault] = useState(false);

  const load = async () => {
    try { const r = await api.call<Res>('asks'); if (!r.ok || !r.doc) throw new Error(r.error || 'no data'); setRes(r); }
    catch (e) { setRes({ ok: false, error: (e as Error).message }); }
  };
  useEffect(() => { void load(); }, []);

  const doc = res?.doc;
  const all = useMemo(() => doc?.asks ?? [], [doc]);
  useEffect(() => { byId.clear(); for (const a of all) byId.set(a.id, a); }, [all]);
  useMemo(() => { names.clear(); for (const o of [...(doc?.apps ?? []), ...(doc?.plugins ?? [])]) names.set(o.id, o.name); }, [doc]);
  const fields = useMemo(() => [
    { id: 'title', label: 'Ask', value: (a: Ask) => a.title }, { id: 'app', label: 'App', value: (a: Ask) => a.app },
    { id: 'plugin', label: 'Plugin', value: (a: Ask) => a.plugin ?? '' }, { id: 'askedAt', label: 'Asked', kind: 'date' as const, value: (a: Ask) => a.askedAt },
    { id: 'status', label: 'Status', kind: 'choice' as const, value: (a: Ask) => bb.normStatus(a.status) }, { id: 'model', label: 'Model', kind: 'choice' as const, value: (a: Ask) => bb.normModel(a.model) },
    { id: 'minutes', label: 'Build time', kind: 'number' as const, value: (a: Ask) => a.minutes ?? null }, { id: 'costUsd', label: 'Cost', kind: 'number' as const, value: (a: Ask) => a.costUsd ?? null },
  ], []);
  // a dataset other plugins can attach to (filters, sorts), like every grid
  const attached = useDataset<Ask>({ id: VIEW, label: 'Build Breaker asks', fields, rows: all, rowText: bb.searchText });
  const shown = useMemo(() => bb.sortAsks(bb.filterAsks(attached, { q, statuses, models: model === 'any' ? [] : [model], range }), sort), [attached, q, statuses, model, range, sort]);
  const t = useMemo(() => bb.totals(shown), [shown]);
  const tAll = useMemo(() => bb.totals(all), [all]);
  const filtering = !!(q || statuses.length || model !== 'any' || range !== 'all' || attached !== all);

  if (!res) return <div className="fx-stack axp-build-breaker"><Head /><LoadingSkeleton rows={8} label="Loading every ask" /></div>;
  if (!doc) return <div className="fx-stack axp-build-breaker"><Head /><EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => { setRes(null); void load(); } }}>{res.error || 'The asks could not be read.'}</EmptyState></div>;

  const apps = bb.sections(doc, tab === 'all' ? shown.filter((a) => !a.plugin) : shown, 'app');
  const plugins = bb.sections(doc, shown, 'plugin');
  const gridOpen = (id: string) => grids[id] ?? (gridDefault || !!q);
  const toggleGrid = (id: string) => setGrids((g) => ({ ...g, [id]: !gridOpen(id) }));
  const toggleRow = (id: string) => setOpenRows((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const expandAll = () => { setGridDefault(true); setGrids({}); setOpenRows(new Set(shown.map((a) => a.id))); };
  const collapseAll = () => { setGridDefault(false); setGrids({}); setOpenRows(new Set()); };
  const toggleStatus = (s: string) => setStatuses((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  const resetFilters = () => { setQ(''); setStatuses([]); setModel('any'); setRange('all'); };
  const statusList = bb.STATUSES.filter((s) => (tAll.statuses[s.id] ?? 0) > 0 || statuses.includes(s.id));
  const models = bb.MODELS.filter((m) => tAll.models[m]);
  const rowProps = { openRows, toggleRow, group };
  const TABS: { id: Tab; label: string; icon: string; n: number }[] = [
    { id: 'all', label: 'All', icon: 'list', n: shown.length }, { id: 'apps', label: 'Apps', icon: 'grid', n: apps.length },
    { id: 'plugins', label: 'Plugins', icon: 'package', n: plugins.length }, { id: 'timeline', label: 'Timeline', icon: 'clock', n: shown.length },
  ];

  return (
    <div className="fx-stack axp-build-breaker">
      <Head doc={doc} />
      <TotalsStrip t={t} filtered={filtering} of={all.length} />
      <div className="axp-build-breaker__bar">
        <div className="fx-tabs axp-build-breaker__tabs" role="tablist" aria-label="View">
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`fx-tab${tab === x.id ? ' is-active' : ''}`} onClick={() => setTab(x.id)}>
              <Icon name={x.icon} size={12} />{x.label}<span className="axp-build-breaker__n">{x.n}</span>
            </button>
          ))}
        </div>
        <div className="axp-build-breaker__tools" role="toolbar" aria-label="Filter and sort">
          <label className="fx-search axp-build-breaker__search">
            <Icon name="search" size={13} />
            <input type="search" placeholder="Search what you asked, in your words…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search asks" />
          </label>
          <label className="fx-search axp-build-breaker__sel" title="Date range">
            <Icon name="calendar" size={12} />
            <select aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value)}>{bb.RANGES.map((r) => <option key={r.id} value={r.id}>{r.id === 'all' ? 'All time' : r.label}</option>)}</select>
          </label>
          <label className="fx-search axp-build-breaker__sel" title="Model">
            <Icon name="sparkles" size={12} />
            <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}><option value="any">Any model</option>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          </label>
          <label className="fx-search axp-build-breaker__sel" title="Sort">
            <Icon name="list" size={12} />
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>{bb.SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </label>
          <label className="fx-search axp-build-breaker__sel" title="Group by">
            <Icon name="layers" size={12} />
            <select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value)}>{bb.GROUPS.map((g) => <option key={g.id} value={g.id}>{g.id === 'none' ? 'No grouping' : `By ${g.label.toLowerCase()}`}</option>)}</select>
          </label>
          <span className="axp-build-breaker__fold">
            <IconButton icon="chevron-down" label="Expand all" title="Open every grid and every row" onClick={expandAll} />
            <IconButton icon="chevron-up" label="Collapse all" title="Close every grid and row" onClick={collapseAll} />
            {filtering && <IconButton icon="x" label="Clear filters" onClick={resetFilters} />}
          </span>
        </div>
        <div className="axp-build-breaker__statuses" role="group" aria-label="Status filter (pick any)">
          {statusList.map((s) => {
            const on = statuses.includes(s.id);
            return <Button key={s.id} size="sm" tone={on ? 'primary' : 'quiet'} icon={s.icon} aria-pressed={on} onClick={() => toggleStatus(s.id)}>{s.label} <span className="axp-build-breaker__n">{tAll.statuses[s.id] ?? 0}</span></Button>;
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="search" action={filtering ? { label: 'Clear filters', icon: 'x', onClick: resetFilters } : undefined}>{filtering ? 'No asks match these filters.' : 'No asks recorded yet. Sessions add them with asks.mjs add.'}</EmptyState>
      ) : tab === 'timeline' ? (
        <Timeline asks={shown} sort={sort} {...rowProps} />
      ) : (
        <>
          {tab !== 'plugins' && (
            <Container collapsible icon="grid" className="axp-build-breaker__box" title={<BoxTitle label="Apps" n={apps.reduce((n, s) => n + s.asks.length, 0)} sub={tab === 'all' ? 'plugin asks are under Plugins' : ''} />}>
              {apps.length ? apps.map((s) => <AskGrid key={`app:${s.id}`} s={s} kind="app" open={gridOpen(`app:${s.id}`)} onToggle={() => toggleGrid(`app:${s.id}`)} {...rowProps} />) : <EmptyState icon="grid" compact>No app asks match.</EmptyState>}
            </Container>
          )}
          {tab !== 'apps' && (
            <Container collapsible icon="package" className="axp-build-breaker__box" title={<BoxTitle label="Plugins" n={plugins.reduce((n, s) => n + s.asks.length, 0)} sub="" />}>
              {plugins.length ? plugins.map((s) => <AskGrid key={`plugin:${s.id}`} s={s} kind="plugin" open={gridOpen(`plugin:${s.id}`)} onToggle={() => toggleGrid(`plugin:${s.id}`)} {...rowProps} />) : <EmptyState icon="package" compact>No plugin asks match.</EmptyState>}
            </Container>
          )}
        </>
      )}
    </div>
  );
}

function Head({ doc }: { doc?: Doc }) {
  const d = doc?.generatedAt ? new Date(doc.generatedAt) : null;
  return (
    <header className="fx-pagehead axp-build-breaker__head">
      <div>
        <p className="fx-eyebrow">Builds{d && !Number.isNaN(d.getTime()) ? ` · gathered ${fmtDay(d)}` : ''}</p>
        <h1>Build Breaker</h1>
        <p className="fx-muted axp-build-breaker__lede" title="Everything you've asked for, in plain English: what it is, when you asked, where it stands and what it cost.">Everything you've asked for, one line each.</p>
      </div>
    </header>
  );
}

function TotalsStrip({ t, filtered, of }: { t: bb.Totals; filtered: boolean; of: number }) {
  const models = Object.entries(t.models).sort((a, b) => b[1].cost - a[1].cost);
  return (
    <div className="axp-build-breaker__totals" role="list" aria-label="Totals">
      <span role="listitem" className="axp-build-breaker__stat is-lead"><b>{t.asks}</b>{filtered ? <span className="fx-muted"> of {of}</span> : null} asks</span>
      {bb.BUCKETS.filter((b) => t.buckets[b.id]).map((b) => <span role="listitem" key={b.id} className="axp-build-breaker__stat"><b>{t.buckets[b.id]}</b> {b.label}</span>)}
      <span className="axp-build-breaker__break" aria-hidden="true" />
      <span role="listitem" className="axp-build-breaker__stat"><Icon name="clock" size={12} /><b>{bb.fmtHours(t.minutes)}</b></span>
      <span role="listitem" className="axp-build-breaker__stat"><b>{bb.fmtCost(t.cost, { whole: true })}</b> <span className="fx-muted">est.</span></span>
      {models.map(([m, v]) => <span role="listitem" key={m} className="axp-build-breaker__stat" title={`${m}: ${v.asks} asks · ${bb.fmtHours(v.minutes)} · ${bb.fmtCost(v.cost, { whole: true })}`}><span className={`axp-build-breaker__mdot is-${m.toLowerCase()}`} aria-hidden="true" />{m} <b>{bb.fmtCost(v.cost, { whole: true })}</b></span>)}
    </div>
  );
}

function BoxTitle({ label, n, sub }: { label: string; n: number; sub: string }) {
  return <span className="axp-build-breaker__boxtitle">{label} <span className="axp-build-breaker__n">{n}</span>{sub ? <span className="fx-small fx-muted"> · {sub}</span> : null}</span>;
}

type RowProps = { openRows: Set<string>; toggleRow: (id: string) => void; group: string };

/** One app's or plugin's grid: a header with its count, time and cost; rows (sub-grouped by the group-by) under it. */
function AskGrid({ s, kind, open, onToggle, openRows, toggleRow, group }: { s: Section; kind: 'app' | 'plugin'; open: boolean; onToggle: () => void } & RowProps) {
  const t = bb.totals(s.asks);
  const built = t.buckets.built ?? 0;
  return (
    <section className={`axp-build-breaker__grid${open ? ' is-open' : ''}`} aria-label={s.name}>
      <button type="button" data-fx-row className="axp-build-breaker__ghead" aria-expanded={open} onClick={onToggle} title={s.plain || s.name}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className="axp-build-breaker__gname">{s.name}</span>
        <span className="axp-build-breaker__n">{s.asks.length}</span>
        <span className="axp-build-breaker__gsum">{built}/{s.asks.length} built{sum(s.asks) ? ` · ${sum(s.asks)}` : ''}</span>
      </button>
      {open && (
        <div className="axp-build-breaker__rows" role="list" aria-label={`${s.name} asks`}>
          {s.plain ? <p className="axp-build-breaker__gplain">{s.plain}</p> : null}
          <Rows asks={s.asks} group={group} openRows={openRows} toggleRow={toggleRow} hide={kind} />
        </div>
      )}
    </section>
  );
}

function Rows({ asks, group, openRows, toggleRow, hide }: RowProps & { asks: Ask[]; hide?: 'app' | 'plugin' }) {
  const groups = bb.groupAsks(asks, group);
  return (
    <>
      {groups.map((g) => (
        <Fragment key={g.id}>
          {group !== 'none' && <div className="axp-build-breaker__sub" role="presentation"><span className="axp-build-breaker__subname">{group === 'day' ? fmtDayHead(g.label) : g.label}</span><span className="axp-build-breaker__n">{g.asks.length}</span><span className="axp-build-breaker__gsum">{sum(g.asks)}</span></div>}
          {g.asks.map((a) => <AskRow key={a.id} a={a} open={openRows.has(a.id)} onToggle={() => toggleRow(a.id)} hide={hide} />)}
        </Fragment>
      ))}
    </>
  );
}

/** The flat list by date and time, a hairline day header between days. */
function Timeline({ asks, sort, group, openRows, toggleRow }: RowProps & { asks: Ask[]; sort: string }) {
  const byDay = group === 'none' && (sort === 'newest' || sort === 'oldest');
  return (
    <div className="axp-build-breaker__grid is-open is-timeline" role="list" aria-label="Every ask by date and time">
      <Rows asks={asks} group={byDay ? 'day' : group} openRows={openRows} toggleRow={toggleRow} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = bb.statusInfo(status);
  return <span className="axp-build-breaker__status" title={s.label}><Chip tone={s.tone || undefined}><Icon name={s.icon} size={11} /><span className="axp-build-breaker__slabel">{s.label}</span></Chip></span>;
}

function AskRow({ a, open, onToggle, hide }: { a: Ask; open: boolean; onToggle: () => void; hide?: 'app' | 'plugin' }) {
  const d = dateOf(a);
  const time = bb.fmtMinutes(a.minutes), cost = bb.fmtCost(a.costUsd);
  return (
    <div className={`axp-build-breaker__ask${open ? ' is-open' : ''}`} role="listitem" data-fx-ctx-target={ASK_TARGET} data-fx-ctx-payload={a.id}>
      <button type="button" data-fx-row className="axp-build-breaker__row" aria-expanded={open} onClick={onToggle} title={a.plain || a.title}>
        <span className="axp-build-breaker__title">{a.title}{hide === 'app' && a.plugin ? <span className="axp-build-breaker__tag"> · {names.get(a.plugin) ?? a.plugin}</span> : null}</span>
        <span className="axp-build-breaker__date">{a.timeApprox ? <span className="axp-build-breaker__approx" title="Approximate time">≈</span> : null}{fmtDay(d)}</span>
        <span className="axp-build-breaker__time">{fmtClock(d)}</span>
        <StatusBadge status={a.status} />
        <span className="axp-build-breaker__meta">
          <span className="axp-build-breaker__cost">{[time, cost].filter(Boolean).join(' · ') || '—'}</span>
          <ModelBadge model={bb.normModel(a.model) || null} compact />
        </span>
      </button>
      {open && <AskDetail a={a} />}
    </div>
  );
}

function AskDetail({ a }: { a: Ask }) {
  useDatasetsRevision(); // row hooks registered later redraw the buttons
  const ref = bb.refFor(a);
  const hooks = rowHooks(ref);
  const d = dateOf(a);
  const s = bb.statusInfo(a.status);
  const pr = bb.prUrl(a.pr), br = bb.branchUrl(a.branch);
  const facts: [string, React.ReactNode][] = [
    ['Status', <><Icon name={s.icon} size={12} /> {s.label}</>],
    ['Asked', <>{fmtFull(d)}{a.timeApprox ? <span className="fx-muted"> (approximate time)</span> : null}</>],
    ['Build time', bb.fmtMinutes(a.minutes) || '—'],
    ['Cost', a.costUsd != null ? <>{bb.fmtCost(a.costUsd)}{a.costEstimated ? <span className="fx-muted"> estimated</span> : null}</> : '—'],
    ['Model', <ModelBadge model={bb.normModel(a.model) || null} compact />],
    ['Profile', a.profile || '—'],
    ['App', names.get(a.app) ?? a.app],
    ...(a.plugin ? [['Plugin', names.get(a.plugin) ?? a.plugin] as [string, React.ReactNode]] : []),
    ...(a.branch ? [['Branch', br ? <a href={br} target="_blank" rel="noreferrer" className="fx-mono">{a.branch}</a> : a.branch] as [string, React.ReactNode]] : []),
    ...(a.pr ? [['Pull request', <a href={pr} target="_blank" rel="noreferrer">#{a.pr} on GitHub</a>] as [string, React.ReactNode]] : []),
    ...(a.note ? [['Note', a.note] as [string, React.ReactNode]] : []),
  ];
  return (
    <div className="axp-build-breaker__detail">
      {a.plain ? <p className="axp-build-breaker__plain">{a.plain}</p> : null}
      {a.quote ? <blockquote className="axp-build-breaker__quote"><p>{a.quote}</p><cite>Brett</cite></blockquote> : null}
      <dl className="axp-build-breaker__facts">
        {facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
      </dl>
      {a.sources?.length ? (
        <div className="axp-build-breaker__sources">
          <span className="axp-build-breaker__k">Sources</span>
          <ul>{a.sources.map((x, i) => { const l = bb.sourceLabel(x); return <li key={i}><span className="fx-muted">{l.kind}</span> {l.text}</li>; })}</ul>
        </div>
      ) : null}
      {(hooks.length > 0 || pr) && (
        <div className="axp-build-breaker__actions">
          {ref && hooks.map((h) => <Button key={h.id} size="sm" icon={h.icon ?? 'link'} onClick={() => h.run(ref, { dataset: VIEW })} title={`${h.label}: ${ref.kind} ${ref.id}`}>{h.label}</Button>)}
          {pr && <Button size="sm" icon="github" onClick={() => globalThis.open(pr, '_blank', 'noopener')}>PR #{a.pr}</Button>}
        </div>
      )}
    </div>
  );
}
