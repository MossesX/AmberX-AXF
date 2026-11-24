/**
 * toolbar rules — page-toolbar@1 (Brett, Nov 17 2026: "Everywhere there's a toolbar, rebuild the asset for that
 * page/plugin with useful, integrated buttons made for it."). A toolbar asset can now be bound to one page or plugin
 * (`scope`) and each of its buttons to a real function of that page (an action ref), with its enabled and visible
 * state read from the page, a badge, a destructive flag, an optional confirm, a priority for the overflow and a
 * toolbar-level overflow rule. The old shape (a bare button list for the app frame) stays valid and means the same.
 *
 * ONE registry drives both validators (core/validate.ts and the build engine), the generated JSON Schema
 * (toolbarSchemaProperties), the migration (toolbar-migrate.mjs) and the reference engine (toolbar-actions.ts).
 * Every list below is append-only: new kinds are added at the end, never removed or renamed.
 *
 * Grammar (asset-types.json → types.toolbar.pageToolbar):
 *   scope      app | view:<view id> | plugin:<plugin id>          (absent = app: the frame toolbar, the old shape)
 *   action     <kind>:<id> with kind one of ACTION_KINDS, else a console action id as before
 *                action:<id>              a registered console action (rt.actions), `args` as its params
 *                command:<plugin>/<cmd>   a plugin command (plugin-commands@1): the same REST / MCP / CLI call
 *                control:<address>        a console-control@1 target pressed or opened (view:…/button:…, setting:…=…)
 *                handler:<id>             a handler the page registers at run time (registerToolbarHandler)
 *   when       a term or a list of terms that must all hold, over the page's state (dotted keys):
 *                key · !key · key=value · key!=value · key>number · key<number
 *   badge      <counter name> (as before) | counter:<name> | state:<key>
 *   checked    the app-menu bindings (setting:, counter:, slot:, hidden:) plus state:<key>
 */

export const PAGE_TOOLBAR_CONTRACT = 'page-toolbar@1';

/** Scope kinds (append-only). `app` is the frame toolbar every app draws; `view` and `plugin` bind to a page. */
export const TOOLBAR_SCOPE_KINDS = ['app', 'view', 'plugin'];
/** Action ref kinds (append-only). Anything else before the first `:` is part of a console action id. */
export const TOOLBAR_ACTION_KINDS = ['action', 'command', 'control', 'handler'];
/** Badge sources (append-only). A bare name is a runtime counter, as before. */
export const TOOLBAR_BADGE_KINDS = ['counter', 'state'];
/** Checked bindings: the app-menu kinds plus the page state. */
export const TOOLBAR_CHECKED_KINDS = ['setting', 'counter', 'slot', 'hidden', 'state'];
/** Overflow modes for a toolbar, a group or an item (append-only). */
export const TOOLBAR_OVERFLOW = ['auto', 'never', 'always'];
/** Comparison operators a `when` term may use, longest first so `!=` wins over `=`. */
export const WHEN_OPERATORS = ['!=', '>=', '<=', '=', '>', '<'];

export const TOOLBAR_LIMITS = { whenTerms: 8, keyLength: 80, confirmLength: 200, groups: 24, items: 48, priority: [0, 1000] };
export const TOOLBAR_DEFAULTS = { scope: 'app', slot: 'main', priority: 100, overflow: { when: 'auto', keep: 0, label: 'More' }, confirmText: 'Are you sure?' };
/** The place on a page a toolbar fills (`slot`), when a page has several toolbars. */
export const SLOT_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const KEY = /^[a-z_$][\w$]*(?:\.[\w$]+)*$/i;

/* ================================================================== parsing */

/** `view:builds` → { kind: 'view', id: 'builds' }; absent → app; null when malformed. */
export function parseToolbarScope(scope) {
  if (scope == null || scope === '' || scope === 'app') return { kind: 'app', id: '' };
  if (typeof scope !== 'string') return null;
  const i = scope.indexOf(':');
  if (i <= 0) return null;
  const kind = scope.slice(0, i); const id = scope.slice(i + 1);
  return TOOLBAR_SCOPE_KINDS.includes(kind) && kind !== 'app' && id && ID.test(id) ? { kind, id } : null;
}

