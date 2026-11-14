/**
 * Themed controls engine (themed-controls@1, build themed-native-controls-plugin, Brett Nov 14 2026: "replace other
 * browser elements like the dropdowns with themed ones"; spec/THEMED-CONTROLS.md). The pure half of the Themed
 * controls plugin: which control families are active (one master switch + one switch per family, plain settings),
 * which surface a family opens on for a viewport (inline, popover, bottom sheet below the phone cut-off, modal), which
 * family a native element belongs to and whether it should be themed at all (opt-outs), the props a themed control
 * gets from the native element's attributes, and the `--fx-tc-*` tokens a themed-controls asset compiles to.
 *
 * The fields, defaults and validators are in themed-controls-rules.mjs (one registry, shared with control@1
 * `tokens.controls` and the build engine). Everything compiles to theme tokens: colours name colour-theme tokens (or a
 * light|dark pair of them, picked here by the active scheme), sizes are multiples of the font size or the space unit,
 * so swapping a theme restyles every themed control. `theme` values compile to nothing, so the stylesheet's own rule
 * applies and the `native` starter looks like the controls did before.
 *
 * The host (the plugin's web library) owns the DOM: it finds native elements, asks this engine, swaps in the framework
 * control and keeps the original in sync. Pure, no DOM. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { normalizeThemedControls, tcColorFor, THEMED_CONTROL_FIELDS, THEMED_FAMILIES, type ThemedControlsData, type ThemedFamily } from './themed-controls-rules.mjs';
import type { StyleOutput } from './components';

export { normalizeThemedControls, themedControlsErrors, tcFieldErrors, tcFieldValue, tcColorValue, tcColorFor, tcFamilyFields, themedControlsTokens, THEMED_CONTROL_FIELDS, THEMED_CONTROL_GROUPS, THEMED_CONTROLS_TYPE, THEMED_CONTROLS_FRAME, THEMED_FAMILIES, THEMED_FAMILY_LABELS, THEMED_FAMILY_NATIVE, TC_COLOR_TOKENS, TC_RADII, TC_STATES } from './themed-controls-rules.mjs';
export type { ThemedControlsData, ThemedFamily, TcFieldSpec, TcStateColors, TcFamilyData } from './themed-controls-rules.mjs';

/* ---------------- settings: the master switch and one switch per family ---------------- */

/** Settings keys (spec → Settings). Plain keys in the app's own store; never appearance tokens. */
export const TC_KEYS = {
  on: 'axf.themedControls.on',
  sheet: 'axf.themedControls.sheet',
  family: (f: ThemedFamily): string => `axf.themedControls.${f}`,
} as const;

export interface ThemedControlsConfig {
  /** the master switch */
  on: boolean;
  /** pop-up families open as a bottom sheet below the phone cut-off */
  sheet: boolean;
  /** each family's own switch (meaningful only while `on`) */
  families: Record<ThemedFamily, boolean>;
}

const isFamily = (v: unknown): v is ThemedFamily => typeof v === 'string' && (THEMED_FAMILIES as readonly string[]).includes(v);
export const isThemedFamily = isFamily;
/** A setting read as a switch: anything but exactly `false` (or the strings 'false' / 'off') is on. */
const onUnlessOff = (v: unknown): boolean => !(v === false || v === 'false' || v === 'off' || v === 0);

/** The config from settings: on unless switched off, every family on unless switched off, sheets on. */
export function themedControlsConfig(get: (key: string) => unknown): ThemedControlsConfig {
  const families = {} as Record<ThemedFamily, boolean>;
  for (const f of THEMED_FAMILIES) families[f] = onUnlessOff(get(TC_KEYS.family(f)));
  return { on: onUnlessOff(get(TC_KEYS.on)), sheet: onUnlessOff(get(TC_KEYS.sheet)), families };
}

/** Is one family active (master on and its own switch on)? */
export function familyActive(cfg: ThemedControlsConfig, family: ThemedFamily): boolean {
  return cfg.on && cfg.families[family] === true;
}

/** The active families, in family order. */
export function activeFamilies(cfg: ThemedControlsConfig): ThemedFamily[] {
  return THEMED_FAMILIES.filter((f) => familyActive(cfg, f));
}

