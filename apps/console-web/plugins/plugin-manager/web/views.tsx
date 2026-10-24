/** The views (Install is in InstallView.tsx). Each layout restyles them (and wraps them in its own chrome); the data and actions are shared. */
import { useMemo, useState } from 'react';
import { Chip, Icon, IconButton, ModelBadge, useRuntime } from '@console/axf/react';
import { hasSettings, hasUi, openSettings, openUi } from './actions';
import { DetailPane, HealthChip, Monogram, QuickActions } from './Detail';
import { fmtBytes, HEALTH_LABEL, HEALTH_RANK, type Inventory, type PluginRow } from './model';
import { pluginGraph, type GraphNode } from '@console/axf/core/engines/plugins';
import type { LayoutId } from './prefs';

export interface ViewProps {
  rows: PluginRow[];
  inv: Inventory;
  layout: LayoutId;
  selected: string;
  onSelect: (folder: string) => void;
  onChanged: () => void;
}

const ctx = (row: PluginRow) => ({ 'data-fx-ctx-target': 'plugin-manager.row', 'data-fx-ctx-payload': row.folder });
const needCount = (r: PluginRow) => r.dependencies.filter((d) => d.kind === 'service' || d.kind === 'plugin').length;
const tag = (layout: LayoutId, on: boolean) => (layout === 'terminal' ? (on ? '[ ON ]' : '[OFF ]') : on ? 'on' : 'off');

/* ---------------- Cards ---------------- */

export function CardsView({ rows, layout, selected, onSelect, onChanged }: ViewProps) {
  if (!rows.length) return <Empty />;
  return (
    <div className="axp-plugin-manager-cards">
      {rows.map((r) => (
        <div key={r.folder} className={`axp-plugin-manager-card is-${r.health} ${selected === r.folder ? 'is-selected' : ''} ${r.enabled ? '' : 'is-disabled'}`} {...ctx(r)}>
          <button type="button" data-fx-row className="axp-plugin-manager-card__hit" onClick={() => onSelect(r.folder)} aria-label={`Show ${r.name}`} />
          <div className="axp-plugin-manager-card__cover"><Monogram row={r} size={layout === 'catalog' ? 'lg' : 'md'} /></div>
          <div className="axp-plugin-manager-card__body">
            <div className="axp-plugin-manager-card__title">
              <strong>{r.name}</strong>
              <span className="axp-plugin-manager-card__version">{r.version}</span>
              <ModelBadge model={r.builtWith?.model} builtAt={r.builtWith?.builtAt} compact />
              {layout === 'terminal' && <span className={`axp-plugin-manager-tag ${r.enabled ? 'is-active' : ''}`}>{tag(layout, r.enabled)}</span>}
            </div>
            <p className="axp-plugin-manager-card__desc">{r.description || r.id}</p>
            <div className="axp-plugin-manager-card__meta">
              <HealthChip row={r} />
              {needCount(r) > 0 && <span className="axp-plugin-manager-meta"><Icon name="branch" size={12} /> needs {needCount(r)}</span>}
              {r.dependents.length > 0 && <span className="axp-plugin-manager-meta"><Icon name="layers" size={12} /> used by {r.dependents.length}</span>}
              {hasUi(r) && <span className="axp-plugin-manager-meta"><Icon name="monitor" size={12} /> UI</span>}
              {hasSettings(r) && <span className="axp-plugin-manager-meta"><Icon name="settings" size={12} /> settings</span>}
              {r.conflicts.length > 0 && <span className="axp-plugin-manager-meta is-warn"><Icon name="alert" size={12} /> {r.conflicts.length}</span>}
            </div>
          </div>
          <div className="axp-plugin-manager-card__actions"><QuickActions row={r} onChanged={onChanged} compact /></div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Table ---------------- */

type Col = 'name' | 'version' | 'health' | 'enabled' | 'needs' | 'usedBy' | 'size' | 'data' | 'logs';
const COLS: { id: Col; label: string; num?: boolean }[] = [
  { id: 'name', label: 'Plugin' }, { id: 'version', label: 'Version' }, { id: 'health', label: 'Health' }, { id: 'enabled', label: 'State' },
  { id: 'needs', label: 'Needs', num: true }, { id: 'usedBy', label: 'Used by', num: true }, { id: 'size', label: 'Code', num: true },
  { id: 'data', label: 'Data', num: true }, { id: 'logs', label: 'Logs', num: true },
];
const value = (r: PluginRow, c: Col): string | number => ({
  name: r.name.toLowerCase(), version: r.version, health: HEALTH_RANK[r.health], enabled: r.enabled ? 1 : 0, needs: needCount(r),
  usedBy: r.dependents.length, size: r.code.bytes, data: r.lifecycle.data.bytes, logs: r.logCount,
})[c];

export function TableView({ rows, layout, selected, onSelect }: ViewProps) {
  const rt = useRuntime();
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'name', dir: 1 });
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const x = value(a, sort.col), y = value(b, sort.col);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  }), [rows, sort]);
  if (!rows.length) return <Empty />;
  return (
    <div className="axp-plugin-manager-tablewrap">
      <table className="axp-plugin-manager-table">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.id} className={c.num ? 'is-num' : ''} aria-sort={sort.col === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" data-fx-row className="axp-plugin-manager-th" onClick={() => setSort((s) => ({ col: c.id, dir: s.col === c.id ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                  {c.label}{sort.col === c.id && <Icon name={sort.dir === 1 ? 'chevron-up' : 'chevron-down'} size={12} />}
                </button>
              </th>
            ))}
            <th><span className="fx-muted">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.folder} className={`axp-plugin-manager-tr is-${r.health} ${selected === r.folder ? 'is-selected' : ''}`} onClick={() => onSelect(r.folder)} {...ctx(r)}>
              <td><span className="axp-plugin-manager-namecell"><Monogram row={r} size="sm" /><span><strong>{r.name}</strong><span className="fx-mono fx-small fx-muted"> {r.folder}</span></span></span></td>
              <td className="fx-mono">{r.version} <ModelBadge model={r.builtWith?.model} builtAt={r.builtWith?.builtAt} compact /></td>
              <td>{layout === 'terminal' ? <span className={`axp-plugin-manager-tag is-${r.health}`}>{HEALTH_LABEL[r.health].toUpperCase()}</span> : <HealthChip row={r} />}</td>
              <td><span className={`axp-plugin-manager-tag ${r.enabled ? 'is-active' : ''}`}>{tag(layout, r.enabled)}</span></td>
              <td className="is-num">{needCount(r)}</td>
              <td className="is-num">{r.dependents.length}</td>
              <td className="is-num">{fmtBytes(r.code.bytes)}</td>
              <td className="is-num">{fmtBytes(r.lifecycle.data.bytes)}</td>
              <td className="is-num">{r.logCount}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <span className="axp-plugin-manager-iconbtns">
                  <IconButton icon="external" label="Open its UI" disabled={!hasUi(r) || !r.enabled} onClick={() => openUi(rt, r)} />
                  <IconButton icon="settings" label="Open its settings" disabled={!hasSettings(r) || !r.enabled} onClick={() => openSettings(rt, r)} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Detail (master-detail) ---------------- */

