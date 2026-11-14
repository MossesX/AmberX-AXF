/**
 * themed-controls rules (themed-controls@1, build themed-native-controls-plugin, Brett Nov 14 2026: "replace other
 * browser elements like the dropdowns with themed ones"): the token families behind every browser-drawn control the
 * Themed controls plugin swaps for a framework control: checkbox, radio, range, number, date / time, colour,
 * alert / confirm / prompt dialogs, file drop zone, tooltip and scrollbar (spec/THEMED-CONTROLS.md).
 *
 * ONE registry (THEMED_CONTROL_FIELDS) drives the normalizer, the validator (TS + build engine), the engine that
 * compiles a themed-controls asset to `--fx-tc-*` tokens (themed-controls.ts), the control@1 token list
 * (`tokens.controls`), the JSON schema and the settings interface. Shared with the build engine (plain .mjs), like
 * navstyle-rules.mjs.
 *
 * Paths are `<family>.<field>` (a family-wide size, radius, timing) or `<family>.<state>.<prop>` (one colour of one
 * state: rest, hover, focus, active, checked, disabled, invalid …). Every field has a default; `theme` leaves a colour
 * to the stylesheet's own rule. Colours are colour-theme token ids (never a literal colour), or a light|dark pair
 * `"<light token>|<dark token>"` picked by the active colour theme's scheme, so one asset reads right on both.
 * Unknown fields are dropped, never an error.
 *
 * The `native` starter writes out today's look under the soft-studio style theme, so switching the plugin on changes
 * behaviour, not the look. Pure, no DOM. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const THEMED_CONTROLS_TYPE = 'themed-controls';
export const THEMED_CONTROLS_FRAME = 'themed-controls@1';

/** The control families, in the order every list shows them (spec/THEMED-CONTROLS.md → Control families). */
export const THEMED_FAMILIES = ['checkbox', 'radio', 'range', 'number', 'datetime', 'color', 'dialogs', 'file', 'tooltip', 'scrollbar'];
export const THEMED_FAMILY_LABELS = {
  checkbox: 'Checkboxes', radio: 'Radio buttons', range: 'Range sliders', number: 'Number fields', datetime: 'Date and time pickers',
  color: 'Colour picker', dialogs: 'Alert, confirm and prompt dialogs', file: 'File drop zone', tooltip: 'Tooltips', scrollbar: 'Scrollbars',
};
/** The browser element each family replaces (shown in the settings interface and the help). */
export const THEMED_FAMILY_NATIVE = {
  checkbox: 'input[type=checkbox]', radio: 'input[type=radio]', range: 'input[type=range]', number: 'input[type=number]',
  datetime: 'input[type=date|time|datetime-local|month|week]', color: 'input[type=color]', dialogs: 'window.alert / confirm / prompt',
  file: 'input[type=file]', tooltip: 'title attribute', scrollbar: 'the browser scrollbar',
};

/** Colour-theme token ids a colour field may name (theme.ts colour tokens). */
export const TC_COLOR_TOKENS = ['bg', 'surface', 'surface2', 'surface3', 'text', 'muted', 'border', 'accent', 'accentText', 'accentSoft', 'danger', 'success', 'warning', 'info', 'focus'];
export const TC_RADII = ['theme', 'none', 'sm', 'md', 'lg', 'pill'];
export const TC_BORDER_WIDTHS = ['theme', '0', '1', '2', '3', '4'];
export const TC_SHOW_VALUE = ['always', 'drag', 'never'];
export const TC_STEPPERS = ['ends', 'stacked', 'none'];

/** The interaction states a family's colours are declared for (spec → Tokens → States). */
export const TC_STATES = {
  checkbox: ['rest', 'hover', 'focus', 'active', 'checked', 'disabled', 'invalid'],
  radio: ['rest', 'hover', 'focus', 'active', 'checked', 'disabled', 'invalid'],
  range: ['rest', 'hover', 'focus', 'active', 'disabled', 'invalid'],
  number: ['rest', 'hover', 'focus', 'active', 'disabled', 'invalid'],
};

