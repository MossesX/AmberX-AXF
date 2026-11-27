/**
 * layout rules — every layout parameter is a token (Brett, Nov 2 2026, build token-control s1).
 *
 * ONE registry (LAYOUT_FIELDS, LAYOUT_ENUMS, LAYOUT_SWITCHES) drives the validators (TS + build engine), the
 * normalizer, the engine that compiles a layout asset to `--fx-layout-*` tokens, the JSON schema, the fixtures and
 * the control@1 token list. Shared with the build engine (plain .mjs), like scale-rules.mjs.
 *
 * The layout asset used to carry only the grid (nav side + width, inspector side + width, menubar / toolbar /
 * status switches, content width); every other layout value (status bar height, the gap between regions, the main
 * area's padding, the phone paddings and edge inset, the nav item minimum on a phone, the viewport cut-offs) was a
 * literal in axf.css. Now each is a field here with a default equal to the framework's own look, so every existing
 * layout asset renders unchanged while every value can be read, set and reset through one token name.
 *
 * Field entry: [default, min, max, unit]. Units: px (whole pixels), space (× --fx-space, so the Spacing choice still
 * applies), int (a plain whole number). Enum fields list their words in LAYOUT_ENUMS (the same words as
 * asset-types.json → types.layout.enums; check-layout-tokens.mts keeps them equal); switches are booleans.
 * Token names are regular: --fx-layout-<field in kebab-case>. Unknown fields are kept out, never an error.
 *
 * Viewport cut-offs (tinyMaxWidth < smallMaxWidth < phoneMaxWidth < mediumMaxWidth < largeMaxWidth): CSS media queries
 * can't read a custom property, so the runtime watches `(max-width: <token>px)` for each and stamps data-fx-tiny /
 * data-fx-small / data-fx-narrow / data-fx-medium / data-fx-large on the root; stylesheets select on those
 * (`:where([data-fx-narrow]) .fx-x`, zero extra specificity), never on a px breakpoint (check-theme `layout` rule;
 * `node framework/cli/layout-adopt.mjs <path>` rewrites one). Pure, no DOM.
 */

export const LAYOUT_TYPE = 'layout';
export const LAYOUT_PREFIX = 'layout';

/** Numeric fields: [default, min, max, unit]. Order = the order tokens are listed. */
export const LAYOUT_FIELDS = {
  // the grid (a side that isn't drawn — nav on top, inspector none — carries 0)
  navWidth: [224, 0, 640, 'px'],
  inspectorWidth: [280, 0, 800, 'px'],
  contentMaxWidth: [0, 0, 4000, 'px'], // 0 = no limit
  statusHeight: [26, 16, 64, 'px'],
  regionGap: [0, 0, 4, 'space'],
  // the main area's padding (desktop)
  mainPadTop: [2.4, 0, 12, 'space'],
  mainPadX: [4, 0, 12, 'space'],
  mainPadBottom: [6, 0, 16, 'space'],
  // on a phone (single column)
  phoneMainPadTop: [1.6, 0, 8, 'space'],
  phoneMainPadX: [1.6, 0, 8, 'space'],
  phoneMainPadBottom: [4, 0, 12, 'space'],
  phoneNavItemMin: [64, 40, 200, 'px'],
  phoneEdge: [8, 0, 40, 'px'],
  // viewport cut-offs (max-width, px): tiny < small < phone (narrow) < medium < large
  tinyMaxWidth: [480, 200, 900, 'px'],
  smallMaxWidth: [640, 240, 1200, 'px'],
  phoneMaxWidth: [760, 320, 1600, 'px'],
  mediumMaxWidth: [900, 320, 2000, 'px'],
  largeMaxWidth: [1200, 400, 4000, 'px'],
};

