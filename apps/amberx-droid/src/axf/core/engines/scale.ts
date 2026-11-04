/**
 * Scale engine — typography@1, density@1, sizing@1: the three assets that own every size the UI used to decide in a
 * stylesheet or a component (Brett, Oct 30 2026: "change it in one place, changes it everywhere; the whole framework
 * and every app and plugin built on it follow the same code"). The rules live in scale-rules.mjs, shared with the
 * build engine, so both validators are one function; this file is the typed face the runtime and React use.
 *
 * Compiled tokens (pure, identical on every port):
 *   typography → --fx-type-scale-{2xs,xs,sm,md,lg,xl,2xl} (em) + --fx-type-root-{2xs…2xl} (× --fx-font-size), --fx-type-headings-{h1..h4,tracking}, --fx-type-weights-{body,medium,strong},
 *                --fx-type-line-{tight,normal,loose}, --fx-type-eyebrow-{size,weight,tracking,case}, --fx-type-mono-size
 *   density    → --fx-dens-gap-{2xs,xs,sm,md,lg,xl,2xl,3xl,4xl}, --fx-dens-pad-{control,card,page,row,cell}, --fx-dens-row-{list,table,menu,control}
 *   sizing     → --fx-size-button-*, --fx-size-icon-button-size, --fx-size-chip-*, --fx-size-field-*, --fx-size-tab-*,
 *                --fx-size-segment-*, --fx-size-card-*, --fx-size-list-row-*, --fx-size-count-strip-*, --fx-size-table-*,
 *                --fx-size-page-head-*
 * Every token has a default: the compact look (Oct 31 2026, tighter than the Oct 30 frame; `standard` starters keep that).
 * axf.css, the console, every plugin and app stylesheet read only these tokens for text sizes and spacing (adopted in
 * the Opus phase of Angel build `ui-all-assets`; framework/cli/scale-adopt.mjs moves new ones, check-theme `scale` flags them).
 */
import { SCALE_TYPES, isScaleType, normalizeScale, scaleErrors, scaleToken, scaleVars, type ScaleData, type ScaleType } from './scale-rules.mjs';

export { SCALE_ENUMS, SCALE_ENUM_DEFAULTS, SCALE_ENUM_VALUES, SCALE_FIELDS, SCALE_FRAME, SCALE_PREFIX, SCALE_TYPES, isScaleType, normalizeScale, scaleErrors, scaleGroups, scaleSchemaProperties, scaleToken, scaleValue, scaleVars, type ScaleData, type ScaleField, type ScaleType, type ScaleUnit } from './scale-rules.mjs';

export type TypographyData = ScaleData;
export type DensityData = ScaleData;
export type SizingData = ScaleData;

/** The framework's own values (what an app without the asset gets). */
export const DEFAULT_TYPOGRAPHY: TypographyData = normalizeScale('typography', null);
export const DEFAULT_DENSITY: DensityData = normalizeScale('density', null);
export const DEFAULT_SIZING: SizingData = normalizeScale('sizing', null);

export const typographyVars = (raw: unknown): Record<string, string> => scaleVars('typography', raw);
export const densityVars = (raw: unknown): Record<string, string> => scaleVars('density', raw);
export const sizingVars = (raw: unknown): Record<string, string> => scaleVars('sizing', raw);

/** All three at once, in type order, for the runtime's root compile (missing assets = defaults). */
export function scaleThemeVars(assets: Partial<Record<ScaleType, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of SCALE_TYPES) Object.assign(out, scaleVars(t, assets[t]));
  return out;
}

/** A token's full name for a field path, for callers that build CSS by hand (tests, the look editor). */
export const scaleTokenOf = (type: ScaleType, path: string): string => scaleToken(type, path);
/** Validation entry for the asset validator (empty for other types). */
export const scaleAssetErrors = (type: string, data: unknown): string[] => (isScaleType(type) ? scaleErrors(type, data) : []);
