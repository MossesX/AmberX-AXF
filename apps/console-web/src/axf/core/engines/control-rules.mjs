/**
 * control@1 — one command schema for everything the Token control plugin lets an API, MCP tool or CLI change
 * (Brett, Nov 2 2026, build token-control s3): every token (colour theme, style theme, layout, typography, density,
 * sizing, look tokens, per-asset custom tokens, the active asset per slot), every AmberX entity (notes, to-dos, tasks
 * and their lists) and the planner (Plan Studio plans, orchestrator builds and their steps). Since build
 * console-commands (Brett, Nov 3 2026): the `console` domain, so a Claude session can load screens, dialogs and
 * settings tabs in Brett's open console, run its registered actions and go back (core/engines/console-commands.mjs
 * resolves and delivers them; the running console reports what it has).
 *
 * ONE registry: the ops, the targets (what each one is, the ops it takes, its paths and fields, its verbs), the
 * permissions, the effect of each op, the confirm rule for deletes, the result envelope, and the projections every
 * transport is generated from (`controlTools()` MCP tools, `controlRoutes()` REST routes, `controlCli()` CLI usage,
 * `controlSchema()` JSON Schema). Pure (no IO, no DOM); shared with the build engine, the console server and the CLI
 * like scale-rules.mjs and layout-rules.mjs. Kotlin twin deferred (Android on hold, spec/PORTING.md); Python mirrors
 * it in the Opus phase (the console's MCP server).
 *
 * A command:
 *   { $axf: 'control@1', op, target, path?, value?, action?, select?, confirm?, by?, reason? }
 *   op      list | get | set | reset | add | remove | act
 *   target  tokens.theme | tokens.style | tokens.layout | tokens.typography | tokens.density | tokens.sizing |
 *           tokens.look | tokens.custom | tokens.slots | amberx.items | amberx.lists | planner.plans | planner.builds |
 *           console.screens | console.dialogs | console.settings | console.actions | console.nav | console.clients
 *   path    the token id / entity id (get, set, reset, remove, act; reset without a path = everything of the target)
 *   value   what to set (set) or the new entity (add)
 *   action  the verb for `act` (per target: done, move, approve, step, …)
 *   select  filters for `list` (per target)
 *   confirm the confirm token a `remove` carries on its second call
 *   by, reason  who and why (audited on every write)
 *
 * The gate (the same order as INTEROP.md's): the target exists and takes the op (else not_found / invalid), the
 * caller's grants cover `control.<domain>.<read|write|delete>` (else denied; `control.*`, `control.<domain>.*` and
 * `*` are wildcards, and a remote caller never exceeds the app's own UAC role), the command validates (else
 * validation), and a destructive op (remove) runs only with a valid confirm token: the first call answers
 * confirmation_required with the token to send back; a token is bound to the exact command and lives ten minutes.
 */
import { SCALE_FIELDS, SCALE_ENUMS, scaleErrors } from './scale-rules.mjs';
import { LAYOUT_ENUMS, LAYOUT_FIELDS, LAYOUT_SWITCHES, layoutErrors, layoutToken } from './layout-rules.mjs';

export const CONTROL_FRAME = 'control@1';
export const CONTROL_OPS = ['list', 'get', 'set', 'reset', 'add', 'remove', 'act'];
export const CONTROL_DOMAINS = ['tokens', 'amberx', 'planner', 'console'];
/** What each op does to the world (the MCP annotations and the permission it needs come from this). */
export const CONTROL_EFFECT = { list: 'read', get: 'read', set: 'write', reset: 'write', add: 'write', remove: 'destructive', act: 'write' };
/** Permission suffix per effect: control.<domain>.<suffix>. `navigate` (open a screen, go back) changes what a screen
 *  shows and no data; only targets that declare it in `actEffect` have it. */
export const CONTROL_PERMISSION_SUFFIX = { read: 'read', write: 'write', destructive: 'delete', navigate: 'navigate' };
/** Domains whose acts may navigate (they get a control.<domain>.navigate permission). */
const NAVIGATING_DOMAINS = ['console'];
/** The permission grammar (declared in an app's uac-policy; `control.*` = everything). */
export const CONTROL_PERMISSIONS = Object.fromEntries([
  ...CONTROL_DOMAINS.flatMap((d) => ['read', 'write', 'delete'].map((s) => [`control.${d}.${s}`, `${d}: ${s}`])),
  ...NAVIGATING_DOMAINS.map((d) => [`control.${d}.navigate`, `${d}: navigate`]),
]);
/** Wire codes (INTEROP.md; never change meaning). */
export const CONTROL_WIRE = { INVALID: 'invalid', DENIED: 'denied', NOT_FOUND: 'not_found', VALIDATION: 'validation', CONFIRMATION_REQUIRED: 'confirmation_required', NOT_IMPLEMENTED: 'not_implemented', UNEXPECTED: 'unexpected' };
/** How long a confirm token is good for (ms), and the bucket it is computed in. */
export const CONTROL_CONFIRM_TTL_MS = 10 * 60 * 1000;
export const CONTROL_LIST_MAX = 500;
export const CONTROL_VALUE_MAX_BYTES = 64 * 1024;

/* ================================================================== field vocabularies */