const color = (dflt) => ({ kind: 'color', default: dflt });
const choice = (options, dflt) => ({ kind: 'enum', options, default: dflt });
const num = (min, max, dflt, unit) => ({ kind: 'number', min, max, default: dflt, unit });
const bool = (dflt) => ({ kind: 'boolean', default: dflt });

/**
 * State colours of one family: `props` = prop → default per state (a state missing a prop doesn't get that field, so
 * `focus.ring` exists only where a ring is drawn). `theme` = the rest state's value through the stylesheet.
 */
function states(family, table) {
  const out = {};
  for (const [state, props] of Object.entries(table)) for (const [prop, dflt] of Object.entries(props)) out[`${family}.${state}.${prop}`] = color(dflt);
  return out;
}

/**
 * Every field: path → spec. The first part of a path is the family (the settings interface shows one panel each).
 * Sizes marked `px14` are px at the 14 px base font and compile to `calc(var(--fx-font-size) * n / 14)`, exactly how
 * the stylesheet sizes today's checkbox (16 / 14).
 */
export const THEMED_CONTROL_FIELDS = {
  // checkbox: today an accent-coloured native box (axf.css .fx-check: accent-color, 16/14 em, focus outline in --fx-focus)
  'checkbox.size': num(12, 32, 16, 'px14'),
  'checkbox.radius': choice(TC_RADII, 'sm'),
  'checkbox.borderWidth': choice(TC_BORDER_WIDTHS, 'theme'),
  'checkbox.markWeight': num(1, 4, 2, 'px14'),
  ...states('checkbox', {
    rest: { bg: 'surface', border: 'border', mark: 'theme' },
    hover: { bg: 'theme', border: 'muted', mark: 'theme' },
    focus: { bg: 'theme', border: 'accent', mark: 'theme', ring: 'focus' },
    active: { bg: 'accentSoft', border: 'accent', mark: 'theme' },
    checked: { bg: 'accent', border: 'accent', mark: 'accentText' },
    disabled: { bg: 'theme', border: 'theme', mark: 'theme' },
    invalid: { bg: 'theme', border: 'danger', mark: 'theme' },
  }),
  // radio: the same box as a circle with a dot
  'radio.size': num(12, 32, 16, 'px14'),
  'radio.dotScale': num(30, 80, 50, '%'),
  'radio.borderWidth': choice(TC_BORDER_WIDTHS, 'theme'),
  ...states('radio', {
    rest: { bg: 'surface', border: 'border', mark: 'theme' },
    hover: { bg: 'theme', border: 'muted', mark: 'theme' },
    focus: { bg: 'theme', border: 'accent', mark: 'theme', ring: 'focus' },
    active: { bg: 'accentSoft', border: 'accent', mark: 'theme' },
    checked: { bg: 'surface', border: 'accent', mark: 'accent' },
    disabled: { bg: 'theme', border: 'theme', mark: 'theme' },
    invalid: { bg: 'theme', border: 'danger', mark: 'theme' },
  }),
  // range: track + accent fill + round thumb (today the browser's own, accent-coloured)
  'range.trackHeight': num(2, 16, 4, 'px14'),
  'range.trackRadius': choice(TC_RADII, 'pill'),
  'range.thumbSize': num(10, 32, 16, 'px14'),
  'range.thumbRadius': choice(TC_RADII, 'pill'),
  'range.showValue': choice(TC_SHOW_VALUE, 'drag'),
  'range.ticks': bool(true),
  ...states('range', {
    rest: { track: 'surface3', fill: 'accent', thumb: 'accent', thumbBorder: 'surface' },
    hover: { track: 'theme', fill: 'theme', thumb: 'theme', thumbBorder: 'theme' },
    focus: { track: 'theme', fill: 'theme', thumb: 'theme', thumbBorder: 'theme', ring: 'focus' },
    active: { track: 'theme', fill: 'theme', thumb: 'accent', thumbBorder: 'accentSoft' },
    disabled: { track: 'theme', fill: 'muted', thumb: 'muted', thumbBorder: 'theme' },
    invalid: { track: 'theme', fill: 'danger', thumb: 'danger', thumbBorder: 'theme' },
  }),
  // number: the text field (axf.css .fx-input: surface, border, accent focus border, accent-soft ring) with steppers
  'number.stepper': choice(TC_STEPPERS, 'ends'),
  'number.stepperWidth': num(20, 48, 28, 'px14'),
  'number.radius': choice(TC_RADII, 'theme'),
  'number.borderWidth': choice(TC_BORDER_WIDTHS, 'theme'),
  'number.repeatDelayMs': num(200, 1000, 400, 'ms'),
  'number.repeatMs': num(40, 400, 80, 'ms'),
  ...states('number', {
    rest: { bg: 'surface', border: 'border', text: 'text', stepperBg: 'surface2', stepperIcon: 'muted' },
    hover: { bg: 'theme', border: 'muted', text: 'theme', stepperBg: 'surface3', stepperIcon: 'text' },
    focus: { bg: 'theme', border: 'accent', text: 'theme', stepperBg: 'theme', stepperIcon: 'theme', ring: 'accentSoft' },
    active: { bg: 'theme', border: 'theme', text: 'theme', stepperBg: 'accentSoft', stepperIcon: 'accent' },
    disabled: { bg: 'theme', border: 'theme', text: 'muted', stepperBg: 'theme', stepperIcon: 'theme' },
    invalid: { bg: 'theme', border: 'danger', text: 'theme', stepperBg: 'theme', stepperIcon: 'theme' },
  }),
};

