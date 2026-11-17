/**
 * instance-look@1 (build own-look-per-grid-and-tab-group, Nov 16 2026, Brett: "Yeah, build it."): one grid or one tab
 * row carries its own look as a small record drawn over the skin. The record has ten keys and every value is a token
 * reference or a scaled step, never a raw px or a raw colour, so an instance can never leave the skin:
 *
 *   rowBg, rowAltBg, hoverBg, selectedBg, borderColor   a colour-theme token name (`accentSoft`, `surface2`, `border`) or
 *                                                       `transparent`; selectedFg a colour-theme token name only
 *   textSize                                            a typography step: 2xs xs sm md lg xl 2xl       → var(--fx-type-root-<step>)
 *   spacing                                             a density gap step: 2xs xs sm md lg xl 2xl 3xl 4xl → var(--fx-dens-gap-<step>)
 *   borderW                                             none thin medium thick (0 / 1× / 2× / 3× --fx-border-w)
 *   radius                                              none sm md lg pill (--fx-radius-*; the pill is the fixed 999px shape)
 *
 * Scope: kind + settings id (`tab-group:settings.main`, `grid:ui-review.items`); the kinds are an open list, each bound
 * to the component-tokens@1 family tokens its CSS already reads (INSTANCE_LOOK_BINDINGS), so a look compiles to
 * `--fx-inst-<key>` on the instance's root plus the family token set to that variable. No stylesheet changes, no var()
 * fallbacks: a key nobody set emits nothing and the family's :root default stands.
 *
 * The colour-theme token names come from the registry (schemas/asset-types.json → types['color-theme'].nested.tokens),
 * passed in by every caller: this file never imports JSON so the console can bake it. Plain JS shared by the TS engine
 * (instance-look.ts), both asset validators (core/validate.ts, cli/build-engine.mjs), the JSON Schema writer, the CLI,
 * control@1 and gen-fixtures. Pure: no IO, no DOM. Kotlin twin deferred (framework/spec/PORTING.md).
 */

export const INSTANCE_LOOK_CONTRACT = 'instance-look@1';
/** The asset type a named look ships as (a skin or an app may carry looks to apply to its grids and tab rows). */
export const INSTANCE_LOOK_TYPE = 'instance-look';
/** What an instance is: one tab row (the framework TabGroup) or one data grid. Open list: add a kind and its binding. */
export const INSTANCE_LOOK_KINDS = ['tab-group', 'grid'];
export const INSTANCE_LOOK_KIND_LABELS = { 'tab-group': 'Tab group', grid: 'Grid' };
export const INSTANCE_LOOK_VAR_PREFIX = '--fx-inst-';

export const TEXT_STEPS = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'];
export const SPACE_STEPS = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'];
export const BORDER_STEPS = ['none', 'thin', 'medium', 'thick'];
export const RADIUS_STEPS = ['none', 'sm', 'md', 'lg', 'pill'];
export const INSTANCE_LOOK_VALUE_KINDS = ['colour', 'text', 'space', 'border', 'radius'];

const k = (key, kind, label, description, extra = {}) => ({ key, kind, label, description, ...extra });
/**
 * The ten keys, in dialog order. `kind` = the value grammar; `transparent` = the colour key also takes the word
 * `transparent` (a background may be none; a foreground may not).
 */
export const INSTANCE_LOOK_KEYS = [
  k('rowBg', 'colour', 'Row background', 'Background of a plain row / an idle tab.', { transparent: true }),
  k('rowAltBg', 'colour', 'Alternate row background', 'Background of every second row (zebra striping; grids only).', { transparent: true }),
  k('textSize', 'text', 'Text size', 'Text size step of the rows / tabs (typography scale).'),
  k('spacing', 'space', 'Spacing', 'Space step between cells / tabs (density gap scale).'),
  k('borderW', 'border', 'Border width', 'Line thickness: none, thin, medium or thick (multiples of the style theme\'s border width).'),
  k('borderColor', 'colour', 'Border colour', 'Grid lines / the rule under the tab row.', { transparent: true }),
  k('radius', 'radius', 'Corner radius', 'Corner radius step: none, sm, md, lg or pill.'),
  k('hoverBg', 'colour', 'Hover background', 'Background of the row / tab under the pointer.', { transparent: true }),
  k('selectedBg', 'colour', 'Selected background', 'Background of the selected row / the active tab.', { transparent: true }),
  k('selectedFg', 'colour', 'Selected text', 'Text colour of the selected row / the active tab.'),
];
export const INSTANCE_LOOK_KEY_IDS = INSTANCE_LOOK_KEYS.map((x) => x.key);
export const instanceLookKey = (key) => INSTANCE_LOOK_KEYS.find((x) => x.key === key) ?? null;
export const isInstanceLookKind = (kind) => typeof kind === 'string' && INSTANCE_LOOK_KINDS.includes(kind);

/**
 * Which component-tokens@1 family tokens each key drives per kind (the CSS variables the grid / tab rules already read).
 * A key with no binding for a kind still compiles to its --fx-inst-* variable (a stylesheet may read it later) but
 * moves nothing on that kind today. Tokens marked ¹ in the report are added to the families when the CSS is wired.
 */
