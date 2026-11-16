/**
 * shape@1 scopes (build banner-widget-shapes-more-than-circle): which shape is in force at a place (global → skin → app →
 * instance, the child overriding the parent) and the edit history Restore previous edit reads. Plain .mjs so the CLI
 * (framework/cli/shapes.mjs), the theme-manager routes and the runtime share one implementation; core/engines/shape.ts
 * re-exports it with types. Pure, no DOM, no I/O. Kotlin twin deferred (spec/PORTING.md).
 */
import { SHAPE_DEFAULT_KIND } from './shape-rules.mjs';

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
export const SHAPE_LEVELS = ['instance', 'app', 'skin', 'global'];
export const SHAPE_KEY_GLOBAL = 'global';
export const SHAPE_KEY_SKIN = 'skin';
export const SHAPE_KEY_APP = 'app';
/**
 * The hub-wide setting the global level reads. Under `axf.tokens.` (control@1 token overrides), so it travels in the
 * shared appearance document and reaches every app; the skin overrides and the edit history sit next to it.
 */
export const SHAPE_SETTING = 'axf.tokens.shape.global';
/** Per-skin overrides of a skin's own shape (`{ <skin id>: <shape id> }`): the skin editor's Shapes section. */
export const SHAPE_SKIN_SETTING = 'axf.tokens.shape.skin';
/** The edit history Restore previous edit reads (ShapeHistory). */
export const SHAPE_HISTORY_SETTING = 'axf.tokens.shape.history';
/** The per-widget setting prefix and suffix: `axf.banner.widget.<type:id>.shape`. */
export const SHAPE_WIDGET_SETTING_PREFIX = 'axf.banner.widget.';
export const SHAPE_WIDGET_SETTING_SUFFIX = '.shape';
/** A shape asset id (the envelope id pattern); '' = nothing picked at this level. */
const SHAPE_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** A banner widget key, `type:id` (engines/bannerwidgets.ts KEY). */
const WIDGET_KEY = /^[a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$/;

/** A shape asset id, or '' for anything that is not one. */
export function shapeId(v) {
  return typeof v === 'string' && SHAPE_ID.test(v) ? v : '';
}

/** The key of one level: `axf.banner.widget.<widget>.shape` for an instance, else the level name. */
export function shapeScopeKey(level, widget) {
  if (level === 'instance') {
    if (typeof widget !== 'string' || !WIDGET_KEY.test(widget)) throw new Error('an instance level needs a banner widget key (type:id)');
    return `${SHAPE_WIDGET_SETTING_PREFIX}${widget}${SHAPE_WIDGET_SETTING_SUFFIX}`;
  }
  return level;
}

/** The level a key belongs to (an instance key carries the widget), or null for a key that is none of them. */
export function shapeScopeLevel(key) {
  if (key === SHAPE_KEY_GLOBAL || key === SHAPE_KEY_SKIN || key === SHAPE_KEY_APP) return { level: key };
  if (key.startsWith(SHAPE_WIDGET_SETTING_PREFIX) && key.endsWith(SHAPE_WIDGET_SETTING_SUFFIX)) {
    const widget = key.slice(SHAPE_WIDGET_SETTING_PREFIX.length, -SHAPE_WIDGET_SETTING_SUFFIX.length);
    return WIDGET_KEY.test(widget) ? { level: 'instance', widget } : null;
  }
  return null;
}

/** The chain of keys from the leaf to the root for one place: [instance?, app, skin, global]. */
export function shapeScopeChain(place) {
  const out = [];
  const w = place?.widget;
  if (typeof w === 'string' && WIDGET_KEY.test(w)) out.push(shapeScopeKey('instance', w));
  out.push(SHAPE_KEY_APP, SHAPE_KEY_SKIN, SHAPE_KEY_GLOBAL);
  return out;
}

/**
 * Walk a chain from the leaf to the root and say which shape is in force. Entries are `{ key, id }` leaf first; the first
 * entry with a shape id decides (the child overrides the parent); an entry with '' or junk inherits. Unknown keys are
 * skipped. Nothing anywhere = `{ id: 'pill', from: '', level: 'default' }`.
 */
export function resolveShape(chain) {
  const seen = [];
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
export function resolveShapeAt(place, stateOf) {
  return resolveShape(shapeScopeChain(place).map((key) => ({ key, id: shapeId(stateOf(key)) })));
}

/* ---------------------------------------------------------------- history: Restore previous edit */

/** Most keys a history keeps (the oldest edits go first). */
export const SHAPE_HISTORY_MAX = 100;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keep only well-formed edits on known keys (a damaged setting can't crash or grow without bound). */
export function normalizeShapeHistory(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [key, v] of Object.entries(raw)) {
    if (!shapeScopeLevel(key) || !isObj(v)) continue;
    const previous = shapeId(v.previous), current = shapeId(v.current);
    if (previous === current) continue;
    out[key] = { previous, current, at: typeof v.at === 'string' ? v.at.slice(0, 40) : '' };
  }
  return trimShapeHistory(out);
}

function trimShapeHistory(h) {
  const keys = Object.keys(h);
  if (keys.length <= SHAPE_HISTORY_MAX) return h;
  const keep = keys.sort((a, b) => (h[a].at < h[b].at ? 1 : h[a].at > h[b].at ? -1 : 0)).slice(0, SHAPE_HISTORY_MAX);
  return Object.fromEntries(keep.map((k) => [k, h[k]]));
}

/**
 * Record one edit of a key: `previous` is what the level held before, `current` what it holds now ('' = cleared, back
 * to inherit). An edit that changes nothing, or a key that is not a level, leaves the history as it was. Only the last
 * edit per key is kept: Restore previous edit goes back one step.
 */
export function recordShapeEdit(history, key, previous, current, at) {
  const p = shapeId(previous), c = shapeId(current);
  if (!shapeScopeLevel(key) || p === c) return history;
  return trimShapeHistory({ ...history, [key]: { previous: p, current: c, at } });
}

/** What Restore previous edit would put back for a key ('' = cleared), or null when the key has no edit to restore. */
export function previousShape(history, key) {
  return key in history ? history[key].previous : null;
}

/**
 * Restore the previous edit of a key: the id to put back, and the history with the two values swapped so a second
 * restore brings the edit back (restore is itself an edit). A key with no history returns null.
 */
export function restorePreviousShape(history, key, at) {
  const e = history[key];
  if (!e) return null;
  return { id: e.previous, history: { ...history, [key]: { previous: e.current, current: e.previous, at } } };
}

/** Drop a key's history (the level was reset to its default). */
export function forgetShapeEdit(history, key) {
  if (!(key in history)) return history;
  const { [key]: _gone, ...rest } = history;
  return rest;
}
