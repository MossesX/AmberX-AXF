/*
 * API Browser views (build full-api-control, addendum Nov 7 2026). Every API path of the console from one generated
 * registry (api-registry@1), in four views (Grid, Tree, Cards, Coverage), a detail pane per path (what it does, input
 * schema, policy, REST + MCP + CLI names, the UI it stands for, docs) and Try it. Framework controls and theme tokens
 * only (api-browser.css lays out); the view switcher is a TabGroup on one of the plugin's three tab-group looks.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Container, IconButton, Note, SelectField, TabGroup, TextField, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import { TreeView, type TreeBranch } from '@console/axf/libs/tree';
import { pluginFetch } from '@console/plugins';
import * as consoleApi from '@console/api';
import {
  coverageCounts, filterCoverage, filterEntries, GROUP_LABEL, needsYes, POLICY_HINT, POLICY_LABEL, sampleBody, STATUS_LABEL, treeOf, tryRequest,
  type CoverageRow, type Entry, type Group, type Policy, type Summary,
} from './core';
import './api-browser.css';

export const FOLDER = 'api-browser';
export type View = 'grid' | 'tree' | 'cards' | 'coverage';
export interface Settings { defaultView: View; look: string; tryWrites: boolean }
const P = 'axp-api-browser';
const W = (n: number) => `calc(var(--fx-space) * ${n})`;

/** The search words another part of the console asked for (action api-browser.find:<words>). */
let askedQuery = '';
const queryListeners = new Set<(q: string) => void>();
export function askQuery(q: string) { askedQuery = q; queryListeners.forEach((f) => f(q)); }

