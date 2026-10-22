/**
 * The status grid, on lib-datagrid: a sub-grid per top-level section, nested sub-grids per sub-section, a row per piece
 * with status, progress, clip length, estimate, target and more. Columns hide from the header's context menu (lib-datagrid),
 * View › Grid columns, the Grid menu or the chooser; headers sort; rows expand; rows and sections drag to rearrange or
 * onto lib-dnd's trash can.
 */
import { useMemo } from 'react';
import { Button, Icon, IconButton, Meter, Segmented, useRuntime } from '../../axf/react';
import { DataGrid, type GridColumn, type GridGroup } from '../../axf/libs/datagrid';
import { STATUSES, autoProgress, cueSec, estimateSec, fmtDur, kindInfo, moveItem, pieceTarget, statusInfo, totals, trashItem, updatePiece, updateSection, words, type Piece, type Project, type Section } from '../model';
import { COLUMNS } from '../columns';
import { studio, useStudio } from '../store';
import { ui, useUi } from '../ui';
import { Highlight, StatusChip, filtering, passes } from './outline';

function columns(prj: Project, q: string): GridColumn<Piece>[] {
  const s = prj.settings;
  const est = (p: Piece) => estimateSec(p, s), tgt = (p: Piece) => pieceTarget(p, s);
  const R: Record<string, Pick<GridColumn<Piece>, 'render' | 'sortValue'>> = {
    title: { render: (p) => <span className="ws-cell-title"><Icon name={kindInfo(p.kind).icon} size={13} /><span className="ws-ellipsis"><Highlight text={p.title} q={q} /></span></span>, sortValue: (p) => p.title.toLowerCase() },
    status: { render: (p) => <StatusChip s={p.status} />, sortValue: (p) => STATUSES.findIndex((x) => x.id === p.status) },
    kind: { render: (p) => <span className="fx-small">{kindInfo(p.kind).label}</span>, sortValue: (p) => p.kind },
    progress: { render: (p) => <span className="ws-cell-meter"><Meter value={autoProgress(p)} small done={p.status === 'built'} active={p.status === 'partial'} label={`${autoProgress(p)}%`} /><span className="fx-small">{autoProgress(p)}%</span></span>, sortValue: autoProgress },
    clip: { render: (p) => (p.clipSec ? fmtDur(p.clipSec) : <span className="fx-muted">—</span>), sortValue: (p) => p.clipSec },
    est: { render: (p) => <span className={p.clipSec ? '' : 'ws-est'} title={p.clipSec ? 'recorded' : 'estimated while not recorded'}>{p.clipSec ? '' : '~'}{fmtDur(est(p))}</span>, sortValue: est },
    target: { render: (p) => (tgt(p) ? fmtDur(tgt(p)) : <span className="fx-muted">∞</span>), sortValue: tgt },
    delta: { render: (p) => { const t = tgt(p); if (!t) return <span className="fx-muted">—</span>; const d = est(p) - t; return <span className={d > t * 0.25 ? 'ws-tone-text--danger' : d > 0 ? 'ws-tone-text--warning' : 'ws-tone-text--success'}>{d > 0 ? '+' : '−'}{fmtDur(Math.abs(d))}</span>; }, sortValue: (p) => (tgt(p) ? est(p) - tgt(p) : 0) },
    cues: { render: (p) => `${p.cues.length}`, sortValue: (p) => p.cues.length },
    words: { render: (p) => `${words(p.narration)}`, sortValue: (p) => words(p.narration) },
    recording: { render: (p) => (p.recordingId || p.clipSec ? <Icon name="check-circle" size={14} /> : <span className="fx-muted">—</span>) },
    tags: { render: (p) => <span className="fx-small ws-ellipsis">{p.tags.join(', ')}</span> },
    url: { render: (p) => <span className="fx-small ws-ellipsis fx-mono">{p.url.replace(/^https:\/\//, '')}</span> },
    notes: { render: (p) => <span className="fx-small ws-ellipsis">{p.notes}</span> },
    updated: { render: (p) => <span className="fx-small">{new Date(p.updatedAt).toLocaleDateString()}</span>, sortValue: (p) => p.updatedAt },
  };
  return COLUMNS.map((c) => ({ ...c, ...R[c.id]!, sortable: c.sortable && !!R[c.id]?.sortValue }));
}

export function GridPane() {
  const rt = useRuntime();
  const project = useStudio((s) => s.project)!;
  const sel = useStudio((s) => s.selection);
  const g = useUi((s) => s.grid);
  const f = useUi((s) => s.index);
  const active = filtering(f);
  const cols = useMemo(() => columns(project, f.q), [project, f.q]);
  const tt = totals(project);

  const group = (s: Section): GridGroup<Piece> => {
    const t = totals(project, s);
    return {
      id: s.id, title: s.title, icon: s.icon, collapsed: !active && s.collapsed, fixed: s.id === 'root',
      rows: s.pieces.map((id) => project.pieces[id]).filter((p): p is Piece => !!p && (!active || passes(p, project, f))),
      groups: s.children.filter((c) => !active || hasMatch(c)).map(group),
      summary: `${t.pieces} pieces · ~${fmtDur(t.est)}${t.target ? ` / ${fmtDur(t.target)}` : ''}`, progress: t.progress,
      counts: STATUSES.filter((x) => t.byStatus[x.id]).map((x) => <span key={x.id} className={`ws-count ws-tone--${x.tone}`} title={x.label}>{t.byStatus[x.id]}</span>),
      ctx: { target: 'ws-section', payload: s.id },
    };
  };
  const hasMatch = (s: Section): boolean => s.pieces.some((id) => project.pieces[id] && passes(project.pieces[id]!, project, f)) || s.children.some(hasMatch);
  const groups = [
    ...(project.root.pieces.length ? [group({ ...project.root, title: 'Loose pieces', children: [] })] : []),
    ...project.root.children.filter((c) => !active || hasMatch(c)).map(group),
  ];

  return (
    <div className="ws-pane">
      <div className="ws-pane__tools">
        <span className="fx-small"><strong>{tt.pieces}</strong> pieces · ~{fmtDur(tt.est)}{project.settings.targetSec ? ` of ${fmtDur(project.settings.targetSec)}` : ''} · recorded {fmtDur(tt.clip)}</span>
        <span className="ws-grow ws-headmeter"><Meter value={tt.progress} label={`${Math.round(tt.progress)}% built`} active done={tt.progress >= 100} /></span>
        {STATUSES.map((s) => <span key={s.id} className={`ws-count ws-tone--${s.tone}`} title={s.label}>{tt.byStatus[s.id]}</span>)}
        <IconButton icon="sliders" label="Choose columns" onClick={() => rt.dispatch('ws.grid.columns')} />
        <IconButton icon={g.compact ? 'list' : 'minimize'} label="Compact rows" onClick={() => rt.dispatch('ws.grid.compact')} />
      </div>
      {g.sort && <div className="ws-pane__tools fx-small fx-muted"><Icon name="info" size={12} /> Sorted by {COLUMNS.find((c) => c.id === g.sort!.col)?.label} inside each section. <Button size="sm" tone="quiet" onClick={() => ui.patchGrid({ sort: null })}>Outline order</Button></div>}
      <div className="ws-pane__scroll">
        <DataGrid<Piece>
          id="status" label="Status grid" groups={groups} columns={cols} rowId={(p) => p.id} rowLabel={(p) => p.title}
          hidden={g.hidden} onToggleColumn={(c, on) => ui.toggleColumn(c, on)} onShowAll={() => ui.patchGrid({ hidden: [] })} onChooseColumns={() => rt.dispatch('ws.grid.columns')}
          sort={g.sort} onSort={(c) => rt.dispatch(c ? `ws.grid.sort:${c}` : 'ws.grid.sort')}
          expanded={g.expanded} onToggleExpand={(id) => ui.toggleExpanded(id)} renderDetail={(p) => <Detail p={p} prj={project} />}
          rowTone={(p) => statusInfo(p.status).tone} selected={sel.piece} multi={sel.multi}
          onRowClick={(p, e) => (e.ctrlKey || e.metaKey ? studio().toggleMulti(p.id) : studio().select({ piece: p.id, section: null, multi: [] }))}
          onToggleGroup={(id) => studio().edit('Fold', (q) => updateSection(q, id, { collapsed: !findCollapsed(q, id) }))}
          onGroupClick={(id) => studio().select({ section: id, piece: null })}
          rowCtx={(p) => ({ target: 'ws-piece', payload: p.id })} compact={g.compact} zone="ws-grid"
          onMove={(item, target, pos) => studio().edit('Move', (q) => moveItem(q, { kind: item.kind === 'row' ? 'piece' : 'section', id: item.id }, { kind: target.kind === 'row' ? 'piece' : 'section', id: target.id }, pos))}
          onTrash={(item) => { studio().edit('Delete', (q) => trashItem(q, { kind: item.kind === 'row' ? 'piece' : 'section', id: item.id })); rt.toast(`"${item.label}" moved to the trash.`, 'info', 'Deleted'); }}
          empty="Nothing matches the filters."
        />
      </div>
    </div>
  );
}

function findCollapsed(p: Project, id: string): boolean {
  let hit = false;
  const go = (s: Section) => { if (s.id === id) hit = !!s.collapsed; s.children.forEach(go); };
  go(p.root);
  return hit;
}

function Detail({ p, prj }: { p: Piece; prj: Project }) {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <Segmented size="sm" label="Status" value={p.status} options={STATUSES.map((s) => ({ value: s.id, label: s.label, icon: s.icon }))} onChange={(v) => studio().edit('Status', (q) => updatePiece(q, p.id, { status: v }))} />
      <p className="ws-narration">{p.narration || <span className="fx-muted">No narration yet.</span>}</p>
      {p.effect && <p className="fx-small"><Icon name="eye" size={12} /> <strong>Show:</strong> {p.effect}</p>}
      {p.cues.length > 0 && <ol className="ws-cues-mini">{p.cues.map((c) => <li key={c.id}><span className="fx-small fx-muted">{c.kind}</span> {c.target ?? ''} {c.text ? `“${c.text}”` : ''} <span className="fx-small fx-muted">{c.dur}s</span></li>)}</ol>}
      <p className="fx-small fx-muted">{words(p.narration)} words · narration ~{fmtDur(estimateSec({ ...p, cues: [], clipSec: 0 }, prj.settings))} · cues {fmtDur(cueSec(p))}{p.url ? ` · ${p.url}` : ''}</p>
      <div className="fx-row fx-row--wrap">
        <Button size="sm" icon="type" onClick={() => rt.dispatch(`ws.piece.script:${p.id}`)}>Edit script</Button>
        <Button size="sm" icon="monitor" onClick={() => rt.dispatch(`ws.piece.browser:${p.id}`)}>Open in browser</Button>
        <Button size="sm" icon="copy" onClick={() => rt.dispatch(`ws.item.dup:piece:${p.id}`)}>Duplicate</Button>
        <Button size="sm" tone="danger" icon="trash" onClick={() => rt.dispatch(`ws.item.delete:piece:${p.id}`)}>Delete</Button>
      </div>
    </div>
  );
}
