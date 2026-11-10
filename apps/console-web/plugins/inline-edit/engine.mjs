#!/usr/bin/env node
/**
 * Inline edit — the one runner behind every surface (build inline-element-editing-plugin-right-click-any-el, Opus phase).
 *
 * The console server (server/__init__.py), the plugin commands (REST /api/control/inline-edit/…, MCP inline-edit_*,
 * `axf inline-edit …`), the console UI and the AmberX voice commands all run these same operations, so the answers,
 * the validation and the effects never differ between transports.
 *
 *   mode.get                                   { on, by, at }  the master switch "Inline edit mode"
 *   mode.set     { state: on|off|toggle }      the switch; every open console follows it (capture layer on/off)
 *   tokens.get   { path, scope? }              every token of the element and each parent: value, axHub value, source
 *   token.set    { path, token, value, scope?, reason?, app? }   one inline-override@1 record (overrides axHub inheritance)
 *   token.unset  { path, token, scope? }       exactly that record; nothing else re-inherits
 *   element.get | element.set { path?, scope?, view? }           the edit dialog's state (per user)
 *   overrides.list { root?, q?, filter?, tab? }                  the overrides list: items, tree, roots, tabs, facets
 *   overrides.state { root?, q?, filter?, tab? }                 the list's search, filters, root and tab (per user)
 *   overrides.tab.add { root, label? } | overrides.tab.remove { id }   the multi-tab column (per user)
 *   overrides.reset { id }                     reset one item to axHub (only that record)
 *
 * Storage: the records live where s2 put them, the axHub look document's settings `axf.inline.<root>` (the same file
 * Token control writes: AXF_APPEARANCE_FILE, else /projects/_shared/_data/settings/appearance.json, else this plugin's
 * data folder). The switch, the per-user UI state and the side ledger (which app a change was made in) live in the
 * plugin's data folder (plugin-lifecycle@1).
 *
 *   node engine.mjs run        one request as JSON on stdin { op, input, user?, by? } → one JSON answer on stdout
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chainOf, createOverridesStore, isPath, parsePath, parseRecordId, resolveElementTokens, rootKinds, roleOfPath, rootTextOf,
  isWithin, INLINE_PREFIX, ELEMENT_ROOTS, labelOfSegment,
} from '../../framework/index.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const FOLDER = 'inline-edit';
export const ROOT = resolve(HERE, '../../../..');
export const DATA_DIR = process.env.AXF_INLINE_EDIT_DATA_DIR || join(ROOT, '.axf-console', 'plugins', FOLDER);
export const VIEWS = ['tree', 'classic', 'grid'];
export const SCOPES = ['item', 'parent'];
export const APPEARANCE_MAX = 16 * 1024;
const SPEC_FILE = join(ROOT, 'framework', 'schemas', 'customize.json');

export class InlineEditError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}
const fail = (code, message, extra) => { throw new InlineEditError(code, message, extra); };

/* ------------------------------------------------------------------ files */

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };
function writeJson(f, value) {
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, f);
}

export function appearanceFile() {
  if (process.env.AXF_APPEARANCE_FILE) return process.env.AXF_APPEARANCE_FILE;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  if (existsSync(projects)) return join(projects, '_shared', '_data', 'settings', 'appearance.json');
  return join(DATA_DIR, 'appearance.json');
}
const readAppearance = () => { const d = readJson(appearanceFile(), null); return d && typeof d === 'object' && d.$axf === 'appearance@1' ? d : { $axf: 'appearance@1' }; };

/** The settings adapter the s2 store runs on: the look document's `settings`, per key, last write wins. */
export function appearanceSettings(by = 'inline-edit') {
  const put = (key, value) => {
    const doc = readAppearance();
    doc.settings = { ...(doc.settings ?? {}) };
    if (value === null) delete doc.settings[key]; else doc.settings[key] = value;
    doc.updatedBy = String(by || 'inline-edit').slice(0, 80);
    doc.updatedAt = new Date().toISOString();
    const text = JSON.stringify(doc, null, 2);
    if (text.length > APPEARANCE_MAX) fail('validation', `the look document would be over ${APPEARANCE_MAX} bytes: reset some overrides first`);
    writeJson(appearanceFile(), doc);
  };
  return {
    get: (k) => readAppearance().settings?.[k],
    set: (k, v) => put(k, v),
    clear: (k) => put(k, null),
    keys: () => Object.keys(readAppearance().settings ?? {}).filter((k) => k.startsWith(INLINE_PREFIX)),
  };
}

