/**
 * nav-style rules (nav-style@1, build molly-nav-submenus, Brett Nov 3 2026): how a navigation menu looks and behaves
 * when it opens sub menus: its colours, fonts, icons, density, width, the sub-menu animation and its behaviour
 * (one or many open, open on tap or hover, auto-collapse, remember, follow the active page, swipe on a phone) and
 * which top-level items are pinned, hidden or reordered.
 *
 * ONE registry (NAV_STYLE_FIELDS) drives the normalizer, the validator (TS + build engine), the engine that compiles a
 * nav-style asset to `--fx-navs-*` tokens + `data-fx-navs-*` attributes (navstyle.ts), the control@1 token list
 * (`tokens.nav`) and the settings interface. Shared with the build engine (plain .mjs), like scale-rules.mjs.
 *
 * Every field has a default; `theme` means "leave it to the theme": the stylesheet's own rule applies, so the
 * `standard` preset draws a nav exactly as it is today. Colours are colour-theme token ids (never a literal colour),
 * so a theme swap still restyles the nav. Lists (order, hidden, pinned) are comma-separated item ids, so every field
 * stays one scalar (control@1 token overrides are scalars). Unknown fields are dropped, never an error.
 *
 * Opt-in: a nav-menu asset turns it on with `navStyle: true`; a nav without it never reads this asset.
 * Pure, no DOM. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const NAV_STYLE_TYPE = 'nav-style';
export const NAV_STYLE_FRAME = 'nav-style@1';

/** Colour-theme token ids a colour field may name (theme.ts colour tokens). */
export const NAV_COLOR_TOKENS = ['bg', 'surface', 'surface2', 'surface3', 'text', 'muted', 'border', 'accent', 'accentText', 'accentSoft', 'danger', 'success', 'warning', 'info', 'focus'];
export const NAV_ANIMATIONS = ['slide', 'accordion', 'fade', 'push', 'none'];
export const NAV_EASINGS = ['theme', 'standard', 'emphasized', 'linear', 'spring', 'bounce'];
export const NAV_CHEVRONS = ['rotate', 'flip', 'none'];
export const NAV_REDUCED = ['system', 'always', 'never'];
export const NAV_OPEN_ON = ['tap', 'hover'];
export const NAV_FONT_FAMILIES = ['theme', 'body', 'display', 'mono'];
export const NAV_FONT_SIZES = ['theme', '2xs', 'xs', 'sm', 'md', 'lg'];
export const NAV_FONT_WEIGHTS = ['theme', '400', '500', '600', '700', '800'];
export const NAV_ICON_SIZES = ['sm', 'md', 'lg'];
export const NAV_DENSITIES = ['theme', 'compact', 'regular', 'roomy'];

const color = (dflt) => ({ kind: 'color', default: dflt });
const choice = (options, dflt) => ({ kind: 'enum', options, default: dflt });
const num = (min, max, dflt, unit) => ({ kind: 'number', min, max, default: dflt, unit });
const bool = (dflt) => ({ kind: 'boolean', default: dflt });
const list = () => ({ kind: 'list', default: '' });

/**
 * Every field: path → spec. Groups are the first part of the path (the settings interface shows one panel each).
 * `theme` colours fall back to the stylesheet's own rule.
 */
export const NAV_STYLE_FIELDS = {
  'colors.background': color('theme'),
  'colors.text': color('theme'),
  'colors.hover': color('theme'),
  'colors.active': color('theme'),
  'colors.activeText': color('theme'),
  'colors.submenu': color('theme'),
  'colors.accent': color('theme'),
  'font.family': choice(NAV_FONT_FAMILIES, 'theme'),
  'font.size': choice(NAV_FONT_SIZES, 'theme'),
  'font.weight': choice(NAV_FONT_WEIGHTS, 'theme'),
  'icons.show': bool(true),
  'icons.size': choice(NAV_ICON_SIZES, 'md'),
  'layout.density': choice(NAV_DENSITIES, 'theme'),
  'layout.indent': num(0, 6, 3, 'space'),
  'width.size': num(0, 480, 0, 'px'),
  'width.min': num(48, 320, 160, 'px'),
  'width.max': num(160, 640, 420, 'px'),
  'width.resizable': bool(false),
  'width.collapsible': bool(true),
  'animation.kind': choice(NAV_ANIMATIONS, 'slide'),
  'animation.durationMs': num(0, 1200, 220, 'ms'),
  'animation.easing': choice(NAV_EASINGS, 'standard'),
  'animation.staggerMs': num(0, 150, 24, 'ms'),
  'animation.chevron': choice(NAV_CHEVRONS, 'rotate'),
  'animation.reduced': choice(NAV_REDUCED, 'system'),
  'behavior.single': bool(true),
  'behavior.openOn': choice(NAV_OPEN_ON, 'tap'),
  'behavior.autoCollapse': bool(true),
  'behavior.remember': bool(true),
  'behavior.followActive': bool(true),
  'behavior.swipe': bool(true),
  'items.order': list(),
  'items.hidden': list(),
  'items.pinned': list(),
};
/** Per-item accents: `accents.<item id>` = a colour token (any item id, so a future app gets one too). */
export const NAV_ACCENT_PREFIX = 'accents.';
export const NAV_STYLE_GROUPS = [...new Set(Object.keys(NAV_STYLE_FIELDS).map((p) => p.split('.')[0]))].concat('accents');

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;

/** One comma-separated id list, cleaned (unknown characters dropped, duplicates removed, at most 64 ids). */
export function navIdList(v) {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out = [];
  for (const x of raw) { const s = String(x).trim(); if (s && ID.test(s) && !out.includes(s)) out.push(s); if (out.length >= 64) break; }
  return out;
}

