/**
 * Changes & features grid console plugin (ai.amberx.axf.console.changes-grid).
 *
 * One grid of every change (the Codebase changes log, through the server part → axf.changes@1) and every feature (the
 * plan, from the console's own route). Rows are titled with the thread / request name and its date and time; a row
 * expands to its details (a change's whole entry is fetched on first expand). Filter, search, sort. Stores nothing.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button, Chip, IconButton, ModelBadge, Segmented } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import * as api from '@console/api';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { RowHookButtons } from '@console/axf/libs/datagrid';
import { buildRows, counts, formatWhen, statusTone, type ChangeSummary, type FeatureLike, type Row, type Show, type Sort } from './core';
import { appMenu } from './menu';
import './changes-grid.css';

const FOLDER = 'changes-grid';
const ID = 'ai.amberx.axf.console.changes-grid';
const VIEW = 'changes-grid';

interface Data { changes: ChangeSummary[]; changesOk: boolean; features: (FeatureLike & Record<string, unknown>)[]; featuresOk: boolean }

async function loadAll(): Promise<Data> {
  const [c, p] = await Promise.all([
    pluginFetch(FOLDER, 'changes').then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ available?: boolean; items?: ChangeSummary[] } | null>,
    api.loadPlan().catch(() => null),
  ]);
  return {
    changes: Array.isArray(c?.items) ? c.items : [], changesOk: !!c?.available,
    features: Array.isArray(p?.features) ? (p.features as unknown as Data['features']) : [], featuresOk: !!p,
  };
}

type Entry = Record<string, unknown> & {
  asked?: string; steps?: { text: string; state: string; note?: string }[];
  result?: { state?: string; summary?: string; branch?: string; commits?: string[]; filesChanged?: number; links?: { label?: string; url?: string }[] } | null;
};

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="axp-changes-grid__line"><span className="fx-small fx-muted axp-changes-grid__k">{k}</span><span className="fx-grow">{children}</span></div>;
}

function ChangeDetail({ row }: { row: Row }) {
  const [entry, setEntry] = useState<Entry | null | 'error'>(null);
  useEffect(() => {
    let live = true;
    pluginFetch(FOLDER, `changes/${encodeURIComponent(row.refId)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j: { entry?: Entry }) => live && setEntry(j.entry ?? 'error'), () => live && setEntry('error'));
    return () => { live = false; };
  }, [row.refId]);
  if (entry === null) return <p className="fx-small fx-muted">Loading…</p>;
  if (entry === 'error') return <p className="fx-small fx-muted">{row.summary || 'Details unavailable.'}</p>;
  const r = entry.result;
  return (
    <div className="fx-stack">
      <Line k="Id"><span className="fx-mono fx-small">{row.refId}</span></Line>
      {entry.asked ? <Line k="Asked"><span className="fx-small">{entry.asked}</span></Line> : null}
      {row.area ? <Line k="Where"><span className="fx-small">{row.area}</span></Line> : null}
      {entry.steps?.length ? (
        <Line k="Steps"><ol className="fx-small" style={{ margin: 0 }}>{entry.steps.map((s, i) => <li key={i}>{s.text} <Chip tone={statusTone(s.state)}>{s.state}</Chip>{s.note ? <span className="fx-muted"> · {s.note}</span> : null}</li>)}</ol></Line>
      ) : null}
      {r ? <Line k="Result"><span className="fx-small"><Chip tone={statusTone(r.state ?? '')}>{r.state}</Chip> {r.summary}</span></Line> : null}
      {r?.branch ? <Line k="Branch"><span className="fx-mono fx-small">{r.branch}</span></Line> : null}
      {r?.commits?.length ? <Line k="Commits"><span className="fx-mono fx-small">{r.commits.map((c) => c.slice(0, 10)).join(', ')}</span></Line> : null}
      {typeof r?.filesChanged === 'number' ? <Line k="Files"><span className="fx-small">{r.filesChanged} changed</span></Line> : null}
      {r?.links?.length ? <Line k="Links"><span className="fx-small">{r.links.filter((l) => /^https:\/\//.test(l.url ?? '')).map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" style={{ marginRight: 'var(--fx-dens-gap-xl)' }}>{l.label || l.url}</a>)}</span></Line> : null}
    </div>
  );
}

function FeatureDetail({ f, row }: { f: Data['features'][number]; row: Row }) {
  const ports = (f.ports ?? {}) as Record<string, { status?: string }>;
  const files = (f.files ?? []) as string[];
  const acc = (f.acceptance ?? []) as { text: string; done: boolean }[];
  const hist = [...(f.history ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);
  return (
    <div className="fx-stack">
      <Line k="Id"><span className="fx-mono fx-small">{row.refId}</span></Line>
      {row.summary ? <Line k="Summary"><span className="fx-small">{row.summary}</span></Line> : null}
      {row.area ? <Line k="Area"><span className="fx-small">{row.area}</span></Line> : null}
      {Object.keys(ports).length ? <Line k="Ports"><span className="fx-small">{Object.entries(ports).map(([p, v]) => `${p}: ${v?.status ?? '?'}`).join(' · ')}</span></Line> : null}
      {files.length ? <Line k="Files"><span className="fx-mono fx-small">{files.slice(0, 12).join(', ')}{files.length > 12 ? ` +${files.length - 12}` : ''}</span></Line> : null}
      {acc.length ? <Line k="Acceptance"><ul className="fx-small" style={{ margin: 0 }}>{acc.map((a, i) => <li key={i}>{a.done ? '✓' : '○'} {a.text}</li>)}</ul></Line> : null}
      {hist.length ? <Line k="History"><ul className="fx-small" style={{ margin: 0 }}>{hist.map((h, i) => <li key={i}><span className="fx-muted">{formatWhen(h.at)}</span> {h.text}</li>)}</ul></Line> : null}
    </div>
  );
}

function GridView() {
  const [data, setData] = useState<Data | null>(null);
  const [show, setShow] = useState<Show>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(200);
  const reload = () => { setData(null); void loadAll().then(setData); };
  useEffect(reload, []);
  const rows = useMemo(() => (data ? buildRows(data.changes, data.features, { show, q, sort }) : []), [data, show, q, sort]);
  const byFeature = useMemo(() => new Map((data?.features ?? []).map((f) => [f.id, f])), [data]);
  const n = useMemo(() => counts(rows), [rows]);
  const toggle = (k: string) => setOpen((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });

  return (
    <div className="fx-stack axp-changes-grid">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Builds{data ? ` · ${rows.length} rows · ${n.changes} changes · ${n.features} features` : ' · loading…'}</p>
          <h1>Changes &amp; features</h1>
          <p className="fx-muted axp-changes-grid__lede" title="Every change from the codebase log and every planned feature in one grid, newest first.">Every change and planned feature, newest first.</p>
        </div>
        <IconButton icon="refresh" label="Reload" onClick={reload} />
      </header>
      <div className="axp-changes-grid__bar" role="toolbar" aria-label="Filter the grid">
        <input className="fx-input axp-changes-grid__search" type="search" placeholder="Search names, ids, status, model…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <Segmented label="Show" size="sm" value={show} onChange={setShow} options={[{ value: 'all', label: 'Both' }, { value: 'changes', label: 'Changes' }, { value: 'features', label: 'Features' }]} />
        <select className="fx-input axp-changes-grid__sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title">Name</option>
        </select>
        <IconButton icon="chevron-up" label="Collapse all" onClick={() => setOpen(new Set())} disabled={!open.size} />
      </div>
      {data && !data.changesOk ? <p className="fx-small fx-muted">The changes log isn’t available (Codebase changes plugin off or its log unreachable); showing features only.</p> : null}
      {!data ? <p className="fx-empty">Loading…</p> : !rows.length ? <p className="fx-empty">Nothing matches.</p> : null}
      {rows.length ? (
        <div className="fx-tablewrap axp-changes-grid__table"><table className="fx-table">
          <thead><tr><th aria-label="Expand" /><th>Name</th><th className="axp-changes-grid__wide">Date and time</th><th className="axp-changes-grid__wide">Type</th><th>Status</th><th className="axp-changes-grid__wide">Model</th><th className="axp-changes-grid__wide" aria-label="Row actions" /></tr></thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const isOpen = open.has(r.key);
              const f = r.source === 'feature' ? byFeature.get(r.refId) : undefined;
              const type = r.source === 'change' ? `change · ${r.kind}` : r.kind;
              return (
                <Fragment key={r.key}>
                  <tr data-fx-row onClick={() => toggle(r.key)} aria-expanded={isOpen} data-fx-ctx-target={r.source === 'change' ? 'axf-change-entry' : 'axf-plan-feature'} data-fx-ctx-payload={r.refId}>
                    <td><IconButton icon={isOpen ? 'chevron-down' : 'chevron-right'} label={isOpen ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(r.key); }} /></td>
                    <td className="axp-changes-grid__name"><strong>{r.title}</strong><span className="fx-small fx-muted axp-changes-grid__meta">{formatWhen(r.at)} · {type}{r.model ? ` · ${r.model}` : ''}</span></td>
                    <td className="fx-small axp-changes-grid__wide" style={{ whiteSpace: 'nowrap' }}>{formatWhen(r.at)}</td>
                    <td className="axp-changes-grid__wide"><Chip>{type}</Chip></td>
                    <td><Chip tone={statusTone(r.status)}>{r.status}</Chip></td>
                    <td className="axp-changes-grid__wide">{r.model ? <ModelBadge model={r.model} /> : <span className="fx-muted fx-small">—</span>}</td>
                    <td className="axp-changes-grid__wide"><RowHookButtons rowRef={{ kind: r.source === 'change' ? 'change' : 'plan', id: r.refId }} /></td>
                  </tr>
                  {isOpen ? (
                    <tr><td className="axp-changes-grid__wide" /><td colSpan={6} className="axp-changes-grid__detail">
                      {r.source === 'change' ? <ChangeDetail row={r} /> : f ? <FeatureDetail f={f} row={r} /> : null}
                      <div className="axp-changes-grid__phonehooks"><RowHookButtons rowRef={{ kind: r.source === 'change' ? 'change' : 'plan', id: r.refId }} /></div>
                    </td></tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table></div>
      ) : null}
      {rows.length > limit ? <Button size="sm" onClick={() => setLimit((l) => l + 200)}>Show more ({rows.length - limit} left)</Button> : null}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Changes & features grid',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('changes-grid.open', () => rt.navigate(VIEW), { label: 'Open the changes & features grid' });
  },
  views: { [VIEW]: { title: 'Changes & features', icon: 'list', keywords: ['changes', 'features', 'grid', 'threads', 'history', 'log', 'built'], render: () => <GridView /> } },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Changes & features', icon: 'list', view: VIEW }] },
  contextMenu: [{ id: 'changes-grid.default', target: 'default', order: 93, items: [{ id: 'changes-grid', label: 'Changes & features grid', icon: 'list', action: 'changes-grid.open' }] }],
  settingsTabs: [{ id: 'changes-grid', label: 'Changes & features grid', icon: 'list', parent: 'plugins', order: 45, description: 'One grid of every change and feature.' }],
  settingsPanels: [{ id: 'changes-grid.lifecycle', tab: 'changes-grid', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> }],
};