/** The scope string of a page: `view:<id>` / `plugin:<id>` / 'app'. */
export const formatToolbarScope = (s) => (!s || s.kind === 'app' ? 'app' : `${s.kind}:${s.id}`);

/**
 * The settings id (chrome-settings@1 instance, tap-to-confirm id, console-control `toolbar:<id>`) of a page toolbar:
 * `<scope id>` for the main slot, `<scope id>.<slot>` otherwise (`gate`, `gate.auto-lander`); the frame toolbar is `app`.
 * Scope ids are slugged the way toolbarIdOf slugs (lowercase, runs of other characters → `.` kept, `-` kept).
 */
export function pageToolbarSettingsId(scope, slot) {
  const s = typeof scope === 'string' ? parseToolbarScope(scope) : scope;
  if (!s || s.kind === 'app') return 'app';
  const id = String(s.id).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const sl = typeof slot === 'string' && slot && slot !== TOOLBAR_DEFAULTS.slot ? `.${slot}` : '';
  return `${id}${sl}`;
}

/**
 * An action ref. `command:gate/lander-run` → { kind: 'command', id: 'gate/lander-run', plugin: 'gate', command: 'lander-run' };
 * `nav:home` or `file.save` → { kind: 'action', id: <the whole string> } (a console action id, as before). Null when empty.
 */
export function parseActionRef(action) {
  if (typeof action !== 'string' || !action.trim()) return null;
  const s = action.trim();
  const i = s.indexOf(':');
  const kind = i > 0 ? s.slice(0, i) : '';
  if (!TOOLBAR_ACTION_KINDS.includes(kind)) return { kind: 'action', id: s };
  const id = s.slice(i + 1);
  if (!id) return null;
  if (kind === 'command') {
    const j = id.indexOf('/');
    if (j <= 0 || j === id.length - 1) return null;
    return { kind, id, plugin: id.slice(0, j), command: id.slice(j + 1) };
  }
  return { kind, id };
}

/** `counter:alerts.unread` / `alerts.unread` → { kind: 'counter', ref }, `state:selection.count` → { kind: 'state', ref }. */
export function parseBadge(badge) {
  if (typeof badge !== 'string' || !badge.trim()) return null;
  const i = badge.indexOf(':');
  if (i <= 0) return { kind: 'counter', ref: badge.trim() };
  const kind = badge.slice(0, i); const ref = badge.slice(i + 1);
  if (!TOOLBAR_BADGE_KINDS.includes(kind)) return { kind: 'counter', ref: badge.trim() };
  return ref ? { kind, ref } : null;
}

/** `state:busy` / `setting:x` → { kind, ref }; null when not one of TOOLBAR_CHECKED_KINDS. */
export function parseToolbarChecked(binding) {
  if (typeof binding !== 'string') return null;
  const i = binding.indexOf(':');
  if (i <= 0) return null;
  const kind = binding.slice(0, i); const ref = binding.slice(i + 1);
  return TOOLBAR_CHECKED_KINDS.includes(kind) && ref ? { kind, ref } : null;
}

/** One `when` term → { key, op, value, negate } or null when malformed. */
export function parseWhenTerm(term) {
  if (typeof term !== 'string') return null;
  let s = term.trim();
  if (!s) return null;
  for (const op of WHEN_OPERATORS) {
    const i = s.indexOf(op);
    if (i > 0) {
      const key = s.slice(0, i).trim(); const value = s.slice(i + op.length).trim();
      if (!KEY.test(key) || key.length > TOOLBAR_LIMITS.keyLength || value === '') return null;
      if ((op === '>' || op === '<' || op === '>=' || op === '<=') && !Number.isFinite(Number(value))) return null;
      return { key, op, value, negate: false };
    }
  }
  const negate = s.startsWith('!');
  if (negate) s = s.slice(1).trim();
  return KEY.test(s) && s.length <= TOOLBAR_LIMITS.keyLength ? { key: s, op: 'truthy', value: '', negate } : null;
}

/** A `when` field (a term or a list) → its terms, or null when any term is malformed or there are too many. */
export function parseWhen(when) {
  if (when == null) return [];
  const list = Array.isArray(when) ? when : [when];
  if (list.length > TOOLBAR_LIMITS.whenTerms) return null;
  const out = [];
  for (const t of list) { const p = parseWhenTerm(t); if (!p) return null; out.push(p); }
  return out;
}

