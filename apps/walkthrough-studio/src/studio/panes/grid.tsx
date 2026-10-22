/**
 * The status grid: one categorized sub-grid per top-level section, nested sub-grids per sub-section, a row per piece.
 * Rows expand (narration, effect, cues, quick status). Every column but the title hides from the header's context
 * menu, View › Grid columns, the Grid menu or the column chooser; headers sort. Rows and sections drag to rearrange
 * (or to the trash can that pops up at the bottom while dragging).
 */
import { type CSSProperties, type ReactNode } from 'react';
import { Icon, IconButton, Meter, Segmented, useRuntime } from '../../axf/react';
import { STATUSES, autoProgress, cueSec, estimateSec, fmtDur, kindInfo, pieceTarget, statusInfo, totals, updatePiece, updateSection, words, type Piece, type Project, type Section } from '../model';
import { COLUMNS } from '../columns';
import { startDrag } from '../dnd';
import { studio, useStudio } from '../store';
import { ui, useUi } from '../ui';
import { Highlight, StatusChip, filtering, passes, useTreeZone } from './outline';

type Row = { kind: 'section'; s: Section; depth: number } | { kind: 'piece'; p: Piece; depth: number };

function sortValue(p: Piece, prj: Project, col: string): number | string {
  switch (col) {
    case 'title': return p.title.toLowerCase();
    case 'status': return STATUSES.findIndex((s) => s.id === p.status);
    case 'kind': return p.kind;
    case 'progress': return autoProgress(p);
    case 'clip': return p.clipSec;
    case 'est': return estimateSec(p, prj.settings);
    case 'target': return pieceTarget(p, prj.settings);
    case 'delta': { const t = pieceTarget(p, prj.settings); return t ? estimateSec(p, prj.settings) - t : 0; }
    case 'cues': return p.cues.length;
    case 'words': return words(p.narration);
    case 'updated': return p.updatedAt;
    default: return 0;
  }
}

