/**
 * skin-slots@1 (build flagship-professional-skin-covering-2, Fable, Nov 17 2026). Brett: "build a skin with Fable
 * Ultra Code, really sick professional skin that covers everything: context menus, app menus, navigation menus,
 * animations, colors, behavior, hooks, everything."
 *
 * The five optional, additive slots of skin@1 that go past picking assets: how things move (`motion`), how chrome
 * behaves (`behavior`), which hooks and drop zones each chrome kind carries (`hooks`), how grids are laid out (`grid`),
 * and which dialog and settings chrome is in force (`dialog`, `settings`). Every slot is optional and every field inside
 * it is optional; an old skin without them normalises to exactly what it was and compiles to nothing, so today's
 * defaults stand (axf.css `:root`, the behaviour theme, the chrome-settings@1 field defaults).
 *
 * ONE rules file, plain JS, so the TS engine (skin.ts), the build engine's validator (cli/build-engine.mjs), the JSON
 * Schema generator, the skins CLI and the console server read the same rules:
 *
 *   normalize*     keep what the slot holds, drop anything malformed (never a crash)
 *   *Errors        what validators report (the TS reference and the mjs mirror push the same lines)
 *   skinMotionStyle         motion → { vars, attrs }: --fx-motion-* tokens + data-fx-motion-reduced (compileStyles part)
 *   skinBehaviorSettings    behaviour → settings-layer defaults (tap-confirm, feedback overrides, kind-wide chrome
 *                           defaults, nav collapsed)
 *   skinHookSettings        hooks → axf.hooks.<kind>; resolveSkinHooks says which refs a host knows (hook@1 / grid-hook@1 / lib-dnd)
 *   skinGridTokens / skinGridSettings   grid → component-tokens@1 grid paths under axf.tokens.style['*'] + axf.grid
 *   skinDialogSettings      dialog → axf.chrome.dialog (field overrides the runtime folds into dialogStyle)
 *   skinSettingsChrome      settings → the settings page slot + axf.chrome.settings.<kind> picks
 *   skinSlotsJsonSchemas    the JSON Schema of every slot (cli/build-engine.mjs writeSchemas)
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md); fixture spec/fixtures/skin.json (`slots` block).
 */
import { CHROME_FIELDS, CHROME_INSTANCE_KEY, CHROME_SETTINGS_PICK_KEY, CHROME_TYPES } from './chrome-settings-rules.mjs';

export const SKIN_SLOTS_CONTRACT = 'skin-slots@1';
/** The slots this file owns, in the order a table lists them. */
export const SKIN_SLOT_KEYS = ['motion', 'behavior', 'hooks', 'grid', 'dialog', 'settings'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const num = (v, [min, max]) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : undefined);
const inRange = (v, [min, max]) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/* ---------------------------------------------------------------- motion */

/** The three named speeds a skin may set, in ms. Defaults = what axf.css / the behaviour theme draw today. */
export const MOTION_SPEEDS = ['fast', 'normal', 'slow'];
export const MOTION_SPEED_DEFAULTS = { fast: 90, normal: 160, slow: 260 };
export const MOTION_SPEED_RANGE = [0, 2000];
/** Easing roles: the everyday curve, the one for emphasis (open, select), the one for leaving (close, dismiss). */
export const MOTION_EASING_ROLES = ['standard', 'emphasized', 'exit'];
/** Named curves (the behaviour theme's MOTION_EASE, same values; check-skin keeps them equal). */
export const MOTION_EASING_NAMES = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)',
  linear: 'linear',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
};
export const MOTION_REDUCED = ['system', 'always', 'never'];
/** Where enter / exit motion is set per kind: the six chrome kinds, dialogs, pop-ups, grids and page changes. */
export const MOTION_KINDS = [...CHROME_TYPES, 'dialog', 'popup', 'grid', 'page'];
export const MOTION_ENTERS = ['none', 'fade', 'rise', 'scale', 'slide'];
export const MOTION_STAGGER_RANGE = [0, 200];
const CUBIC = /^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$/;
const EASE_KEYWORDS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
/** Token names: --fx-motion-fast / -normal / -slow, --fx-motion-ease-<role>, --fx-motion-<kind>-enter / -exit / -dur / -stagger. */
export const motionSpeedVar = (speed) => `--fx-motion-${speed}`;
export const motionEaseVar = (role) => `--fx-motion-ease-${role}`;
export const motionKindVar = (kind, field) => `--fx-motion-${kind}-${field}`;
export const MOTION_REDUCED_ATTR = 'data-fx-motion-reduced';

/** Is `v` an easing a skin may name: one of MOTION_EASING_NAMES, a CSS keyword, or a cubic-bezier(...)? */
export const isEasing = (v) => typeof v === 'string' && (v in MOTION_EASING_NAMES || EASE_KEYWORDS.includes(v) || CUBIC.test(v));
/** The CSS timing function an easing value compiles to. */
export const easingCss = (v) => MOTION_EASING_NAMES[v] ?? v;

