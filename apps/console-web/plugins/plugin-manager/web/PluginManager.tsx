/**
 * The Plugin Manager. Five views (cards, table, detail, dependency graph, install from the catalog) inside four layouts that are built
 * differently, not just recoloured: Studio (rail + drawer), Mission control (status tiles + signals column),
 * Terminal (monospace with a command line) and Catalog (store shelves + product page). Everything is theme tokens,
 * so every colour / style theme still applies to every layout.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Chip, Icon, useRuntime } from '@console/axf/react';
import { hasSettings, hasUi, openSettings, openUi, setEnabled } from './actions';
import { ConflictList, DetailPane, HealthChip, Monogram } from './Detail';
import { HEALTH_LABEL, loadLogs, useInventory, type Inventory, type PluginRow } from './model';
import { FILTERS, LAYOUTS, SORTS, usePrefs, VIEWS, type FilterId, type LayoutId, type Prefs, type SortId, type ViewId } from './prefs';
import { CardsView, GraphView, MasterDetailView, TableView, type ViewProps } from './views';
import { InstallView } from './InstallView';
import './plugin-manager.css';

const FILTER_LABEL: Record<FilterId, string> = { all: 'All', enabled: 'Running', off: 'Switched off', problems: 'Needs attention', editors: 'UI editors' };
const SORT_LABEL: Record<SortId, string> = { name: 'Name', health: 'Health', size: 'Size', deps: 'Most used' };
const HEALTH_RANK = { error: 0, blocked: 1, partial: 2, off: 3, ok: 4 } as const;

const matches = (r: PluginRow, f: FilterId) =>
  f === 'all' ? true : f === 'enabled' ? r.enabled : f === 'off' ? !r.enabled : f === 'editors' ? r.uiEditor.length > 0
    : r.health === 'error' || r.health === 'blocked' || r.health === 'partial' || r.conflicts.length > 0;

function useRows(inv: Inventory | null, prefs: Prefs, q: string) {
  return useMemo(() => {
    if (!inv) return [];
    const needle = q.trim().toLowerCase();
    const rows = inv.items.filter((r) => matches(r, prefs.filter) && (!needle || [r.name, r.id, r.folder, r.description, ...r.provides].some((s) => s.toLowerCase().includes(needle))));
    const by: Record<SortId, (a: PluginRow, b: PluginRow) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      health: (a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.name.localeCompare(b.name),
      size: (a, b) => b.code.bytes - a.code.bytes,
      deps: (a, b) => b.dependents.length - a.dependents.length || a.name.localeCompare(b.name),
    };
    return rows.sort(by[prefs.sort]);
  }, [inv, prefs.filter, prefs.sort, q]);
}

function ViewBody(p: ViewProps & { view: ViewId }) {
  if (p.view === 'table') return <TableView {...p} />;
  if (p.view === 'detail') return <MasterDetailView {...p} />;
  if (p.view === 'graph') return <GraphView {...p} />;
  if (p.view === 'install') return <InstallView {...p} />;
  return <CardsView {...p} />;
}

/* ---------------- shared controls ---------------- */

function Segmented<T extends string>({ items, value, onChange, label, iconsOnly }: { items: readonly { id: T; label: string; icon: string }[]; value: T; onChange: (v: T) => void; label: string; iconsOnly?: boolean }) {
  return (
    <div className="axp-plugin-manager-seg" role="radiogroup" aria-label={label}>
      {items.map((i) => (
        <button key={i.id} type="button" role="radio" aria-checked={value === i.id} title={i.label} className={`axp-plugin-manager-seg__opt ${value === i.id ? 'is-active' : ''}`} onClick={() => onChange(i.id)}>
          <Icon name={i.icon} size={14} />{!iconsOnly && <span>{i.label}</span>}
        </button>
      ))}
    </div>
  );
}

function Search({ q, setQ, placeholder }: { q: string; setQ: (s: string) => void; placeholder?: string }) {
  return (
    <label className="axp-plugin-manager-search">
      <Icon name="search" size={14} />
      <input className="axp-plugin-manager-search__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? 'Find a plugin, id or capability'} aria-label="Find a plugin" />
    </label>
  );
}

function SortSelect({ value, onChange }: { value: SortId; onChange: (v: SortId) => void }) {
  return (
    <select className="fx-input axp-plugin-manager-select" value={value} onChange={(e) => onChange(e.target.value as SortId)} aria-label="Sort">
      {SORTS.map((s) => <option key={s} value={s}>Sort: {SORT_LABEL[s]}</option>)}
    </select>
  );
}

