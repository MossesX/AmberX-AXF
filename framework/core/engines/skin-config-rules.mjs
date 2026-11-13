/**
 * skin-config@1 (build skin-configuration-panel, Nov 2026, Brett: "before AI makes a skin, Brett picks what it may
 * change"): the permission tree the AI gets before it writes a skin, and the rules that hold a generated skin to it.
 *
 * The tree is category > group > option. Every category is a registered asset type the skin can reach (skin-coverage@1
 * says how: slot, parts or reference; bundle / none types have nothing to pick), in registry order with the registry's
 * group as its section, plus the one category the registry declares for the look's extras (`skinConfig.extras` in
 * asset-types.json: spacing, look settings and token overrides). Nothing here names a type: the colours category is
 * the colour theme type, typography is the typography type, layout and tab placement are the layout and tab-group
 * types, buttons and actions the button and action-button types, behaviours the behaviour theme, context menus / nav
 * menu / app menu / toolbars their own types, and every other registered type gets a category the same way.
 *
 * A category's groups are derived from the type's registry entry and its coverage:
 *   pick       the skin may name a different asset of the type (slot types; reference types through their `via`)
 *   fields     the fields of a new asset of the type the AI may write (`required` + `optional_fields`; nested keys
 *              such as a colour theme's tokens are one option each: `tokens.accent`)
 *   parts.<g>  the type's style parts (customize tokens, one group per customize group: text, colour, layout, shape,
 *              icons, motion, hover, click), only for types with a style target
 *   chrome     show or hide it (hideable types)
 *   look       the extras category's own options
 * and its limits from the type's `skinConfig.limits` declaration (`depth`: how many menu levels the AI may build,
 * measured as the deepest `items` nesting, 1 = flat, with `root` naming the field whose lists are the first level;
 * `count:<key>`: how many entries an array field may hold).
 *
 * Every option is `allow` (the AI may change it), `lock` (it stays as the Default skin has it) or `ask` (the AI may
 * propose a change, Brett decides). A document holds only what was set; the most specific setting wins (option over
 * group over category over the document's `default`, which starts at allow).
 *
 * `skinChangeReport` compares a generated skin with the Default skin (the app's saved look as a skin@1 asset,
 * `defaultSkinOf` below) under the config, `mergeWithDefault` puts every locked change back the way the Default has it
 * and lists what needs asking. Plain JS, pure, no I/O: shared by the CLI, the console server and the runtime.
 */
import { coverageTable } from './skin-coverage.mjs';