export function normalizeSkinMotion(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  if (isObj(raw.speed)) {
    const speed = {};
    for (const s of MOTION_SPEEDS) { const v = num(raw.speed[s], MOTION_SPEED_RANGE); if (v !== undefined) speed[s] = v; }
    if (Object.keys(speed).length) out.speed = speed;
  }
  if (isObj(raw.easing)) {
    const easing = {};
    for (const r of MOTION_EASING_ROLES) if (isEasing(raw.easing[r])) easing[r] = raw.easing[r];
    if (Object.keys(easing).length) out.easing = easing;
  }
  if (MOTION_REDUCED.includes(raw.reduced)) out.reduced = raw.reduced;
  if (isObj(raw.chrome)) {
    const chrome = {};
    for (const [kind, v] of Object.entries(raw.chrome)) {
      if (!MOTION_KINDS.includes(kind) || !isObj(v)) continue;
      const k = {};
      if (MOTION_ENTERS.includes(v.enter)) k.enter = v.enter;
      if (MOTION_ENTERS.includes(v.exit)) k.exit = v.exit;
      if (MOTION_SPEEDS.includes(v.duration)) k.duration = v.duration;
      const st = num(v.stagger, MOTION_STAGGER_RANGE); if (st !== undefined) k.stagger = st;
      if (Object.keys(k).length) chrome[kind] = k;
    }
    if (Object.keys(chrome).length) out.chrome = chrome;
  }
  return out;
}

export function skinMotionErrors(raw) {
  if (raw === undefined) return [];
  if (!isObj(raw)) return ['data.motion must be an object'];
  const out = [];
  if ('speed' in raw) {
    if (!isObj(raw.speed)) out.push('data.motion.speed must be an object (fast / normal / slow → ms)');
    else for (const [k, v] of Object.entries(raw.speed)) {
      if (!MOTION_SPEEDS.includes(k)) out.push(`data.motion.speed.${k}: not a speed (${MOTION_SPEEDS.join(', ')})`);
      else if (!inRange(v, MOTION_SPEED_RANGE)) out.push(`data.motion.speed.${k} must be a number from ${MOTION_SPEED_RANGE[0]} to ${MOTION_SPEED_RANGE[1]} (ms)`);
    }
  }
  if ('easing' in raw) {
    if (!isObj(raw.easing)) out.push('data.motion.easing must be an object (standard / emphasized / exit → easing)');
    else for (const [k, v] of Object.entries(raw.easing)) {
      if (!MOTION_EASING_ROLES.includes(k)) out.push(`data.motion.easing.${k}: not an easing role (${MOTION_EASING_ROLES.join(', ')})`);
      else if (!isEasing(v)) out.push(`data.motion.easing.${k} must be ${Object.keys(MOTION_EASING_NAMES).join(', ')}, a CSS easing keyword or cubic-bezier(...)`);
    }
  }
  if ('reduced' in raw && !MOTION_REDUCED.includes(raw.reduced)) out.push(`data.motion.reduced must be one of ${MOTION_REDUCED.join(', ')}`);
  if ('chrome' in raw) {
    if (!isObj(raw.chrome)) out.push('data.motion.chrome must be an object (kind → { enter, exit, duration, stagger })');
    else for (const [kind, v] of Object.entries(raw.chrome)) {
      if (!MOTION_KINDS.includes(kind)) { out.push(`data.motion.chrome.${kind}: not a motion kind (${MOTION_KINDS.join(', ')})`); continue; }
      if (!isObj(v)) { out.push(`data.motion.chrome.${kind} must be an object`); continue; }
      for (const f of ['enter', 'exit']) if (f in v && !MOTION_ENTERS.includes(v[f])) out.push(`data.motion.chrome.${kind}.${f} must be one of ${MOTION_ENTERS.join(', ')}`);
      if ('duration' in v && !MOTION_SPEEDS.includes(v.duration)) out.push(`data.motion.chrome.${kind}.duration must be one of ${MOTION_SPEEDS.join(', ')}`);
      if ('stagger' in v && !inRange(v.stagger, MOTION_STAGGER_RANGE)) out.push(`data.motion.chrome.${kind}.stagger must be a number from ${MOTION_STAGGER_RANGE[0]} to ${MOTION_STAGGER_RANGE[1]} (ms)`);
    }
  }
  return out;
}

/**
 * The style part a skin's motion compiles to: only what the skin sets (an unset field leaves the :root default in
 * axf.css). `prefersReduced` = the device asks for reduced motion; `reduced: always`, or `system` with the device asking,
 * zeroes every duration the skin names and stamps data-fx-motion-reduced="1"; `never` stamps "0" so the sheet ignores
 * the device. A skin that says nothing about reduced motion leaves the behaviour theme's rule alone.
 */