/** The settings writes that turn the master, one family or the phone sheet on / off (what every API transport sends). */
export function themedControlsChange(what: 'on' | 'sheet' | ThemedFamily, on: boolean): { key: string; value: boolean } {
  if (what === 'on') return { key: TC_KEYS.on, value: on };
  if (what === 'sheet') return { key: TC_KEYS.sheet, value: on };
  if (!isFamily(what)) throw new Error(`unknown themed-controls family ${String(what)}`);
  return { key: TC_KEYS.family(what), value: on };
}

/* ---------------- surfaces: inline, popover, bottom sheet, modal ---------------- */

export type TcSurface = 'inline' | 'popover' | 'sheet' | 'modal' | 'none';
export interface TcViewport {
  /** the visual viewport width, px */
  width: number;
  /** the layout asset's phone cut-off (layout-rules.mjs phoneMaxWidth); default 760 */
  phoneMaxWidth?: number;
  /** a coarse pointer and no hover (touch): overlay scrollbars are native there */
  coarse?: boolean;
}
export const TC_PHONE_MAX_WIDTH_DEFAULT = 760;
/** The surface each family opens on when the viewport is wide. */
export const TC_WIDE_SURFACE: Record<ThemedFamily, TcSurface> = {
  checkbox: 'inline', radio: 'inline', range: 'inline', number: 'inline', file: 'inline',
  datetime: 'popover', color: 'popover', tooltip: 'popover', dialogs: 'modal', scrollbar: 'none',
};

/** Is this viewport a phone (at or under the cut-off)? */
export function isPhoneViewport(v: TcViewport | null | undefined): boolean {
  if (!v || typeof v.width !== 'number' || !Number.isFinite(v.width)) return false;
  const cut = typeof v.phoneMaxWidth === 'number' && v.phoneMaxWidth > 0 ? v.phoneMaxWidth : TC_PHONE_MAX_WIDTH_DEFAULT;
  return v.width <= cut;
}

/**
 * The surface a family opens on: pop-up families (datetime, colour) and dialogs become a bottom sheet on a phone while
 * `sheet` is on; a tooltip is never a sheet; inline families stay inline; scrollbars have no surface.
 */
export function surfaceFor(family: ThemedFamily, viewport: TcViewport | null | undefined, cfg?: Pick<ThemedControlsConfig, 'sheet'> | null): TcSurface {
  const wide = TC_WIDE_SURFACE[family];
  if (wide === 'inline' || wide === 'none') return wide;
  if (family === 'tooltip') return 'popover';
  const sheet = cfg ? cfg.sheet : true;
  return sheet && isPhoneViewport(viewport) ? 'sheet' : wide;
}

/** Themed scrollbars draw only on desktop (fine pointer): nothing on touch, where overlay scrollbars are native. */
export function scrollbarsThemed(cfg: ThemedControlsConfig, viewport: TcViewport | null | undefined): boolean {
  return familyActive(cfg, 'scrollbar') && !viewport?.coarse;
}

/* ---------------- native elements: family, opt-outs, props ---------------- */

/** What the host reads off a native element: tag, attributes (null = absent) and the live value / checked state. */
export interface NativeAttrs {
  tag?: string | null;
  type?: string | null;
  [attr: string]: string | boolean | number | null | undefined;
}
/** Where the element sits (the host walks the ancestors once). */
export interface NativeContext {
  /** the element, a form or an ancestor carries data-axf-native */
  nativeAncestor?: boolean;
  /** inside a contenteditable region */
  editable?: boolean;
  /** inside another themed control */
  insideThemed?: boolean;
}

export const TC_DATETIME_KINDS = ['date', 'time', 'datetime-local', 'month', 'week'] as const;
export type TcDatetimeKind = (typeof TC_DATETIME_KINDS)[number];
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const has = (a: NativeAttrs, k: string): boolean => a[k] !== null && a[k] !== undefined && a[k] !== false;

/**
 * The family a native element belongs to, or null (an element the plugin never touches). Inputs by type; any element
 * with a `title` that isn't itself a swapped input is a `tooltip`.
 */
export function familyOf(attrs: NativeAttrs): ThemedFamily | null {
  const tag = (str(attrs.tag) ?? '').toLowerCase();
  const type = (str(attrs.type) ?? 'text').toLowerCase();
  if (tag === 'input') {
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'range';
    if (type === 'number') return 'number';
    if (type === 'color') return 'color';
    if (type === 'file') return 'file';
    if ((TC_DATETIME_KINDS as readonly string[]).includes(type)) return 'datetime';
  }
  if (tag && tag !== 'input' && typeof attrs.title === 'string' && attrs.title.trim()) return 'tooltip';
  if (tag === 'input' && typeof attrs.title === 'string' && attrs.title.trim()) return 'tooltip';
  return null;
}