const spec = (() => { let s; return () => (s ??= readJson(SPEC_FILE, { tokens: [], targets: {} })); })();
const tokenSpec = (key) => spec().tokens.find((t) => t.key === key);

/* ------------------------------------------------------------------ plugin state (data folder) */

const MODE_FILE = () => join(DATA_DIR, 'mode.json');
const UI_FILE = () => join(DATA_DIR, 'ui.json');
const LEDGER_FILE = () => join(DATA_DIR, 'ledger.json');

export function readMode() {
  const m = readJson(MODE_FILE(), {});
  return { $axf: 'inline-edit-mode@1', on: m.on === true, by: typeof m.by === 'string' ? m.by : '', at: typeof m.at === 'string' ? m.at : '' };
}

const DEFAULT_UI = () => ({
  element: { path: '', scope: 'item', view: 'tree' },
  overrides: { tabs: [{ id: 'all', root: '', label: 'Everything' }], tab: 'all', q: '', filter: {}, root: '' },
});
const userKey = (u) => (typeof u === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._@:-]{0,79}$/.test(u) ? u : 'brett');
function readUi(user) {
  const all = readJson(UI_FILE(), {});
  const mine = all?.users?.[userKey(user)] ?? {};
  const d = DEFAULT_UI();
  const tabs = Array.isArray(mine.overrides?.tabs) && mine.overrides.tabs.length ? mine.overrides.tabs : d.overrides.tabs;
  return {
    element: { ...d.element, ...(mine.element ?? {}) },
    overrides: { ...d.overrides, ...(mine.overrides ?? {}), tabs, filter: { ...(mine.overrides?.filter ?? {}) } },
  };
}
function writeUi(user, ui) {
  const all = readJson(UI_FILE(), {});
  all.users = { ...(all.users ?? {}), [userKey(user)]: ui };
  writeJson(UI_FILE(), all);
}

/* ------------------------------------------------------------------ helpers */

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const needPath = (p) => { if (!isPath(p)) fail('validation', `path: not an element path (inline-edit-tokens@1), e.g. toolbar:app/group:edit/item:undo — got "${String(p ?? '')}"`); return p; };
const needScope = (s) => { const x = s || 'item'; if (!SCOPES.includes(x)) fail('validation', `scope: item | parent, got "${x}"`); return x; };
const needView = (v) => { if (!VIEWS.includes(v)) fail('validation', `view: tree | classic | grid, got "${v}"`); return v; };
export const parseOnOff = (s) => {
  const v = String(s ?? '').trim().toLowerCase();
  if (['on', 'true', '1', 'yes', 'enable', 'enabled'].includes(v)) return 'on';
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(v)) return 'off';
  if (['toggle', 'flip', 'switch'].includes(v)) return 'toggle';
  if (['status', 'state', 'get', ''].includes(v)) return 'status';
  return null;
};

/** A value as the token's editor would write it (numbers for scales, booleans for toggles); validated against the spec. */
export function coerceValue(token, raw) {
  const t = tokenSpec(token);
  if (raw === null) return null;
  if (!t) return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : fail('validation', 'value: a string, number or boolean');
  if (t.kind === 'scale') {
    const n = Number(raw);
    if (!Number.isFinite(n)) fail('validation', `${token}: a number ${t.min}–${t.max}${t.unit ?? ''}`);
    if ((t.min !== undefined && n < t.min) || (t.max !== undefined && n > t.max)) fail('validation', `${token}: ${n} is outside ${t.min}–${t.max}${t.unit ?? ''}`);
    return n;
  }
  if (t.kind === 'toggle') {
    const v = parseOnOff(raw);
    if (v !== 'on' && v !== 'off') fail('validation', `${token}: on or off`);
    return v === 'on';
  }
  const s = String(raw);
  if (Array.isArray(t.options) && !t.options.includes(s)) fail('validation', `${token}: one of ${t.options.join(', ')} (got "${s}")`);
  return s;
}

function sources(store) {
  const doc = readAppearance();
  const slots = doc.slots && typeof doc.slots === 'object' ? doc.slots : {};
  return {
    spec: spec(),
    overrides: store.records(),
    active: (type) => (typeof slots[type] === 'string' ? slots[type] : undefined),
    themeLabel: () => [slots['color-theme'], slots['style-theme']].filter(Boolean).join(' · ') || 'the active theme',
  };
}

const ledger = () => readJson(LEDGER_FILE(), {});
const appOf = (id, l = ledger()) => (typeof l[id]?.app === 'string' ? l[id].app : 'any');

