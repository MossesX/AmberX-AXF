/**
 * Icon Browser view: one filter bar (search, set, category, style, sort, view mode, tile size, tree thumbnails), the
 * library as a tree (sets → categories → icons), a virtualised grid or a list, multi-selection, drag out of any of
 * them (icon-drag@1 payload), and the details pane for the active icon. Glyphs are drawn from their pack's data
 * (loaded once per pack, ≤ 600 glyphs each) through the framework's glyphSvg, so a pack's style follows the theme.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Chip, Icon, IconButton, Segmented, Switch, useRuntime } from '@console/axf/react';
import { glyphSvg } from '@console/axf/core/engines/brand';
import { loadLibrary, loadPack, search, type IconPackAsset } from './api';
import { ICON_DROP_MIME, SORTS, VIEW_MODES, buildTree, dragPayload, filterIcons, flattenTree, gridWindow, values, type Config, type IconRecord, type Library, type SortKey, type TileSize, type TreeNode, type ViewMode } from './model';

/* ---------------- pack data cache (module level: every tile of a pack shares one load) */

const packData = new Map<string, IconPackAsset | null>();
const packWaiters = new Map<string, Set<() => void>>();
function ensurePack(id: string) {
  if (packData.has(id) || packWaiters.has(id)) return;
  packWaiters.set(id, new Set());
  loadPack(id).then((a) => { packData.set(id, a); }, () => { packData.set(id, null); }).finally(() => { const w = packWaiters.get(id); packWaiters.delete(id); w?.forEach((fn) => fn()); });
}
/** The pack's asset once loaded (re-renders the caller when it lands). */
export function usePackData(id: string): IconPackAsset | null | undefined {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!id || packData.has(id)) return;
    ensurePack(id);
    const fn = () => tick((n) => n + 1);
    packWaiters.get(id)?.add(fn);
    return () => { packWaiters.get(id)?.delete(fn); };
  }, [id]);
  return id ? packData.get(id) : null;
}
export const forgetPackData = (id: string) => { packData.delete(id); };

