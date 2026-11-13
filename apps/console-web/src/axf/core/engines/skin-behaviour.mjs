/**
 * skin@2 behaviour (build professional-skins-that-rebuild-the-whole-app, Fable, Nov 13 2026. Brett: "each skin is a
 * complete restyle AND rebehave of the entire console UI").
 *
 * A skin@1 carried a look: themes, slot assets, an icon pack and style parts. A skin@2 carries that look plus a
 * behaviour pick for every asset type that has behaviour: where a tab row sits and how it overflows, where the toolbar
 * goes and whether it taps to confirm, how a button confirms, what form a context menu or the application menu takes,
 * how the navigation menu is shown (sidebar, rail, drawer, bottom tabs, top bar), how a dialog is presented (modal,
 * sheet, side panel, full screen), how a table is laid out and when its row actions show, where the banner sits.
 *
 * Which types have behaviour, and which axes, is worked out from the registry, never from a list here: a registered
 * type declares a `behaviour` block on its entry in `schemas/asset-types.json` (or its style target in
 * `schemas/customize.json` adds one), each axis `{ label, kind: choice | switch | number, values?, default, field?, of?,
 * map?, min?, max?, unit?, hint? }` (`_` keys are notes). `default` is today's behaviour, so a skin that sets nothing
 * changes nothing. `field` names the asset field the axis layers on (of the type itself, or of the type `of` names: the
 * toolbar's placement layers on the layout asset's toolbarPosition); an axis the skin leaves unset then takes the
 * asset's value (`map` translates asset words into axis words), else the default.
 *
 * Every axis compiles to one CSS token `--fx-bhv-<type>-<axis>` and one root attribute `data-fx-bhv-<type>-<axis>`
 * (so stylesheets select on the behaviour), and to one runtime value `axf.behaviour.<type>.<axis>` the framework
 * controls read through the nearest SkinScope. Precedence at a place (skin-rules.mjs, runtime): the user's saved
 * per-row override (`axf.chrome.<type>.<instance>`, chrome-settings@1) > a behaviour override on the nearest level of
 * the skin chain (plugin → ui → app → global) > the skin's own `behaviour` > the asset's field > the axis default.
 *
 * Plain JS shared by the TS engine (skin.ts), the build engine (validator + JSON schema), the CLI and the console
 * server; never imports JSON, so the console can bake it. Pure.
 */

export const SKIN_BEHAVIOUR_CONTRACT = 'skin-behaviour@1';
/** The kinds an axis may be. */
export const BEHAVIOUR_KINDS = ['choice', 'switch', 'number'];
/** `--fx-bhv-<type>-<axis>` */
export const BEHAVIOUR_TOKEN_PREFIX = 'bhv';
/** `axf.behaviour.<type>.<axis>` */
export const BEHAVIOUR_KEY_PREFIX = 'axf.behaviour.';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const TYPE_ID = /^[a-z0-9][a-z0-9-]*$/;
const AXIS_ID = /^[a-z][a-zA-Z0-9]{0,39}$/;
const WORD = /^[a-z0-9][a-z0-9-]{0,39}$/;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
export const toKebab = (s) => String(s).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/* ---------------------------------------------------------------- declarations */

/** The raw axis declarations of a type: the registry entry's block, then the style target's block over it; `_` keys are notes. */
function rawAxes(type, spec, targets) {
  const out = {};
  for (const src of [isObj(spec) ? spec[type]?.behaviour : null, isObj(targets) ? targets[type]?.behaviour : null]) {
    if (!isObj(src)) continue;
    for (const [k, v] of Object.entries(src)) if (!k.startsWith('_')) out[k] = v;
  }
  return out;
}