/** One record as the list shows it: + root kind, role, label, token label and kind, the app it was made in. */
function listItem(r, l) {
  const p = parsePath(r.path);
  const t = tokenSpec(r.token);
  const last = p?.segments.at(-1) ?? { name: p?.root.kind, id: p?.root.instance };
  return {
    ...r, kind: p?.root.kind ?? '', kindLabel: ELEMENT_ROOTS[p?.root.kind]?.label ?? p?.root.kind ?? '', role: roleOfPath(r.path) ?? '',
    label: labelOfSegment(last, p?.root.kind), tokenLabel: t?.label ?? r.token, tokenKind: t?.kind ?? 'text', group: t?.group ?? 'Asset', app: appOf(r.id, l),
  };
}

/** The filter fields the list understands (all optional, combined with AND). */
export const FILTERS = ['app', 'kind', 'role', 'tokenKind', 'group', 'token', 'scope', 'by', 'since', 'until'];
function normalizeFilter(f) {
  const out = {};
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch { f = Object.fromEntries(new URLSearchParams(f)); } }
  if (!f || typeof f !== 'object') return out;
  for (const k of FILTERS) { const v = str(f[k], 120); if (v) out[k] = v; }
  return out;
}
export function filterItems(items, { q = '', filter = {}, root = '' } = {}) {
  const f = normalizeFilter(filter);
  const since = f.since ? Date.parse(f.since) : NaN;
  const until = f.until ? Date.parse(f.until) : NaN;
  const needle = str(q, 200).toLowerCase();
  return items.filter((r) => (!root || isWithin(r.path, root))
    && (!f.app || r.app === f.app || (f.app !== 'any' && r.app === 'any'))
    && (!f.kind || r.kind === f.kind) && (!f.role || r.role === f.role)
    && (!f.tokenKind || r.tokenKind === f.tokenKind) && (!f.group || r.group === f.group) && (!f.token || r.token === f.token)
    && (!f.scope || r.scope === f.scope) && (!f.by || r.by === f.by)
    && (Number.isNaN(since) || Date.parse(r.at) >= since) && (Number.isNaN(until) || Date.parse(r.at) <= until + 86_399_999)
    && (!needle || `${r.path} ${r.label} ${r.kindLabel} ${r.token} ${r.tokenLabel} ${String(r.value)} ${String(r.axHubValue)} ${r.by} ${r.reason} ${r.app}`.toLowerCase().includes(needle)));
}

/** The records as a tree: one node per path segment that has records at or under it; records sit on their node. */
export function treeOf(items, root = '') {
  const nodes = new Map();
  const node = (path) => {
    if (!nodes.has(path)) {
      const p = parsePath(path);
      const last = p?.segments.at(-1) ?? { name: p?.root.kind, id: p?.root.instance };
      nodes.set(path, { path, label: labelOfSegment(last, p?.root.kind), role: roleOfPath(path), count: 0, records: [], children: [] });
    }
    return nodes.get(path);
  };
  const tops = [];
  for (const r of items) {
    const chain = chainOf(r.path).filter((c) => !root || isWithin(c, root));
    let parent = null;
    for (const c of chain) {
      const fresh = !nodes.has(c);
      const n = node(c);
      n.count += 1;
      if (fresh) { if (parent) parent.children.push(n); else tops.push(n); }
      parent = n;
    }
    parent?.records.push(r.id);
  }
  return tops;
}

/** Every path a tab can take as its root: each root and each node that has records under it. */
function rootChoices(items) {
  const set = new Map();
  for (const r of items) for (const c of chainOf(r.path)) set.set(c, (set.get(c) ?? 0) + 1);
  return [...set.entries()].map(([path, count]) => ({ path, count, depth: path.split('/').length })).sort((a, b) => (a.path < b.path ? -1 : 1));
}

const facets = (items) => {
  const out = {};
  for (const k of ['app', 'kind', 'role', 'tokenKind', 'group', 'token', 'scope', 'by']) {
    const m = new Map();
    for (const r of items) m.set(r[k], (m.get(r[k]) ?? 0) + 1);
    out[k] = [...m.entries()].filter(([v]) => v !== '' && v !== undefined).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  }
  return out;
};

/* ------------------------------------------------------------------ operations */

