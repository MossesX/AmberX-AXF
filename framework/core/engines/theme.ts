/**
 * Theme engine — turns color-theme and style-theme assets into CSS custom
 * properties. Everything visual in AmberX AXF reads these variables, so swapping
 * a theme asset restyles the whole app without a re-render.
 */
import type { ColorThemeData, PickerAssetData, StyleThemeData } from '../types';
import { ROW_MIN, SPACING_K, spacedRadius, type Spacing } from './spacing';

export type VarMap = Record<string, string>;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

export function colorThemeVars(t: ColorThemeData): VarMap {
  const vars: VarMap = {};
  for (const [k, v] of Object.entries(t.tokens)) vars[`--fx-${kebab(k)}`] = v;
  return vars;
}

/** Transparency defaults, identical to the Android kernel's StyleTheme defaults. */
export const OPACITY_DEFAULTS = { disabled: 0.38, muted: 0.62, hover: 0.08, tint: 0.14, scrim: 0.5, glass: 0.72 } as const;

/**
 * Surface transparency (build transparency-token-works-every-dialog, Nov 13 2026). Every floating or framed surface
 * reads its own opacity token; 1 (the default) is fully opaque, lower it to see through. Below 1 the surface also
 * frosts what is behind it (--fx-blur). Style theme field = `opacity` + the capitalised kind (opacityDialog …).
 *   dialog   → .fx-dialog                       settings → .fx-window (floating settings interfaces, tool windows)
 *   panel    → .fx-card (containers, groups)     menu     → .fx-popover, .fx-dropdown, .fx-ctx
 *   toolbar  → .fx-toolbar, .fx-menubar          banner   → .fx-banner
 */