const COLOR_TOKENS = ['bg', 'surface', 'surface2', 'surface3', 'text', 'muted', 'border', 'accent', 'accentText', 'accentSoft', 'danger', 'success', 'warning', 'info', 'focus', 'shadow'];
const STYLE_FIELDS = {
  fontFamily: 'string', fontDisplay: 'string', fontMono: 'string', fontSize: 'number', space: 'number', borderWidth: 'number', motion: 'number', blur: 'number', headingWeight: 'number', tracking: 'number',
  density: 'enum:compact,comfortable,spacious', 'radius.sm': 'number', 'radius.md': 'number', 'radius.lg': 'number', 'shadow.sm': 'string', 'shadow.md': 'string', 'shadow.lg': 'string',
  wrapGroups: 'boolean', opacityDisabled: 'number', opacityMuted: 'number', opacityHover: 'number', opacityTint: 'number', opacityScrim: 'number', opacityGlass: 'number',
};
const ITEM_KINDS = ['note', 'todo', 'task'];
const ITEM_FIELDS = { kind: `enum:${ITEM_KINDS.join(',')}`, list: 'string', title: 'string', text: 'string', summary: 'string', tags: 'string[]', pinned: 'boolean', starred: 'boolean', status: 'enum:open,doing,done', priority: 'enum:0,1,2,3', due: 'string', checklist: 'object[]', parent: 'string', order: 'number', url: 'string' };
const LIST_FIELDS = { name: 'string', parent: 'string|null', order: 'number', icon: 'string', aliases: 'string[]' };
const PLAN_FIELDS = { title: 'string', summary: 'string', goal: 'string', why: 'string', category: 'string', tags: 'string[]', project: 'string', profile: 'string', status: 'enum:idea,draft,parked,ready,building,done,dropped', priority: 'enum:P0,P1,P2,P3', targetDate: 'string', owner: 'string', steps: 'object[]', requirements: 'object[]', acceptance: 'object[]', decisions: 'object[]', questions: 'object[]', risks: 'object[]', outOfScope: 'object[]', links: 'object[]', body: 'string' };
const BUILD_FIELDS = { title: 'string', category: 'string', detail: 'string', status: 'enum:pending,running,waiting,blocked,failed,complete,archived', hidden: 'boolean', branch: 'string', pr: 'string', steps: 'object[]' };
const STEP_FIELDS = { text: 'string', title: 'string', model: 'enum:Fable,Opus', estimate: 'string', why: 'string', phase: 'string', group: 'string', files: 'string[]', checks: 'string[]', done: 'boolean', note: 'string' };

const CONSOLE_SELECT = { q: 'string', limit: 'number', client: 'string' };
const CONSOLE_DELIVERY = 'Every console act takes optional input.to: recent (default: the console used last), all (every open console of the caller) or a client id (console.clients lists them).';

const scalePaths = (type) => [...Object.keys(SCALE_FIELDS[type]), ...Object.keys(SCALE_ENUMS[type] ?? {})];
const TOKEN_OPS = ['list', 'get', 'set', 'reset'];
const ENTITY_OPS = ['list', 'get', 'set', 'add', 'remove', 'act'];

/**
 * The targets. `paths`: 'static' (the ids are known here: `controlPaths(target)`), 'host' (the running app lists them:
 * look tokens, custom tokens, slots) or 'entity' (ids are records). `fields`: what `set` may change / `add` may give.
 * `acts`: the verbs `act` takes, with the input each one wants. `select`: the filters `list` takes. Append-only.
 */
