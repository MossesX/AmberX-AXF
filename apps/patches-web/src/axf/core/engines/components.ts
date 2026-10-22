/**
 * Component style engine — maps component assets (button, slider, container,
 * dialog, popup, context-menu, toolbar, nav-menu, app-menu) to CSS variables plus data-attributes on the
 * document root. axf.css keys off these, so every Button, Slider, etc. in
 * every AmberX AXF app restyles the instant an asset is swapped.
 */
import type { AppMenuData, ButtonData, ChromeDensity, ContainerData, ContextMenuData, DialogData, GaugeData, MeterData, NavMenuData, PopupData, SliderData, ToolbarData } from '../types';
import type { VarMap } from './theme';

export interface StyleOutput {
  vars: VarMap;
  attrs: Record<string, string>;
}

const BTN_PAD = { sm: [5, 10], md: [8, 14], lg: [11, 20] } as const;
const PAD = { sm: 0.75, md: 1.1, lg: 1.5 } as const;

export function buttonStyle(b: ButtonData): StyleOutput {
  const [py, px] = BTN_PAD[b.size];
  return {
    vars: {
      '--fx-btn-radius': b.shape === 'pill' ? '999px' : b.shape === 'square' ? '2px' : 'var(--fx-radius-md)',
      '--fx-btn-weight': String(b.weight),
      '--fx-btn-py': `calc(${py}px * var(--fx-density-k, 1))`,
      '--fx-btn-px': `${px}px`,
      '--fx-btn-shadow': b.elevation ? 'var(--fx-shadow-sm)' : 'none',
      '--fx-btn-case': b.uppercase ? 'uppercase' : 'none',
      '--fx-btn-tracking': b.uppercase ? '0.06em' : '0',
    },
    attrs: { 'data-fx-btn': b.fill },
  };
}

export function sliderStyle(s: SliderData): StyleOutput {
  return {
    vars: {
      '--fx-slider-track': `${s.track}px`,
      '--fx-slider-thumb': `${s.thumbSize}px`,
      '--fx-slider-thumb-w': s.thumb === 'bar' ? `${Math.max(6, Math.round(s.thumbSize / 3))}px` : `${s.thumbSize}px`,
      '--fx-slider-thumb-r': s.thumb === 'circle' ? '50%' : s.thumb === 'bar' ? '3px' : 'var(--fx-radius-sm)',
    },
    attrs: { 'data-fx-slider': s.fill },
  };
}

/* ---------------- gauges + progress meters (optional control types; Android twin deferred, spec/PORTING.md) ---------------- */

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const clampN = (v: unknown, lo: number, hi: number, dflt: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt; };

export const GAUGE_DEFAULT: GaugeData = { shape: 'arc', thickness: 9, needle: true, ticks: 0, cap: 'round', readout: 'big' };
export const METER_DEFAULT: MeterData = { shape: 'bar', height: 12, radius: 'pill', stripes: true, animated: true, fill: 'solid', segments: 20 };

/** A gauge asset's data, every field checked (unknown enum = default, numbers clamped). Same rules as validation. */
export function normalizeGauge(g: Partial<GaugeData> | null | undefined): GaugeData {
  const d = g ?? {};
  return {
    shape: pick(d.shape, ['arc', 'ring', 'bar', 'digital'] as const, GAUGE_DEFAULT.shape),
    thickness: clampN(d.thickness, 4, 16, GAUGE_DEFAULT.thickness),
    needle: typeof d.needle === 'boolean' ? d.needle : GAUGE_DEFAULT.needle,
    ticks: clampN(d.ticks, 0, 10, GAUGE_DEFAULT.ticks),
    cap: pick(d.cap, ['round', 'square'] as const, GAUGE_DEFAULT.cap),
    readout: pick(d.readout, ['big', 'small', 'none'] as const, GAUGE_DEFAULT.readout),
  };
}

export function normalizeMeter(m: Partial<MeterData> | null | undefined): MeterData {
  const d = m ?? {};
  return {
    shape: pick(d.shape, ['bar', 'segments', 'steps', 'line'] as const, METER_DEFAULT.shape),
    height: clampN(d.height, 2, 24, METER_DEFAULT.height),
    radius: pick(d.radius, ['pill', 'soft', 'square'] as const, METER_DEFAULT.radius),
    stripes: typeof d.stripes === 'boolean' ? d.stripes : METER_DEFAULT.stripes,
    animated: typeof d.animated === 'boolean' ? d.animated : METER_DEFAULT.animated,
    fill: pick(d.fill, ['solid', 'gradient', 'soft'] as const, METER_DEFAULT.fill),
    segments: clampN(d.segments, 4, 40, METER_DEFAULT.segments ?? 20),
  };
}

export function gaugeStyle(g: Partial<GaugeData> | null | undefined): StyleOutput {
  const n = normalizeGauge(g);
  return {
    vars: { '--fx-gauge-thickness': String(n.thickness), '--fx-gauge-cap': n.cap === 'round' ? 'round' : 'butt' },
    attrs: { 'data-fx-gauge': n.shape, 'data-fx-gauge-readout': n.readout, 'data-fx-gauge-needle': n.needle ? 'on' : 'off' },
  };
}

