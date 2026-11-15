/**
 * ExpanderPicker — the framework's pick-one control, the dropdown's replacement (expander-picker@1; Brett, Nov 13 2026:
 * "I don't want drop-down bars anymore. They are gonna be animated. It's gonna be a row with a name and a little arrow;
 * when you press that arrow it expands a subgrid; you got to press it again to apply it and close it").
 *
 *   collapsed   one row: the setting's name, its current value and a little arrow (the name is in the row, not above it)
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
 * Keyboard: the row is a button (Enter / Space / ArrowDown opens and moves focus to the applied option; Enter / Space on the
 * row applies the highlighted option when open, Escape closes); in the grid the arrow keys, Home and End move the highlight,
 * Enter / Space applies, Escape closes. Screen readers: the row is named by the setting and its value and carries
 * aria-expanded / aria-controls; the grid is a listbox of options with aria-selected on the applied one; a polite live
 * region says "<option> highlighted, press again to apply" and "<option> applied".
 * Motion: every transition reads --fx-pick-dur (the motion token, 0ms for animation none) and prefers-reduced-motion stops them.
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
import { Icon } from './Icon';

export interface ExpanderOption {
  value: string;
  label: string;
  /** a second line on cards and list rows */
  text?: string;
  icon?: string;
  /** a colour (or any CSS background) drawn as the tile's preview on swatch tiles and cards */
  swatch?: string;
  /** any preview drawn at the top of the tile (a mini screen, a sample, an image); takes the swatch's place */
  preview?: ReactNode;
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
  /** console-control address id (`setting:<address>`); default: the label's slug; false = no target of its own (a host
   *  row that already is the API, like a settings row's `setting:<key>`) */
  address?: string | false;
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
  const baseId = useId();
  const gridId = `${baseId}-grid`, id = `${baseId}-row`, nameId = `${baseId}-name`, valueId = `${baseId}-value`, noteId = `${baseId}-note`;
  const describedBy = error || hint ? noteId : undefined;
  const rowRef = useRef<HTMLButtonElement>(null);
  /** opened from the keyboard: focus moves into the grid; a pointer press leaves focus where it is */
  const focusOnOpen = useRef(false);
  /** what a screen reader is told (polite live region): highlighted, applied, closed */
  const [said, say] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const all: ExpanderOption[] = empty !== undefined ? [{ value: '', label: empty }, ...options] : options;
  const current = all.find((o) => o.value === value);
  const labelText = typeof label === 'string' ? label : '';

  const preview = (v: string | null) => { if (previewOn) onPreview?.(v); };
  const close = (apply?: string | null) => {
    const picked = apply !== undefined && apply !== null ? all.find((o) => o.value === apply) : undefined;
    if (picked) say(`${picked.label} applied`);
    if (apply !== undefined && apply !== null && apply !== value) onChange(apply);
    else if (armed !== null) preview(null);
    setArmed(null);
    setOpen(false);
  };
  const expand = () => { if (disabled) return; setArmed(null); setOpen(true); say(''); };
  const onRow = () => { if (open) close(armed); else expand(); };
  /** Enter / Space are the button's click; ArrowDown / ArrowUp open the closed row too, and opening from the keyboard moves focus in */
  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open)) focusOnOpen.current = !open;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); expand(); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); close(); }
  };
  const press = (o: ExpanderOption) => {
    if (o.disabled) return;
    if (firstPress || armed === o.value) { close(o.value); rowRef.current?.focus({ preventScroll: true }); return; }
    setArmed(o.value);
    preview(o.value);
    say(`${o.label} highlighted, press again to apply`);
  };
  useEffect(() => { if (disabled && open) close(); }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps
  // the grid unfolds in place and pushes what is below down; once it has opened, bring it into view if it ran off the bottom
  // and put keyboard focus on the option to start from (the applied one). The wait is the motion token's own duration
  // (--fx-pick-dur, read back from the transition), so reduced motion and animation "none" wait for nothing.
  const subRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = subRef.current;
    if (!el) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stop = (gridRef.current?.querySelector('[tabindex="0"]') ?? null) as HTMLButtonElement | null;
    if (focusOnOpen.current) stop?.focus({ preventScroll: true });
    focusOnOpen.current = false;
    let done = false;
    const show = () => { if (done) return; done = true; el.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); };
    el.addEventListener('transitionend', show, { once: true });
    const secs = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(el).transitionDuration || '0') || 0 : 0;
    const t = setTimeout(show, reduced ? 0 : secs * 1000 + 50);
    return () => { el.removeEventListener('transitionend', show); clearTimeout(t); };
  }, [open]);

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
    say(firstPress ? '' : `${o.label} highlighted, press again to apply`);
    (gridRef.current?.children[next] as HTMLButtonElement | undefined)?.focus({ preventScroll: true });
  };

  const targetRef = useControlTarget(address !== false && (labelText || address) ? {
    address: `setting:${address ?? controlSlug(labelText)}`, kind: 'setting', label: labelText || (address as string), detail: 'expander picker', icon: 'chevron-down', keywords: all.map((o) => o.label),
    can: ['open', 'state', 'set', 'focus', 'press'],
    get: () => value,
    set: (v: unknown) => { const want = String(v); const o = all.find((x) => x.value === want || x.label.toLowerCase() === want.toLowerCase()); if (!o) return `${labelText || (address as string)} has no option "${want}"`; if (o.disabled) return `${o.label} is not available`; close(o.value); return undefined; },
    invoke: () => onRow(),
    open: () => expand(),
    expand: () => expand(),
    isDisabled: () => !!disabled,
    state: () => ({ type: 'choice', options: all.map((o) => o.value), labels: Object.fromEntries(all.map((o) => [o.value, o.label])), expanded: open, highlighted: armed, asset: attrs['data-fx-pick'] }),
  } : null, [open, armed, value, disabled, all.map((o) => o.value).join('|')]);

  // the row and each option are addressable buttons too (`button:<picker>-row`, `button:<picker>-<value>`): press one option
  // through the API like a tap (once highlights, twice applies); none when a host row owns the API (address false)
  const base = address !== false && (labelText || address) ? (address || controlSlug(labelText)) : '';
  const arrow = attrs['data-fx-pick-arrow'] as ExpanderPickerData['arrow'];
  const arrowIcon = arrow === 'plus' ? (open ? 'minus' : 'plus') : ARROW_ICON[arrow];
  const pending = armed !== null && armed !== value ? all.find((o) => o.value === armed) : undefined;
  return (
    <div className={`fx-field fx-pick-field ${error ? 'is-error' : ''} ${className ?? ''}`}>
        <div ref={targetRef} className="fx-pick" style={vars as Record<string, string>} data-fx-pick-open={open ? 'on' : 'off'} {...attrs}>
          <button ref={rowRef} type="button" id={id} className="fx-pick__row" data-axf-target={base ? `button:${base}-row` : undefined} aria-expanded={open} aria-controls={gridId} aria-labelledby={`${nameId} ${valueId}`} aria-describedby={describedBy} aria-invalid={error ? true : undefined} aria-required={required || undefined} disabled={disabled} onClick={onRow} onKeyDown={onRowKey}
            title={open ? (pending ? `Apply ${pending.label} and close` : 'Close') : 'Show the options'}>
            <span className="fx-pick__name" id={nameId}>{label}{required && <span className="fx-field__required" aria-hidden="true"> *</span>}</span>
            <span className={`fx-pick__value ${current ? '' : 'is-empty'}`} id={valueId}>{current?.label ?? empty ?? 'Pick one'}</span>
            {pending && <span className="fx-pick__pending">→ {pending.label}</span>}
            {arrowIcon && <span className="fx-pick__arrow" aria-hidden="true"><Icon name={arrowIcon} size={16} /></span>}
          </button>
          <span className="fx-pick__live" aria-live="polite" aria-atomic="true">{said}</span>
          <div ref={subRef} className="fx-pick__sub" id={gridId} aria-hidden={!open}>
            <div className="fx-pick__sub-inner">
              <div ref={gridRef} className="fx-pick__grid" role="listbox" aria-label={labelText || undefined} aria-labelledby={labelText ? undefined : nameId}>
                {all.map((o, i) => {
                  const on = o.value === value;
                  const isArmed = armed === o.value;
                  return (
                    <button key={o.value || '\u0000'} type="button" role="option" data-axf-target={base ? `button:${base}-${controlSlug(o.value) || 'none'}` : undefined} aria-selected={on} data-armed={isArmed ? 'on' : 'off'} disabled={o.disabled || disabled} tabIndex={open ? (isArmed || (armed === null && on) || (armed === null && !current && i === 0) ? 0 : -1) : -1}
                      className="fx-pick__tile" onClick={() => press(o)} onKeyDown={(e) => move(e, i)} title={!firstPress && isArmed && !on ? 'Press again to apply' : undefined}>
                      {o.preview ? <span className="fx-pick__preview" aria-hidden="true">{o.preview}</span> : o.swatch && <span className="fx-pick__swatch" style={{ background: o.swatch }} aria-hidden="true" />} {/* theme-ok: the option's own colour is data, not style */}
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
        {error ? <p className="fx-field__error" id={noteId} role="alert">{error}</p> : hint ? <p className="fx-field__hint" id={noteId}>{hint}</p> : null}
    </div>
  );
}