async function getJson<T>(path: string): Promise<T> {
  const r = await pluginFetch(FOLDER, path);
  const j = await r.json().catch(() => ({})) as T & { detail?: string };
  if (!r.ok) throw new Error((j as { detail?: string }).detail ?? `${r.status}`);
  return j;
}
export const loadSettings = () => getJson<Settings>('settings');
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const r = await pluginFetch(FOLDER, 'settings', { method: 'PUT', body: JSON.stringify(patch), headers: { 'content-type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<Settings>;
}

function Badge({ policy }: { policy: Policy }) {
  return <span className={`${P}__policy`} data-policy={policy} title={POLICY_HINT[policy]}>{POLICY_LABEL[policy]}</span>;
}
function StatusTag({ status }: { status: CoverageRow['status'] }) {
  return <span className={`${P}__status`} data-status={status}>{STATUS_LABEL[status]}</span>;
}
function copy(rt: ReturnType<typeof useRuntime>, text: string) {
  void navigator.clipboard?.writeText(text).then(() => rt.toast(`Copied: ${text.slice(0, 80)}`, 'info', 'API Browser'), () => rt.toast('Copy is blocked in this browser', 'warning'));
}

/* ------------------------------------------------------------------ the page */

export function ApiBrowser() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<View>('grid');
  const [q, setQ] = useState(askedQuery);
  const [group, setGroup] = useState('');
  const [policy, setPolicy] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = (refresh = false) => {
    setError('');
    getJson<{ entries: Entry[]; summary: Summary }>(`registry${refresh ? '?refresh=1' : ''}`).then((r) => { setEntries(r.entries); setSummary(r.summary); }, (e: Error) => setError(e.message));
    getJson<{ items: CoverageRow[] }>('coverage').then((r) => setCoverage(r.items), () => undefined);
  };
  useEffect(() => {
    load();
    loadSettings().then((s) => { setSettings(s); setView(s.defaultView); }, () => undefined);
    const f = (x: string) => setQ(x);
    queryListeners.add(f);
    return () => { queryListeners.delete(f); };
  }, []);

  const shown = useMemo(() => filterEntries(entries ?? [], q, { group, policy }), [entries, q, group, policy]);
  const covShown = useMemo(() => filterCoverage(coverage ?? [], q, status), [coverage, q, status]);
  const counts = useMemo(() => coverageCounts(coverage ?? []), [coverage]);
  const current = useMemo(() => (entries ?? []).find((e) => e.id === selected) ?? null, [entries, selected]);

  const groups = Object.keys(GROUP_LABEL) as Group[];
  return (
    <div className={`fx-stack fx-stack--lg ${P}`}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Console API · {summary ? `${summary.entries} paths · ${summary.mcpTools} MCP tools · ${summary.uiElements} UI elements · ${summary.uiGaps} gaps` : 'reading the registry'}</p>
          <h1>API Browser</h1>
          <p className="fx-muted">Every way to drive the console without touching it: control@1, plugin commands, MCP tools, REST routes and the CLI, each with its policy and a Try it.</p>
        </div>
        <div className="fx-row fx-row--wrap"><Button icon="refresh" onClick={() => load(true)}>Make it again</Button></div>
      </header>
      {error && <Note tone="danger">The registry could not be made: {error}</Note>}
      <div className={`${P}__filters`} role="toolbar" aria-label="API Browser filters">
        <TextField label="Search" ariaLabel="Search API paths" value={q} onChange={setQ} placeholder="words: terminal type, ui review decide, values…" />
        {view === 'coverage'
          ? <SelectField label="Status" value={status} empty="Every status" options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} onChange={setStatus} />
          : <>
            <SelectField label="Kind" value={group} empty="Every kind" options={groups.map((g) => ({ value: g, label: `${GROUP_LABEL[g]} (${summary?.byGroup[g] ?? 0})` }))} onChange={setGroup} />
            <SelectField label="Policy" value={policy} empty="Every policy" options={(Object.keys(POLICY_LABEL) as Policy[]).map((p) => ({ value: p, label: `${POLICY_LABEL[p]} (${summary?.byPolicy[p] ?? 0})` }))} onChange={setPolicy} />
          </>}
      </div>
      <TabGroup<View> id="api-browser.views" label="API Browser views" asset={settings?.look} value={view} onChange={setView}
        tabs={[
          { value: 'grid', label: 'Grid', icon: 'list', badge: entries ? shown.length : undefined },
          { value: 'tree', label: 'Tree', icon: 'branch' },
          { value: 'cards', label: 'Cards', icon: 'grid' },
          { value: 'coverage', label: 'Coverage', icon: 'check-circle', badge: counts.gap || undefined, title: `${counts.gap} UI elements without an API path` },
        ]}>
        {!entries && !error ? <Note tone="info">Making the registry from the code (control@1, every plugin, the MCP server, the CLI): a second or two.</Note> : (
          <div className={`${P}__split`} data-detail={current && view !== 'coverage' ? 'open' : 'closed'}>
            <div className={`${P}__main`}>
              {view === 'grid' && <GridView entries={shown} selected={selected} onSelect={setSelected} />}
              {view === 'tree' && <TreeOfEntries entries={shown} selected={selected} onSelect={setSelected} query={q} />}
              {view === 'cards' && <CardsView entries={shown} onSelect={setSelected} />}
              {view === 'coverage' && <CoverageView rows={covShown} counts={counts} total={coverage?.length ?? 0} onFind={(api) => { setView('grid'); setQ(api); }} />}
            </div>
            {current && view !== 'coverage' && <EntryDetail key={current.id} e={current} settings={settings} onClose={() => setSelected(null)} />}
          </div>
        )}
      </TabGroup>
    </div>
  );
}

/* ------------------------------------------------------------------ grid */

function useSort(initial: GridSort) {
  const [sort, setSort] = useState<GridSort>(() => consoleApi.readLocal('api-browser-sort', initial));
  const [hidden, setHidden] = useState<string[]>(() => consoleApi.readLocal('api-browser-hidden', []));
  useEffect(() => { consoleApi.writeLocal('api-browser-sort', sort); }, [sort]);
  useEffect(() => { consoleApi.writeLocal('api-browser-hidden', hidden); }, [hidden]);
  return {
    sort, hidden,
    onSort: (c: string | null) => setSort((s) => (!c ? null : s?.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: 1 })),
    onToggleColumn: (c: string, show?: boolean) => setHidden((h) => (show ?? h.includes(c) ? h.filter((x) => x !== c) : [...h, c])),
    onShowAll: () => setHidden([]),
  };
}