export const OPS = {
  'mode.get': () => readMode(),
  'mode.set': (input, ctx) => {
    const want = parseOnOff(input.state ?? input.on ?? input.mode);
    if (!want) fail('validation', 'state: on | off | toggle | status');
    const cur = readMode();
    if (want === 'status') return cur;
    const on = want === 'toggle' ? !cur.on : want === 'on';
    const next = { on, by: str(ctx.by, 80) || 'console', at: new Date().toISOString() };
    writeJson(MODE_FILE(), next);
    return { $axf: 'inline-edit-mode@1', ...next, changed: on !== cur.on };
  },

  'tokens.get': (input, ctx) => {
    const path = needPath(input.path);
    const store = ctx.store();
    const r = resolveElementTokens(path, sources(store));
    if (!r) fail('not_found', `nothing resolves at ${path}`);
    const scope = needScope(input.scope);
    const target = scope === 'parent' && input.at && isPath(input.at) ? input.at : path;
    return { ...r, scope, target, note: 'A value set here overrides what this element inherits from axHub (inline-override@1). Item = this element only; parent = this element and everything under it. Revert to axHub removes only that one override.' };
  },
  'token.set': (input, ctx) => {
    const path = needPath(input.path);
    const scope = needScope(input.scope);
    const token = str(input.token, 80);
    if (!token) fail('validation', 'token: the token id (textColor, background, fontSize …)');
    const store = ctx.store();
    const resolved = resolveElementTokens(path, sources(store));
    const row = resolved?.chain.at(-1)?.tokens.find((t) => t.token === token);
    if (!row) fail('validation', `${token} is not a token of ${path} (inline-edit tokens --path ${path} lists them)`);
    const value = coerceValue(token, input.value);
    let rec;
    try { rec = store.set({ path, scope, token, value, axHubValue: row.axHubValue ?? null, reason: str(input.reason, 200), by: str(ctx.by, 80) || 'console' }); }
    catch (e) { if (e instanceof InlineEditError) throw e; fail('validation', e.message); }
    const app = str(input.app, 60) || 'console-web';
    const l = ledger(); l[rec.id] = { app }; writeJson(LEDGER_FILE(), l);
    return { $axf: 'inline-override@1', changed: true, record: rec, app };
  },
  'token.unset': (input, ctx) => {
    const path = needPath(input.path);
    const scope = needScope(input.scope);
    const token = str(input.token, 80);
    const removed = ctx.store().unset(path, token, scope);
    if (!removed) fail('not_found', `no ${scope} override of ${token} on ${path}`);
    const l = ledger(); const id = `${path}|${scope}|${token}`; if (l[id]) { delete l[id]; writeJson(LEDGER_FILE(), l); }
    return { changed: true, reset: id, now: 'inherits from axHub again' };
  },

  'element.get': (_input, ctx) => readUi(ctx.user).element,
  'element.set': (input, ctx) => {
    const ui = readUi(ctx.user);
    const e = { ...ui.element };
    if (input.path !== undefined && input.path !== '') e.path = needPath(input.path);
    if (input.scope !== undefined && input.scope !== '') e.scope = needScope(input.scope);
    if (input.view !== undefined && input.view !== '') e.view = needView(input.view);
    writeUi(ctx.user, { ...ui, element: e });
    return e;
  },

  'overrides.list': (input, ctx) => {
    const ui = readUi(ctx.user).overrides;
    const l = ledger();
    const all = ctx.store().records().map((r) => listItem(r, l));
    const tabId = str(input.tab, 80) || ui.tab;
    const tab = ui.tabs.find((t) => t.id === tabId) ?? ui.tabs[0];
    const root = input.root !== undefined ? str(input.root, 400) : (ui.root || tab?.root || '');
    if (root && !isPath(root)) fail('validation', `root: an element path, got "${root}"`);
    const q = input.q !== undefined ? str(input.q, 200) : ui.q;
    const filter = input.filter !== undefined ? normalizeFilter(input.filter) : ui.filter;
    const items = filterItems(all, { q, filter, root });
    return {
      $axf: 'inline-overrides-list@1', total: all.length, shown: items.length, q, filter, root, tab: tab?.id ?? 'all', tabs: ui.tabs,
      items, tree: treeOf(items, root), roots: rootChoices(all), rootKinds: rootKinds(), facets: facets(all), filters: FILTERS,
    };
  },
  'overrides.state': (input, ctx) => {
    const ui = readUi(ctx.user);
    const o = { ...ui.overrides };
    if (input.q !== undefined) o.q = str(input.q, 200);
    if (input.filter !== undefined) o.filter = normalizeFilter(input.filter);
    if (input.root !== undefined) { const r = str(input.root, 400); if (r && !isPath(r)) fail('validation', `root: an element path, got "${r}"`); o.root = r; }
    if (input.tab !== undefined && input.tab !== '') {
      const t = o.tabs.find((x) => x.id === input.tab);
      if (!t) fail('not_found', `no tab ${input.tab} (tabs: ${o.tabs.map((x) => x.id).join(', ')})`);
      o.tab = t.id; o.root = t.root;
    }
    if (input.root !== undefined) o.tabs = o.tabs.map((t) => (t.id === o.tab ? { ...t, root: o.root } : t));
    writeUi(ctx.user, { ...ui, overrides: o });
    return o;
  },
  'overrides.tab.add': (input, ctx) => {
    const ui = readUi(ctx.user);
    const root = str(input.root, 400);
    if (root && !isPath(root)) fail('validation', `root: an element path, got "${root}"`);
    if (ui.overrides.tabs.length >= 12) fail('validation', 'twelve tabs at most: remove one first');
    const base = (root ? root.split('/').at(-1) : 'all').replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase().slice(0, 40) || 'tab';
    let id = base; let n = 2;
    while (ui.overrides.tabs.some((t) => t.id === id)) id = `${base}-${n++}`;
    const label = str(input.label, 60) || (root ? labelOfSegment(parsePath(root).segments.at(-1) ?? { name: parsePath(root).root.kind, id: parsePath(root).root.instance }, parsePath(root).root.kind) : 'Everything');
    const tab = { id, root, label };
    const o = { ...ui.overrides, tabs: [...ui.overrides.tabs, tab], tab: id, root };
    writeUi(ctx.user, { ...ui, overrides: o });
    return { tab, tabs: o.tabs };
  },
  'overrides.tab.remove': (input, ctx) => {
    const ui = readUi(ctx.user);
    const id = str(input.id, 80);
    if (!ui.overrides.tabs.some((t) => t.id === id)) fail('not_found', `no tab ${id}`);
    let tabs = ui.overrides.tabs.filter((t) => t.id !== id);
    if (!tabs.length) tabs = DEFAULT_UI().overrides.tabs;
    const tab = tabs.some((t) => t.id === ui.overrides.tab) ? ui.overrides.tab : tabs[0].id;
    const o = { ...ui.overrides, tabs, tab, root: tabs.find((t) => t.id === tab)?.root ?? '' };
    writeUi(ctx.user, { ...ui, overrides: o });
    return { removed: id, tabs };
  },
  'overrides.reset': (input, ctx) => {
    const id = str(input.id, 600);
    const p = parseRecordId(id);
    if (!p) fail('validation', `id: a record id <path>|<scope>|<token>, got "${id}"`);
    const store = ctx.store();
    const rec = store.get(p.path, p.token, p.scope, p.asset);
    if (!rec) fail('not_found', `no override ${id} (already back on axHub?)`);
    store.unset(p.path, p.token, p.scope, p.asset);
    const l = ledger(); if (l[id]) { delete l[id]; writeJson(LEDGER_FILE(), l); }
    return { changed: true, reset: id, record: rec, now: `${rec.token} on ${rec.path} inherits ${rec.axHubValue ?? 'the theme'} from axHub again` };
  },
};
export const OP_NAMES = Object.keys(OPS);