/** Enum fields (word lists; the same as asset-types.json → types.layout.enums). */
export const LAYOUT_ENUMS = {
  nav: ['left', 'right', 'top'],
  toolbarPosition: ['top', 'bottom'],
  inspector: ['left', 'right', 'none'],
};
export const LAYOUT_ENUM_DEFAULTS = { nav: 'left', toolbarPosition: 'top', inspector: 'none' };

/** Boolean fields and their defaults. */
export const LAYOUT_SWITCHES = { showMenubar: true, showToolbar: true, showStatusbar: true };

/** The viewport cut-offs in ascending order, with the root attribute each one stamps. */
export const LAYOUT_VIEWPORTS = [
  { field: 'tinyMaxWidth', attr: 'data-fx-tiny' },
  { field: 'smallMaxWidth', attr: 'data-fx-small' },
  { field: 'phoneMaxWidth', attr: 'data-fx-narrow' },
  { field: 'mediumMaxWidth', attr: 'data-fx-medium' },
  { field: 'largeMaxWidth', attr: 'data-fx-large' },
];

/**
 * The viewport attribute a px breakpoint maps onto (the codemod layout-adopt.mjs and check-theme): the smallest
 * cut-off at or above `px` for a max-width query; a min-width query is the negation of the cut-off below it.
 * Null when the width is above the largest cut-off (no attribute: it is the plain desktop look).
 */
export function layoutBreakpointAttr(px, kind = 'max', raw = null) {
  const n = normalizeLayout(raw);
  const limit = kind === 'min' ? px - 1 : px;
  for (const v of LAYOUT_VIEWPORTS) if (limit <= n[v.field]) return { attr: v.attr, field: v.field, maxWidth: n[v.field], negate: kind === 'min' };
  return null;
}