/** One axis declaration, checked: `{ axis, errors }` (axis is null when it can't be used). */
export function checkAxis(type, name, raw) {
  const errors = [];
  const at = `${type}.behaviour.${name}`;
  if (!AXIS_ID.test(name)) errors.push(`${at}: an axis name is a camelCase word (letters and digits, 40 at most)`);
  if (!isObj(raw)) return { axis: null, errors: [...errors, `${at}: an axis is an object { label, kind, values?, default, … }`] };
  const kind = BEHAVIOUR_KINDS.includes(raw.kind) ? raw.kind : Array.isArray(raw.values) ? 'choice' : typeof raw.default === 'boolean' ? 'switch' : typeof raw.default === 'number' ? 'number' : 'choice';
  if ('kind' in raw && !BEHAVIOUR_KINDS.includes(raw.kind)) errors.push(`${at}: kind must be one of ${BEHAVIOUR_KINDS.join(', ')}`);
  const axis = { name, label: str(raw.label, 80) || name, kind, default: raw.default };
  if (kind === 'choice') {
    const values = Array.isArray(raw.values) ? raw.values.filter((v) => typeof v === 'string' && WORD.test(v)) : [];
    if (values.length < 2) errors.push(`${at}: a choice axis needs at least two values (lower-case words)`);
    else if (Array.isArray(raw.values) && values.length !== raw.values.length) errors.push(`${at}: every value is a lower-case word (letters, digits, dashes)`);
    else if (new Set(values).size !== values.length) errors.push(`${at}: values repeat a word`);
    if (typeof raw.default !== 'string' || !values.includes(raw.default)) errors.push(`${at}: default must be one of its values`);
    axis.values = values;
  } else if (kind === 'switch') {
    if (typeof raw.default !== 'boolean') errors.push(`${at}: a switch axis has a true / false default`);
  } else {
    const min = typeof raw.min === 'number' ? raw.min : NaN;
    const max = typeof raw.max === 'number' ? raw.max : NaN;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) errors.push(`${at}: a number axis needs min < max`);
    if (typeof raw.default !== 'number' || !Number.isFinite(raw.default) || raw.default < min || raw.default > max) errors.push(`${at}: default must be a number inside min..max`);
    axis.min = min; axis.max = max;
    if (typeof raw.unit === 'string') axis.unit = str(raw.unit, 12);
  }
  if ('field' in raw) {
    if (typeof raw.field !== 'string' || !AXIS_ID.test(raw.field)) errors.push(`${at}: field names the asset field the axis layers on`);
    else axis.field = raw.field;
  }
  if ('of' in raw) {
    if (typeof raw.of !== 'string' || !TYPE_ID.test(raw.of)) errors.push(`${at}: of names the asset type whose field the axis layers on`);
    else axis.of = raw.of;
  }
  if (axis.of && !axis.field) errors.push(`${at}: of needs field`);
  if ('map' in raw) {
    if (!isObj(raw.map) || Object.values(raw.map).some((v) => typeof v !== 'string')) errors.push(`${at}: map translates asset words into axis words (string → string)`);
    else {
      axis.map = { ...raw.map };
      if (kind === 'choice') for (const v of Object.values(axis.map)) if (!axis.values.includes(v)) errors.push(`${at}: map value "${v}" is not one of the axis values`);
    }
  }
  if (typeof raw.hint === 'string') axis.hint = str(raw.hint, 200);
  return { axis: errors.length ? null : axis, errors };
}

/** The behaviour axes of a type, checked, declaration order; a type with none (or only bad ones, or an `of` naming no registered type) gives {}. */
export function behaviourAxes(type, spec, targets = {}) {
  const out = {};
  for (const [name, raw] of Object.entries(rawAxes(type, spec, targets))) {
    const { axis } = checkAxis(type, name, raw);
    if (axis && !(axis.field && axis.of && isObj(spec) && !spec[axis.of])) out[name] = axis;
  }
  return out;
}

/** One axis of a type, or null. */
export function axisOf(type, axis, spec, targets = {}) { return behaviourAxes(type, spec, targets)[axis] ?? null; }

/** Problems with a type's declarations (CI lists them). */
export function behaviourDeclarationErrors(type, spec, targets = {}) {
  const out = [];
  const t = isObj(spec) ? spec[type] : null;
  if (isObj(t) && 'behaviour' in t && !isObj(t.behaviour)) out.push(`${type}: behaviour must be an object (axis → declaration)`);
  const raw = rawAxes(type, spec, targets);
  for (const [name, r] of Object.entries(raw)) {
    const { axis, errors } = checkAxis(type, name, r);
    out.push(...errors);
    if (axis?.field && axis.of && isObj(spec) && !spec[axis.of]) out.push(`${type}.behaviour.${name}: of "${axis.of}" is not a registered asset type`);
  }
  return out;
}

/** Every registered type that declares behaviour, registry order. */
export function behaviourTypes(spec, targets = {}) {
  return Object.keys(isObj(spec) ? spec : {}).filter((t) => Object.keys(behaviourAxes(t, spec, targets)).length > 0);
}

/** The whole behaviour contract as rows: one per type, with its axes in declaration order. */
export function behaviourTable(spec, targets = {}) {
  return behaviourTypes(spec, targets).map((type) => ({ type, label: str(spec[type]?.label, 80) || type, group: str(spec[type]?.group, 40), axes: Object.values(behaviourAxes(type, spec, targets)) }));
}