/** Run one request → `{ ok: true, data }` or `{ ok: false, code, message }`. Never throws. */
export function runOp(req = {}) {
  const op = String(req.op ?? '');
  const fn = OPS[op];
  if (!fn) return { ok: false, code: 'invalid', message: `unknown op ${op} (${OP_NAMES.join(', ')})` };
  const by = str(req.by, 80);
  let store;
  const ctx = { user: req.user, by, store: () => (store ??= createOverridesStore({ settings: appearanceSettings(by), by })) };
  try {
    return { ok: true, op, data: fn(req.input && typeof req.input === 'object' ? req.input : {}, ctx) };
  } catch (e) {
    if (e instanceof InlineEditError) return { ok: false, op, code: e.code, message: e.message, ...e.extra };
    return { ok: false, op, code: 'unexpected', message: String(e?.message ?? e).slice(0, 400) };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'run') {
    let body = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { body += c; });
    process.stdin.on('end', () => {
      let req = {};
      try { req = JSON.parse(body || '{}'); } catch { console.log(JSON.stringify({ ok: false, code: 'invalid', message: 'the request is not JSON' })); return; }
      console.log(JSON.stringify(runOp(req)));
    });
  } else {
    console.log('node engine.mjs run  (one request as JSON on stdin: { op, input, user?, by? })');
  }
}