/** A field's value, normalized against its spec (or undefined when it doesn't fit). */
export function navFieldValue(path, v) {
  if (path.startsWith(NAV_ACCENT_PREFIX)) {
    const id = path.slice(NAV_ACCENT_PREFIX.length);
    if (!ID.test(id)) return undefined;
    return v === 'theme' || NAV_COLOR_TOKENS.includes(v) ? v : undefined;
  }
  const f = NAV_STYLE_FIELDS[path];
  if (!f) return undefined;
  switch (f.kind) {
    case 'color': return v === 'theme' || NAV_COLOR_TOKENS.includes(v) ? v : undefined;
    case 'enum': { const s = typeof v === 'number' ? String(v) : v; return f.options.includes(s) ? s : undefined; }
    case 'number': { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(f.max, Math.max(f.min, n))) : undefined; }
    case 'boolean': return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
    case 'list': return Array.isArray(v) || typeof v === 'string' ? navIdList(v).join(',') : undefined;
    default: return undefined;
  }
}

const getPath = (o, path) => path.split('.').reduce((at, k) => (isObj(at) ? at[k] : undefined), o);

/** Every field filled in (defaults for missing or malformed ones); nested like the asset: { colors: {…}, … }. */
export function normalizeNavStyle(raw) {
  const out = {};
  for (const [path, f] of Object.entries(NAV_STYLE_FIELDS)) {
    const [g, k] = path.split('.');
    const v = navFieldValue(path, getPath(raw, path));
    (out[g] ??= {})[k] = v === undefined ? f.default : v;
  }
  out.accents = {};
  const acc = isObj(raw) && isObj(raw.accents) ? raw.accents : {};
  for (const [id, v] of Object.entries(acc)) { const ok = navFieldValue(`${NAV_ACCENT_PREFIX}${id}`, v); if (ok !== undefined && ok !== 'theme') out.accents[id] = ok; }
  // a max under the min would make a resize handle that can't move
  if (out.width.max < out.width.min) out.width.max = out.width.min;
  return out;
}

/** Validator errors for a nav-style asset's data (unknown groups are kept out, never an error). */
export function navStyleErrors(raw) {
  if (!isObj(raw)) return ['data must be an object'];
  const errs = [];
  for (const [path, f] of Object.entries(NAV_STYLE_FIELDS)) {
    const v = getPath(raw, path);
    if (v === undefined) continue;
    if (navFieldValue(path, v) === undefined) errs.push(`${path}: ${navFieldHint(f)}`);
    else if (f.kind === 'number' && (v < f.min || v > f.max)) errs.push(`${path}: ${navFieldHint(f)}`);
  }
  if (raw.accents !== undefined) {
    if (!isObj(raw.accents)) errs.push('accents: an object of item id → colour token');
    else for (const [id, v] of Object.entries(raw.accents)) if (navFieldValue(`${NAV_ACCENT_PREFIX}${id}`, v) === undefined) errs.push(`accents.${id}: a colour token (${NAV_COLOR_TOKENS.join(', ')}) or theme`);
  }
  return errs;
}

/** Errors for one field set through control@1 (`tokens.nav <path> <value>`). */
export function navFieldErrors(path, value) {
  if (path.startsWith(NAV_ACCENT_PREFIX)) return navFieldValue(path, value) === undefined ? [`value must be a colour token (${NAV_COLOR_TOKENS.join(', ')}) or theme`] : [];
  const f = NAV_STYLE_FIELDS[path];
  if (!f) return [`unknown nav-style field ${path}`];
  if (navFieldValue(path, value) === undefined) return [`value must be ${navFieldHint(f)}`];
  if (f.kind === 'number' && (Number(value) < f.min || Number(value) > f.max)) return [`value must be ${navFieldHint(f)}`];
  return [];
}

export function navFieldHint(f) {
  switch (f.kind) {
    case 'color': return `a colour token (${NAV_COLOR_TOKENS.join(', ')}) or theme`;
    case 'enum': return `one of ${f.options.join(', ')}`;
    case 'number': return `a number ${f.min}..${f.max}${f.unit ? ` (${f.unit})` : ''}`;
    case 'boolean': return 'true or false';
    case 'list': return 'comma-separated item ids';
    default: return 'a value';
  }
}

/** The control@1 token list for `tokens.nav` (id, kind, options). */
export function navStyleTokens() {
  return Object.entries(NAV_STYLE_FIELDS).map(([id, f]) => ({ id, kind: f.kind === 'number' ? 'number' : f.kind === 'boolean' ? 'boolean' : f.kind === 'enum' || f.kind === 'color' ? 'enum' : 'string', ...(f.kind === 'enum' ? { options: f.options } : f.kind === 'color' ? { options: ['theme', ...NAV_COLOR_TOKENS] } : {}), ...(f.kind === 'number' ? { min: f.min, max: f.max } : {}), default: f.default }));
}

/** JSON schema properties for the generated schema (schemas/json/nav-style.schema.json). */
export function navStyleSchemaProperties() {
  const groups = {};
  for (const [path, f] of Object.entries(NAV_STYLE_FIELDS)) {
    const [g, k] = path.split('.');
    const s = f.kind === 'number' ? { type: 'number', minimum: f.min, maximum: f.max } : f.kind === 'boolean' ? { type: 'boolean' } : f.kind === 'list' ? { type: 'string' } : { enum: f.kind === 'color' ? ['theme', ...NAV_COLOR_TOKENS] : f.options };
    ((groups[g] ??= { type: 'object', properties: {} }).properties)[k] = { ...s, default: f.default };
  }
  groups.accents = { type: 'object', additionalProperties: { enum: ['theme', ...NAV_COLOR_TOKENS] } };
  return groups;
}