/** Should this element be themed right now? The family must be active and nothing may opt it out. */
export function shouldTheme(family: ThemedFamily | null, attrs: NativeAttrs, cfg: ThemedControlsConfig, ctx: NativeContext = {}): boolean {
  if (!family || !familyActive(cfg, family)) return false;
  if (has(attrs, 'data-axf-native') || ctx.nativeAncestor || ctx.editable || ctx.insideThemed) return false;
  if (has(attrs, 'data-axf-themed')) return false; // already swapped
  return true;
}

export interface TcBaseProps {
  id: string;
  name: string;
  label: string;
  disabled: boolean;
  required: boolean;
  readOnly: boolean;
  invalid: boolean;
  describedBy: string;
}
export type TcProps = TcBaseProps & Record<string, unknown>;

const num = (v: unknown, dflt: number | null): number | null => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) ? n : dflt; };
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The props a themed control gets from a native element's attributes (spec → From a native element to control
 * props). `labelText` is the text of the `<label for>` the host found, when any.
 */
export function controlProps(family: ThemedFamily, attrs: NativeAttrs, labelText = ''): TcProps {
  const s = (k: string) => str(attrs[k]) ?? '';
  const base: TcBaseProps = {
    id: s('id'),
    name: s('name'),
    label: s('aria-label') || (s('aria-labelledby') ? `#${s('aria-labelledby')}` : '') || labelText.trim() || s('title'),
    disabled: has(attrs, 'disabled'),
    required: has(attrs, 'required'),
    readOnly: has(attrs, 'readonly'),
    invalid: s('aria-invalid') === 'true' || has(attrs, 'data-axf-invalid'),
    describedBy: s('aria-describedby'),
  };
  const value = s('value');
  switch (family) {
    case 'checkbox': return { ...base, checked: attrs.checked === true || attrs.checked === 'true' || attrs.checked === '', indeterminate: attrs.indeterminate === true || attrs.indeterminate === 'true', value: value || 'on' };
    case 'radio': return { ...base, checked: attrs.checked === true || attrs.checked === 'true' || attrs.checked === '', value: value || 'on', group: base.name };
    case 'range': {
      let min = num(attrs.min, 0)!; let max = num(attrs.max, 100)!;
      if (min > max) [min, max] = [max, min];
      const rawStep = s('step');
      const step = rawStep === 'any' ? 0 : Math.max(0, num(rawStep, 1) ?? 1) || 1;
      const v = num(value, null);
      return { ...base, value: v === null ? Math.round((min + max) / 2) : Math.min(max, Math.max(min, v)), min, max, step, list: s('list'), orient: s('orient') === 'vertical' ? 'vertical' : 'horizontal' };
    }
    case 'number': {
      let min = num(attrs.min, null); let max = num(attrs.max, null);
      if (min !== null && max !== null && min > max) [min, max] = [max, min];
      const rawStep = s('step');
      const step = rawStep === 'any' ? 0 : (num(rawStep, 1) ?? 1) > 0 ? num(rawStep, 1)! : 1;
      return { ...base, value, min, max, step, placeholder: s('placeholder'), inputMode: step !== 0 && !Number.isInteger(step) ? 'decimal' : 'numeric' };
    }
    case 'datetime': {
      const type = (str(attrs.type) ?? 'date').toLowerCase();
      const kind = ((TC_DATETIME_KINDS as readonly string[]).includes(type) ? type : 'date') as TcDatetimeKind;
      const timed = kind === 'time' || kind === 'datetime-local';
      const stepS = num(attrs.step, null);
      return { ...base, kind, value, min: s('min'), max: s('max'), step: timed ? (stepS !== null && stepS > 0 ? Math.max(1, Math.round(stepS / 60)) : null) : null, hour12: s('data-axf-hour12') === 'true' ? true : s('data-axf-hour12') === 'false' ? false : null };
    }
    case 'color': return { ...base, value: HEX.test(value) ? value.toLowerCase() : '#000000', list: s('list'), alpha: false };
    case 'file': return { ...base, accept: s('accept').split(',').map((x) => x.trim()).filter(Boolean), multiple: has(attrs, 'multiple'), capture: s('capture'), directory: has(attrs, 'webkitdirectory') };
    case 'tooltip': return { ...base, text: s('data-axf-tip') || s('title'), placement: s('data-axf-tip-at') || 'top' };
    case 'dialogs': return { ...base, kind: 'alert', message: '' };
    case 'scrollbar': return { ...base };
  }
  return { ...base };
}