/** One glyph of a pack at a size (an empty box while the pack loads; the framework's own icon when the glyph is missing). */
export function GlyphArt({ pack, name, size = 24, className }: { pack: string; name: string; size?: number; className?: string }) {
  const a = usePackData(pack);
  const svg = a ? glyphSvg(a.data, name, size) : null;
  if (svg) return <span className={`axp-icon-browser__glyph ${className ?? ''}`} style={{ width: size, height: size, display: 'inline-grid' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
  if (a === null) return <Icon name={name} size={size} className={className} />;
  return <span className={`axp-icon-browser__glyph ${className ?? ''}`} style={{ width: size, height: size, display: 'inline-block' }} aria-hidden="true" />;
}

/* ---------------- measuring */

function useMeasure<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return [ref, box];
}

/* ---------------- the view */

export interface BrowserProps {
  config: Config;
  onConfig: (patch: Partial<Config>) => void;
  /** the icons selected (refs); the parent keeps them so panes and tab groups can take them */
  selection: IconRecord[];
  onSelection: (icons: IconRecord[]) => void;
  /** the icon whose details show */
  active: IconRecord | null;
  onActive: (icon: IconRecord | null) => void;
  /** actions the host offers on an icon or the selection (Add to pack, Open in a tab group…); drawn in the details pane */
  actions?: (icons: IconRecord[]) => ReactNode;
  /** extra panes beside the library (composer, details are the host's) */
  side?: ReactNode;
  /** a filter the host pins (the manager picks a scope's pack, say) */
  pinned?: Partial<{ set: string; category: string; style: string }>;
}

export function IconBrowser({ config, onConfig, selection, onSelection, active, onActive, actions, side, pinned }: BrowserProps) {
  const rt = useRuntime();
  const [library, setLibrary] = useState<Library | null>(null);
  const [all, setAll] = useState<IconRecord[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setError('');
    loadLibrary(retry > 0).then((l) => live && setLibrary(l), () => {});
    search({ limit: 20000, sort: 'name' }).then((r) => live && setAll(r.items), (e: Error) => live && setError(e.message || 'The icon library is not reachable.'));
    return () => { live = false; };
  }, [retry]);

  const set = pinned?.set ?? config.set; const category = pinned?.category ?? config.category; const style = pinned?.style ?? config.style;
  const shown = useMemo(() => filterIcons(all ?? [], { q, set, category, style }, config.sort), [all, q, set, category, style, config.sort]);
  const sets = useMemo(() => values(all ?? [], 'set'), [all]);
  const categories = useMemo(() => values((all ?? []).filter((i) => !set || i.set === set), 'category'), [all, set]);
  const styles = useMemo(() => values(all ?? [], 'style'), [all]);
  const setNames = useMemo(() => Object.fromEntries((library?.sets ?? []).map((s) => [s.id, s.name])), [library]);
  const tree = useMemo(() => (config.view === 'tree' ? buildTree(shown, setNames) : []), [shown, setNames, config.view]);
  const filtered = Boolean(q || set || category || style);
  const clear = () => { setQ(''); onConfig({ set: '', category: '', style: '' }); };

  const selectedRefs = useMemo(() => new Set(selection.map((i) => i.ref)), [selection]);
  const pick = useCallback((i: IconRecord, e?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }, list: IconRecord[] = shown) => {
    onActive(i);
    if (e?.shiftKey && active) {
      const a = list.findIndex((x) => x.ref === active.ref); const b = list.findIndex((x) => x.ref === i.ref);
      if (a >= 0 && b >= 0) { const range = list.slice(Math.min(a, b), Math.max(a, b) + 1); const refs = new Set(selection.map((x) => x.ref)); onSelection([...selection, ...range.filter((x) => !refs.has(x.ref))]); return; }
    }
    if (e?.metaKey || e?.ctrlKey) { onSelection(selectedRefs.has(i.ref) ? selection.filter((x) => x.ref !== i.ref) : [...selection, i]); return; }
    onSelection([i]);
  }, [active, onActive, onSelection, selection, selectedRefs, shown]);

  const dragStart = useCallback((e: DragEvent, i: IconRecord) => {
    const icons = selectedRefs.has(i.ref) && selection.length > 1 ? selection : [i];
    e.dataTransfer.setData(ICON_DROP_MIME, dragPayload(icons, 'library'));
    e.dataTransfer.setData('text/plain', icons.map((x) => x.ref).join('\n'));
    e.dataTransfer.effectAllowed = 'copy';
  }, [selection, selectedRefs]);

  const copyRef = useCallback((i: IconRecord) => {
    void navigator.clipboard?.writeText(i.ref).then(() => rt.toast(`Copied ${i.ref}.`, 'success', 'Icon browser'), () => rt.toast(i.ref, 'info', 'Icon ref'));
  }, [rt]);

  const thumbs = config.treeThumbs;
  return (
    <div className="axp-icon-browser">
      <div className="axp-icon-browser__bar" role="search">
        <input className="fx-input axp-icon-browser__search" type="search" aria-label="Search icons" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${all?.length ?? ''} icons`} title="By name, tag or category" />
        {!pinned?.set && sets.length > 1 && <select className="fx-input axp-icon-browser__pick" aria-label="Set" value={set} onChange={(e) => onConfig({ set: e.target.value, category: '' })}><option value="">Every set</option>{sets.map((s) => <option key={s} value={s}>{setNames[s] ?? (s === 'mine' ? 'My packs' : s)}</option>)}</select>}
        {!pinned?.category && categories.length > 1 && <select className="fx-input axp-icon-browser__pick" aria-label="Category" value={category} onChange={(e) => onConfig({ category: e.target.value })}><option value="">Any category</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
        {!pinned?.style && styles.length > 1 && <select className="fx-input axp-icon-browser__pick" aria-label="Style" value={style} onChange={(e) => onConfig({ style: e.target.value })}><option value="">Any style</option>{styles.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        <select className="fx-input axp-icon-browser__pick" aria-label="Sort by" value={config.sort} onChange={(e) => onConfig({ sort: e.target.value as SortKey })}>{SORTS.map((s) => <option key={s.id} value={s.id}>{`Sort: ${s.label}`}</option>)}</select>
        <Segmented label="View" size="sm" value={config.view} onChange={(v: ViewMode) => onConfig({ view: v })} options={VIEW_MODES.map((m) => ({ value: m.id, label: m.label, icon: m.icon }))} />
        {config.view === 'grid' && <Segmented label="Tile size" size="sm" value={config.tile} onChange={(v: TileSize) => onConfig({ tile: v })} options={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }]} />}
        {config.view === 'tree' && <Switch label="Thumbnails" checked={thumbs} onChange={(v) => onConfig({ treeThumbs: v })} />}
        <span className="axp-icon-browser__count" aria-live="polite">
          {all ? `${shown.length.toLocaleString()} of ${all.length.toLocaleString()}` : ''}{selection.length > 1 ? ` · ${selection.length} selected` : ''}
          {filtered && <IconButton icon="x" label="Clear filters" onClick={clear} />}
          {selection.length > 0 && <IconButton icon="x-circle" label="Clear selection" onClick={() => onSelection([])} />}
        </span>
      </div>

      <div className={`axp-icon-browser__body ${side || active ? 'has-side' : ''}`}>
        {error ? (
          <div className="axp-icon-browser__empty" role="status"><Icon name="cloud" size={24} /><p>{error}</p><Button icon="refresh" onClick={() => setRetry((n) => n + 1)}>Try again</Button></div>
        ) : !all ? (
          <div className="axp-icon-browser__skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: 24 }, (_, i) => <span key={i} className="axp-icon-browser__skel" />)}</div>
        ) : shown.length === 0 ? (
          <div className="axp-icon-browser__empty" role="status"><Icon name="search" size={24} /><p>No icon matches.</p><Button icon="x" onClick={clear}>Clear filters</Button></div>
        ) : config.view === 'grid' ? (
          <VirtualGrid items={shown} tile={config.tile} names={config.names} active={active?.ref ?? ''} selected={selectedRefs} onPick={pick} onDrag={dragStart} />
        ) : config.view === 'list' ? (
          <ListView items={shown} setNames={setNames} active={active?.ref ?? ''} selected={selectedRefs} onPick={pick} onDrag={dragStart} />
        ) : (
          <TreeView tree={tree} open={open} onOpen={setOpen} thumbs={thumbs} active={active?.ref ?? ''} selected={selectedRefs} onPick={(i, e) => pick(i, e, shown)} onPickBranch={(icons) => { onSelection(icons); onActive(icons[0] ?? null); }} onDrag={dragStart} />
        )}
        {(side || active) && (
          <div className="axp-icon-browser__side">
            {active && <DetailsPane icon={active} library={library} onClose={() => onActive(null)} onCopy={copyRef} actions={actions?.(selection.length > 1 && selectedRefs.has(active.ref) ? selection : [active])} />}
            {side}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- grid */

function VirtualGrid({ items, tile, names, active, selected, onPick, onDrag }: { items: IconRecord[]; tile: TileSize; names: boolean; active: string; selected: Set<string>; onPick: (i: IconRecord, e: KeyboardEvent | React.MouseEvent) => void; onDrag: (e: DragEvent, i: IconRecord) => void }) {
  const [ref, box] = useMeasure<HTMLDivElement>();
  const probe = useRef<HTMLSpanElement>(null);
  const [cell, setCell] = useState({ tile: 0, gap: 0, row: 1 });
  const [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => {
    const p = probe.current; if (!p) return;
    const cs = getComputedStyle(p); const t = p.offsetWidth || 1; const gap = parseFloat(cs.marginRight) || 0;
    setCell({ tile: t, gap, row: (p.offsetHeight || t) + gap });
  }, [tile, names, box.width]);
  const w = gridWindow({ count: items.length, width: box.width, tile: cell.tile, gap: cell.gap, scrollTop, height: box.height, rowHeight: cell.row });
  const visible = items.slice(w.start, w.end);
  const onKey = (e: KeyboardEvent, i: number) => {
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: w.cols, ArrowUp: -w.cols }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const next = items[Math.max(0, Math.min(items.length - 1, i + move))];
    if (next) { onPick(next, e); (ref.current?.querySelector(`[data-ref="${next.ref}"]`) as HTMLElement | null)?.focus(); }
  };
  return (
    <div ref={ref} className={`axp-icon-browser__scroller is-${tile}`} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} role="grid" aria-rowcount={w.rows} aria-colcount={w.cols} aria-label="Icons">
      <span ref={probe} className="axp-icon-browser__tile axp-icon-browser__probe" aria-hidden="true"><span className="axp-icon-browser__art" />{names && <span className="axp-icon-browser__tile-name">x</span>}</span>
      <div className="axp-icon-browser__canvas" style={{ height: w.total }}>
        <div className="axp-icon-browser__rows" style={{ transform: `translateY(${w.first * cell.row}px)`, gridTemplateColumns: `repeat(${w.cols}, ${cell.tile}px)` }}>
          {visible.map((a, k) => {
            const i = w.start + k;
            return (
              <button key={a.ref} type="button" role="gridcell" data-ref={a.ref} data-fx-row draggable onDragStart={(e) => onDrag(e, a)} className={`axp-icon-browser__tile ${active === a.ref ? 'is-active' : ''} ${selected.has(a.ref) ? 'is-selected' : ''}`} title={`${a.name} · ${a.set}${a.category ? ` · ${a.category}` : ''}`} aria-selected={selected.has(a.ref)} onClick={(e) => onPick(a, e)} onKeyDown={(e) => onKey(e, i)}>
                <span className="axp-icon-browser__art"><GlyphArt pack={a.pack} name={a.name} size={tile === 'sm' ? 20 : tile === 'lg' ? 40 : 28} /></span>
                {names && <span className="axp-icon-browser__tile-name">{a.name}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- list */

function ListView({ items, setNames, active, selected, onPick, onDrag }: { items: IconRecord[]; setNames: Record<string, string>; active: string; selected: Set<string>; onPick: (i: IconRecord, e: React.MouseEvent) => void; onDrag: (e: DragEvent, i: IconRecord) => void }) {
  const [ref, box] = useMeasure<HTMLDivElement>();
  const probe = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => { const p = probe.current; if (p) setRow((p.offsetHeight || 1) + (parseFloat(getComputedStyle(p).marginBottom) || 0)); }, [box.width]);
  const w = gridWindow({ count: items.length, width: box.width, tile: box.width || 1, gap: 0, scrollTop, height: box.height, rowHeight: row, overscan: 6 });
  return (
    <div ref={ref} className="axp-icon-browser__scroller" onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} role="listbox" aria-label="Icons" aria-multiselectable>
      <div ref={probe} className="axp-icon-browser__row axp-icon-browser__probe" aria-hidden="true"><span className="axp-icon-browser__thumb" /><span>x</span><span className="axp-icon-browser__row-meta">x</span><span className="axp-icon-browser__row-meta">x</span></div>
      <div className="axp-icon-browser__canvas" style={{ height: w.total }}>
        <div className="axp-icon-browser__list" style={{ transform: `translateY(${w.first * row}px)`, position: 'absolute', inset: '0 0 auto 0' }}>
          {items.slice(w.start, w.end).map((a) => (
            <button key={a.ref} type="button" role="option" data-fx-row draggable onDragStart={(e) => onDrag(e, a)} className={`axp-icon-browser__row ${active === a.ref ? 'is-active' : ''} ${selected.has(a.ref) ? 'is-selected' : ''}`} aria-selected={selected.has(a.ref)} onClick={(e) => onPick(a, e)}>
              <span className="axp-icon-browser__thumb"><GlyphArt pack={a.pack} name={a.name} size={20} /></span>
              <span className="axp-icon-browser__row-name">{a.name}</span>
              <span className="axp-icon-browser__row-meta">{setNames[a.set] ?? a.set}</span>
              <span className="axp-icon-browser__row-meta">{a.category || a.pack}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- tree */

function TreeView({ tree, open, onOpen, thumbs, active, selected, onPick, onPickBranch, onDrag }: { tree: TreeNode[]; open: Set<string>; onOpen: (s: Set<string>) => void; thumbs: boolean; active: string; selected: Set<string>; onPick: (i: IconRecord, e: React.MouseEvent) => void; onPickBranch: (icons: IconRecord[]) => void; onDrag: (e: DragEvent, i: IconRecord) => void }) {
  const [ref, box] = useMeasure<HTMLDivElement>();
  const probe = useRef<HTMLSpanElement>(null);
  const [row, setRow] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  useLayoutEffect(() => { const p = probe.current; if (p) setRow(p.offsetHeight || 1); }, [box.width, thumbs]);
  const rows = useMemo(() => flattenTree(tree, open), [tree, open]);
  const w = gridWindow({ count: rows.length, width: box.width, tile: box.width || 1, gap: 0, scrollTop, height: box.height, rowHeight: row, overscan: 8 });
  const toggle = (id: string) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); onOpen(next); };
  const leaves = (n: TreeNode): IconRecord[] => (n.icon ? [n.icon] : (n.children ?? []).flatMap(leaves));
  const branchDrag = (e: DragEvent, n: TreeNode) => { const icons = leaves(n); e.dataTransfer.setData(ICON_DROP_MIME, dragPayload(icons, 'library')); e.dataTransfer.setData('text/plain', icons.map((x) => x.ref).join('\n')); e.dataTransfer.effectAllowed = 'copy'; };
  return (
    <div ref={ref} className="axp-icon-browser__scroller" onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} role="tree" aria-label="Icon sets">
      <span ref={probe} className="axp-icon-browser__node axp-icon-browser__probe" aria-hidden="true"><span className="axp-icon-browser__thumb" /><span className="axp-icon-browser__node-label">x</span></span>
      <div className="axp-icon-browser__canvas" style={{ height: w.total }}>
        <div className="axp-icon-browser__tree" style={{ transform: `translateY(${w.first * row}px)`, position: 'absolute', inset: '0 0 auto 0' }}>
          {rows.slice(w.start, w.end).map(({ node, depth }) => {
            const style = { '--axp-icon-browser-depth': depth } as React.CSSProperties;
            if (node.icon) {
              const a = node.icon;
              return (
                <button key={node.id} type="button" role="treeitem" aria-level={depth + 1} aria-selected={selected.has(a.ref)} data-fx-row draggable onDragStart={(e) => onDrag(e, a)} className={`axp-icon-browser__node is-icon ${active === a.ref ? 'is-active' : ''} ${selected.has(a.ref) ? 'is-selected' : ''}`} style={style} onClick={(e) => onPick(a, e)}>
                  {thumbs ? <span className="axp-icon-browser__thumb"><GlyphArt pack={a.pack} name={a.name} size={18} /></span> : <span className="axp-icon-browser__thumb" />}
                  <span className="axp-icon-browser__node-label">{a.name}</span>
                </button>
              );
            }
            const isOpen = open.has(node.id);
            const sample = thumbs ? leaves(node).slice(0, 3) : [];
            return (
              <button key={node.id} type="button" role="treeitem" aria-level={depth + 1} aria-expanded={isOpen} data-fx-row draggable onDragStart={(e) => branchDrag(e, node)} className="axp-icon-browser__node" style={style} onClick={() => toggle(node.id)} onDoubleClick={() => onPickBranch(leaves(node))} title={`${node.count} icon(s); double-click selects them all, drag takes them all`}>
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                {node.kind === 'set' ? <Icon name="package" size={16} /> : <Icon name="folder" size={16} />}
                <span className="axp-icon-browser__node-label">{node.label}</span>
                {sample.length > 0 && <span className="axp-icon-browser__thumbs" aria-hidden="true">{sample.map((s) => <GlyphArt key={s.ref} pack={s.pack} name={s.name} size={14} />)}</span>}
                <span className="axp-icon-browser__node-count">{node.count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- details */

export function DetailsPane({ icon, library, onClose, onCopy, actions }: { icon: IconRecord; library: Library | null; onClose: () => void; onCopy: (i: IconRecord) => void; actions?: ReactNode }) {
  const set = library?.sets.find((s) => s.id === icon.set);
  return (
    <section className="fx-card" aria-label={`${icon.name} details`}>
      <header className="fx-card__head"><h3 className="fx-card__title"><Icon name="info" size={16} /> {icon.name}</h3><IconButton icon="x" label="Close details" onClick={onClose} /></header>
      <div className="axp-icon-browser__hero">
        <div className="axp-icon-browser__sizes">
          {[16, 24, 32, 48].map((s) => <figure key={s} className="axp-icon-browser__size"><GlyphArt pack={icon.pack} name={icon.name} size={s} /><figcaption>{s}</figcaption></figure>)}
        </div>
      </div>
      <dl className="axp-icon-browser__facts">
        <div><dt>Set</dt><dd>{set?.name ?? (icon.set === 'mine' ? 'My packs' : icon.set)}</dd></div>
        <div><dt>Pack</dt><dd className="fx-mono">{icon.pack}</dd></div>
        {icon.category && <div><dt>Category</dt><dd>{icon.category}</dd></div>}
        {icon.style && <div><dt>Style</dt><dd>{icon.style}</dd></div>}
        {set && <div><dt>Licence</dt><dd>{set.license}{set.licenseUrl ? <> · <a href={set.licenseUrl} target="_blank" rel="noreferrer">text</a></> : null}</dd></div>}
        <div><dt>Ref</dt><dd className="fx-mono">{icon.ref}</dd></div>
      </dl>
      {icon.tags.length > 0 && <div className="axp-icon-browser__tags">{icon.tags.map((t) => <Chip key={t}>{t}</Chip>)}</div>}
      <div className="axp-icon-browser__actions">
        <Button icon="copy" size="sm" onClick={() => onCopy(icon)}>Copy ref</Button>
        {actions}
      </div>
    </section>
  );
}
