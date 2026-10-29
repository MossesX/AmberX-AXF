/**
 * Form controls every AXF web app and plugin share (harvested Oct 21 2026 from Build Pilot's `src/pilot/ui.tsx` and
 * the console's hand-rolled switches): Switch, Field, TextField, SelectField, ChoiceGrid, Note, Section and
 * LibraryParamField. Same names, props and behaviour as the Compose versions in `axf-ui/components/Forms.kt`.
 *
 * Styled only by `framework/ui/axf.css` (`.fx-switch`, `.fx-field`, `.fx-choice`, `.fx-note`, `.fx-section`), which reads
 * theme tokens, so the style theme's spacing choice (Super tight / Compact / Regular) sizes every control.
 * Accessibility: every input has a label (`<label for>` or aria-label), the switch is `role="switch"` + `aria-checked`,
 * choice cards are radio / checkbox buttons in a radiogroup / group, errors are announced through `aria-describedby`,
 * and keyboard focus shows through `:focus-visible` on the visible part.
 */
import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';
import { paramBool, paramDefaultText, paramError, type LibraryParam } from '../../core';

/* ---------------- Switch ---------------- */

export interface SwitchProps {
  /** Visible label (a bare switch passes `label` with `hideLabel`; it still becomes the aria-label). */
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Secondary line under the label. */
  hint?: ReactNode;
  /** Draw only the toggle; the label stays as the accessible name. */
  hideLabel?: boolean;
  /** Short text next to a bare toggle (e.g. "Shown" / "Hidden"). */
  text?: ReactNode;
  title?: string;
  className?: string;
}

/** On/off toggle: `role="switch"`, `aria-checked`, space/enter toggles, focus ring on the track. */
export function Switch({ label, checked, onChange, disabled, hint, hideLabel, text, title, className }: SwitchProps) {
  const hintId = useId();
  const toggle = (
    <span className="fx-switch">
      <input
        type="checkbox" role="switch" className="fx-switch__input"
        checked={checked} disabled={disabled} aria-checked={checked}
        aria-label={hideLabel ? label : undefined} aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="fx-switch__track" aria-hidden="true"><span className="fx-switch__thumb" /></span>
    </span>
  );
  if (hideLabel) {
    return (
      <label className={`fx-switchrow fx-switchrow--bare ${disabled ? 'is-disabled' : ''} ${className ?? ''}`} title={title}>
        {toggle}
        {text && <span className="fx-switchrow__text">{text}</span>}
      </label>
    );
  }
  return (
    <label className={`fx-switchrow ${disabled ? 'is-disabled' : ''} ${className ?? ''}`} title={title}>
      <span className="fx-switchrow__text">
        <span className="fx-switchrow__label">{label}</span>
        {hint && <span className="fx-switchrow__hint" id={hintId}>{hint}</span>}
      </span>
      {toggle}
    </label>
  );
}

/* ---------------- Checkbox ---------------- */

export interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/** A tick box with its label (for an option that enables another control next to it, e.g. a timer's minutes). */
export function Checkbox({ label, checked, onChange, disabled, title, className }: CheckboxProps) {
  return (
    <label className={`fx-checkrow ${disabled ? 'is-disabled' : ''} ${className ?? ''}`} title={title}>
      <input type="checkbox" className="fx-check" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="fx-checkrow__label">{label}</span>
    </label>
  );
}

/* ---------------- Field / TextField / SelectField ---------------- */

export interface FieldProps {
  label: ReactNode;
  /** Help text under the control (replaced by `error` while there is one). */
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  /** The control; it gets the id the label points at and the id of the hint/error for `aria-describedby`. */
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

/** Label + control + help/error wrapper. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const hasNote = !!error || !!hint;
  return (
    <div className={`fx-field ${error ? 'is-error' : ''} ${className ?? ''}`}>
      <label className="fx-field__label" htmlFor={id}>{label}{required && <span className="fx-field__required" aria-hidden="true"> *</span>}</label>
      {children(id, hasNote ? noteId : undefined)}
      {error ? <p className="fx-field__error" id={noteId} role="alert">{error}</p> : hint ? <p className="fx-field__hint" id={noteId}>{hint}</p> : null}
    </div>
  );
}

export interface TextFieldProps {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  /** Monospace text (ids, paths, code). */
  mono?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** More than one row: a textarea. */
  rows?: number;
  type?: 'text' | 'password' | 'email' | 'url' | 'number' | 'search' | 'date' | 'time' | 'datetime-local';
  autoFocus?: boolean;
  /** `autoComplete` for the input (default off). */
  autoComplete?: string;
  name?: string;
  className?: string;
}