export function skinMotionStyle(raw, prefersReduced = false) {
  const m = normalizeSkinMotion(raw);
  const vars = {};
  const attrs = {};
  const reduced = m.reduced === 'always' || (m.reduced === 'system' && prefersReduced === true);
  for (const [s, ms] of Object.entries(m.speed ?? {})) vars[motionSpeedVar(s)] = reduced ? '0ms' : `${ms}ms`;
  for (const [r, e] of Object.entries(m.easing ?? {})) vars[motionEaseVar(r)] = easingCss(e);
  for (const [kind, k] of Object.entries(m.chrome ?? {})) {
    if (k.enter) vars[motionKindVar(kind, 'enter')] = reduced ? 'none' : k.enter;
    if (k.exit) vars[motionKindVar(kind, 'exit')] = reduced ? 'none' : k.exit;
    if (k.duration) vars[motionKindVar(kind, 'dur')] = reduced ? '0ms' : `var(${motionSpeedVar(k.duration)})`;
    if (k.stagger !== undefined) vars[motionKindVar(kind, 'stagger')] = reduced ? '0ms' : `${k.stagger}ms`;
  }
  if (m.reduced) attrs[MOTION_REDUCED_ATTR] = reduced ? '1' : '0';
  return { vars, attrs };
}

/* ---------------------------------------------------------------- behaviour */

/** The chrome kinds that tap to confirm (engines/tapconfirm.ts TAP_KINDS, the same set as chrome-settings@1). */
export const BEHAVIOR_TAP_KINDS = CHROME_TYPES;
export const BEHAVIOR_ARM_RANGE = [1000, 10000];
/** The feedback fields a skin may set over its behaviour theme (behavior.ts BEHAVIOR_ENUMS interaction.*; check-skin keeps them equal). */
export const BEHAVIOR_FEEDBACK_ENUMS = {
  hover: ['theme', 'none', 'tint', 'lift', 'glow', 'underline'],
  press: ['theme', 'none', 'shrink', 'darken', 'ripple'],
  focusRing: ['auto', 'always', 'never'],
};
/** Kind-wide defaults a skin may set: the chrome-settings@1 fields of that kind they map to. */
export const BEHAVIOR_OVERFLOW_KINDS = { 'tab-group': 'overflow' };
export const BEHAVIOR_STICKY_KINDS = { 'tab-group': 'sticky' };
export const BEHAVIOR_COLLAPSE_KINDS = { 'tab-group': 'collapsible', toolbar: 'collapsible', 'nav-menu': '' };
/** Settings keys (the toolbars plugin's keys for tap-to-confirm, tapconfirm.ts; the runtime's nav key). */
export const BEHAVIOR_ARM_KEY = 'axf.toolbars.armMs';
export const behaviorTapKindKey = (kind) => (kind === 'toolbar' ? 'axf.toolbars.tapConfirm' : `axf.tapConfirm.${kind}`);
/** Interaction overrides over the behaviour theme in force: `{ interaction: { hover, press, focusRing } }`. */
export const BEHAVIOR_OVERRIDES_KEY = 'axf.behavior';
/** Kind-wide chrome field defaults, read under every instance override (chrome-settings@1 `axf.chrome.<kind>.*`). */
export const CHROME_KIND_DEFAULTS_KEY = (kind) => CHROME_INSTANCE_KEY(kind, '*');
export const NAV_COLLAPSED_SETTING = 'axf.nav.collapsed';

const fieldOptions = (kind, field) => CHROME_FIELDS[kind]?.find((f) => f.key === field)?.options ?? [];

export function normalizeSkinBehavior(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  if (isObj(raw.tapConfirm)) {
    const t = {};
    const arm = num(raw.tapConfirm.armMs, BEHAVIOR_ARM_RANGE); if (arm !== undefined) t.armMs = arm;
    for (const k of BEHAVIOR_TAP_KINDS) if (raw.tapConfirm[k] === 'on' || raw.tapConfirm[k] === 'off') t[k] = raw.tapConfirm[k];
    if (Object.keys(t).length) out.tapConfirm = t;
  }
  for (const [f, allowed] of Object.entries(BEHAVIOR_FEEDBACK_ENUMS)) if (allowed.includes(raw[f])) out[f] = raw[f];
  if (isObj(raw.overflow)) {
    const o = {};
    for (const [k, field] of Object.entries(BEHAVIOR_OVERFLOW_KINDS)) if (fieldOptions(k, field).includes(raw.overflow[k])) o[k] = raw.overflow[k];
    if (Object.keys(o).length) out.overflow = o;
  }
  for (const [slot, kinds] of [['sticky', BEHAVIOR_STICKY_KINDS], ['collapse', BEHAVIOR_COLLAPSE_KINDS]]) {
    if (!isObj(raw[slot])) continue;
    const o = {};
    for (const k of Object.keys(kinds)) if (typeof raw[slot][k] === 'boolean') o[k] = raw[slot][k];
    if (Object.keys(o).length) out[slot] = o;
  }
  return out;
}