export const CONTROL_TARGETS = {
  'tokens.theme': { domain: 'tokens', label: 'Colour theme tokens', asset: 'color-theme', ops: TOKEN_OPS, paths: 'static', value: 'color', doc: 'One colour per token of the active colour theme (bg, surface, text, accent, …). A set is an override on the theme (kept per asset id); reset drops it.' },
  'tokens.style': { domain: 'tokens', label: 'Style theme tokens', asset: 'style-theme', ops: TOKEN_OPS, paths: 'static', value: 'field', doc: 'Fonts, base size, space unit, radii, border width, shadows, density, motion, blur, heading weight, tracking, transparencies of the active style theme.' },
  'tokens.layout': { domain: 'tokens', label: 'Layout tokens', asset: 'layout', ops: TOKEN_OPS, paths: 'static', value: 'field', doc: 'Every layout parameter (core/engines/layout-rules.mjs): nav / inspector sides and widths, chrome switches, content width, status height, region gap, main paddings, phone edge and nav item minimum, viewport cut-offs.' },
  'tokens.typography': { domain: 'tokens', label: 'Typography tokens', asset: 'typography', ops: TOKEN_OPS, paths: 'static', value: 'field', doc: 'typography@1: text scale, headings, weights, line heights, eyebrow, mono.' },
  'tokens.density': { domain: 'tokens', label: 'Density tokens', asset: 'density', ops: TOKEN_OPS, paths: 'static', value: 'field', doc: 'density@1: gaps, paddings, row heights.' },
  'tokens.sizing': { domain: 'tokens', label: 'Sizing tokens', asset: 'sizing', ops: TOKEN_OPS, paths: 'static', value: 'field', doc: 'sizing@1: buttons, icon buttons, chips, fields, tabs, segments, cards, list rows, count strips, tables, page heads.' },
  'tokens.look': { domain: 'tokens', label: 'Look tokens', ops: TOKEN_OPS, paths: 'host', value: 'host', doc: 'look@1 (core/engines/looktokens.ts): compact, row height, text size, corners, tone, motion, banner behaviour… The running app lists the ids; a set stores only what changed.' },
  'tokens.custom': { domain: 'tokens', label: 'Per-asset custom tokens', ops: TOKEN_OPS, paths: 'host', value: 'host', pathShape: '<asset type>.<token>[@<asset id>]', doc: 'asset-customize@1 (core/engines/customize.ts): the extra tokens of every customizable asset type (button.radius, toolbar.iconSet, …), shared or per asset id.' },
  'tokens.slots': { domain: 'tokens', label: 'Active asset per slot', ops: TOKEN_OPS, paths: 'host', value: 'asset-id', doc: 'Which asset is active for each appearance slot (color-theme, style-theme, layout, button, …): set = hot-swap (runtime.swap), reset = the app default. Shared through the axHub look like every other look change.' },
  'amberx.items': { domain: 'amberx', label: 'AmberX notes, to-dos and tasks', ops: ENTITY_OPS, paths: 'entity', fields: ITEM_FIELDS, select: { kind: `enum:${ITEM_KINDS.join(',')}`, list: 'string', deep: 'boolean', status: 'enum:open,doing,done,not-done', tag: 'string', q: 'string', pinned: 'boolean', starred: 'boolean', due: 'enum:overdue,today,upcoming,later,none', limit: 'number' }, acts: { done: {}, undone: {}, move: { list: 'string' }, merge: { ids: 'string[]' }, pin: { on: 'boolean' }, star: { on: 'boolean' }, check: { item: 'string', done: 'boolean' } }, doc: 'amberx-notes@1 items (apps/amberx-droid notes core): every note, to-do and task on every device. kind picks the shape; a task may have subtasks (parent) and a checklist.' },
  'amberx.lists': { domain: 'amberx', label: 'AmberX lists', ops: ENTITY_OPS, paths: 'entity', fields: LIST_FIELDS, select: { parent: 'string|null', q: 'string' }, acts: { move: { parent: 'string|null' }, reorder: { ids: 'string[]' }, rename: { name: 'string' } }, doc: 'The list tree items live in (Inbox and the plugin lists are system lists: they can be renamed, never removed).', protected: ['inbox', 'plugins', 'voice-notes'] },
  'planner.plans': { domain: 'planner', label: 'Plan Studio plans', ops: ENTITY_OPS, paths: 'entity', fields: PLAN_FIELDS, select: { status: 'string', priority: 'string', category: 'string', tag: 'string', project: 'string', q: 'string', limit: 'number' }, acts: { park: {}, build: { profile: 'string', buildId: 'string' }, restore: { version: 'number' }, export: { format: 'enum:json,md' }, step: { step: 'string', done: 'boolean' }, comment: { text: 'string' } }, doc: 'plan@1 plans (console → Builds → Plan Studio): “put it in a plan for later” lands here as parked; `build` turns one into an orchestrator build.' },
  'planner.builds': { domain: 'planner', label: 'Build orchestrator builds', ops: ENTITY_OPS, paths: 'entity', fields: BUILD_FIELDS, select: { profile: 'string', status: 'string', category: 'string', q: 'string', includeHidden: 'boolean', limit: 'number' }, acts: { step: { step: 'string', done: 'boolean' }, approve: { phase: 'number' }, status: { status: 'string' }, note: { text: 'string' }, rename: { title: 'string' }, 'rename-step': { step: 'string', title: 'string' }, 'add-step': { text: 'string', model: 'enum:Fable,Opus', estimate: 'string', after: 'string' }, 'edit-step': { step: 'string', patch: 'object' }, 'skip-step': { step: 'string', why: 'string' }, 'remove-step': { step: 'string', why: 'string' }, 'move-step': { step: 'string', to: 'number' }, archive: {}, hide: {}, unhide: {} }, stepFields: STEP_FIELDS, doc: 'builds@1 records through the orchestrator (the one builds store; profiles are a field): every change is journalled, Pending / queue / Build manager are projections.' },
  'console.screens': { domain: 'console', label: 'Console screens', ops: ['list', 'get', 'act'], paths: 'host', select: CONSOLE_SELECT, acts: { open: {} }, actEffect: { open: 'navigate' }, doc: `Every screen (view) the open console has, its plugins' too. path = the view id, its title or words to search for ("plan studio", "builds"); act open shows it. ${CONSOLE_DELIVERY}` },
  'console.dialogs': { domain: 'console', label: 'Console dialogs', ops: ['list', 'get', 'act'], paths: 'host', select: CONSOLE_SELECT, acts: { open: {} }, actEffect: { open: 'navigate' }, doc: `Every dialog the open console registers (by id, title or search words); act open shows it (input.arg = its optional argument). ${CONSOLE_DELIVERY}` },
  'console.settings': { domain: 'console', label: 'Console settings tabs', ops: ['list', 'get', 'act'], paths: 'host', select: CONSOLE_SELECT, acts: { open: {} }, actEffect: { open: 'navigate' }, doc: `Every Settings tab and sub-tab (Settings → Plugins → <plugin> is a sub-tab: its id, "plugins/<id>" or its title); act open shows it, input.anchor scrolls to one setting or group. ${CONSOLE_DELIVERY}` },
  'console.actions': { domain: 'console', label: 'Console actions', ops: ['list', 'get', 'act'], paths: 'host', select: CONSOLE_SELECT, acts: { run: {} }, actEffect: { run: 'write' }, doc: `Every registered action (the action bus: menus, toolbars, search). act run runs it in the open console under its own policy: an action that only navigates needs control.console.navigate, one that changes data needs control.console.write plus the permission the action itself requires, and a destructive one also a confirm token. input.args = its arguments ("swap:color-theme:dark" or ["color-theme", "dark"]). ${CONSOLE_DELIVERY}` },
  'console.nav': { domain: 'console', label: 'Console navigation', ops: ['get', 'act'], paths: 'static', acts: { back: {}, home: {}, close: {} }, actEffect: { back: 'navigate', home: 'navigate', close: 'navigate' }, doc: `Where the open console is (get here: screen, dialog, settings tab) and moving it: back (closes an open dialog first, else the screen before), home (the first screen), close (the open dialog). ${CONSOLE_DELIVERY}` },
  'console.clients': { domain: 'console', label: 'Open consoles', ops: ['list'], paths: 'host', select: { limit: 'number' }, doc: 'The consoles open right now for the caller (one per browser tab: id, app, title, device, screen, last used). Console commands go to the one used last unless input.to says otherwise.' },
};
export const CONTROL_TARGET_IDS = Object.keys(CONTROL_TARGETS);