/** Single- or multi-line text input inside a Field. */
export function TextField({ label, value, onChange, placeholder, hint, error, mono, required, disabled, rows, type = 'text', autoFocus, autoComplete = 'off', name, className }: TextFieldProps) {
  const cls = `fx-input fx-field__input ${mono ? 'fx-mono' : ''}`;
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => rows && rows > 1 ? (
        <textarea id={id} name={name} className={cls} rows={rows} value={value} placeholder={placeholder} disabled={disabled} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy} autoFocus={autoFocus} autoComplete={autoComplete} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} name={name} className={cls} type={type} value={value} placeholder={placeholder} disabled={disabled} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy} autoFocus={autoFocus} autoComplete={autoComplete} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectFieldProps {
  label: ReactNode;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string;
  /** Label of an extra empty option ("" value) at the top. */
  empty?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Native select inside a Field. */
export function SelectField({ label, value, options, onChange, hint, error, empty, required, disabled, className }: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => (
        <select id={id} className="fx-input fx-field__input" value={value} disabled={disabled} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)}>
          {empty !== undefined && <option value="">{empty}</option>}
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/* ---------------- ChoiceGrid ---------------- */

export interface Choice { id: string; title: string; text?: string; icon?: string; tag?: string; disabled?: boolean }

export interface ChoiceGridProps {
  choices: Choice[];
  selected: string[];
  onToggle: (id: string) => void;
  /** Several choices at once (checkbox semantics); default single (radio). */
  multiple?: boolean;
  /** Accessible name of the group. */
  label?: string;
  className?: string;
}

/** Tappable cards, single or multiple choice. Arrow keys move between cards in single mode like a radio group. */
export function ChoiceGrid({ choices, selected, onToggle, multiple, label, className }: ChoiceGridProps) {
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (multiple) return;
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const enabled = choices.map((c, j) => (c.disabled ? -1 : j)).filter((j) => j >= 0);
    if (!enabled.length) return;
    const pos = enabled.indexOf(i);
    const next = enabled[(pos + dir + enabled.length) % enabled.length]!;
    const el = e.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined;
    el?.focus();
    onToggle(choices[next]!.id);
  };
  return (
    <div className={`fx-choices ${className ?? ''}`} role={multiple ? 'group' : 'radiogroup'} aria-label={label}>
      {choices.map((c, i) => {
        const on = selected.includes(c.id);
        return (
          <button key={c.id} type="button" role={multiple ? 'checkbox' : 'radio'} aria-checked={on} disabled={c.disabled}
            className={`fx-choice ${on ? 'is-active' : ''}`} onClick={() => onToggle(c.id)} onKeyDown={(e) => onKey(e, i)}>
            <span className="fx-choice__top">
              {c.icon && <Icon name={c.icon} size={16} />}
              <span className="fx-choice__title">{c.title}</span>
              {on && <Icon name="check" size={14} />}
            </span>
            {c.text && <span className="fx-choice__text">{c.text}</span>}
            {c.tag && <span className="fx-choice__tag">{c.tag}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Note ---------------- */

export type NoteTone = 'info' | 'warning' | 'danger' | 'success';

export interface NoteProps {
  tone?: NoteTone;
  /** Icon name override (defaults by tone). */
  icon?: string;
  children: ReactNode;
  className?: string;
}

/** Inline callout: info (accent), warning, danger, success. Danger and warning are announced as alerts. */
export function Note({ tone = 'info', icon, children, className }: NoteProps) {
  const name = icon ?? (tone === 'danger' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info');
  return (
    <div className={`fx-note is-${tone} ${className ?? ''}`} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'note'}>
      <Icon name={name} size={14} />
      <div className="fx-note__body">{children}</div>
    </div>
  );
}

/* ---------------- Section ---------------- */

export interface SectionProps {
  title: ReactNode;
  /** Right side of the heading row (a count, a button). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled block of a form or page (lighter than a Container: no card chrome). */
export function Section({ title, aside, children, className }: SectionProps) {
  const id = useId();
  return (
    <section className={`fx-section ${className ?? ''}`} aria-labelledby={id}>
      <header className="fx-section__head"><h3 className="fx-section__title" id={id}>{title}</h3>{aside}</header>
      {children}
    </section>
  );
}

/* ---------------- LibraryParamField ---------------- */

export interface LibraryParamFieldProps {
  /** One `params[]` entry of a library@1 `library.json`. */
  p: LibraryParam;
  /** The answer as text (see `core/library.ts`: `paramToJson` makes it typed). */
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}

/**
 * Renders a library@1 parameter by type: bool → Switch, choice → ChoiceGrid (single), list → multi-line TextField,
 * number / text → TextField; shows the help and the validation error from `paramError`.
 */
export function LibraryParamField({ p, value, onChange, disabled }: LibraryParamFieldProps) {
  const err = paramError(p, value) ?? undefined;
  const def = paramDefaultText(p);
  if (p.type === 'bool') return <Switch label={p.label} hint={p.help} checked={paramBool(p, value)} disabled={disabled} onChange={(on) => onChange(String(on))} />;
  if (p.type === 'choice') {
    const current = value.trim() || def;
    return (
      <Field label={p.label} hint={p.help} error={err} required={p.required}>
        {() => <ChoiceGrid label={p.label} choices={(p.choices ?? []).map((c) => ({ id: c, title: c, disabled }))} selected={current ? [current] : []} onToggle={(id) => onChange(id)} />}
      </Field>
    );
  }
  return (
    <TextField label={p.label} value={value} onChange={onChange} hint={p.help} error={err} required={p.required} disabled={disabled}
      mono={p.type === 'list'} rows={p.type === 'list' ? 2 : undefined} placeholder={def || (p.type === 'list' ? 'one, two, three' : undefined)} />
  );
}