export function skinBehaviorErrors(raw) {
  if (raw === undefined) return [];
  if (!isObj(raw)) return ['data.behavior must be an object'];
  const out = [];
  if ('tapConfirm' in raw) {
    if (!isObj(raw.tapConfirm)) out.push('data.behavior.tapConfirm must be an object ({ armMs, <kind>: on | off })');
    else for (const [k, v] of Object.entries(raw.tapConfirm)) {
      if (k === 'armMs') { if (!inRange(v, BEHAVIOR_ARM_RANGE)) out.push(`data.behavior.tapConfirm.armMs must be a number from ${BEHAVIOR_ARM_RANGE[0]} to ${BEHAVIOR_ARM_RANGE[1]} (ms)`); }
      else if (!BEHAVIOR_TAP_KINDS.includes(k)) out.push(`data.behavior.tapConfirm.${k}: not a tap-to-confirm kind (${BEHAVIOR_TAP_KINDS.join(', ')})`);
      else if (v !== 'on' && v !== 'off') out.push(`data.behavior.tapConfirm.${k} must be on or off`);
    }
  }
  for (const [f, allowed] of Object.entries(BEHAVIOR_FEEDBACK_ENUMS)) if (f in raw && !allowed.includes(raw[f])) out.push(`data.behavior.${f} must be one of ${allowed.join(', ')}`);
  if ('overflow' in raw) {
    if (!isObj(raw.overflow)) out.push('data.behavior.overflow must be an object (kind → mode)');
    else for (const [k, v] of Object.entries(raw.overflow)) {
      if (!(k in BEHAVIOR_OVERFLOW_KINDS)) out.push(`data.behavior.overflow.${k}: no overflow default for this kind (${Object.keys(BEHAVIOR_OVERFLOW_KINDS).join(', ')})`);
      else if (!fieldOptions(k, BEHAVIOR_OVERFLOW_KINDS[k]).includes(v)) out.push(`data.behavior.overflow.${k} must be one of ${fieldOptions(k, BEHAVIOR_OVERFLOW_KINDS[k]).join(', ')}`);
    }
  }
  for (const [slot, kinds] of [['sticky', BEHAVIOR_STICKY_KINDS], ['collapse', BEHAVIOR_COLLAPSE_KINDS]]) {
    if (!(slot in raw)) continue;
    if (!isObj(raw[slot])) { out.push(`data.behavior.${slot} must be an object (kind → true / false)`); continue; }
    for (const [k, v] of Object.entries(raw[slot])) {
      if (!(k in kinds)) out.push(`data.behavior.${slot}.${k}: no ${slot} default for this kind (${Object.keys(kinds).join(', ')})`);
      else if (typeof v !== 'boolean') out.push(`data.behavior.${slot}.${k} must be true or false`);
    }
  }
  return out;
}

/**
 * The settings-layer defaults a skin's behaviour puts in force (they land in the composed look's settings, under the
 * app's own picks like every other look setting): tap-to-confirm (`axf.toolbars.armMs`, the per-kind switches), the
 * feedback overrides (`axf.behavior`), kind-wide chrome field defaults (`axf.chrome.<kind>.*`: overflow, sticky,
 * collapsible) and the nav collapsed default.
 */
export function skinBehaviorSettings(raw) {
  const b = normalizeSkinBehavior(raw);
  const out = {};
  if (b.tapConfirm) {
    if (b.tapConfirm.armMs !== undefined) out[BEHAVIOR_ARM_KEY] = b.tapConfirm.armMs;
    for (const k of BEHAVIOR_TAP_KINDS) if (b.tapConfirm[k]) out[behaviorTapKindKey(k)] = b.tapConfirm[k] === 'on';
  }
  const feedback = {};
  for (const f of Object.keys(BEHAVIOR_FEEDBACK_ENUMS)) if (b[f]) feedback[f] = b[f];
  if (Object.keys(feedback).length) out[BEHAVIOR_OVERRIDES_KEY] = { interaction: feedback };
  const kinds = {};
  const put = (kind, field, value) => { if (!field) return; (kinds[kind] ??= {})[field] = value; };
  for (const [k, v] of Object.entries(b.overflow ?? {})) put(k, BEHAVIOR_OVERFLOW_KINDS[k], v);
  for (const [k, v] of Object.entries(b.sticky ?? {})) put(k, BEHAVIOR_STICKY_KINDS[k], v);
  for (const [k, v] of Object.entries(b.collapse ?? {})) { if (k === 'nav-menu') out[NAV_COLLAPSED_SETTING] = v; else put(k, BEHAVIOR_COLLAPSE_KINDS[k], v); }
  for (const [k, fields] of Object.entries(kinds)) out[CHROME_KIND_DEFAULTS_KEY(k)] = fields;
  return out;
}

/* ---------------------------------------------------------------- hooks */

/** Where hooks attach: the six chrome kinds and grid rows (grid-hook@1). An open list. */
export const HOOK_KINDS = [...CHROME_TYPES, 'grid-row'];
export const HOOK_REF_CONTRACT = 'hook@1';
const HOOK_ID = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;
const SCALAR = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
export const HOOKS_KEY = (kind) => `axf.hooks.${kind}`;
export const isHookId = (v) => typeof v === 'string' && HOOK_ID.test(v);