/* ---------------- root ---------------- */

export function PluginManager({ embedded }: { embedded?: boolean }) {
  const { inv, loading, reload } = useInventory();
  const { prefs, set } = usePrefs();
  const [q, setQ] = useState('');
  const rows = useRows(inv, prefs, q);
  const select = (folder: string) => set('selected', folder);
  useEffect(() => {
    // Opened from a context menu or action with a plugin in mind (plugin-manager.select:<folder>).
    const on = (e: Event) => { const f = (e as CustomEvent<string>).detail; if (f) select(f); };
    globalThis.addEventListener('axp-plugin-manager:select', on);
    return () => globalThis.removeEventListener('axp-plugin-manager:select', on);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!inv) return <div className="axp-plugin-manager axp-plugin-manager--loading"><p className="fx-muted">Loading plugins…</p></div>;
  const shared = { inv, rows, prefs, set, q, setQ, reload, loading, select, embedded: Boolean(embedded) };
  const L = { studio: Studio, mission: Mission, terminal: Terminal, catalog: Catalog }[prefs.layout];
  return (
    <div className={`axp-plugin-manager axp-plugin-manager--${prefs.layout} ${embedded ? 'is-embedded' : ''}`} data-layout={prefs.layout} data-view={prefs.view}>
      <L {...shared} />
    </div>
  );
}

interface LayoutProps {
  inv: Inventory; rows: PluginRow[]; prefs: Prefs; set: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  q: string; setQ: (s: string) => void; reload: () => Promise<void>; loading: boolean; select: (f: string) => void; embedded: boolean;
}

const viewProps = (p: LayoutProps): ViewProps => ({ rows: p.rows, inv: p.inv, layout: p.prefs.layout, selected: p.prefs.selected, onSelect: p.select, onChanged: () => void p.reload() });
const selectedRow = (p: LayoutProps) => p.inv.items.find((r) => r.folder === p.prefs.selected);

function LayoutPicker({ p, iconsOnly }: { p: LayoutProps; iconsOnly?: boolean }) {
  return <Segmented label="Layout" items={LAYOUTS} value={p.prefs.layout} onChange={(v: LayoutId) => p.set('layout', v)} iconsOnly={iconsOnly} />;
}
function ViewPicker({ p, iconsOnly }: { p: LayoutProps; iconsOnly?: boolean }) {
  return <Segmented label="View" items={VIEWS} value={p.prefs.view} onChange={(v: ViewId) => p.set('view', v)} iconsOnly={iconsOnly} />;
}
function Offline({ inv }: { inv: Inventory }) {
  return inv.live ? null : <p className="axp-plugin-manager-offline"><Icon name="cloud" size={14} /> Console API offline: showing what's bundled. Enable/disable, logs, files and dependency checks need the API and the console token.</p>;
}

/* ---------------- 1. Studio: rail + main + drawer ---------------- */

function Studio(p: LayoutProps) {
  const sel = selectedRow(p);
  const drawer = sel && p.prefs.view !== 'detail';
  return (
    <div className={`axp-plugin-manager-studio ${drawer ? 'has-drawer' : ''}`}>
      <aside className="axp-plugin-manager-studio__rail">
        <p className="axp-plugin-manager-eyebrow">Plugin Manager</p>
        <h1 className="axp-plugin-manager-studio__title">Plugins</h1>
        <nav className="axp-plugin-manager-studio__filters" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`axp-plugin-manager-studio__filter ${p.prefs.filter === f ? 'is-active' : ''}`} onClick={() => p.set('filter', f)}>
              <span>{FILTER_LABEL[f]}</span><span className="axp-plugin-manager-count">{p.inv.items.filter((r) => matches(r, f)).length}</span>
            </button>
          ))}
        </nav>
        <p className="axp-plugin-manager-eyebrow">Layout</p>
        <div className="axp-plugin-manager-studio__layouts">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" className={`axp-plugin-manager-studio__layout ${p.prefs.layout === l.id ? 'is-active' : ''}`} onClick={() => p.set('layout', l.id)}>
              <Icon name={l.icon} size={14} /><span><strong>{l.label}</strong><span className="fx-muted fx-small">{l.note}</span></span>
            </button>
          ))}
        </div>
      </aside>
      <main className="axp-plugin-manager-studio__main">
        <div className="axp-plugin-manager-studio__bar">
          <Search q={p.q} setQ={p.setQ} />
          <ViewPicker p={p} />
          <SortSelect value={p.prefs.sort} onChange={(v) => p.set('sort', v)} />
          <span className="axp-plugin-manager-studio__phonebar"><LayoutPicker p={p} iconsOnly /></span>
          <Button tone="ghost" icon="refresh" disabled={p.loading} onClick={() => void p.reload()}>Refresh</Button>
        </div>
        <Offline inv={p.inv} />
        <ViewBody view={p.prefs.view} {...viewProps(p)} />
      </main>
      {drawer && (
        <aside className="axp-plugin-manager-studio__drawer">
          <button type="button" className="axp-plugin-manager-iconbtn axp-plugin-manager-studio__close" title="Close" onClick={() => p.set('selected', '')}><Icon name="x" size={14} /></button>
          <DetailPane row={sel} inv={p.inv} onChanged={() => void p.reload()} onSelect={p.select} />
        </aside>
      )}
    </div>
  );
}

