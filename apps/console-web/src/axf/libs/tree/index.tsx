/**
 * lib-tree — a categorized tree (library@1 `ai.amberx.axf.tree`): branches with leaves and sub-branches, folding, search
 * with highlight (matching leaves keep their branches open), filter chips, branch meters, multi-select, context-menu
 * targets (`data-fx-ctx-target`) and drag-and-drop through lib-dnd. The app owns the data and the state; the tree only
 * draws it and reports what the person did.
 * Parts (installed config `libraries.tree.parts`): search {placeholder}, chips, meters, drag {trash}, multi.
 */
import { useEffect, type ReactNode, type PointerEvent as RPointerEvent, type Ref as RRef } from 'react';
import { Icon, IconButton, Meter } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
import { partOn, partParams, type LibraryPart } from '../../core/library';
import { registerZone, startDrag, type DropPos } from '../dnd';
import spec from './library.json';
import './tree.css';

export const TREE_LIBRARY_ID = 'ai.amberx.axf.tree';
const PARTS = (spec as { parts: LibraryPart[] }).parts;
export interface TreeConfig { search: false | { placeholder: string }; chips: boolean; meters: boolean; drag: false | { trash: boolean }; multi: boolean }
let config: TreeConfig = { search: { placeholder: 'Search' }, chips: true, meters: true, drag: { trash: true }, multi: false };
export function configureTree(installed: { parts?: Record<string, unknown> } | null | undefined): TreeConfig {
  const pp = (id: string) => partParams(installed, id, PARTS.find((p) => p.id === id));
  config = {
    search: partOn(installed, 'search', PARTS) ? { placeholder: String(pp('search').placeholder ?? 'Search') } : false,
    chips: partOn(installed, 'chips', PARTS), meters: partOn(installed, 'meters', PARTS),
    drag: partOn(installed, 'drag', PARTS) ? { trash: pp('drag').trash !== false } : false,
    multi: partOn(installed, 'multi', PARTS),
  };
  return config;
}
export const treeConfig = () => config;

export interface TreeLeaf { id: string; label: string; icon?: string; dot?: ReactNode; meta?: ReactNode; ctx?: { target: string; payload?: string } }
export interface TreeBranch { id: string; label: string; icon?: string; meta?: ReactNode; progress?: number; collapsed?: boolean; leaves: TreeLeaf[]; branches: TreeBranch[]; ctx?: { target: string; payload?: string }; fixed?: boolean }
export interface TreeViewProps {
  branches: TreeBranch[];
  /** a drop line at the top for "into the top level" (its id is the root branch's) */
  rootDrop?: { id: string; label: string };
  selected?: { leaf?: string | null; branch?: string | null; multi?: readonly string[] };
  query?: string;
  /** leaves that pass the filters; branches without any are hidden while filtering */
  filter?: (leaf: TreeLeaf) => boolean;
  filtering?: boolean;
  onToggle?: (branchId: string) => void;
  onSelectLeaf?: (id: string, additive: boolean) => void;
  onSelectBranch?: (id: string) => void;
  /** a drop: what moved where (leaf / branch, before / after / inside) */
  onMove?: (item: { kind: 'leaf' | 'branch'; id: string }, target: { kind: 'leaf' | 'branch'; id: string }, pos: DropPos) => void;
  onTrash?: (item: { kind: 'leaf' | 'branch'; id: string; label: string }) => void;
  /** lib-dnd zone name; give two trees different names */
  zone?: string;
  label?: string;
}

