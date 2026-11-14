/**
 * ExpanderPicker — the framework's pick-one control, the dropdown's replacement (expander-picker@1; Brett, Nov 13 2026:
 * "I don't want drop-down bars anymore. They are gonna be animated. It's gonna be a row with a name and a little arrow;
 * when you press that arrow it expands a subgrid; you got to press it again to apply it and close it").
 *
 *   collapsed   a row: the field's name above it (Field), the current value and a little arrow on the row
 *   pressed     the row unfolds in place into a grid of every option, pushing what is below it down (nothing floats)
 *   one press   on an option highlights it (and previews it through `onPreview` where the host can)
 *   again       on the same option, or on the arrow / row, applies it (`onChange`) and the grid closes
 *   Escape      closes without applying (the preview is taken back)
 *
 * Looks and behaviour come from the active expander-picker asset (tiles, arrow, columns, density, animation, apply rule,
 * preview, value on the row, divider): the element carries the asset's attributes and vars (expanderPickerStyle), so a
 * picker given its own `asset` keeps it while every other follows the app's. Motion is the motion token through
 * --fx-pick-dur (the behaviour theme's speed and reduced motion flow through it); the stylesheet is `.fx-pick` in axf.css.
 *
 * Keyboard: the row is a button (Enter / Space opens, applies the highlighted option when open); in the grid the arrow keys,
 * Home and End move the highlight, Enter / Space applies, Escape closes. Screen readers: the grid is a listbox of options
 * with aria-selected on the applied one, the row carries aria-expanded and aria-controls.
 *
 * API (console-control@1): every picker is a `setting:<address or label slug>` target, so `state` reads its value, options
 * and whether it is open, `set` applies a value without the UI, `press` toggles the row and `focus` with `expand` opens it:
 * reachable through the console API, MCP console actions, `axf control …` and voice ("set <label> to <value>").
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { expanderPickerStyle } from '../../core/engines/components';
import type { ExpanderPickerData } from '../../core/types';
import { useOptionalRuntime } from '../AxfProvider';
import { controlSlug, useControlTarget } from '../controlTargets';
import { Field } from './Forms';
import { Icon } from './Icon';

export interface ExpanderOption {
  value: string;
  label: string;
  /** a second line on cards and list rows */
  text?: string;
  icon?: string;
  /** a colour (or any CSS background) drawn as the tile's preview on swatch tiles and cards */
  swatch?: string;
  disabled?: boolean;
}