/* ---------------- 2. Mission control: tiles + board + signals ---------------- */

interface Signal { id: string; tone: 'danger' | 'warning' | 'accent'; title: string; text: string; folder?: string }

function signalsOf(inv: Inventory): Signal[] {
  const out: Signal[] = [];
  for (const r of inv.items) {
    if (r.error) out.push({ id: `e:${r.folder}`, tone: 'danger', title: `${r.name} failed to load`, text: r.error, folder: r.folder });
    for (const d of r.dependencies) {
      if (d.required && (d.status === 'missing' || d.status === 'disabled' || d.status === 'unsupported')) out.push({ id: `d:${r.folder}:${d.name}`, tone: 'danger', title: `${r.name} is blocked`, text: `${d.name}: ${d.detail}`, folder: r.folder });
    }
    const unset = r.dependencies.filter((d) => d.kind === 'env' && d.status === 'unset').map((d) => d.name);
    if (unset.length) out.push({ id: `v:${r.folder}`, tone: 'warning', title: `${r.name}: ${unset.length} setting${unset.length > 1 ? 's' : ''} not set`, text: unset.join(', '), folder: r.folder });
  }
  for (const c of inv.conflicts) out.push({ id: `c:${c.id}`, tone: c.severity === 'error' ? 'danger' : c.severity === 'warn' ? 'warning' : 'accent', title: `Clash: ${c.key}`, text: `${c.folders.join(' × ')} · ${c.detail}`, folder: c.folders[0] });
  return out;
}

