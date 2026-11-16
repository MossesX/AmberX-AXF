/**
 * Shape engine — shape@1 (build banner-widget-shapes-more-than-circle, Brett Nov 14 2026: "banner widgets can only be
 * circles or pills"). The rules (kinds, corners, mask, validator, schema) live in shape-rules.mjs, shared with the build
 * engine; this file is the typed engine the runtime, React and the fixtures use: it compiles a shape asset to the tokens
 * one *slot* of chips reads, resolves which shape is in force at a place (global → skin → app → instance, the child
 * overriding the parent, on the model of resolveLookSkin), and keeps the edit history Restore previous edit reads.
 *
 * Compiled tokens, per slot (`widget` = every chip-like banner widget; pure, identical on every port):
 *   --fx-shape-<slot>-radius   four corner radii in CSS order (style-theme tokens or 0 / 999px), always four values
 *   --fx-shape-<slot>-clip     a clip-path: polygon(…) for hexagon / diamond / tag / squircle, else `none`
 *   --fx-shape-<slot>-mask     a mask-image: url("data:image/svg+xml,…") built from the asset's closed path, else `none`
 *   --fx-shape-<slot>-corner   `round`, or `squircle` for browsers that draw CSS corner-shape
 *   --fx-shape-<slot>-aspect   `1` when the shape keeps a square box (circle, diamond, hexagon), else `auto`
 *   data-fx-shape-<slot>       the kind, for stylesheet rules that need more than the tokens
 *
 * Built-in kinds that a radius cannot draw are polygons in percentages, so they scale with the chip: hexagon, diamond
 * and tag (a label with a point one text height deep). The squircle is a superellipse |x|ⁿ + |y|ⁿ = 1 (n = 4) as a
 * closed SVG path, served as a mask like a `mask` kind: an SVG path in its own viewBox, stretched over the box
 * (preserveAspectRatio none). A stylesheet reads radius + clip + mask together; whichever is not `none` cuts the chip.
 * No DOM, no I/O. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { KIND_RADIUS, RADIUS_CSS, SHAPE_VIEWBOX_DEFAULT, normalizeShape, parseViewBox, shapeCornerSteps, shapeSquare, type ShapeData, type ShapeKind, type ShapeRadius } from './shape-rules.mjs';

/** The one slot today: every chip-like banner widget. */
export const SHAPE_SLOT_DEFAULT = 'widget';
export const SHAPE_TOKEN_PREFIX = '--fx-shape';
export const SHAPE_TOKEN_FIELDS = ['radius', 'clip', 'mask', 'corner', 'aspect'] as const;
export type ShapeTokenField = (typeof SHAPE_TOKEN_FIELDS)[number];
/** Superellipse exponent and samples per quadrant for the squircle polygon. */
export const SQUIRCLE_EXPONENT = 4;
export const SQUIRCLE_SAMPLES = 12;

const SLOT = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A slot name a token may carry (lower-case id), else the default slot. */
export function shapeSlotName(slot?: string | null): string {
  return typeof slot === 'string' && SLOT.test(slot) ? slot : SHAPE_SLOT_DEFAULT;
}

/** The token one field of one slot is read from: `--fx-shape-widget-radius`. */
export function shapeToken(field: ShapeTokenField, slot?: string | null): string {
  return `${SHAPE_TOKEN_PREFIX}-${shapeSlotName(slot)}-${field}`;
}

/** The root attribute that names the slot's kind: `data-fx-shape-widget`. */
export function shapeAttr(slot?: string | null): string {
  return `data-fx-shape-${shapeSlotName(slot)}`;
}

/* ---------------------------------------------------------------- geometry */

const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/**
 * Points of the superellipse |x|ⁿ + |y|ⁿ = 1 mapped to a 0–100 box, clockwise from the top centre. `samples` points per
 * quadrant (the corners of the box are never reached: that is the squircle).
 */
export function superellipsePoints(n = SQUIRCLE_EXPONENT, samples = SQUIRCLE_SAMPLES): [number, number][] {
  const out: [number, number][] = [];
  const total = Math.max(4, Math.floor(samples)) * 4;
  for (let i = 0; i < total; i++) {
    const t = (i / total) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const x = Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = Math.sign(s) * Math.abs(s) ** (2 / n);
    out.push([Math.round((50 + 50 * x) * 100) / 100, Math.round((50 - 50 * y) * 100) / 100]);
  }
  return out;
}

/** The squircle as closed SVG path data in the default 0–100 box (a mask, so it follows the chip's box and stays smooth). */
export function squirclePath(samples = SQUIRCLE_SAMPLES * 2): string {
  const pts = superellipsePoints(SQUIRCLE_EXPONENT, samples);
  return `M ${pts.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
}

/** The built-in clipped kinds as polygons in percentages. The tag's point is one text height deep so it reads at any width. */
export const SHAPE_POLYGONS: Readonly<Record<string, string>> = {
  hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
  diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
  tag: 'polygon(0 0, calc(100% - 0.6em) 0, 100% 50%, calc(100% - 0.6em) 100%, 0 100%)',
};

/** The squircle as a clip-path polygon, for a stylesheet that prefers clipping to masking (same points, coarser). */
export function squirclePolygon(): string {
  return `polygon(${superellipsePoints().map(([x, y]) => `${pct(x)} ${pct(y)}`).join(', ')})`;
}

/** The clip-path a shape needs, `none` when a radius or a mask does the work. */
export function shapeClip(shape: unknown): string {
  const s = normalizeShape(shape);
  return SHAPE_POLYGONS[s.kind] ?? 'none';
}

/** An SVG document that draws one closed path over its viewBox, stretched to whatever box it masks. */
export function maskSvg(path: string, viewBox: string = SHAPE_VIEWBOX_DEFAULT): string {
  const vb = parseViewBox(viewBox);
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${vb.minX} ${vb.minY} ${vb.width} ${vb.height}' preserveAspectRatio='none'><path d='${path}'/></svg>`;
}

