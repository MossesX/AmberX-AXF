/**
 * AmberX AXF build engine — programmatic API.
 * The CLI (frame.mjs) is a thin wrapper; the same functions can be driven
 * from an HTTP API, a browser UI, an SSH session or an MCP server.
 */
import { installLibrary } from './libraries.mjs';
import { brandAssetErrors } from '../core/engines/brand-rules.mjs';
import { isScaleType, scaleErrors, scaleSchemaProperties } from '../core/engines/scale-rules.mjs';
import { AGENT_CARD_TYPE, agentCardErrors, agentCardSchemaProperties } from '../core/engines/agent-card-rules.mjs';
import { JOB_TYPE, jobTypeErrors, jobTypeSchemaProperties } from '../core/engines/job-type-rules.mjs';
import { jsonSchemas as uiReviewJsonSchemas, REGISTRY as UI_REVIEW_REGISTRY } from '../core/ui-review-schema.mjs';
import { createHash } from 'node:crypto';
import { applyOptions, readOptions, resolveOptions } from './build-options.mjs';
import { enforceDefaults } from './build-defaults.mjs';
import { PROJECT_MANIFEST_FILE, checkProject, requireProject } from './project.mjs';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export const spec = readJson(join(FRAMEWORK_DIR, 'schemas/asset-types.json'));
/** Port-specific asset types (android first) layered on the shared spec. They are optional slots: validation never requires them. */
const ANDROID_SPEC = join(FRAMEWORK_DIR, 'schemas/asset-types.android.json');
if (existsSync(ANDROID_SPEC)) {
  for (const [id, t] of Object.entries(readJson(ANDROID_SPEC).types)) spec.types[id] ??= { ...t, optional: true };
}
export const structure = readJson(join(FRAMEWORK_DIR, 'schemas/app-structure.json'));

/* ------------------------------------------------------------------ */
/* templates — each template dir carries a template.json describing     */
/* what to bake, where assets go and the app structure it produces      */
/* ------------------------------------------------------------------ */

export function listTemplates() {
  const dir = join(FRAMEWORK_DIR, 'templates');
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'template.json'))).map((d) => ({ id: d, ...readJson(join(dir, d, 'template.json')) }));
}

export function templateInfo(id) {
  const file = join(FRAMEWORK_DIR, 'templates', id, 'template.json');
  if (!existsSync(file)) throw new Error(`Unknown template "${id}". Templates: ${listTemplates().map((t) => t.id).join(', ')}`);
  const t = readJson(file);
  return {
    id,
    label: t.label ?? id,
    kind: t.kind ?? 'app',
    targets: t.targets ?? ['web'],
    bake: t.bake ?? [],
    bakeInto: t.bakeInto ?? 'src/axf',
    assetsDir: t.assetsDir ?? 'src/assets',
    structure: t.structure ?? structure.entries,
    tokens: t.tokens ?? {},
    /** extra asset folders (relative to framework/) merged on top of framework/assets — port-specific types live there */
    extraAssets: t.extraAssets ?? [],
    next: t.next ?? '',
  };
}
export const defaults = readJson(join(FRAMEWORK_DIR, 'defaults.json'));
/** Non-slot defaults for every new app (framework/app-defaults.json, app-defaults@1): `hidden` = chrome hidden by default. */
export const appDefaults = (() => { const f = join(FRAMEWORK_DIR, 'app-defaults.json'); return existsSync(f) ? readJson(f) : { hidden: [] }; })();
export const FRAMEWORK_VERSION = spec.frameworkVersion;

/** Directories of the framework that the react-ts template bakes into every new app (template.json → bake). */
const BAKED = ['core', 'react', 'ui', 'schemas'];