function GridView({ entries, selected, onSelect }: { entries: Entry[]; selected: string | null; onSelect: (id: string) => void }) {
  const prefs = useSort({ col: 'title', dir: 1 });
  const columns: GridColumn<Entry>[] = [
    { id: 'title', label: 'What it does', width: 'minmax(calc(var(--fx-space) * 28), 3fr)', fixed: true, sortable: true, sortValue: (e) => e.title.toLowerCase(), render: (e) => <span className={`${P}__title`}><b>{e.title}</b><span className="fx-muted fx-small">{e.doc.slice(0, 120)}</span></span> },
    { id: 'policy', label: 'Policy', width: W(14), sortable: true, sortValue: (e) => e.policy, render: (e) => <Badge policy={e.policy} /> },
    { id: 'rest', label: 'REST', width: 'minmax(calc(var(--fx-space) * 20), 2fr)', sortable: true, sortValue: (e) => e.rest?.path ?? '', render: (e) => (e.rest ? <code className={`${P}__code`}>{e.rest.method} {e.rest.path}</code> : <span className="fx-muted">—</span>) },
    { id: 'mcp', label: 'MCP', width: 'minmax(calc(var(--fx-space) * 18), 2fr)', sortable: true, sortValue: (e) => e.mcp[0] ?? '', render: (e) => (e.mcp.length ? <code className={`${P}__code`}>{e.mcp.join(' · ')}</code> : <span className="fx-muted">—</span>) },
    { id: 'cli', label: 'CLI', width: 'minmax(calc(var(--fx-space) * 18), 2fr)', render: (e) => (e.cli ? <code className={`${P}__code`}>{e.cli}</code> : <span className="fx-muted">—</span>) },
    { id: 'ui', label: 'UI', width: W(8), align: 'end', sortable: true, sortValue: (e) => e.uiCount ?? 0, render: (e) => <span className="fx-muted">{e.uiCount ?? ''}</span> },
  ];
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === prefs.sort?.col);
    if (!col?.sortValue) return entries;
    return [...entries].sort((a, b) => { const x = col.sortValue!(a), y = col.sortValue!(b); return (x < y ? -1 : x > y ? 1 : 0) * (prefs.sort!.dir); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, prefs.sort]);
  const groups: GridGroup<Entry>[] = (Object.keys(GROUP_LABEL) as Group[]).map((g) => ({ id: g, title: `${GROUP_LABEL[g]} (${sorted.filter((e) => e.group === g).length})`, icon: g === 'control' ? 'sliders' : g === 'plugins' ? 'package' : g === 'mcp' ? 'sparkles' : g === 'rest' ? 'cloud' : 'terminal', rows: sorted.filter((e) => e.group === g).slice(0, 400), groups: [] })).filter((g) => g.rows.length);
  return (
    <DataGrid<Entry> id="api-browser-paths" label="API paths" compact groups={groups} columns={columns} rowId={(e) => e.id} rowLabel={(e) => e.title}
      rowTone={(e) => (e.policy === 'instant' ? 'success' : e.policy === 'veto' ? 'accent' : e.policy === 'confirm' ? 'warning' : 'muted')}
      selected={selected} onRowClick={(e) => onSelect(e.id)} {...prefs} empty="No API path matches. Fewer words, or another kind / policy." />
  );
}

/* ------------------------------------------------------------------ tree */