export const SURFACE_KINDS = ['dialog', 'settings', 'panel', 'menu', 'toolbar', 'banner'] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];
export const SURFACE_OPACITY_DEFAULT = 1;
export const surfaceField = (k: SurfaceKind) => `opacity${k.charAt(0).toUpperCase()}${k.slice(1)}` as `opacity${Capitalize<SurfaceKind>}`;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The two variables a surface reads: its opacity and its backdrop filter ('none' while opaque, so an opaque surface
 * never becomes a containing block for fixed-position popovers inside it). Used by the theme and by per-instance
 * overrides (a window's own Background setting) alike.
 */
export function surfaceVars(kind: SurfaceKind, opacity: number | null | undefined): VarMap {
  const o = clamp01(typeof opacity === 'number' && Number.isFinite(opacity) ? opacity : SURFACE_OPACITY_DEFAULT);
  return {
    [`--fx-opacity-${kind}`]: String(o),
    [`--fx-backdrop-${kind}`]: o < 1 ? 'blur(var(--fx-blur))' : 'none',
  };
}

export function surfaceThemeVars(s: Partial<Record<`opacity${Capitalize<SurfaceKind>}`, number>> | null | undefined): VarMap {
  return Object.assign({}, ...SURFACE_KINDS.map((k) => surfaceVars(k, s?.[surfaceField(k)])));
}

const DENSITY = { compact: 0.78, comfortable: 1, spacious: 1.22 } as const;

/** `spacing` = the user's Spacing choice (engines/spacing.ts); 'regular' compiles the theme exactly as written. */
export function styleThemeVars(s: StyleThemeData, spacing: Spacing = 'regular'): VarMap {
  const d = DENSITY[s.density] * SPACING_K[spacing];
  return {
    '--fx-font': s.fontFamily,
    '--fx-font-display': s.fontDisplay,
    '--fx-font-mono': s.fontMono,
    '--fx-font-size': `${s.fontSize}px`,
    '--fx-radius-sm': `${spacedRadius(s.radius.sm, spacing)}px`,
    '--fx-radius-md': `${spacedRadius(s.radius.md, spacing)}px`,
    '--fx-radius-lg': `${spacedRadius(s.radius.lg, spacing)}px`,
    '--fx-space': `${Math.round(s.space * d * 10) / 10}px`,
    '--fx-border-w': `${s.borderWidth}px`,
    '--fx-shadow-sm': s.shadow.sm,
    '--fx-shadow-md': s.shadow.md,
    '--fx-shadow-lg': s.shadow.lg,
    '--fx-motion': `${s.motion}ms`,
    '--fx-blur': `${s.blur}px`,
    '--fx-heading-weight': String(s.headingWeight),
    '--fx-tracking': `${s.tracking}em`,
    '--fx-row-h': `${Math.max(ROW_MIN, Math.round(34 * d))}px`,
    '--fx-density-k': String(d),
    '--fx-opacity-disabled': String(s.opacityDisabled ?? OPACITY_DEFAULTS.disabled),
    '--fx-opacity-muted': String(s.opacityMuted ?? OPACITY_DEFAULTS.muted),
    '--fx-opacity-hover': String(s.opacityHover ?? OPACITY_DEFAULTS.hover),
    '--fx-opacity-tint': String(s.opacityTint ?? OPACITY_DEFAULTS.tint),
    '--fx-opacity-scrim': String(s.opacityScrim ?? OPACITY_DEFAULTS.scrim),
    '--fx-opacity-glass': String(s.opacityGlass ?? OPACITY_DEFAULTS.glass),
    ...surfaceThemeVars(s),
    '--fx-wrap-groups': wrapGroups(s) ? '1' : '0',
  };
}

/** Build option --wrap-groups as a style token: true only when the theme says exactly `true` (default off). */
/** Themed scrollbars, only for a theme that names them; the others keep the browser's. Web only (PORTING.md, skin@1). */
export function scrollbarVars(s: Pick<StyleThemeData, 'scrollbar'> | undefined | null): VarMap {
  return s?.scrollbar === 'thin' ? { '--fx-scrollbar-width': 'thin', '--fx-scrollbar-color': 'var(--fx-muted) transparent' } : {};
}

export function wrapGroups(s: Pick<StyleThemeData, 'wrapGroups'> | undefined | null): boolean {
  return s?.wrapGroups === true;
}

/* ---------------------------------------------------------------- picker@1 tokens (spec/PICKER.md § 3) */

/**
 * The picker token family (build picker-dialog-plugin-replaces-all, Nov 14 2026; Brett: "they must conform to the token
 * system"). One registry: every colour, size, spacing, radius, border and motion the picker dialog / sheet draws with,
 * each a `--fx-picker-*` variable whose default READS an existing theme token (never a literal), so the defaults match
 * today's drop-down look (.fx-dropdown + .fx-menu__item + .fx-input) in every colour theme, light or dark, and a theme
 * swap, a control@1 `tokens.picker` override or a skin's `parts.picker` moves the picker along. `state` names the
 * interaction state a token draws, so a port and a skin editor can list every state (rest, hover, focus, selected,
 * disabled). Kotlin twin deferred (spec/PORTING.md).
 */
export type PickerTokenGroup = 'surface' | 'header' | 'search' | 'option' | 'group' | 'sheet' | 'shape' | 'spacing' | 'type' | 'size' | 'motion';
export type PickerTokenState = 'rest' | 'hover' | 'focus' | 'selected' | 'disabled';
export interface PickerToken { name: `--fx-picker-${string}`; group: PickerTokenGroup; state: PickerTokenState; default: string; draws: string }

export const PICKER_TOKENS: readonly PickerToken[] = [
  { name: '--fx-picker-surface', group: 'surface', state: 'rest', default: 'var(--fx-surface)', draws: 'the dialog / sheet background' },
  { name: '--fx-picker-text', group: 'surface', state: 'rest', default: 'var(--fx-text)', draws: 'its text' },
  { name: '--fx-picker-border', group: 'surface', state: 'rest', default: 'var(--fx-border)', draws: 'its border' },
  { name: '--fx-picker-shadow', group: 'surface', state: 'rest', default: 'var(--fx-shadow-lg)', draws: 'its shadow' },
  { name: '--fx-picker-backdrop', group: 'surface', state: 'rest', default: 'color-mix(in srgb, var(--fx-shadow) calc(var(--fx-opacity-scrim) * 100%), transparent)', draws: 'the scrim behind it' },
  { name: '--fx-picker-header-bg', group: 'header', state: 'rest', default: 'var(--fx-surface2)', draws: 'the header row' },
  { name: '--fx-picker-header-text', group: 'header', state: 'rest', default: 'var(--fx-text)', draws: 'the header label' },
  { name: '--fx-picker-search-bg', group: 'search', state: 'rest', default: 'var(--fx-bg)', draws: 'the search field' },
  { name: '--fx-picker-search-text', group: 'search', state: 'rest', default: 'var(--fx-text)', draws: 'its text' },
  { name: '--fx-picker-search-border', group: 'search', state: 'rest', default: 'var(--fx-border)', draws: 'its border' },
  { name: '--fx-picker-search-focus', group: 'search', state: 'focus', default: 'var(--fx-accent)', draws: 'its border when focused' },
  { name: '--fx-picker-option-bg', group: 'option', state: 'rest', default: 'transparent', draws: 'an option row' },
  { name: '--fx-picker-option-text', group: 'option', state: 'rest', default: 'var(--fx-text)', draws: 'its label' },
  { name: '--fx-picker-option-desc', group: 'option', state: 'rest', default: 'var(--fx-muted)', draws: 'its description' },
  { name: '--fx-picker-option-icon', group: 'option', state: 'rest', default: 'var(--fx-muted)', draws: 'its icon' },
  { name: '--fx-picker-hover-bg', group: 'option', state: 'hover', default: 'var(--fx-accent-soft)', draws: 'a hovered row' },
  { name: '--fx-picker-hover-text', group: 'option', state: 'hover', default: 'var(--fx-text)', draws: 'a hovered row\'s text' },
  { name: '--fx-picker-focus-ring', group: 'option', state: 'focus', default: 'var(--fx-focus)', draws: 'the active row\'s outline (keyboard)' },
  { name: '--fx-picker-selected-bg', group: 'option', state: 'selected', default: 'var(--fx-accent-soft)', draws: 'a chosen row' },
  { name: '--fx-picker-selected-text', group: 'option', state: 'selected', default: 'var(--fx-text)', draws: 'a chosen row\'s label' },
  { name: '--fx-picker-check', group: 'option', state: 'selected', default: 'var(--fx-accent)', draws: 'the check mark' },
  { name: '--fx-picker-disabled-opacity', group: 'option', state: 'disabled', default: 'max(var(--fx-opacity-disabled), 0.45)', draws: 'a disabled row' },
  { name: '--fx-picker-group-bg', group: 'group', state: 'rest', default: 'var(--fx-picker-surface)', draws: 'a sticky group label row' },
  { name: '--fx-picker-group-text', group: 'group', state: 'rest', default: 'var(--fx-muted)', draws: 'the group label' },
  { name: '--fx-picker-handle', group: 'sheet', state: 'rest', default: 'var(--fx-border)', draws: 'the sheet\'s drag handle' },
  { name: '--fx-picker-radius', group: 'shape', state: 'rest', default: 'var(--fx-radius-lg)', draws: 'the dialog / sheet corners' },
  { name: '--fx-picker-option-radius', group: 'shape', state: 'rest', default: 'calc(var(--fx-radius-md) - var(--fx-dens-gap-sm))', draws: 'row corners (today\'s menu item)' },
  { name: '--fx-picker-border-w', group: 'shape', state: 'rest', default: 'var(--fx-border-w)', draws: 'every border' },
  { name: '--fx-picker-pad', group: 'spacing', state: 'rest', default: 'var(--fx-dens-gap-md)', draws: 'padding around the list (today\'s .fx-dropdown)' },
  { name: '--fx-picker-gap', group: 'spacing', state: 'rest', default: 'var(--fx-dens-gap-sm)', draws: 'gap between rows and between header / search / list' },
  { name: '--fx-picker-option-pad-y', group: 'spacing', state: 'rest', default: 'var(--fx-dens-gap-lg)', draws: 'row padding, vertical (today\'s menu item; scaled by the asset\'s density)' },
  { name: '--fx-picker-option-pad-x', group: 'spacing', state: 'rest', default: 'var(--fx-dens-gap-xl)', draws: 'row padding, horizontal (scaled by the asset\'s density)' },
  { name: '--fx-picker-option-gap', group: 'spacing', state: 'rest', default: 'var(--fx-dens-gap-2xl)', draws: 'icon / label / check gap (today\'s menu item)' },
  { name: '--fx-picker-row-h', group: 'size', state: 'rest', default: 'var(--fx-dens-row-menu)', draws: 'row height' },
  { name: '--fx-picker-font', group: 'type', state: 'rest', default: 'var(--fx-type-scale-md)', draws: 'row text size (today\'s menu item)' },
  { name: '--fx-picker-desc-font', group: 'type', state: 'rest', default: 'var(--fx-type-scale-sm)', draws: 'description size' },
  { name: '--fx-picker-group-font', group: 'type', state: 'rest', default: 'var(--fx-type-scale-xs)', draws: 'group label size' },
  { name: '--fx-picker-width', group: 'size', state: 'rest', default: 'min(calc(var(--fx-space) * 46), calc(100vw - var(--fx-dens-gap-2xl) * 2))', draws: 'dialog width' },
  { name: '--fx-picker-max-h', group: 'size', state: 'rest', default: 'min(70dvh, calc(var(--fx-picker-row-h) * 14))', draws: 'dialog height cap (scrolls past it)' },
  { name: '--fx-picker-sheet-max-h', group: 'size', state: 'rest', default: '85dvh', draws: 'sheet height cap' },
  { name: '--fx-picker-motion', group: 'motion', state: 'rest', default: 'var(--fx-motion)', draws: 'open / close duration' },
];
export const PICKER_TOKEN_STATES: readonly PickerTokenState[] = ['rest', 'hover', 'focus', 'selected', 'disabled'];
export const PICKER_SEARCH_THRESHOLD_MAX = 200;

/** What an app without a picker asset gets: today's drop-down. */
export const PICKER_ASSET_DEFAULT: PickerAssetData = { variant: 'auto', search: 'auto', searchThreshold: 8, checkmarks: 'end', descriptions: true, density: 'regular', doneButton: true };

/** Row padding per density, as density tokens (the row never leaves the scale). */
const PICKER_DENSITY_PAD: Record<PickerAssetData['density'], { y: string; x: string }> = {
  compact: { y: 'var(--fx-dens-gap-md)', x: 'var(--fx-dens-gap-lg)' },
  regular: { y: 'var(--fx-dens-gap-lg)', x: 'var(--fx-dens-gap-xl)' },
  roomy: { y: 'var(--fx-dens-gap-xl)', x: 'var(--fx-dens-gap-2xl)' },
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed as readonly string[]).includes(v as string) ? (v as T) : d;

/** Junk in, a complete picker asset out (every field present, enums checked, the threshold clamped). */
export function normalizePickerAsset(raw: unknown): PickerAssetData {
  const r = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Partial<Record<keyof PickerAssetData, unknown>>;
  const thr = Number(r.searchThreshold);
  return {
    variant: oneOf(r.variant, ['auto', 'dialog', 'sheet'], PICKER_ASSET_DEFAULT.variant),
    search: oneOf(r.search, ['auto', 'always', 'never'], PICKER_ASSET_DEFAULT.search),
    searchThreshold: Number.isFinite(thr) ? Math.min(PICKER_SEARCH_THRESHOLD_MAX, Math.max(0, Math.round(thr))) : PICKER_ASSET_DEFAULT.searchThreshold,
    checkmarks: oneOf(r.checkmarks, ['end', 'start', 'none'], PICKER_ASSET_DEFAULT.checkmarks),
    descriptions: typeof r.descriptions === 'boolean' ? r.descriptions : PICKER_ASSET_DEFAULT.descriptions,
    density: oneOf(r.density, ['compact', 'regular', 'roomy'], PICKER_ASSET_DEFAULT.density),
    doneButton: typeof r.doneButton === 'boolean' ? r.doneButton : PICKER_ASSET_DEFAULT.doneButton,
  };
}

/** Validation messages for a picker asset (the validators and the build engine share them). */
export function pickerAssetErrors(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['data must be an object'];
  const r = raw as Record<string, unknown>;
  const out: string[] = [];
  if ('searchThreshold' in r && (typeof r.searchThreshold !== 'number' || !Number.isFinite(r.searchThreshold) || r.searchThreshold < 0 || r.searchThreshold > PICKER_SEARCH_THRESHOLD_MAX)) out.push(`data.searchThreshold must be a number 0–${PICKER_SEARCH_THRESHOLD_MAX}`);
  for (const k of ['descriptions', 'doneButton'] as const) if (k in r && typeof r[k] !== 'boolean') out.push(`data.${k} must be true or false`);
  return out;
}

/**
 * The --fx-picker-* variables: every registry default, with the asset's density folded into the row padding. Written
 * with the other theme variables by the runtime's compileStyles, so a theme swap moves the picker along.
 */
export function pickerVars(picker?: Partial<PickerAssetData> | null): VarMap {
  const p = normalizePickerAsset(picker);
  const vars: VarMap = {};
  for (const t of PICKER_TOKENS) vars[t.name] = t.default;
  vars['--fx-picker-option-pad-y'] = PICKER_DENSITY_PAD[p.density].y;
  vars['--fx-picker-option-pad-x'] = PICKER_DENSITY_PAD[p.density].x;
  return vars;
}

/** The root attributes the picker reads for the choices that are not a colour or a size (the React picker keys off them). */
export function pickerAttrs(picker?: Partial<PickerAssetData> | null): Record<string, string> {
  const p = normalizePickerAsset(picker);
  return {
    'data-fx-picker-variant': p.variant,
    'data-fx-picker-search': p.search === 'auto' ? String(p.searchThreshold) : p.search,
    'data-fx-picker-check': p.checkmarks,
    'data-fx-picker-desc': p.descriptions ? 'on' : 'off',
    'data-fx-picker-done': p.doneButton ? 'on' : 'off',
    'data-fx-picker-density': p.density,
  };
}

/** Both at once, in the component style engine's shape. */
export function pickerStyle(picker?: Partial<PickerAssetData> | null): { vars: VarMap; attrs: Record<string, string> } {
  return { vars: pickerVars(picker), attrs: pickerAttrs(picker) };
}
