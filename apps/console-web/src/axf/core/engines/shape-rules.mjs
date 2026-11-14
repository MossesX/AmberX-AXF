/**
 * shape@1 rules (build banner-widget-shapes-more-than-circle, Brett Nov 14 2026: "banner widgets can only be circles or
 * pills"): the shape every chip-like banner widget is cut to (badges, counters, the theme switch, avatars, dots, the
 * progress bar, the ⋯ button). A shape is an asset, so it swaps with the skin, sits in Appearance → Assets like any
 * slot, and a banner widget may name one of its own (per-instance, `BannerWidgetPref.shape`).
 *
 * ONE registry drives the normalizer, the validator (TS + build engine), the JSON Schema and the engine that compiles the
 * active shape to tokens the stylesheet reads:
 *
 *   --fx-widget-radius   the border radius (one value, or four for per-corner shapes)
 *   --fx-widget-clip     a clip-path for shapes a radius can't make (hexagon, diamond, tag, custom), else `none`
 *   --fx-widget-corner   `round` (the default), or `squircle` for browsers that draw CSS corner-shape
 *   --fx-widget-aspect   `1` when the shape keeps a square box (circle, diamond, hexagon), else `auto`
 *   data-fx-shape        the kind, for stylesheet rules that need more than the tokens
 *
 * Defaults = today's look: the `pill` starter compiles to a 999px radius and no clip, which is the circle every square
 * widget (avatar, dot, icon badge) drew and the pill every wide one drew before shapes existed. Every radius step is a
 * style-theme token (`--fx-radius-sm|md|lg`), never a literal, so the shape follows the skin's corners.
 *
 * Unknown fields are dropped, never an error; an unknown kind is the default. Shared with the build engine (plain .mjs),
 * like scale-rules.mjs. Pure, no DOM. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const SHAPE_TYPE = 'shape';
export const SHAPE_FRAME = 'shape@1';

/** Every shape a widget may be cut to. `custom` draws `mask` (an SVG path or CSS basic shape) over `corners`. */
export const SHAPE_KINDS = ['circle', 'pill', 'rounded', 'square', 'squircle', 'hexagon', 'diamond', 'tag', 'custom'];
/** Radius steps a corner may take: the style theme's radii, nothing, or a full pill. */
export const SHAPE_RADII = ['none', 'sm', 'md', 'lg', 'pill'];
/** The four corners, in CSS order (border-radius reads them clockwise from the top left). */
export const SHAPE_CORNERS = ['tl', 'tr', 'br', 'bl'];
/** Shapes that keep a 1:1 box (a wide text chip would stretch them out of shape). */
export const SHAPE_SQUARE_KINDS = ['circle', 'diamond', 'hexagon'];
/** The default shape: what every banner widget looked like before shape@1. */
export const SHAPE_DEFAULT_KIND = 'pill';
/** Widest a custom mask may be (an SVG path or a CSS basic shape). */
export const SHAPE_MASK_MAX = 2000;