/** The root attributes for a viewport width (pure twin of the runtime's matchMedia watch; fixture-pinned). */
export function layoutViewportAttrs(raw, widthPx) {
  const n = normalizeLayout(raw);
  const out = {};
  for (const v of LAYOUT_VIEWPORTS) if (widthPx <= n[v.field]) out[v.attr] = '1';
  return out;
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const round = (v, unit) => (unit === 'px' || unit === 'int' ? Math.round(v) : Math.round(v * 1000) / 1000);

export const isLayoutType = (type) => type === LAYOUT_TYPE;
/** Every field name, numbers first, then enums, then switches (the token order). */
export const layoutFieldNames = () => [...Object.keys(LAYOUT_FIELDS), ...Object.keys(LAYOUT_ENUMS), ...Object.keys(LAYOUT_SWITCHES)];

/** Every field filled in; anything missing or malformed takes the default, numbers clamp into range. Other keys (slots, repeat, …) are kept as they are. */
export function normalizeLayout(raw) {
  const src = isObj(raw) ? raw : {};
  const out = { ...src };
  for (const [f, [def, min, max, unit]] of Object.entries(LAYOUT_FIELDS)) {
    const v = src[f];
    out[f] = typeof v === 'number' && Number.isFinite(v) ? round(Math.min(max, Math.max(min, v)), unit) : def;
  }
  for (const [f, allowed] of Object.entries(LAYOUT_ENUMS)) {
    const v = src[f];
    out[f] = typeof v === 'string' && allowed.includes(v) ? v : LAYOUT_ENUM_DEFAULTS[f];
  }
  for (const [f, def] of Object.entries(LAYOUT_SWITCHES)) {
    const v = src[f];
    out[f] = typeof v === 'boolean' ? v : def;
  }
  return out;
}

/**
 * What validators report for the token fields. Missing optional fields are fine (defaults); the required ones are
 * checked by the asset validators from asset-types.json; wrong values are errors; unknown fields are ignored.
 */
export function layoutErrors(type, raw) {
  if (!isLayoutType(type)) return [];
  if (!isObj(raw)) return ['data must be an object'];
  const errors = [];
  for (const [f, [, min, max, unit]] of Object.entries(LAYOUT_FIELDS)) {
    if (!(f in raw)) continue;
    const v = raw[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) errors.push(`data.${f} must be a number from ${min} to ${max}`);
    else if ((unit === 'px' || unit === 'int') && !Number.isInteger(v)) errors.push(`data.${f} must be a whole number`);
  }
  for (const [f, allowed] of Object.entries(LAYOUT_ENUMS)) {
    if (f in raw && !allowed.includes(raw[f])) errors.push(`data.${f} must be one of: ${allowed.join(', ')}`);
  }
  for (const f of Object.keys(LAYOUT_SWITCHES)) {
    if (f in raw && typeof raw[f] !== 'boolean') errors.push(`data.${f} must be true or false`);
  }
  // the viewport cut-offs keep their order (only when every one given is a valid number)
  const n = normalizeLayout(raw);
  for (let i = 1; i < LAYOUT_VIEWPORTS.length; i++) {
    const a = LAYOUT_VIEWPORTS[i - 1].field;
    const b = LAYOUT_VIEWPORTS[i].field;
    if ((a in raw || b in raw) && typeof raw[a] !== 'string' && typeof raw[b] !== 'string' && n[a] >= n[b]) errors.push(`data.${a} (${n[a]}) must be below data.${b} (${n[b]})`);
  }
  return errors;
}

/** The CSS token a field compiles to: --fx-layout-<field>. */
export const layoutToken = (field) => `--fx-${LAYOUT_PREFIX}-${kebab(field)}`;

/** One value in CSS, by the field's unit. */
export function layoutValue(unit, v) {
  switch (unit) {
    case 'px': return `${v}px`;
    case 'space': return `calc(var(--fx-space) * ${v})`;
    default: return String(v);
  }
}

/** The `--fx-layout-*` tokens for one layout (the defaults when `raw` is missing): every number, enum and switch. */
export function layoutTokenVars(raw) {
  const n = normalizeLayout(raw);
  const vars = {};
  for (const [f, [, , , unit]] of Object.entries(LAYOUT_FIELDS)) vars[layoutToken(f)] = layoutValue(unit, n[f]);
  for (const f of Object.keys(LAYOUT_ENUMS)) vars[layoutToken(f)] = n[f];
  for (const f of Object.keys(LAYOUT_SWITCHES)) vars[layoutToken(f)] = n[f] ? '1' : '0';
  return vars;
}

/**
 * The token list for editors and the control API (control@1 `tokens.list`): one entry per field with its token name,
 * kind, unit, default and range / words.
 */
export function layoutTokens() {
  const out = [];
  for (const [f, [def, min, max, unit]] of Object.entries(LAYOUT_FIELDS)) out.push({ field: f, token: layoutToken(f), kind: 'number', unit, default: def, min, max });
  for (const [f, allowed] of Object.entries(LAYOUT_ENUMS)) out.push({ field: f, token: layoutToken(f), kind: 'enum', options: [...allowed], default: LAYOUT_ENUM_DEFAULTS[f] });
  for (const [f, def] of Object.entries(LAYOUT_SWITCHES)) out.push({ field: f, token: layoutToken(f), kind: 'switch', default: def });
  return out;
}

/** JSON Schema properties for the layout asset's token fields (the build engine's `axf schemas`). */
export function layoutSchemaProperties() {
  const props = {};
  for (const [f, [def, min, max, unit]] of Object.entries(LAYOUT_FIELDS)) {
    props[f] = { type: unit === 'px' || unit === 'int' ? 'integer' : 'number', minimum: min, maximum: max, default: def, description: `${unit === 'space' ? '× --fx-space' : unit}; token ${layoutToken(f)}` };
  }
  for (const [f, allowed] of Object.entries(LAYOUT_ENUMS)) props[f] = { enum: [...allowed], description: `token ${layoutToken(f)}` };
  for (const [f, def] of Object.entries(LAYOUT_SWITCHES)) props[f] = { type: 'boolean', default: def, description: `token ${layoutToken(f)} (1 / 0)` };
  return props;
}
