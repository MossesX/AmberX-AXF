/**
 * Theme engine — turns color-theme and style-theme assets into CSS custom
 * properties. Everything visual in AmberX AXF reads these variables, so swapping
 * a theme asset restyles the whole app without a re-render.
 */
import type { ColorThemeData, StyleThemeData } from '../types';
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
    '--fx-wrap-groups': wrapGroups(s) ? '1' : '0',
  };
}

/** Build option --wrap-groups as a style token: true only when the theme says exactly `true` (default off). */
export function wrapGroups(s: Pick<StyleThemeData, 'wrapGroups'> | undefined | null): boolean {
  return s?.wrapGroups === true;
}
