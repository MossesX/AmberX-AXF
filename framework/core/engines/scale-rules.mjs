/**
 * scale rules — typography@1, density@1 and sizing@1 (Brett, Oct 30 2026: "change it in one place, changes it
 * everywhere"). Three broad assets that own every size the framework used to decide in a stylesheet or a component:
 *
 *   typography  text sizes (a scale + headings), weights, line heights, the eyebrow, mono text
 *   density     gaps, paddings and row heights — "compact" vs "roomy" is one pick
 *   sizing      how big each kind of piece is: buttons, icon buttons, chips, fields, tabs, segmented controls, cards,
 *               list rows, count strips, tables, page heads
 *
 * ONE registry (SCALE_FIELDS) drives the validators (TS + build engine), the normalizer, the engine that compiles to
 * `--fx-*` tokens, the JSON schemas and the fixtures. Every field has a default: the compact look (Oct 31 2026, Brett: "the screen
 * don't look tighter"), so an app without these assets gets the tight framework look; `standard` starters keep the Oct 30 sizes. Unknown fields
 * are kept out, never an error (open registry: later pieces add fields here, never new types). Pure, no DOM.
 *
 * Field entry: [default, min, max, unit]. Units: em (× the current font size), space (× --fx-space), font (× --fx-font-size),
 * x (a plain number), int (a whole number). Enum fields list their allowed words in SCALE_ENUMS and compile through
 * SCALE_ENUM_VALUES. Token names are regular: --fx-<prefix>-<group>-<field> (kebab-case), prefix per type in SCALE_PREFIX.
 */

export const SCALE_TYPES = ['typography', 'density', 'sizing'];
export const SCALE_FRAME = { typography: 'typography@1', density: 'density@1', sizing: 'sizing@1' };
export const SCALE_PREFIX = { typography: 'type', density: 'dens', sizing: 'size' };

export const SCALE_FIELDS = {
  typography: {
    // the text-size steps every stylesheet maps its font sizes onto (2xs … 2xl, × the parent's size)
    'scale.2xs': [0.66, 0.4, 1, 'em'],
    'scale.xs': [0.74, 0.5, 1, 'em'],
    'scale.sm': [0.82, 0.5, 1, 'em'],
    'scale.md': [0.9, 0.7, 1.25, 'em'],
    'scale.lg': [1.06, 0.9, 2, 'em'],
    'scale.xl': [1.26, 1, 3, 'em'],
    'scale.2xl': [1.7, 1, 4, 'em'],
    'headings.h1': [1.3, 0.9, 4, 'em'],
    'headings.h2': [1.12, 0.9, 3, 'em'],
    'headings.h3': [0.9, 0.7, 2, 'em'],
    'headings.h4': [0.84, 0.7, 1.5, 'em'],
    'headings.tracking': [-0.02, -0.1, 0.2, 'em'],
    'weights.body': [400, 300, 700, 'x'],
    'weights.medium': [550, 400, 700, 'x'],
    'weights.strong': [600, 500, 900, 'x'],
    'line.tight': [1.2, 1, 1.5, 'x'],
    'line.normal': [1.4, 1.1, 2, 'x'],
    'line.loose': [1.6, 1.2, 2.4, 'x'],
    'eyebrow.size': [0.66, 0.5, 1, 'em'],
    'eyebrow.weight': [600, 400, 900, 'x'],
    'eyebrow.tracking': [0.06, 0, 0.3, 'em'],
    'mono.size': [0.88, 0.6, 1.2, 'em'],
  },
  density: {
    // the spacing steps every gap, padding and margin maps onto (2xs … 4xl, × --fx-space)
    'gap.2xs': [0.1, 0, 1, 'space'],
    'gap.xs': [0.2, 0, 2, 'space'],
    'gap.sm': [0.3, 0, 2, 'space'],
    'gap.md': [0.4, 0, 3, 'space'],
    'gap.lg': [0.6, 0, 4, 'space'],
    'gap.xl': [0.8, 0, 6, 'space'],
    'gap.2xl': [1.2, 0, 6, 'space'],
    'gap.3xl': [1.6, 0, 8, 'space'],
    'gap.4xl': [2.4, 0, 10, 'space'],
    'pad.control': [0.45, 0, 2, 'space'],
    'pad.card': [1.1, 0, 4, 'space'],
    'pad.page': [1.25, 0, 6, 'space'],
    'pad.row': [0.55, 0, 3, 'space'],
    'pad.cell': [0.5, 0, 3, 'space'],
    'row.list': [2.3, 1.5, 5, 'font'],
    'row.table': [2.1, 1.5, 5, 'font'],
    'row.menu': [2, 1.5, 5, 'font'],
    'row.control': [2.1, 1.5, 4, 'font'],
  },
  sizing: {
    'button.height': [2.1, 1.5, 3.5, 'font'],
    'button.padX': [0.9, 0.3, 3, 'space'],
    'button.font': [0.86, 0.6, 1.2, 'em'],
    'button.icon': [1, 0.6, 1.5, 'em'],
    'iconButton.size': [1.75, 1.2, 3, 'font'],
    'chip.height': [1.4, 1.1, 2.5, 'font'],
    'chip.padX': [0.6, 0.2, 2, 'space'],
    'chip.font': [0.74, 0.6, 1, 'em'],
    'field.height': [2.1, 1.6, 3.2, 'font'],
    'field.padX': [0.6, 0.2, 2, 'space'],
    'field.font': [0.9, 0.6, 1.2, 'em'],
    'tab.padY': [0.5, 0, 2, 'space'],
    'tab.padX': [0.85, 0.3, 3, 'space'],
    'tab.font': [0.86, 0.6, 1.2, 'em'],
    'segment.padY': [0.3, 0, 2, 'space'],
    'segment.padX': [0.8, 0.3, 3, 'space'],
    'segment.font': [0.82, 0.6, 1.2, 'em'],
    'card.pad': [1.1, 0, 4, 'space'],
    'card.headFont': [0.9, 0.6, 1.3, 'em'],
    'listRow.minHeight': [2.3, 1.5, 5, 'font'],
    'listRow.padX': [0.85, 0, 3, 'space'],
    'listRow.metaFont': [0.8, 0.6, 1, 'em'],
    'countStrip.number': [1, 0.8, 3, 'em'],
    'countStrip.label': [0.68, 0.5, 1, 'em'],
    'countStrip.pad': [0.35, 0, 2, 'space'],
    'table.padY': [0.45, 0, 3, 'space'],
    'table.padX': [0.75, 0, 3, 'space'],
    'table.font': [0.86, 0.6, 1.2, 'em'],
    'pageHead.descriptionFont': [0.88, 0.6, 1.2, 'em'],
    'pageHead.descriptionLines': [2, 1, 6, 'int'],
  },
};