/* ---------------------------------------------------------------- values */

/** `v` as a value of the axis, or undefined when it isn't one (switches also read 'on' / 'off' / 'true' / 'false'). */
export function normalizeAxisValue(axis, v) {
  if (!axis) return undefined;
  if (axis.kind === 'choice') return typeof v === 'string' && axis.values.includes(v) ? v : undefined;
  if (axis.kind === 'switch') return typeof v === 'boolean' ? v : v === 'true' || v === 'on' ? true : v === 'false' || v === 'off' ? false : undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= axis.min && n <= axis.max ? n : undefined;
}

/** Keep only what a `behaviour` block may hold: registered types with axes, known axes, values of the right kind. */
export function normalizeBehaviour(raw, spec, targets = {}) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [type, picks] of Object.entries(raw)) {
    if (!isObj(picks)) continue;
    const axes = behaviourAxes(type, spec, targets);
    const kept = {};
    for (const [name, v] of Object.entries(picks)) {
      const val = normalizeAxisValue(axes[name], v);
      if (val !== undefined) kept[name] = val;
    }
    if (Object.keys(kept).length) out[type] = kept;
  }
  return out;
}

/** The allowed values of an axis, in words (for messages and pickers). */
export function axisValuesText(axis) {
  if (axis.kind === 'choice') return axis.values.join(', ');
  if (axis.kind === 'switch') return 'true, false';
  return `${axis.min}..${axis.max}${axis.unit ? ` ${axis.unit}` : ''}`;
}

/** Validation messages for a skin's `behaviour` block (the validators report them; undefined = nothing to say). */
export function behaviourErrors(raw, spec, targets = {}, path = 'data.behaviour') {
  if (raw === undefined) return [];
  if (!isObj(raw)) return [`${path} must be an object (asset type → axis → value)`];
  const out = [];
  for (const [type, picks] of Object.entries(raw)) {
    if (!isObj(spec) || !spec[type]) { out.push(`${path}.${type}: not a registered asset type`); continue; }
    const axes = behaviourAxes(type, spec, targets);
    if (!Object.keys(axes).length) { out.push(`${path}.${type}: this type declares no behaviour axes`); continue; }
    if (!isObj(picks)) { out.push(`${path}.${type} must be an object (axis → value)`); continue; }
    for (const [name, v] of Object.entries(picks)) {
      if (!axes[name]) out.push(`${path}.${type}.${name}: not a behaviour axis of ${type} (${Object.keys(axes).join(', ')})`);
      else if (normalizeAxisValue(axes[name], v) === undefined) out.push(`${path}.${type}.${name} must be one of ${axisValuesText(axes[name])}`);
    }
  }
  return out;
}

/** Today's behaviour for every type and axis (what a skin@1 reads as). */
export function behaviourDefaults(spec, targets = {}) {
  const out = {};
  for (const type of behaviourTypes(spec, targets)) {
    out[type] = {};
    for (const [name, axis] of Object.entries(behaviourAxes(type, spec, targets))) out[type][name] = axis.default;
  }
  return out;
}

/** Layers merged parent-first: the last layer that sets an axis wins; a null / undefined value drops the pick. */
export function mergeBehaviour(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!isObj(layer)) continue;
    for (const [type, picks] of Object.entries(layer)) {
      if (!isObj(picks)) continue;
      const cur = { ...(out[type] ?? {}) };
      for (const [name, v] of Object.entries(picks)) { if (v === null || v === undefined) delete cur[name]; else cur[name] = v; }
      if (Object.keys(cur).length) out[type] = cur; else delete out[type];
    }
  }
  return out;
}

function sortPicks(p) {
  const out = {};
  for (const type of Object.keys(isObj(p) ? p : {}).sort()) { const v = p[type]; if (isObj(v)) out[type] = Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])); }
  return out;
}
/** Are two pick maps the same behaviour? */
export function sameBehaviour(a, b) { return JSON.stringify(sortPicks(a)) === JSON.stringify(sortPicks(b)); }

/**
 * The effective behaviour at a place, every type and axis filled: the pick (`picked`, already merged along the chain),
 * else the asset field the axis layers on (`assetField(type, field)` gives the active asset's value, mapped), else the
 * default. Pure: the runtime passes the asset reader.
 */