/** One ref: a string id or `{ id, args? }` (args = scalars only); null when it is neither. */
export function normalizeHookRef(raw) {
  if (isHookId(raw)) return { id: raw };
  if (!isObj(raw) || !isHookId(raw.id)) return null;
  const ref = { id: raw.id };
  if (isObj(raw.args)) {
    const args = {};
    for (const [k, v] of Object.entries(raw.args)) if (/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(k) && SCALAR(v)) args[k] = v;
    if (Object.keys(args).length) ref.args = args;
  }
  return ref;
}

export function normalizeSkinHooks(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [kind, v] of Object.entries(raw)) {
    if (!HOOK_KINDS.includes(kind) || !isObj(v)) continue;
    const k = {};
    if (Array.isArray(v.hooks)) { const hooks = v.hooks.map(normalizeHookRef).filter(Boolean); if (hooks.length) k.hooks = hooks; }
    if (Array.isArray(v.drop)) { const drop = v.drop.filter(isHookId); if (drop.length) k.drop = drop; }
    if (Object.keys(k).length) out[kind] = k;
  }
  return out;
}

export function skinHooksErrors(raw) {
  if (raw === undefined) return [];
  if (!isObj(raw)) return ['data.hooks must be an object (kind → { hooks, drop })'];
  const out = [];
  for (const [kind, v] of Object.entries(raw)) {
    if (!HOOK_KINDS.includes(kind)) { out.push(`data.hooks.${kind}: not a hook kind (${HOOK_KINDS.join(', ')})`); continue; }
    if (!isObj(v)) { out.push(`data.hooks.${kind} must be an object`); continue; }
    if ('hooks' in v) {
      if (!Array.isArray(v.hooks)) out.push(`data.hooks.${kind}.hooks must be an array of hook@1 refs`);
      else v.hooks.forEach((h, i) => { if (!normalizeHookRef(h)) out.push(`data.hooks.${kind}.hooks[${i}] must be a hook id or { id, args? }`); });
    }
    if ('drop' in v) {
      if (!Array.isArray(v.drop)) out.push(`data.hooks.${kind}.drop must be an array of drop zone ids`);
      else v.drop.forEach((d, i) => { if (!isHookId(d)) out.push(`data.hooks.${kind}.drop[${i}] must be a drop zone id`); });
    }
  }
  return out;
}

/** The settings a skin's hooks put in force: `axf.hooks.<kind>` = { hooks, drop }. */
export function skinHookSettings(raw) {
  const h = normalizeSkinHooks(raw);
  const out = {};
  for (const [kind, v] of Object.entries(h)) out[HOOKS_KEY(kind)] = { hooks: v.hooks ?? [], drop: v.drop ?? [] };
  return out;
}

/**
 * Resolve a skin's hook refs against what a host knows: `registry` = `{ hook?(id) → boolean, zone?(id) → boolean }`
 * (hook@1 ids and grid-hook@1 row hooks through `hook`, lib-dnd zones through `zone`; a missing function knows nothing).
 * Returns every ref with `known`, and `unknown` = the `kind:id` list a host should report (never a crash: a skin may
 * name a hook a plugin has not registered yet).
 */
export function resolveSkinHooks(raw, registry = {}) {
  const h = normalizeSkinHooks(raw);
  const knows = (fn, id) => (typeof fn === 'function' ? fn(id) === true : false);
  const out = { kinds: {}, unknown: [] };
  for (const [kind, v] of Object.entries(h)) {
    const hooks = (v.hooks ?? []).map((r) => ({ ...r, known: knows(registry.hook, r.id) }));
    const drop = (v.drop ?? []).map((id) => ({ id, known: knows(registry.zone, id) }));
    out.kinds[kind] = { hooks, drop };
    for (const r of hooks) if (!r.known) out.unknown.push(`${kind}:${r.id}`);
    for (const d of drop) if (!d.known) out.unknown.push(`${kind}:drop:${d.id}`);
  }
  return out;
}

/* ---------------------------------------------------------------- grid */

export const GRID_DENSITIES = ['compact', 'regular', 'roomy'];
export const GRID_ROWS_RANGE = [1, 6];
export const GRID_HEADERS = ['plain', 'bold', 'boxed', 'hidden'];
export const GRID_LINES = ['none', 'rows', 'cells'];
export const GRID_FIELDS = ['density', 'rows', 'header', 'zebra', 'lines', 'sticky'];
/** The settings key the DataGrid reads for its attributes (data-fx-grid-header, data-fx-grid-lines, data-fx-grid-density). */
export const GRID_KEY = 'axf.grid';
/** The control@1 token set the grid paths land in (control-tokens.mjs CONTROL_TOKEN_SLOTS['tokens.style'].key). */
export const STYLE_TOKENS_KEY = 'axf.tokens.style';
const DENSITY_PAD = { compact: { y: 'var(--fx-dens-gap-xs)', x: 'var(--fx-dens-gap-sm)' }, regular: { y: 'var(--fx-size-table-pad-y)', x: 'var(--fx-size-table-pad-x)' }, roomy: { y: 'var(--fx-dens-gap-md)', x: 'var(--fx-dens-gap-lg)' } };

