// Types for scale-rules.mjs (typography@1, density@1, sizing@1; shared by the TS engines and the build engine).
export type ScaleType = 'typography' | 'density' | 'sizing';
export type ScaleUnit = 'em' | 'space' | 'font' | 'x' | 'int';
export type ScaleField = readonly [number, number, number, ScaleUnit];
export const SCALE_TYPES: readonly ScaleType[];
export const SCALE_FRAME: Record<ScaleType, string>;
export const SCALE_PREFIX: Record<ScaleType, string>;
export const SCALE_FIELDS: Record<ScaleType, Record<string, ScaleField>>;
export const SCALE_ROOT_GROUPS: Record<ScaleType, readonly string[]>;
export const SCALE_ENUMS: Record<ScaleType, Record<string, readonly string[]>>;
export const SCALE_ENUM_DEFAULTS: Record<ScaleType, Record<string, string>>;
export const SCALE_ENUM_VALUES: Record<string, Record<string, string>>;
/** Normalized data: group → field → number | enum word. */
export type ScaleData = Record<string, Record<string, number | string>>;
export function isScaleType(type: string): type is ScaleType;
export function scaleGroups(type: ScaleType): string[];
export function normalizeScale(type: ScaleType, raw: unknown): ScaleData;
export function scaleErrors(type: string, raw: unknown): string[];
export function scaleToken(type: ScaleType, path: string): string;
export function scaleValue(unit: ScaleUnit, v: number): string;
export function scaleVars(type: ScaleType, raw: unknown): Record<string, string>;
export function scaleSchemaProperties(type: ScaleType): Record<string, unknown>;
