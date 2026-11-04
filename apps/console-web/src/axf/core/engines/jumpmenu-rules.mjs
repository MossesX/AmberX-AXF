/**
 * jump-menu rules (jump-menu@1, build jump-menu-asset, Brett Nov 4 2026: "make the jump menu an asset type … when you
 * right click on it, you can go to its settings. It has its own settings … whether it shows icons or text or whatever …
 * you can select its location."): an in-page section index. A long page (Plan Studio's plan view, a settings page, a
 * report, an MD Studio doc) lists its sections; the jump menu draws them, scrolls to the one you tap, and lights the one
 * on screen (scroll-spy). It is not a navigation menu: it never opens sections one at a time, it only moves within the
 * page.
 *
 * ONE registry (JUMP_FIELDS) drives the normalizer, the validator (TS + build engine), the engine that compiles a
 * jump-menu asset to `--fx-jump-*` tokens + `data-fx-jump-*` attributes (jumpmenu.ts), the control@1 token list
 * (`tokens.jump`) and the settings dialog. Shared with the build engine (plain .mjs), like navstyle-rules.mjs.
 *
 * Every field is one scalar with a default, so a control@1 token override can set any of them. Per page, a jump menu
 * has an id (`plan-studio.plan`); its own settings are overrides on the same token set under `menu.<id>.<field>`
 * (and `menu.<id>.asset` picks the asset that menu uses instead of the app's slot), so "its own settings" and the
 * app-wide ones live in one place, ride the axHub look like every other look change, and the API, MCP and CLI set the
 * same values (`axf token jump set menu.plan-studio.plan.location left`).
 *
 * Styling comes only from theme tokens: sizes are multiples of the space unit and the type scale, colours are the
 * theme's. Unknown fields are dropped, never an error. Pure, no DOM. Kotlin twin deferred (Android on hold,
 * spec/PORTING.md).
 */

export const JUMP_MENU_TYPE = 'jump-menu';
export const JUMP_MENU_FRAME = 'jump-menu@1';

/** Where the menu sits relative to the page content it indexes. */
export const JUMP_LOCATIONS = ['top', 'left', 'right', 'bottom', 'floating'];
/** What each entry shows. */
export const JUMP_DISPLAYS = ['icons-text', 'text', 'icons', 'numbered'];
/** The visual family (every one styled by theme tokens; the component style engine's chip / tab / nav rules). */
export const JUMP_VARIANTS = ['chips', 'underline', 'rail', 'pill'];
export const JUMP_SIZES = ['sm', 'md', 'lg'];
export const JUMP_DENSITIES = ['theme', 'compact', 'regular', 'roomy'];
/** What happens when the entries don't fit in one line (top / bottom) or one column (left / right). */
export const JUMP_OVERFLOWS = ['wrap', 'scroll', 'more'];

const choice = (options, dflt) => ({ kind: 'enum', options, default: dflt });
const bool = (dflt) => ({ kind: 'boolean', default: dflt });
const num = (min, max, dflt, unit) => ({ kind: 'number', min, max, default: dflt, unit });

/** Every field: id → spec. The settings dialog shows them by level (simple → administrator). */
export const JUMP_FIELDS = {
  location: choice(JUMP_LOCATIONS, 'top'),
  display: choice(JUMP_DISPLAYS, 'icons-text'),
  variant: choice(JUMP_VARIANTS, 'chips'),
  size: choice(JUMP_SIZES, 'md'),
  density: choice(JUMP_DENSITIES, 'theme'),
  /** stays on screen while the page scrolls (top / bottom stick to their edge, left / right to the top of the viewport) */
  sticky: bool(true),
  /** a chevron folds the menu to a thin handle */
  collapsible: bool(false),
  /** starts folded (only with collapsible) */
  collapsed: bool(false),
  /** scroll-spy: the section on screen is lit */
  spy: bool(true),
  /** smooth scrolling when an entry is tapped (reduced motion turns it off) */
  smooth: bool(true),
  overflow: choice(JUMP_OVERFLOWS, 'scroll'),
  /** room left above a section when jumped to (× the space unit): a sticky banner or menu never covers its heading */
  offset: num(0, 12, 4, 'space'),
};
export const JUMP_FIELD_IDS = Object.keys(JUMP_FIELDS);
/** Simple shows the first two, Basic the first seven, Developer every field (Administrator too). */
export const JUMP_FIELD_LEVELS = { location: 'simple', display: 'simple', variant: 'basic', size: 'basic', density: 'basic', sticky: 'basic', collapsible: 'basic', collapsed: 'developer', spy: 'developer', smooth: 'developer', overflow: 'developer', offset: 'developer' };