function Mission(p: LayoutProps) {
  const c = p.inv.counts;
  const sel = selectedRow(p);
  const signals = signalsOf(p.inv);
  const pct = c.total ? Math.round((c.enabled / c.total) * 100) : 0;
  const tiles: { label: string; value: ReactNode; tone?: string; filter?: FilterId }[] = [
    { label: 'Installed', value: c.total, filter: 'all' },
    { label: 'Running', value: `${c.enabled}/${c.total}`, tone: 'success', filter: 'enabled' },
    { label: 'Errors', value: c.errors, tone: c.errors ? 'danger' : undefined, filter: 'problems' },
    { label: 'Blocked', value: c.missingDeps, tone: c.missingDeps ? 'danger' : undefined, filter: 'problems' },
    { label: 'Clashes', value: c.conflicts, tone: c.conflicts ? 'warning' : undefined, filter: 'problems' },
    { label: 'Capabilities', value: p.inv.services.length || new Set(p.inv.items.flatMap((r) => r.provides.filter((x) => x.startsWith('service:')))).size },
  ];
  return (
    <div className="axp-plugin-manager-mission">
      <header className="axp-plugin-manager-mission__head">
        <div>
          <p className="axp-plugin-manager-eyebrow">Plugin ops</p>
          <h1 className="axp-plugin-manager-mission__title">Mission control</h1>
        </div>
        <div className="axp-plugin-manager-mission__controls">
          <ViewPicker p={p} iconsOnly />
          <LayoutPicker p={p} iconsOnly />
          <Button tone="primary" icon="refresh" disabled={p.loading} onClick={() => void p.reload()}>{p.loading ? 'Scanning…' : 'Rescan'}</Button>
        </div>
      </header>
      <div className="axp-plugin-manager-mission__tiles">
        {tiles.map((t) => (
          <button key={t.label} type="button" className={`axp-plugin-manager-tile ${t.tone ? `is-${t.tone}` : ''} ${t.filter && p.prefs.filter === t.filter ? 'is-active' : ''}`} onClick={() => t.filter && p.set('filter', t.filter)}>
            <span className="axp-plugin-manager-tile__value">{t.value}</span>
            <span className="axp-plugin-manager-tile__label">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="axp-plugin-manager-mission__meter" aria-label={`${pct}% running`}><span style={{ width: `${pct}%` }} /></div>
      <div className="axp-plugin-manager-mission__grid">
        <section className="axp-plugin-manager-mission__board">
          <div className="axp-plugin-manager-mission__boardbar">
            <strong>Board</strong><span className="fx-muted fx-small">{FILTER_LABEL[p.prefs.filter]} · {p.rows.length}</span>
            <span className="fx-grow" />
            <Search q={p.q} setQ={p.setQ} placeholder="Filter board" />
          </div>
          <Offline inv={p.inv} />
          <ViewBody view={p.prefs.view} {...viewProps(p)} />
          {sel && p.prefs.view !== 'detail' && (
            <div className="axp-plugin-manager-mission__focus">
              <DetailPane row={sel} inv={p.inv} onChanged={() => void p.reload()} onSelect={p.select} />
            </div>
          )}
        </section>
        <aside className="axp-plugin-manager-mission__signals">
          <p className="axp-plugin-manager-eyebrow">Signals · {signals.length}</p>
          {signals.length === 0 && <p className="axp-plugin-manager-signal is-ok"><Icon name="check-circle" size={14} /> All systems nominal.</p>}
          {signals.map((s) => (
            <button key={s.id} type="button" className={`axp-plugin-manager-signal is-${s.tone}`} onClick={() => s.folder && p.select(s.folder)}>
              <strong>{s.title}</strong><span className="fx-small">{s.text}</span>
            </button>
          ))}
          <p className="axp-plugin-manager-eyebrow">Capability bus</p>
          <div className="axp-plugin-manager-mission__bus">
            {p.inv.services.length === 0 && <span className="fx-muted fx-small">No live services.</span>}
            {p.inv.services.map((s) => <Chip key={s.name} tone={s.enabled ? 'success' : undefined}>{s.name}</Chip>)}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- 3. Terminal: monospace + command line ---------------- */

interface Out { kind: 'in' | 'out' | 'err'; text: string }

function Terminal(p: LayoutProps) {
  const rt = useRuntime();
  const [hist, setHist] = useState<Out[]>([{ kind: 'out', text: `AXF plugin manager · ${p.inv.counts.total} plugins, ${p.inv.counts.enabled} running. Type "help".` }]);
  const [cmd, setCmd] = useState('');
  const [past, setPast] = useState<string[]>([]);
  const [idx, setIdx] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [hist]);
  const sel = selectedRow(p);
  const find = (f?: string) => p.inv.items.find((r) => r.folder === f || r.name.toLowerCase() === (f ?? '').toLowerCase());
  const print = (lines: string[], kind: Out['kind'] = 'out') => setHist((h) => [...h, ...lines.map((text) => ({ kind, text }))].slice(-300));

  const run = async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    setHist((h) => [...h, { kind: 'in', text: line }]);
    setPast((x) => [line, ...x.filter((y) => y !== line)].slice(0, 50));
    setIdx(-1);
    const [c = '', a, b] = line.split(/\s+/);
    const row = find(a);
    switch (c.toLowerCase()) {
      case 'help':
        return print([
          'ls                      list plugins          view grid|table|detail|graph|install',
          'select <plugin>         show details          layout studio|mission|terminal|catalog',
          'deps <plugin>           dependencies          filter all|enabled|off|problems|editors',
          'open <plugin>           open its UI           settings <plugin>    open its settings',
          'enable|disable <plugin> switch it             logs <plugin>        show recent log lines',
          'clashes                 list conflicts        refresh | clear',
          'install                 the plugin catalog (install, update, publish)',
        ]);
      case 'install': return (p.set('view', 'install'), print(['view → install (plugin catalog)']));
      case 'ls':
        return print(p.rows.map((r) => `${r.enabled ? '[ ON ]' : '[OFF ]'} ${r.folder.padEnd(18)} ${r.version.padEnd(7)} ${HEALTH_LABEL[r.health].padEnd(14)} ${r.name}`));
      case 'view': return VIEWS.some((v) => v.id === a) ? (p.set('view', a as ViewId), print([`view → ${a}`])) : print([`unknown view "${a ?? ''}"`], 'err');
      case 'layout': return LAYOUTS.some((l) => l.id === a) ? (p.set('layout', a as LayoutId), print([`layout → ${a}`])) : print([`unknown layout "${a ?? ''}"`], 'err');
      case 'filter': return FILTERS.includes(a as FilterId) ? (p.set('filter', a as FilterId), print([`filter → ${a}`])) : print([`unknown filter "${a ?? ''}"`], 'err');
      case 'select': case 'cd': case 'info':
        return row ? (p.select(row.folder), print([`${row.name} ${row.version} · ${HEALTH_LABEL[row.health]} · ${row.id}`, row.description])) : print([`no plugin "${a ?? ''}"`], 'err');
      case 'deps':
        if (!row) return print([`no plugin "${a ?? ''}"`], 'err');
        return print([
          `${row.name} needs:`,
          ...row.dependencies.map((d) => `  ${d.required ? 'req' : 'opt'}  ${d.kind.padEnd(9)} ${d.name.padEnd(26)} ${d.status.padEnd(16)} ${d.providers?.map((x) => x.name).join(', ') ?? ''}`),
          `${row.name} is needed by:${row.dependents.length ? '' : ' nothing'}`,
          ...row.dependents.map((d) => `  ${d.required ? 'req' : 'opt'}  ${d.name} via ${d.service}`),
        ]);
      case 'open': return row ? (openUi(rt, row) ? print([`opened ${row.name}`]) : print([`${row.name} has no UI or is off`], 'err')) : print([`no plugin "${a ?? ''}"`], 'err');
      case 'settings': return row ? (openSettings(rt, row) ? print([`settings → ${row.name}`]) : print([`${row.name} has no settings or is off`], 'err')) : print([`no plugin "${a ?? ''}"`], 'err');
      case 'enable': case 'disable':
        if (!row) return print([`no plugin "${a ?? ''}"`], 'err');
        return (await setEnabled(rt, row, c === 'enable')) ? (print([`${row.folder}: ${c}d`]), void p.reload()) : print([`${row.folder}: refused`], 'err');
      case 'logs': {
        if (!row) return print([`no plugin "${a ?? ''}"`], 'err');
        const lines = await loadLogs(row.folder, b ?? '');
        return print(lines.length ? lines.slice(-25).map((l) => `${new Date(l.at).toLocaleTimeString()} ${l.level.padEnd(5)} ${l.text}`) : ['(no lines)']);
      }
      case 'clashes': return print(p.inv.conflicts.length ? p.inv.conflicts.map((x) => `${x.severity.padEnd(5)} ${x.kind}:${x.key}  ${x.folders.join(' × ')}`) : ['no clashes']);
      case 'refresh': await p.reload(); return print(['rescanned']);
      case 'clear': return setHist([]);
      default: return print([`${c}: command not found (try "help")`], 'err');
    }
  };

  return (
    <div className="axp-plugin-manager-term">
      <div className="axp-plugin-manager-term__titlebar">
        <span className="axp-plugin-manager-term__lights" aria-hidden><i /><i /><i /></span>
        <span>pm — {p.prefs.view} — {p.rows.length}/{p.inv.counts.total}</span>
        <span className="fx-grow" />
        <ViewPicker p={p} iconsOnly />
        <LayoutPicker p={p} iconsOnly />
      </div>
      <div className="axp-plugin-manager-term__screen">
        <Offline inv={p.inv} />
        <ViewBody view={p.prefs.view} {...viewProps(p)} />
        {sel && p.prefs.view !== 'detail' && <div className="axp-plugin-manager-term__detail"><DetailPane row={sel} inv={p.inv} onChanged={() => void p.reload()} onSelect={p.select} /></div>}
        <div className="axp-plugin-manager-term__out" aria-live="polite">
          {hist.map((h, i) => <pre key={i} className={`axp-plugin-manager-term__line is-${h.kind}`}>{h.kind === 'in' ? `$ ${h.text}` : h.text}</pre>)}
          <div ref={endRef} />
        </div>
      </div>
      <form className="axp-plugin-manager-term__prompt" onSubmit={(e) => { e.preventDefault(); void run(cmd); setCmd(''); }}>
        <span className="axp-plugin-manager-term__ps1">axf@console:~/plugins$</span>
        <input className="axp-plugin-manager-term__input" value={cmd} onChange={(e) => setCmd(e.target.value)} aria-label="Command" autoComplete="off" spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && past.length) { e.preventDefault(); const n = Math.min(idx + 1, past.length - 1); setIdx(n); setCmd(past[n]!); }
            if (e.key === 'ArrowDown') { e.preventDefault(); const n = idx - 1; setIdx(n); setCmd(n >= 0 ? past[n]! : ''); }
            if (e.key === 'Tab') { e.preventDefault(); const [c0, a0 = ''] = cmd.split(/\s+/); const hit = p.inv.items.find((r) => r.folder.startsWith(a0)); if (hit && c0) setCmd(`${c0} ${hit.folder}`); }
          }} />
      </form>
    </div>
  );
}