/** The value at a dotted key of a page state object (`selection.count`). */
export function stateAt(state, key) {
  let cur = state;
  for (const p of String(key).split('.')) { if (!isObj(cur) && !Array.isArray(cur)) return undefined; cur = cur[p]; }
  return cur;
}

const truthy = (v) => !(v == null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0));

/** Whether every term holds against the page state. An empty list holds. */
export function whenHolds(terms, state) {
  for (const t of terms ?? []) {
    const v = stateAt(state ?? {}, t.key);
    let ok;
    switch (t.op) {
      case 'truthy': ok = truthy(v); break;
      case '=': ok = String(v ?? '') === t.value; break;
      case '!=': ok = String(v ?? '') !== t.value; break;
      case '>': ok = Number(v) > Number(t.value); break;
      case '<': ok = Number(v) < Number(t.value); break;
      case '>=': ok = Number(v) >= Number(t.value); break;
      case '<=': ok = Number(v) <= Number(t.value); break;
      default: ok = false;
    }
    if (t.negate) ok = !ok;
    if (!ok) return false;
  }
  return true;
}

/** Every page-state key a toolbar reads (enabledWhen, visibleWhen, state badges and state toggles), sorted, unique. */
export function toolbarStateKeys(data) {
  const keys = new Set();
  const take = (when) => { for (const t of parseWhen(when) ?? []) keys.add(t.key); };
  for (const g of Array.isArray(data?.groups) ? data.groups : []) {
    if (!isObj(g)) continue;
    take(g.enabledWhen); take(g.visibleWhen);
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (!isObj(it)) continue;
      take(it.enabledWhen); take(it.visibleWhen);
      const b = parseBadge(it.badge); if (b?.kind === 'state') keys.add(b.ref);
      const c = parseToolbarChecked(it.checked); if (c?.kind === 'state') keys.add(c.ref);
    }
  }
  return [...keys].sort();
}

/** Whether a toolbar asset uses anything of the page-toolbar shape (a scope, refs with kinds, state gating, overflow). */
export function isPageToolbar(data) {
  if (!isObj(data)) return false;
  if ('scope' in data || 'overflow' in data) return true;
  for (const g of Array.isArray(data.groups) ? data.groups : []) {
    if (!isObj(g)) continue;
    if ('overflow' in g || 'priority' in g || 'enabledWhen' in g || 'visibleWhen' in g) return true;
    for (const it of Array.isArray(g.items) ? g.items : []) {
      if (!isObj(it)) continue;
      for (const k of ['enabledWhen', 'visibleWhen', 'destructive', 'confirm', 'priority', 'overflow', 'args']) if (k in it) return true;
      const ref = parseActionRef(it.action);
      if (ref && ref.kind !== 'action') return true;
    }
  }
  return false;
}

/* ================================================================== validation */

const whenErrors = (o, p) => {
  const errors = [];
  for (const k of ['enabledWhen', 'visibleWhen']) {
    if (!(k in o)) continue;
    if (parseWhen(o[k]) === null) errors.push(`${p}.${k} must be a term or a list of up to ${TOOLBAR_LIMITS.whenTerms} terms (key, !key, key=value, key!=value, key>n, key<n)`);
  }
  return errors;
};
const overflowErrors = (o, p) => ('overflow' in o && !TOOLBAR_OVERFLOW.includes(o.overflow) ? [`${p}.overflow must be one of: ${TOOLBAR_OVERFLOW.join(', ')}`] : []);
const priorityErrors = (o, p) => ('priority' in o && (typeof o.priority !== 'number' || !Number.isFinite(o.priority) || o.priority < TOOLBAR_LIMITS.priority[0] || o.priority > TOOLBAR_LIMITS.priority[1]) ? [`${p}.priority must be a number ${TOOLBAR_LIMITS.priority[0]}–${TOOLBAR_LIMITS.priority[1]}`] : []);

