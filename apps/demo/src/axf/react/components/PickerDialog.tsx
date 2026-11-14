/**
 * PickerDialog (picker@1, spec/PICKER.md § 2): the themed list every drop-down opens. A centred dialog on desktop, a
 * bottom sheet with a drag handle on phones (the root's `data-fx-narrow`, stamped from the layout asset's viewport
 * cut-offs, never a px breakpoint; the picker asset's `variant` can pin either). Search field at the threshold,
 * grouped sections with sticky labels, icons and descriptions, a check mark (single) or a checkbox (multiple) on chosen
 * rows, a Done button with the count in multiple mode.
 *
 * Every rule of what a key, a tap or a search does is the reference engine's (core/engines/picker.ts); this file only
 * draws its state. Styled only by `framework/ui/axf.css` (`.fx-picker*`), which reads the `--fx-picker-*` token family,
 * so a theme, a skin's `parts.picker` or a control@1 `tokens.picker` override restyles it.
 *
 * Accessibility: `role="dialog" aria-modal` named by its header, the list `role="listbox"` (`aria-multiselectable` in
 * multiple mode) driven through `aria-activedescendant`, rows `role="option" aria-selected aria-disabled`; the focus
 * starts on the search field (else the list), Tab / Shift+Tab stay inside the dialog, Escape closes and the focus goes
 * back to whatever opened it.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { IconButton } from './Controls';
import {
  PICKER_TYPEAHEAD_MS, choosePicker, closePicker, groupOptions, openPicker, pickerKey, searchShown, setQuery,
  type PickerKey, type PickerModel, type PickerState,
} from '../../core/engines/picker';
import { getPickerSwap, swapActive } from '../pickerConfig';

export interface PickerDialogProps {
  model: PickerModel;
  /** Every change of the value (a single choice also closes the dialog). */
  onChange: (value: string[]) => void;
  onClose: () => void;
  /** The element focus returns to on close (the trigger). */
  returnFocus?: HTMLElement | null;
  /** Engine state from outside (the API drives an open picker); omitted = the dialog keeps its own. */
  state?: PickerState;
  onState?: (s: PickerState) => void;
  /** Console-control address of the picker this dialog belongs to (`button:picker-<id>`), stamped as data-fx-picker-for. */
  target?: string;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [tabindex="0"]';

/** The engine key name for a DOM key ('' = not a picker key). */
function engineKey(e: ReactKeyboardEvent): PickerKey | '' {
  if (e.altKey || e.ctrlKey || e.metaKey) return '';
  if (e.key === ' ') return 'Space';
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter', 'Escape'].includes(e.key)) return e.key;
  return [...e.key].length === 1 ? e.key : '';
}

/**
 * The state with `filtered` in the order the dialog draws it (ungrouped rows, then each group), so the active row,
 * ArrowDown / Home / End, type-ahead and "the third one" all follow what is on screen. The active row keeps its option.
 */
export function inDisplayOrder(model: PickerModel, s: PickerState): PickerState {
  if (!s.filtered.length || !model.groups.length) return s;
  const order = groupOptions(model, s.filtered).flatMap((g) => g.options);
  if (order.every((o, i) => o === s.filtered[i])) return s;
  const activeValue = s.active >= 0 ? s.filtered[s.active]?.value : undefined;
  return { ...s, filtered: order, active: activeValue === undefined ? s.active : order.findIndex((o) => o.value === activeValue) };
}

/** The search threshold in force: the picker plugin's setting while the swap is on, else the picker asset's (root `data-fx-picker-search`: always | never | a number). */
export function rootSearchThreshold(): number | undefined {
  const c = getPickerSwap();
  if (swapActive(c) && c.searchThreshold !== null) return c.searchThreshold;
  const v = typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-fx-picker-search');
  if (v === 'always') return 0;
  if (v === 'never') return Infinity;
  const n = Number(v);
  return v && Number.isFinite(n) ? n : undefined;
}