/** Per-menu overrides: `menu.<menu id>.<field>` (a field of JUMP_FIELDS) or `menu.<menu id>.asset` (the asset that menu uses). */
export const JUMP_MENU_PREFIX = 'menu.';
export const JUMP_ASSET_FIELD = 'asset';
/** Shape of a menu id (`plan-studio.plan`, `settings.plugins`) and of an asset id (asset@1 envelope ids). */
export const JUMP_MENU_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const ASSET_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SECTION_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
export const JUMP_SECTIONS_MAX = 64;
export const JUMP_LABEL_MAX = 60;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `menu.<id>.<field>` → { menu, field } (field may be `asset`), or null when the path isn't one. */
export function jumpMenuPath(path) {
  if (typeof path !== 'string' || !path.startsWith(JUMP_MENU_PREFIX)) return null;
  const rest = path.slice(JUMP_MENU_PREFIX.length);
  const i = rest.lastIndexOf('.');
  if (i <= 0) return null;
  const menu = rest.slice(0, i); const field = rest.slice(i + 1);
  if (!JUMP_MENU_ID.test(menu)) return null;
  if (field !== JUMP_ASSET_FIELD && !JUMP_FIELDS[field]) return null;
  return { menu, field };
}

/** A field's value, normalized against its spec (or undefined when it doesn't fit). `menu.<id>.asset` takes an asset id. */
export function jumpFieldValue(path, v) {
  const mp = jumpMenuPath(path);
  if (mp) {
    if (mp.field === JUMP_ASSET_FIELD) return typeof v === 'string' && ASSET_ID.test(v) ? v : undefined;
    return jumpFieldValue(mp.field, v);
  }
  const f = JUMP_FIELDS[path];
  if (!f) return undefined;
  switch (f.kind) {
    case 'enum': { const s = typeof v === 'number' ? String(v) : v; return f.options.includes(s) ? s : undefined; }
    case 'number': { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(f.max, Math.max(f.min, n))) : undefined; }
    case 'boolean': return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
    default: return undefined;
  }
}

/** One section entry, cleaned (id, label, optional icon), or null. */
export function jumpSection(raw) {
  if (!isObj(raw) || typeof raw.id !== 'string' || !SECTION_ID.test(raw.id)) return null;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, JUMP_LABEL_MAX) : raw.id;
  const out = { id: raw.id, label };
  if (typeof raw.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.icon)) out.icon = raw.icon;
  return out;
}

/** A list of sections, cleaned (bad ones dropped, duplicate ids dropped, at most JUMP_SECTIONS_MAX). */
export function jumpSections(raw) {
  const out = []; const seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) { const s = jumpSection(r); if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); } if (out.length >= JUMP_SECTIONS_MAX) break; }
  return out;
}

/** Every field filled in (defaults for missing or malformed ones), plus the asset's own fixed `sections` (usually none: the page supplies them). */
export function normalizeJumpMenu(raw) {
  const out = {};
  for (const [id, f] of Object.entries(JUMP_FIELDS)) { const v = jumpFieldValue(id, isObj(raw) ? raw[id] : undefined); out[id] = v === undefined ? f.default : v; }
  if (!out.collapsible) out.collapsed = false; // folded only makes sense with a fold
  out.sections = jumpSections(isObj(raw) ? raw.sections : undefined);
  return out;
}

export function jumpFieldHint(f) {
  switch (f.kind) {
    case 'enum': return `one of ${f.options.join(', ')}`;
    case 'number': return `a number ${f.min}..${f.max}${f.unit ? ` (${f.unit})` : ''}`;
    case 'boolean': return 'true or false';
    default: return 'a value';
  }
}

/** Validator errors for a jump-menu asset's data (unknown fields are kept out, never an error). */
export function jumpMenuErrors(raw) {
  if (!isObj(raw)) return ['data must be an object'];
  const errs = [];
  for (const [id, f] of Object.entries(JUMP_FIELDS)) {
    const v = raw[id];
    if (v === undefined) continue;
    if (jumpFieldValue(id, v) === undefined) errs.push(`${id}: ${jumpFieldHint(f)}`);
    else if (f.kind === 'number' && (v < f.min || v > f.max)) errs.push(`${id}: ${jumpFieldHint(f)}`);
  }
  if (raw.sections !== undefined) {
    if (!Array.isArray(raw.sections)) errs.push('sections: a list of { id, label, icon? }');
    else {
      raw.sections.forEach((s, i) => { if (!jumpSection(s)) errs.push(`sections[${i}]: needs an id (letters, digits, . _ : -) and a label`); });
      const ids = raw.sections.map((s) => (isObj(s) ? s.id : undefined)).filter((x) => typeof x === 'string');
      if (new Set(ids).size !== ids.length) errs.push('sections: ids must be unique');
      if (raw.sections.length > JUMP_SECTIONS_MAX) errs.push(`sections: at most ${JUMP_SECTIONS_MAX}`);
    }
  }
  return errs;
}

