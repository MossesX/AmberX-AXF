/** Outline panes: Projects (the column of projects), Index (the categorized tree) and the Inspector. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Icon, IconButton, Meter, SelectField, Slider, Switch, TextField, useRuntime } from '../../axf/react';
import { KINDS, STATUSES, autoProgress, estimateSec, findSection, fmtDur, kindInfo, moveItem, parseDur, piecesUnder, statusInfo, totals, updatePiece, updateSection, words, type Piece, type Project, type Section } from '../model';
import { controllers } from '../commands';
import { registerZone, startDrag } from '../dnd';
import { studio, useStudio } from '../store';
import { ui, useUi } from '../ui';

/* ---------- shared ---------- */

export function StatusDot({ s }: { s: Piece['status'] }) {
  const i = statusInfo(s);
  return <span className={`ws-dot ws-tone--${i.tone}`} title={i.label} aria-label={i.label} />;
}
export function StatusChip({ s }: { s: Piece['status'] }) {
  const i = statusInfo(s);
  return <span className={`ws-status ws-tone--${i.tone}`}><Icon name={i.icon} size={12} />{i.label}</span>;
}

/** the one drop zone for moving pieces / sections, shared by the index, the grid and the timeline */
export function useTreeZone() {
  useEffect(() => registerZone('tree', {
    accepts: (p, target) => (p.kind === 'piece' || p.kind === 'section') && p.id !== target.split(':')[1],
    positions: (_p, target) => (target.startsWith('piece:') ? ['before', 'after'] : target === 'section:root' ? ['inside'] : ['before', 'inside', 'after']),
    drop: (p, target, pos) => {
      const [kind, id] = target.split(':') as ['piece' | 'section', string];
      studio().edit('Move', (q) => moveItem(q, { kind: p.kind as 'piece' | 'section', id: p.id }, { kind, id }, pos));
    },
  }), []);
}

/** does a piece pass the index filters? */
export function passes(p: Piece, prj: Project, f: ReturnType<typeof ui.get>['index']): boolean {
  if (f.statuses.length && !f.statuses.includes(p.status)) return false;
  if (f.kinds.length && !f.kinds.includes(p.kind)) return false;
  if (f.only === 'recorded' && !(p.clipSec > 0 || p.recordingId)) return false;
  if (f.only === 'unrecorded' && (p.clipSec > 0 || p.recordingId)) return false;
  if (f.only === 'noNarration' && p.narration.trim()) return false;
  if (f.only === 'overTarget') { const t = p.targetSec || prj.settings.pieceTargetSec; if (!t || estimateSec(p, prj.settings) <= t) return false; }
  if (f.q) {
    const q = f.q.toLowerCase();
    if (![p.title, p.narration, p.kind, p.url, p.notes, p.effect ?? '', ...p.tags].some((x) => x.toLowerCase().includes(q))) return false;
  }
  return true;
}
export const filtering = (f: ReturnType<typeof ui.get>['index']) => !!(f.q || f.statuses.length || f.kinds.length || f.only !== 'all');

/* ---------- Projects ---------- */