export function normalizeSkinGrid(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  if (GRID_DENSITIES.includes(raw.density)) out.density = raw.density;
  const rows = num(raw.rows, GRID_ROWS_RANGE); if (rows !== undefined) out.rows = rows;
  if (GRID_HEADERS.includes(raw.header)) out.header = raw.header;
  if (typeof raw.zebra === 'boolean') out.zebra = raw.zebra;
  if (GRID_LINES.includes(raw.lines)) out.lines = raw.lines;
  if (typeof raw.sticky === 'boolean') out.sticky = raw.sticky;
  return out;
}

export function skinGridErrors(raw) {
  if (raw === undefined) return [];
  if (!isObj(raw)) return ['data.grid must be an object'];
  const out = [];
  for (const k of Object.keys(raw)) if (!GRID_FIELDS.includes(k)) out.push(`data.grid.${k}: not a grid field (${GRID_FIELDS.join(', ')})`);
  if ('density' in raw && !GRID_DENSITIES.includes(raw.density)) out.push(`data.grid.density must be one of ${GRID_DENSITIES.join(', ')}`);
  if ('rows' in raw && !inRange(raw.rows, GRID_ROWS_RANGE)) out.push(`data.grid.rows must be a number from ${GRID_ROWS_RANGE[0]} to ${GRID_ROWS_RANGE[1]}`);
  if ('header' in raw && !GRID_HEADERS.includes(raw.header)) out.push(`data.grid.header must be one of ${GRID_HEADERS.join(', ')}`);
  if ('zebra' in raw && typeof raw.zebra !== 'boolean') out.push('data.grid.zebra must be true or false');
  if ('lines' in raw && !GRID_LINES.includes(raw.lines)) out.push(`data.grid.lines must be one of ${GRID_LINES.join(', ')}`);
  if ('sticky' in raw && typeof raw.sticky !== 'boolean') out.push('data.grid.sticky must be true or false');
  return out;
}

/** The component-tokens@1 grid paths a skin's grid sets (`grid.<token>` → value), only for the fields it names. */
export function skinGridTokens(raw) {
  const g = normalizeSkinGrid(raw);
  const out = {};
  if (g.density) { out['grid.cellPadY'] = DENSITY_PAD[g.density].y; out['grid.cellPadX'] = DENSITY_PAD[g.density].x; }
  if (g.rows !== undefined) out['grid.rowHeight'] = g.rows === 1 ? 'var(--fx-row-h)' : `calc(var(--fx-row-h) * ${g.rows})`;
  if (g.header === 'plain') { out['grid.headerWeight'] = 500; out['grid.headerBg'] = 'transparent'; out['grid.tableHeaderBg'] = 'transparent'; }
  if (g.header === 'bold') { out['grid.headerWeight'] = 700; }
  if (g.header === 'boxed') { out['grid.headerWeight'] = 600; out['grid.headerBg'] = 'surface3'; out['grid.tableHeaderBg'] = 'surface3'; out['grid.headerBorder'] = 'border'; }
  if (g.header === 'hidden') { out['grid.headerBg'] = 'transparent'; out['grid.tableHeaderBg'] = 'transparent'; out['grid.headerBorder'] = 'transparent'; }
  if (g.zebra !== undefined) out['grid.rowAltBg'] = g.zebra ? 'surface2' : 'transparent';
  if (g.lines === 'none') out['grid.lineColor'] = 'transparent';
  if (g.lines === 'rows' || g.lines === 'cells') out['grid.lineColor'] = 'border';
  if (g.sticky !== undefined) out['grid.stickyShadow'] = g.sticky ? 'shadow.sm' : 'none';
  return out;
}

/**
 * The settings a skin's grid puts in force: the grid paths merged into `axf.tokens.style['*']` over `existing` (what
 * `extras.settings` already carries for that key), and `axf.grid` with the plain fields for the DataGrid's attributes.
 */
export function skinGridSettings(raw, existing) {
  const g = normalizeSkinGrid(raw);
  if (!Object.keys(g).length) return {};
  const tokens = skinGridTokens(g);
  const base = isObj(existing) ? existing : {};
  const all = { ...(isObj(base['*']) ? base['*'] : {}), ...tokens };
  return { [STYLE_TOKENS_KEY]: { ...base, '*': all }, [GRID_KEY]: g };
}

/* ---------------------------------------------------------------- dialog chrome */

