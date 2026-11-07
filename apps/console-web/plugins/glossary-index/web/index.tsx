/**
 * Glossary & Index console plugin (ai.amberx.axf.console.glossary).
 *
 * One page with three views of the same catalog (glossary-catalog@1, built on the server by catalog.mjs from the
 * plugin manifests, help entries, framework assets, asset types, CLI tools, build options, the feature tracker and the
 * UI registry):
 *  - Glossary: A–Z definitions with a letter strip, like the glossary at the back of a manual
 *  - Index: a categorized tree (Plugins › Build manager › Controls …), like a book's index, each heading with a count
 *  - Grid: every entry in a sortable grid grouped by kind
 * Search (every word must match), a kind filter, sort, "only undescribed" and drafts switches work in every view. The
 * detail panel shows what an entry is, what it does, where it appears, its API (REST, MCP, CLI), what it links to and
 * what links to it; links jump to that entry.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { DataGrid, type GridColumn, type GridSort } from '@console/axf/libs/datagrid';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './glossary-index.css';
import { KEYS, PAGE_SIZES, SORTS, VIEWS, apiGroups, byKind, byLetter, filterEntries, indexTree, plural, sortEntries, type Catalog, type Entry, type IndexNode, type SortBy, type View } from './core';
import { appMenu } from './menu';

const FOLDER = 'glossary-index';
const ID = 'ai.amberx.axf.console.glossary-index';
const api = pluginApi(FOLDER, 'Glossary & Index');

/* ---------------- store: the catalog, loaded once per page visit ---------------- */

interface State { cat: Catalog | null; error: string; loading: boolean }
let st: State = { cat: null, error: '', loading: false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useCatalog = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);

async function load(force = false) {
  if (st.loading || (st.cat && !force)) return;
  set({ loading: true, error: '' });
  try { set({ cat: await api.call<Catalog>('catalog'), loading: false }); } catch (e) { set({ error: (e as Error).message, loading: false }); }
}
async function rebuild(): Promise<string> {
  const r = await api.post('rebuild', { reason: 'console' }) as { wrote?: boolean; total?: number; diff?: { added: number; changed: number; removed: number } };
  await load(true);
  return r.wrote ? `Rebuilt: ${plural(r.total ?? 0, 'entry', 'entries')} (+${r.diff?.added ?? 0} new, ${r.diff?.changed ?? 0} changed, ${r.diff?.removed ?? 0} gone).` : 'Already up to date.';
}

/* ---------------- small helpers ---------------- */

function useSetting<T extends string | boolean>(key: string, fallback: T): [T, (v: T) => void] {
  const rt = useRuntime();
  const [, tick] = useState(0);
  useEffect(() => rt.settings.onChange(key, () => tick((t) => t + 1)), [rt, key]);
  const raw = rt.settings.get(key);
  const v = (raw === undefined || raw === null || raw === '' ? fallback : raw) as T;
  return [v, (next: T) => rt.settings.set(key, next)];
}

function KindChip({ kind, kinds }: { kind: string; kinds: Record<string, string> }) {
  return <span className="axp-glossary-index__kind" data-kind={kind}>{kinds[kind] ?? kind}</span>;
}

/* ---------------- detail ---------------- */