export function ProjectsPane() {
  const rt = useRuntime();
  const projects = useStudio((s) => s.projects);
  const cur = useStudio((s) => s.project?.id);
  const hub = useStudio((s) => s.hub);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const list = projects.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="ws-pane">
      <div className="ws-pane__tools">
        <Button size="sm" tone="primary" icon="plus" onClick={() => rt.dispatch('ws.project.new')}>New</Button>
        <IconButton icon="copy" label="Duplicate" onClick={() => rt.dispatch('ws.project.duplicate')} />
        <IconButton icon="package" label="Compile" onClick={() => rt.dispatch('ws.project.compileOne')} />
        <IconButton icon="download" label="Export" onClick={() => rt.dispatch('ws.project.exportOne')} />
        <IconButton icon="upload" label="Import" onClick={() => rt.dispatch('ws.project.import')} />
        <IconButton icon="trash" label="Delete" onClick={() => rt.dispatch('ws.project.delete')} />
      </div>
      <div className="ws-pane__tools"><input className="fx-input ws-grow" placeholder="Find a project" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a project" /></div>
      <div className="ws-pane__scroll">
        {list.map((p) => (
          <div key={p.id} className={`ws-row ws-project ${p.id === cur ? 'is-active' : ''}`} data-fx-row role="button" tabIndex={0}
            onClick={() => p.id !== cur && void studio().open(p.id)} onDoubleClick={() => setEditing(p.id)}
            onKeyDown={(e) => e.key === 'Enter' && void studio().open(p.id)} data-fx-ctx-target="ws-project" data-fx-ctx-payload={p.id}>
            <Icon name={p.id === cur ? 'folder' : 'file'} size={16} />
            <div className="ws-grow ws-col">
              {editing === p.id
                ? <input className="fx-input" autoFocus defaultValue={p.name} onBlur={(e) => { void studio().rename(p.id, e.target.value.trim() || p.name); setEditing(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} onClick={(e) => e.stopPropagation()} />
                : <strong className="ws-ellipsis">{p.name}</strong>}
              <span className="fx-small fx-muted">{p.pieces} pieces · {new Date(p.updatedAt).toLocaleString()}</span>
            </div>
            <span className={`ws-where ws-tone--${p.where === 'device' ? 'muted' : 'info'}`} title={p.where === 'device' ? 'On this device' : p.where === 'hub' ? 'On axHub' : 'On this device and axHub'}><Icon name={p.where === 'device' ? 'smartphone' : 'cloud'} size={12} /></span>
          </div>
        ))}
        {!list.length && <p className="fx-muted ws-pad">No project matches.</p>}
      </div>
      <div className="ws-pane__foot">
        <Switch label="Keep projects on axHub" checked={hub.on} onChange={(v) => studio().setHub(v)} hint={hub.error ? hub.error : hub.on ? `Saved to ${hub.address || 'axHub'} too (data server, /data/walkthrough-studio)` : 'On this device only'} />
      </div>
    </div>
  );
}

/* ---------- Index ---------- */

export function IndexPane() {
  useTreeZone();
  const rt = useRuntime();
  const project = useStudio((s) => s.project)!;
  const sel = useStudio((s) => s.selection);
  const f = useUi((s) => s.index);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { controllers.indexSearch = () => searchRef.current?.focus(); return () => { controllers.indexSearch = undefined; }; }, []);
  const active = filtering(f);
  const kinds = useMemo(() => [...new Set(Object.values(project.pieces).map((p) => p.kind))].sort(), [project.pieces]);
  const match = (s: Section): boolean => piecesUnder(s).some((id) => project.pieces[id] && passes(project.pieces[id]!, project, f));
  const count = Object.values(project.pieces).filter((p) => passes(p, project, f)).length;

  const renderSection = (s: Section, depth: number): ReactNode => {
    if (active && !match(s)) return null;
    const open = active || !s.collapsed;
    const tt = totals(project, s);
    return (
      <li key={s.id} role="treeitem" aria-expanded={open} aria-selected={sel.section === s.id}>
        <div className={`ws-tree__row ws-tree__row--section ${sel.section === s.id ? 'is-active' : ''}`} style={{ paddingInlineStart: `calc(var(--fx-space) * ${depth * 1.6 + 0.5})` }}
          data-ws-drop="tree" data-ws-drop-id={`section:${s.id}`} data-fx-ctx-target="ws-section" data-fx-ctx-payload={s.id}
          onPointerDown={(e) => startDrag(e, { kind: 'section', id: s.id, label: s.title, icon: 'folder', trashable: true })}>
          <IconButton icon={open ? 'chevron-down' : 'chevron-right'} label={open ? 'Collapse' : 'Expand'} onClick={() => studio().edit('Fold', (p) => updateSection(p, s.id, { collapsed: !s.collapsed }))} />
          <span className="ws-grip"><Icon name={s.icon ?? 'folder'} size={14} /></span>
          <button type="button" className="ws-tree__label" data-fx-row onClick={() => studio().select({ section: s.id, piece: null })}><Highlight text={s.title} q={f.q} /></button>
          <span className="ws-tree__meta fx-small fx-muted">{tt.pieces} · {fmtDur(tt.est)}</span>
          <span className="ws-tree__meter"><Meter value={tt.progress} small done={tt.progress >= 100} label={`${Math.round(tt.progress)}% of ${s.title}`} /></span>
        </div>
        {open && (
          <ul role="group">
            {s.pieces.map((id) => project.pieces[id]).filter((p): p is Piece => !!p && (!active || passes(p, project, f))).map((p) => (
              <li key={p.id} role="treeitem" aria-selected={sel.piece === p.id}>
                <div className={`ws-tree__row ${sel.piece === p.id ? 'is-active' : ''} ${sel.multi.includes(p.id) ? 'is-multi' : ''}`} style={{ paddingInlineStart: `calc(var(--fx-space) * ${depth * 1.6 + 3})` }}
                  data-ws-drop="tree" data-ws-drop-id={`piece:${p.id}`} data-fx-ctx-target="ws-piece" data-fx-ctx-payload={p.id}
                  onPointerDown={(e) => startDrag(e, { kind: 'piece', id: p.id, label: p.title, icon: kindInfo(p.kind).icon, trashable: true })}>
                  <span className="ws-grip"><StatusDot s={p.status} /></span>
                  <button type="button" className="ws-tree__label" data-fx-row onClick={(e) => (e.ctrlKey || e.metaKey ? studio().toggleMulti(p.id) : studio().select({ piece: p.id, section: null, multi: [] }))}>
                    <Icon name={kindInfo(p.kind).icon} size={13} /> <Highlight text={p.title} q={f.q} />
                  </button>
                  <span className="ws-tree__meta fx-small fx-muted">{fmtDur(estimateSec(p, project.settings))}</span>
                </div>
              </li>
            ))}
            {s.children.map((c) => renderSection(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="ws-pane">
      <div className="ws-pane__tools">
        <div className="fx-search ws-grow">
          <Icon name="search" size={14} />
          <input ref={searchRef} className="fx-input" placeholder="Search titles, narration, tags, pages" value={f.q} onChange={(e) => ui.patchIndex({ q: e.target.value })} aria-label="Search the index" />
        </div>
        <IconButton icon="chevron-down" label="Expand all" onClick={() => rt.dispatch('ws.index.expand')} />
        <IconButton icon="chevron-right" label="Collapse all" onClick={() => rt.dispatch('ws.index.collapse')} />
        <IconButton icon="folder" label="Add section" onClick={() => rt.dispatch('ws.section.add')} />
        <IconButton icon="plus" label="Add piece" onClick={() => rt.dispatch('ws.piece.add')} />
      </div>
      <div className="ws-pane__tools ws-chips">
        {STATUSES.map((s) => (
          <button key={s.id} type="button" className={`fx-chip ${f.statuses.includes(s.id) ? 'is-on' : ''}`} aria-pressed={f.statuses.includes(s.id)} onClick={() => rt.dispatch(`ws.filter.status:${s.id}`)}>
            <span className={`ws-dot ws-tone--${s.tone}`} />{s.label}
          </button>
        ))}
      </div>
      <div className="ws-pane__tools">
        <select className="fx-input ws-grow" value={f.kinds[0] ?? ''} onChange={(e) => ui.patchIndex({ kinds: e.target.value ? [e.target.value] : [] })} aria-label="Kind">
          <option value="">Every kind</option>
          {kinds.map((k) => <option key={k} value={k}>{kindInfo(k).label}</option>)}
        </select>
        <select className="fx-input ws-grow" value={f.only} onChange={(e) => ui.patchIndex({ only: e.target.value as typeof f.only })} aria-label="Show">
          <option value="all">Everything</option><option value="recorded">Recorded</option><option value="unrecorded">Not recorded</option><option value="noNarration">No narration</option><option value="overTarget">Over target</option>
        </select>
        {active && <Button size="sm" tone="quiet" icon="x" onClick={() => rt.dispatch('ws.index.clear')}>{count}</Button>}
      </div>
      <div className="ws-pane__scroll">
        <ul className="ws-tree" role="tree" aria-label="Walkthrough index">
          <li role="none"><div className="ws-tree__root fx-small fx-muted" data-ws-drop="tree" data-ws-drop-id="section:root">{project.name} · drop here for the top level</div></li>
          {project.root.pieces.length > 0 && renderSection({ ...project.root, title: 'Loose pieces', children: [] }, 0)}
          {project.root.children.map((s) => renderSection(s, 0))}
        </ul>
      </div>
    </div>
  );
}

export function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="ws-mark">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/* ---------- Inspector ---------- */

export function InspectorPane() {
  const project = useStudio((s) => s.project)!;
  const sel = useStudio((s) => s.selection);
  const piece = sel.piece ? project.pieces[sel.piece] : undefined;
  const section = sel.section ? findSection(project.root, sel.section) : null;
  if (piece) return <PieceForm p={piece} prj={project} />;
  if (section) return <SectionForm s={section} prj={project} />;
  const tt = totals(project);
  return (
    <div className="ws-pane__scroll ws-pad fx-stack">
      <p className="fx-muted">Pick a piece or a section in the index or the grid.</p>
      <dl className="ws-dl"><dt>Pieces</dt><dd>{tt.pieces}</dd><dt>Estimated</dt><dd>{fmtDur(tt.est)}</dd><dt>Recorded</dt><dd>{fmtDur(tt.clip)}</dd><dt>Progress</dt><dd>{Math.round(tt.progress)}%</dd></dl>
    </div>
  );
}

const DurField = ({ label, sec, onChange, hint }: { label: string; sec: number; onChange: (s: number) => void; hint?: string }) => {
  const [txt, setTxt] = useState(sec ? fmtDur(sec) : '');
  useEffect(() => setTxt(sec ? fmtDur(sec) : ''), [sec]);
  return <TextField label={label} value={txt} placeholder="no limit" hint={hint ?? 'm:ss, 90, 1m30s, 2h; empty = default'} onChange={(v) => { setTxt(v); const n = parseDur(v); if (!isNaN(n)) onChange(n); }} />;
};

function PieceForm({ p, prj }: { p: Piece; prj: Project }) {
  const set = (patch: Partial<Piece>, label = 'Edit piece') => studio().edit(label, (q) => updatePiece(q, p.id, patch));
  const est = estimateSec(p, prj.settings);
  return (
    <div className="ws-pane__scroll ws-pad fx-stack">
      <TextField label="Title" value={p.title} onChange={(v) => set({ title: v }, `title:${p.id}`)} />
      <div className="ws-2col">
        <SelectField label="Status" value={p.status} options={STATUSES.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => set({ status: v as Piece['status'] })} />
        <SelectField label="Kind" value={p.kind} options={Object.entries(KINDS).map(([k, v]) => ({ value: k, label: v.label }))} onChange={(v) => set({ kind: v })} />
      </div>
      <div className="fx-stack">
        <Switch label="Progress worked out automatically" checked={p.progress == null} onChange={(v) => set({ progress: v ? null : autoProgress(p) })} hint="Narration 35 · cues 20 · recording 35 · built 100" />
        <Slider label="Progress" value={autoProgress(p)} min={0} max={100} unit="%" onChange={(v) => set({ progress: v }, `prog:${p.id}`)} />
        <Meter value={autoProgress(p)} done={p.status === 'built'} active={p.status === 'partial'} label="Progress" />
      </div>
      <TextField label="Page shown" value={p.url} mono placeholder="https://console.amberxai.com/#settings" onChange={(v) => set({ url: v }, `url:${p.id}`)} />
      <div className="ws-2col">
        <DurField label="Desired length" sec={p.targetSec} onChange={(n) => set({ targetSec: n }, `tgt:${p.id}`)} hint={`empty = project default ${prj.settings.pieceTargetSec ? fmtDur(prj.settings.pieceTargetSec) : '(no limit)'}`} />
        <DurField label="Recorded clip" sec={p.clipSec} onChange={(n) => set({ clipSec: n }, `clip:${p.id}`)} hint="length of the clip once recorded" />
      </div>
      <p className="fx-small fx-muted">Estimate {fmtDur(est)} · {words(p.narration)} words · {p.cues.length} cues</p>
      <TextField label="Show the effect" rows={2} value={p.effect ?? ''} onChange={(v) => set({ effect: v }, `fx:${p.id}`)} placeholder="Flip Spacing to Regular: every row grows" />
      <TextField label="Tags" value={p.tags.join(', ')} onChange={(v) => set({ tags: v.split(',').map((x) => x.trim()).filter(Boolean) }, `tags:${p.id}`)} />
      <TextField label="Notes" rows={3} value={p.notes} onChange={(v) => set({ notes: v }, `notes:${p.id}`)} />
      <p className="fx-small fx-muted">Updated {new Date(p.updatedAt).toLocaleString()} · id {p.id}</p>
    </div>
  );
}

function SectionForm({ s, prj }: { s: Section; prj: Project }) {
  const tt = totals(prj, s);
  return (
    <div className="ws-pane__scroll ws-pad fx-stack">
      <TextField label="Section title" value={s.title} onChange={(v) => studio().edit(`stitle:${s.id}`, (q) => updateSection(q, s.id, { title: v }))} />
      <TextField label="Icon" value={s.icon ?? ''} mono onChange={(v) => studio().edit(`sicon:${s.id}`, (q) => updateSection(q, s.id, { icon: v }))} hint="any framework icon name: zap, palette, cloud, key…" />
      <dl className="ws-dl">
        <dt>Pieces</dt><dd>{tt.pieces}</dd><dt>Sub-sections</dt><dd>{s.children.length}</dd><dt>Estimated</dt><dd>{fmtDur(tt.est)}</dd>
        <dt>Recorded</dt><dd>{fmtDur(tt.clip)}</dd><dt>Target</dt><dd>{tt.target ? fmtDur(tt.target) : 'no limit'}</dd>
        {STATUSES.flatMap((x) => [<dt key={x.id}>{x.label}</dt>, <dd key={`${x.id}-v`}>{tt.byStatus[x.id]}</dd>])}
      </dl>
      <Meter value={tt.progress} done={tt.progress >= 100} label={`${Math.round(tt.progress)}%`} />
    </div>
  );
}