/* ---------------- 4. Catalog: hero + shelves + product page ---------------- */

const SHELVES: { id: string; label: string; test: (r: PluginRow) => boolean }[] = [
  { id: 'providers', label: 'Capability providers', test: (r) => r.provides.some((x) => x.startsWith('service:')) },
  { id: 'pages', label: 'Tools with their own page', test: (r) => r.ui.views.length > 0 && !r.provides.some((x) => x.startsWith('service:')) },
  { id: 'helpers', label: 'Background helpers', test: (r) => r.ui.views.length === 0 && !r.provides.some((x) => x.startsWith('service:')) },
];

function Catalog(p: LayoutProps) {
  const rt = useRuntime();
  const sel = selectedRow(p);
  const featured = useMemo(() => [...p.inv.items].sort((a, b) => b.dependents.length - a.dependents.length || Number(b.enabled) - Number(a.enabled))[0], [p.inv]);
  if (sel && p.prefs.view !== 'detail') {
    return (
      <div className="axp-plugin-manager-cat axp-plugin-manager-cat--product">
        <button type="button" className="axp-plugin-manager-link" onClick={() => p.set('selected', '')}><Icon name="arrow-left" size={14} /> All plugins</button>
        <DetailPane row={sel} inv={p.inv} onChanged={() => void p.reload()} onSelect={p.select} />
      </div>
    );
  }
  const vp = viewProps(p);
  return (
    <div className="axp-plugin-manager-cat">
      <header className="axp-plugin-manager-cat__top">
        <h1 className="axp-plugin-manager-cat__brand"><Icon name="package" size={20} /> Plugin catalog</h1>
        <Search q={p.q} setQ={p.setQ} placeholder="Search the catalog" />
        <ViewPicker p={p} iconsOnly />
        <LayoutPicker p={p} iconsOnly />
      </header>
      {featured && !p.q && (
        <section className="axp-plugin-manager-hero">
          <Monogram row={featured} size="lg" />
          <div className="axp-plugin-manager-hero__text">
            <p className="axp-plugin-manager-eyebrow">Featured · used by {featured.dependents.length}</p>
            <h2>{featured.name}</h2>
            <p>{featured.description}</p>
            <div className="fx-row fx-row--wrap">
              <HealthChip row={featured} />
              <Button tone="primary" icon="info" onClick={() => p.select(featured.folder)}>Details</Button>
              {hasUi(featured) && <Button icon="external" disabled={!featured.enabled} onClick={() => openUi(rt, featured)}>Open</Button>}
              {hasSettings(featured) && <Button tone="ghost" icon="settings" disabled={!featured.enabled} onClick={() => openSettings(rt, featured)}>Settings</Button>}
            </div>
          </div>
        </section>
      )}
      <div className="axp-plugin-manager-cat__pills" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} type="button" role="tab" aria-selected={p.prefs.filter === f} className={`axp-plugin-manager-pill ${p.prefs.filter === f ? 'is-active' : ''}`} onClick={() => p.set('filter', f)}>{FILTER_LABEL[f]}</button>
        ))}
      </div>
      <Offline inv={p.inv} />
      {p.prefs.view === 'grid'
        ? SHELVES.map((s) => {
          const rows = p.rows.filter(s.test);
          return rows.length ? (
            <section key={s.id} className="axp-plugin-manager-shelf">
              <h3 className="axp-plugin-manager-shelf__title">{s.label} <span className="fx-muted fx-small">{rows.length}</span></h3>
              <CardsView {...vp} rows={rows} />
            </section>
          ) : null;
        })
        : <ViewBody view={p.prefs.view} {...vp} />}
      {p.inv.conflicts.length > 0 && p.prefs.filter === 'problems' && <ConflictList conflicts={p.inv.conflicts} />}
    </div>
  );
}