/** Every error of a toolbar asset's data (both shapes). Other types: []. Messages are the same in both validators. */
export function toolbarErrors(type, data) {
  if (type !== 'toolbar') return [];
  if (!isObj(data)) return ['data must be an object'];
  const errors = [];
  if ('scope' in data && parseToolbarScope(data.scope) === null) errors.push(`data.scope must be app, view:<view id> or plugin:<plugin id>`);
  if ('slot' in data && (typeof data.slot !== 'string' || !SLOT_PATTERN.test(data.slot))) errors.push('data.slot must be a lowercase slot name (letters, digits, dashes; up to 48)');
  if ('overflow' in data) {
    const o = data.overflow;
    if (typeof o === 'string') errors.push(...overflowErrors(data, 'data'));
    else if (!isObj(o)) errors.push('data.overflow must be an object { when, keep?, label? } or one of: ' + TOOLBAR_OVERFLOW.join(', '));
    else {
      if ('when' in o && !TOOLBAR_OVERFLOW.includes(o.when)) errors.push(`data.overflow.when must be one of: ${TOOLBAR_OVERFLOW.join(', ')}`);
      if ('keep' in o && (!Number.isInteger(o.keep) || o.keep < 0 || o.keep > TOOLBAR_LIMITS.items)) errors.push(`data.overflow.keep must be an integer 0–${TOOLBAR_LIMITS.items}`);
      if ('label' in o && (typeof o.label !== 'string' || !o.label.trim())) errors.push('data.overflow.label must be a non-empty string');
    }
  }
  if (!('groups' in data)) return errors; // the type's required list reports it
  if (!Array.isArray(data.groups)) return [...errors, 'data.groups must be a list of groups'];
  if (data.groups.length > TOOLBAR_LIMITS.groups) errors.push(`data.groups holds more than ${TOOLBAR_LIMITS.groups} groups`);
  const ids = new Set();
  data.groups.forEach((g, i) => {
    const p = `data.groups[${i}]`;
    if (!isObj(g)) { errors.push(`${p} must be a group object`); return; }
    if (typeof g.id !== 'string' || !g.id) errors.push(`${p}.id must be a non-empty string`);
    if ('items' in g && !Array.isArray(g.items)) errors.push(`${p}.items must be a list of items`);
    if (!('items' in g) && !('provider' in g)) errors.push(`${p} needs items or a provider`);
    if ('provider' in g && (typeof g.provider !== 'string' || !g.provider)) errors.push(`${p}.provider must be a non-empty string`);
    if ('max' in g && (!Number.isInteger(g.max) || g.max < 1 || g.max > 24)) errors.push(`${p}.max must be an integer 1–24`);
    errors.push(...whenErrors(g, p), ...overflowErrors(g, p), ...priorityErrors(g, p));
    if (!Array.isArray(g.items)) return;
    if (g.items.length > TOOLBAR_LIMITS.items) errors.push(`${p}.items holds more than ${TOOLBAR_LIMITS.items} items`);
    g.items.forEach((it, j) => {
      const q = `${p}.items[${j}]`;
      if (!isObj(it)) { errors.push(`${q} must be an item object`); return; }
      if (typeof it.id !== 'string' || !it.id) errors.push(`${q}.id must be a non-empty string`);
      else { const key = `${g.id}/${it.id}`; if (ids.has(key)) errors.push(`${q}.id "${it.id}" is used twice in group "${g.id}"`); ids.add(key); }
      if ('action' in it && parseActionRef(it.action) === null) errors.push(`${q}.action must be an action id, action:<id>, command:<plugin>/<command>, control:<address> or handler:<id>`);
      if ('args' in it && !isObj(it.args)) errors.push(`${q}.args must be an object`);
      if ('badge' in it && parseBadge(it.badge) === null) errors.push(`${q}.badge must be a counter name, counter:<name> or state:<key>`);
      if ('checked' in it && parseToolbarChecked(it.checked) === null) errors.push(`${q}.checked must be one of: ${TOOLBAR_CHECKED_KINDS.map((k) => `${k}:<ref>`).join(', ')}`);
      if ('destructive' in it && typeof it.destructive !== 'boolean') errors.push(`${q}.destructive must be true or false`);
      if ('confirm' in it && !(typeof it.confirm === 'boolean' || (typeof it.confirm === 'string' && it.confirm.trim() && it.confirm.length <= TOOLBAR_LIMITS.confirmLength))) errors.push(`${q}.confirm must be true, false or the question (up to ${TOOLBAR_LIMITS.confirmLength} characters)`);
      for (const k of ['label', 'icon', 'requires', 'shortcut']) if (k in it && typeof it[k] !== 'string') errors.push(`${q}.${k} must be a string`);
      errors.push(...whenErrors(it, q), ...overflowErrors(it, q), ...priorityErrors(it, q));
    });
  });
  return errors;
}