export type TcDialogKind = 'alert' | 'confirm' | 'prompt';
export interface TcDialogProps { kind: TcDialogKind; message: string; defaultValue: string; ok: string; cancel: string | null }
/** The props of a themed alert / confirm / prompt from the call that would have opened the browser's. */
export function dialogProps(kind: TcDialogKind, message: unknown, defaultValue?: unknown): TcDialogProps {
  const msg = message === undefined || message === null ? '' : String(message).slice(0, 4000);
  return { kind, message: msg, defaultValue: kind === 'prompt' && defaultValue !== undefined && defaultValue !== null ? String(defaultValue).slice(0, 2000) : '', ok: 'OK', cancel: kind === 'alert' ? null : 'Cancel' };
}

/* ---------------- tokens: the asset compiled to --fx-tc-* ---------------- */

export interface ThemedControlsState {
  /** the active colour theme's scheme (picks the side of a light|dark pair) */
  scheme?: 'light' | 'dark';
  /** the active families (data-fx-tc-families); absent = none active (the tokens still compile) */
  families?: readonly ThemedFamily[];
  /** the phone-sheet switch */
  sheet?: boolean;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** A colour token id → the theme variable it reads. */
export const tcColorVar = (token: string): string => `var(--fx-${kebab(token)})`;
const RADIUS: Record<string, string> = { none: '0', sm: 'var(--fx-radius-sm)', md: 'var(--fx-radius-md)', lg: 'var(--fx-radius-lg)', pill: '999px' };
const RADIUS_FIELDS = /(^|\.)(radius|cellRadius|surfaceRadius|trackRadius|thumbRadius|swatchRadius)$/;
const BORDER_FIELDS = /(^|\.)borderWidth$/;

/** One scalar field compiled to its CSS value ('' = nothing: the stylesheet's rule applies). */
export function tcFieldCss(path: string, value: string | number | boolean): string {
  const f = THEMED_CONTROL_FIELDS[path];
  if (!f) return '';
  if (f.kind === 'boolean') return value ? '1' : '0';
  if (f.kind === 'number') {
    const n = Number(value);
    switch (f.unit) {
      case 'px14': return `calc(var(--fx-font-size) * ${n} / 14)`;
      case 'px': return `${n}px`;
      case 'ms': return `${n}ms`;
      case '%': return `${n}%`;
      default: return String(n);
    }
  }
  if (f.kind === 'enum') {
    if (RADIUS_FIELDS.test(path)) return value === 'theme' ? '' : RADIUS[String(value)] ?? '';
    if (BORDER_FIELDS.test(path)) return value === 'theme' ? '' : `${value}px`;
    return String(value);
  }
  return '';
}

/** Tokens + root attributes for a themed-controls asset (already normalized or raw). */
export function themedControlsOutput(raw: unknown, state: ThemedControlsState = {}): StyleOutput {
  const d: ThemedControlsData = normalizeThemedControls(raw);
  const scheme = state.scheme === 'dark' ? 'dark' : 'light';
  const vars: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  for (const [path, f] of Object.entries(THEMED_CONTROL_FIELDS)) {
    const parts = path.split('.');
    const value = parts.reduce<unknown>((at, k) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[k] : undefined), d) as string | number | boolean;
    const name = `--fx-tc-${parts.map(kebab).join('-')}`;
    if (f.kind === 'color') {
      const token = tcColorFor(value, scheme);
      if (token !== 'theme') vars[name] = tcColorVar(token);
      continue;
    }
    const css = tcFieldCss(path, value);
    if (css !== '') vars[name] = css;
    if (f.kind === 'enum' && parts.length === 2 && !RADIUS_FIELDS.test(path) && !BORDER_FIELDS.test(path)) attrs[`data-fx-tc-${parts.map(kebab).join('-')}`] = String(value);
  }
  const families = (state.families ?? []).filter(isFamily);
  attrs['data-fx-tc'] = families.length ? 'on' : 'off';
  attrs['data-fx-tc-families'] = families.join(' ');
  attrs['data-fx-tc-sheet'] = state.sheet === false ? 'off' : 'on';
  return { vars, attrs };
}