/** The dialog asset's own fields (asset-types.json dialog enums; check-skin keeps them equal). */
export const DIALOG_ENUMS = { variant: ['modal', 'drawer', 'sheet'], backdrop: ['dim', 'blur', 'none'], animation: ['scale', 'slide', 'fade'], header: ['plain', 'accent-bar', 'filled'] };
export const DIALOG_WIDTH_RANGE = [240, 1600];
export const DIALOG_FIELDS = [...Object.keys(DIALOG_ENUMS), 'closeOnBackdrop', 'width'];
/** Field overrides over the active dialog asset (the runtime folds them into dialogStyle). */
export const DIALOG_KEY = 'axf.chrome.dialog';

export function normalizeSkinDialog(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [f, allowed] of Object.entries(DIALOG_ENUMS)) if (allowed.includes(raw[f])) out[f] = raw[f];
  if (typeof raw.closeOnBackdrop === 'boolean') out.closeOnBackdrop = raw.closeOnBackdrop;
  const w = num(raw.width, DIALOG_WIDTH_RANGE); if (w !== undefined) out.width = w;
  return out;
}

export function skinDialogErrors(raw) {
  if (raw === undefined) return [];
  if (!isObj(raw)) return ['data.dialog must be an object'];
  const out = [];
  for (const k of Object.keys(raw)) if (!DIALOG_FIELDS.includes(k)) out.push(`data.dialog.${k}: not a dialog field (${DIALOG_FIELDS.join(', ')})`);
  for (const [f, allowed] of Object.entries(DIALOG_ENUMS)) if (f in raw && !allowed.includes(raw[f])) out.push(`data.dialog.${f} must be one of ${allowed.join(', ')}`);
  if ('closeOnBackdrop' in raw && typeof raw.closeOnBackdrop !== 'boolean') out.push('data.dialog.closeOnBackdrop must be true or false');
  if ('width' in raw && !inRange(raw.width, DIALOG_WIDTH_RANGE)) out.push(`data.dialog.width must be a number from ${DIALOG_WIDTH_RANGE[0]} to ${DIALOG_WIDTH_RANGE[1]}`);
  return out;
}

/** The setting a skin's dialog chrome puts in force: `axf.chrome.dialog` = the field overrides. */
export function skinDialogSettings(raw) {
  const d = normalizeSkinDialog(raw);
  return Object.keys(d).length ? { [DIALOG_KEY]: d } : {};
}

/* ---------------------------------------------------------------- settings chrome */

/** The settings slot's keys: the page (the app's settings page asset) and one settings interface per chrome kind. */
export const SETTINGS_CHROME_KEYS = ['page', ...CHROME_TYPES];
/** The appearance slot the page lands in. */
export const SETTINGS_PAGE_SLOT = 'settings';

export function normalizeSkinSettingsChrome(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of SETTINGS_CHROME_KEYS) if (typeof raw[k] === 'string' && ID.test(raw[k])) out[k] = raw[k];
  return out;
}

export function skinSettingsChromeErrors(raw) {
  if (raw === undefined) return [];
  if (!isObj(raw)) return ['data.settings must be an object (page / chrome kind → settings asset id)'];
  const out = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!SETTINGS_CHROME_KEYS.includes(k)) out.push(`data.settings.${k}: not page or a chrome kind (${SETTINGS_CHROME_KEYS.join(', ')})`);
    else if (typeof v !== 'string' || !ID.test(v)) out.push(`data.settings.${k} must be a settings asset id`);
  }
  return out;
}

/** What the settings slot puts in force: `{ slots: { settings: page }, settings: { 'axf.chrome.settings.<kind>': id } }`. */
export function skinSettingsChrome(raw) {
  const s = normalizeSkinSettingsChrome(raw);
  const slots = {};
  const settings = {};
  if (s.page) slots[SETTINGS_PAGE_SLOT] = s.page;
  for (const kind of CHROME_TYPES) if (s[kind]) settings[CHROME_SETTINGS_PICK_KEY(kind)] = s[kind];
  return { slots, settings };
}

/* ---------------------------------------------------------------- all five at once */

/** The five slots of a raw skin, normalised; a slot left with nothing is absent. */
export function normalizeSkinSlots(raw) {
  const d = isObj(raw) ? raw : {};
  const out = {};
  const put = (k, v) => { if (Object.keys(v).length) out[k] = v; };
  put('motion', normalizeSkinMotion(d.motion));
  put('behavior', normalizeSkinBehavior(d.behavior));
  put('hooks', normalizeSkinHooks(d.hooks));
  put('grid', normalizeSkinGrid(d.grid));
  put('dialog', normalizeSkinDialog(d.dialog));
  put('settings', normalizeSkinSettingsChrome(d.settings));
  return out;
}

/** Every validation message of the five slots (the TS reference and the build engine push the same lines). */
export function skinSlotsErrors(raw) {
  const d = isObj(raw) ? raw : {};
  return [...skinMotionErrors(d.motion), ...skinBehaviorErrors(d.behavior), ...skinHooksErrors(d.hooks), ...skinGridErrors(d.grid), ...skinDialogErrors(d.dialog), ...skinSettingsChromeErrors(d.settings)];
}

