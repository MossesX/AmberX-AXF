/**
 * Theme engine — turns color-theme and style-theme assets into CSS custom
 * properties. Everything visual in AmberX AXF reads these variables, so swapping
 * a theme asset restyles the whole app without a re-render.
 */
import type { ColorThemeData, StyleThemeData } from '../types';
import { componentTokenVars } from './component-tokens.mjs';
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
    // component-tokens@1: the grid and tab-group families a theme names (optional; the :root defaults stand otherwise)
    ...componentTokenVars(s),
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
