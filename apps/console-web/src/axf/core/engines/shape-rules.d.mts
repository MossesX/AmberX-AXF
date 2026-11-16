// Types for shape-rules.mjs (shape@1; shared by the shape engine (shape.ts), the runtime compile and the build engine).
export const SHAPE_TYPE: 'shape';
export const SHAPE_FRAME: 'shape@1';
export const SHAPE_KINDS: readonly ['circle', 'pill', 'rounded', 'square', 'squircle', 'hexagon', 'diamond', 'tag', 'corners', 'mask'];
export const SHAPE_RADII: readonly ['none', 'sm', 'md', 'lg', 'pill'];
export const SHAPE_CORNERS: readonly ['tl', 'tr', 'br', 'bl'];
export const SHAPE_SQUARE_KINDS: readonly string[];
export const SHAPE_CLIPPED_KINDS: readonly string[];
export const SHAPE_DEFAULT_KIND: 'pill';
export const SHAPE_MASK_MAX: number;
export const SHAPE_VIEWBOX_DEFAULT: '0 0 100 100';
export const KIND_RADIUS: Record<ShapeKind, ShapeRadius>;
export const RADIUS_CSS: Record<ShapeRadius, string>;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type ShapeRadius = (typeof SHAPE_RADII)[number];
export type ShapeCorner = (typeof SHAPE_CORNERS)[number];
/**
 * shape@1 data: the kind, optional per-corner radius steps (tokens), for kind `mask` the closed SVG path and the box it
 * is drawn in, and an optional square-box flag.
 */
export interface ShapeData {
  kind: ShapeKind;
  corners?: Partial<Record<ShapeCorner, ShapeRadius>>;
  mask?: string;
  viewBox?: string;
  square?: boolean;
}
export interface ShapeViewBox { minX: number; minY: number; width: number; height: number }
export function maskProblem(v: unknown): string;
export function isShapeMask(v: unknown): v is string;
export function isViewBox(v: unknown): v is string;
export function parseViewBox(v: unknown): ShapeViewBox;
export function normalizeShape(raw: unknown): ShapeData;
export function shapeErrors(type: string, data: unknown): string[];
export function shapeCornerSteps(shape: unknown): ShapeRadius[];
export function shapeRadius(shape: unknown): string;
export function shapeSquare(shape: unknown): boolean;
export function shapeSchemaProperties(): Record<string, unknown>;
export declare const SHAPE_WIDGET_TOKENS: string[];