function TreeOfEntries({ entries, selected, onSelect, query }: { entries: Entry[]; selected: string | null; onSelect: (id: string) => void; query: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ 'app:console-web': true });
  const tree = useMemo(() => treeOf(entries), [entries]);
  const branches: TreeBranch[] = tree.map((app) => ({
    id: app.id, label: app.label, icon: 'monitor', meta: `${entries.length}`, collapsed: !open[app.id], leaves: [],
    branches: app.areas.map((a) => ({
      id: a.id, label: a.label, icon: a.id.startsWith('plugin:') ? 'package' : a.id.startsWith('control:') ? 'sliders' : 'cloud', collapsed: !open[a.id] && !query, leaves: [],
      meta: `${a.groups.reduce((n, g) => n + g.entries.length, 0)}`,
      branches: a.groups.map((g) => ({ id: g.id, label: g.label, icon: 'list', collapsed: !open[g.id] && !query, branches: [], meta: `${g.entries.length}`,
        leaves: g.entries.map((e) => ({ id: e.id, label: e.title, icon: e.policy === 'instant' ? 'eye' : e.policy === 'person' ? 'lock' : 'zap', meta: POLICY_LABEL[e.policy] })) })),
    })),
  }));
  return (
    <div className={`${P}__tree`}>
      <TreeView label="API paths by app, plugin and kind" branches={branches} query={query} selected={{ leaf: selected }}
        onToggle={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))} onSelectLeaf={(id) => onSelect(id)} onSelectBranch={(id) => setOpen((o) => ({ ...o, [id]: !o[id] }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

function CardsView({ entries, onSelect }: { entries: Entry[]; onSelect: (id: string) => void }) {
  const [n, setN] = useState(60);
  return (
    <div className="fx-stack">
      <div className={`${P}__cards`}>
        {entries.slice(0, n).map((e) => (
          <article key={e.id} className={`${P}__card`} data-policy={e.policy}>
            <header className={`${P}__cardhead`}><b>{e.title}</b><Badge policy={e.policy} /></header>
            <p className="fx-muted fx-small">{e.doc.slice(0, 160) || GROUP_LABEL[e.group]}</p>
            <code className={`${P}__code`}>{e.mcp[0] ?? e.cli ?? e.rest?.path}</code>
            <div className="fx-row"><Button size="sm" icon="eye" onClick={() => onSelect(e.id)} aria-label={`Open ${e.title}`}>Open</Button>{e.uiCount ? <span className="fx-muted fx-small">{e.uiCount} UI elements</span> : null}</div>
          </article>
        ))}
      </div>
      {entries.length > n && <Button icon="plus" onClick={() => setN(n + 60)}>Show 60 more ({entries.length - n} left)</Button>}
      {!entries.length && <Note tone="info">No API path matches. Fewer words, or another kind / policy.</Note>}
    </div>
  );
}

/* ------------------------------------------------------------------ coverage */

function CoverageView({ rows, counts, total, onFind }: { rows: CoverageRow[]; counts: Record<CoverageRow['status'], number>; total: number; onFind: (api: string) => void }) {
  const prefs = useSort({ col: 'status', dir: 1 });
  const order: CoverageRow['status'][] = ['gap', 'person-only', 'skipped', 'covered', 'generic'];
  const columns: GridColumn<CoverageRow>[] = [
    { id: 'label', label: 'UI element', width: 'minmax(calc(var(--fx-space) * 22), 3fr)', fixed: true, sortable: true, sortValue: (r) => (r.label || r.id).toLowerCase(), render: (r) => <span className={`${P}__title`}><b>{r.label || r.id}{r.count && r.count > 1 ? ` ×${r.count}` : ''}</b><span className="fx-muted fx-small">{r.kind} · {r.file}</span></span> },
    { id: 'status', label: 'Status', width: W(20), sortable: true, sortValue: (r) => order.indexOf(r.status), render: (r) => <StatusTag status={r.status} /> },
    { id: 'api', label: 'API path', width: 'minmax(calc(var(--fx-space) * 24), 3fr)', sortable: true, sortValue: (r) => r.api, render: (r) => (r.api ? <Button size="sm" tone="ghost" className={`${P}__link`} onClick={() => onFind(r.api.split(' ').slice(2).join(' ') || r.api)} aria-label={`Find ${r.api}`}><code className={`${P}__code`}>{r.api}</code></Button> : <span className={`${P}__fix`}>{r.fix}</span>) },
    { id: 'mcp', label: 'MCP', width: 'minmax(calc(var(--fx-space) * 18), 2fr)', render: (r) => (r.mcp ? <code className={`${P}__code`}>{r.mcp}</code> : <span className="fx-muted">—</span>) },
  ];
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === prefs.sort?.col);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => { const x = col.sortValue!(a), y = col.sortValue!(b); return (x < y ? -1 : x > y ? 1 : 0) * prefs.sort!.dir; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, prefs.sort]);
  const areas = [...new Set(sorted.map((r) => r.where))];
  const groups: GridGroup<CoverageRow>[] = areas.map((w) => { const list = sorted.filter((r) => r.where === w); const gaps = list.filter((r) => r.status === 'gap').length; return { id: w, title: `${w} (${list.length}${gaps ? `, ${gaps} gaps` : ''})`, icon: w.startsWith('plugin:') ? 'package' : 'monitor', rows: list.slice(0, 300), groups: [], collapsed: areas.length > 1 && !gaps && sorted.length > 200 }; });
  return (
    <div className="fx-stack">
      <div className={`${P}__counts`} role="status" aria-label="Coverage summary">
        {order.map((s) => <span key={s} className={`${P}__count`} data-status={s}><b>{counts[s]}</b> {STATUS_LABEL[s]}</span>)}
        <span className="fx-muted fx-small">of {total} UI elements · {counts.gap ? 'red = no API path yet: CI fails until each is named' : 'every element has an API path'}</span>
      </div>
      <DataGrid<CoverageRow> id="api-browser-coverage" label="UI coverage" compact groups={groups} columns={columns} rowId={(r) => `${r.kind}|${r.file}|${r.id}`} rowLabel={(r) => r.label || r.id}
        rowTone={(r) => (r.status === 'gap' ? 'danger' : r.status === 'person-only' ? 'warning' : r.status === 'covered' ? 'success' : 'muted')} {...prefs} empty="No UI element matches." />
    </div>
  );
}

/* ------------------------------------------------------------------ detail + Try it */

function EntryDetail({ e, settings, onClose }: { e: Entry; settings: Settings | null; onClose: () => void }) {
  const rt = useRuntime();
  return (
    <aside className={`${P}__detail`} aria-label={`API path ${e.title}`}>
      <Container title={e.title} icon={e.group === 'plugins' ? 'package' : e.group === 'mcp' ? 'sparkles' : e.group === 'cli' ? 'terminal' : 'code'} actions={<IconButton icon="x" label="Close the detail" onClick={onClose} />}>
        <div className="fx-stack">
          <div className="fx-row fx-row--wrap"><Badge policy={e.policy} /><span className="fx-muted fx-small">{GROUP_LABEL[e.group]} · {e.effect}{e.permission ? ` · needs ${e.permission}` : ''}</span></div>
          {e.doc && <p className={`${P}__doc`}>{e.doc}</p>}
          <p className="fx-muted fx-small">{POLICY_HINT[e.policy]}</p>
          <dl className={`${P}__names`}>
            {e.rest && <><dt>REST</dt><dd><code className={`${P}__code`}>{e.rest.method} {e.rest.path}</code><IconButton icon="copy" label="Copy the REST path" onClick={() => copy(rt, `${e.rest!.method} ${e.rest!.path}`)} /></dd></>}
            {e.mcp.map((m) => <span key={m} className={`${P}__pair`}><dt>MCP</dt><dd><code className={`${P}__code`}>{m}</code><IconButton icon="copy" label={`Copy MCP tool ${m}`} onClick={() => copy(rt, m)} /></dd></span>)}
            {e.cli && <><dt>CLI</dt><dd><code className={`${P}__code`}>{e.cli}</code><IconButton icon="copy" label="Copy the CLI command" onClick={() => copy(rt, e.cli)} /></dd></>}
            <dt>Id</dt><dd><code className={`${P}__code`}>{e.id}</code></dd>
            {e.output && <><dt>Answers</dt><dd>{e.output}</dd></>}
            {e.docs && <><dt>Docs</dt><dd><code className={`${P}__code`}>{e.docs}</code></dd></>}
          </dl>
          <details className={`${P}__schema`}><summary>Input schema</summary><pre className={`${P}__pre`}>{JSON.stringify(e.input, null, 1)}</pre></details>
          {!!e.ui?.length && (
            <details className={`${P}__schema`} open={e.ui.length <= 6}>
              <summary>UI it stands for ({e.uiCount})</summary>
              <ul className={`${P}__ui`}>{e.ui.map((u, i) => <li key={i}><b>{u.label}</b> <span className="fx-muted fx-small">{u.kind} · {u.where} · {u.file}</span></li>)}</ul>
            </details>
          )}
          <TryIt e={e} allowWrites={settings?.tryWrites !== false} />
        </div>
      </Container>
    </aside>
  );
}

interface Ran { ok: boolean; status: number; body: unknown; ms: number; confirm?: string }

function TryIt({ e, allowWrites }: { e: Entry; allowWrites: boolean }) {
  const [text, setText] = useState(() => JSON.stringify(sampleBody(e), null, 1));
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState<Ran | null>(null);
  let body: Record<string, unknown> | null = null;
  let parseError = '';
  try { body = JSON.parse(text || '{}') as Record<string, unknown>; } catch (x) { parseError = (x as Error).message; }
  const req = body ? tryRequest(e, body) : null;
  const blocked = req && 'why' in req ? req.why : !allowWrites && needsYes(e) ? 'Try it runs reads only (Settings → Plugins → API Browser → Try it may run changes).' : '';

  const run = async (confirm = '') => {
    if (!body) return;
    const r = tryRequest(e, body, confirm);
    if ('why' in r) return;
    setBusy(true); setArmed(false);
    const t0 = performance.now();
    try {
      const token = consoleApi.getToken();
      const res = await fetch(r.url, { method: r.method, headers: { ...(r.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}), cache: 'no-store' });
      const txt = await res.text();
      let j: unknown = txt; try { j = JSON.parse(txt); } catch { /* text */ }
      const o = (j && typeof j === 'object' ? j : {}) as { ok?: boolean; code?: string; confirm?: string };
      setRan({ ok: res.ok && o.ok !== false, status: res.status, body: j, ms: Math.round(performance.now() - t0), ...(o.code === 'confirmation_required' && o.confirm ? { confirm: o.confirm } : {}) });
    } catch (x) {
      setRan({ ok: false, status: 0, body: String((x as Error).message ?? x), ms: Math.round(performance.now() - t0) });
    } finally { setBusy(false); }
  };

  return (
    <section className={`${P}__try`} aria-label="Try it">
      <h3 className={`${P}__h3`}>Try it</h3>
      <TextField label={e.group === 'control' ? 'The control@1 command' : e.group === 'plugins' ? 'Its input' : 'Body / query'} ariaLabel="Try it body" value={text} onChange={setText} rows={8} mono error={parseError ? `Not JSON: ${parseError}` : undefined} />
      {blocked ? <Note tone="info">{blocked}</Note> : (
        <div className="fx-row fx-row--wrap">
          {needsYes(e) && !armed
            ? <Button icon="play" tone="primary" disabled={busy || !body} onClick={() => setArmed(true)}>Run…</Button>
            : <Button icon="play" tone="primary" busy={busy} disabled={!body} onClick={() => void run()}>{needsYes(e) ? 'Yes, run it' : 'Run'}</Button>}
          {armed && <><span className="fx-small">{e.policy === 'confirm' ? 'This deletes or resets something: the first run only asks for its confirm token.' : 'This changes something in the console.'}</span><Button icon="x" onClick={() => setArmed(false)}>Cancel</Button></>}
          <Button icon="refresh" onClick={() => { setText(JSON.stringify(sampleBody(e), null, 1)); setRan(null); }}>Reset</Button>
        </div>
      )}
      {ran && (
        <div className="fx-stack">
          <p className={`${P}__result`} data-ok={ran.ok ? 'yes' : 'no'}>{ran.ok ? 'Done' : 'Failed'} · HTTP {ran.status} · {ran.ms} ms</p>
          {ran.confirm && <div className="fx-row fx-row--wrap"><span className="fx-small">It answered with a confirm token. Run it again with it?</span><Button tone="danger" icon="check" busy={busy} onClick={() => void run(ran.confirm)}>Run with the confirm token</Button></div>}
          <pre className={`${P}__pre`}>{typeof ran.body === 'string' ? ran.body : JSON.stringify(ran.body, null, 1)}</pre>
        </div>
      )}
    </section>
  );
}
