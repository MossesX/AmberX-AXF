import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { useAsset, useGate, useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { BrandMark, BrandWatermark, brandHostProps, useBrandPlace } from './Brand';
import { containerCollapsible } from '../../core';
import { controlSlug, useControlTarget } from '../controlTargets';

/** The words a button shows or names itself by: aria-label, a text child, else its title. */
function buttonLabel(children: ReactNode, rest: { 'aria-label'?: string; title?: string }): string {
  if (typeof rest['aria-label'] === 'string' && rest['aria-label'].trim()) return rest['aria-label'].trim();
  if (typeof children === 'string' || typeof children === 'number') return String(children).trim();
  if (Array.isArray(children) && children.every((c) => typeof c === 'string' || typeof c === 'number')) return children.join('').trim();
  return typeof rest.title === 'string' ? rest.title.trim() : '';
}

/* ---------------- Button (styled by the active `button` asset) ---------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'neutral' | 'danger' | 'success' | 'ghost' | 'quiet';
  /** `sm`: a compact button (banners, row actions); every size follows the button asset */
  size?: 'sm' | 'md';
  icon?: string;
  /** UAC permission required to use this button */
  requires?: string;
  /**
   * A destructive action: the behaviour theme decides whether to ask first (`feedback.confirmDelete`: always / risky /
   * never). `confirm` is the question; `undoable` says the action can be brought back (so `risky` doesn't ask).
   */
  confirm?: string;
  undoable?: boolean;
  /** Work in flight: the button is disabled and the app shows the busy cursor while true (behaviour theme feedback.busyCursor). */
  busy?: boolean;
}