/**
 * Root-anchored twins: every text step also compiles to --fx-type-root-<step> = calc(var(--fx-font-size) * step), for
 * pieces sized from the app's base size rather than their parent's (a label inside a small cell must not shrink twice).
 */
export const SCALE_ROOT_GROUPS = { typography: ['scale'], density: [], sizing: [] };

/** Enum fields (type → path → allowed words) and what each word compiles to. */
export const SCALE_ENUMS = {
  typography: { 'eyebrow.case': ['upper', 'normal'] },
  density: {},
  sizing: { 'chip.radius': ['sm', 'md', 'pill'], 'card.radius': ['sm', 'md', 'lg'] },
};
export const SCALE_ENUM_DEFAULTS = {
  typography: { 'eyebrow.case': 'upper' },
  density: {},
  sizing: { 'chip.radius': 'sm', 'card.radius': 'md' },
};
export const SCALE_ENUM_VALUES = {
  'eyebrow.case': { upper: 'uppercase', normal: 'none' },
  'chip.radius': { sm: 'var(--fx-radius-sm)', md: 'var(--fx-radius-md)', pill: '999px' },
  'card.radius': { sm: 'var(--fx-radius-sm)', md: 'var(--fx-radius-md)', lg: 'var(--fx-radius-lg)' },
};

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const groupOf = (raw, g) => (isObj(raw) && isObj(raw[g]) ? raw[g] : {});
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const round = (v, unit) => (unit === 'int' || unit === 'x' && v >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000);

export const isScaleType = (type) => SCALE_TYPES.includes(type);
export const scaleGroups = (type) => [...new Set([...Object.keys(SCALE_FIELDS[type] ?? {}), ...Object.keys(SCALE_ENUMS[type] ?? {})].map((p) => p.split('.')[0]))];