/** The families the registry has fields for right now (every entry of THEMED_FAMILIES once s3 lands). */
export const THEMED_CONTROL_GROUPS = [...new Set(Object.keys(THEMED_CONTROL_FIELDS).map((p) => p.split('.')[0]))];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const TOKEN = (t) => TC_COLOR_TOKENS.includes(t);

/**
 * A colour value, checked: `theme`, a token id, or a `light|dark` pair of token ids. Returns the value as written
 * (trimmed) or undefined.
 */
export function tcColorValue(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (s === 'theme' || TOKEN(s)) return s;
  const pair = s.split('|');
  return pair.length === 2 && TOKEN(pair[0].trim()) && TOKEN(pair[1].trim()) ? `${pair[0].trim()}|${pair[1].trim()}` : undefined;
}

/** The token a colour value names for a scheme (`light` | `dark`); `theme` stays `theme`. */
export function tcColorFor(value, scheme = 'light') {
  const v = tcColorValue(value);
  if (v === undefined) return 'theme';
  if (!v.includes('|')) return v;
  const [light, dark] = v.split('|');
  return scheme === 'dark' ? dark : light;
}

/** A field's value, normalized against its spec (or undefined when it doesn't fit). */
export function tcFieldValue(path, v) {
  const f = THEMED_CONTROL_FIELDS[path];
  if (!f) return undefined;
  switch (f.kind) {
    case 'color': return tcColorValue(v);
    case 'enum': { const s = typeof v === 'number' ? String(v) : v; return f.options.includes(s) ? s : undefined; }
    case 'number': { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(f.max, Math.max(f.min, n))) : undefined; }
    case 'boolean': return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
    default: return undefined;
  }
}

const getPath = (o, path) => path.split('.').reduce((at, k) => (isObj(at) ? at[k] : undefined), o);
const setPath = (o, path, value) => { const ks = path.split('.'); let at = o; for (const k of ks.slice(0, -1)) at = at[k] ??= {}; at[ks[ks.length - 1]] = value; };