/* ------------------------------------------------------------------ */
/* validation — mirrors core/validate.ts, driven by the same spec      */
/* ------------------------------------------------------------------ */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateAsset(raw) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ['Asset must be a JSON object'] };
  for (const k of spec.envelope.required) if (!(k in raw)) errors.push(`Missing envelope field "${k}"`);
  if (raw.$axf !== spec.envelope.frame) errors.push(`"$axf" must be "${spec.envelope.frame}"`);
  const ts = spec.types[raw.type];
  if (!ts) return { ok: false, errors: [...errors, `Unknown asset type "${raw.type}"`] };
  if (typeof raw.id !== 'string' || !new RegExp(spec.envelope.idPattern).test(raw.id)) errors.push(`"id" must match ${spec.envelope.idPattern}`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('"name" must be a non-empty string');
  if (!isObj(raw.data)) return { ok: false, errors: [...errors, '"data" must be an object'] };
  for (const k of ts.required) if (!(k in raw.data)) errors.push(`data.${k} is required for ${raw.type}`);
  for (const [k, allowed] of Object.entries(ts.enums ?? {})) {
    if (k in raw.data && !allowed.includes(raw.data[k])) errors.push(`data.${k} must be one of: ${allowed.join(', ')}`);
  }
  for (const [k, keys] of Object.entries(ts.nested ?? {})) {
    if (isObj(raw.data[k])) for (const nk of keys) if (!(nk in raw.data[k])) errors.push(`data.${k}.${nk} is required`);
  }
  if (raw.type === 'layout' && 'slots' in raw.data) errors.push(...validateSlots(raw.data.slots));
  if (raw.type === 'layout' && 'repeat' in raw.data) errors.push(...validateRepeat(raw.data.repeat));
  if (raw.type === 'app-menu' && Array.isArray(raw.data.menus)) {
    raw.data.menus.forEach((m, i) => {
      if (!isObj(m)) return;
      if ('order' in m && (typeof m.order !== 'number' || !Number.isFinite(m.order))) errors.push(`data.menus[${i}].order must be a number`);
      if ('items' in m) errors.push(...validateMenuItems(m.items, `data.menus[${i}].items`));
    });
  }
  if (raw.type === 'context-menu' && isObj(raw.data.targets)) {
    for (const [t, items] of Object.entries(raw.data.targets)) errors.push(...validateMenuItems(items, `data.targets.${t}`));
  }
  // design-package@1 — mirrors designPackageErrors in core/engines/designpackage.ts (theme ids + extras slot rules)
  if (raw.type === 'design-package') {
    const ID = /^[a-z0-9][a-z0-9-]*$/;
    for (const t of DESIGN_THEMES) if (typeof raw.data[t] !== 'string' || !ID.test(raw.data[t])) errors.push(`data.${t} must be a ${t} asset id`);
    const x = raw.data.extras;
    if ('extras' in raw.data && !isObj(x)) errors.push('data.extras must be an object');
    if (isObj(x)) {
      if ('slots' in x && !isObj(x.slots)) errors.push('data.extras.slots must be an object (asset type → asset id)');
      if (isObj(x.slots)) for (const [t, id] of Object.entries(x.slots)) {
        if (DESIGN_THEMES.includes(t)) errors.push(`data.extras.slots.${t}: ${t} is one of the package's own themes`);
        else if (['uac-policy', 'design-package', 'appearance-package'].includes(t)) errors.push(`data.extras.slots.${t}: a package never sets ${t}`);
        else if (typeof id !== 'string' || !ID.test(id)) errors.push(`data.extras.slots.${t} must be an asset id`);
      }
      if ('spacing' in x && !['tight', 'compact', 'regular'].includes(x.spacing)) errors.push('data.extras.spacing must be tight, compact or regular');
    }
  }
  // style-package@1 — mirrors stylePackageErrors in core/engines/stylepackage.ts (check-style-packages.mts keeps them equal)
  if (raw.type === 'style-package') {
    const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
    const MEMBERS = spec.types['style-package']?.members ?? [];
    const d = raw.data;
    if (!isObj(d.slots)) errors.push('data.slots must be an object of control type → asset id');
    else {
      const entries = Object.entries(d.slots);
      if (!entries.length) errors.push('data.slots must name at least one control');
      for (const [t, id] of entries) {
        if (!MEMBERS.includes(t)) errors.push(`data.slots.${t}: not a style-package member (${MEMBERS.join(', ')})`);
        else if (typeof id !== 'string' || !ID.test(id)) errors.push(`data.slots.${t} must be an asset id`);
      }
    }
    if ('tone' in d && (typeof d.tone !== 'string' || !/^[a-z][a-z-]{1,23}$/.test(d.tone))) errors.push('data.tone must be one lowercase word');
  }
  // interface@1 — mirrors interfaceErrors in core/engines/interface.ts (check-interface.mts keeps them equal)
  if (raw.type === 'interface') {
    const ID = /^[a-z0-9][a-z0-9-]*$/;
    const NEVER = ['uac-policy', 'interface', 'design-package', 'appearance-package', ...DESIGN_THEMES];
    const d = raw.data;
    if (typeof d.design !== 'string' || !ID.test(d.design)) errors.push('data.design must be a design-package asset id');
    if (d.branding !== undefined && (typeof d.branding !== 'string' || !ID.test(d.branding))) errors.push('data.branding must be a branding asset id');
    if (d.slots !== undefined) {
      if (!isObj(d.slots)) errors.push('data.slots must be an object (asset type → asset id)');
      else for (const [t, v] of Object.entries(d.slots)) {
        if (NEVER.includes(t)) errors.push(`data.slots.${t}: ${DESIGN_THEMES.includes(t) ? 'the themes come from the design package' : `an interface never sets ${t}`}`);
        else if (!ID.test(t)) errors.push(`data.slots.${t}: not an asset type name`);
        else if (typeof v !== 'string' || !ID.test(v)) errors.push(`data.slots.${t} must be an asset id`);
      }
    }
    if (d.spacing !== undefined && !['tight', 'compact', 'regular'].includes(d.spacing)) errors.push('data.spacing must be tight, compact or regular');
    if (d.hidden !== undefined && (!isObj(d.hidden) || Object.values(d.hidden).some((v) => typeof v !== 'boolean'))) errors.push('data.hidden must map asset types to true / false');
    if (d.settings !== undefined && !isObj(d.settings)) errors.push('data.settings must be an object');
    if (d.tab !== undefined && (!isObj(d.tab) || typeof d.tab.label !== 'string')) errors.push('data.tab must be { label, icon? }');
  }
  // behavior-theme@1 — mirrors behaviorErrors in core/engines/behavior.ts (check-design-package.mts keeps the lists equal)
  if (raw.type === 'behavior-theme') errors.push(...behaviorErrors(raw.data));
  // typography@1 / density@1 / sizing@1: ONE validator shared with core (core/engines/scale-rules.mjs)
  errors.push(...scaleErrors(raw.type, raw.data));
  // agent-card@1: ONE validator shared with core (core/engines/agent-card-rules.mjs)
  errors.push(...agentCardErrors(raw.type, raw.data));
  // job-type@1: ONE validator shared with core (core/engines/job-type-rules.mjs)
  errors.push(...jobTypeErrors(raw.type, raw.data));
  // brand types (logo-mark, animated-logo, icon-pack, branding): ONE validator shared with core (core/engines/brand-rules.mjs)
  errors.push(...(brandAssetErrors(raw.type, raw.data) ?? []));
  const host = hostSpec(raw.type);
  if (host && host.field in raw.data) errors.push(...validateHostAttachments(raw.type, raw.data[host.field]));
  if (raw.type === 'uac-policy' && Array.isArray(raw.data.roles) && !raw.data.roles.some((r) => r.id === raw.data.defaultRole)) {
    errors.push('data.defaultRole must reference a role id');
  }
  return { ok: errors.length === 0, errors };
}

/* behavior-theme@1 + design-package@1 — mirrors core/engines/behavior.ts and designpackage.ts (kept equal by check-design-package.mts). */
export const DESIGN_THEMES = ['style-theme', 'color-theme', 'layout', 'behavior-theme'];
export const BEHAVIOR_ENUMS = {
  'motion.speed': ['theme', 'instant', 'fast', 'normal', 'slow', 'relaxed'],
  'motion.easing': ['standard', 'emphasized', 'linear', 'spring', 'bounce'],
  'motion.reduced': ['system', 'always', 'never'],
  'motion.entrance': ['theme', 'none', 'fade', 'rise', 'scale'],
  'interaction.hover': ['theme', 'none', 'tint', 'lift', 'glow', 'underline'],
  'interaction.press': ['theme', 'none', 'shrink', 'darken', 'ripple'],
  'interaction.focusRing': ['auto', 'always', 'never'],
  'interaction.cursor': ['auto', 'pointer'],
  'windows.dialogOpen': ['asset', 'none', 'fade', 'scale', 'slide-up', 'slide-down'],
  'windows.backdrop': ['asset', 'dim', 'blur', 'none'],
  'windows.popupOpen': ['asset', 'none', 'fade', 'scale', 'slide'],
  'windows.drawerOpen': ['asset', 'slide', 'fade', 'none'],
  'windows.stack': ['cascade', 'center', 'remember'],
  'windows.minimize': ['cursor', 'dock', 'none'],
  'feedback.toastPosition': ['asset', 'top', 'bottom', 'top-right', 'bottom-right', 'top-left', 'bottom-left'],
  'feedback.sound': ['off', 'subtle', 'full'],
  'feedback.vibration': ['off', 'light', 'strong'],
  'feedback.confirmDelete': ['always', 'risky', 'never'],
};
export const BEHAVIOR_RANGES = {
  'interaction.longPressMs': [250, 1500],
  'interaction.doubleTapMs': [150, 700],
  'interaction.dragThreshold': [0, 24],
  'windows.snapGrid': [0, 48],
  'feedback.toastMs': [0, 20000],
};
export const BEHAVIOR_SWITCHES = ['windows.snap', 'windows.closeOnBackdrop', 'windows.closeOnEscape', 'feedback.busyCursor'];
function behaviorErrors(data) {
  if (!isObj(data)) return ['data must be an object'];
  const errors = [];
  const grp = (g) => (isObj(data[g]) ? data[g] : {});
  for (const g of ['motion', 'interaction', 'windows', 'feedback']) if (g in data && !isObj(data[g])) errors.push(`data.${g} must be an object`);
  for (const [path, allowed] of Object.entries(BEHAVIOR_ENUMS)) {
    const [g, f] = path.split('.');
    if (f in grp(g) && !allowed.includes(grp(g)[f])) errors.push(`data.${path} must be one of ${allowed.join(', ')}`);
  }
  for (const [path, [min, max]] of Object.entries(BEHAVIOR_RANGES)) {
    const [g, f] = path.split('.');
    const v = grp(g)[f];
    if (f in grp(g) && (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)) errors.push(`data.${path} must be a number from ${min} to ${max}`);
  }
  for (const path of BEHAVIOR_SWITCHES) {
    const [g, f] = path.split('.');
    if (f in grp(g) && typeof grp(g)[f] !== 'boolean') errors.push(`data.${path} must be true or false`);
  }
  return errors;
}