export interface ExpanderPickerProps {
  label: ReactNode;
  value: string;
  options: ExpanderOption[];
  onChange: (v: string) => void;
  /** the highlighted option before it is applied (null = the highlight is gone: apply the real value again) */
  onPreview?: (v: string | null) => void;
  hint?: ReactNode;
  error?: string;
  /** Label of an extra empty option ("" value) at the top. */
  empty?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** its own asset data (else the app's active expander-picker asset, else the default) */
  asset?: Partial<ExpanderPickerData> | null;
  /** console-control address id (`setting:<address>`); default: the label's slug */
  address?: string;
}

const NO_STORE = () => () => {};
const NO_STATE = () => null;

const ARROW_ICON: Record<ExpanderPickerData['arrow'], string> = { chevron: 'chevron-down', caret: 'chevron-down', plus: 'plus', none: '' };

/** Row with a name and a little arrow; press it and a grid of the options unfolds; press an option twice (or the arrow again) to apply. */
export function ExpanderPicker({ label, value, options, onChange, onPreview, hint, error, empty, required, disabled, className, asset, address }: ExpanderPickerProps) {
  const rt = useOptionalRuntime();
  // re-render on a hot-swap of the expander-picker asset; a picker outside <AxfProvider> (a standalone form) just draws the default
  useSyncExternalStore(rt ? rt.subscribe : NO_STORE, rt ? rt.getState : NO_STATE, rt ? rt.getState : NO_STATE);
  const data = asset ?? (rt?.assetOrNull('expander-picker')?.data as Partial<ExpanderPickerData> | undefined) ?? null;
  const { vars, attrs } = expanderPickerStyle(data);
  const firstPress = attrs['data-fx-pick-apply'] === 'first-press';
  const previewOn = attrs['data-fx-pick-preview'] === 'on';
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const gridId = useId();
  const rowRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const all: ExpanderOption[] = empty !== undefined ? [{ value: '', label: empty }, ...options] : options;
  const current = all.find((o) => o.value === value);
  const labelText = typeof label === 'string' ? label : '';

  const preview = (v: string | null) => { if (previewOn) onPreview?.(v); };
  const close = (apply?: string | null) => {
    if (apply !== undefined && apply !== null && apply !== value) onChange(apply);
    else if (armed !== null) preview(null);
    setArmed(null);
    setOpen(false);
  };
  const expand = () => { if (disabled) return; setArmed(null); setOpen(true); };
  const onRow = () => { if (open) close(armed); else expand(); };
  const press = (o: ExpanderOption) => {
    if (o.disabled) return;
    if (firstPress || armed === o.value) { close(o.value); rowRef.current?.focus({ preventScroll: true }); return; }
    setArmed(o.value);
    preview(o.value);
  };
  useEffect(() => { if (disabled && open) close(); }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (e: KeyboardEvent<HTMLElement>, from: number) => {
    const enabled = all.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled.length) return;
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(Math.max(0, enabled.indexOf(from)) + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(enabled.indexOf(from) - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    else if (e.key === 'Escape') { e.preventDefault(); close(); rowRef.current?.focus({ preventScroll: true }); return; }
    if (next === undefined) return;
    e.preventDefault();
    const o = all[next]!;
    setArmed(o.value);
    preview(o.value);
    (gridRef.current?.children[next] as HTMLButtonElement | undefined)?.focus({ preventScroll: true });
  };

  const targetRef = useControlTarget(labelText || address ? {
    address: `setting:${address ?? controlSlug(labelText)}`, kind: 'setting', label: labelText || address!, detail: 'expander picker', icon: 'chevron-down', keywords: all.map((o) => o.label),
    can: ['open', 'state', 'set', 'focus', 'press'],
    get: () => value,
    set: (v) => { const want = String(v); const o = all.find((x) => x.value === want || x.label.toLowerCase() === want.toLowerCase()); if (!o) return `${labelText || address} has no option "${want}"`; if (o.disabled) return `${o.label} is not available`; close(o.value); return undefined; },
    invoke: () => onRow(),
    open: () => expand(),
    expand: () => expand(),
    isDisabled: () => !!disabled,
    state: () => ({ type: 'choice', options: all.map((o) => o.value), labels: Object.fromEntries(all.map((o) => [o.value, o.label])), expanded: open, highlighted: armed, asset: attrs['data-fx-pick'] }),
  } : null, [open, armed, value, disabled, all.map((o) => o.value).join('|')]);

  const arrow = attrs['data-fx-pick-arrow'] as ExpanderPickerData['arrow'];
  const arrowIcon = arrow === 'plus' ? (open ? 'minus' : 'plus') : ARROW_ICON[arrow];
  const pending = armed !== null && armed !== value ? all.find((o) => o.value === armed) : undefined;
  return (
    <Field label={label} hint={hint} error={error} required={required} className={`fx-pick-field ${className ?? ''}`}>
      {(id, describedBy) => (
        <div ref={targetRef} className="fx-pick" style={vars as Record<string, string>} data-fx-pick-open={open ? 'on' : 'off'} {...attrs}>
          <button ref={rowRef} type="button" id={id} className="fx-pick__row" aria-expanded={open} aria-controls={gridId} aria-describedby={describedBy} aria-invalid={error ? true : undefined} disabled={disabled} onClick={onRow}
            title={open ? (pending ? `Apply ${pending.label} and close` : 'Close') : 'Show the options'}>
            <span className={`fx-pick__value ${current ? '' : 'is-empty'}`}>{current?.label ?? empty ?? 'Pick one'}</span>
            {pending && <span className="fx-pick__pending">→ {pending.label}</span>}
            {arrowIcon && <span className="fx-pick__arrow" aria-hidden="true"><Icon name={arrowIcon} size={16} /></span>}
          </button>
          <div className="fx-pick__sub" id={gridId} aria-hidden={!open}>
            <div className="fx-pick__sub-inner">
              <div ref={gridRef} className="fx-pick__grid" role="listbox" aria-label={labelText || undefined} aria-labelledby={labelText ? undefined : id}>
                {all.map((o, i) => {
                  const on = o.value === value;
                  const isArmed = armed === o.value;
                  return (
                    <button key={o.value || '\u0000'} type="button" role="option" aria-selected={on} data-armed={isArmed ? 'on' : 'off'} disabled={o.disabled || disabled} tabIndex={open ? (isArmed || (armed === null && on) || (armed === null && !current && i === 0) ? 0 : -1) : -1}
                      className="fx-pick__tile" onClick={() => press(o)} onKeyDown={(e) => move(e, i)} title={!firstPress && isArmed && !on ? 'Press again to apply' : undefined}>
                      {o.swatch && <span className="fx-pick__swatch" style={{ background: o.swatch }} aria-hidden="true" />} {/* theme-ok: the option's own colour is data, not style */}
                      <span className="fx-pick__tile-top">
                        {o.icon && <Icon name={o.icon} size={16} />}
                        <span className="fx-pick__title">{o.label}</span>
                        {on && <Icon name="check" size={14} />}
                      </span>
                      {o.text && <span className="fx-pick__text">{o.text}</span>}
                      {!firstPress && isArmed && !on && <span className="fx-pick__hint">Press again to apply</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </Field>
  );
}
