/**
 * Gauges and progress meters drawn from the active `gauge` and `meter` control assets (engines/components.ts:
 * normalizeGauge / normalizeMeter / meterCells / gaugeTicks). Swap the asset and every gauge and meter in the app
 * redraws. Colours come from the colour theme; sizes from the style theme (axf.css .fx-gauge / .fx-meter).
 */
import { gaugeTicks, meterCells, normalizeGauge, normalizeMeter } from '../../core/engines/components';
import type { GaugeData, MeterData } from '../../core/types';
import { useAxfState, useRuntime } from '../AxfProvider';

export interface GaugeProps {
  label: string;
  value: number;
  max: number;
  unit?: string;
  /** show the value as a whole number */
  integer?: boolean;
  /** draw with this gauge style instead of the active asset (previews) */
  style?: Partial<GaugeData>;
  className?: string;
}

const fmt = (v: number, integer?: boolean) => (integer ? Math.round(v).toLocaleString() : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString());

export function Gauge({ label, value, max, unit = '', integer, style, className }: GaugeProps) {
  const rt = useRuntime();
  useAxfState();
  const g = normalizeGauge(style ?? rt.assetOrNull('gauge')?.data);
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const shown = fmt(value, integer);
  const ticks = gaugeTicks(g.ticks);
  const sw = g.thickness;
  const aria = `${label}: ${shown}${unit ? ` ${unit}` : ''}`;
  return (
    <figure className={`fx-gauge fx-gauge--${g.shape} ${className ?? ''}`} data-cap={g.cap}>
      {g.shape === 'arc' && (
        <svg viewBox="0 0 120 70" role="img" aria-label={aria}>
          <path className="fx-gauge__track" d="M 10 62 A 50 50 0 0 1 110 62" pathLength={100} style={{ strokeWidth: sw }} />
          <path className="fx-gauge__value" d="M 10 62 A 50 50 0 0 1 110 62" pathLength={100} strokeDasharray={`${pct} 100`} style={{ strokeWidth: sw }} />
          {ticks.map((t) => { const a = Math.PI * (1 - t); const r1 = 50 - sw / 2 - 3, r2 = r1 - 5; return <line key={t} className="fx-gauge__tick" x1={60 + r1 * Math.cos(a)} y1={62 - r1 * Math.sin(a)} x2={60 + r2 * Math.cos(a)} y2={62 - r2 * Math.sin(a)} />; })}
          {g.needle && <><line className="fx-gauge__needle" x1="60" y1="62" x2="60" y2="22" style={{ transform: `rotate(${-90 + pct * 1.8}deg)` }} /><circle className="fx-gauge__hub" cx="60" cy="62" r="4" /></>}
        </svg>
      )}
      {g.shape === 'ring' && (
        <div className="fx-gauge__ringwrap">
          <svg viewBox="0 0 100 100" role="img" aria-label={aria}>
            <circle className="fx-gauge__track" cx="50" cy="50" r="40" pathLength={100} style={{ strokeWidth: sw }} />
            <circle className="fx-gauge__value fx-gauge__ringvalue" cx="50" cy="50" r="40" pathLength={100} strokeDasharray={`${pct} 100`} style={{ strokeWidth: sw }} />
            {ticks.map((t) => { const a = -Math.PI / 2 + t * Math.PI * 2 * 0.999; return <line key={t} className="fx-gauge__tick" x1={50 + 47 * Math.cos(a)} y1={50 + 47 * Math.sin(a)} x2={50 + 43 * Math.cos(a)} y2={50 + 43 * Math.sin(a)} />; })}
          </svg>
          {g.readout !== 'none' && <span className="fx-gauge__center">{shown}</span>}
        </div>
      )}
      {g.shape === 'bar' && (
        <div className="fx-gauge__bar" role="img" aria-label={aria}>
          {g.readout !== 'none' && <span className="fx-gauge__barvalue">{shown}</span>}
          <span className="fx-gauge__bartrack" style={{ height: sw }}>
            <span className="fx-gauge__barfill" style={{ width: `${pct}%` }} />
            {ticks.map((t) => <span key={t} className="fx-gauge__bartick" style={{ left: `${t * 100}%` }} />)}
          </span>
        </div>
      )}
      {g.shape === 'digital' && (
        <div className="fx-gauge__digital" role="img" aria-label={aria}>
          <span className="fx-gauge__digits">{shown}</span>
          <span className="fx-gauge__bartrack is-thin" style={{ height: Math.max(2, Math.round(sw / 2)) }}><span className="fx-gauge__barfill" style={{ width: `${pct}%` }} /></span>
        </div>
      )}
      <figcaption className={`fx-gauge__readout is-${g.readout}`}>{g.shape === 'arc' && g.readout !== 'none' && <strong>{shown}</strong>}{unit && <span> {unit}</span>}<em>{label}</em></figcaption>
    </figure>
  );
}

export interface MeterProps {
  /** 0–100 */
  value: number;
  /** still working: stripes / motion run (when the meter asset allows them) */
  active?: boolean;
  /** finished: drawn in the success colour */
  done?: boolean;
  label?: string;
  /** draw with this meter style instead of the active asset (previews) */
  style?: Partial<MeterData>;
  /** a small meter (step and group bars): half height */
  small?: boolean;
  className?: string;
}

export function Meter({ value, active, done, label, style, small, className }: MeterProps) {
  const rt = useRuntime();
  useAxfState();
  const m = normalizeMeter(style ?? rt.assetOrNull('meter')?.data);
  const pct = Math.max(0, Math.min(100, value));
  const cls = `fx-meter fx-meter--${m.shape} fx-meter--fill-${m.fill}${m.stripes ? ' has-stripes' : ''}${m.animated ? ' has-motion' : ''}${active ? ' is-active' : ''}${done ? ' is-done' : ''}${small ? ' is-small' : ''} ${className ?? ''}`;
  const h = small ? Math.max(2, Math.round(m.height / 2)) : m.height;
  const radius = m.radius === 'pill' ? '999px' : m.radius === 'soft' ? 'var(--fx-radius-sm)' : '0';
  const box = { height: h, borderRadius: radius };
  const aria = { role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label ?? 'Progress' } as const;
  if (m.shape === 'segments' || m.shape === 'steps') {
    const n = small ? Math.max(4, Math.round((m.segments ?? 20) / 2)) : m.segments ?? 20;
    const lit = meterCells(pct, n);
    return (
      <div className={cls} {...aria} style={{ height: h }}>
        {Array.from({ length: n }, (_, i) => <span key={i} className={`fx-meter__cell${i < lit ? ' is-lit' : i === lit && active ? ' is-next' : ''}`} style={{ borderRadius: radius }} />)}
      </div>
    );
  }
  return (
    <div className={cls} {...aria} style={box}>
      <span className="fx-meter__fill" style={{ width: `${pct}%`, borderRadius: radius }} />
    </div>
  );
}
