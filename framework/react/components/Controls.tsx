import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useAsset, useGate } from '../FrameProvider';
import { Icon } from './Icon';

/* ---------------- Button (styled by the active `button` asset) ---------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'neutral' | 'danger' | 'ghost';
  icon?: string;
  /** UAC permission required to use this button */
  requires?: string;
}

export function Button({ tone = 'neutral', icon, requires, children, className, disabled, ...rest }: ButtonProps) {
  const gate = useGate(requires);
  if (gate === 'hide') return null;
  const locked = gate === 'disable';
  return (
    <button
      type="button"
      className={`fx-btn fx-btn--${tone} ${className ?? ''}`}
      disabled={disabled || locked}
      title={locked ? `Requires ${requires}` : rest.title}
      {...rest}
    >
      {locked ? <Icon name="lock" size={14} /> : icon && <Icon name={icon} size={15} />}
      {children && <span>{children}</span>}
    </button>
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
}

export function Container({ title, icon, actions, children, className, ctx, ctxPayload }: ContainerProps) {
  const c = useAsset('container').data;
  const [open, setOpen] = useState(true);
  return (
    <section className={`fx-card ${className ?? ''}`} data-fx-ctx-target={ctx} data-fx-ctx-payload={ctxPayload}>
      {title && (
        <header className="fx-card__head">
          {icon && <Icon name={icon} size={16} />}
          <h3>{title}</h3>
          <div className="fx-card__actions">
            {actions}
            {c.collapsible && (
              <button
                type="button"
                className="fx-iconbtn"
                aria-expanded={open}
                aria-label={open ? 'Collapse' : 'Expand'}
                onClick={() => setOpen((o) => !o)}
              >
                <Icon name="chevron-down" size={15} className={open ? '' : 'fx-rot--90'} />
              </button>
            )}
          </div>
        </header>
      )}
      {open && <div className="fx-card__body">{children}</div>}
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