export function Button({ tone = 'neutral', size = 'md', icon, requires, confirm, undoable, busy, children, className, disabled, onClick, ...rest }: ButtonProps) {
  const gate = useGate(requires);
  const rt = useRuntime();
  useEffect(() => { if (!busy) return; rt.setBusy(true); return () => rt.setBusy(false); }, [busy, rt]);
  const locked = gate === 'disable';
  // console-control@1 (react/controlTargets.ts): every button with words is `button:<id or label slug>` on its screen;
  // a remote press that already passed the confirm gate skips the browser's confirm dialog.
  const el = useRef<HTMLButtonElement | null>(null);
  const skipConfirm = useRef(false);
  const words = buttonLabel(children, rest);
  const targetId = rest.id || controlSlug(words);
  const setTarget = useControlTarget(words && targetId ? {
    address: `button:${targetId}`, kind: 'button', label: words, keywords: icon ? [icon] : undefined, requires, destructive: !!confirm, element: () => el.current,
    invoke: () => { skipConfirm.current = !!confirm; try { el.current?.click(); } finally { skipConfirm.current = false; } },
    isDisabled: () => !!(disabled || locked || busy),
  } : null, [!!confirm, requires]);
  if (gate === 'hide') return null;
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    if (confirm && !skipConfirm.current && rt.confirmDelete(undoable) && !globalThis.confirm?.(confirm)) return;
    onClick?.(e);
  };
  return (
    <button
      ref={(b) => { el.current = b; setTarget(b); }}
      type="button"
      className={`fx-btn fx-btn--${tone}${size === 'sm' ? ' fx-btn--sm' : ''}${busy ? ' is-busy' : ''} ${className ?? ''}`}
      disabled={disabled || locked || busy}
      aria-busy={busy || undefined}
      title={locked ? `Requires ${requires}` : rest.title}
      onClick={click}
      {...rest}
    >
      {locked ? <Icon name="lock" size={size === 'sm' ? 11 : 14} /> : busy ? <Icon name="refresh" size={size === 'sm' ? 11 : 15} className="fx-spin" /> : icon && <Icon name={icon} size={size === 'sm' ? 11 : 15} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/** An icon-only button (the framework's `fx-iconbtn`): a label is required, for screen readers and the tooltip. */
export function IconButton({ icon, label, size = 14, className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: string; label: string; size?: number }) {
  const el = useRef<HTMLButtonElement | null>(null);
  const targetId = rest.id || controlSlug(label);
  const setTarget = useControlTarget(targetId ? { address: `button:${targetId}`, kind: 'button', label, keywords: [icon], element: () => el.current, invoke: () => el.current?.click(), isDisabled: () => !!rest.disabled } : null);
  return (
    <button ref={(b) => { el.current = b; setTarget(b); }} type="button" className={`fx-iconbtn ${className ?? ''}`} aria-label={label} title={rest.title ?? label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/* ---------------- Segmented choice (a short set of options, one on) ---------------- */

export interface SegmentedOption<T extends string> { value: T; label: ReactNode; icon?: string; title?: string; disabled?: boolean }
export function Segmented<T extends string>({ value, options, onChange, label, size, disabled, className }: {
  value: T; options: SegmentedOption<T>[]; onChange: (v: T) => void; label: string; size?: 'sm'; disabled?: boolean; className?: string;
}) {
  return (
    <div className={`fx-seg${size === 'sm' ? ' fx-seg--sm' : ''} ${className ?? ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title} disabled={disabled || o.disabled}
          className={`fx-seg__opt${value === o.value ? ' is-on' : ''}`} onClick={() => value !== o.value && onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={size === 'sm' ? 11 : 13} />}{o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Slider (styled by the active `slider` asset) ---------------- */

export interface SliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export function Slider({ label, value, onChange, min = 0, max = 100, step = 1, unit = '' }: SliderProps) {
  const s = useAsset('slider').data;
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const ticks = s.ticks ? Array.from({ length: 11 }, (_, i) => i * 10) : [];
  return (
    <div className="fx-slider" data-show-value={s.showValue}>
      <div className="fx-slider__head">
        <label htmlFor={id}>{label}</label>
        {s.showValue !== 'never' && (
          <output className="fx-slider__value" htmlFor={id}>
            {value}
            {unit}
          </output>
        )}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--val' as string]: `${pct}%` }}
      />
      {ticks.length > 0 && (
        <div className="fx-slider__ticks" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Container (styled by the active `container` asset) ---------------- */

export interface ContainerProps {
  title?: ReactNode;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** context-menu target name for right-click / long-press */
  ctx?: string;
  ctxPayload?: string;
  /** this card folds whatever the container asset says (a settings card, say); the toggle is the asset's own */
  collapsible?: boolean;
  /** starts folded when false (only with a collapsible card) */
  defaultOpen?: boolean;
}

export function Container({ title, icon, actions, children, className, ctx, ctxPayload, collapsible: own, defaultOpen = true }: ContainerProps) {
  const c = useAsset('container').data;
  // style-theme `wrapGroups` (build option --wrap-groups) makes every titled group collapsible.
  const collapsible = own === true || containerCollapsible(c, useAsset('style-theme').data);
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = open || !collapsible;
  const brand = useBrandPlace('container', 14);
  const brandHost = brandHostProps(brand);
  return (
    <section className={`fx-card ${className ?? ''} ${brandHost.className}`.trim()} data-fx-collapsible={collapsible ? (shown ? 'open' : 'closed') : undefined} data-fx-ctx-target={ctx} data-fx-ctx-payload={ctxPayload} data-fx-brand-mode={brandHost['data-fx-brand-mode']}>
      {title && (
        <header className="fx-card__head">
          {brand?.svg && title && <BrandMark slot="container" height={14} className="fx-card__brand" />}
          {icon && <Icon name={icon} size={16} />}
          <h3>{title}</h3>
          <div className="fx-card__actions">
            {actions}
            {collapsible && (
              <button
                type="button"
                className="fx-iconbtn fx-card__toggle"
                aria-expanded={open}
                aria-controls={bodyId}
                aria-label={open ? 'Collapse' : 'Expand'}
                onClick={() => setOpen((o) => !o)}
              >
                <Icon name="chevron-down" size={15} className={open ? '' : 'fx-rot--90'} />
              </button>
            )}
          </div>
        </header>
      )}
      {shown && <div className="fx-card__body" id={bodyId}>{children}</div>}
      {shown && <BrandWatermark slot="container" />}
    </section>
  );
}

/* ---------------- small helpers ---------------- */

export function Chip({ children, tone }: { children: ReactNode; tone?: 'accent' | 'success' | 'warning' | 'danger' }) {
  return <span className={`fx-chip ${tone ? `fx-chip--${tone}` : ''}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="fx-kbd">{children}</kbd>;
}