/* Menu items — mirrors validateMenuItems / parseChecked in core/engines/appmenu.ts (asset-types.json → menuItems). */
/** JSON Schema of one menu item (recursive through `items`), for the generated editor schemas. */
export function menuItemSchema() {
  return {
    type: 'object', required: ['id'],
    properties: {
      id: { type: 'string' }, label: { type: 'string' }, icon: { type: 'string' }, action: { type: 'string' }, shortcut: { type: 'string' }, requires: { type: 'string' },
      separator: { type: 'boolean' }, items: { type: 'array', items: { $ref: '#/$defs/menuItem' } },
      provider: { type: 'string', minLength: 1, description: MENU_SPEC.optional_fields.provider },
      badge: { type: 'string', minLength: 1, description: MENU_SPEC.optional_fields.badge },
      checked: { type: 'string', pattern: `^(${MENU_SPEC.checkedKinds.join('|')}):.+$`, description: MENU_SPEC.optional_fields.checked },
      order: { type: 'number', description: MENU_SPEC.optional_fields.order },
      before: { type: 'string', minLength: 1 }, after: { type: 'string', minLength: 1 },
    },
  };
}
const MENU_SPEC = spec.menuItems;
export function parseChecked(binding) {
  if (typeof binding !== 'string') return null;
  const i = binding.indexOf(':');
  if (i <= 0) return null;
  const kind = binding.slice(0, i);
  const ref = binding.slice(i + 1);
  return MENU_SPEC.checkedKinds.includes(kind) && ref ? { kind, ref } : null;
}
export function validateMenuItems(items, path, depth = 0) {
  if (!Array.isArray(items)) return [`${path} must be a list of menu items`];
  const errors = [];
  items.forEach((o, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(o)) { errors.push(`${p} must be a menu item object`); return; }
    for (const k of ['provider', 'badge', 'before', 'after']) if (k in o && (typeof o[k] !== 'string' || !o[k])) errors.push(`${p}.${k} must be a non-empty string`);
    if ('checked' in o && (typeof o.checked !== 'string' || !parseChecked(o.checked))) errors.push(`${p}.checked must be one of: ${MENU_SPEC.checkedKinds.map((k) => `${k}:<ref>`).join(', ')}`);
    if ('order' in o && (typeof o.order !== 'number' || !Number.isFinite(o.order))) errors.push(`${p}.order must be a number`);
    if ('provider' in o && 'items' in o) errors.push(`${p} has both provider and items (a live list fills its own)`);
    if ('items' in o) {
      if (depth + 1 >= MENU_SPEC.maxDepth) errors.push(`${p}.items is deeper than ${MENU_SPEC.maxDepth} levels`);
      else errors.push(...validateMenuItems(o.items, `${p}.items`, depth + 1));
    }
  });
  return errors;
}

/* Widget hosts — mirrors hostSpec / validateHostAttachments in core/engines/widgets.ts (banner.attach, toolbar.widgets). */
const WIDGET_TYPES = Object.keys(spec.types).filter((t) => spec.types[t].widget === true);
const ATTACHABLE_TYPES = Object.keys(spec.types).filter((t) => spec.types[t].attachable === true);
export function hostSpec(type) {
  const t = spec.types[type];
  if (!t) return undefined;
  if (t.attach) return { host: type, field: 'attach', types: t.attach.types ?? ATTACHABLE_TYPES, sides: t.attach.sides ?? [] };
  if (t.widgets) return { host: type, field: 'widgets', types: WIDGET_TYPES, sides: t.widgets.sides ?? [] };
  return undefined;
}
export function validateHostAttachments(type, list) {
  const h = hostSpec(type);
  if (!h) return [];
  if (!Array.isArray(list)) return [`data.${h.field} must be a list`];
  const errors = [];
  list.forEach((a, i) => {
    const p = `data.${h.field}[${i}]`;
    if (!isObj(a)) { errors.push(`${p} must be an object {type, id, at}`); return; }
    if (typeof a.type !== 'string' || !h.types.includes(a.type)) errors.push(`${p}.type must be one of: ${h.types.join(', ')}`);
    if (typeof a.id !== 'string' || !a.id) errors.push(`${p}.id must be an asset id`);
    if (typeof a.at !== 'string' || !h.sides.includes(a.at)) errors.push(`${p}.at must be one of: ${h.sides.join(', ')}`);
    if ('order' in a && (typeof a.order !== 'number' || !Number.isFinite(a.order))) errors.push(`${p}.order must be a number`);
  });
  return errors;
}

/** Layout slot contract — mirrors validateSlots in core/validate.ts. */
export function validateSlots(slots) {
  const regions = spec.types.layout.slots.regions;
  if (!isObj(slots)) return ['data.slots must be an object'];
  const errors = [];
  for (const [r, types] of Object.entries(slots)) {
    if (!regions.includes(r)) { errors.push(`data.slots.${r} is not a layout region (one of: ${regions.join(', ')})`); continue; }
    if (!Array.isArray(types)) { errors.push(`data.slots.${r} must be a list of asset types`); continue; }
    for (const t of types) if (typeof t !== 'string' || !spec.types[t]) errors.push(`data.slots.${r} accepts unknown asset type "${String(t)}"`);
  }
  return errors;
}