export const INSTANCE_LOOK_BINDINGS = {
  'tab-group': {
    rowBg: ['--fx-tab-bg'],
    rowAltBg: [],
    textSize: ['--fx-tab-font-size'],
    spacing: ['--fx-tab-gap'],
    borderW: ['--fx-tab-indicator-size'],
    borderColor: ['--fx-tab-bar-border'],
    radius: ['--fx-tab-radius-underline', '--fx-tab-radius-pills', '--fx-tab-radius-boxed', '--fx-tab-radius-segmented', '--fx-tab-radius-plain', '--fx-tab-radius-chips'],
    hoverBg: ['--fx-tab-hover-bg'],
    selectedBg: ['--fx-tab-active-bg', '--fx-tab-pills-active-bg', '--fx-tab-boxed-active-bg', '--fx-tab-segmented-active-bg', '--fx-tab-chips-active-bg'],
    selectedFg: ['--fx-tab-active-text', '--fx-tab-pills-active-text', '--fx-tab-plain-active-text'],
  },
  grid: {
    rowBg: ['--fx-grid-row-bg'],
    rowAltBg: ['--fx-grid-row-alt-bg'],
    textSize: ['--fx-grid-font-size'],
    spacing: ['--fx-grid-cell-pad-x'],
    borderW: ['--fx-grid-border-w'],
    borderColor: ['--fx-grid-line-color'],
    radius: ['--fx-grid-radius'],
    hoverBg: ['--fx-grid-hover-bg'],
    selectedBg: ['--fx-grid-selected-bg'],
    selectedFg: ['--fx-grid-selected-text'],
  },
};

/* ------------------------------------------------------------------ scope */

const INSTANCE = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;
export const isInstanceLookId = (id) => typeof id === 'string' && INSTANCE.test(id);
/** The scope key of one instance: '<kind>:<id>'. */
export const instanceLookScope = (kind, id) => `${kind}:${id}`;
/** '<kind>:<id>' → { kind, id } or null. */
export function parseInstanceLookScope(scope) {
  if (typeof scope !== 'string') return null;
  const i = scope.indexOf(':');
  if (i < 1) return null;
  const kind = scope.slice(0, i), id = scope.slice(i + 1);
  return isInstanceLookKind(kind) && isInstanceLookId(id) ? { kind, id } : null;
}

/* ------------------------------------------------------------------ values */

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
/** The CSS variable of one key: instanceLookVar('rowBg') → '--fx-inst-row-bg'. */
export const instanceLookVar = (key) => `${INSTANCE_LOOK_VAR_PREFIX}${kebab(key)}`;

/** The colour-theme token names a registry declares (asset-types.json → types['color-theme'].nested.tokens); [] when absent. */
export function colourTokensOf(registry) {
  const types = registry && typeof registry === 'object' ? (registry.types ?? registry) : null;
  const list = types?.['color-theme']?.nested?.tokens;
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
}

/** A colour-theme token name in camel or kebab form → its canonical camel name, or null when the theme has no such token. */
export function colourTokenName(raw, colourTokens) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!/^[a-z][a-zA-Z0-9-]{0,40}$/.test(v)) return null;
  const name = camel(v);
  return (Array.isArray(colourTokens) ? colourTokens : []).includes(name) ? name : null;
}