/** Every field filled in, grouped; anything missing or malformed takes the default, numbers clamp into range. */
export function normalizeScale(type, raw) {
  const out = {};
  for (const [path, [def, min, max, unit]] of Object.entries(SCALE_FIELDS[type] ?? {})) {
    const [g, f] = path.split('.');
    const v = groupOf(raw, g)[f];
    (out[g] ??= {})[f] = typeof v === 'number' && Number.isFinite(v) ? round(Math.min(max, Math.max(min, v)), unit) : def;
  }
  for (const [path, allowed] of Object.entries(SCALE_ENUMS[type] ?? {})) {
    const [g, f] = path.split('.');
    const v = groupOf(raw, g)[f];
    (out[g] ??= {})[f] = typeof v === 'string' && allowed.includes(v) ? v : SCALE_ENUM_DEFAULTS[type][path];
  }
  return out;
}

/** What validators report. Missing fields are fine (defaults); wrong ones are not; unknown ones are ignored. */
export function scaleErrors(type, raw) {
  if (!isScaleType(type)) return [];
  if (!isObj(raw)) return ['data must be an object'];
  const errors = [];
  for (const g of scaleGroups(type)) if (g in raw && !isObj(raw[g])) errors.push(`data.${g} must be an object`);
  for (const [path, [, min, max, unit]] of Object.entries(SCALE_FIELDS[type])) {
    const [g, f] = path.split('.');
    const grp = groupOf(raw, g);
    if (!(f in grp)) continue;
    const v = grp[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) errors.push(`data.${path} must be a number from ${min} to ${max}`);
    else if (unit === 'int' && !Number.isInteger(v)) errors.push(`data.${path} must be a whole number`);
  }
  for (const [path, allowed] of Object.entries(SCALE_ENUMS[type])) {
    const [g, f] = path.split('.');
    const grp = groupOf(raw, g);
    if (f in grp && !allowed.includes(grp[f])) errors.push(`data.${path} must be one of ${allowed.join(', ')}`);
  }
  return errors;
}

/** The CSS token a field compiles to: --fx-<prefix>-<group>-<field>. */
export const scaleToken = (type, path) => `--fx-${SCALE_PREFIX[type]}-${path.split('.').map(kebab).join('-')}`;

/** One value in CSS, by the field's unit. */
export function scaleValue(unit, v) {
  switch (unit) {
    case 'em': return `${v}em`;
    case 'space': return `calc(var(--fx-space) * ${v})`;
    case 'font': return `calc(var(--fx-font-size) * ${v})`;
    default: return String(v);
  }
}

/** Root CSS vars for one asset of a scale type (the defaults when `raw` is missing). Pure: the same on every port. */
export function scaleVars(type, raw) {
  if (!isScaleType(type)) return {};
  const n = normalizeScale(type, raw);
  const vars = {};
  for (const [path, [, , , unit]] of Object.entries(SCALE_FIELDS[type])) {
    const [g, f] = path.split('.');
    vars[scaleToken(type, path)] = scaleValue(unit, n[g][f]);
  }
  for (const path of Object.keys(SCALE_ENUMS[type])) {
    const [g, f] = path.split('.');
    vars[scaleToken(type, path)] = SCALE_ENUM_VALUES[path][n[g][f]];
  }
  for (const g of SCALE_ROOT_GROUPS[type]) {
    for (const [f, v] of Object.entries(n[g] ?? {})) vars[`--fx-${SCALE_PREFIX[type]}-root-${kebab(f)}`] = scaleValue('font', v);
  }
  return vars;
}

/** JSON-Schema `properties` for one type's data (used by the schema generator): every group optional, fields typed + ranged. */
export function scaleSchemaProperties(type) {
  const props = {};
  for (const [path, [def, min, max, unit]] of Object.entries(SCALE_FIELDS[type] ?? {})) {
    const [g, f] = path.split('.');
    (props[g] ??= { type: 'object', properties: {} }).properties[f] = { type: unit === 'int' ? 'integer' : 'number', minimum: min, maximum: max, default: def, description: `${unit === 'em' ? 'em' : unit === 'space' ? '× --fx-space' : unit === 'font' ? '× --fx-font-size' : 'number'}` };
  }
  for (const [path, allowed] of Object.entries(SCALE_ENUMS[type] ?? {})) {
    const [g, f] = path.split('.');
    (props[g] ??= { type: 'object', properties: {} }).properties[f] = { enum: allowed, default: SCALE_ENUM_DEFAULTS[type][path] };
  }
  return props;
}