export function resolveBehaviour(picked, spec, targets = {}, assetField = () => undefined) {
  const out = {};
  for (const type of behaviourTypes(spec, targets)) {
    out[type] = {};
    for (const [name, axis] of Object.entries(behaviourAxes(type, spec, targets))) {
      const pick = normalizeAxisValue(axis, picked?.[type]?.[name]);
      if (pick !== undefined) { out[type][name] = pick; continue; }
      if (axis.field) {
        let v = assetField(axis.of ?? type, axis.field);
        if (axis.map && typeof v === 'string' && v in axis.map) v = axis.map[v];
        const fromAsset = normalizeAxisValue(axis, v);
        if (fromAsset !== undefined) { out[type][name] = fromAsset; continue; }
      }
      out[type][name] = axis.default;
    }
  }
  return out;
}

/**
 * The value one axis has at a component: `instance` (the row's own chrome-settings override of the axis's field) >
 * `pick` (the behaviour in force at the place) > `asset` (the field's value on the asset in force) > the default.
 * Undefined for an unknown axis.
 */
export function behaviourValue(type, axis, spec, targets = {}, sources = {}) {
  const a = axisOf(type, axis, spec, targets);
  if (!a) return undefined;
  const mapped = (v) => (a.map && typeof v === 'string' && v in a.map ? a.map[v] : v);
  const inst = a.field ? normalizeAxisValue(a, mapped(sources.instance)) : undefined;
  if (inst !== undefined) return inst;
  const pick = normalizeAxisValue(a, sources.pick);
  if (pick !== undefined) return pick;
  const own = a.field ? normalizeAxisValue(a, mapped(sources.asset)) : undefined;
  if (own !== undefined) return own;
  return a.default;
}

/**
 * A copy of a type's asset data with the picks written over the fields its own axes layer on (axes with `field` on the
 * type itself, never on another type): what a component draws before the row's own override goes on top. `map` runs
 * backwards: an axis word with one asset word mapping to it writes that asset word.
 */
export function applyBehaviourToAsset(type, data, picked, spec, targets = {}) {
  const out = { ...(isObj(data) ? data : {}) };
  const p = isObj(picked) ? picked[type] : null;
  if (!p) return out;
  for (const a of Object.values(behaviourAxes(type, spec, targets))) {
    if (!a.field || (a.of && a.of !== type)) continue;
    const v = normalizeAxisValue(a, p[a.name]);
    if (v === undefined) continue;
    const back = a.map ? Object.entries(a.map).filter(([, to]) => to === v).map(([from]) => from) : [];
    out[a.field] = back.length === 1 ? back[0] : v;
  }
  return out;
}

/** The fields the picks set on another type's asset (`of`): `{ nav: 'right', toolbarPosition: 'bottom' }` for `layout`. */
export function behaviourFieldsOf(ofType, picked, spec, targets = {}) {
  const out = {};
  for (const type of behaviourTypes(spec, targets)) {
    for (const a of Object.values(behaviourAxes(type, spec, targets))) {
      if (!a.field || (a.of ?? type) !== ofType || type === ofType) continue;
      const v = normalizeAxisValue(a, picked?.[type]?.[a.name]);
      if (v !== undefined) out[a.field] = v;
    }
  }
  return out;
}

/** The axes a skin's behaviour leaves unset, per type with behaviour (a type absent from the result is fully covered). */
export function behaviourMissing(picked, spec, targets = {}) {
  const out = {};
  for (const type of behaviourTypes(spec, targets)) {
    const axes = behaviourAxes(type, spec, targets);
    const missing = Object.keys(axes).filter((name) => normalizeAxisValue(axes[name], picked?.[type]?.[name]) === undefined);
    if (missing.length) out[type] = missing;
  }
  return out;
}

/** Per type with behaviour: its axes, the ones a skin set, the ones it left unset. */
export function behaviourCoverage(picked, spec, targets = {}) {
  const missing = behaviourMissing(picked, spec, targets);
  return behaviourTypes(spec, targets).map((type) => {
    const axes = Object.keys(behaviourAxes(type, spec, targets));
    const unset = missing[type] ?? [];
    return { type, axes, set: axes.filter((a) => !unset.includes(a)), missing: unset };
  });
}

/** One row per type for a "what this skin changes" list: each axis with its value and whether it is today's behaviour. */
export function describeBehaviour(picked, spec, targets = {}) {
  const p = normalizeBehaviour(picked, spec, targets);
  return behaviourTable(spec, targets).map((row) => ({
    type: row.type,
    label: row.label,
    picks: row.axes.map((a) => { const v = p[row.type]?.[a.name]; return { axis: a.name, label: a.label, value: v === undefined ? a.default : v, set: v !== undefined, isDefault: v === undefined || v === a.default }; }),
  }));
}