/** Repeating slots (layout.repeat); same messages as validateRepeat in core/validate.ts and AssetValidator.kt. */
export function validateRepeat(repeat) {
  const { slots: { regions }, repeat: { styles, maxColumns } } = spec.types.layout;
  if (!Array.isArray(repeat)) return ['data.repeat must be a list of repeating slots'];
  const errors = [];
  const seen = new Set();
  const whole = (v, min, max = Infinity) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  repeat.forEach((r, i) => {
    const at = `data.repeat[${i}]`;
    if (!isObj(r)) { errors.push(`${at} must be an object`); return; }
    if (typeof r.id !== 'string' || !r.id.trim()) errors.push(`${at}.id must be a non-empty string`);
    else if (seen.has(r.id)) errors.push(`${at}.id "${r.id}" is used twice`);
    else seen.add(r.id);
    if (typeof r.dataSet !== 'string' || !r.dataSet.trim()) errors.push(`${at}.dataSet must be a non-empty string`);
    if ('region' in r && !regions.includes(r.region)) errors.push(`${at}.region is not a layout region (one of: ${regions.join(', ')})`);
    if ('style' in r && !styles.includes(r.style)) errors.push(`${at}.style must be one of: ${styles.join(', ')}`);
    if ('columns' in r && !whole(r.columns, 1, maxColumns)) errors.push(`${at}.columns must be a whole number from 1 to ${maxColumns}`);
    if ('max' in r && !whole(r.max, 0)) errors.push(`${at}.max must be a whole number, 0 or more`);
    if ('fallback' in r) {
      const f = r.fallback;
      if (!isObj(f)) errors.push(`${at}.fallback must be an object`);
      else {
        if ('type' in f && (typeof f.type !== 'string' || !spec.types[f.type])) errors.push(`${at}.fallback.type is unknown asset type "${String(f.type)}"`);
        if ('id' in f && typeof f.id !== 'string') errors.push(`${at}.fallback.id must be a string`);
        if ('label' in f && typeof f.label !== 'string') errors.push(`${at}.fallback.label must be a string`);
      }
    }
  });
  return errors;
}

/** Load every *.json asset under a directory (expects <dir>/<type>/<id>.json). */
/**
 * Framework assets a new app can start from, per asset type: [{ id, name, description }]. Includes the
 * template's extra assets (e.g. android/assets for Android apps) when a template is given.
 */
export function listFrameworkAssets(template) {
  const dirs = [join(FRAMEWORK_DIR, 'assets')];
  if (template) for (const extra of templateInfo(template).extraAssets) dirs.push(join(FRAMEWORK_DIR, extra));
  const out = {};
  for (const d of dirs) for (const a of loadAssets(d)) {
    if (!a.result.ok || !a.raw) continue;
    (out[a.raw.type] ??= []).push({ id: a.raw.id, name: a.raw.name ?? a.raw.id, description: a.raw.description ?? '' });
  }
  for (const t of Object.keys(out)) out[t].sort((x, y) => x.name.localeCompare(y.name));
  return out;
}

/** Default-asset picks for `init` ({ type: id }): every pick must name an asset the new app will actually ship. */
export function checkSlotPicks(slots, template, designed = []) {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) throw new Error('slots must be an object of { assetType: assetId }');
  const known = listFrameworkAssets(template);
  const out = {};
  for (const [type, id] of Object.entries(slots)) {
    if (id === undefined || id === null || id === '') continue;
    if (typeof id !== 'string') throw new Error(`slots.${type} must be an asset id`);
    if (!known[type] && !spec.types[type]) throw new Error(`slots: unknown asset type "${type}"`);
    if (!(known[type] ?? []).some((a) => a.id === id) && !designed.some((a) => a.type === type && a.id === id)) throw new Error(`slots: no ${type} asset "${id}"`);
    out[type] = id;
  }
  return out;
}