export function GridPane() {
  useTreeZone();
  const rt = useRuntime();
  const project = useStudio((s) => s.project)!;
  const sel = useStudio((s) => s.selection);
  const g = useUi((s) => s.grid);
  const f = useUi((s) => s.index);
  const cols = COLUMNS.filter((c) => c.fixed || !g.hidden.includes(c.id));
  const template = { '--ws-cols': `calc(var(--fx-space) * 3) ${cols.map((c) => c.width).join(' ')} calc(var(--fx-space) * 4)` } as CSSProperties;
  const active = filtering(f);

  const rows: Row[] = [];
  const walk = (s: Section, depth: number) => {
    const ids = s.pieces.filter((id) => project.pieces[id] && (!active || passes(project.pieces[id]!, project, f)));
    const hasAny = (x: Section): boolean => x.pieces.some((id) => project.pieces[id] && (!active || passes(project.pieces[id]!, project, f))) || x.children.some(hasAny);
    if (active && !hasAny(s)) return;
    rows.push({ kind: 'section', s, depth });
    if (s.collapsed && !active) return;
    let ps = ids.map((id) => project.pieces[id]!);
    if (g.sort) ps = [...ps].sort((a, b) => { const x = sortValue(a, project, g.sort!.col), y = sortValue(b, project, g.sort!.col); return (x < y ? -1 : x > y ? 1 : 0) * g.sort!.dir; });
    for (const p of ps) rows.push({ kind: 'piece', p, depth });
    for (const c of s.children) walk(c, depth + 1);
  };
  if (project.root.pieces.length) walk({ ...project.root, id: 'root', title: 'Loose pieces', children: [] }, 0);
  for (const s of project.root.children) walk(s, 0);
  const tt = totals(project);

  const cell = (c: string, p: Piece): ReactNode => {
    const est = estimateSec(p, project.settings), tgt = pieceTarget(p, project.settings);
    switch (c) {
      case 'title': return <span className="ws-cell-title"><Icon name={kindInfo(p.kind).icon} size={13} /><span className="ws-ellipsis"><Highlight text={p.title} q={f.q} /></span></span>;
      case 'status': return <StatusChip s={p.status} />;
      case 'kind': return <span className="fx-small">{kindInfo(p.kind).label}</span>;
      case 'progress': return <span className="ws-cell-meter"><Meter value={autoProgress(p)} small done={p.status === 'built'} active={p.status === 'partial'} label={`${autoProgress(p)}%`} /><span className="fx-small">{autoProgress(p)}%</span></span>;
      case 'clip': return p.clipSec ? fmtDur(p.clipSec) : <span className="fx-muted">—</span>;
      case 'est': return <span className={p.clipSec ? '' : 'ws-est'} title={p.clipSec ? 'recorded' : 'estimated while not recorded'}>{p.clipSec ? '' : '~'}{fmtDur(est)}</span>;
      case 'target': return tgt ? fmtDur(tgt) : <span className="fx-muted">∞</span>;
      case 'delta': { if (!tgt) return <span className="fx-muted">—</span>; const d = est - tgt; return <span className={d > tgt * 0.25 ? 'ws-tone-text--danger' : d > 0 ? 'ws-tone-text--warning' : 'ws-tone-text--success'}>{d > 0 ? '+' : '−'}{fmtDur(Math.abs(d))}</span>; }
      case 'cues': return `${p.cues.length}`;
      case 'words': return `${words(p.narration)}`;
      case 'recording': return p.recordingId || p.clipSec ? <Icon name="check-circle" size={14} /> : <span className="fx-muted">—</span>;
      case 'tags': return <span className="fx-small ws-ellipsis">{p.tags.join(', ')}</span>;
      case 'url': return <span className="fx-small ws-ellipsis fx-mono">{p.url.replace(/^https:\/\//, '')}</span>;
      case 'notes': return <span className="fx-small ws-ellipsis">{p.notes}</span>;
      case 'updated': return <span className="fx-small">{new Date(p.updatedAt).toLocaleDateString()}</span>;
      default: return null;
    }
  };

  return (
    <div className="ws-pane">
      <div className="ws-pane__tools">
        <span className="fx-small"><strong>{tt.pieces}</strong> pieces · ~{fmtDur(tt.est)}{project.settings.targetSec ? ` of ${fmtDur(project.settings.targetSec)}` : ''} · recorded {fmtDur(tt.clip)}</span>
        <span className="ws-grow ws-headmeter"><Meter value={tt.progress} label={`${Math.round(tt.progress)}% built`} active done={tt.progress >= 100} /></span>
        {STATUSES.map((s) => <span key={s.id} className={`ws-count ws-tone--${s.tone}`} title={s.label}>{tt.byStatus[s.id]}</span>)}
        <IconButton icon="sliders" label="Choose columns" onClick={() => rt.dispatch('ws.grid.columns')} />
        <IconButton icon={g.compact ? 'list' : 'minimize'} label="Compact rows" onClick={() => rt.dispatch('ws.grid.compact')} />
      </div>
      {g.sort && <div className="ws-pane__tools fx-small fx-muted"><Icon name="info" size={12} /> Sorted by {COLUMNS.find((c) => c.id === g.sort!.col)?.label} inside each section. <button type="button" className="fx-btn fx-btn--sm fx-btn--quiet" onClick={() => ui.patchGrid({ sort: null })}>Outline order</button></div>}
      <div className={`ws-pane__scroll ws-grid ${g.compact ? 'is-compact' : ''}`} style={template} role="grid" aria-label="Status grid">
        <div className="ws-grid__head" role="row">
          <span />
          {cols.map((c) => (
            <button key={c.id} type="button" role="columnheader" className={`fx-btn fx-btn--sm fx-btn--quiet ws-grid__hcell ${c.align === 'end' ? 'is-end' : ''}`} data-fx-ctx-target="ws-grid-header" data-fx-ctx-payload={c.id}
              aria-sort={g.sort?.col === c.id ? (g.sort.dir === 1 ? 'ascending' : 'descending') : 'none'} onClick={() => c.sortable && rt.dispatch(`ws.grid.sort:${c.id}`)} title="Click to sort · right-click for columns">
              {c.label}{g.sort?.col === c.id && <Icon name={g.sort.dir === 1 ? 'chevron-up' : 'chevron-down'} size={12} />}
            </button>
          ))}
          <IconButton icon="more" label="Columns" onClick={(e) => rt.openContext(e.clientX, e.clientY, 'ws-grid-header', '')} />
        </div>
        {rows.map((r) => r.kind === 'section' ? (
          <SectionRow key={`s-${r.s.id}`} s={r.s} depth={r.depth} prj={project} active={sel.section === r.s.id} />
        ) : (
          <PieceRow key={r.p.id} p={r.p} depth={r.depth} cols={cols.map((c) => c.id)} cell={cell} prj={project} sel={sel.piece === r.p.id} multi={sel.multi.includes(r.p.id)} expanded={g.expanded.includes(r.p.id)} />
        ))}
        {!rows.length && <p className="fx-muted ws-pad">Nothing matches the filters.</p>}
      </div>
    </div>
  );
}

function SectionRow({ s, depth, prj, active }: { s: Section; depth: number; prj: Project; active: boolean }) {
  const tt = totals(prj, s);
  return (
    <div className={`ws-grid__section ws-grid__section--d${Math.min(depth, 3)} ${active ? 'is-active' : ''}`} role="row" data-ws-drop="tree" data-ws-drop-id={`section:${s.id}`}
      data-fx-ctx-target="ws-section" data-fx-ctx-payload={s.id} style={{ paddingInlineStart: `calc(var(--fx-space) * ${depth * 2})` }}
      onPointerDown={(e) => s.id !== 'root' && startDrag(e, { kind: 'section', id: s.id, label: s.title, icon: 'folder', trashable: true })}>
      <span className="ws-grip"><Icon name="more" size={12} /></span>
      <IconButton icon={s.collapsed ? 'chevron-right' : 'chevron-down'} label={s.collapsed ? 'Expand' : 'Collapse'} onClick={() => studio().edit('Fold', (p) => updateSection(p, s.id, { collapsed: !s.collapsed }))} />
      <Icon name={s.icon ?? 'folder'} size={14} />
      <button type="button" data-fx-row className="ws-grid__stitle" onClick={() => studio().select({ section: s.id, piece: null })}>{s.title}</button>
      <span className="fx-small fx-muted">{tt.pieces} pieces · ~{fmtDur(tt.est)}{tt.target ? ` / ${fmtDur(tt.target)}` : ''}</span>
      <span className="ws-grow ws-grid__smeter"><Meter value={tt.progress} small done={tt.progress >= 100} label={`${Math.round(tt.progress)}%`} /></span>
      {STATUSES.filter((x) => tt.byStatus[x.id]).map((x) => <span key={x.id} className={`ws-count ws-tone--${x.tone}`} title={x.label}>{tt.byStatus[x.id]}</span>)}
    </div>
  );
}

function PieceRow({ p, depth, cols, cell, prj, sel, multi, expanded }: { p: Piece; depth: number; cols: string[]; cell: (c: string, p: Piece) => ReactNode; prj: Project; sel: boolean; multi: boolean; expanded: boolean }) {
  const rt = useRuntime();
  const st = statusInfo(p.status);
  return (
    <>
      <div className={`ws-grid__row ${sel ? 'is-active' : ''} ${multi ? 'is-multi' : ''} ws-tone-edge--${st.tone}`} role="row" aria-selected={sel}
        data-ws-drop="tree" data-ws-drop-id={`piece:${p.id}`} data-fx-ctx-target="ws-piece" data-fx-ctx-payload={p.id}
        onPointerDown={(e) => startDrag(e, { kind: 'piece', id: p.id, label: p.title, icon: kindInfo(p.kind).icon, trashable: true })}
        onClick={(e) => (e.ctrlKey || e.metaKey ? studio().toggleMulti(p.id) : studio().select({ piece: p.id, section: null, multi: [] }))}
        onDoubleClick={() => ui.toggleExpanded(p.id)}>
        <span className="ws-grip" style={{ marginInlineStart: `calc(var(--fx-space) * ${depth * 2})` }}><Icon name="more" size={12} /></span>
        {cols.map((c) => <span key={c} role="gridcell" className={`ws-grid__cell ${COLUMNS.find((x) => x.id === c)?.align === 'end' ? 'is-end' : ''}`}>{cell(c, p)}</span>)}
        <IconButton icon={expanded ? 'chevron-up' : 'chevron-down'} label={expanded ? 'Collapse row' : 'Expand row'} onClick={(e) => { e.stopPropagation(); ui.toggleExpanded(p.id); }} />
      </div>
      {expanded && (
        <div className="ws-grid__detail" role="row">
          <div className="fx-stack">
            <Segmented size="sm" label="Status" value={p.status} options={STATUSES.map((s) => ({ value: s.id, label: s.label, icon: s.icon }))} onChange={(v) => studio().edit('Status', (q) => updatePiece(q, p.id, { status: v }))} />
            <p className="ws-narration">{p.narration || <span className="fx-muted">No narration yet.</span>}</p>
            {p.effect && <p className="fx-small"><Icon name="eye" size={12} /> <strong>Show:</strong> {p.effect}</p>}
            {p.cues.length > 0 && <ol className="ws-cues-mini">{p.cues.map((c) => <li key={c.id}><span className="fx-small fx-muted">{c.kind}</span> {c.target ?? ''} {c.text ? `“${c.text}”` : ''} <span className="fx-small fx-muted">{c.dur}s</span></li>)}</ol>}
            <p className="fx-small fx-muted">{words(p.narration)} words · narration ~{fmtDur(estimateSec({ ...p, cues: [], clipSec: 0 }, prj.settings))} · cues {fmtDur(cueSec(p))}{p.url ? ` · ${p.url}` : ''}</p>
            <div className="fx-row fx-row--wrap">
              <button type="button" className="fx-btn fx-btn--sm" onClick={() => { studio().select({ piece: p.id }); rt.dispatch('ws.pane:script'); }}><Icon name="type" size={13} /> Edit script</button>
              <button type="button" className="fx-btn fx-btn--sm" onClick={() => { studio().select({ piece: p.id }); rt.dispatch('ws.browser.open'); }}><Icon name="monitor" size={13} /> Open in browser</button>
              <button type="button" className="fx-btn fx-btn--sm" onClick={() => rt.dispatch('ws.piece.duplicate')}><Icon name="copy" size={13} /> Duplicate</button>
              <button type="button" className="fx-btn fx-btn--sm fx-btn--danger" onClick={() => rt.dispatch(`ws.item.delete:piece:${p.id}`)}><Icon name="trash" size={13} /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