/** Highlights the first match of `q` in `text`. */
export function Highlight({ text, q }: { text: string; q?: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="axf-tree-mark">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function TreeView(p: TreeViewProps) {
  const zone = p.zone ?? 'axf-tree';
  const drag = config.drag;
  useEffect(() => {
    if (!drag || !p.onMove) return;
    return registerZone(zone, {
      accepts: (d, target) => (d.kind === `${zone}:leaf` || d.kind === `${zone}:branch`) && d.id !== target.split(':')[1],
      positions: (_d, target) => (target.startsWith('leaf:') ? ['before', 'after'] : target === `branch:${p.rootDrop?.id}` ? ['inside'] : ['before', 'inside', 'after']),
      drop: (d, target, pos) => { const [kind, id] = target.split(':') as ['leaf' | 'branch', string]; p.onMove!({ kind: d.kind.endsWith(':leaf') ? 'leaf' : 'branch', id: d.id }, { kind, id }, pos); },
    });
  }, [zone, drag, p.onMove, p.rootDrop?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pass = (l: TreeLeaf) => !p.filter || p.filter(l);
  const any = (b: TreeBranch): boolean => b.leaves.some(pass) || b.branches.some(any);
  const dragProps = (kind: 'leaf' | 'branch', id: string, label: string, icon?: string) => (drag && p.onMove ? {
    onPointerDown: (e: RPointerEvent) => startDrag(e, { kind: `${zone}:${kind}`, id, label, icon, trashable: !!(drag.trash && p.onTrash), onTrash: p.onTrash ? () => p.onTrash!({ kind, id, label }) : undefined }),
  } : {});
  const indent = (d: number, extra = 0) => ({ paddingInlineStart: `calc(var(--fx-space) * ${d * 1.6 + extra})` });

  const branch = (b: TreeBranch, depth: number): ReactNode => {
    if (p.filtering && !any(b)) return null;
    const open = p.filtering || !b.collapsed;
    return (
      <li key={b.id} role="treeitem" aria-expanded={open} aria-selected={p.selected?.branch === b.id}>
        <div className={`axf-tree-row axf-tree-row--branch ${p.selected?.branch === b.id ? 'is-active' : ''}`} style={indent(depth, 0.5)}
          data-axf-drop={drag ? zone : undefined} data-axf-drop-id={`branch:${b.id}`} data-fx-ctx-target={b.ctx?.target} data-fx-ctx-payload={b.ctx?.payload}
          {...(b.fixed ? {} : dragProps('branch', b.id, b.label, b.icon ?? 'folder'))}>
          <IconButton icon={open ? 'chevron-down' : 'chevron-right'} label={open ? 'Collapse' : 'Expand'} onClick={() => p.onToggle?.(b.id)} />
          <span className="axf-dnd-grip"><Icon name={b.icon ?? 'folder'} size={14} /></span>
          <button type="button" data-fx-row className="axf-tree-label" onClick={() => p.onSelectBranch?.(b.id)}><Highlight text={b.label} q={p.query} /></button>
          {b.meta != null && <span className="axf-tree-meta">{b.meta}</span>}
          {config.meters && b.progress != null && <span className="axf-tree-meter"><Meter value={b.progress} small done={b.progress >= 100} label={`${Math.round(b.progress)}% of ${b.label}`} /></span>}
        </div>
        {open && (
          <ul role="group">
            {b.leaves.filter((l) => !p.filtering || pass(l)).map((l) => (
              <li key={l.id} role="treeitem" aria-selected={p.selected?.leaf === l.id}>
                <div className={`axf-tree-row ${p.selected?.leaf === l.id ? 'is-active' : ''} ${p.selected?.multi?.includes(l.id) ? 'is-multi' : ''}`} style={indent(depth, 3)}
                  data-axf-drop={drag ? zone : undefined} data-axf-drop-id={`leaf:${l.id}`} data-fx-ctx-target={l.ctx?.target} data-fx-ctx-payload={l.ctx?.payload}
                  {...dragProps('leaf', l.id, l.label, l.icon)}>
                  <span className="axf-dnd-grip">{l.dot ?? <Icon name={l.icon ?? 'file'} size={13} />}</span>
                  <button type="button" data-fx-row className="axf-tree-label" onClick={(e) => p.onSelectLeaf?.(l.id, config.multi && (e.ctrlKey || e.metaKey))}>
                    {l.dot && l.icon && <Icon name={l.icon} size={13} />} <Highlight text={l.label} q={p.query} />
                  </button>
                  {l.meta != null && <span className="axf-tree-meta">{l.meta}</span>}
                </div>
              </li>
            ))}
            {b.branches.map((c) => branch(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };
  return (
    <ul className="axf-tree" role="tree" aria-label={p.label ?? 'Tree'}>
      {p.rootDrop && <li role="none"><div className="axf-tree-root" data-axf-drop={drag ? zone : undefined} data-axf-drop-id={`branch:${p.rootDrop.id}`}>{p.rootDrop.label}</div></li>}
      {p.branches.map((b) => branch(b, 0))}
    </ul>
  );
}

/** The search box + chips row a tree usually sits under (each shown only when its part is on). */
export function TreeSearch({ query, onQuery, chips, inputRef, children }: { query: string; onQuery: (q: string) => void; chips?: { id: string; label: ReactNode; on: boolean; onToggle: () => void }[]; inputRef?: RRef<HTMLInputElement>; children?: ReactNode }) {
  return (
    <>
      {(config.search || children) && (
        <div className="axf-tree-tools">
          {config.search && <div className="fx-search axf-tree-search"><Icon name="search" size={14} /><input ref={inputRef} className="fx-input" placeholder={config.search.placeholder} value={query} onChange={(e) => onQuery(e.target.value)} aria-label={config.search.placeholder} /></div>}
          {children}
        </div>
      )}
      {config.chips && chips && chips.length > 0 && (
        <div className="axf-tree-tools">
          {chips.map((c) => <button key={c.id} type="button" className={`fx-chip ${c.on ? 'is-on' : ''}`} aria-pressed={c.on} onClick={c.onToggle}>{c.label}</button>)}
        </div>
      )}
    </>
  );
}

export const library: AxfWebLibrary = {
  id: TREE_LIBRARY_ID,
  label: 'Tree view',
  version: '0.1.0',
  provides: ['axf.tree'],
  register(rt) { configureTree((rt.manifest as { libraries?: Record<string, { parts?: Record<string, unknown> }> }).libraries?.tree); },
};
