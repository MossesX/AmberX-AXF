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
import { KIND_RADIUS, RADIUS_CSS, SHAPE_DEFAULT_KIND, SHAPE_VIEWBOX_DEFAULT, normalizeShape, parseViewBox, shapeCornerSteps, shapeSquare, type ShapeData, type ShapeKind, type ShapeRadius } from './shape-rules.mjs';

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

/* ---------------------------------------------------------------- resolve: the shape in force at a place */

/**
 * The levels a shape is picked at, from the leaf to the root. Like the skin chain (`resolveSkinChain`), the chain is
 * walked from the most specific level and the first level that names a shape decides; a level with nothing inherits.
 *   instance  one banner widget (setting `axf.banner.widget.<type:id>.shape`, `BannerWidgetPref.shape`)
 *   app       the app's own slot pick (Appearance → Assets → Widget shape, `swap:shape:<id>`)
 *   skin      the skin in force at the place (`assets.shape` in skin@1)
 *   global    the hub-wide pick (setting `axf.shape`)
 * Nothing anywhere = the default kind (`pill`, today's look).
 */
export const SHAPE_LEVELS = ['instance', 'app', 'skin', 'global'] as const;
export type ShapeLevel = (typeof SHAPE_LEVELS)[number];
export const SHAPE_KEY_GLOBAL = 'global';
export const SHAPE_KEY_SKIN = 'skin';
export const SHAPE_KEY_APP = 'app';
/** The hub-wide setting the global level reads. */
export const SHAPE_SETTING = 'axf.shape';
/** The per-widget setting prefix and suffix: `axf.banner.widget.<type:id>.shape`. */
export const SHAPE_WIDGET_SETTING_PREFIX = 'axf.banner.widget.';
export const SHAPE_WIDGET_SETTING_SUFFIX = '.shape';
/** A shape asset id (the envelope id pattern); '' = nothing picked at this level. */
const SHAPE_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** A banner widget key, `type:id` (engines/bannerwidgets.ts KEY). */
const WIDGET_KEY = /^[a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$/;

/** A shape asset id, or '' for anything that is not one. */
export function shapeId(v: unknown): string {
  return typeof v === 'string' && SHAPE_ID.test(v) ? v : '';
}

/** The key of one level: `axf.banner.widget.<widget>.shape` for an instance, else the level name. */
export function shapeScopeKey(level: ShapeLevel, widget?: string | null): string {
  if (level === 'instance') {
    if (typeof widget !== 'string' || !WIDGET_KEY.test(widget)) throw new Error('an instance level needs a banner widget key (type:id)');
    return `${SHAPE_WIDGET_SETTING_PREFIX}${widget}${SHAPE_WIDGET_SETTING_SUFFIX}`;
  }
  return level;
}

/** The level a key belongs to (an instance key carries the widget), or null for a key that is none of them. */
export function shapeScopeLevel(key: string): { level: ShapeLevel; widget?: string } | null {
  if (key === SHAPE_KEY_GLOBAL || key === SHAPE_KEY_SKIN || key === SHAPE_KEY_APP) return { level: key };
  if (key.startsWith(SHAPE_WIDGET_SETTING_PREFIX) && key.endsWith(SHAPE_WIDGET_SETTING_SUFFIX)) {
    const widget = key.slice(SHAPE_WIDGET_SETTING_PREFIX.length, -SHAPE_WIDGET_SETTING_SUFFIX.length);
    return WIDGET_KEY.test(widget) ? { level: 'instance', widget } : null;
  }
  return null;
}

/** The chain of keys from the leaf to the root for one place: [instance?, app, skin, global]. */
export function shapeScopeChain(place?: { widget?: string | null } | null): string[] {
  const out: string[] = [];
  const w = place?.widget;
  if (typeof w === 'string' && WIDGET_KEY.test(w)) out.push(shapeScopeKey('instance', w));
  out.push(SHAPE_KEY_APP, SHAPE_KEY_SKIN, SHAPE_KEY_GLOBAL);
  return out;
}

/** One level's pick: the key and the shape asset id picked there ('' = inherit). */
export interface ShapeScopeEntry { key: string; id: string }
/** What is in force: the id (the default kind's id when nothing is picked), the deciding key and level, the chain seen. */
export interface ShapeResolved { id: string; from: string; level: ShapeLevel | 'default'; chain: ShapeScopeEntry[] }

/**
 * Walk a chain from the leaf to the root and say which shape is in force. Entries are `{ key, id }` leaf first; the first
 * entry with a shape id decides (the child overrides the parent); an entry with '' or junk inherits. Unknown keys are
 * skipped. Nothing anywhere = `{ id: 'pill', from: '', level: 'default' }`.
 */
export function resolveShape(chain: readonly ShapeScopeEntry[]): ShapeResolved {
  const seen: ShapeScopeEntry[] = [];
  for (const e of Array.isArray(chain) ? chain : []) {
    const where = e && typeof e.key === 'string' ? shapeScopeLevel(e.key) : null;
    if (!where) continue;
    const id = shapeId(e.id);
    seen.push({ key: e.key, id });
    if (id) return { id, from: e.key, level: where.level, chain: seen };
  }
  return { id: SHAPE_DEFAULT_KIND, from: '', level: 'default', chain: seen };
}

/** The same walk over a place and a reader of per-key picks (settings, the skin, the app look): `stateOf(key)` → id or ''. */
export function resolveShapeAt(place: { widget?: string | null } | null | undefined, stateOf: (key: string) => unknown): ShapeResolved {
  return resolveShape(shapeScopeChain(place).map((key) => ({ key, id: shapeId(stateOf(key)) })));
}

/* ---------------------------------------------------------------- history: Restore previous edit */

/** Most keys a history keeps (the oldest edits go first). */
export const SHAPE_HISTORY_MAX = 100;
/** One key's last edit: what it was, what it is, when. */
export interface ShapeEdit { previous: string; current: string; at: string }
/** The edit history: key → its last edit. Plain data, saved with the settings. */
export type ShapeHistory = Record<string, ShapeEdit>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keep only well-formed edits on known keys (a damaged setting can't crash or grow without bound). */
export function normalizeShapeHistory(raw: unknown): ShapeHistory {
  const out: ShapeHistory = {};
  if (!isObj(raw)) return out;
  for (const [key, v] of Object.entries(raw)) {
    if (!shapeScopeLevel(key) || !isObj(v)) continue;
    const previous = shapeId(v.previous), current = shapeId(v.current);
    if (previous === current) continue;
    out[key] = { previous, current, at: typeof v.at === 'string' ? v.at.slice(0, 40) : '' };
  }
  return trimShapeHistory(out);
}

function trimShapeHistory(h: ShapeHistory): ShapeHistory {
  const keys = Object.keys(h);
  if (keys.length <= SHAPE_HISTORY_MAX) return h;
  const keep = keys.sort((a, b) => (h[a]!.at < h[b]!.at ? 1 : h[a]!.at > h[b]!.at ? -1 : 0)).slice(0, SHAPE_HISTORY_MAX);
  return Object.fromEntries(keep.map((k) => [k, h[k]!]));
}

/**
 * Record one edit of a key: `previous` is what the level held before, `current` what it holds now ('' = cleared, back
 * to inherit). An edit that changes nothing, or a key that is not a level, leaves the history as it was. Only the last
 * edit per key is kept: Restore previous edit goes back one step.
 */
export function recordShapeEdit(history: ShapeHistory, key: string, previous: unknown, current: unknown, at: string): ShapeHistory {
  const p = shapeId(previous), c = shapeId(current);
  if (!shapeScopeLevel(key) || p === c) return history;
  return trimShapeHistory({ ...history, [key]: { previous: p, current: c, at } });
}

/** What Restore previous edit would put back for a key ('' = cleared), or null when the key has no edit to restore. */
export function previousShape(history: ShapeHistory, key: string): string | null {
  return key in history ? history[key]!.previous : null;
}

/**
 * Restore the previous edit of a key: the id to put back, and the history with the two values swapped so a second
 * restore brings the edit back (restore is itself an edit). A key with no history returns null.
 */
export function restorePreviousShape(history: ShapeHistory, key: string, at: string): { id: string; history: ShapeHistory } | null {
  const e = history[key];
  if (!e) return null;
  return { id: e.previous, history: { ...history, [key]: { previous: e.current, current: e.previous, at } } };
}

/** Drop a key's history (the level was reset to its default). */
export function forgetShapeEdit(history: ShapeHistory, key: string): ShapeHistory {
  if (!(key in history)) return history;
  const { [key]: _gone, ...rest } = history;
  return rest;
}

/* ---------------------------------------------------------------- the banner's own default (the lowest level) */

/** What a banner asset with no `shape` field draws: circles for icon-only widgets, pills for chips (today's look). */
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