/** Short CLI aliases: `axf token …` = tokens.<x>, `axf note|todo|task …` = amberx.items with kind preset, and so on. */
export const CONTROL_ALIASES = {
  token: { target: 'tokens.*', note: 'the second word picks the token set: axf token layout get navWidth' },
  note: { target: 'amberx.items', preset: { kind: 'note' } },
  todo: { target: 'amberx.items', preset: { kind: 'todo' } },
  task: { target: 'amberx.items', preset: { kind: 'task' } },
  list: { target: 'amberx.lists' },
  plan: { target: 'planner.plans' },
  build: { target: 'planner.builds' },
  console: { target: 'console.*', note: 'axf console open <screen> | dialog <id> | settings <tab> | action <id> [args] | back | home | where | list [screens|dialogs|settings|actions|clients] [words]' },
};

/* ================================================================== helpers */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\(\s*[\d.%]+\s*[, ]\s*[\d.%]+\s*[, ]\s*[\d.%]+\s*([,/]\s*[\d.%]+\s*)?\)|transparent|currentColor)$/;
const PLAIN = { tokens: 'tokens', amberx: 'amberx', planner: 'planner', console: 'console' };

export const isControlTarget = (t) => typeof t === 'string' && t in CONTROL_TARGETS;
export const controlDomain = (target) => CONTROL_TARGETS[target]?.domain ?? null;
export const controlEffect = (op) => CONTROL_EFFECT[op] ?? null;
/** What a command does to the world: the op's effect, or the act verb's own (`actEffect`: console navigation). */
export const controlEffectOf = (target, op, action) => (op === 'act' && CONTROL_TARGETS[target]?.actEffect?.[action]) || CONTROL_EFFECT[op] || null;
/** The permission a command needs: control.<domain>.<read|write|delete|navigate>. */
export const controlPermission = (target, op, action) => (isControlTarget(target) && op in CONTROL_EFFECT ? `control.${controlDomain(target)}.${CONTROL_PERMISSION_SUFFIX[controlEffectOf(target, op, action)]}` : null);

