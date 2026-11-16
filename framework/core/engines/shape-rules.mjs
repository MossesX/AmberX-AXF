/**
 * shape@1 rules (build banner-widget-shapes-more-than-circle, Brett Nov 14 2026: "banner widgets can only be circles or
 * pills"): the shape every chip-like banner widget is cut to (badges, counters, the theme switch, avatars, dots, the
 * progress bar, the ⋯ button). A shape is an asset, so it swaps with the skin, sits in Appearance → Assets like any
 * slot, and a banner widget may name one of its own (per-instance, `BannerWidgetPref.shape`).
 *
 * ONE registry drives the normalizer, the validator (TS + build engine), the JSON Schema and the shape engine
 * (core/engines/shape.ts) that compiles the active shape to the `--fx-shape-<slot>-*` tokens the stylesheet reads.
 *
 * The contract (schemas/asset-types.json → shape):
 *   kind      circle | pill | rounded | square | squircle | hexagon | diamond | tag | corners | mask
 *   corners   { tl?, tr?, br?, bl? }: a radius step per corner, each a style-theme token (none | sm | md | lg | pill),
 *             never a length; required for `corners`, allowed on every other kind as an override
 *   mask      SVG path data (M … Z), closed, at most 2000 characters, no script and no external reference; `mask` only
 *   viewBox   "minX minY width height" the path is drawn in (default 0 0 100 100); `mask` only
 *   square    keep a 1:1 box (default: circle, diamond and hexagon do)
 *
 * Defaults = today's look: the `pill` starter is a 999px radius and no clip, which is the circle every square widget
 * (avatar, dot, icon badge) drew and the pill every wide one drew before shapes existed. Every radius step is a
 * style-theme token (`--fx-radius-sm|md|lg`), never a literal, so the shape follows the skin's corners.
 *
 * Unknown fields are dropped, never an error; an unknown kind is the default. Shared with the build engine (plain .mjs),
 * like scale-rules.mjs. Pure, no DOM. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const SHAPE_TYPE = 'shape';
export const SHAPE_FRAME = 'shape@1';

/** Every shape a widget may be cut to. `corners` is a per-corner radius shape; `mask` draws an SVG path. */
export const SHAPE_KINDS = ['circle', 'pill', 'rounded', 'square', 'squircle', 'hexagon', 'diamond', 'tag', 'corners', 'mask'];
/** Radius steps a corner may take: the style theme's radii, nothing, or a full pill. Tokens, never lengths. */
export const SHAPE_RADII = ['none', 'sm', 'md', 'lg', 'pill'];
/** The four corners, in CSS order (border-radius reads them clockwise from the top left). */
export const SHAPE_CORNERS = ['tl', 'tr', 'br', 'bl'];
/** Shapes that keep a 1:1 box (a wide text chip would stretch them out of shape). */
export const SHAPE_SQUARE_KINDS = ['circle', 'diamond', 'hexagon'];
/** Kinds a border radius cannot draw: they need a clip (polygon) or a mask (SVG path). */
export const SHAPE_CLIPPED_KINDS = ['squircle', 'hexagon', 'diamond', 'tag', 'mask'];
/** The default shape: what every banner widget looked like before shape@1. */
export const SHAPE_DEFAULT_KIND = 'pill';
/** Widest a mask path may be. */
export const SHAPE_MASK_MAX = 2000;
/** The box a mask path is drawn in when the asset names none. */
export const SHAPE_VIEWBOX_DEFAULT = '0 0 100 100';

/**
 * The compiled token set of the default slot (`widget`), written out so the theme checks know them (engines/shape.ts
 * builds them per slot; spec/check-shape.mts checks the two lists agree).
 */
export const SHAPE_WIDGET_TOKENS = ['--fx-shape-widget-radius', '--fx-shape-widget-clip', '--fx-shape-widget-mask', '--fx-shape-widget-corner', '--fx-shape-widget-aspect'];

