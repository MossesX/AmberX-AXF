/**
 * Multi-select for every list in the framework (Brett, Nov 4 2026: "If you hold down Control, it will put up a list of
 * checkboxes, and if you click one, it stays."): click selects one row, Ctrl / Cmd + click adds to the selection,
 * Shift + click selects a range; holding Ctrl reveals a checkbox on every row ("peek"), and once one is ticked checkbox
 * mode stays on after the key is let go, until the selection is cleared, Esc is pressed or an action finishes. On a
 * phone a long-press enters checkbox mode. A selection bar shows the count and the actions (a toolbar, so the
 * tap-to-confirm rule applies on touch).
 *
 *   const sel = useMultiSelect(ids);                 // ids in list order (for Shift ranges)
 *   <li {...sel.rowProps(id)}> {sel.showBoxes && <SelectBox sel={sel} id={id} />} … </li>
 *   <SelectionBar sel={sel} label="Steps" actions={[{ id, label, icon, run: (ids) => … }]} />
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';
import { Button } from './Controls';
import { Checkbox } from './Forms';
import { Icon } from './Icon';

export const LONG_PRESS_MS = 500;
export type SelectMode = 'off' | 'peek' | 'on';

export interface SelectAction { id: string; label: string; icon?: string; tone?: 'primary' | 'neutral' | 'danger' | 'success'; disabled?: boolean; title?: string; run: (ids: string[]) => void | Promise<void> }
export interface MultiSelect {
  ids: readonly string[];
  selected: Set<string>;
  mode: SelectMode;
  /** checkboxes drawn (peek while Ctrl is held, or sticky after a tick) */
  showBoxes: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string, on?: boolean) => void;
  select: (id: string, e?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  selectAll: () => void;
  clear: () => void;
  setMode: (m: SelectMode) => void;
  /** spread on every row: click / ctrl-click / shift-click, long-press on touch */
  rowProps: (id: string) => { onClick: (e: RMouseEvent) => void; onPointerDown: (e: RPointerEvent) => void; onPointerUp: () => void; onPointerCancel: () => void; 'data-fx-selected'?: 'on'; 'aria-selected': boolean };
}

/** The selection state of one list. `ids` must be in display order (Shift ranges follow it). */
export function useMultiSelect(ids: readonly string[], opts: { onChange?: (ids: string[]) => void } = {}): MultiSelect {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [mode, setModeState] = useState<SelectMode>('off');
  const anchor = useRef<string>('');
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idsRef = useRef(ids); idsRef.current = ids;
  const onChange = opts.onChange;
  useEffect(() => { onChange?.([...selected]); }, [selected, onChange]);
  // drop ids that left the list
  useEffect(() => { setSelected((s) => { const keep = new Set([...s].filter((x) => ids.includes(x))); return keep.size === s.size ? s : keep; }); }, [ids]);
  // Ctrl held = peek (checkboxes show); let go = back to off unless a tick made it sticky; Esc clears
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if ((e.key === 'Control' || e.key === 'Meta') && mode === 'off') setModeState('peek'); if (e.key === 'Escape' && (mode !== 'off' || selected.size)) { setSelected(new Set()); setModeState('off'); } };
    const up = (e: KeyboardEvent) => { if ((e.key === 'Control' || e.key === 'Meta') && mode === 'peek') setModeState('off'); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [mode, selected.size]);
  const setMode = useCallback((m: SelectMode) => setModeState(m), []);
  const toggle = useCallback((id: string, on?: boolean) => {
    setSelected((s) => { const n = new Set(s); const want = on ?? !n.has(id); if (want) n.add(id); else n.delete(id); return n; });
    anchor.current = id;
    setModeState('on'); // a tick makes checkbox mode sticky
  }, []);
  const select = useCallback((id: string, e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) => {
    const list = idsRef.current;
    if (e.shiftKey && anchor.current && list.includes(anchor.current)) {
      const a = list.indexOf(anchor.current); const b = list.indexOf(id); const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected((s) => { const n = e.ctrlKey || e.metaKey ? new Set(s) : new Set<string>(); for (let i = lo; i <= hi; i++) n.add(list[i]!); return n; });
      setModeState('on'); return;
    }
    if (e.ctrlKey || e.metaKey) { toggle(id); return; }
    anchor.current = id;
    if (mode === 'on') { toggle(id); return; }
    setSelected(new Set([id]));
  }, [mode, toggle]);
  const clear = useCallback(() => { setSelected(new Set()); setModeState('off'); anchor.current = ''; }, []);
  const selectAll = useCallback(() => { setSelected(new Set(idsRef.current)); setModeState('on'); }, []);
  const rowProps = useCallback((id: string) => ({
    onClick: (e: RMouseEvent) => { if ((e.target as HTMLElement).closest('button, input, a, textarea, select, [data-fx-no-select]')) return; select(id, e); },
    onPointerDown: (e: RPointerEvent) => { if (e.pointerType !== 'touch') return; if (press.current) clearTimeout(press.current); press.current = setTimeout(() => { press.current = null; toggle(id, true); }, LONG_PRESS_MS); },
    onPointerUp: () => { if (press.current) { clearTimeout(press.current); press.current = null; } },
    onPointerCancel: () => { if (press.current) { clearTimeout(press.current); press.current = null; } },
    ...(selected.has(id) ? { 'data-fx-selected': 'on' as const } : {}),
    'aria-selected': selected.has(id),
  }), [select, toggle, selected]);
  return useMemo(() => ({ ids, selected, mode, showBoxes: mode !== 'off', isSelected: (id: string) => selected.has(id), toggle, select, selectAll, clear, setMode, rowProps }), [ids, selected, mode, toggle, select, selectAll, clear, setMode, rowProps]);
}

/** The checkbox a row shows in checkbox mode. */
export function SelectBox({ sel, id, label = 'Select' }: { sel: MultiSelect; id: string; label?: string }) {
  if (!sel.showBoxes) return null;
  return <span className="fx-selectbox" data-fx-no-select onClick={(e) => e.stopPropagation()}><Checkbox label={label} checked={sel.isSelected(id)} onChange={(v) => sel.toggle(id, v)} /></span>;
}

/** The bar above a list with a selection: count, the actions, select all, clear. Nothing while nothing is selected. */
export function SelectionBar({ sel, label, actions, className = '' }: { sel: MultiSelect; label: string; actions: SelectAction[]; className?: string }) {
  const [busy, setBusy] = useState('');
  if (!sel.selected.size && sel.mode === 'off') return null;
  const ids = [...sel.selected];
  const run = async (a: SelectAction) => { setBusy(a.id); try { await a.run(ids); } finally { setBusy(''); sel.clear(); } };
  return (
    <div className={`fx-selectbar ${className}`.trim()} role="toolbar" aria-label={`${label} selection`} data-axf-toolbar={`selection-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <span className="fx-selectbar__count"><Icon name="check-square" size={14} /> {ids.length} {label.toLowerCase()} selected</span>
      {actions.map((a) => <Button key={a.id} size="sm" icon={a.icon} tone={a.tone} disabled={a.disabled || !ids.length || !!busy} busy={busy === a.id} title={a.title} onClick={() => void run(a)}>{a.label}</Button>)}
      <Button size="sm" icon="check-square" onClick={sel.selectAll}>All</Button>
      <Button size="sm" icon="x" onClick={sel.clear}>Clear</Button>
    </div>
  );
}
