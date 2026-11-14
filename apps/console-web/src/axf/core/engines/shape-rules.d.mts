// Types for shape-rules.mjs (shape@1; shared by the TS engine, the runtime compile and the build engine).
export const SHAPE_TYPE: 'shape';
export const SHAPE_FRAME: 'shape@1';
export const SHAPE_KINDS: readonly ['circle', 'pill', 'rounded', 'square', 'squircle', 'hexagon', 'diamond', 'tag', 'custom'];
export const SHAPE_RADII: readonly ['none', 'sm', 'md', 'lg', 'pill'];
export const SHAPE_CORNERS: readonly ['tl', 'tr', 'br', 'bl'];
export const SHAPE_SQUARE_KINDS: readonly string[];
export const SHAPE_DEFAULT_KIND: 'pill';
export const SHAPE_MASK_MAX: number;
export const RADIUS_CSS: Record<ShapeRadius, string>;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type ShapeRadius = (typeof SHAPE_RADII)[number];
export type ShapeCorner = (typeof SHAPE_CORNERS)[number];
/** shape@1 data: the kind, optional per-corner radius steps, an optional custom mask, an optional square-box flag. */
export interface ShapeData {
  kind: ShapeKind;
  corners?: Partial<Record<ShapeCorner, ShapeRadius>>;
  mask?: string;
  square?: boolean;
}
export interface ShapeStyle { vars: Record<string, string>; attrs: Record<string, string> }
export function isShapeMask(v: unknown): v is string;
export function maskClip(mask: string): string;
export function normalizeShape(raw: unknown): ShapeData;
export function shapeErrors(type: string, data: unknown): string[];
export function shapeRadius(shape: unknown): string;
export function shapeClip(shape: unknown): string;
export function shapeSquare(shape: unknown): boolean;
export function shapeStyle(shape: unknown): ShapeStyle;
export function shapeInlineVars(shape: unknown): Record<string, string>;
export function shapeSchemaProperties(): Record<string, unknown>;