/** Errors for one field set through control@1 (`tokens.jump <path> <value>`; `menu.<id>.<field>` and `menu.<id>.asset` included). */
export function jumpFieldErrors(path, value) {
  const mp = jumpMenuPath(path);
  if (mp) {
    if (mp.field === JUMP_ASSET_FIELD) return jumpFieldValue(path, value) === undefined ? ['value must be a jump-menu asset id'] : [];
    return jumpFieldErrors(mp.field, value);
  }
  if (typeof path === 'string' && path.startsWith(JUMP_MENU_PREFIX)) return [`unknown jump-menu path ${path} (menu.<menu id>.<field> or menu.<menu id>.asset)`];
  const f = JUMP_FIELDS[path];
  if (!f) return [`unknown jump-menu field ${path}`];
  if (jumpFieldValue(path, value) === undefined) return [`value must be ${jumpFieldHint(f)}`];
  if (f.kind === 'number' && (Number(value) < f.min || Number(value) > f.max)) return [`value must be ${jumpFieldHint(f)}`];
  return [];
}

/**
 * The fields in force for one menu: the asset's data, then the app-wide overrides (`<field>`), then that menu's own
 * (`menu.<id>.<field>`). `overrides` is the flat map control-tokens.mjs resolves (effectiveTokenOverrides). Also
 * answers which asset id the menu asked for (`menu.<id>.asset`), or null for the app's slot.
 */
export function jumpConfig(assetData, overrides, menuId) {
  const o = isObj(overrides) ? overrides : {};
  const base = normalizeJumpMenu(assetData);
  const merged = { ...(isObj(assetData) ? assetData : {}) };
  for (const id of JUMP_FIELD_IDS) { const v = jumpFieldValue(id, o[id]); if (v !== undefined) merged[id] = v; }
  let asset = null;
  if (typeof menuId === 'string' && JUMP_MENU_ID.test(menuId)) {
    for (const id of JUMP_FIELD_IDS) { const v = jumpFieldValue(`${JUMP_MENU_PREFIX}${menuId}.${id}`, o[`${JUMP_MENU_PREFIX}${menuId}.${id}`]); if (v !== undefined) merged[id] = v; }
    const a = jumpFieldValue(`${JUMP_MENU_PREFIX}${menuId}.${JUMP_ASSET_FIELD}`, o[`${JUMP_MENU_PREFIX}${menuId}.${JUMP_ASSET_FIELD}`]);
    if (a !== undefined) asset = a;
  }
  const out = normalizeJumpMenu(merged);
  out.sections = base.sections;
  return { config: out, asset };
}

/** Which override a field in force came from: 'menu' (that menu's own), 'app' (app-wide), or 'asset' (the asset's value). */
export function jumpFieldSource(overrides, menuId, field) {
  const o = isObj(overrides) ? overrides : {};
  if (menuId && jumpFieldValue(`${JUMP_MENU_PREFIX}${menuId}.${field}`, o[`${JUMP_MENU_PREFIX}${menuId}.${field}`]) !== undefined) return 'menu';
  if (jumpFieldValue(field, o[field]) !== undefined) return 'app';
  return 'asset';
}

/** The control@1 token list for `tokens.jump` (id, kind, options). Per-menu paths are open-ended and checked by shape. */
export function jumpMenuTokens() {
  return Object.entries(JUMP_FIELDS).map(([id, f]) => ({ id, kind: f.kind === 'number' ? 'number' : f.kind === 'boolean' ? 'boolean' : 'enum', ...(f.kind === 'enum' ? { options: f.options } : {}), ...(f.kind === 'number' ? { min: f.min, max: f.max } : {}), default: f.default }));
}

/** JSON schema properties for the generated schema (schemas/json/jump-menu.schema.json). */
export function jumpMenuSchemaProperties() {
  const props = {};
  for (const [id, f] of Object.entries(JUMP_FIELDS)) {
    props[id] = { ...(f.kind === 'number' ? { type: 'number', minimum: f.min, maximum: f.max } : f.kind === 'boolean' ? { type: 'boolean' } : { enum: f.options }), default: f.default };
  }
  props.sections = { type: 'array', maxItems: JUMP_SECTIONS_MAX, items: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: SECTION_ID.source }, label: { type: 'string', maxLength: JUMP_LABEL_MAX }, icon: { type: 'string' } } } };
  return props;
}