function Detail({ entry, cat, onOpen }: { entry: Entry; cat: Catalog; onOpen: (id: string) => void }) {
  const byId = useMemo(() => new Map(cat.entries.map((e) => [e.id, e])), [cat]);
  const linkedFrom = useMemo(() => cat.entries.filter((e) => e.related?.includes(entry.id)).map((e) => e.id), [cat, entry.id]);
  const [copied, setCopied] = useState(false);
  const link = (id: string) => {
    const e = byId.get(id);
    return e ? <li key={id}><button type="button" data-fx-row className="axp-glossary-index__link" onClick={() => onOpen(id)}>{e.term}</button> <KindChip kind={e.kind} kinds={cat.kinds} /></li> : null;
  };
  const children = (entry.children ?? []).filter((id) => byId.has(id));
  return (
    <article className="axp-glossary-index__detail" aria-label={`About ${entry.term}`}>
      <header className="axp-glossary-index__detail-head">
        <KindChip kind={entry.kind} kinds={cat.kinds} />
        <h2>{entry.term}</h2>
        <p className="fx-muted axp-glossary-index__crumb">{entry.category.split('›').map((s) => s.trim()).join(' › ')}</p>
      </header>
      <p className="axp-glossary-index__summary">{entry.summary}</p>
      {entry.detail && <p className="axp-glossary-index__more">{entry.detail}</p>}
      {entry.generic && <p className="fx-muted axp-glossary-index__note"><Icon name="info" size={12} /> No description of its own yet: this summary is generated. Add one where it is defined.</p>}
      {entry.draft && <p className="fx-muted axp-glossary-index__note"><Icon name="edit" size={12} /> Draft help text, not reviewed yet.</p>}
      <dl className="axp-glossary-index__facts">
        {entry.app && <><dt>Appears in</dt><dd>{[entry.app, ...(entry.where ?? []).filter((w) => w !== entry.app)].join(', ')}</dd></>}
        {entry.plugin && <><dt>Plugin</dt><dd><button type="button" data-fx-row className="axp-glossary-index__link" onClick={() => onOpen(`plugin:${entry.plugin}`)}>{byId.get(`plugin:${entry.plugin}`)?.term ?? entry.plugin}</button></dd></>}
        {entry.source && <><dt>Defined in</dt><dd className="fx-mono">{entry.source}</dd></>}
        <dt>Id</dt><dd className="fx-mono">{entry.id}</dd>
      </dl>
      {apiGroups(entry.api).map((g) => (
        <section key={g.kind} className="axp-glossary-index__api">
          <h3>{g.label}</h3>
          <ul>{g.names.map((n) => <li key={n} className="fx-mono">{n}</li>)}</ul>
        </section>
      ))}
      {!!entry.related?.length && <section><h3>See also</h3><ul className="axp-glossary-index__links">{entry.related.map(link)}</ul></section>}
      {!!linkedFrom.length && <section><h3>Mentioned by</h3><ul className="axp-glossary-index__links">{linkedFrom.slice(0, 40).map(link)}</ul></section>}
      {!!children.length && <section><h3>Contains ({children.length})</h3><ul className="axp-glossary-index__links">{children.slice(0, 80).map(link)}</ul></section>}
      {!!entry.keywords.length && <p className="axp-glossary-index__keywords">{entry.keywords.map((k) => <Chip key={k}>{k}</Chip>)}</p>}
      <div className="axp-glossary-index__detail-actions">
        <Button size="sm" icon="copy" onClick={() => { void navigator.clipboard?.writeText(entry.id); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy entry id'}</Button>
      </div>
    </article>
  );
}

/* ---------------- views ---------------- */

function GlossaryList({ entries, cat, selected, onSelect, limit }: { entries: Entry[]; cat: Catalog; selected: string; onSelect: (id: string) => void; limit: number }) {
  const shown = entries.slice(0, limit);
  const letters = byLetter(shown);
  const jump = (l: string) => document.getElementById(`axp-glossary-index-letter-${l}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <div className="axp-glossary-index__glossary">
      <nav className="axp-glossary-index__letters" aria-label="Jump to a letter" data-axf-not-nav="letter jump strip inside the glossary list (a pager)">
        {letters.map((g) => <button key={g.letter} type="button" data-fx-row className="axp-glossary-index__letter" onClick={() => jump(g.letter)}>{g.letter}</button>)}
      </nav>
      {letters.map((g) => (
        <section key={g.letter} id={`axp-glossary-index-letter-${g.letter}`} className="axp-glossary-index__letter-group" aria-label={`Letter ${g.letter}`}>
          <h2 className="axp-glossary-index__letter-head">{g.letter}</h2>
          <dl className="axp-glossary-index__terms">
            {g.entries.map((e) => (
              <div key={e.id} className={`axp-glossary-index__term${selected === e.id ? ' is-selected' : ''}`}>
                <dt><button type="button" data-fx-row className="axp-glossary-index__term-btn" onClick={() => onSelect(e.id)}>{e.term}</button> <KindChip kind={e.kind} kinds={cat.kinds} /></dt>
                <dd>{e.summary}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function IndexBranch({ node, depth, selected, onSelect, open, toggle }: { node: IndexNode; depth: number; selected: string; onSelect: (id: string) => void; open: Set<string>; toggle: (k: string) => void }) {
  const isOpen = open.has(node.key);
  return (
    <li className="axp-glossary-index__ix-node" data-depth={depth}>
      <button type="button" data-fx-row className="axp-glossary-index__ix-head" aria-expanded={isOpen} onClick={() => toggle(node.key)}>
        <Icon name={isOpen ? 'minus' : 'plus'} size={12} /> <span>{node.label}</span> <span className="axp-glossary-index__count">{node.count}</span>
      </button>
      {isOpen && (
        <ul className="axp-glossary-index__ix-children">
          {node.children.map((c) => <IndexBranch key={c.key} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} open={open} toggle={toggle} />)}
          {node.entries.map((e) => (
            <li key={e.id} className={`axp-glossary-index__ix-entry${selected === e.id ? ' is-selected' : ''}`}>
              <button type="button" data-fx-row className="axp-glossary-index__term-btn" onClick={() => onSelect(e.id)}>{e.term}</button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function IndexTree({ entries, selected, onSelect, searching }: { entries: Entry[]; selected: string; onSelect: (id: string) => void; searching: boolean }) {
  const tree = useMemo(() => indexTree(entries), [entries]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // while searching, open the whole (small) result tree so the hits are visible
  const all = useMemo(() => { const s = new Set<string>(); const walk = (n: IndexNode[]) => n.forEach((x) => { s.add(x.key); walk(x.children); }); walk(tree); return s; }, [tree]);
  const shownOpen = searching && entries.length <= 300 ? all : open;
  const toggle = (k: string) => setOpen((o) => { const n = new Set(searching && entries.length <= 300 ? all : o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="axp-glossary-index__index">
      <div className="axp-glossary-index__index-tools" role="toolbar" aria-label="Index tools">
        <Button size="sm" icon="plus" onClick={() => setOpen(new Set(all))}>Expand all</Button>
        <Button size="sm" icon="minus" onClick={() => setOpen(new Set())}>Collapse all</Button>
      </div>
      <ul className="axp-glossary-index__ix-root" aria-label="Index">
        {tree.map((n) => <IndexBranch key={n.key} node={n} depth={0} selected={selected} onSelect={onSelect} open={shownOpen} toggle={toggle} />)}
      </ul>
    </div>
  );
}

function Grid({ entries, cat, selected, onSelect, limit }: { entries: Entry[]; cat: Catalog; selected: string; onSelect: (id: string) => void; limit: number }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<GridSort>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(Object.keys(cat.kinds).filter((k) => k !== 'concept' && k !== 'plugin')));
  const columns: GridColumn<Entry>[] = [
    { id: 'term', label: 'Term', width: 'minmax(0, 3fr)', fixed: true, sortable: true, sortValue: (e) => e.term.toLowerCase(), render: (e) => <span className="axp-glossary-index__cell axp-glossary-index__cell--term">{e.term}</span> },
    { id: 'kind', label: 'Kind', width: 'minmax(0, 1fr)', sortable: true, sortValue: (e) => e.kind, render: (e) => <span className="axp-glossary-index__cell axp-glossary-index__cell--kind"><KindChip kind={e.kind} kinds={cat.kinds} /></span> },
    { id: 'category', label: 'Category', width: 'minmax(0, 2fr)', sortable: true, sortValue: (e) => e.category, render: (e) => <span className="axp-glossary-index__cell axp-glossary-index__cell--category fx-muted">{e.category}</span> },
    { id: 'summary', label: 'Summary', width: 'minmax(0, 4fr)', render: (e) => <span className="axp-glossary-index__cell axp-glossary-index__cell--summary fx-muted">{e.summary}</span> },
  ];
  // every kind is a group with its full count; each draws up to `limit` rows (Show more raises it)
  const groups = byKind(entries, cat.kinds).map((g) => ({ id: g.kind, title: `${g.label} (${g.entries.length.toLocaleString()})`, rows: g.entries.slice(0, limit), groups: [], collapsed: collapsed.has(g.kind) }));
  return (
    <DataGrid<Entry>
      id="glossary.grid" label="Glossary entries" groups={groups} columns={columns} rowId={(e) => e.id} rowLabel={(e) => e.term}
      hidden={hidden} onToggleColumn={(c) => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))} onShowAll={() => setHidden([])}
      sort={sort} onSort={(c) => setSort((s) => (!c ? null : s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}
      onToggleGroup={(id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
      selected={selected || null} onRowClick={(e) => onSelect(e.id)} rowTone={(e) => (e.generic ? 'warning' : e.draft ? 'muted' : 'accent')}
      empty={<EmptyState compact icon="search">Nothing matches.</EmptyState>}
    />
  );
}

/* ---------------- page ---------------- */

function GlossaryPage() {
  const { cat, error, loading } = useCatalog();
  useEffect(() => { void load(); }, []);
  const [view, setView] = useSetting<View>(KEYS.view, 'glossary');
  const [sort, setSort] = useSetting<SortBy>(KEYS.sort, 'az');
  const [kind, setKind] = useSetting<string>(KEYS.kind, '');
  const [drafts, setDrafts] = useSetting<boolean>(KEYS.drafts, true);
  const [pageSize] = useSetting<string>(KEYS.limit, '250');
  const [q, setQ] = useState('');
  const [undescribed, setUndescribed] = useState(false);
  const [selected, setSelected] = useState('');
  const [limit, setLimit] = useState(Number(pageSize) || 250);
  useEffect(() => setLimit(Number(pageSize) || 250), [pageSize, q, kind, view]);

  const results = useMemo(() => {
    if (!cat) return [];
    const hits = filterEntries(cat.entries, { q, kind, drafts, undescribed });
    return q.trim() ? hits : sortEntries(hits, sort, cat.kinds);
  }, [cat, q, kind, drafts, undescribed, sort]);
  const entry = useMemo(() => cat?.entries.find((e) => e.id === selected) ?? null, [cat, selected]);
  const biggestKind = useMemo(() => { const n: Record<string, number> = {}; for (const e of results) n[e.kind] = (n[e.kind] ?? 0) + 1; return Math.max(0, ...Object.values(n)); }, [results]);
  const open = (id: string) => { setSelected(id); document.querySelector('.axp-glossary-index__detail')?.scrollIntoView({ block: 'nearest' }); };

  const kindOptions = cat ? Object.entries(cat.kinds).filter(([k]) => cat.counts[k]).map(([value, label]) => ({ value, label: `${label} (${cat.counts[value]})` })) : [];
  return (
    <div className="fx-stack fx-stack--lg axp-glossary-index">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Help · reference{cat ? ` · ${cat.total.toLocaleString()} entries` : ''}</p>
          <h1>Glossary & Index</h1>
          <p className="fx-muted">Everything in AmberX AXF in one place: every plugin, feature, screen, control, setting, command, asset and tool, defined, indexed and linked.</p>
        </div>
      </header>

      <div className="axp-glossary-index__bar">
        <TextField label="Search" value={q} onChange={setQ} placeholder="Search terms, summaries and keywords" className="axp-glossary-index__search" />
        <SelectField label="Kind" value={kind} onChange={setKind} empty="Every kind" options={kindOptions} />
        <SelectField label="Sort" value={sort} onChange={(v) => setSort(v as SortBy)} options={SORTS} />
        <Switch label="Drafts" checked={drafts} onChange={setDrafts} hint="Show help entries still marked draft" />
        <Switch label="Only undescribed" checked={undescribed} onChange={setUndescribed} hint="Only entries whose source has no description of its own" />
      </div>

      <TabGroup<View> id="glossary.views" label="Glossary views" value={view} onChange={setView}
        tabs={VIEWS.map((v) => ({ value: v.value, label: v.label, icon: v.icon }))}
        extra={cat ? <span className="fx-muted axp-glossary-index__found">{plural(results.length, 'match', 'matches')}</span> : null}>
        {error ? <EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => void load(true) }}>{error}</EmptyState>
          : !cat || loading ? <LoadingSkeleton rows={8} label="Loading the glossary" />
          : (
            <div className="axp-glossary-index__body" data-has-detail={entry ? 'on' : 'off'}>
              <div className="axp-glossary-index__main">
                {!results.length ? <EmptyState icon="search">Nothing matches. Try fewer words or every kind.</EmptyState>
                  : view === 'glossary' ? <GlossaryList entries={results} cat={cat} selected={selected} onSelect={open} limit={limit} />
                  : view === 'index' ? <IndexTree entries={results} selected={selected} onSelect={open} searching={!!q.trim() || !!kind || undescribed} />
                  : <Grid entries={results} cat={cat} selected={selected} onSelect={open} limit={limit} />}
                {(view === 'glossary' ? results.length > limit : view === 'grid' && biggestKind > limit) && (
                  <div className="axp-glossary-index__more-row">
                    <span className="fx-muted">{view === 'grid' ? `Showing up to ${limit.toLocaleString()} per kind.` : `Showing ${limit.toLocaleString()} of ${results.length.toLocaleString()}.`}</span>
                    <Button size="sm" icon="plus" onClick={() => setLimit((l) => l + (Number(pageSize) || 250))}>Show more</Button>
                  </div>
                )}
              </div>
              {entry && (
                <aside className="axp-glossary-index__side">
                  <div className="axp-glossary-index__side-tools" data-axf-not-toolbar="one close button above the details"><Button size="sm" icon="x" onClick={() => setSelected('')}>Close details</Button></div>
                  <Detail entry={entry} cat={cat} onOpen={open} />
                </aside>
              )}
            </div>
          )}
      </TabGroup>
    </div>
  );
}

/* ---------------- settings ---------------- */

function CatalogPanel() {
  const { cat } = useCatalog();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void load(); }, []);
  return (
    <div className="fx-stack">
      <p className="fx-muted">{cat ? `${cat.total.toLocaleString()} entries, built ${new Date(cat.generatedAt).toLocaleString()}; ${cat.generic.toLocaleString()} without a description of their own.` : 'Not loaded yet.'}</p>
      {cat && <ul className="axp-glossary-index__counts">{Object.entries(cat.counts).map(([k, n]) => <li key={k}><KindChip kind={k} kinds={cat.kinds} /> {n.toLocaleString()}</li>)}</ul>}
      <div><Button icon="refresh" busy={busy} onClick={() => { setBusy(true); rebuild().then(setMsg, (e: Error) => setMsg(e.message)).finally(() => setBusy(false)); }}>Rebuild now</Button></div>
      {msg && <p className="fx-muted" role="status">{msg}</p>}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Glossary & Index',
  version: '0.1.0',
  appMenu,
  builtWith: { model: 'opus', builtAt: '2026-11-07' },
  views: { 'glossary-index': { title: 'Glossary & Index', icon: 'list', render: () => <GlossaryPage /> } },
  nav: { label: 'Plugins', items: [{ id: 'glossary-index', label: 'Glossary & Index', icon: 'list', view: 'glossary-index' }] },
  settingsTabs: [{ id: 'glossary-index', label: 'Glossary & Index', icon: 'list', order: 92, parent: 'plugins' }],
  settings: [{
    id: 'glossary-index.display', label: 'Display', icon: 'eye', tab: FOLDER, order: 10,
    settings: [
      { key: KEYS.view, label: 'Open in', kind: 'choice', default: 'glossary', options: VIEWS.map((v) => ({ value: v.value, label: v.label })), description: 'Which view the Glossary & Index page opens in: the A–Z glossary, the categorized index or the grid.' },
      { key: KEYS.sort, label: 'Sort entries', kind: 'choice', default: 'az', options: SORTS.map((s) => ({ value: s.value, label: s.label })), description: 'How entries are ordered when nothing is searched (a search always puts the best matches first).' },
      { key: KEYS.limit, label: 'Entries per page', kind: 'choice', default: '250', options: PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) })), description: 'How many entries the glossary and the grid draw before Show more.' },
      { key: KEYS.drafts, label: 'Show draft help entries', kind: 'toggle', default: true, description: 'Include controls whose help text is still a draft (generated from the code, not reviewed yet).' },
    ],
  }],
  settingsPanels: [
    { id: 'glossary-index.catalog', tab: 'glossary-index', title: 'Catalog', icon: 'list', order: 20, render: () => <CatalogPanel /> },
    { id: 'glossary-index.lifecycle', tab: 'glossary-index', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