export function loadAssets(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const type of readdirSync(dir)) {
    const tdir = join(dir, type);
    if (!statSync(tdir).isDirectory()) continue;
    for (const f of readdirSync(tdir).filter((f) => f.endsWith('.json'))) {
      const file = join(tdir, f);
      let raw;
      try {
        raw = readJson(file);
      } catch (e) {
        out.push({ file, raw: null, result: { ok: false, errors: [`Invalid JSON: ${e.message}`] } });
        continue;
      }
      const result = validateAsset(raw);
      if (result.ok && raw.type !== type) result.errors.push(`File is in "${type}/" but declares type "${raw.type}"`);
      if (result.ok && raw.id !== basename(f, '.json')) result.errors.push(`File name should be "${raw.id}.json"`);
      result.ok = result.errors.length === 0;
      out.push({ file, raw, result });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
const TEXT = /(\.(json|tsx?|jsx?|mjs|css|html|md|txt|gitignore|kts?|xml|pro|properties|toml|sh|py|ya?ml)|(^|[\\/])Dockerfile)$/;

/** Token values are free text (an app named "Notes & Todo"): escape them for the file they land in, so the generated
 * app still compiles. Android string resources: XML entities + Android's own quote rules; Kotlin/Java string literals:
 * backslash, quote and `$` (template strings); JSON is written by the engine itself, not through tokens. */
export function tokenEscaper(file) {
  if (/\.xml$/i.test(file)) return (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/^@/, '\\@').replace(/^\?/, '\\?');
  if (/\.(kt|kts|java)$/i.test(file)) return (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\r?\n/g, ' ');
  return (v) => v;
}

const ktStr = (v) => tokenEscaper('x.kt')(String(v ?? ''));

function copyTemplate(src, dest, tokens) {
  for (const file of walk(src)) {
    // `src/main/kotlin/app/…` in a template lands at the app's real package path.
    const rel = relative(src, file).replace(/^_(gitignore|dockerignore)$/, '.$1').replace(/^(app\/src\/main\/kotlin\/)app\//, (_, pre) => pre + (tokens.APPLICATION_ID ?? 'app').replace(/\./g, '/') + '/');
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true });
    if (TEXT.test(file) || basename(file).startsWith('_')) {
      let text = readFileSync(file, 'utf8');
      const esc = tokenEscaper(file);
      for (const [k, v] of Object.entries(tokens)) text = text.replaceAll(`{{${k}}}`, esc(String(v)));
      writeFileSync(target, text);
    } else cpSync(file, target);
  }
}

export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'axf-app';

/* ------------------------------------------------------------------ */
/* init                                                                */
/* ------------------------------------------------------------------ */

/**
 * Initialize a new AmberX AXF app: copy the template, bake the framework runtime
 * and every starter asset into it, write the manifest and lock file, then
 * validate the result. Every app starts from the exact same asset set, so
 * apps left on defaults look identical.
 */
/**
 * Designed assets an app ships with (Build Pilot's banner / toolbar designers, …): asset@1 documents written into the
 * app's own assets folder before the slot picks are checked, so a pick may name one of them. Each is validated like a
 * framework asset; ids must not collide with a framework starter of the same type.
 */
export function checkDesignedAssets(assets) {
  if (assets === undefined || assets === null) return [];
  if (!Array.isArray(assets) || assets.length > 40) throw new Error('assets must be a list of up to 40 asset@1 documents');
  const seen = new Set();
  return assets.map((raw, i) => {
    const r = validateAsset(raw);
    if (!r.ok) throw new Error(`assets[${i}]: ${r.errors.join('; ')}`);
    const key = `${raw.type}/${raw.id}`;
    if (seen.has(key)) throw new Error(`assets[${i}]: ${key} is listed twice`);
    seen.add(key);
    if (existsSync(join(FRAMEWORK_DIR, 'assets', raw.type, `${raw.id}.json`))) throw new Error(`assets[${i}]: ${key} is a framework starter; give the designed asset its own id`);
    if (JSON.stringify(raw).length > 200_000) throw new Error(`assets[${i}]: ${key} is over 200 KB`);
    return raw;
  });
}

/** The hub's https origin (http only for localhost): a plain origin, no path, no credentials. */
export function hubOrigin(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '10.0.2.2';
  if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null;
  return u.origin;
}

/** Developer app flag (`--developer [hub]`, manifest `developer: { hub }`): true = the default hub; a string = that hub; off = none. */
export const DEFAULT_HUB = 'https://axhub.amberxai.com';
export function resolveDeveloper(v) {
  if (v === undefined || v === null || v === false || v === 'off' || v === '') return null;
  if (v === true || v === 'on') return { hub: DEFAULT_HUB };
  const raw = typeof v === 'object' ? v.hub : v;
  const hub = hubOrigin(raw);
  if (!hub) throw new Error(`developer: the hub must be an https origin, e.g. ${DEFAULT_HUB}`);
  return { hub };
}

/** Chrome hidden by default for a new app: the request's own list when given, else framework/app-defaults.json (+ the boilerplate's). */
export function resolveHidden(hidden, bp) {
  const list = hidden !== undefined && hidden !== null ? hidden : [...(appDefaults.hidden ?? []), ...(bp?.hidden ?? [])];
  if (!Array.isArray(list) || list.some((t) => typeof t !== 'string')) throw new Error('hidden must be a list of asset types');
  for (const t of list) if (!spec.types[t]?.hideable) throw new Error(`hidden: "${t}" is not a hideable type (${Object.keys(spec.types).filter((k) => spec.types[k].hideable).join(', ')})`);
  return [...new Set(list)];
}

export function init({ dir, name = 'AXF App', id, template = 'react-ts', targets, applicationId, modules = [], boilerplate, libraries = [], options = {}, slots = {}, hidden, assets: designedAssets, developer, project = {}, log = () => {} }) {
  const dev = resolveDeveloper(developer);
  const dest = resolve(dir);
  if (existsSync(dest) && readdirSync(dest).length) throw new Error(`Target directory is not empty: ${dest}`);
  const tpl = templateInfo(template);
  const tplDir = join(FRAMEWORK_DIR, 'templates', template);
  const appId = id ?? slugify(name);
  targets ??= tpl.targets;
  const pkg = applicationId ?? `ai.amberx.axf.${appId.replace(/-/g, '')}`;
  const bp = boilerplate ? loadBoilerplate(boilerplate) : null;
  const designed = checkDesignedAssets(designedAssets);
  const hiddenSlots = resolveHidden(hidden, bp);
  const picks = checkSlotPicks(slots, template, designed);
  if (bp) { modules = [...new Set([...modules, ...(bp.modules ?? [])])]; libraries = [...(bp.libraries ?? []).map((l) => (typeof l === 'string' ? { library: l } : l)), ...libraries]; }
  const tokens = { APP_NAME: name, APP_ID: appId, APPLICATION_ID: pkg, FRAMEWORK_VERSION, AXF_MODULES: JSON.stringify(modules), ...tpl.tokens };

  log(`• copying template "${template}"`);
  copyTemplate(tplDir, dest, tokens);
  const tplJson = join(dest, 'template.json');
  if (existsSync(tplJson)) rmSync(tplJson);

  let files = {};
  if (tpl.bake.length) {
    log(`• baking framework runtime into ${tpl.bakeInto}`);
    const frameDir = join(dest, tpl.bakeInto);
    for (const part of tpl.bake) cpSync(join(FRAMEWORK_DIR, part), join(frameDir, part), { recursive: true });
    files = Object.fromEntries(walk(frameDir).map((f) => [relative(dest, f), sha(f)]));
  }

  log(`• baking starter assets into ${tpl.assetsDir}`);
  const assets = loadAssets(join(FRAMEWORK_DIR, 'assets'));
  const bad = assets.filter((a) => !a.result.ok);
  if (bad.length) throw new Error(`Framework assets failed validation:\n${bad.map((b) => `  ${b.file}: ${b.result.errors.join('; ')}`).join('\n')}`);
  cpSync(join(FRAMEWORK_DIR, 'assets'), join(dest, tpl.assetsDir), { recursive: true });
  for (const extra of tpl.extraAssets) if (existsSync(join(FRAMEWORK_DIR, extra))) cpSync(join(FRAMEWORK_DIR, extra), join(dest, tpl.assetsDir), { recursive: true });
  if (designed.length) {
    log(`• writing ${designed.length} designed asset(s)`);
    for (const a of designed) {
      const d = join(dest, tpl.assetsDir, a.type);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, `${a.id}.json`), JSON.stringify(a, null, 2) + '\n');
    }
  }

  // Build options (--wrap-groups …): every option is written at its default unless given, so new builds
  // start from the registry defaults even when the framework's own starter assets differ.
  const buildOptions = resolveOptions(options);
  applyOptions(join(dest, tpl.assetsDir), buildOptions, log);

  log('• writing axf.manifest.json');
  const manifest = {
    $axf: 'manifest@1',
    app: { id: appId, name, version: '0.1.0' },
    framework: { version: FRAMEWORK_VERSION, template },
    initializedAt: new Date().toISOString(),
    targets,
    startView: bp?.screens?.[0]?.id ?? 'home',
    defaults: { ...defaults, ...(bp?.defaults ?? {}), ...picks },
    hidden: hiddenSlots,
    ...(dev ? { developer: dev } : {}),
    options: buildOptions,
    structure: tpl.structure.map(({ path, purpose }) => ({ path, purpose })),
  };
  if (bp) manifest.boilerplate = { id: bp.id, name: bp.name, category: bp.category, screens: bp.screens, features: bp.features ?? [] };
  if (targets.includes('android')) manifest.android = { applicationId: pkg, scheme: 'axf', modules, minSdk: 26, targetSdk: 35 };
  // The build engine's default rules for apps (build-defaults@1, kind "app"): filled here, refused when a rule requires more.
  const appDefaults = enforceDefaults('app', manifest, 'axf.manifest.json');
  Object.assign(manifest, appDefaults.value);
  for (const f of appDefaults.filled) log(`  build default: ${f.field} = ${JSON.stringify(f.value)} (${f.rule})`);
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(join(dest, 'axf.manifest.json'), manifestText);
  // Android apps also carry the manifest inside the APK assets so the kernel can read it at runtime.
  if (tpl.kind === 'android-app') {
    const inApk = join(dest, dirname(tpl.assetsDir), 'axf.manifest.json');
    mkdirSync(dirname(inApk), { recursive: true });
    writeFileSync(inApk, manifestText);
  }

  if (bp) applyBoilerplate(dest, tpl, bp, log);

  // Project manifest (project-manifest@1): every template ships one; fill in this app's identity and repo.
  // The build engine never loads or compiles a project without a validated manifest.
  log(`• writing ${PROJECT_MANIFEST_FILE}`);
  writeProjectManifest(dest, { name, appId, template, targets, project });

  // Pre-build configuration: libraries chosen in the console / boilerplate are installed with their parameters.
  const installed = [];
  for (const l of libraries) {
    log(`• installing library ${l.library}`);
    installed.push(installLibrary({ dir: dest, library: l.library, params: l.params ?? {}, log }));
  }

  log('• writing axf.lock.json');
  writeFileSync(join(dest, 'axf.lock.json'), JSON.stringify({ framework: FRAMEWORK_VERSION, template, files }, null, 2) + '\n');
  if (tpl.kind !== 'android-app') mkdirSync(join(dest, 'public'), { recursive: true });

  const report = validateApp(dest);
  if (!report.ok) throw new Error(`Initialized app failed validation:\n${report.errors.join('\n')}`);
  return { dir: dest, manifest: installed.length ? readJson(join(dest, 'axf.manifest.json')) : manifest, assets: assets.length, bakedFiles: Object.keys(files).length, libraries: installed.map((i) => ({ library: i.library, config: i.config })), report, next: tpl.next };
}