/**
 * The settings-layer part of the five slots: behaviour, hooks, grid, dialog and the settings-interface picks, merged in
 * that order (`existingStyle` = the `axf.tokens.style` value the look already carries, so the grid adds to it). Motion
 * is a style part, not a setting (`skinMotionStyle`); the settings page is a slot (`skinSettingsChrome().slots`).
 */
export function skinSlotSettings(raw, existingStyle) {
  const d = isObj(raw) ? raw : {};
  return { ...skinBehaviorSettings(d.behavior), ...skinHookSettings(d.hooks), ...skinGridSettings(d.grid, existingStyle), ...skinDialogSettings(d.dialog), ...skinSettingsChrome(d.settings).settings };
}

/* ---------------------------------------------------------------- JSON Schema */

const idSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' };
const enumOf = (list) => ({ enum: [...list] });
const range = ([min, max]) => ({ type: 'number', minimum: min, maximum: max });
const objectOf = (properties, description) => ({ type: 'object', ...(description ? { description } : {}), properties, additionalProperties: false });

/** The JSON Schema of each slot (skin.schema.json `data` properties; cli/build-engine.mjs writeSchemas). */
export function skinSlotsJsonSchemas() {
  const easing = { anyOf: [enumOf(Object.keys(MOTION_EASING_NAMES)), enumOf(EASE_KEYWORDS), { type: 'string', pattern: '^cubic-bezier\\(' }] };
  const motionKind = objectOf({ enter: enumOf(MOTION_ENTERS), exit: enumOf(MOTION_ENTERS), duration: enumOf(MOTION_SPEEDS), stagger: range(MOTION_STAGGER_RANGE) });
  const hookRef = { anyOf: [{ type: 'string', pattern: HOOK_ID.source }, objectOf({ id: { type: 'string', pattern: HOOK_ID.source }, args: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } } })] };
  const hookKind = objectOf({ hooks: { type: 'array', items: hookRef }, drop: { type: 'array', items: { type: 'string', pattern: HOOK_ID.source } } });
  return {
    motion: objectOf({
      speed: objectOf(Object.fromEntries(MOTION_SPEEDS.map((s) => [s, range(MOTION_SPEED_RANGE)]))),
      easing: objectOf(Object.fromEntries(MOTION_EASING_ROLES.map((r) => [r, easing]))),
      reduced: enumOf(MOTION_REDUCED),
      chrome: objectOf(Object.fromEntries(MOTION_KINDS.map((k) => [k, motionKind]))),
    }, 'skin-slots@1 motion: durations, easings, enter / exit per chrome kind, reduced motion → --fx-motion-* tokens.'),
    behavior: objectOf({
      tapConfirm: objectOf({ armMs: range(BEHAVIOR_ARM_RANGE), ...Object.fromEntries(BEHAVIOR_TAP_KINDS.map((k) => [k, enumOf(['on', 'off'])])) }),
      ...Object.fromEntries(Object.entries(BEHAVIOR_FEEDBACK_ENUMS).map(([f, list]) => [f, enumOf(list)])),
      overflow: objectOf(Object.fromEntries(Object.entries(BEHAVIOR_OVERFLOW_KINDS).map(([k, f]) => [k, enumOf(fieldOptions(k, f))]))),
      sticky: objectOf(Object.fromEntries(Object.keys(BEHAVIOR_STICKY_KINDS).map((k) => [k, { type: 'boolean' }]))),
      collapse: objectOf(Object.fromEntries(Object.keys(BEHAVIOR_COLLAPSE_KINDS).map((k) => [k, { type: 'boolean' }]))),
    }, 'skin-slots@1 behaviour: settings-layer defaults (tap-to-confirm, hover / press / focus feedback, overflow, sticky, collapse).'),
    hooks: objectOf(Object.fromEntries(HOOK_KINDS.map((k) => [k, hookKind])), 'skin-slots@1 hooks: hook@1 refs and lib-dnd drop zones per chrome kind and grid row (ids only; axf.hooks.<kind>).'),
    grid: objectOf({ density: enumOf(GRID_DENSITIES), rows: range(GRID_ROWS_RANGE), header: enumOf(GRID_HEADERS), zebra: { type: 'boolean' }, lines: enumOf(GRID_LINES), sticky: { type: 'boolean' } }, 'skin-slots@1 grid: every grid and table at once → component-tokens@1 grid family (axf.tokens.style) + axf.grid.'),
    dialog: objectOf({ ...Object.fromEntries(Object.entries(DIALOG_ENUMS).map(([f, list]) => [f, enumOf(list)])), closeOnBackdrop: { type: 'boolean' }, width: range(DIALOG_WIDTH_RANGE) }, 'skin-slots@1 dialog chrome: field overrides over the active dialog asset (axf.chrome.dialog).'),
    settings: objectOf(Object.fromEntries(SETTINGS_CHROME_KEYS.map((k) => [k, idSchema])), 'skin-slots@1 settings chrome: the settings page asset and the settings interface per chrome-settings@1 kind (axf.chrome.settings.<kind>).'),
  };
}