/** The static paths of a token target (the ids `list` answers without a running app), or null for host / entity targets. */
export function controlPaths(target) {
  switch (target) {
    case 'tokens.theme': return COLOR_TOKENS.map((id) => ({ id, token: `--fx-${id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, kind: 'color' }));
    case 'tokens.style': return Object.entries(STYLE_FIELDS).map(([id, t]) => ({ id, kind: t.startsWith('enum:') ? 'enum' : t, ...(t.startsWith('enum:') ? { options: t.slice(5).split(',') } : {}) }));
    case 'tokens.layout': return [
      ...Object.entries(LAYOUT_FIELDS).map(([id, [def, min, max, unit]]) => ({ id, token: layoutToken(id), kind: 'number', unit, default: def, min, max })),
      ...Object.entries(LAYOUT_ENUMS).map(([id, options]) => ({ id, token: layoutToken(id), kind: 'enum', options: [...options] })),
      ...Object.entries(LAYOUT_SWITCHES).map(([id, def]) => ({ id, token: layoutToken(id), kind: 'boolean', default: def })),
    ];
    case 'tokens.typography': case 'tokens.density': case 'tokens.sizing': {
      const type = target.slice('tokens.'.length);
      return [
        ...Object.entries(SCALE_FIELDS[type]).map(([id, [def, min, max, unit]]) => ({ id, token: `--fx-${{ typography: 'type', density: 'dens', sizing: 'size' }[type]}-${id.split('.').map((s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)).join('-')}`, kind: 'number', unit, default: def, min, max })),
        ...Object.entries(SCALE_ENUMS[type] ?? {}).map(([id, options]) => ({ id, kind: 'enum', options: [...options] })),
      ];
    }
    case 'console.nav': return [{ id: 'here', kind: 'location' }];
    default: return null;
  }
}

/** Is `path` a path of a static token target? (host / entity targets: the host decides.) */
export function controlPathKnown(target, path) {
  const ps = controlPaths(target);
  return ps ? ps.some((p) => p.id === path) : null;
}

/* ================================================================== normalize + validate */

/** A command with its optional fields shaped (strings trimmed, unknown fields dropped). Does not validate. */
export function normalizeControl(raw) {
  const r = isObj(raw) ? raw : {};
  const out = { $axf: CONTROL_FRAME };
  if (r.op !== undefined) out.op = typeof r.op === 'string' ? r.op.trim() : r.op;
  if (r.target !== undefined) out.target = typeof r.target === 'string' ? r.target.trim() : r.target;
  if (r.path !== undefined && r.path !== null && r.path !== '') out.path = typeof r.path === 'string' ? r.path.trim() : r.path;
  if (r.value !== undefined) out.value = r.value;
  if (r.action !== undefined && r.action !== '') out.action = typeof r.action === 'string' ? r.action.trim() : r.action;
  if (r.input !== undefined) out.input = r.input;
  if (r.select !== undefined) out.select = r.select;
  if (typeof r.confirm === 'string' && r.confirm) out.confirm = r.confirm.trim();
  if (typeof r.by === 'string' && r.by.trim()) out.by = r.by.trim().slice(0, 120);
  if (typeof r.reason === 'string' && r.reason.trim()) out.reason = r.reason.trim().slice(0, 500);
  return out;
}

/** The type word a field / select / act input is declared with, checked against a value. */
function typeError(at, decl, v) {
  if (decl === 'object') return isObj(v) ? null : `${at} must be an object`;
  if (decl === 'object[]') return Array.isArray(v) && v.every(isObj) ? null : `${at} must be a list of objects`;
  if (decl === 'string[]') return Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : `${at} must be a list of strings`;
  if (decl === 'string|null') return v === null || typeof v === 'string' ? null : `${at} must be a string or null`;
  if (decl.startsWith('enum:')) { const opts = decl.slice(5).split(','); return opts.includes(String(v)) ? null : `${at} must be one of: ${opts.join(', ')}`; }
  if (decl === 'number') return typeof v === 'number' && Number.isFinite(v) ? null : `${at} must be a number`;
  if (decl === 'boolean') return typeof v === 'boolean' ? null : `${at} must be true or false`;
  if (decl === 'string') return typeof v === 'string' ? null : `${at} must be a string`;
  return null;
}

/** What a token `set` may carry for a static target (host targets: the running app validates). */
export function controlValueErrors(target, path, value) {
  const t = CONTROL_TARGETS[target];
  if (!t) return [`unknown target ${String(target)}`];
  if (t.paths === 'entity') return [];
  if (t.paths === 'host') return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? [] : ['value must be a string, number or true / false'];
  if (controlPathKnown(target, path) === false) return [`${target} has no token ${path} (control list ${target} names them)`];
  switch (target) {
    case 'tokens.theme': return typeof value === 'string' && COLOR.test(value.trim()) ? [] : ['value must be a colour (#rgb, #rrggbb, #rrggbbaa, rgb(), hsl())'];
    case 'tokens.style': { const e = typeError('value', STYLE_FIELDS[path], value); return e ? [e] : typeof value === 'string' && value.length > 400 ? ['value is too long'] : []; }
    case 'tokens.layout': return layoutErrors('layout', { [path]: value });
    case 'tokens.typography': case 'tokens.density': case 'tokens.sizing': { const [g, f] = path.split('.'); return scaleErrors(target.slice('tokens.'.length), { [g]: { [f]: value } }); }
    default: return [];
  }
}

/** Everything wrong with a command, by name. Empty = it can be gated and run. */
export function controlErrors(raw) {
  const c = normalizeControl(raw);
  const errors = [];
  if (isObj(raw) && raw.$axf !== undefined && raw.$axf !== CONTROL_FRAME) errors.push(`$axf must be ${CONTROL_FRAME}`);
  if (!CONTROL_OPS.includes(c.op)) errors.push(`op must be one of: ${CONTROL_OPS.join(', ')}`);
  if (!isControlTarget(c.target)) errors.push(`target must be one of: ${CONTROL_TARGET_IDS.join(', ')}`);
  if (errors.length) return errors;
  const t = CONTROL_TARGETS[c.target];
  if (!t.ops.includes(c.op)) errors.push(`${c.target} does not take ${c.op} (it takes ${t.ops.join(', ')})`);
  const needsPath = ['get', 'set', 'remove', 'act'].includes(c.op);
  if (needsPath && (typeof c.path !== 'string' || !c.path)) errors.push(`${c.op} needs a path (${t.paths === 'entity' ? 'the id' : 'the token id'})`);
  else if (c.path !== undefined && (typeof c.path !== 'string' || !ID.test(c.path) && !/^[A-Za-z0-9][\w.:@/ -]{0,159}$/.test(c.path))) errors.push('path must be a short id');
  else if (c.path && t.paths === 'static' && controlPathKnown(c.target, c.path) === false) errors.push(`${c.target} has no token ${c.path} (control list ${c.target} names them)`);
  if (['list', 'add'].includes(c.op) && c.path !== undefined) errors.push(`${c.op} takes no path`);
  if (c.op === 'set') {
    if (c.value === undefined) errors.push('set needs a value');
    else if (t.paths === 'entity') {
      if (!isObj(c.value)) errors.push('value must be an object of fields to change');
      else for (const [k, v] of Object.entries(c.value)) { if (!(k in t.fields)) errors.push(`${c.target} has no field ${k}`); else { const e = typeError(`value.${k}`, t.fields[k], v); if (e) errors.push(e); } }
    } else errors.push(...controlValueErrors(c.target, c.path, c.value));
  }
  if (c.op === 'add') {
    if (!isObj(c.value)) errors.push('add needs a value: the new record\'s fields');
    else for (const [k, v] of Object.entries(c.value)) { if (!(k in t.fields)) errors.push(`${c.target} has no field ${k}`); else { const e = typeError(`value.${k}`, t.fields[k], v); if (e) errors.push(e); } }
  }
  if (c.op === 'act') {
    if (typeof c.action !== 'string' || !c.action) errors.push(`act needs an action (${Object.keys(t.acts ?? {}).join(', ')})`);
    else if (!(c.action in (t.acts ?? {}))) errors.push(`${c.target} has no action ${c.action} (it has ${Object.keys(t.acts ?? {}).join(', ')})`);
    else {
      const wants = t.acts[c.action];
      const input = isObj(c.input) ? c.input : {};
      for (const [k, decl] of Object.entries(wants)) { if (!(k in input)) errors.push(`action ${c.action} needs input.${k}`); else { const e = typeError(`input.${k}`, decl, input[k]); if (e) errors.push(e); } }
    }
  } else if (c.action !== undefined) errors.push('only act takes an action');
  if (c.op === 'list' && c.select !== undefined) {
    if (!isObj(c.select)) errors.push('select must be an object of filters');
    else for (const [k, v] of Object.entries(c.select)) { if (!(k in (t.select ?? {}))) errors.push(`${c.target} list has no filter ${k} (it has ${Object.keys(t.select ?? {}).join(', ') || 'none'})`); else { const e = typeError(`select.${k}`, t.select[k], v); if (e) errors.push(e); } }
  }
  if (c.op === 'remove' && t.protected?.includes(c.path)) errors.push(`${c.path} is a system list and can't be removed`);
  if (c.value !== undefined && JSON.stringify(c.value).length > CONTROL_VALUE_MAX_BYTES) errors.push(`value is over ${CONTROL_VALUE_MAX_BYTES} bytes`);
  return errors;
}

/* ================================================================== confirm tokens */

/** djb2 over a string → 8 hex chars (stable on every port; not a secret by itself: the salt is). */
export function controlHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  let g = 2166136261;
  for (let i = 0; i < s.length; i++) { g ^= s.charCodeAt(i); g = Math.imul(g, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0') + g.toString(16).padStart(8, '0');
}

/** The part of a command a confirm token is bound to: op, target, path, action and value, keys sorted. */
export function canonicalControl(raw) {
  const c = normalizeControl(raw);
  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
  return JSON.stringify(sortKeys({ op: c.op, target: c.target, path: c.path ?? null, action: c.action ?? null, value: c.value ?? null, input: c.input ?? null }));
}

const bucketOf = (now) => Math.floor(now / CONTROL_CONFIRM_TTL_MS);
/** The confirm token for a command right now (the server's salt never leaves it). */
export const controlConfirmToken = (raw, salt, now = Date.now()) => `c1.${controlHash(`${canonicalControl(raw)}|${salt}|${bucketOf(now)}`)}`;
/** Does `token` confirm this exact command? Good in the bucket it was made in and the next one (so a token lives 10 to 20 minutes). */
export function controlConfirmValid(raw, token, salt, now = Date.now()) {
  if (typeof token !== 'string' || !token) return false;
  return token === controlConfirmToken(raw, salt, now) || token === controlConfirmToken(raw, salt, now - CONTROL_CONFIRM_TTL_MS);
}

/* ================================================================== the gate */

/** UAC permission check (the same rule as core/engines/uac.ts hasPermission): exact, `*`, or a dotted-prefix wildcard. */
export function controlGranted(grants, perm) {
  const g = grants instanceof Set ? grants : new Set(Array.isArray(grants) ? grants : []);
  if (g.has('*') || g.has(perm)) return true;
  const parts = perm.split('.');
  for (let i = parts.length - 1; i > 0; i--) if (g.has(parts.slice(0, i).join('.') + '.*')) return true;
  return false;
}

/**
 * Gate a command before running it. `grants` = the caller's permissions (its role's, already capped by the app's
 * UAC role for a remote caller); `opts.salt` + `opts.now` for the confirm token. Returns { ok: true, effect, requires,
 * command } or { ok: false, code, message, requires?, confirm? } (confirmation_required carries the token to send back).
 */
export function controlGate(raw, grants, opts = {}) {
  const c = normalizeControl(raw);
  if (!CONTROL_OPS.includes(c.op)) return { ok: false, code: CONTROL_WIRE.INVALID, message: `op must be one of: ${CONTROL_OPS.join(', ')}` };
  if (!isControlTarget(c.target)) return { ok: false, code: CONTROL_WIRE.NOT_FOUND, message: `no target ${String(c.target)}` };
  const t = CONTROL_TARGETS[c.target];
  if (!t.ops.includes(c.op)) return { ok: false, code: CONTROL_WIRE.INVALID, message: `${c.target} does not take ${c.op}` };
  const effect = controlEffectOf(c.target, c.op, c.action);
  const requires = controlPermission(c.target, c.op, c.action);
  if (!controlGranted(grants, requires)) return { ok: false, code: CONTROL_WIRE.DENIED, message: `${c.op} ${c.target} needs ${requires}`, requires, effect };
  const errors = controlErrors(c);
  if (errors.length) return { ok: false, code: CONTROL_WIRE.VALIDATION, message: errors.join('; '), errors, requires, effect };
  if (effect === 'destructive') {
    const salt = opts.salt ?? '';
    if (!controlConfirmValid(c, c.confirm, salt, opts.now)) {
      return { ok: false, code: CONTROL_WIRE.CONFIRMATION_REQUIRED, message: `${c.op} ${c.target} ${c.path} deletes; send the same command again with this confirm token within ${CONTROL_CONFIRM_TTL_MS / 60000} minutes`, requires, effect, confirm: controlConfirmToken(c, salt, opts.now), ttlMs: CONTROL_CONFIRM_TTL_MS };
    }
  }
  return { ok: true, effect, requires, command: c };
}

/* ================================================================== results */

/** A success envelope. `data` is per op: list → { items, total }, get → { value } or { item }, set/reset/add/act → { changed, item? }, remove → { removed }. */
export function controlResult(command, data, audit = null) {
  const c = normalizeControl(command);
  const out = { $axf: CONTROL_FRAME, ok: true, op: c.op, target: c.target, ...(c.path !== undefined ? { path: c.path } : {}), ...(c.action !== undefined ? { action: c.action } : {}), ...data };
  if (controlEffectOf(c.target, c.op, c.action) !== 'read') out.audit = { by: audit?.by ?? c.by ?? 'unknown', reason: audit?.reason ?? c.reason ?? '', at: audit?.at ?? new Date(0).toISOString() };
  return out;
}
/** A failure envelope (the gate's answer, or a runner's). */
export const controlFailure = (code, message, extra = {}) => ({ $axf: CONTROL_FRAME, ok: false, code: Object.values(CONTROL_WIRE).includes(code) ? code : CONTROL_WIRE.UNEXPECTED, message: String(message ?? ''), ...extra });

/* ================================================================== projections: schema, MCP tools, REST routes, CLI */

const schemaOf = (decl) => (decl === 'object' ? { type: 'object' } : decl === 'object[]' ? { type: 'array', items: { type: 'object' } } : decl === 'string[]' ? { type: 'array', items: { type: 'string' } } : decl === 'string|null' ? { type: ['string', 'null'] } : decl.startsWith('enum:') ? { enum: decl.slice(5).split(',') } : { type: decl });

/** JSON Schema of a control@1 command (editors, the API's request body, the MCP tools' inputs). */
export function controlSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'axf/control.schema.json',
    title: 'AmberX AXF control@1 command',
    type: 'object',
    required: ['op', 'target'],
    properties: {
      $axf: { const: CONTROL_FRAME },
      op: { enum: CONTROL_OPS },
      target: { enum: CONTROL_TARGET_IDS },
      path: { type: 'string', maxLength: 160, description: 'token id or entity id (get, set, remove, act; optional on reset)' },
      value: { description: 'what to set (set) or the new record (add)' },
      action: { type: 'string', description: 'the verb for act' },
      input: { type: 'object', description: 'the verb\'s input' },
      select: { type: 'object', description: 'filters for list' },
      confirm: { type: 'string', description: 'the confirm token a remove sends on its second call' },
      by: { type: 'string', maxLength: 120 },
      reason: { type: 'string', maxLength: 500 },
    },
    additionalProperties: false,
    $defs: Object.fromEntries(Object.entries(CONTROL_TARGETS).map(([id, t]) => [id, {
      description: t.doc,
      ops: t.ops,
      ...(t.fields ? { fields: Object.fromEntries(Object.entries(t.fields).map(([k, d]) => [k, schemaOf(d)])) } : {}),
      ...(t.select ? { select: Object.fromEntries(Object.entries(t.select).map(([k, d]) => [k, schemaOf(d)])) } : {}),
      ...(t.acts ? { acts: Object.fromEntries(Object.entries(t.acts).map(([a, w]) => [a, Object.fromEntries(Object.entries(w).map(([k, d]) => [k, schemaOf(d)]))])) } : {}),
      ...(controlPaths(id) ? { paths: controlPaths(id).map((p) => p.id) } : { paths: t.paths }),
    }])),
  };
}

/** The MCP tools (one per op) every MCP server exposing control@1 publishes, with their annotations. */
export function controlTools() {
  const target = { type: 'string', enum: CONTROL_TARGET_IDS, description: 'what to control' };
  const by = { by: { type: 'string', description: 'who asks (audited)' }, reason: { type: 'string', description: 'why (audited)' } };
  const tool = (op, description, props, required, extra = {}) => ({
    name: `control_${op}`, title: `Control: ${op}`, description,
    inputSchema: { type: 'object', required: ['target', ...required], properties: { target, ...props, ...(CONTROL_EFFECT[op] === 'read' ? {} : by) }, additionalProperties: false },
    annotations: { readOnlyHint: CONTROL_EFFECT[op] === 'read', destructiveHint: CONTROL_EFFECT[op] === 'destructive', idempotentHint: ['get', 'list', 'set', 'reset', 'remove'].includes(op), openWorldHint: false },
    effect: CONTROL_EFFECT[op], ...extra,
  });
  return [
    tool('list', 'List the tokens or records of a target (filters in select).', { select: { type: 'object' } }, []),
    tool('get', 'One token value or one record.', { path: { type: 'string' } }, ['path']),
    tool('set', 'Set a token (an override on the theme) or change a record\'s fields.', { path: { type: 'string' }, value: {} }, ['path', 'value']),
    tool('reset', 'Drop a token override (or every override of the target when path is left out).', { path: { type: 'string' } }, []),
    tool('add', 'Add a record (a note, a list, a plan, a build).', { value: { type: 'object' } }, ['value']),
    tool('remove', 'Delete a record. Needs a confirm token: the first call answers confirmation_required with one, send it back within 10 minutes.', { path: { type: 'string' }, confirm: { type: 'string' } }, ['path']),
    tool('act', 'Run a verb on a record (done, move, approve, step, …; control_list on the target shows them).', { path: { type: 'string' }, action: { type: 'string' }, input: { type: 'object' } }, ['path', 'action']),
  ];
}

/** The REST routes (under the console's /api/control; the console token or an axHub call authenticates, UAC role from it). */
export function controlRoutes() {
  return [
    { op: 'list', method: 'GET', path: '/api/control/{target}', query: 'select.* as query parameters' },
    { op: 'get', method: 'GET', path: '/api/control/{target}/{path}' },
    { op: 'set', method: 'PUT', path: '/api/control/{target}/{path}', body: '{ value, by?, reason? }' },
    { op: 'reset', method: 'POST', path: '/api/control/{target}/reset', body: '{ path?, by?, reason? }' },
    { op: 'add', method: 'POST', path: '/api/control/{target}', body: '{ value, by?, reason? }' },
    { op: 'remove', method: 'DELETE', path: '/api/control/{target}/{path}', body: '{ confirm?, by?, reason? }', note: 'first call → 409 confirmation_required { confirm }' },
    { op: 'act', method: 'POST', path: '/api/control/{target}/{path}/act/{action}', body: '{ input?, by?, reason? }' },
    { op: 'any', method: 'POST', path: '/api/control', body: 'a whole control@1 command (what the MCP tools and the CLI send)' },
  ];
}

/** CLI usage (`axf control …` plus the aliases). */
export function controlCli() {
  return {
    usage: [
      'axf control list <target> [--select key=value]…',
      'axf control get <target> <path>',
      'axf control set <target> <path> <value|json> [--by who] [--reason why]',
      'axf control reset <target> [path]',
      'axf control add <target> <json>',
      'axf control remove <target> <path> [--confirm <token>]   (first run prints the token)',
      'axf control act <target> <path> <action> [json input]',
      'axf control targets | tools | routes | schema',
    ],
    aliases: Object.fromEntries(Object.entries(CONTROL_ALIASES).map(([a, v]) => [a, v.target === 'tokens.*' ? 'axf token <theme|style|layout|typography|density|sizing|look|custom|slots> <op> …' : v.target === 'console.*' ? v.note : `axf ${a} <op> … = axf control <op> ${v.target}${v.preset ? ` (${Object.entries(v.preset).map(([k, x]) => `${k}=${x}`).join(', ')})` : ''}`])),
    targets: CONTROL_TARGET_IDS,
  };
}

/** The whole registry as one JSON document (framework/schemas/control.json is a snapshot of it; check-control keeps them equal). */
export function controlRegistry() {
  return {
    $axf: CONTROL_FRAME,
    ops: CONTROL_OPS,
    effects: CONTROL_EFFECT,
    actEffects: Object.fromEntries(Object.entries(CONTROL_TARGETS).filter(([, t]) => t.actEffect).map(([id, t]) => [id, t.actEffect])),
    domains: CONTROL_DOMAINS,
    permissions: CONTROL_PERMISSIONS,
    wire: CONTROL_WIRE,
    confirmTtlMs: CONTROL_CONFIRM_TTL_MS,
    listMax: CONTROL_LIST_MAX,
    targets: Object.fromEntries(Object.entries(CONTROL_TARGETS).map(([id, t]) => [id, { ...t, paths: controlPaths(id) ?? t.paths }])),
    aliases: CONTROL_ALIASES,
    tools: controlTools(),
    routes: controlRoutes(),
    cli: controlCli(),
    schema: controlSchema(),
  };
}

export { PLAIN as CONTROL_DOMAIN_LABELS };