/** Every field filled in (defaults for missing or malformed ones); nested like the asset: { checkbox: { size, rest: {…}, … }, … }. */
export function normalizeThemedControls(raw) {
  const out = {};
  for (const [path, f] of Object.entries(THEMED_CONTROL_FIELDS)) {
    const v = tcFieldValue(path, getPath(raw, path));
    setPath(out, path, v === undefined ? f.default : v);
  }
  return out;
}

/** Validator errors for a themed-controls asset's data (unknown families and fields are kept out, never an error). */
export function themedControlsErrors(raw) {
  if (!isObj(raw)) return ['data must be an object'];
  const errs = [];
  for (const [path, f] of Object.entries(THEMED_CONTROL_FIELDS)) {
    const v = getPath(raw, path);
    if (v === undefined) continue;
    if (tcFieldValue(path, v) === undefined) errs.push(`${path}: ${tcFieldHint(f)}`);
    else if (f.kind === 'number' && (v < f.min || v > f.max)) errs.push(`${path}: ${tcFieldHint(f)}`);
  }
  return errs;
}

/** Errors for one field set through control@1 (`tokens.controls <path> <value>`). */
export function tcFieldErrors(path, value) {
  const f = THEMED_CONTROL_FIELDS[path];
  if (!f) return [`unknown themed-controls field ${path}`];
  if (tcFieldValue(path, value) === undefined) return [`value must be ${tcFieldHint(f)}`];
  if (f.kind === 'number' && (Number(value) < f.min || Number(value) > f.max)) return [`value must be ${tcFieldHint(f)}`];
  return [];
}

export function tcFieldHint(f) {
  switch (f.kind) {
    case 'color': return `a colour token (${TC_COLOR_TOKENS.join(', ')}), a light|dark pair of them, or theme`;
    case 'enum': return `one of ${f.options.join(', ')}`;
    case 'number': return `a number ${f.min}..${f.max}${f.unit ? ` (${f.unit})` : ''}`;
    case 'boolean': return 'true or false';
    default: return 'a value';
  }
}

/** The fields of one family (path → spec), for a settings panel or a check. */
export function tcFamilyFields(family) {
  return Object.fromEntries(Object.entries(THEMED_CONTROL_FIELDS).filter(([p]) => p.startsWith(`${family}.`)));
}

/** The control@1 token list for `tokens.controls` (id, kind, options). */
export function themedControlsTokens() {
  return Object.entries(THEMED_CONTROL_FIELDS).map(([id, f]) => ({
    id,
    kind: f.kind === 'number' ? 'number' : f.kind === 'boolean' ? 'boolean' : f.kind === 'enum' ? 'enum' : 'string',
    ...(f.kind === 'enum' ? { options: f.options } : f.kind === 'color' ? { options: ['theme', ...TC_COLOR_TOKENS], pair: 'light|dark' } : {}),
    ...(f.kind === 'number' ? { min: f.min, max: f.max, unit: f.unit } : {}),
    default: f.default,
  }));
}

/** JSON schema properties for the generated schema (schemas/json/themed-controls.schema.json). */
export function themedControlsSchemaProperties() {
  const colorSchema = { type: 'string', pattern: `^(theme|(${TC_COLOR_TOKENS.join('|')})(\\|(${TC_COLOR_TOKENS.join('|')}))?)$` };
  const families = {};
  for (const [path, f] of Object.entries(THEMED_CONTROL_FIELDS)) {
    const s = f.kind === 'number' ? { type: 'number', minimum: f.min, maximum: f.max } : f.kind === 'boolean' ? { type: 'boolean' } : f.kind === 'enum' ? { enum: f.options } : colorSchema;
    const [family, ...rest] = path.split('.');
    const fam = families[family] ??= { type: 'object', properties: {} };
    if (rest.length === 1) fam.properties[rest[0]] = { ...s, default: f.default };
    else { const st = fam.properties[rest[0]] ??= { type: 'object', properties: {} }; st.properties[rest[1]] = { ...s, default: f.default }; }
  }
  return families;
}