export function meterStyle(m: Partial<MeterData> | null | undefined): StyleOutput {
  const n = normalizeMeter(m);
  return {
    vars: {
      '--fx-meter-h': `${n.height}px`,
      '--fx-meter-radius': n.radius === 'pill' ? '999px' : n.radius === 'soft' ? 'var(--fx-radius-sm)' : '0',
    },
    attrs: { 'data-fx-meter': n.shape, 'data-fx-meter-fill': n.fill, 'data-fx-meter-stripes': n.stripes ? 'on' : 'off', 'data-fx-meter-motion': n.animated ? 'on' : 'off' },
  };
}

/** How many of `segments` cells are lit at percent p (0–100): a cell lights once its share is reached. */
export function meterCells(p: number, segments: number): number {
  const n = clampN(segments, 4, 40, 20);
  const pct = Math.min(100, Math.max(0, Number.isFinite(p) ? p : 0));
  return Math.floor((pct / 100) * n + 1e-9);
}

/** Tick positions along a gauge's scale as fractions 0..1 (ends included when there are any ticks). */
export function gaugeTicks(ticks: number): number[] {
  const n = clampN(ticks, 0, 10, 0);
  if (n === 0) return [];
  if (n === 1) return [0.5];
  return Array.from({ length: n }, (_, i) => Math.round((i / (n - 1)) * 1000) / 1000);
}

export function containerStyle(c: ContainerData): StyleOutput {
  const shadows = ['none', 'var(--fx-shadow-sm)', 'var(--fx-shadow-md)', 'var(--fx-shadow-lg)'];
  return {
    vars: {
      '--fx-card-pad': `calc(var(--fx-space) * ${PAD[c.padding] * 2})`,
      '--fx-card-shadow': shadows[c.elevation] ?? 'none',
    },
    attrs: { 'data-fx-card': c.variant, 'data-fx-card-header': c.header },
  };
}

/**
 * Whether a section / group renders a collapse toggle: the container asset asks for it, or the
 * active style theme turns on `wrapGroups` (build option --wrap-groups), which wraps every group.
 * Mirrors ComponentStyleEngine.container on Android.
 */
export function containerCollapsible(c: Pick<ContainerData, 'collapsible'>, s?: { wrapGroups?: boolean } | null): boolean {
  return c.collapsible === true || s?.wrapGroups === true;
}

export function dialogStyle(d: DialogData): StyleOutput {
  return {
    vars: { '--fx-dialog-w': `${d.width}px` },
    attrs: {
      'data-fx-dialog': d.variant,
      'data-fx-backdrop': d.backdrop,
      'data-fx-dialog-anim': d.animation,
      'data-fx-dialog-header': d.header,
    },
  };
}

export function popupStyle(p: PopupData): StyleOutput {
  return { vars: {}, attrs: { 'data-fx-toast-pos': p.position, 'data-fx-toast': p.variant } };
}

export function contextMenuStyle(c: ContextMenuData): StyleOutput {
  return { vars: {}, attrs: { 'data-fx-ctx': c.variant } };
}

/* ---------- chrome: toolbar, nav-menu, app-menu ----------
 * Their optional style fields default to the values that reproduce the
 * pre-0.2.1 look exactly, so existing assets render unchanged. */

const TOOLBAR_PY: Record<ChromeDensity, number> = { compact: 0.35, regular: 0.6, roomy: 0.9 };
const TOOLBTN_H: Record<ChromeDensity, number> = { compact: -8, regular: -4, roomy: 0 };
const NAV_PY: Record<ChromeDensity, number> = { compact: 4, regular: 7, roomy: 10 };
const MENUBAR_H: Record<ChromeDensity, number> = { compact: 0, regular: 4, roomy: 12 };
const rowH = (delta: number) => (delta === 0 ? 'var(--fx-row-h)' : `calc(var(--fx-row-h) ${delta < 0 ? '-' : '+'} ${Math.abs(delta)}px)`);

export function toolbarStyle(t: ToolbarData): StyleOutput {
  const d = t.density ?? 'regular';
  return {
    vars: {
      '--fx-toolbar-py': `calc(var(--fx-space) * ${TOOLBAR_PY[d]})`,
      '--fx-toolbtn-h': rowH(TOOLBTN_H[d]),
    },
    attrs: {
      'data-fx-toolbar': t.variant,
      'data-fx-toolbar-surface': t.surface ?? 'flat',
      'data-fx-toolbar-divider': t.divider === false ? 'off' : 'on',
      'data-fx-toolbar-collapsible': t.collapsible === true ? 'on' : 'off',
    },
  };
}

export function navMenuStyle(n: NavMenuData): StyleOutput {
  const d = n.density ?? 'regular';
  return {
    vars: { '--fx-nav-item-py': `${NAV_PY[d]}px` },
    attrs: {
      'data-fx-nav': n.style,
      'data-fx-nav-indicator': n.indicator ?? 'auto',
      'data-fx-nav-icons': n.showIcons === false ? 'off' : 'on',
    },
  };
}

export function appMenuStyle(a: AppMenuData): StyleOutput {
  const d = a.density ?? 'regular';
  return {
    vars: { '--fx-menubar-h': rowH(MENUBAR_H[d]) },
    attrs: { 'data-fx-menubar': a.surface ?? 'flat' },
  };
}