/** Where `dir` sits inside a git repo whose root has a project manifest: { repo: "owner/name", path }. */
function enclosingRepo(dir) {
  let d = dirname(dir);
  while (d !== dirname(d)) {
    const f = join(d, PROJECT_MANIFEST_FILE);
    if (existsSync(f) && existsSync(join(d, '.git'))) {
      try { const m = readJson(f); if (m.repo?.owner && m.repo?.name) return { repo: `${m.repo.owner}/${m.repo.name}`, path: relative(d, dir).split('\\').join('/') }; } catch { /* not readable */ }
    }
    d = dirname(d);
  }
  return null;
}

/**
 * Fills in the template's project.manifest.json (or writes one when a template has none). `project` overrides:
 * { name, displayName, description, kind, owner, repoName, repoExists, visibility, shared, platforms }.
 */
export function writeProjectManifest(dest, { name, appId, template, targets = [], project = {} }) {
  const file = join(dest, PROJECT_MANIFEST_FILE);
  const m = existsSync(file) ? readJson(file) : { $manifest: 'project-manifest@1', kind: 'app', status: 'active', version: '0.1.0', framework: { relation: 'built-on' }, repo: { host: 'github' }, data: { shared: [] } };
  const owner = project.owner ?? m.repo?.owner ?? 'MossesX';
  const repoName = project.repoName ?? appId;
  const exists = project.repoExists ?? false;
  const inside = enclosingRepo(dest);
  m.name = project.name ?? appId;
  m.displayName = project.displayName ?? name;
  m.description = project.description ?? m.description ?? '';
  if (project.kind) m.kind = project.kind;
  m.platforms = project.platforms ?? (targets.length ? targets.filter((t) => ['web', 'android', 'desktop', 'server', 'python', 'ios', 'cli'].includes(t)) : m.platforms);
  m.framework = { ...m.framework, relation: m.framework?.relation ?? 'built-on', version: FRAMEWORK_VERSION, template, appManifest: 'axf.manifest.json' };
  m.repo = { ...m.repo, host: m.repo?.host ?? 'github', owner, name: repoName, exists, visibility: project.visibility ?? m.repo?.visibility ?? 'private', ...(exists ? { url: `https://github.com/${owner}/${repoName}`, defaultBranch: 'main' } : {}) };
  if (!exists && m.repo.url) delete m.repo.url;
  m.location = inside ?? { repo: `${owner}/${repoName}`, path: '.' };
  m.data = { shared: project.shared ?? m.data?.shared ?? [] };
  m.owners = m.owners?.length ? m.owners : [owner];
  m.created = new Date().toISOString().slice(0, 10);
  writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  return m;
}

/* ------------------------------------------------------------------ */
/* build options on an existing app (axf options)                      */
/* ------------------------------------------------------------------ */

/**
 * Read or change build options on an existing app (or the framework's own assets with framework: true).
 * Writes the tokens into the app's assets and records the values in axf.manifest.json.
 */