export function PickerDialog({ model, onChange, onClose, returnFocus, state: outer, onState, target }: PickerDialogProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [own, setOwn] = useState<PickerState>(() => inDisplayOrder(model, openPicker(model)));
  const st = outer ?? own;
  const setSt = useCallback((raw: PickerState) => { const s = inDisplayOrder(model, raw); if (outer) onState?.(s); else { setOwn(s); onState?.(s); } }, [outer, onState, model]);
  const withSearch = searchShown(model);
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // the focus goes in on open and back to the trigger on close
  useLayoutEffect(() => {
    (withSearch ? searchRef.current : listRef.current)?.focus();
    return () => { const back = returnFocus; if (back && back.isConnected) queueMicrotask(() => back.focus()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the active row stays in view
  useEffect(() => { if (st.active >= 0) document.getElementById(optId(st.active))?.scrollIntoView({ block: 'nearest' }); });

  const close = useCallback(() => { setSt(closePicker(st)); onClose(); }, [setSt, st, onClose]);

  const choose = (value: string) => {
    const c = choosePicker(model, value);
    if (c.changed) onChange(c.model.value);
    if (!model.multiple) close();
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      // focus trap: Tab and Shift+Tab cycle inside the dialog
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      e.stopPropagation();
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i < 0 || i >= items.length - 1 ? 0 : i + 1);
      e.preventDefault();
      items[next]!.focus();
      return;
    }
    const k = engineKey(e);
    if (!k) return;
    const searchFocused = document.activeElement === searchRef.current;
    // on a button (close, Done) Enter / Space press the button
    if ((k === 'Enter' || k === 'Space') && (document.activeElement as HTMLElement | null)?.tagName === 'BUTTON') return;
    const r = pickerKey(model, st, k, searchFocused);
    if (r.effect === 'type') return; // the search field takes the letter
    e.preventDefault();
    e.stopPropagation(); // an Escape here closes the picker, not the dialog or panel it sits in
    if (r.model !== model && r.model.value !== model.value) onChange(r.model.value);
    if (r.effect === 'close') { setSt(r.state); onClose(); return; }
    setSt(r.state);
    if (r.state.typeahead) {
      if (typeTimer.current) clearTimeout(typeTimer.current);
      typeTimer.current = setTimeout(() => setSt({ ...r.state, typeahead: '' }), PICKER_TYPEAHEAD_MS);
    }
  };
  useEffect(() => () => { if (typeTimer.current) clearTimeout(typeTimer.current); }, []);

  // sheet: a downward drag on the handle closes it past a quarter of its height
  const [pull, setPull] = useState(0);
  const drag = useRef<{ id: number; y: number } | null>(null);
  const onHandleDown = (e: ReactPointerEvent<HTMLElement>) => { drag.current = { id: e.pointerId, y: e.clientY }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onHandleMove = (e: ReactPointerEvent<HTMLElement>) => { if (drag.current?.id === e.pointerId) setPull(Math.max(0, e.clientY - drag.current.y)); };
  const onHandleUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    const go = e.type === 'pointerup' && Math.max(0, e.clientY - drag.current.y) > (panelRef.current?.offsetHeight ?? 0) / 4;
    drag.current = null; setPull(0);
    if (go) close();
  };

  // index of each filtered option, for ids and the active row
  const index = useMemo(() => new Map(st.filtered.map((o, i) => [o.value, i])), [st.filtered]);
  const sections = useMemo(() => groupOptions(model, st.filtered), [model, st.filtered]);
  const chosen = new Set(model.value);
  const title = model.label || model.placeholder || 'Choose';

  const body = (
    <div className="fx-picker__scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        ref={panelRef} className="fx-picker" role="dialog" aria-modal="true" aria-labelledby={titleId}
        data-fx-picker-for={target} data-fx-picker-multiple={model.multiple ? 'on' : undefined}
        style={pull ? { transform: `translateY(${pull}px)` } : undefined /* theme-ok: drag offset follows the finger */}
        onKeyDown={onKey}
      >
        <div className="fx-picker__handle" aria-hidden="true" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} />
        <div className="fx-picker__head">
          <h2 className="fx-picker__title" id={titleId}>{title}</h2>
          {model.multiple && <span className="fx-picker__count" aria-live="polite">{model.value.length} chosen</span>}
          <IconButton icon="x" label="Close" onClick={close} />
        </div>
        {withSearch && (
          <input
            ref={searchRef} type="search" className="fx-input fx-field__input fx-picker__search" placeholder="Search"
            role="combobox" aria-expanded="true" aria-autocomplete="list" aria-haspopup="listbox"
            aria-label={`Search ${title}`} aria-controls={listId} aria-activedescendant={st.active >= 0 ? optId(st.active) : undefined}
            value={st.query} autoComplete="off" spellCheck={false}
            onChange={(e) => setSt(setQuery(model, st, e.target.value))}
          />
        )}
        <div
          ref={listRef} id={listId} className="fx-picker__list" role="listbox" tabIndex={withSearch ? -1 : 0}
          aria-labelledby={titleId} aria-multiselectable={model.multiple || undefined}
          aria-activedescendant={!withSearch && st.active >= 0 ? optId(st.active) : undefined}
        >
          {!st.filtered.length && <div className="fx-picker__empty" role="status" aria-live="polite">{st.query ? `Nothing matches “${st.query}”` : 'No options'}</div>}
          {sections.map((sec) => (
            <div key={sec.group?.id ?? ''} role={sec.group ? 'group' : 'presentation'} aria-labelledby={sec.group ? `${uid}-g-${sec.group.id}` : undefined} className="fx-picker__group">
              {sec.group && <div className="fx-picker__group-label" id={`${uid}-g-${sec.group.id}`} role="presentation">{sec.group.label}</div>}
              {sec.options.map((o) => {
                const i = index.get(o.value) ?? -1;
                const on = o.value === '' ? model.value.length === 0 : chosen.has(o.value);
                return (
                  <div
                    key={o.value} id={optId(i)} role="option" aria-selected={on} aria-disabled={o.disabled || undefined}
                    className={`fx-picker__option${on ? ' is-selected' : ''}${i === st.active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
                    data-value={o.value}
                    onPointerMove={() => { if (i !== st.active && !o.disabled) setSt({ ...st, active: i }); }}
                    onClick={() => { if (!o.disabled) { setSt({ ...st, active: i }); choose(o.value); } }}
                  >
                    {model.multiple && <input type="checkbox" className="fx-check fx-picker__box" checked={on} readOnly tabIndex={-1} aria-hidden="true" />}
                    {o.icon && <span className="fx-picker__icon" aria-hidden="true"><Icon name={o.icon} /></span>}
                    <span className="fx-picker__text">
                      <span className="fx-picker__label">{o.label}</span>
                      {o.description && <span className="fx-picker__desc">{o.description}</span>}
                    </span>
                    {!model.multiple && <span className="fx-picker__mark" aria-hidden="true">{on && <Icon name="check" />}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {model.multiple && (
          <div className="fx-picker__foot">
            {/* the framework button markup (Button needs the app runtime; the swap layer's pickers render outside it) */}
            {model.value.length > 0 && <button type="button" className="fx-btn fx-btn--neutral" onClick={() => onChange([])}><span>Clear</span></button>}
            <button type="button" className="fx-btn fx-btn--primary fx-picker__done" onClick={close}><span>Done ({model.value.length})</span></button>
          </div>
        )}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}