/** The SVG as a CSS url() data URI (only the characters a data URI needs encoded are encoded, so it stays readable). */
export function svgDataUrl(svg: string): string {
  return `url("data:image/svg+xml,${svg.replace(/[<>#"%{}|\\^`]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)}")`;
}

/** The mask-image a shape needs: the asset's path (`mask` kind) or the superellipse (`squircle`), `none` for every other kind. */
export function shapeMask(shape: unknown): string {
  const s = normalizeShape(shape);
  if (s.kind === 'squircle') return svgDataUrl(maskSvg(squirclePath()));
  return s.kind === 'mask' && s.mask ? svgDataUrl(maskSvg(s.mask, s.viewBox)) : 'none';
}

/** Four corner radii in CSS order, as one value: `var(--fx-radius-md) 0 0 999px`. */
export function shapeRadiusFour(shape: unknown): string {
  return shapeCornerSteps(shape).map((st: ShapeRadius) => RADIUS_CSS[st]).join(' ');
}

/* ---------------------------------------------------------------- compile */

export interface ShapeTokens { vars: Record<string, string>; attrs: Record<string, string> }

/** What the stylesheet reads for one slot: the five tokens plus the root attribute (StyleOutput, like components.ts). */
export function compileShape(shape: unknown, slot?: string | null): ShapeTokens {
  const s: ShapeData = normalizeShape(shape);
  const vars: Record<string, string> = {
    [shapeToken('radius', slot)]: shapeRadiusFour(s),
    [shapeToken('clip', slot)]: shapeClip(s),
    [shapeToken('mask', slot)]: shapeMask(s),
    [shapeToken('corner', slot)]: s.kind === 'squircle' ? 'squircle' : 'round',
    [shapeToken('aspect', slot)]: shapeSquare(s) ? '1' : 'auto',
  };
  return { vars, attrs: { [shapeAttr(slot)]: s.kind } };
}

/** The same tokens as inline style for one widget that names its own shape (per-instance). */
export function shapeInlineVars(shape: unknown, slot?: string | null): Record<string, string> {
  return compileShape(shape, slot).vars;
}

/** The default shape's data: what no asset at all compiles to. */
export const DEFAULT_SHAPE: ShapeData = normalizeShape(null);
/** Every kind with its default corner steps (pickers and docs list them from here). */
export const SHAPE_KIND_DEFAULTS: Readonly<Record<ShapeKind, ShapeRadius>> = KIND_RADIUS;

/* ---------------------------------------------------------------- resolve + history (engines/shape-scope.mjs) */

// The chain (global → skin → app → instance) and Restore previous edit live in shape-scope.mjs, shared with the CLI.
// named, not `export *`: tsx links a star re-export of a .mjs module as empty when the importer is a .mts file
export { SHAPE_HISTORY_MAX, SHAPE_HISTORY_SETTING, SHAPE_KEY_APP, SHAPE_KEY_GLOBAL, SHAPE_KEY_SKIN, SHAPE_LEVELS, SHAPE_SETTING, SHAPE_SKIN_SETTING, SHAPE_WIDGET_SETTING_PREFIX, SHAPE_WIDGET_SETTING_SUFFIX, forgetShapeEdit, normalizeShapeHistory, previousShape, recordShapeEdit, resolveShape, resolveShapeAt, restorePreviousShape, shapeId, shapeScopeChain, shapeScopeKey, shapeScopeLevel } from './shape-scope.mjs';
export type { ShapeEdit, ShapeHistory, ShapeLevel, ShapeResolved, ShapeScopeEntry } from './shape-scope.mjs';
import { shapeId } from './shape-scope.mjs';

/* ---------------------------------------------------------------- the banner's own default (the lowest level) */

/** What a banner asset with no `shape` field draws: circles for icon-only widgets, pills for chips (today's look). */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const BANNER_SHAPE_DEFAULTS: Readonly<{ icon: string; chip: string }> = { icon: 'circle', chip: 'pill' };

/**
 * The shape a banner asset gives one of its widgets when nobody picked one anywhere in the chain: `data.shape.icon` for
 * an icon-only / square widget, `data.shape.chip` for one with text, else BANNER_SHAPE_DEFAULTS. A junk id falls back.
 */
export function bannerShapeDefault(bannerData: unknown, iconOnly: boolean): string {
  const s = isObj(bannerData) && isObj(bannerData.shape) ? bannerData.shape : {};
  const id = shapeId(iconOnly ? s.icon : s.chip);
  return id || (iconOnly ? BANNER_SHAPE_DEFAULTS.icon : BANNER_SHAPE_DEFAULTS.chip);
}
