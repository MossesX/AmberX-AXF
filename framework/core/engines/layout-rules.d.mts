// Types for layout-rules.mjs (every layout parameter is a token; shared by the TS engines and the build engine).
export type LayoutUnit = 'px' | 'space' | 'int';
export type LayoutField = readonly [number, number, number, LayoutUnit];
export const LAYOUT_TYPE: 'layout';
export const LAYOUT_PREFIX: string;
export const LAYOUT_FIELDS: Record<string, LayoutField>;
export const LAYOUT_ENUMS: Record<string, readonly string[]>;
export const LAYOUT_ENUM_DEFAULTS: Record<string, string>;
export const LAYOUT_SWITCHES: Record<string, boolean>;
export const LAYOUT_VIEWPORTS: readonly { field: string; attr: string }[];
export interface LayoutTokenInfo {
  field: string;
  token: string;
  kind: 'number' | 'enum' | 'switch';
  unit?: LayoutUnit;
  default: number | string | boolean;
  min?: number;
  max?: number;
  options?: string[];
}
export function isLayoutType(type: string): type is 'layout';
export function layoutFieldNames(): string[];
export function normalizeLayout<T>(raw: T): T & Record<string, number | string | boolean>;
export function layoutErrors(type: string, raw: unknown): string[];
export function layoutToken(field: string): string;
export function layoutValue(unit: LayoutUnit, v: number): string;
export function layoutTokenVars(raw: unknown): Record<string, string>;
export function layoutTokens(): LayoutTokenInfo[];
export function layoutSchemaProperties(): Record<string, unknown>;
export function layoutBreakpointAttr(px: number, kind?: 'max' | 'min', raw?: unknown): { attr: string; field: string; maxWidth: number; negate: boolean } | null;
export function layoutViewportAttrs(raw: unknown, widthPx: number): Record<string, string>;