/* ---------------------------------------------------------------- tokens */

export const behaviourToken = (type, axis) => `--fx-${BEHAVIOUR_TOKEN_PREFIX}-${type}-${toKebab(axis)}`;
export const behaviourAttr = (type, axis) => `data-fx-${BEHAVIOUR_TOKEN_PREFIX}-${type}-${toKebab(axis)}`;
export const behaviourKey = (type, axis) => `${BEHAVIOUR_KEY_PREFIX}${type}.${axis}`;

/** `axf.behaviour.<type>.<axis>` → `{ type, axis }`, or null. */
export function parseBehaviourKey(key) {
  if (typeof key !== 'string' || !key.startsWith(BEHAVIOUR_KEY_PREFIX)) return null;
  const rest = key.slice(BEHAVIOUR_KEY_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  const type = rest.slice(0, dot);
  const axis = rest.slice(dot + 1);
  return TYPE_ID.test(type) && AXIS_ID.test(axis) ? { type, axis } : null;
}
export const isBehaviourKey = (key) => parseBehaviourKey(key) !== null;

/** The picks a settings map carries (`axf.behaviour.*` keys only), checked against the registry. */
export function behaviourFromSettings(settings, spec, targets = {}) {
  const raw = {};
  for (const [k, v] of Object.entries(isObj(settings) ? settings : {})) {
    const p = parseBehaviourKey(k);
    if (p) (raw[p.type] ??= {})[p.axis] = v;
  }
  return normalizeBehaviour(raw, spec, targets);
}

/** A value as its token text: a word, 1 / 0, or the number. */
export function behaviourValueText(v) {
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

/** `--fx-bhv-<type>-<axis>` → text for a resolved behaviour map. */
export function behaviourTokenVars(resolved) {
  const out = {};
  for (const [type, picks] of Object.entries(isObj(resolved) ? resolved : {})) for (const [name, v] of Object.entries(picks)) out[behaviourToken(type, name)] = behaviourValueText(v);
  return out;
}

/** `data-fx-bhv-<type>-<axis>` → text for a resolved behaviour map. */
export function behaviourAttrs(resolved) {
  const out = {};
  for (const [type, picks] of Object.entries(isObj(resolved) ? resolved : {})) for (const [name, v] of Object.entries(picks)) out[behaviourAttr(type, name)] = behaviourValueText(v);
  return out;
}

/** `axf.behaviour.<type>.<axis>` → value for a resolved behaviour map (what `rt.behaviour()` reads). */
export function behaviourRuntimeValues(resolved) {
  const out = {};
  for (const [type, picks] of Object.entries(isObj(resolved) ? resolved : {})) for (const [name, v] of Object.entries(picks)) out[behaviourKey(type, name)] = v;
  return out;
}

/** Every behaviour token, registry order: the control@1 token list and the docs table. */
export function behaviourTokens(spec, targets = {}) {
  const out = [];
  for (const row of behaviourTable(spec, targets)) {
    for (const axis of row.axes) out.push({ type: row.type, axis: axis.name, label: axis.label, kind: axis.kind, values: axis.values ?? null, default: axis.default, min: axis.min ?? null, max: axis.max ?? null, unit: axis.unit ?? '', field: axis.field ?? '', of: axis.field ? axis.of ?? row.type : '', token: behaviourToken(row.type, axis.name), attr: behaviourAttr(row.type, axis.name), key: behaviourKey(row.type, axis.name) });
  }
  return out;
}

/** The JSON Schema of one axis value. */
export function axisSchema(axis) {
  const s = axis.kind === 'choice' ? { enum: axis.values } : axis.kind === 'switch' ? { type: 'boolean' } : { type: 'number', minimum: axis.min, maximum: axis.max };
  return { ...s, description: `${axis.label} (default ${JSON.stringify(axis.default)}${axis.field ? `; unset = the ${axis.of ?? 'asset'}'s ${axis.field}` : ''})` };
}

/** The JSON Schema of a skin's `behaviour` block: one property per type with behaviour, one per axis inside. */
export function behaviourSchemaProperties(spec, targets = {}) {
  const properties = {};
  for (const row of behaviourTable(spec, targets)) {
    properties[row.type] = { type: 'object', additionalProperties: false, properties: Object.fromEntries(row.axes.map((a) => [a.name, axisSchema(a)])) };
  }
  return { behaviour: { type: 'object', additionalProperties: false, description: "skin@2: a behaviour pick per asset type with behaviour (axes declared on the registry entry; unset = the asset's field, else today's behaviour)", properties } };
}
