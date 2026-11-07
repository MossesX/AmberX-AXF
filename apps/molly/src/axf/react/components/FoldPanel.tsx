/**
 * FoldPanel: FoldSections for live UI. FoldSections folds Markdown text; this folds React children with the same look
 * (`.fx-fold` in framework/ui/axf.css), the same per-device memory (localStorage under `axf.fold:`) and the same
 * Expand all / Collapse all bar. Settings interfaces are built on it (settings-sections-everywhere, Brett, Nov 7 2026).
 *
 * A <FoldScope> owns one memory. Inside it every FoldPanel, and through `useFold` the framework's <Section> and
 * <Container>, folds and remembers itself under a path made of its ancestors' ids, so a custom panel's own sections
 * collapse with no change to the panel. Outside a scope <Section> and <Container> behave as they always did.
 * Closed bodies stay mounted (`hidden`): search anchors inside them still resolve, and `revealFolds` opens the way.
 */
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from './Icon';

const PREFIX = 'axf.fold:';
const ALL = '__all';
type Memory = Record<string, boolean>;

class FoldMemory {
  private mem: Memory = {};
  private rev = 0;
  private readonly subs = new Set<() => void>();
  constructor(private readonly key: string) {
    try { const v = JSON.parse(localStorage.getItem(PREFIX + key) ?? '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) this.mem = v as Memory; } catch { /* storage off: folds just aren't kept */ }
  }
  readonly subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  readonly revision = () => this.rev;
  /** The path's own word, else the last Expand all / Collapse all (unless the fold stays out of it), else its default. */
  open(path: string, dflt: boolean, followAll: boolean): boolean { return this.mem[path] ?? (followAll ? this.mem[ALL] : undefined) ?? dflt; }
  private save(next: Memory) {
    this.mem = next; this.rev += 1;
    try { if (Object.keys(next).length) localStorage.setItem(PREFIX + this.key, JSON.stringify(next)); else localStorage.removeItem(PREFIX + this.key); } catch { /* storage full or off */ }
    this.subs.forEach((f) => f());
  }
  set(path: string, v: boolean) { this.save({ ...this.mem, [path]: v }); }
  /** Every fold in the scope, seen or not yet mounted. */
  setAll(v: boolean) { this.save({ [ALL]: v }); }
}

const memories = new Map<string, FoldMemory>();
function memoryOf(key: string): FoldMemory {
  let m = memories.get(key);
  if (!m) { m = new FoldMemory(key); memories.set(key, m); }
  return m;
}

interface Scope { key: string; memory: FoldMemory; path: string }
const ScopeContext = createContext<Scope | null>(null);

/** Everything inside folds and remembers itself on this device under `storageKey`. */
export function FoldScope({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const scope = useMemo<Scope>(() => ({ key: storageKey, memory: memoryOf(storageKey), path: '' }), [storageKey]);
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

/** Ids from a heading: lower case words joined by a dash. */
export const foldId = (title: unknown): string => (typeof title === 'string' ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '');

export interface Fold {
  /** inside a FoldScope, under a usable id */
  scoped: boolean;
  open: boolean;
  set: (open: boolean) => void;
  /** spread on the fold's root element: lets `revealFolds` find it */
  attrs: { 'data-axf-fold'?: string; 'data-axf-fold-key'?: string };
  /** wrap the fold's body in this, so what folds inside it nests its path under this one */
  Body: (p: { children: ReactNode }) => JSX.Element;
}

const Plain = ({ children }: { children: ReactNode }) => <>{children}</>;

/** One fold's state: remembered in the scope, plain local state outside one. `id` empty = local too. `followAll` false
 *  keeps a frame around the sections (a level container) out of Expand all / Collapse all, so the sections stay in view. */
export function useFold(id: string, defaultOpen = true, followAll = true): Fold {
  const scope = useContext(ScopeContext);
  const [local, setLocal] = useState(defaultOpen);
  const memory = scope?.memory;
  useSyncExternalStore(memory?.subscribe ?? noSub, memory?.revision ?? noRev, memory?.revision ?? noRev);
  const path = scope && id ? `${scope.path}/${id}` : '';
  const Body = useMemo(() => {
    if (!scope || !path) return Plain;
    const inner: Scope = { ...scope, path };
    return ({ children }: { children: ReactNode }) => <ScopeContext.Provider value={inner}>{children}</ScopeContext.Provider>;
  }, [scope, path]);
  if (!memory || !path) return { scoped: false, open: local, set: setLocal, attrs: {}, Body };
  return { scoped: true, open: memory.open(path, defaultOpen, followAll), set: (v) => memory.set(path, v), attrs: { 'data-axf-fold': path, 'data-axf-fold-key': scope!.key }, Body };
}
const noSub = () => () => {};
const noRev = () => 0;

/** Open every fold around an element (a search hit, a highlighted setting). */
export function revealFolds(el: Element | null): void {
  for (let p = el?.parentElement?.closest<HTMLElement>('[data-axf-fold]'); p; p = p.parentElement?.closest<HTMLElement>('[data-axf-fold]')) {
    const { axfFold: path, axfFoldKey: key } = p.dataset;
    if (path && key) memories.get(key)?.set(path, true);
  }
}

export interface FoldPanelProps {
  /** stable id within its parent; the memory path is built from it */
  id: string;
  title: ReactNode;
  icon?: string;
  /** a small chip after the title (the section a lone item belongs to) */
  tag?: string;
  /** count chip */
  count?: number;
  /** right side of the heading row (a count, a button) */
  aside?: ReactNode;
  defaultOpen?: boolean;
  anchor?: string;
  className?: string;
  children: ReactNode;
}

export function FoldPanel({ id, title, icon, tag, count, aside, defaultOpen = true, anchor, className, children }: FoldPanelProps) {
  const fold = useFold(id, defaultOpen);
  const { Body } = fold;
  return (
    <section className={`fx-fold fx-foldpanel${fold.open ? ' is-open' : ''} ${className ?? ''}`} data-axf-anchor={anchor} {...fold.attrs}>
      <div className="fx-foldpanel__bar">
        <button type="button" data-fx-row className="fx-fold__head" aria-expanded={fold.open} onClick={() => fold.set(!fold.open)}>
          <Icon name={fold.open ? 'chevron-down' : 'chevron-right'} size={12} />
          {icon && <Icon name={icon} size={13} />}
          <span className="fx-fold__title">{title}</span>
          {tag && <span className="fx-fold__count">{tag}</span>}
          {count !== undefined && count > 0 && <span className="fx-fold__count">{count}</span>}
        </button>
        {aside}
      </div>
      <div className="fx-fold__body fx-foldpanel__body" hidden={!fold.open}><Body>{children}</Body></div>
    </section>
  );
}

/** Expand all / Collapse all for the scope it sits in. Reaches folds that haven't mounted yet. */
export function FoldTools({ label = 'Sections', summary }: { label?: string; summary?: string }) {
  const scope = useContext(ScopeContext);
  if (!scope) return null;
  return (
    <div className="fx-folds__tools" role="toolbar" aria-label={label}>
      <span className="fx-folds__summary">{summary}</span>
      <button type="button" className="fx-toolbtn" onClick={() => scope.memory.setAll(true)}><Icon name="chevron-down" size={12} />Expand all</button>
      <button type="button" className="fx-toolbtn" onClick={() => scope.memory.setAll(false)}><Icon name="chevron-right" size={12} />Collapse all</button>
    </div>
  );
}