/** The default radius step of each kind (what `corners` overrides). */
export const KIND_RADIUS = { circle: 'pill', pill: 'pill', rounded: 'md', square: 'none', squircle: 'lg', hexagon: 'none', diamond: 'none', tag: 'none', corners: 'md', mask: 'none' };
/** Radius step → stylesheet value: theme tokens, never a literal size (999px is the pill shape, allowed by check-theme). */
export const RADIUS_CSS = { none: '0', sm: 'var(--fx-radius-sm)', md: 'var(--fx-radius-md)', lg: 'var(--fx-radius-lg)', pill: '999px' };

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** SVG path data: commands, numbers (with exponents), separators. Nothing else can get in (no `<`, `(`, `:`, `#`). */
const PATH_DATA = /^[Mm][MmZzLlHhVvCcSsQqTtAa0-9\s,.+\-eE]*$/;
const SCRIPT = /<\s*script|javascript:|on[a-z]+\s*=/i;
const EXTERNAL = /url\s*\(|https?:|xlink:|href|@import|<\s*(use|image|foreignObject)/i;
const VIEWBOX = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/;

/**
 * Why a mask is refused, or '' when it is usable: not text, empty or too long, script, an external reference, not SVG
 * path data, or not closed (every subpath must end in Z so the mask has an inside).
 */
export function maskProblem(v) {
  if (typeof v !== 'string') return 'must be SVG path data (M … Z)';
  const s = v.trim();
  if (!s) return 'must not be empty';
  if (s.length > SHAPE_MASK_MAX) return `must be at most ${SHAPE_MASK_MAX} characters`;
  if (SCRIPT.test(s)) return 'must not contain script';
  if (EXTERNAL.test(s)) return 'must not reference anything outside the path (no url(), links or images)';
  if (!PATH_DATA.test(s)) return 'must be SVG path data (M … Z): commands and numbers only';
  if (!/[Zz]\s*$/.test(s)) return 'must be a closed path (end with Z)';
  return '';
}

/** Is this a usable mask: closed SVG path data with nothing but commands and numbers in it? */
export function isShapeMask(v) {
  return maskProblem(v) === '';
}

/** Is this a usable viewBox ("minX minY width height", width and height above zero)? */
export function isViewBox(v) {
  if (typeof v !== 'string') return false;
  const m = VIEWBOX.exec(v.trim());
  return !!m && Number(m[3]) > 0 && Number(m[4]) > 0;
}

/** A viewBox as four numbers (the default when the text is not one). */
export function parseViewBox(v) {
  const m = VIEWBOX.exec(isViewBox(v) ? v.trim() : SHAPE_VIEWBOX_DEFAULT);
  return { minX: Number(m[1]), minY: Number(m[2]), width: Number(m[3]), height: Number(m[4]) };
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
  if (kind === 'mask' && isShapeMask(d.mask)) {
    out.mask = d.mask.trim().replace(/\s+/g, ' ');
    if (isViewBox(d.viewBox) && d.viewBox.trim() !== SHAPE_VIEWBOX_DEFAULT) out.viewBox = d.viewBox.trim().replace(/\s+/g, ' ');
  }
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
      else if (typeof v === 'number') errors.push(`data.corners.${k} must be a radius token (one of: ${SHAPE_RADII.join(', ')}), not a length${v < 0 ? ' (and never negative)' : ''}`);
      else if (!SHAPE_RADII.includes(v)) errors.push(`data.corners.${k} must be one of: ${SHAPE_RADII.join(', ')}`);
    }
  }
  if (data.kind === 'corners' && !(isObj(data.corners) && SHAPE_CORNERS.some((k) => SHAPE_RADII.includes(data.corners[k])))) errors.push('data.kind corners needs corners (at least one of tl, tr, br, bl)');
  if ('mask' in data) {
    const why = maskProblem(data.mask);
    if (why) errors.push(`data.mask ${why}`);
    if (data.kind !== 'mask' && SHAPE_KINDS.includes(data.kind)) errors.push('data.mask only applies to kind mask');
  }
  if (data.kind === 'mask' && !('mask' in data)) errors.push('data.kind mask needs a mask (SVG path data, M … Z)');
  if ('viewBox' in data) {
    if (!isViewBox(data.viewBox)) errors.push('data.viewBox must be "minX minY width height" with width and height above zero');
    if (data.kind !== 'mask' && SHAPE_KINDS.includes(data.kind)) errors.push('data.viewBox only applies to kind mask');
  }
  if ('square' in data && typeof data.square !== 'boolean') errors.push('data.square must be true or false');
  return errors;
}

/** The radius step of every corner, CSS order: the asset's corners over the kind's default. */
export function shapeCornerSteps(shape) {
  const s = normalizeShape(shape);
  const dflt = KIND_RADIUS[s.kind];
  return SHAPE_CORNERS.map((k) => s.corners?.[k] ?? dflt);
}

/** The radius a shape draws: one value when every corner agrees, else four (CSS order). */
export function shapeRadius(shape) {
  const vals = shapeCornerSteps(shape).map((st) => RADIUS_CSS[st]);
  return vals.every((v) => v === vals[0]) ? vals[0] : vals.join(' ');
}

/** Does the shape keep a square box? The asset may say so either way; the kind decides otherwise. */
export function shapeSquare(shape) {
  const s = normalizeShape(shape);
  return typeof s.square === 'boolean' ? s.square : SHAPE_SQUARE_KINDS.includes(s.kind);
}

/** JSON Schema properties for the type (the required `kind` comes from the registry's enum). */
export function shapeSchemaProperties() {
  return {
    kind: { enum: [...SHAPE_KINDS] },
    corners: { type: 'object', additionalProperties: false, description: 'A radius step per corner: style-theme tokens, never lengths (required for kind corners)', properties: Object.fromEntries(SHAPE_CORNERS.map((k) => [k, { enum: [...SHAPE_RADII] }])) },
    mask: { type: 'string', minLength: 2, maxLength: SHAPE_MASK_MAX, pattern: '^[Mm][MmZzLlHhVvCcSsQqTtAa0-9\\s,.+\\-eE]*[Zz]\\s*$', description: 'SVG path data (M … Z), closed, commands and numbers only (kind mask)' },
    viewBox: { type: 'string', pattern: '^-?\\d+(\\.\\d+)?\\s+-?\\d+(\\.\\d+)?\\s+\\d+(\\.\\d+)?\\s+\\d+(\\.\\d+)?$', description: 'The box the mask path is drawn in, "minX minY width height" (default 0 0 100 100; kind mask)' },
    square: { type: 'boolean', description: 'Keep a 1:1 box (default: circle, diamond and hexagon do)' },
  };
}
