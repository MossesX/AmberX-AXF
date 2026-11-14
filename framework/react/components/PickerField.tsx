/**
 * PickerField (picker@1, spec/PICKER.md § 2): a drop-down field that opens the themed PickerDialog instead of the
 * browser's list. The trigger shows the chosen label (the first few and "+N" for multiple, with the count) and is drawn
 * with the input tokens, like every other field; tapping it, Enter, Space, ArrowDown or Alt+ArrowDown opens the dialog.
 *
 * Same props as SelectField (label, value, options, onChange, hint, error, empty, required, disabled) plus what a
 * picker adds: groups, icons and descriptions on options, `multiple` (value is a string[]), `max`, `searchThreshold`.
 * Values never change shape: single mode hands back the same strings a <select> would ('' for the empty option).
 *
 * Every mounted PickerField registers itself as console-control target `picker:<id>` (pickerRegistry), so REST, MCP,
 * the CLI and voice open and choose in the same picker the user sees.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Field } from './Forms';
import { Icon } from './Icon';
import { PickerDialog, rootSearchThreshold } from './PickerDialog';
import { closedPicker, normalizePicker, openPicker, pickerIdOf, triggerText, type PickerGroup, type PickerModel, type PickerOption, type PickerState } from '../../core/engines/picker';
import { pickerChanged, pickerTarget, registerPicker } from '../pickerRegistry';

interface PickerFieldBase {
  /** Visible label (also the dialog's title). */
  label: ReactNode;
  /** Label text when `label` is not a string (dialog title, voice name, API id). */
  labelText?: string;
  options: PickerOption[];
  groups?: PickerGroup[];
  hint?: ReactNode;
  error?: string;
  /** Single mode: label of an empty ('' value) choice at the top. */
  empty?: string;
  /** Trigger text when nothing is chosen. */
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Options at which the search field shows (default: the picker asset's, else the engine's 8). */
  searchThreshold?: number;
  /** API id (`picker:<id>`); default the label slugged. */
  pickerId?: string;
  /** Draw only the trigger (the caller has its own label; `labelText` is the accessible name). */
  bare?: boolean;
  /** Extra attributes on the trigger (the swap layer passes the native select's id, name, aria-describedby). */
  triggerId?: string;
  describedBy?: string;
  className?: string;
}
export type PickerFieldProps = PickerFieldBase & (
  | { multiple?: false; value: string; onChange: (value: string) => void; max?: never }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void; max?: number }
);

/**
 * The accessible name of a native control, the way the browser computes it for a form field: aria-labelledby, then
 * aria-label, then its <label for> / wrapping <label>, then title, then name / id. The swap layer names the picker with it.
 */
export function labelOfElement(el: HTMLElement): string {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) { const t = clean(by.split(/\s+/).map((i) => el.ownerDocument.getElementById(i)?.textContent ?? '').join(' ')); if (t) return t; }
  const aria = clean(el.getAttribute('aria-label')); if (aria) return aria;
  const labels = (el as HTMLSelectElement).labels;
  if (labels?.length) {
    // a wrapping label holds the select's own option text too: read only its text nodes and non-control children
    const t = clean(Array.from(labels).map((l) => Array.from(l.childNodes).filter((n) => !(n instanceof HTMLElement && n.matches('select, option, button, input, .fx-picker-host'))).map((n) => n.textContent).join(' ')).join(' '));
    if (t) return t;
  }
  return clean(el.getAttribute('title')) || clean(el.getAttribute('name')) || clean(el.id);
}

const textOf = (n: ReactNode): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : '');

/** The engine model for a field's props ('' empty choice first in single mode). */
export function pickerModelOf(p: Pick<PickerFieldProps, 'options' | 'groups' | 'multiple' | 'value' | 'empty' | 'placeholder' | 'searchThreshold' | 'pickerId' | 'labelText' | 'label'> & { max?: number }): PickerModel {
  const label = p.labelText ?? textOf(p.label);
  const single = !p.multiple;
  const options = single && p.empty !== undefined ? [{ value: '', label: p.empty || '—' }, ...p.options] : p.options;
  const value = Array.isArray(p.value) ? p.value : p.value ? [p.value] : [];
  return normalizePicker({
    id: p.pickerId ?? pickerIdOf(label, 'picker'), label, options, groups: p.groups, multiple: !!p.multiple, max: p.max, value,
    searchThreshold: p.searchThreshold ?? rootSearchThreshold(), placeholder: p.placeholder, emptyLabel: single ? p.empty : undefined,
  });
}

export function PickerField(props: PickerFieldProps) {
  const { label, hint, error, required, disabled, bare, className, triggerId, describedBy: extraDescribedBy } = props;
  const model = useMemo(() => pickerModelOf(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.options, props.groups, props.multiple, props.value, props.empty, props.placeholder, props.searchThreshold, props.pickerId, props.labelText, label, props.max]);
  const [st, setSt] = useState<PickerState>(closedPicker);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const [id, setId] = useState(model.id);

  // live refs for the registry handle (the API reads and drives the picker the user sees)
  const live = useRef({ model, st, props });
  live.current = { model, st, props };
  const emit = useCallback((value: string[]) => {
    const p = live.current.props;
    if (p.multiple) p.onChange(value);
    else p.onChange(value[0] ?? '');
  }, []);
  const open = useCallback(() => { if (!live.current.props.disabled) setSt(openPicker(live.current.model)); }, []);
  const close = useCallback(() => setSt(closedPicker()), []);

  useEffect(() => {
    const r = registerPicker(model.id, (rid) => ({
      id: rid,
      model: () => live.current.model,
      state: () => live.current.st,
      open, close,
      apply: emit,
      setState: (s) => setSt(s),
      element: () => triggerRef.current,
    }));
    setId(r.id);
    return r.unregister;
  }, [model.id, open, close, emit]);
  useEffect(() => { pickerChanged(); }, [st.open, model.value]);

  const text = triggerText(model);
  const count = model.multiple ? model.value.length : 0;
  const trigger = (fieldId: string, describedBy: string | undefined) => (
    <button
      ref={triggerRef} id={triggerId ?? fieldId} type="button"
      className={`fx-input fx-field__input fx-picker-trigger${model.value.length || (!model.multiple && !model.emptyLabel) ? '' : ' is-empty'}`}
      role="combobox" aria-haspopup="dialog" aria-expanded={st.open} aria-label={bare ? model.label || undefined : undefined}
      aria-describedby={[describedBy, extraDescribedBy].filter(Boolean).join(' ') || undefined}
      aria-invalid={error ? true : undefined} aria-required={required || undefined}
      disabled={disabled} data-axf-target={pickerTarget(id)} data-fx-picker="field"
      onClick={() => (st.open ? close() : open())}
      onKeyDown={(e) => { if (['ArrowDown', 'ArrowUp'].includes(e.key) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); open(); } }}
    >
      <span className="fx-picker-trigger__text">{text}</span>
      {count > 0 && <span className="fx-picker-trigger__count" aria-label={`${count} chosen`}>{count}</span>}
      <span className="fx-picker-trigger__chev" aria-hidden="true"><Icon name="chevron-down" /></span>
    </button>
  );
  const dialog = st.open && (
    <PickerDialog
      model={model} state={st} onState={setSt} target={pickerTarget(id)}
      onChange={emit} onClose={close} returnFocus={triggerRef.current}
    />
  );
  if (bare) return <span className={`fx-picker-host ${className ?? ''}`}>{trigger(uid, undefined)}{dialog}</span>;
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(fieldId, describedBy) => <>{trigger(fieldId, describedBy)}{dialog}</>}
    </Field>
  );
}