export const SKIN_CONFIG_CONTRACT = 'skin-config@1';
export const SKIN_CONFIG_FRAME = 'skin-config@1';
export const SKIN_CONFIG_PROJECT = 'shared';
export const SKIN_CONFIG_MAX_BYTES = 64 * 1024;
/** The three choices for an option. */
export const SKIN_CONFIG_MODES = ['allow', 'lock', 'ask'];
export const SKIN_CONFIG_DEFAULT_MODE = 'allow';
/** The kinds of group a category can carry, in the order a panel lists them (`parts.<group>` for every customize group). */
export const SKIN_CONFIG_GROUP_KINDS = ['pick', 'fields', 'parts', 'chrome', 'look'];
/** The ways a limit is measured: the deepest `items` nesting, or the length of an array field. */
export const SKIN_CONFIG_MEASURES = ['depth', 'count'];
/** The category the registry declares for the look's extras (spacing, look settings, token overrides). */
export const SKIN_CONFIG_EXTRAS = 'extras';
/** The hub-wide level's config document is kept under this app id. */
export const SKIN_CONFIG_GLOBAL = 'global';
export const skinConfigPath = (app) => `settings/skin-config/${app}.json`;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const label = (k) => str(k, 80).replace(/[-_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const firstSentence = (s) => { const t = str(s, 400).split(/ — | - |\. |\n/)[0].trim(); return t.length > 90 ? `${t.slice(0, 87)}…` : t; };
const slug = (s) => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------------------------------------------------------------- the tree */

/** The limits a type declares (`skinConfig.limits`), checked: `{ id, label, measure, field, min, max, default }`. */
export function declaredLimits(typeSpec) {
  const d = isObj(typeSpec) && isObj(typeSpec.skinConfig) && isObj(typeSpec.skinConfig.limits) ? typeSpec.skinConfig.limits : null;
  if (!d) return [];
  const out = [];
  for (const [id, raw] of Object.entries(d)) {
    if (!ID.test(id) || !isObj(raw)) continue;
    const measure = str(raw.measure, 40) || (id === 'depth' ? 'depth' : '');
    const [kind, field = ''] = measure.split(':');
    if (!SKIN_CONFIG_MEASURES.includes(kind) || (kind === 'count' && !field)) continue;
    const min = Number.isInteger(raw.min) ? raw.min : 0;
    const max = Number.isInteger(raw.max) && raw.max >= min ? raw.max : Math.max(min, 10);
    const def = Number.isInteger(raw.default) ? Math.min(max, Math.max(min, raw.default)) : max;
    out.push({ id, label: str(raw.label, 120) || label(id), measure: kind, field, root: kind === 'depth' ? str(raw.root, 40) : '', min, max, default: def });
  }
  return out;
}

/** Problems with a type's `skinConfig` declaration (CI lists them). */
export function limitDeclarationErrors(type, typeSpec) {
  const sc = isObj(typeSpec) ? typeSpec.skinConfig : undefined;
  if (sc === undefined) return [];
  if (!isObj(sc)) return [`${type}: skinConfig must be an object`];
  const out = [];
  if (sc.limits !== undefined && !isObj(sc.limits)) out.push(`${type}: skinConfig.limits must be an object (limit id → { label, measure, min, max, default })`);
  for (const [id, raw] of Object.entries(isObj(sc.limits) ? sc.limits : {})) {
    if (!isObj(raw)) { out.push(`${type}: skinConfig.limits.${id} must be an object`); continue; }
    const measure = str(raw.measure, 40) || (id === 'depth' ? 'depth' : '');
    const [kind, field = ''] = measure.split(':');
    if (!SKIN_CONFIG_MEASURES.includes(kind)) out.push(`${type}: skinConfig.limits.${id}.measure must be depth or count:<field>`);
    else if (kind === 'count' && !field) out.push(`${type}: skinConfig.limits.${id}.measure count needs the field: count:<field>`);
    if (raw.root !== undefined && (kind !== 'depth' || typeof raw.root !== 'string' || !raw.root)) out.push(`${type}: skinConfig.limits.${id}.root is for depth limits only and names a field`);
    if (!Number.isInteger(raw.max)) out.push(`${type}: skinConfig.limits.${id}.max must be an integer`);
    if (Number.isInteger(raw.min) && Number.isInteger(raw.max) && raw.min > raw.max) out.push(`${type}: skinConfig.limits.${id}: min is above max`);
  }
  return out;
}

/** The field options of a type: its required fields and optional fields, nested keys one option each. */
function fieldOptions(t) {
  const out = [];
  const seen = new Set();
  const add = (id, text, kind) => { if (!seen.has(id) && ID.test(id)) { seen.add(id); out.push({ id, label: text || label(id), kind }); } };
  for (const k of Array.isArray(t.required) ? t.required : []) {
    if (typeof k !== 'string') continue;
    const nested = isObj(t.nested) && Array.isArray(t.nested[k]) ? t.nested[k] : null;
    if (nested && nested.length) for (const n of nested) { if (typeof n === 'string') add(`${k}.${n}`, `${label(k)} · ${label(n)}`, 'nested'); }
    else add(k, isObj(t.enums) && Array.isArray(t.enums[k]) ? `${label(k)} (${t.enums[k].join(' / ')})` : '', isObj(t.enums) && t.enums[k] ? 'enum' : 'field');
  }
  for (const [k, doc] of Object.entries(isObj(t.optional_fields) ? t.optional_fields : {})) add(k, `${label(k)}: ${firstSentence(doc)}`, 'optional');
  return out;
}

/** The parts groups of a type: one per customize group, the tokens that apply to the type as options. */
function partsGroups(type, customize) {
  const tokens = Array.isArray(customize?.tokens) ? customize.tokens : [];
  const groups = new Map();
  for (const tk of tokens) {
    if (!isObj(tk) || typeof tk.key !== 'string') continue;
    if (Array.isArray(tk.types) && !tk.types.includes(type)) continue;
    const g = str(tk.group, 40) || 'Other';
    if (!groups.has(g)) groups.set(g, { id: `parts.${slug(g)}`, label: `Style parts · ${g}`, kind: 'parts', options: [] });
    groups.get(g).options.push({ id: tk.key, label: str(tk.label, 80) || label(tk.key), kind: str(tk.kind, 20) || 'token' });
  }
  return [...groups.values()];
}

/**
 * The permission tree over the registry (`registry` = asset-types.json whole: `types` + `skinConfig`), the style
 * targets and customize tokens (`customize` = customize.json) and the slots a skin never sets (skin-rules SKIN_NEVER).
 * `{ contract, categories: [{ type, label, section, by, groups: [{ id, label, kind, options: [{ id, label, kind }] }], limits }] }`.
 */
export function skinConfigTree(registry, customize = {}, never = []) {
  const spec = isObj(registry) && isObj(registry.types) ? registry.types : {};
  const targets = isObj(customize) && isObj(customize.targets) ? customize.targets : {};
  const categories = [];
  for (const row of coverageTable(spec, targets, never)) {
    if (!['slot', 'parts', 'reference'].includes(row.by)) continue;
    const t = spec[row.type];
    const groups = [];
    if (row.by === 'slot') groups.push({ id: 'pick', label: `Pick another ${row.label.toLowerCase()}`, kind: 'pick', options: [{ id: 'asset', label: `The ${row.label.toLowerCase()} the skin names`, kind: 'asset' }] });
    else if (row.by === 'reference' && row.via) groups.push({ id: 'pick', label: `Pick another ${row.label.toLowerCase()}`, kind: 'pick', options: [{ id: row.via, label: row.via === 'iconPack' ? 'The icon pack the skin draws with' : `Through the ${label(row.via).toLowerCase()} the skin picks`, kind: 'reference' }] });
    const fields = row.by === 'parts' ? [] : fieldOptions(t);
    if (fields.length) groups.push({ id: 'fields', label: `Fields of a new ${row.label.toLowerCase()}`, kind: 'fields', options: fields });
    if (row.elements.length) groups.push(...partsGroups(row.type, customize));
    if (t.hideable === true) groups.push({ id: 'chrome', label: 'Shown or hidden', kind: 'chrome', options: [{ id: 'hidden', label: `Show or hide the ${row.label.toLowerCase()}`, kind: 'toggle' }] });
    categories.push({ type: row.type, label: row.label, section: row.group || 'Other', by: row.by, groups, limits: declaredLimits(t) });
  }
  const x = isObj(registry) && isObj(registry.skinConfig) && isObj(registry.skinConfig.extras) ? registry.skinConfig.extras : null;
  if (x && isObj(x.options)) {
    const options = Object.entries(x.options).filter(([k]) => ID.test(k)).map(([k, doc]) => ({ id: k, label: firstSentence(doc) || label(k), kind: 'extra' }));
    if (options.length) categories.push({ type: SKIN_CONFIG_EXTRAS, label: str(x.label, 80) || 'Look extras', section: str(x.section, 40) || 'Look', by: 'extras', groups: [{ id: 'look', label: str(x.groupLabel, 80) || 'The look as a whole', kind: 'look', options }], limits: [] });
  }
  return { contract: SKIN_CONFIG_CONTRACT, categories };
}

export function findCategory(tree, type) { return tree?.categories?.find((c) => c.type === type) ?? null; }
export function findGroup(tree, type, group) { return findCategory(tree, type)?.groups.find((g) => g.id === group) ?? null; }
export function findOption(tree, type, group, option) { return findGroup(tree, type, group)?.options.find((o) => o.id === option) ?? null; }
export function findLimit(tree, type, limit) { return findCategory(tree, type)?.limits.find((l) => l.id === limit) ?? null; }

/** Every option path `type/group/option` in tree order. */
export function optionPaths(tree) {
  const out = [];
  for (const c of tree?.categories ?? []) for (const g of c.groups) for (const o of g.options) out.push(`${c.type}/${g.id}/${o.id}`);
  return out;
}

/** Counts for a summary line. */
export function treeSummary(tree) {
  const cats = tree?.categories ?? [];
  return { categories: cats.length, groups: cats.reduce((n, c) => n + c.groups.length, 0), options: cats.reduce((n, c) => n + c.groups.reduce((m, g) => m + g.options.length, 0), 0), limits: cats.reduce((n, c) => n + c.limits.length, 0), sections: [...new Set(cats.map((c) => c.section))] };
}

/* ---------------------------------------------------------------- the document */

const mode = (v) => (SKIN_CONFIG_MODES.includes(v) ? v : '');

/** A new config: everything allowed, every limit at its default. */
export function newSkinConfig(app) {
  return { $axf: SKIN_CONFIG_FRAME, app: ID.test(str(app, 120)) ? app : SKIN_CONFIG_GLOBAL, default: SKIN_CONFIG_DEFAULT_MODE, categories: {} };
}

/** Keep only what skin-config@1 holds and the tree knows: categories, groups, options with a valid mode, limits clamped. */
export function normalizeSkinConfig(raw, tree) {
  if (!isObj(raw) || raw.$axf !== SKIN_CONFIG_FRAME) return null;
  const out = newSkinConfig(raw.app);
  if (mode(raw.default)) out.default = raw.default;
  if (isObj(raw.categories)) for (const [type, c] of Object.entries(raw.categories)) {
    const cat = findCategory(tree, type);
    if (!cat || !isObj(c)) continue;
    const n = {};
    if (mode(c.mode)) n.mode = c.mode;
    if (isObj(c.groups)) for (const [gid, g] of Object.entries(c.groups)) {
      const grp = cat.groups.find((x) => x.id === gid);
      if (!grp || !isObj(g)) continue;
      const ng = {};
      if (mode(g.mode)) ng.mode = g.mode;
      if (isObj(g.options)) for (const [oid, m] of Object.entries(g.options)) if (grp.options.some((o) => o.id === oid) && mode(m)) (ng.options ??= {})[oid] = m;
      if (Object.keys(ng).length) (n.groups ??= {})[gid] = ng;
    }
    if (isObj(c.limits)) for (const [lid, v] of Object.entries(c.limits)) {
      const lim = cat.limits.find((x) => x.id === lid);
      if (lim && Number.isInteger(v)) (n.limits ??= {})[lid] = Math.min(lim.max, Math.max(lim.min, v));
    }
    if (Object.keys(n).length) out.categories[type] = n;
  }
  if (typeof raw.updatedBy === 'string') out.updatedBy = raw.updatedBy;
  if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt;
  return out;
}

export function parseSkinConfig(text, tree) {
  if (!text || text.length > SKIN_CONFIG_MAX_BYTES) return null;
  try { return normalizeSkinConfig(JSON.parse(text), tree); } catch { return null; }
}

/** Problems a reader names before saving: an unknown category / group / option / limit, a mode outside the list, a limit out of range. */
export function skinConfigErrors(raw, tree) {
  if (!isObj(raw)) return ['a skin-config@1 document must be an object'];
  const out = [];
  if (raw.$axf !== SKIN_CONFIG_FRAME) out.push(`$axf must be ${SKIN_CONFIG_FRAME}`);
  if (raw.default !== undefined && !mode(raw.default)) out.push(`default must be one of ${SKIN_CONFIG_MODES.join(', ')}`);
  if (raw.categories !== undefined && !isObj(raw.categories)) out.push('categories must be an object (asset type → category)');
  for (const [type, c] of Object.entries(isObj(raw.categories) ? raw.categories : {})) {
    const cat = findCategory(tree, type);
    if (!cat) { out.push(`categories.${type}: not a category (a registered type a skin can change, or ${SKIN_CONFIG_EXTRAS})`); continue; }
    if (!isObj(c)) { out.push(`categories.${type} must be an object`); continue; }
    if (c.mode !== undefined && !mode(c.mode)) out.push(`categories.${type}.mode must be one of ${SKIN_CONFIG_MODES.join(', ')}`);
    for (const [gid, g] of Object.entries(isObj(c.groups) ? c.groups : {})) {
      const grp = cat.groups.find((x) => x.id === gid);
      if (!grp) { out.push(`categories.${type}.groups.${gid}: not a group of ${type} (${cat.groups.map((x) => x.id).join(', ')})`); continue; }
      if (!isObj(g)) { out.push(`categories.${type}.groups.${gid} must be an object`); continue; }
      if (g.mode !== undefined && !mode(g.mode)) out.push(`categories.${type}.groups.${gid}.mode must be one of ${SKIN_CONFIG_MODES.join(', ')}`);
      for (const [oid, m] of Object.entries(isObj(g.options) ? g.options : {})) {
        if (!grp.options.some((o) => o.id === oid)) out.push(`categories.${type}.groups.${gid}.options.${oid}: not an option of ${type}/${gid}`);
        else if (!mode(m)) out.push(`categories.${type}.groups.${gid}.options.${oid} must be one of ${SKIN_CONFIG_MODES.join(', ')}`);
      }
    }
    for (const [lid, v] of Object.entries(isObj(c.limits) ? c.limits : {})) {
      const lim = cat.limits.find((x) => x.id === lid);
      if (!lim) out.push(`categories.${type}.limits.${lid}: ${type} has no such limit${cat.limits.length ? ` (${cat.limits.map((x) => x.id).join(', ')})` : ''}`);
      else if (!Number.isInteger(v) || v < lim.min || v > lim.max) out.push(`categories.${type}.limits.${lid} must be an integer ${lim.min}–${lim.max}`);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- resolving */

/** The mode in force for one option: the option's own, else its group's, else its category's, else the document's default. */
export function optionMode(config, type, group, option) {
  const c = config?.categories?.[type];
  const g = c?.groups?.[group];
  return mode(g?.options?.[option]) || mode(g?.mode) || mode(c?.mode) || mode(config?.default) || SKIN_CONFIG_DEFAULT_MODE;
}

/** Where an option's mode comes from: `option`, `group`, `category` or `default`. */
export function optionModeFrom(config, type, group, option) {
  const c = config?.categories?.[type];
  const g = c?.groups?.[group];
  if (mode(g?.options?.[option])) return 'option';
  if (mode(g?.mode)) return 'group';
  if (mode(c?.mode)) return 'category';
  return 'default';
}

/** A limit's value: the document's, clamped, else the declaration's default. */
export function limitValue(config, tree, type, limit) {
  const lim = findLimit(tree, type, limit);
  if (!lim) return null;
  const v = config?.categories?.[type]?.limits?.[limit];
  return Number.isInteger(v) ? Math.min(lim.max, Math.max(lim.min, v)) : lim.default;
}

/** Every option with its mode and where it came from, every limit with its value: what a panel draws and the API reads. */
export function effectiveConfig(config, tree) {
  const options = {};
  const limits = {};
  const counts = { allow: 0, lock: 0, ask: 0 };
  for (const c of tree?.categories ?? []) {
    for (const g of c.groups) for (const o of g.options) {
      const m = optionMode(config, c.type, g.id, o.id);
      options[`${c.type}/${g.id}/${o.id}`] = { mode: m, from: optionModeFrom(config, c.type, g.id, o.id) };
      counts[m]++;
    }
    for (const l of c.limits) limits[`${c.type}/${l.id}`] = limitValue(config, tree, c.type, l.id);
  }
  return { default: mode(config?.default) || SKIN_CONFIG_DEFAULT_MODE, options, limits, counts };
}

/* ---------------------------------------------------------------- the panel's moves (every transport comes through here) */

/** Split `type`, `type/group` or `type/group/option`; null when the tree has no such node. */
export function parseConfigPath(tree, path) {
  const parts = str(path, 400).split('/').filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  const [type, group, option] = parts;
  if (!findCategory(tree, type)) return null;
  if (group && !findGroup(tree, type, group)) return null;
  if (option && !findOption(tree, type, group, option)) return null;
  return { type, group: group ?? '', option: option ?? '' };
}

/** Set a mode at a path (`allow | lock | ask`); null clears it so the level inherits again. Throws on a path the tree lacks. */
export function setConfigMode(config, tree, path, m) {
  const at = parseConfigPath(tree, path);
  if (!at) throw new Error(`"${path}" is not a category, group or option of the skin-config tree`);
  if (m !== null && !mode(m)) throw new Error(`mode must be one of ${SKIN_CONFIG_MODES.join(', ')} (or null to inherit)`);
  const next = { ...config, categories: { ...(config?.categories ?? {}) } };
  const cat = { ...(next.categories[at.type] ?? {}) };
  if (!at.group) { if (m) cat.mode = m; else delete cat.mode; }
  else {
    const groups = { ...(cat.groups ?? {}) };
    const grp = { ...(groups[at.group] ?? {}) };
    if (!at.option) { if (m) grp.mode = m; else delete grp.mode; }
    else { const options = { ...(grp.options ?? {}) }; if (m) options[at.option] = m; else delete options[at.option]; if (Object.keys(options).length) grp.options = options; else delete grp.options; }
    if (Object.keys(grp).length) groups[at.group] = grp; else delete groups[at.group];
    if (Object.keys(groups).length) cat.groups = groups; else delete cat.groups;
  }
  if (Object.keys(cat).length) next.categories[at.type] = cat; else delete next.categories[at.type];
  return next;
}

/** Set a limit (clamped to its declaration); null puts it back to the default. */
export function setConfigLimit(config, tree, type, limit, value) {
  const lim = findLimit(tree, type, limit);
  if (!lim) throw new Error(`${type} has no limit "${limit}"`);
  if (value !== null && !Number.isInteger(value)) throw new Error(`${type}/${limit} must be an integer ${lim.min}–${lim.max}`);
  const next = { ...config, categories: { ...(config?.categories ?? {}) } };
  const cat = { ...(next.categories[type] ?? {}) };
  const limits = { ...(cat.limits ?? {}) };
  if (value === null) delete limits[limit]; else limits[limit] = Math.min(lim.max, Math.max(lim.min, value));
  if (Object.keys(limits).length) cat.limits = limits; else delete cat.limits;
  if (Object.keys(cat).length) next.categories[type] = cat; else delete next.categories[type];
  return next;
}

/** The document's default mode for everything not set. */
export function setConfigDefault(config, m) {
  if (!mode(m)) throw new Error(`default must be one of ${SKIN_CONFIG_MODES.join(', ')}`);
  return { ...config, default: m };
}

/** Everything back to allow and every limit to its default. */
export function resetSkinConfig(config) { return { ...newSkinConfig(config?.app), ...(config?.updatedBy ? { updatedBy: config.updatedBy } : {}) }; }

/* ---------------------------------------------------------------- measuring assets */

/**
 * The deepest `items` nesting in an asset's data: 0 = no items, 1 = flat items, 2 = one sub-menu level, … `root` names
 * the field whose lists are themselves the first level (a context menu's `targets`: each target's entries are level 1,
 * their `items` level 2), so every menu type counts the same way: 1 = flat, 2 = one sub-menu level.
 */
export function assetDepth(data, root = '') {
  const level = (list) => (list.length ? 1 + list.reduce((m, y) => Math.max(m, walk(y)), 0) : 1);
  const atRoot = (v) => (Array.isArray(v) ? level(v) : isObj(v) ? Object.values(v).reduce((m, x) => Math.max(m, atRoot(x)), 0) : 0);
  const walk = (v) => {
    if (Array.isArray(v)) return v.reduce((m, x) => Math.max(m, walk(x)), 0);
    if (!isObj(v)) return 0;
    let best = 0;
    for (const [k, x] of Object.entries(v)) {
      if (root && k === root) best = Math.max(best, atRoot(x));
      else if (k === 'items' && Array.isArray(x)) best = Math.max(best, level(x));
      else best = Math.max(best, walk(x));
    }
    return best;
  };
  return walk(data);
}

/** Measure an asset against a limit declaration: depth, or the length of the named array field. */
export function measureAsset(data, lim) {
  if (!lim) return 0;
  if (lim.measure === 'depth') return assetDepth(data, lim.root);
  const v = isObj(data) ? data[lim.field] : undefined;
  return Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;
}

/* ---------------------------------------------------------------- a generated skin against the config */

const THEMES = { layoutTheme: 'layout', colorTheme: 'color-theme', styleTheme: 'style-theme' };
/** Every slot a skin names, themes included (plain twin of skin.ts `skinSlots`). */
export function slotsOfSkin(skin) {
  const d = isObj(skin) ? skin : {};
  const out = {};
  for (const [k, v] of Object.entries(isObj(d.assets) ? d.assets : {})) if (typeof v === 'string' && v) out[k] = v;
  for (const [k, t] of Object.entries(THEMES)) if (typeof d[k] === 'string' && d[k]) out[t] = d[k];
  return out;
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const get = (o, path) => path.split('.').reduce((v, k) => (isObj(v) ? v[k] : undefined), o);

/**
 * Every way a generated skin differs from the Default skin, each with the option that governs it and that option's
 * mode. `skin` / `base` are skin@1 data; `assetOf(type, id)` (optional) gives an asset's data so field changes and
 * limits can be measured: a slot that moved to an asset both sides can read is compared field by field, a slot the
 * AI filled with a new asset is measured against the type's limits. Rows: `{ path, mode, what, from, to }`;
 * a limit row carries `limit`, `value`, `max`.
 */
export function skinChangeReport(skin, base, config, tree, assetOf = null) {
  const rows = [];
  const push = (type, group, option, what, from, to, extra = {}) => { if (findOption(tree, type, group, option)) rows.push({ path: `${type}/${group}/${option}`, mode: optionMode(config, type, group, option), what, from: from ?? null, to: to ?? null, ...extra }); };
  const s = isObj(skin) ? skin : {}; const b = isObj(base) ? base : {};
  const ss = slotsOfSkin(s); const bs = slotsOfSkin(b);
  for (const type of new Set([...Object.keys(bs), ...Object.keys(ss)])) {
    if (ss[type] === bs[type]) continue;
    push(type, 'pick', 'asset', `${type}: ${bs[type] ?? 'none'} → ${ss[type] ?? 'none'}`, bs[type], ss[type]);
    const cat = findCategory(tree, type);
    if (!cat || !assetOf) continue;
    const to = ss[type] ? assetOf(type, ss[type]) : null;
    const from = bs[type] ? assetOf(type, bs[type]) : null;
    const grp = cat.groups.find((g) => g.id === 'fields');
    if (grp && isObj(to) && isObj(from)) for (const o of grp.options) { const a = get(from, o.id); const z = get(to, o.id); if (!same(a, z)) push(type, 'fields', o.id, `${type}.${o.id} changed`, a, z); }
    if (isObj(to)) for (const lim of cat.limits) {
      const value = measureAsset(to, lim);
      const max = limitValue(config, tree, type, lim.id);
      if (value > max) rows.push({ path: `${type}/limits/${lim.id}`, mode: 'lock', what: `${type} ${ss[type]}: ${lim.label.toLowerCase()} ${value} is over the limit ${max}`, from: bs[type] ?? null, to: ss[type], limit: lim.id, value, max });
    }
  }
  if ((s.iconPack ?? '') !== (b.iconPack ?? '')) push('icon-pack', 'pick', 'iconPack', `icon pack: ${b.iconPack ?? 'none'} → ${s.iconPack ?? 'none'}`, b.iconPack, s.iconPack);
  const sp = isObj(s.parts) ? s.parts : {}; const bp = isObj(b.parts) ? b.parts : {};
  for (const type of new Set([...Object.keys(bp), ...Object.keys(sp)])) {
    const cat = findCategory(tree, type);
    if (!cat) continue;
    const a = isObj(bp[type]) ? bp[type] : {}; const z = isObj(sp[type]) ? sp[type] : {};
    for (const token of new Set([...Object.keys(a), ...Object.keys(z)])) {
      if (same(a[token], z[token])) continue;
      const grp = cat.groups.find((g) => g.kind === 'parts' && g.options.some((o) => o.id === token));
      if (grp) push(type, grp.id, token, `${type} part ${token}: ${a[token] ?? 'theme'} → ${z[token] ?? 'theme'}`, a[token], z[token]);
    }
  }
  const sx = isObj(s.extras) ? s.extras : {}; const bx = isObj(b.extras) ? b.extras : {};
  const sh = isObj(sx.hidden) ? sx.hidden : {}; const bh = isObj(bx.hidden) ? bx.hidden : {};
  for (const type of new Set([...Object.keys(bh), ...Object.keys(sh)])) if (sh[type] !== bh[type]) push(type, 'chrome', 'hidden', `${type}: ${bh[type] === undefined ? 'as the app has it' : bh[type] ? 'hidden' : 'shown'} → ${sh[type] === undefined ? 'as the app has it' : sh[type] ? 'hidden' : 'shown'}`, bh[type], sh[type]);
  if ((sx.spacing ?? '') !== (bx.spacing ?? '')) push(SKIN_CONFIG_EXTRAS, 'look', 'spacing', `spacing: ${bx.spacing ?? 'as the app has it'} → ${sx.spacing ?? 'as the app has it'}`, bx.spacing, sx.spacing);
  if (!same(sx.settings ?? {}, bx.settings ?? {})) push(SKIN_CONFIG_EXTRAS, 'look', 'settings', 'look settings and token overrides changed', bx.settings ?? {}, sx.settings ?? {});
  return rows;
}

/**
 * Hold a generated skin to the config: every `lock` change goes back to what the Default skin has (a slot, a part, a
 * hidden flag, spacing, the settings, the icon pack; a slot whose new asset is over a limit goes back too), every `ask`
 * change stays in the skin but is listed for Brett, a locked field of a new asset becomes a patch for the caller to
 * apply to that asset. `{ skin, kept, asks, patches, allowed }`.
 */
export function mergeWithDefault(skin, base, config, tree, assetOf = null) {
  const rows = skinChangeReport(skin, base, config, tree, assetOf);
  const s = isObj(skin) ? skin : {}; const b = isObj(base) ? base : {};
  const out = { ...s, assets: { ...(isObj(s.assets) ? s.assets : {}) } };
  if (isObj(s.parts)) out.parts = Object.fromEntries(Object.entries(s.parts).map(([t, v]) => [t, { ...v }]));
  if (isObj(s.extras)) out.extras = { ...s.extras, ...(isObj(s.extras.hidden) ? { hidden: { ...s.extras.hidden } } : {}) };
  const kept = []; const asks = []; const patches = []; const allowed = [];
  const bs = slotsOfSkin(b);
  const revertSlot = (type) => {
    const themeKey = Object.keys(THEMES).find((k) => THEMES[k] === type);
    if (themeKey) out[themeKey] = bs[type] ?? '';
    else if (bs[type]) out.assets[type] = bs[type]; else delete out.assets[type];
  };
  for (const r of rows) {
    if (r.mode === 'allow') { allowed.push(r); continue; }
    if (r.mode === 'ask') { asks.push(r); continue; }
    kept.push(r);
    const [type, group, option] = r.path.split('/');
    if (group === 'limits') { revertSlot(type); continue; }
    if (group === 'pick') { if (type === 'icon-pack' && option === 'iconPack') { if (b.iconPack) out.iconPack = b.iconPack; else delete out.iconPack; } else revertSlot(type); continue; }
    if (group === 'fields') { patches.push({ type, id: slotsOfSkin(out)[type] ?? '', field: option, value: r.from }); continue; }
    if (group.startsWith('parts.')) {
      out.parts ??= {};
      const p = { ...(out.parts[type] ?? {}) };
      if (r.from === null || r.from === undefined) delete p[option]; else p[option] = r.from;
      if (Object.keys(p).length) out.parts[type] = p; else delete out.parts[type];
      if (!Object.keys(out.parts).length) delete out.parts;
      continue;
    }
    if (group === 'chrome') {
      out.extras ??= {};
      const h = { ...(out.extras.hidden ?? {}) };
      if (r.from === null || r.from === undefined) delete h[type]; else h[type] = r.from;
      if (Object.keys(h).length) out.extras.hidden = h; else delete out.extras.hidden;
      continue;
    }
    if (type === SKIN_CONFIG_EXTRAS && option === 'spacing') { out.extras ??= {}; if (r.from) out.extras.spacing = r.from; else delete out.extras.spacing; continue; }
    if (type === SKIN_CONFIG_EXTRAS && option === 'settings') { out.extras ??= {}; if (r.from && Object.keys(r.from).length) out.extras.settings = r.from; else delete out.extras.settings; }
  }
  // a patch for a slot that was itself reverted is moot
  const finalSlots = slotsOfSkin(out);
  const livePatches = patches.filter((p) => p.id && finalSlots[p.type] === p.id);
  if (out.extras && !Object.keys(out.extras).length) delete out.extras;
  return { skin: out, kept, asks, patches: livePatches, allowed };
}

/* ---------------------------------------------------------------- the Default skin */

/**
 * The Default skin (Brett: "the current look is saved as the Default skin"): each app's saved look (app-look@1
 * `default`: slots, spacing, hidden chrome, look settings and token overrides) as a skin@1 asset, `default-<app>`,
 * named "Default", on the hub at `settings/skins/<app>.json`; the hub-wide level's is `default-global`, from the shared
 * appearance@1 document. It is derived, never edited by hand: the migration (`defaultSkinMigration`) writes it when it
 * is missing or differs from the look, and keeps it when it matches, so running it again changes nothing. It can't be
 * deleted (`skinDeleteError`); Restore to default puts the app back on the look it was made from (`restoreAppDefault`
 * resets to `default`, which is this skin's source), and the AI's generated skins are compared with it
 * (`skinChangeReport`, `mergeWithDefault`).
 */
export const DEFAULT_SKIN_NAME = 'Default';
export const DEFAULT_SKIN_PREFIX = 'default-';
export const DEFAULT_SKIN_PROJECT = 'shared';
const SKIN_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SKIN_THEMES = { layoutTheme: 'layout', colorTheme: 'color-theme', styleTheme: 'style-theme' };
const SPACINGS = ['tight', 'compact', 'regular'];

export const defaultSkinId = (app) => `${DEFAULT_SKIN_PREFIX}${str(app, 40)}`;
export const defaultSkinPath = (app) => `settings/skins/${app}.json`;
/** Is this asset an app's Default skin? (The marker, the type and the id all agree.) */
export function isDefaultSkin(asset) {
  return isObj(asset) && asset.type === 'skin' && asset.protected === true && typeof asset.id === 'string' && asset.id.startsWith(DEFAULT_SKIN_PREFIX) && asset.id === defaultSkinId(asset.app);
}
/** Why a skin can't be deleted ('' = it can). */
export function skinDeleteError(asset) {
  return isDefaultSkin(asset) ? `${asset.id} is the Default skin of ${asset.app}: the saved look Restore to default goes back to. It can't be deleted; save the current look as the Default again to replace it.` : '';
}
export const canDeleteSkin = (asset) => !skinDeleteError(asset);

/**
 * The Default skin of one app from a look part (`{ slots, spacing, hidden, settings }`: app-look@1 `default`, or the
 * shared appearance@1 document for `global`). `fill` gives the three themes when the look part has no slot for one
 * (the app's default design package); `never` = the slots a skin never sets. Deterministic: no clock, no author
 * stamp, so two runs over the same look are the same document.
 */
export function defaultSkinOf(app, lookPart, fill = {}, never = []) {
  const id = SKIN_ID.test(str(app, 40)) ? app : SKIN_CONFIG_GLOBAL;
  const lp = isObj(lookPart) ? lookPart : {};
  const slots = isObj(lp.slots) ? lp.slots : {};
  const data = {};
  for (const [field, type] of Object.entries(SKIN_THEMES)) { const v = slots[type] ?? (isObj(fill) ? fill[type] : ''); if (typeof v === 'string' && SKIN_ID.test(v)) data[field] = v; }
  data.assets = {};
  const themeTypes = Object.values(SKIN_THEMES);
  for (const [type, v] of Object.entries(slots)) if (typeof v === 'string' && SKIN_ID.test(v) && SKIN_ID.test(type) && !themeTypes.includes(type) && !never.includes(type)) data.assets[type] = v;
  const extras = {};
  if (SPACINGS.includes(lp.spacing)) extras.spacing = lp.spacing;
  if (isObj(lp.hidden)) { const h = {}; for (const [t, v] of Object.entries(lp.hidden)) if (typeof v === 'boolean') h[t] = v; if (Object.keys(h).length) extras.hidden = h; }
  if (isObj(lp.settings) && Object.keys(lp.settings).length) extras.settings = { ...lp.settings };
  if (Object.keys(extras).length) data.extras = extras;
  data.preview = { caption: id === SKIN_CONFIG_GLOBAL ? 'The hub-wide look as it was saved.' : `The look ${id} had when it was saved.` };
  return {
    $axf: 'asset@1',
    type: 'skin',
    id: defaultSkinId(id),
    name: DEFAULT_SKIN_NAME,
    version: '1.0.0',
    description: id === SKIN_CONFIG_GLOBAL ? 'The saved hub-wide look. Restore to default goes back to it; it cannot be deleted.' : `The saved look of ${id}. Restore to default goes back to it; it cannot be deleted.`,
    author: 'AmberX AXF',
    tags: ['default', 'skin'],
    roll: false,
    protected: true,
    app: id,
    data,
  };
}

/** What a Default skin lacks to be a skin@1 asset (the three themes). */
export function defaultSkinErrors(asset) {
  const d = isObj(asset) && isObj(asset.data) ? asset.data : {};
  const out = [];
  for (const [field, type] of Object.entries(SKIN_THEMES)) if (!SKIN_ID.test(str(d[field], 60))) out.push(`data.${field}: the saved look names no ${type} and the app's default design package gives none`);
  if (!isDefaultSkin(asset)) out.push('not a Default skin: protected, app and id default-<app> must agree');
  return out;
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/**
 * One app's idempotent migration step: `{ app, action, skin, why }` with `action` create (nothing on the hub yet),
 * update (the hub's copy differs from the look), keep (same document), or skip (the look can't make a skin: `why`).
 * `lookPart` = the look the Default is made from, `existing` = the hub's current Default skin document or null.
 */
export function defaultSkinMigration(app, lookPart, existing, fill = {}, never = []) {
  const skin = defaultSkinOf(app, lookPart, fill, never);
  const errors = defaultSkinErrors(skin);
  if (errors.length) return { app, action: 'skip', skin: null, why: errors.join('; ') };
  if (!isObj(existing)) return { app, action: 'create', skin, why: 'no Default skin on the hub yet' };
  const { updatedAt: _a, updatedBy: _b, ...rest } = existing;
  if (sameJson(rest, skin)) return { app, action: 'keep', skin: existing, why: 'the hub already has this look as the Default skin' };
  return { app, action: 'update', skin, why: isDefaultSkin(existing) ? 'the saved look changed since the Default skin was written' : 'the document on the hub is not a Default skin' };
}

/* ---------------------------------------------------------------- words for the AI and the API */

/**
 * Plain lines that tell the AI what it may change, what is locked and what to ask about, with the limits. Only the
 * exceptions to the document's default are spelled out (a whole category when every option in it agrees, a whole
 * group, else the option), so a config with three locks is three lines, not a thousand.
 */
export function skinConfigBrief(config, tree) {
  const eff = effectiveConfig(config, tree);
  const lines = [];
  const byMode = { allow: [], lock: [], ask: [] };
  const modeOf = (c, g, o) => eff.options[`${c.type}/${g.id}/${o.id}`].mode;
  for (const c of tree?.categories ?? []) {
    const all = c.groups.flatMap((g) => g.options.map((o) => modeOf(c, g, o)));
    if (all.length && all.every((m) => m === all[0])) { if (all[0] !== eff.default) byMode[all[0]].push(c.label); continue; }
    for (const g of c.groups) {
      const modes = g.options.map((o) => modeOf(c, g, o));
      if (modes.every((m) => m === modes[0])) { if (modes[0] !== eff.default) byMode[modes[0]].push(`${c.label} · ${g.label}`); continue; }
      for (const o of g.options) { const m = modeOf(c, g, o); if (m !== eff.default) byMode[m].push(`${c.label} · ${g.label} · ${o.label}`); }
    }
  }
  const words = { allow: 'You may change', lock: 'Locked, keep exactly as the Default skin has it', ask: 'Ask before changing (propose, do not apply)' };
  const rest = { allow: 'Everything else in the skin you may change.', lock: 'Everything else stays exactly as the Default skin has it.', ask: 'Everything else: propose the change and wait for Brett.' };
  for (const m of SKIN_CONFIG_MODES) if (byMode[m].length) lines.push(`${words[m]}: ${byMode[m].join('; ')}.`);
  lines.push(eff.counts.lock === 0 && eff.counts.ask === 0 ? 'You may change everything in the skin.' : rest[eff.default]);
  for (const c of tree?.categories ?? []) for (const l of c.limits) lines.push(`${c.label}: ${l.label.charAt(0).toLowerCase()}${l.label.slice(1)} at most ${eff.limits[`${c.type}/${l.id}`]}.`);
  return lines;
}

/** The JSON Schema of a skin-config@1 document over a tree (every category, group, option and limit enumerated). */
export function skinConfigSchema(tree) {
  const modeSchema = { $ref: '#/$defs/mode' };
  const categories = {};
  for (const c of tree?.categories ?? []) {
    const groups = {};
    for (const g of c.groups) groups[g.id] = { type: 'object', additionalProperties: false, properties: { mode: modeSchema, options: { type: 'object', additionalProperties: false, properties: Object.fromEntries(g.options.map((o) => [o.id, modeSchema])) } } };
    const limits = Object.fromEntries(c.limits.map((l) => [l.id, { type: 'integer', minimum: l.min, maximum: l.max, default: l.default, description: l.label }]));
    categories[c.type] = { type: 'object', additionalProperties: false, description: `${c.label} (${c.section})`, properties: { mode: modeSchema, groups: { type: 'object', additionalProperties: false, properties: groups }, ...(c.limits.length ? { limits: { type: 'object', additionalProperties: false, properties: limits } } : {}) } };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'axf/skin-config.schema.json',
    title: 'AmberX AXF skin-config@1: what the AI may change when it makes a skin',
    $defs: { mode: { enum: [...SKIN_CONFIG_MODES], description: 'allow = the AI may change it; lock = it stays as the Default skin has it; ask = the AI proposes, Brett decides' } },
    type: 'object',
    required: ['$axf', 'app'],
    additionalProperties: false,
    properties: {
      $axf: { const: SKIN_CONFIG_FRAME },
      app: { type: 'string', pattern: ID.source, description: `the app the config is for, or ${SKIN_CONFIG_GLOBAL} for the hub-wide level` },
      default: { ...modeSchema, default: SKIN_CONFIG_DEFAULT_MODE, description: 'the mode of every option not set below' },
      categories: { type: 'object', additionalProperties: false, properties: categories },
      updatedBy: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  };
}

/** The contract snapshot (`schemas/skin-config.json`): the vocabularies and the tree's shape, so a reader sees the whole contract without the engine. */
export function skinConfigSnapshot(tree) {
  return {
    schema: SKIN_CONFIG_CONTRACT,
    path: skinConfigPath('<app>'),
    modes: [...SKIN_CONFIG_MODES],
    defaultMode: SKIN_CONFIG_DEFAULT_MODE,
    groupKinds: [...SKIN_CONFIG_GROUP_KINDS],
    measures: [...SKIN_CONFIG_MEASURES],
    extrasCategory: SKIN_CONFIG_EXTRAS,
    global: SKIN_CONFIG_GLOBAL,
    summary: treeSummary(tree),
    categories: (tree?.categories ?? []).map((c) => ({ type: c.type, label: c.label, section: c.section, by: c.by, groups: c.groups.map((g) => ({ id: g.id, kind: g.kind, options: g.options.map((o) => o.id) })), limits: c.limits })),
  };
}