/** How the kinds are cut: the default radius step of each, and whether a clip is needed. */
const KIND_RADIUS = { circle: 'pill', pill: 'pill', rounded: 'md', square: 'none', squircle: 'lg', hexagon: 'none', diamond: 'none', tag: 'none', custom: 'md' };
const CLIP = {
  hexagon: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
  diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
  // a label tag: square at the start, a point at the end; the point is one text height deep so it reads at any width
  tag: 'polygon(0 0, calc(100% - 0.6em) 0, 100% 50%, calc(100% - 0.6em) 100%, 0 100%)',
};
/** Radius step → stylesheet value: theme tokens, never a literal size (999px is the pill shape, allowed by check-theme). */
export const RADIUS_CSS = { none: '0', sm: 'var(--fx-radius-sm)', md: 'var(--fx-radius-md)', lg: 'var(--fx-radius-lg)', pill: '999px' };

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const BASIC_SHAPE = /^(polygon|path|inset|circle|ellipse|rect|xywh)\(/;
const SVG_PATH = /^[Mm][\dA-Za-z\s,.+-]*$/;
/** Characters a basic shape may hold: the function, numbers, units, calc(), var(--fx-…), percentages, commas, spaces. */
const SAFE_SHAPE = /^[A-Za-z0-9\s,.%()+*/-]*$/;

/** Is this a usable custom mask: a CSS basic shape (`polygon(…)`, `path('…')`, …) or a bare SVG path (`M … Z`)? */
export function isShapeMask(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > SHAPE_MASK_MAX) return false;
  if (SVG_PATH.test(s)) return true;
  return BASIC_SHAPE.test(s) && SAFE_SHAPE.test(s.replace(/'[^']*'|"[^"]*"/g, ''));
}

/** A mask as a clip-path value: a bare SVG path is wrapped in `path('…')`. */
export function maskClip(mask) {
  const s = mask.trim();
  return BASIC_SHAPE.test(s) ? s : `path('${s.replace(/'/g, '')}')`;
}

/** A shape asset's data, every field checked: unknown kind = the default, bad corners dropped, a bad mask dropped. */
export function normalizeShape(raw) {
  const d = isObj(raw) ? raw : {};
  const kind = SHAPE_KINDS.includes(d.kind) ? d.kind : SHAPE_DEFAULT_KIND;
  const out = { kind };
  if (isObj(d.corners)) {
    const c = {};
    for (const k of SHAPE_CORNERS) if (SHAPE_RADII.includes(d.corners[k])) c[k] = d.corners[k];
    if (Object.keys(c).length) out.corners = c;
  }
  if (isShapeMask(d.mask)) out.mask = d.mask.trim();
  if (typeof d.square === 'boolean') out.square = d.square;
  return out;
}

/** Problems with a shape asset's data (both validators print these; same strings on every port). */
export function shapeErrors(type, data) {
  if (type !== SHAPE_TYPE) return [];
  const errors = [];
  if (!isObj(data)) return ['data must be an object'];
  if ('kind' in data && !SHAPE_KINDS.includes(data.kind)) errors.push(`data.kind must be one of: ${SHAPE_KINDS.join(', ')}`);
  if ('corners' in data) {
    if (!isObj(data.corners)) errors.push('data.corners must be an object of tl, tr, br, bl');
    else for (const [k, v] of Object.entries(data.corners)) {
      if (!SHAPE_CORNERS.includes(k)) errors.push(`data.corners.${k} is not a corner (one of: ${SHAPE_CORNERS.join(', ')})`);
      else if (!SHAPE_RADII.includes(v)) errors.push(`data.corners.${k} must be one of: ${SHAPE_RADII.join(', ')}`);
    }
  }
  if ('mask' in data && !isShapeMask(data.mask)) errors.push(`data.mask must be a CSS basic shape (polygon(…), path('…'), inset(…)) or an SVG path (M … Z), at most ${SHAPE_MASK_MAX} characters`);
  if (data.kind === 'custom' && !('mask' in data) && !('corners' in data)) errors.push('data.kind custom needs a mask or corners');
  if ('square' in data && typeof data.square !== 'boolean') errors.push('data.square must be true or false');
  return errors;
}

/** The radius a shape draws: one value when every corner agrees, else four (CSS order). */
export function shapeRadius(shape) {
  const s = normalizeShape(shape);
  const dflt = KIND_RADIUS[s.kind];
  const steps = SHAPE_CORNERS.map((k) => s.corners?.[k] ?? dflt);
  // a clipped polygon has no round corners of its own: the radius only matters where no clip runs
  const vals = steps.map((st) => RADIUS_CSS[st]);
  return vals.every((v) => v === vals[0]) ? vals[0] : vals.join(' ');
}

/** The clip-path a shape needs, `none` when a radius is enough. */
export function shapeClip(shape) {
  const s = normalizeShape(shape);
  if (s.kind === 'custom') return s.mask ? maskClip(s.mask) : 'none';
  return CLIP[s.kind] ?? 'none';
}

/** Does the shape keep a square box? The asset may say so either way; the kind decides otherwise. */
export function shapeSquare(shape) {
  const s = normalizeShape(shape);
  return typeof s.square === 'boolean' ? s.square : SHAPE_SQUARE_KINDS.includes(s.kind);
}

/** What the stylesheet reads: the tokens plus the root attribute (StyleOutput, like components.ts). */
export function shapeStyle(shape) {
  const s = normalizeShape(shape);
  return {
    vars: {
      '--fx-widget-radius': shapeRadius(s),
      '--fx-widget-clip': shapeClip(s),
      '--fx-widget-corner': s.kind === 'squircle' ? 'squircle' : 'round',
      '--fx-widget-aspect': shapeSquare(s) ? '1' : 'auto',
    },
    attrs: { 'data-fx-shape': s.kind },
  };
}

/** The same tokens as inline style for one widget that names its own shape (per-instance). */
export function shapeInlineVars(shape) {
  return shapeStyle(shape).vars;
}

/** JSON Schema properties for the type (the required `kind` comes from the registry's enum). */
export function shapeSchemaProperties() {
  return {
    kind: { enum: [...SHAPE_KINDS] },
    corners: { type: 'object', additionalProperties: false, properties: Object.fromEntries(SHAPE_CORNERS.map((k) => [k, { enum: [...SHAPE_RADII] }])) },
    mask: { type: 'string', maxLength: SHAPE_MASK_MAX, description: "A CSS basic shape (polygon(…), path('…'), inset(…)) or an SVG path (M … Z) in a 0–100 box" },
    square: { type: 'boolean', description: 'Keep a 1:1 box (default: circle, diamond and hexagon do)' },
  };
}