/** Why a raw value cannot be a look value, in the words the refusal uses; '' when nothing obvious (then it is simply unknown). */
function rawKind(v) {
  if (typeof v === 'number') return 'a bare number';
  if (typeof v !== 'string') return 'not a string';
  const s = v.trim();
  if (/^-?\d*\.?\d+(px|em|rem|%|vw|vh|ch|dvh|dvw|pt)$/.test(s) || /^-?\d*\.?\d+$/.test(s)) return 'a raw size';
  if (/^#[0-9a-fA-F]{3,8}$/.test(s) || /^(rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\(/.test(s)) return 'a raw colour';
  if (/^var\(/.test(s) || /^calc\(/.test(s)) return 'a CSS expression';
  if (/[;{}<>]/.test(s)) return 'unsafe characters';
  return '';
}

/**
 * The CSS value one key's raw value compiles to, or null when it is refused. `colourTokens` = the colour-theme token
 * names (colourTokensOf(registry)). The output never contains anything but var(), calc(), 0, 999px and transparent.
 */
export function instanceLookValue(key, raw, colourTokens) {
  const spec = instanceLookKey(key);
  if (!spec || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || rawKind(v)) return null;
  switch (spec.kind) {
    case 'colour': {
      if (v === 'transparent') return spec.transparent ? 'transparent' : null;
      const name = colourTokenName(v, colourTokens);
      return name ? `var(--fx-${kebab(name)})` : null;
    }
    case 'text': return TEXT_STEPS.includes(v) ? `var(--fx-type-root-${v})` : null;
    case 'space': return SPACE_STEPS.includes(v) ? `var(--fx-dens-gap-${v})` : null;
    case 'border': return v === 'none' ? '0' : v === 'thin' ? 'var(--fx-border-w)' : v === 'medium' ? 'calc(var(--fx-border-w) * 2)' : v === 'thick' ? 'calc(var(--fx-border-w) * 3)' : null;
    case 'radius': return v === 'none' ? '0' : v === 'pill' ? '999px' : RADIUS_STEPS.includes(v) ? `var(--fx-radius-${v})` : null;
    default: return null;
  }
}

/** The stored form of an accepted value (trimmed, colour names canonical camel), or null when refused. */
export function instanceLookStored(key, raw, colourTokens) {
  if (instanceLookValue(key, raw, colourTokens) === null) return null;
  const spec = instanceLookKey(key);
  const v = raw.trim();
  return spec.kind === 'colour' && v !== 'transparent' ? colourTokenName(v, colourTokens) : v;
}

/** What a key wants, in plain words (the refusal and the dialog's hint). */
export function instanceLookWants(key, colourTokens) {
  const spec = instanceLookKey(key);
  if (!spec) return `one of ${INSTANCE_LOOK_KEY_IDS.join(', ')}`;
  const tokens = (Array.isArray(colourTokens) ? colourTokens : []).join(', ');
  return {
    colour: `a colour-theme token (${tokens || 'the skin\'s colour tokens'})${spec.transparent ? ' or transparent' : ''}`,
    text: `a text step (${TEXT_STEPS.join(' ')})`,
    space: `a spacing step (${SPACE_STEPS.join(' ')})`,
    border: `a border step (${BORDER_STEPS.join(' ')})`,
    radius: `a radius step (${RADIUS_STEPS.join(' ')})`,
  }[spec.kind];
}

/** Why a value is refused for a key, or null when it is fine. Names raw px / colours for what they are. */
export function instanceLookKeyError(key, raw, colourTokens) {
  if (!instanceLookKey(key)) return `${String(key)} is not a look key (${INSTANCE_LOOK_KEY_IDS.join(', ')})`;
  if (instanceLookValue(key, raw, colourTokens) !== null) return null;
  const why = rawKind(raw);
  return `${key}: ${why ? `${why} is never a look value; ` : ''}wants ${instanceLookWants(key, colourTokens)}`;
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A look record cleaned: known keys only, accepted values only (stored form); {} when nothing survives. */
export function normalizeInstanceLook(raw, colourTokens) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const spec of INSTANCE_LOOK_KEYS) {
    const v = raw[spec.key];
    if (v === undefined || v === null || v === '') continue;
    const stored = instanceLookStored(spec.key, typeof v === 'string' ? v : String(v), colourTokens);
    if (stored !== null) out[spec.key] = stored;
  }
  return out;
}

/** Every problem with a look record (unknown keys, refused values); [] when it is fine. `path` prefixes the messages. */
export function instanceLookRecordErrors(raw, colourTokens, path = 'look') {
  if (raw === undefined) return [];
  if (!isObj(raw)) return [`${path} must be an object (key → token or step)`];
  const out = [];
  for (const [key, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    const e = instanceLookKeyError(key, typeof v === 'string' ? v : typeof v === 'number' ? v : String(v), colourTokens);
    if (e) out.push(`${path}.${e}`);
  }
  return out;
}

/**
 * Asset validator for the instance-look type (both validators call it; other types get []): data.kind is a known kind,
 * data.look is a record of accepted values, data.for (optional) lists instance ids this look is meant for.
 */
export function instanceLookErrors(type, data, colourTokens) {
  if (type !== INSTANCE_LOOK_TYPE) return [];
  if (!isObj(data)) return ['data must be an object'];
  // data.kind is checked by the registry's enum (asset-types.json → enums.kind) in both validators, so it is not repeated here
  const out = instanceLookRecordErrors(data.look, colourTokens, 'data.look');
  if (data.for !== undefined) {
    if (!Array.isArray(data.for)) out.push('data.for must be an array of instance ids');
    else data.for.forEach((id, i) => { if (!isInstanceLookId(id)) out.push(`data.for[${i}] is not an instance id`); });
  }
  return out;
}

/** JSON Schema properties for the instance-look type's data (every key an enum or a token pattern; never a free string). */
export function instanceLookSchemaProperties(colourTokens) {
  const tokens = Array.isArray(colourTokens) ? colourTokens : [];
  const colour = (transparent) => ({ type: 'string', enum: [...tokens.flatMap((t) => [t, kebab(t)].filter((x, i, a) => a.indexOf(x) === i)), ...(transparent ? ['transparent'] : [])] });
  const look = {};
  for (const spec of INSTANCE_LOOK_KEYS) {
    look[spec.key] = { description: spec.description, ...(spec.kind === 'colour' ? colour(spec.transparent) : { type: 'string', enum: { text: TEXT_STEPS, space: SPACE_STEPS, border: BORDER_STEPS, radius: RADIUS_STEPS }[spec.kind] }) };
  }
  return {
    kind: { enum: [...INSTANCE_LOOK_KINDS] },
    look: { type: 'object', description: 'instance-look@1 record: token references and scaled steps only, never raw px or colours.', properties: look, additionalProperties: false },
    for: { type: 'array', items: { type: 'string', pattern: INSTANCE.source } },
  };
}