/* ================================================================== JSON Schema */

const whenSchema = (what) => ({ description: `${what} when every term holds over the page state: key, !key, key=value, key!=value, key>n, key<n`, oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: TOOLBAR_LIMITS.whenTerms }] });

/** JSON Schema of one toolbar item (page-toolbar@1 fields included). */
export function toolbarItemSchema() {
  return {
    type: 'object', required: ['id'],
    properties: {
      id: { type: 'string' }, icon: { type: 'string' }, label: { type: 'string' },
      action: { type: 'string', description: 'a console action id (as before), action:<id>, command:<plugin>/<command>, control:<address> or handler:<id>' },
      args: { type: 'object', description: 'arguments for the action ref (a command\'s input, an action\'s params)' },
      requires: { type: 'string' }, shortcut: { type: 'string' },
      badge: { type: 'string', description: 'a runtime counter name, counter:<name> or state:<key>; hidden at 0' },
      checked: { type: 'string', pattern: `^(${TOOLBAR_CHECKED_KINDS.join('|')}):.+$`, description: 'toggle binding drawn pressed while true' },
      enabledWhen: whenSchema('enabled'), visibleWhen: whenSchema('shown'),
      destructive: { type: 'boolean', description: 'drawn in the danger tone; pressing it through the API needs confirm' },
      confirm: { oneOf: [{ type: 'boolean' }, { type: 'string', maxLength: TOOLBAR_LIMITS.confirmLength }], description: 'ask before running: true for the default question, or the question itself' },
      priority: { type: 'number', minimum: TOOLBAR_LIMITS.priority[0], maximum: TOOLBAR_LIMITS.priority[1], description: 'overflow order: lower goes into More first (default 100)' },
      overflow: { enum: TOOLBAR_OVERFLOW, description: 'auto (default), never (always on the bar), always (only in More)' },
    },
  };
}

/** The toolbar type's schema properties beyond the required grid (scope, groups, overflow). */
export function toolbarSchemaProperties() {
  return {
    scope: { type: 'string', pattern: '^(app|view:[A-Za-z0-9._:-]+|plugin:[A-Za-z0-9._:-]+)$', description: 'the page this toolbar is for: app (default, the frame toolbar), view:<view id> or plugin:<plugin id>' },
    slot: { type: 'string', pattern: SLOT_PATTERN.source, description: 'the place on its page this toolbar fills when the page has several (default main); settings id <scope id>.<slot>' },
    groups: {
      type: 'array', maxItems: TOOLBAR_LIMITS.groups,
      items: {
        type: 'object', required: ['id'],
        properties: {
          id: { type: 'string' }, label: { type: 'string' },
          items: { type: 'array', maxItems: TOOLBAR_LIMITS.items, items: { $ref: '#/$defs/toolbarItem' } },
          provider: { type: 'string', minLength: 1 }, max: { type: 'integer', minimum: 1, maximum: 24 },
          enabledWhen: whenSchema('enabled'), visibleWhen: whenSchema('shown'),
          priority: { type: 'number', minimum: TOOLBAR_LIMITS.priority[0], maximum: TOOLBAR_LIMITS.priority[1] },
          overflow: { enum: TOOLBAR_OVERFLOW },
        },
      },
    },
    overflow: {
      description: 'what happens when the bar is too narrow: auto folds lowest-priority items into a More menu, never clips nothing (scrolls), always keeps only `keep` items on the bar',
      oneOf: [{ enum: TOOLBAR_OVERFLOW }, { type: 'object', properties: { when: { enum: TOOLBAR_OVERFLOW }, keep: { type: 'integer', minimum: 0, maximum: TOOLBAR_LIMITS.items }, label: { type: 'string' } } }],
    },
  };
}