export function appOptions({ dir = '.', framework = false, options = {}, log = () => {} } = {}) {
  requireProject(framework ? join(FRAMEWORK_DIR, '..') : dir, 'changed');
  const dirs = framework ? [join(FRAMEWORK_DIR, 'assets')] : [join(resolve(dir), appTemplate(resolve(dir)).assetsDir)];
  if (!framework && !existsSync(dirs[0])) throw new Error(`No AXF assets at ${dirs[0]} — is ${dir} an AXF app?`);
  const changed = [];
  for (const d of dirs) changed.push(...applyOptions(d, options, log));
  const values = readOptions(dirs[0]);
  if (!framework && Object.keys(options).length) {
    const root = resolve(dir);
    for (const mPath of [join(root, 'axf.manifest.json'), join(root, dirname(appTemplate(root).assetsDir), 'axf.manifest.json')]) {
      if (!existsSync(mPath)) continue;
      const m = readJson(mPath);
      m.options = { ...(m.options ?? {}), ...values };
      writeFileSync(mPath, JSON.stringify(m, null, 2) + '\n');
    }
  }
  return { options: values, changed: changed.map((f) => relative(framework ? FRAMEWORK_DIR : resolve(dir), f)) };
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

/** `app/src/main/kotlin/app/…` placeholder paths → the app's real package path (Android apps). */
export function pkgPath(root, p) {
  const mPath = join(root, 'axf.manifest.json');
  const pkg = existsSync(mPath) ? readJson(mPath).android?.applicationId : null;
  return pkg ? p.replace(/^app\/src\/main\/kotlin\/app(\/|$)/, `app/src/main/kotlin/${pkg.replace(/\./g, '/')}$1`) : p;
}

export function appTemplate(root) {
  const mPath = join(root, 'axf.manifest.json');
  const id = existsSync(mPath) ? readJson(mPath).framework?.template : undefined;
  try { return templateInfo(id ?? 'react-ts'); } catch { return templateInfo('react-ts'); }
}

export function validateApp(dir) {
  const root = resolve(dir);
  const errors = [];
  const warnings = [];
  // The build rule: a project is only loaded or compiled with a validated manifest.
  const project = checkProject(root);
  for (const e of project.validation.errors) errors.push(`${PROJECT_MANIFEST_FILE}: ${e.message} [${e.rule}]`);
  for (const w of project.validation.warnings) warnings.push(`${PROJECT_MANIFEST_FILE}: ${w.message} [${w.rule}]`);
  const tpl = appTemplate(root);
  for (const e of tpl.structure) {
    const p = join(root, pkgPath(root, e.path));
    // Android sources may sit in the package folder (what init writes) or in the template's plain `app/` folder
    // (apps made before init mapped it, e.g. the Android console): either is the same file.
    if (!existsSync(p) && !existsSync(join(root, e.path))) (e.required ? errors : warnings).push(`missing ${e.kind} ${relative(root, p)}`);
  }
  const assets = loadAssets(join(root, tpl.assetsDir));
  for (const a of assets) if (!a.result.ok) errors.push(`${relative(root, a.file)}: ${a.result.errors.join('; ')}`);
  const byType = {};
  for (const a of assets) if (a.result.ok) (byType[a.raw.type] ??= new Set()).add(a.raw.id);
  for (const [t, ts] of Object.entries(spec.types)) if (!ts.optional && !byType[t]?.size) errors.push(`slot "${t}" has no assets`);

  const mPath = join(root, 'axf.manifest.json');
  if (existsSync(mPath)) {
    const m = readJson(mPath);
    for (const [t, id] of Object.entries(m.defaults ?? {})) {
      if (!byType[t]?.has(id)) errors.push(`manifest default ${t} → "${id}" does not exist`);
    }
    if (m.hidden !== undefined && (!Array.isArray(m.hidden) || m.hidden.some((t) => typeof t !== 'string'))) errors.push('manifest "hidden" must be a list of asset types');
    for (const t of Array.isArray(m.hidden) ? m.hidden : []) if (!spec.types[t]?.hideable) errors.push(`manifest hidden "${t}" is not a hideable type`);
    if (m.developer !== undefined && (typeof m.developer !== 'object' || m.developer === null || !hubOrigin(m.developer.hub))) errors.push('manifest "developer" must be { hub: "https://…" } (a plain https origin)');
    if (m.framework?.version !== FRAMEWORK_VERSION) warnings.push(`app targets framework ${m.framework?.version}, engine is ${FRAMEWORK_VERSION}`);
  }
  const lPath = join(root, 'axf.lock.json');
  if (existsSync(lPath)) {
    const lock = readJson(lPath);
    for (const [rel, hash] of Object.entries(lock.files ?? {})) {
      const p = join(root, rel);
      if (!existsSync(p)) errors.push(`baked file removed: ${rel}`);
      else if (sha(p) !== hash) warnings.push(`baked file modified: ${rel}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, assets: assets.length, project: project.manifest?.name ?? null };
}

/* ------------------------------------------------------------------ */
/* new-asset & schemas                                                 */
/* ------------------------------------------------------------------ */

export function newAsset({ dir, type, id, from, name }) {
  if (!spec.types[type]) throw new Error(`Unknown type "${type}". Types: ${Object.keys(spec.types).join(', ')}`);
  const root = resolve(dir);
  if (existsSync(join(root, 'axf.manifest.json'))) requireProject(root, 'changed');
  const assetsDir = existsSync(join(root, 'axf.manifest.json')) ? join(root, appTemplate(root).assetsDir) : join(root, 'src/assets');
  const source = from ? join(assetsDir, type, `${from}.json`) : null;
  const base = source && existsSync(source) ? readJson(source) : loadAssets(assetsDir).find((a) => a.raw?.type === type)?.raw;
  if (!base) throw new Error(`No ${type} asset to start from.`);
  const asset = { ...base, id, name: name ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), version: '0.1.0', author: undefined };
  const r = validateAsset(asset);
  if (!r.ok) throw new Error(r.errors.join('; '));
  const target = join(assetsDir, type, `${id}.json`);
  if (existsSync(target)) throw new Error(`${relative(process.cwd(), target)} already exists`);
  writeFileSync(target, JSON.stringify(asset, null, 2) + '\n');
  return target;
}

/** Emit JSON Schema files (for editor autocompletion) from the type spec. */
export function writeSchemas(outDir = join(FRAMEWORK_DIR, 'schemas/json')) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [type, ts] of Object.entries(spec.types)) {
    const props = Object.fromEntries(ts.required.map((k) => [k, ts.enums?.[k] ? { enum: ts.enums[k] } : ts.nested?.[k] ? { type: 'object', required: ts.nested[k] } : {}]));
    // Menu items (asset-types.json → menuItems): a recursive definition for editors, where menu items appear.
    const menuItem = { $ref: '#/$defs/menuItem' };
    if (type === 'app-menu') props.menus = { type: 'array', items: { type: 'object', required: ['id', 'label', 'items'], properties: { id: { type: 'string' }, label: { type: 'string' }, order: { type: 'number' }, items: { type: 'array', items: menuItem } } } };
    if (type === 'context-menu') props.targets = { type: 'object', required: ts.nested?.targets ?? [], additionalProperties: { type: 'array', items: menuItem } };
    // scale assets (typography, density, sizing): every group optional, fields typed + ranged from the shared registry
    if (isScaleType(type)) Object.assign(props, scaleSchemaProperties(type));
    if (type === AGENT_CARD_TYPE) Object.assign(props, agentCardSchemaProperties());
    if (type === JOB_TYPE) Object.assign(props, jobTypeSchemaProperties());
    const $defs = type === 'app-menu' || type === 'context-menu' ? { menuItem: menuItemSchema() } : undefined;
    const schema = {
      ...($defs ? { $defs } : {}),
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `axf/${type}.schema.json`,
      title: `AmberX AXF ${ts.label} asset`,
      type: 'object',
      required: spec.envelope.required,
      properties: {
        $axf: { const: spec.envelope.frame },
        type: { const: type },
        id: { type: 'string', pattern: spec.envelope.idPattern },
        name: { type: 'string', minLength: 1 },
        version: { type: 'string' },
        description: { type: 'string' },
        data: { type: 'object', required: ts.required, properties: props },
      },
    };
    const f = join(outDir, `${type}.schema.json`);
    writeFileSync(f, JSON.stringify(schema, null, 2) + '\n');
    written.push(f);
  }
  // ui-review-item@1 / ui-review-group@1: JSON Schemas + the registry snapshot the Python server reads
  for (const [n, schema] of Object.entries(uiReviewJsonSchemas())) { const f = join(outDir, n); writeFileSync(f, JSON.stringify(schema, null, 2) + '\n'); written.push(f); }
  const reg = join(FRAMEWORK_DIR, 'schemas/ui-review.json');
  writeFileSync(reg, JSON.stringify(UI_REVIEW_REGISTRY, null, 2) + '\n'); written.push(reg);
  return written;
}

/* ------------------------------------------------------------------ */
/* Android modules & demo apps (driven by the Dev Console)              */
/* ------------------------------------------------------------------ */

export const ANDROID_DIR = join(FRAMEWORK_DIR, 'android');

/**
 * Scaffold a new framework library module `lib-<name>` in framework/android from the android-module
 * template and register it in settings.gradle.kts. The module is a placeholder AxfModule until built out.
 */
export function newModule({ name, label, capabilities = [], dependsOn = [], compose = true, log = () => {} }) {
  const slug = slugify(name);
  const moduleName = slug.startsWith('lib-') || slug.startsWith('axf-') ? slug : `lib-${slug}`;
  const pkgName = moduleName.replace(/^(lib|axf)-/, '').replace(/-/g, '.');
  const dest = join(ANDROID_DIR, moduleName);
  if (existsSync(dest)) throw new Error(`Module ${moduleName} already exists`);
  const className = pkgName.split('.').map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase())).join('') + 'Module';
  const tokens = {
    MODULE_NAME: moduleName, PACKAGE: `ai.amberx.axf.${pkgName}`, CLASS_NAME: className, LABEL: label ?? name,
    MODULE_ID: `ai.amberx.axf.${pkgName}`, PLUGIN: compose ? 'axf.android.compose.library' : 'axf.android.library',
    CAPABILITIES: capabilities.map((c) => `Capability("${c}")`).join(', '),
    DEPENDS_ON: dependsOn.map((d) => `"${d}"`).join(', '),
    FRAMEWORK_VERSION,
  };
  log(`• scaffolding ${moduleName}`);
  copyTemplate(join(FRAMEWORK_DIR, 'templates/android-module'), dest, tokens);
  rmSync(join(dest, 'template.json'), { force: true });
  // Kotlin sources live under a package path: move the placeholder file.
  const srcTpl = join(dest, 'src/main/kotlin/Module.kt');
  if (existsSync(srcTpl)) {
    const pkgDir = join(dest, 'src/main/kotlin', ...tokens.PACKAGE.split('.'));
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, `${className}.kt`), readFileSync(srcTpl, 'utf8'));
    rmSync(srcTpl);
  }
  const settings = join(ANDROID_DIR, 'settings.gradle.kts');
  const text = readFileSync(settings, 'utf8');
  if (!text.includes(`":${moduleName}"`)) writeFileSync(settings, text.trimEnd() + `\ninclude(":${moduleName}")\n`);
  return { dir: dest, moduleName, moduleId: tokens.MODULE_ID, className };
}

/** Create a demo app `apps/demo-<lib>` that showcases one library (what the Dev Console's library picker does). */
export function newDemoApp({ library, name, dir, log = () => {} }) {
  const slug = slugify(library).replace(/^lib-/, '');
  const target = dir ?? join(FRAMEWORK_DIR, '..', 'apps', `demo-${slug}`);
  const moduleId = library.startsWith('ai.amberx.') ? library : `ai.amberx.axf.${slug.replace(/-/g, '.')}`;
  return init({ dir: target, name: name ?? `AXF Demo — ${slug}`, id: `demo-${slug}`, template: 'android-compose', targets: ['android'], modules: [moduleId], log });
}

export function listModules() {
  const settings = readFileSync(join(ANDROID_DIR, 'settings.gradle.kts'), 'utf8');
  return [...settings.matchAll(/include\("(:[^"]+)"\)/g)].map((m) => m[1].slice(1)).map((name) => {
    const readme = join(ANDROID_DIR, name, 'README.md');
    const first = existsSync(readme) ? readFileSync(readme, 'utf8').split('\n').find((l) => l && !l.startsWith('#'))?.trim() ?? '' : '';
    // Modules this one builds on: its Gradle `project(":x")` dependencies (Build Pilot highlights them when one is picked).
    const gradle = join(ANDROID_DIR, name, 'build.gradle.kts');
    const dependsOn = existsSync(gradle) ? [...new Set([...readFileSync(gradle, 'utf8').matchAll(/project\(\s*"(:[^"]+)"\s*\)/g)].map((m) => m[1].slice(1)).filter((d) => d !== name))] : [];
    return { name, kind: name.startsWith('lib-') ? 'library' : name.startsWith('axf-') ? 'framework' : 'other', description: first, dependsOn };
  });
}

/* ------------------------------------------------------------------ */
/* boilerplates                                                        */
/* ------------------------------------------------------------------ */

export const BOILERPLATES_DIR = join(FRAMEWORK_DIR, 'boilerplates');

export function listBoilerplates() {
  const idx = join(BOILERPLATES_DIR, 'index.json');
  return existsSync(idx) ? readJson(idx).items : [];
}

export function loadBoilerplate(id) {
  const file = join(BOILERPLATES_DIR, id, 'boilerplate.json');
  if (!existsSync(file)) throw new Error(`Unknown boilerplate "${id}". Available: ${listBoilerplates().map((b) => b.id).join(', ')}`);
  return readJson(file);
}

/** Writes a nav-menu asset for the boilerplate's screens and a placeholder view per screen into a fresh app. */
function applyBoilerplate(dest, tpl, bp, log) {
  log(`• applying boilerplate "${bp.id}" (${(bp.screens ?? []).length} screens)`);
  const nav = {
    $axf: 'asset@1', type: 'nav-menu', id: `${bp.id}-nav`, name: `${bp.name} navigation`, version: '0.1.0',
    description: `Generated from the ${bp.id} boilerplate.`, author: 'AmberX AXF build engine', tags: ['boilerplate'],
    data: { style: 'list', header: bp.name, sections: [{ label: null, items: (bp.screens ?? []).map((s) => ({ id: s.id, label: s.label, icon: iconFor(s.kind), view: s.id })) }] },
  };
  const navDir = join(dest, tpl.assetsDir, 'nav-menu');
  mkdirSync(navDir, { recursive: true });
  writeFileSync(join(navDir, `${nav.id}.json`), JSON.stringify(nav, null, 2) + '\n');
  const m = readJson(join(dest, 'axf.manifest.json'));
  m.defaults['nav-menu'] = nav.id;
  writeFileSync(join(dest, 'axf.manifest.json'), JSON.stringify(m, null, 2) + '\n');
  if (tpl.kind === 'android-app') {
    writeFileSync(join(dest, dirname(tpl.assetsDir), 'axf.manifest.json'), JSON.stringify(m, null, 2) + '\n');
    const viewsDir = join(dest, pkgPath(dest, 'app/src/main/kotlin/app/views'));
    mkdirSync(viewsDir, { recursive: true });
    const pkg = m.android?.applicationId ?? 'app';
    for (const s of bp.screens ?? []) {
      const cls = s.id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase()) + 'View';
      if (existsSync(join(viewsDir, `${cls}.kt`))) continue;
      writeFileSync(join(viewsDir, `${cls}.kt`), `package ${pkg}.views\n\nimport androidx.compose.runtime.Composable\nimport ai.amberx.axf.ui.components.PlaceholderScreen\n\n/** ${s.label} — "${s.kind}" screen from the ${bp.id} boilerplate. Replace the placeholder with the real screen. */\n@Composable\nfun ${cls}() {\n    PlaceholderScreen("${ktStr(s.label)}", message = "Boilerplate screen (${ktStr(s.kind)}). Build it here.")\n}\n`);
    }
    const screens = (bp.screens ?? []).map((s) => { const cls = s.id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase()) + 'View'; return `"${s.id}" to { ${cls}() }`; });
    const main = join(dest, pkgPath(dest, 'app/src/main/kotlin/app/MainActivity.kt'));
    if (existsSync(main)) {
      let text = readFileSync(main, 'utf8');
      text = text.replace('AppShell(views = mapOf("home" to { HomeView() }))', `AppShell(views = mapOf(${screens.join(', ')}))`).replace(`import ${pkg}.views.HomeView`, `import ${pkg}.views.*`);
      writeFileSync(main, text);
    }
  }
}

function iconFor(kind) {
  return { 'list-detail': 'list', dashboard: 'grid', wizard: 'chevron-right', settings: 'settings', feed: 'layers', editor: 'edit', player: 'play', map: 'map', chat: 'users', profile: 'user', landing: 'home', custom: 'box' }[kind] ?? 'box';
}