export function MasterDetailView(props: ViewProps) {
  const { rows, inv, selected, onSelect, onChanged } = props;
  const row = rows.find((r) => r.folder === selected) ?? rows[0];
  if (!rows.length) return <Empty />;
  return (
    <div className="axp-plugin-manager-md">
      <nav className="axp-plugin-manager-md__list" aria-label="Plugins">
        {rows.map((r) => (
          <button key={r.folder} type="button" data-fx-row className={`axp-plugin-manager-md__item ${row?.folder === r.folder ? 'is-selected' : ''}`} onClick={() => onSelect(r.folder)} {...ctx(r)}>
            <Monogram row={r} size="sm" />
            <span className="axp-plugin-manager-md__name">{r.name}<span className="fx-muted fx-small">{r.version}</span> <ModelBadge model={r.builtWith?.model} compact /></span>
            <span className={`axp-plugin-manager-dot is-${r.health}`} title={HEALTH_LABEL[r.health]} />
          </button>
        ))}
      </nav>
      <div className="axp-plugin-manager-md__pane">{row && <DetailPane row={row} inv={inv} onChanged={onChanged} onSelect={onSelect} />}</div>
    </div>
  );
}

/* ---------------- Dependency graph ---------------- */

/** Rows are the engine's half-steps (×2); the web port draws them at ROW px apart and three fixed columns. */
const ROW = 23, TOP = 30, COLX = [20, 260, 500] as const, NODE_W = 144;
interface Node extends GraphNode { x: number; y: number; row2: PluginRow | undefined }

export function GraphView({ rows, inv, selected, onSelect }: ViewProps) {
  const [hover, setHover] = useState('');
  const g = useMemo(() => buildGraph(rows, inv), [rows, inv]);
  if (!rows.length) return <Empty />;
  const focus = hover || (selected ? `p:${selected}` : '');
  const linked = new Set<string>(focus ? [focus, ...g.edges.filter((e) => e.from === focus || e.to === focus).flatMap((e) => [e.from, e.to])] : []);
  const pos = new Map(g.nodes.map((n) => [n.id, n]));
  const selRow = rows.find((r) => r.folder === selected);
  return (
    <div className="axp-plugin-manager-graph">
      <div className="axp-plugin-manager-graph__legend">
        <span><i className="axp-plugin-manager-swatch is-provides" /> provides</span>
        <span><i className="axp-plugin-manager-swatch is-requires" /> requires</span>
        <span><i className="axp-plugin-manager-swatch is-optional" /> optional</span>
        <span><i className="axp-plugin-manager-swatch is-broken" /> missing / provider off</span>
      </div>
      <div className="axp-plugin-manager-graph__scroll">
        <svg className="axp-plugin-manager-graph__svg" viewBox={`0 0 ${g.width} ${g.height}`} width={g.width} height={g.height} role="img" aria-label="Plugin dependency graph">
          {g.edges.map((e, i) => {
            const a = pos.get(e.from)!, b = pos.get(e.to)!;
            const [x1, x2] = a.x < b.x ? [a.x + NODE_W + 6, b.x - 6] : [a.x - 6, b.x + NODE_W + 6];
            const mx = (x1 + x2) / 2;
            const dim = focus && !(linked.has(e.from) && linked.has(e.to));
            return <path key={i} d={`M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`} className={`axp-plugin-manager-edge is-${e.kind} ${e.broken ? 'is-broken' : ''} ${dim ? 'is-dim' : ''}`} />;
          })}
          {g.nodes.map((n) => {
            const dim = focus && !linked.has(n.id);
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y - 16})`} className={`axp-plugin-manager-node is-${n.kind} ${n.row2 ? `is-${n.row2.health}` : ''} ${n.missing ? 'is-missing' : ''} ${dim ? 'is-dim' : ''} ${n.row2?.folder === selected ? 'is-selected' : ''}`}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover('')} onClick={() => n.row2 && onSelect(n.row2.folder)} tabIndex={n.row2 ? 0 : -1}
                onKeyDown={(e) => { if (n.row2 && (e.key === 'Enter' || e.key === ' ')) onSelect(n.row2.folder); }}>
                <rect width={NODE_W} height="32" rx={n.kind === 'service' ? 16 : 6} className="axp-plugin-manager-node__box" />
                {n.kind === 'plugin' && <circle cx="14" cy="16" r="5" className="axp-plugin-manager-node__dot" />}
                <text x={n.kind === 'plugin' ? 26 : NODE_W / 2} y="20" textAnchor={n.kind === 'plugin' ? 'start' : 'middle'} className="axp-plugin-manager-node__label">{n.label.length > 19 ? `${n.label.slice(0, 18)}…` : n.label}</text>
                <title>{n.kind === 'plugin' ? `${n.label} · ${HEALTH_LABEL[n.row2!.health]}` : `${n.label} · ${n.providers ? `${n.providers} provider(s)` : 'no provider installed'}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      {selRow && (
        <div className="axp-plugin-manager-graph__info">
          <strong>{selRow.name}</strong>
          {selRow.dependencies.filter((d) => d.kind === 'service' || d.kind === 'plugin').map((d) => (
            <span key={d.name} className="axp-plugin-manager-meta"><code>{d.name}</code> <Chip tone={d.status === 'ok' ? 'success' : d.required ? 'danger' : 'warning'}>{d.required ? 'requires' : 'optional'} · {d.status}</Chip></span>
          ))}
          {selRow.dependents.map((d) => <span key={d.folder + d.service} className="axp-plugin-manager-meta">used by <strong>{d.name}</strong> ({d.service})</span>)}
          {!selRow.dependencies.some((d) => d.kind === 'service' || d.kind === 'plugin') && !selRow.dependents.length && <span className="fx-muted fx-small">Standalone: no capability links.</span>}
        </div>
      )}
    </div>
  );
}

/** The engine lays the graph out (columns + half-step rows, same on every port); this only maps it to pixels. */
function buildGraph(rows: PluginRow[], inv: Inventory) {
  const g = pluginGraph(rows, inv.services);
  const byFolder = new Map(rows.map((r) => [r.folder, r]));
  const nodes: Node[] = g.nodes.map((n) => ({ ...n, x: COLX[n.column], y: TOP + n.row * ROW, row2: n.folder ? byFolder.get(n.folder) : undefined }));
  return { nodes, edges: g.edges, width: COLX[2] + NODE_W + 26, height: TOP + g.rows * ROW };
}

function Empty() {
  return <p className="axp-plugin-manager-empty">No plugins match.</p>;
}
