/**
 * context-menu@1 rules (Fable, Nov 13 2026) — the one true source of every context menu, kept on axHub.
 *
 * Brett: "integrated with the UI manager; stores its data in one true source on axHub accessible from any plugin;
 * contains the context menus, which are effectively assets; lists all the context menus; uses Claude to generate a
 * context menu at advanced, pro, amateur, beginner coder levels, mapped out more meticulously depending on level".
 *
 * Pure rules, no I/O (the store, the CLI and the server part are in the console plugin `context-menus`; the Kotlin twin
 * is a deferred gap in framework/spec/PORTING.md). Fixture: framework/spec/fixtures/context-menus.json, check:
 * framework/spec/check-context-menus.mjs.
 *
 *   context-menu@1   one context menu: a standard asset@1 of type `context-menu` (what the runtime draws) wrapped with
 *                    where it belongs (app, page), the coder level it was mapped at, who / what made it and when.
 *   ctx-zone@1       one zone: a `data-fx-ctx-target` the app draws (or an implicit one: toolbar, tab-group, nav …),
 *                    with its owner (framework, console, plugin, app), pages, elements and weight (core / common / rare).
 *   ctx-level@1      the four coder levels and how meticulously each maps the app.
 *   ctx-history@1    snapshots of a menu (restore like skins).
 */

export const FORMAT = 'context-menu@1';
export const ZONE_FORMAT = 'ctx-zone@1';
export const LEVEL_FORMAT = 'ctx-level@1';
export const HISTORY_FORMAT = 'ctx-history@1';
export const DRAFT_FORMAT = 'ctx-draft@1';
export const CAPABILITY = 'context-menus@1';
export const ASSET_PREFIX = 'ctx-';
export const HISTORY_MAX = 20;
export const DEFAULT_APP = 'console-web';

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const ASSET_ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const ACTION_RE = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;
export const VARIANTS = ['compact', 'roomy', 'glass'];
export const SOURCES = ['claude', 'hand', 'imported', 'scan'];
export const WEIGHTS = ['core', 'common', 'rare'];
export const OWNER_KINDS = ['framework', 'console', 'plugin', 'app'];

/** Targets the runtime opens without a data attribute (framework/react/components/Overlays.tsx ContextMenuHost). */
export const IMPLICIT_ZONES = Object.freeze([
  { id: 'default', label: 'Anywhere (default)', weight: 'core', note: 'right-click / long-press on anything that names no zone' },
  { id: 'toolbar', label: 'Toolbar', weight: 'core', note: 'every role="toolbar"' },
  { id: 'tab-group', label: 'Tab row', weight: 'common', note: 'every role="tablist"' },
  { id: 'nav', label: 'Navigation', weight: 'common', note: 'every <nav>' },
]);

/**
 * ctx-level@1 — how meticulously each coder level maps the app. Higher levels cover more zones, allow deeper menus
 * and more items before the rest folds into "More…" (menus are slim by default).
 */
export const LEVELS = Object.freeze({
  beginner: Object.freeze({ id: 'beginner', label: 'Beginner', order: 1, perTarget: 5, depth: 0, zones: 'core', shortcuts: false, developer: false,
    brief: 'A few big, obvious actions. Only the zones everyone meets (anywhere, toolbar). Plain words, no jargon, no shortcuts, no submenus.' }),
  amateur: Object.freeze({ id: 'amateur', label: 'Amateur', order: 2, perTarget: 8, depth: 1, zones: 'common', shortcuts: false, developer: false,
    brief: 'The common actions a regular user reaches for, grouped with separators. Core and common zones. One level of submenu at most.' }),
  pro: Object.freeze({ id: 'pro', label: 'Pro', order: 3, perTarget: 14, depth: 1, zones: 'all', shortcuts: true, developer: false,
    brief: 'The full working set, grouped by purpose, shortcuts shown, every zone covered with what fits it. Rarely used items fold under More.' }),
  advanced: Object.freeze({ id: 'advanced', label: 'Advanced coder', order: 4, perTarget: 20, depth: 2, zones: 'all', shortcuts: true, developer: true,
    brief: 'A meticulous map of every zone with deep actions: tokens, API addresses, inspect, copy ids, run commands, open in the UI Manager. Submenus two deep. Everything still slim: rare items fold away.' }),
});
export const LEVEL_IDS = Object.freeze(Object.keys(LEVELS));
export const isLevel = (x) => typeof x === 'string' && Object.hasOwn(LEVELS, x);

/* ---------------- small helpers ---------------- */

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v) => (Array.isArray(v) ? v : []);
export const slug = (s, max = 40) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'menu';

/** The runtime asset id of a menu: `ctx-<id>`, always within asset@1's id pattern. */
export function assetIdOf(id) {
  const base = slug(id, 44);
  return `${ASSET_PREFIX}${base}`.slice(0, 48).replace(/-+$/, '');
}

/* ---------------- zones (ctx-zone@1) ---------------- */

/** Owner of a source path: a plugin folder, the console's own code, the framework, or another app. */
export function ownerOfPath(path) {
  const p = String(path ?? '').replace(/\\/g, '/');
  let m = /apps\/([a-z0-9-]+)\/plugins\/([a-z0-9_-]+)\//.exec(p);
  if (m) return { kind: 'plugin', id: m[2], app: m[1] };
  m = /^framework\//.exec(p);
  if (m) return { kind: 'framework', id: 'framework', app: '' };
  m = /apps\/([a-z0-9-]+)\//.exec(p);
  if (m) return { kind: m[1] === 'console-web' ? 'console' : 'app', id: m[1], app: m[1] };
  return { kind: 'app', id: '', app: '' };
}

export function normalizeZone(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = str(r.id, 120).toLowerCase();
  const owner = r.owner && typeof r.owner === 'object' ? r.owner : ownerOfPath(r.file);
  const weight = WEIGHTS.includes(r.weight) ? r.weight : 'rare';
  return {
    $axf: ZONE_FORMAT,
    id,
    label: str(r.label, 80) || id.replace(/^axf-/, '').replace(/[-_:]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    owner: { kind: OWNER_KINDS.includes(owner.kind) ? owner.kind : 'app', id: str(owner.id, 80), app: str(owner.app, 80) },
    pages: [...new Set(arr(r.pages).map((p) => str(p, 80)).filter(Boolean))].sort(),
    elements: [...new Set(arr(r.elements).map((p) => str(p, 160)).filter(Boolean))].sort(),
    files: [...new Set(arr(r.files).map((p) => str(p, 200)).filter(Boolean))].sort(),
    weight,
    implicit: !!r.implicit,
    note: str(r.note, 200),
  };
}

/** Merge zones found by a code scan, the open console and the implicit ones into one registry (by id). */
export function mergeZones(...lists) {
  const out = new Map();
  for (const z of IMPLICIT_ZONES) out.set(z.id, normalizeZone({ ...z, implicit: true, owner: { kind: 'framework', id: 'framework', app: '' } }));
  for (const list of lists) for (const raw of arr(list)) {
    const z = normalizeZone(raw);
    if (!z.id) continue;
    const prev = out.get(z.id);
    if (!prev) { out.set(z.id, z); continue; }
    out.set(z.id, {
      ...prev,
      label: prev.implicit ? prev.label : z.label || prev.label,
      owner: prev.owner.id ? prev.owner : z.owner,
      pages: [...new Set([...prev.pages, ...z.pages])].sort(),
      elements: [...new Set([...prev.elements, ...z.elements])].sort(),
      files: [...new Set([...prev.files, ...z.files])].sort(),
      weight: WEIGHTS.indexOf(z.weight) < WEIGHTS.indexOf(prev.weight) ? z.weight : prev.weight,
      note: prev.note || z.note,
    });
  }
  return [...out.values()].sort((a, b) => WEIGHTS.indexOf(a.weight) - WEIGHTS.indexOf(b.weight) || a.id.localeCompare(b.id));
}

/** Weight of a zone found in code: the ones on shared chrome are core, repeated ones common, the rest rare. */
export function weightOf(id, uses = 1) {
  if (['default', 'toolbar', 'banner', 'axf-banner', 'nav', 'nav-item', 'tab-group', 'app-menu', 'window-title'].includes(id)) return 'core';
  return uses >= 3 ? 'common' : 'rare';
}

/** The zones a level maps: core only, core + common, or every zone. */
export function zonesForLevel(level, zones) {
  const l = LEVELS[level] ?? LEVELS.pro;
  const allowed = l.zones === 'core' ? ['core'] : l.zones === 'common' ? ['core', 'common'] : WEIGHTS;
  return arr(zones).filter((z) => allowed.includes(z.weight));
}

/* ---------------- items ---------------- */

export function normalizeItem(raw, depth = 0, maxDepth = 2) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = slug(r.id || r.label || 'item', 48);
  if (r.separator) return { id, separator: true };
  const it = { id, label: str(r.label, 60) || id };
  if (str(r.icon, 40)) it.icon = str(r.icon, 40);
  if (ACTION_RE.test(str(r.action, 120))) it.action = str(r.action, 120);
  if (str(r.shortcut, 24)) it.shortcut = str(r.shortcut, 24);
  if (str(r.checked, 80)) it.checked = str(r.checked, 80);
  if (str(r.note, 160)) it.note = str(r.note, 160);
  if (arr(r.items).length && depth < maxDepth) it.items = normalizeItems(r.items, depth + 1, maxDepth);
  return it;
}

export function normalizeItems(items, depth = 0, maxDepth = 2) {
  const out = [];
  const seen = new Set();
  for (const raw of arr(items)) {
    const it = normalizeItem(raw, depth, maxDepth);
    if (it.separator) { if (out.length && !out[out.length - 1].separator) out.push({ id: `s${out.length}`, separator: true }); continue; }
    if (!it.action && !it.items?.length) continue;
    let id = it.id; let n = 2;
    while (seen.has(id)) id = `${it.id}-${n++}`;
    seen.add(id);
    out.push({ ...it, id });
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

export function validateItems(items, path = 'items') {
  const errs = [];
  if (!Array.isArray(items)) return [`${path} must be a list`];
  items.forEach((it, i) => {
    const p = `${path}[${i}]`;
    if (!it || typeof it !== 'object') { errs.push(`${p} must be an object`); return; }
    if (typeof it.id !== 'string' || !it.id) errs.push(`${p}.id required`);
    if (it.separator) return;
    if (typeof it.label !== 'string' || !it.label) errs.push(`${p}.label required`);
    if (it.action !== undefined && !ACTION_RE.test(String(it.action))) errs.push(`${p}.action is not an action id`);
    if (!it.action && !(Array.isArray(it.items) && it.items.length)) errs.push(`${p} needs an action or items`);
    if (it.items !== undefined) errs.push(...validateItems(it.items, `${p}.items`));
  });
  return errs;
}

/** Count the items (not separators) of a tree. */
export function countItems(items) { return arr(items).reduce((n, it) => n + (it.separator ? 0 : 1 + countItems(it.items)), 0); }
export function depthOf(items) { return arr(items).reduce((d, it) => Math.max(d, it.items?.length ? 1 + depthOf(it.items) : 0), 0); }

/**
 * Slim by default: at most `budget` visible entries per target; the rest fold under one "More…" submenu (rare items
 * first, in their original order), separators never counted. Depth is capped at `depth` (deeper submenus are flattened
 * into their parent).
 */
export function slim(items, budget, depth = 1) {
  const cap = (list, d) => list.map((it) => {
    if (!it.items?.length) return it;
    if (d >= depth) {
      const flat = it.items.filter((x) => !x.separator && x.action);
      const { items: _kids, ...own } = it;
      return flat.length === 1 ? { ...flat[0], id: it.id, label: it.label } : { ...own, ...(flat[0]?.action ?? it.action ? { action: flat[0]?.action ?? it.action } : {}) };
    }
    return { ...it, items: cap(it.items, d + 1) };
  }).filter((it) => it.separator || it.action || it.items?.length);
  const list = cap(arr(items), 0);
  const strip = (xs) => xs.map(({ rare: _r, ...x }) => (x.items ? { ...x, items: strip(x.items) } : x));
  const real = list.filter((x) => !x.separator);
  if (real.length <= budget) return strip(list);
  const keepN = Math.max(1, budget - 1);
  // the first non-rare items stay in order; rare ones only when room is left
  const keepSet = new Set();
  for (const x of real) if (!x.rare && keepSet.size < keepN) keepSet.add(x.id);
  for (const x of real) if (keepSet.size < keepN && !keepSet.has(x.id)) keepSet.add(x.id);
  const kept = []; const folded = [];
  for (const x of list) {
    if (x.separator) { if (kept.length && !kept[kept.length - 1].separator) kept.push(x); continue; }
    (keepSet.has(x.id) ? kept : folded).push(x);
  }
  while (kept.length && kept[kept.length - 1].separator) kept.pop();
  const more = strip(folded);
  const out = strip(kept);
  if (more.length) out.push({ id: 'ctx-more-sep', separator: true }, { id: 'more', label: 'More…', icon: 'more', items: more });
  return out;
}

/* ---------------- the menu (context-menu@1) ---------------- */

export function normalizeMenu(raw, now = new Date().toISOString()) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const a = r.asset && typeof r.asset === 'object' ? r.asset : {};
  let id = slug(r.id || a.id?.replace(new RegExp(`^${ASSET_PREFIX}`), '') || r.name || a.name, 44);
  if (id.length < 2) id = `${id}-menu`;
  const level = isLevel(r.level) ? r.level : 'pro';
  const data = a.data && typeof a.data === 'object' ? a.data : {};
  const targets = {};
  for (const [k, v] of Object.entries(data.targets && typeof data.targets === 'object' ? data.targets : {})) {
    const key = str(k, 120).toLowerCase();
    if (!key) continue;
    targets[key] = normalizeItems(v, 0, LEVELS[level].depth + 1);
  }
  if (!targets.default) targets.default = [];
  const asset = {
    $axf: 'asset@1',
    type: 'context-menu',
    id: assetIdOf(id),
    name: str(a.name || r.name, 80) || `Context menus (${LEVELS[level].label})`,
    version: /^\d+\.\d+\.\d+$/.test(str(a.version, 20)) ? a.version : '1.0.0',
    description: str(a.description || r.description, 300),
    author: str(a.author, 80) || 'Context menus',
    tags: [...new Set(['context-menus', level, ...arr(a.tags).map((t) => str(t, 40)).filter(Boolean)])],
    data: {
      variant: VARIANTS.includes(data.variant) ? data.variant : 'compact',
      showIcons: data.showIcons !== false,
      showShortcuts: typeof data.showShortcuts === 'boolean' ? data.showShortcuts : LEVELS[level].shortcuts,
      targets,
      ...(data.contributions === false ? { contributions: false } : {}),
    },
  };
  return {
    $axf: FORMAT,
    id,
    name: asset.name,
    level,
    app: str(r.app, 80) || DEFAULT_APP,
    page: str(r.page, 80),
    source: SOURCES.includes(r.source) ? r.source : 'hand',
    model: str(r.model, 80),
    by: str(r.by, 80),
    active: !!r.active,
    createdAt: str(r.createdAt, 40) || now,
    updatedAt: str(r.updatedAt, 40) || now,
    asset,
  };
}

export function validateMenu(doc) {
  const errs = [];
  if (!doc || typeof doc !== 'object') return ['menu must be an object'];
  if (doc.$axf !== FORMAT) errs.push(`$axf must be ${FORMAT}`);
  if (!ID_RE.test(String(doc.id ?? ''))) errs.push('id: lowercase letters, digits and dashes, 2 to 48 characters');
  if (!isLevel(doc.level)) errs.push(`level must be one of ${LEVEL_IDS.join(', ')}`);
  if (typeof doc.app !== 'string' || !doc.app) errs.push('app required');
  const a = doc.asset;
  if (!a || typeof a !== 'object') return [...errs, 'asset required'];
  if (a.$axf !== 'asset@1') errs.push('asset.$axf must be asset@1');
  if (a.type !== 'context-menu') errs.push('asset.type must be context-menu');
  if (!ASSET_ID_RE.test(String(a.id ?? ''))) errs.push('asset.id does not fit asset@1');
  if (typeof a.name !== 'string' || !a.name) errs.push('asset.name required');
  if (!/^\d+\.\d+\.\d+$/.test(String(a.version ?? ''))) errs.push('asset.version must be semver');
  const d = a.data;
  if (!d || typeof d !== 'object') return [...errs, 'asset.data required'];
  if (!VARIANTS.includes(d.variant)) errs.push(`asset.data.variant must be one of ${VARIANTS.join(', ')}`);
  if (typeof d.showIcons !== 'boolean') errs.push('asset.data.showIcons must be boolean');
  if (typeof d.showShortcuts !== 'boolean') errs.push('asset.data.showShortcuts must be boolean');
  if (!d.targets || typeof d.targets !== 'object') errs.push('asset.data.targets required');
  else {
    if (!Array.isArray(d.targets.default)) errs.push('asset.data.targets.default required');
    for (const [k, v] of Object.entries(d.targets)) errs.push(...validateItems(v, `asset.data.targets.${k}`));
  }
  return errs;
}

/** One line per target: what the menu covers (the list page and the preview use it). */
export function summarize(doc) {
  const targets = Object.entries(doc?.asset?.data?.targets ?? {}).map(([id, items]) => ({ id, items: countItems(items), depth: depthOf(items) }));
  return { targets: targets.length, items: targets.reduce((n, t) => n + t.items, 0), depth: targets.reduce((d, t) => Math.max(d, t.depth), 0), zones: targets.map((t) => t.id) };
}

/** Preview before applying: what changes per target between the menu in force and a draft. */
export function diffMenus(current, next) {
  const a = current?.asset?.data?.targets ?? {}; const b = next?.asset?.data?.targets ?? {};
  const flat = (items, prefix = '') => arr(items).flatMap((it) => it.separator ? [] : [`${prefix}${it.label}${it.action ? ` → ${it.action}` : ''}`, ...flat(it.items, `${prefix}${it.label} › `)]);
  const out = [];
  for (const t of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = new Set(flat(a[t])); const y = new Set(flat(b[t]));
    const added = [...y].filter((s) => !x.has(s)); const removed = [...x].filter((s) => !y.has(s));
    out.push({ target: t, status: !(t in a) ? 'new' : !(t in b) ? 'gone' : added.length || removed.length ? 'changed' : 'same', added, removed });
  }
  return out;
}

export function filterMenus(list, { q = '', app = '', level = '', zone = '', source = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return arr(list).filter((m) => {
    if (app && m.app !== app) return false;
    if (level && m.level !== level) return false;
    if (source && m.source !== source) return false;
    if (zone && !(zone in (m.asset?.data?.targets ?? {}))) return false;
    if (!words.length) return true;
    const hay = `${m.id} ${m.name} ${m.level} ${m.app} ${m.page} ${m.source} ${Object.keys(m.asset?.data?.targets ?? {}).join(' ')} ${JSON.stringify(m.asset?.data?.targets ?? {}).toLowerCase()}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/* ---------------- history (ctx-history@1): snapshots and restore like skins ---------------- */

export const emptyHistory = (id) => ({ $axf: HISTORY_FORMAT, id, versions: [] });

export function snapshot(history, doc, by = '', now = new Date().toISOString(), max = HISTORY_MAX) {
  const h = history && history.$axf === HISTORY_FORMAT ? history : emptyHistory(doc.id);
  const last = h.versions[h.versions.length - 1];
  if (last && JSON.stringify(last.doc.asset) === JSON.stringify(doc.asset) && last.doc.level === doc.level) return h;
  const versions = [...h.versions, { v: (last?.v ?? 0) + 1, at: now, by, doc: { ...doc, active: false } }].slice(-max);
  return { ...h, id: doc.id, versions };
}

export function restoreFrom(history, v, now = new Date().toISOString()) {
  const found = arr(history?.versions).find((x) => x.v === Number(v));
  if (!found) return null;
  return normalizeMenu({ ...found.doc, updatedAt: now }, now);
}

/* ---------------- Claude: the prompt and the reply ---------------- */

const DEVELOPER_ACTIONS = [
  { id: 'console.inspect', label: 'Inspect element', icon: 'search' },
  { id: 'console.copy-id', label: 'Copy element id', icon: 'copy' },
  { id: 'console.copy-address', label: 'Copy console-control address', icon: 'link' },
  { id: 'ui-manager.open', label: 'Open in the UI Manager', icon: 'sliders' },
  { id: 'token-control.open', label: 'Tokens of this element', icon: 'palette' },
  { id: 'console-terminal.open', label: 'Open terminal here', icon: 'terminal' },
];

/**
 * The prompt Claude gets: the level's brief, the zones to map (with owner, pages, elements), the real actions the app
 * can run (ids + labels: a menu item may only name one of these), the output contract (one JSON object, the asset's
 * `targets`). Zero tokens are spent here; the caller sends it through axf.llm@1.
 */
export function buildPrompt({ level = 'pro', app = DEFAULT_APP, page = '', zones = [], actions = [], name = '' } = {}) {
  const l = LEVELS[level] ?? LEVELS.pro;
  const zs = zonesForLevel(l.id, mergeZones(zones)).filter((z) => !page || !z.pages.length || z.pages.includes(page));
  const acts = arr(actions).filter((a) => a && ACTION_RE.test(String(a.id ?? ''))).map((a) => ({ id: String(a.id), label: str(a.label, 80) || String(a.id), ...(a.module ? { module: str(a.module, 60) } : {}) }));
  const actionList = [...acts, ...(l.developer ? DEVELOPER_ACTIONS.filter((d) => !acts.some((a) => a.id === d.id)) : [])];
  const system = [
    `You design the right-click (context) menus of the "${app}" app of AmberX AXF for a ${l.label.toUpperCase()} level user.`,
    `Level brief: ${l.brief}`,
    `Rules: at most ${l.perTarget} visible items per zone (rarely used ones go under one "More…" submenu), submenus at most ${l.depth} deep,`,
    `${l.shortcuts ? 'show keyboard shortcuts where an action has a known one' : 'no keyboard shortcuts'}, ${l.developer ? 'include developer actions (inspect, copy ids, console-control addresses, tokens, UI Manager, terminal)' : 'no developer jargon'}.`,
    'Every item names exactly one action id from the ACTIONS list; never invent an action. Labels are short verbs in plain English, icons are short lowercase names.',
    'Reply with ONE JSON object and nothing else: {"name": "...", "variant": "compact"|"roomy"|"glass", "targets": {"<zone id>": [ {"id","label","icon","action","shortcut"?,"rare"?} | {"id","separator":true} | {"id","label","icon","items":[...]} ]}}.',
    'The "default" zone is required. Mark items a user rarely needs with "rare": true so they fold away. Keep the menu slim: no wasted space.',
  ].join('\n');
  const zoneLines = zs.map((z) => `- ${z.id}: ${z.label}${z.owner.kind === 'plugin' ? ` (plugin ${z.owner.id})` : z.owner.kind === 'framework' ? ' (framework chrome)' : ''}${z.pages.length ? ` · pages: ${z.pages.slice(0, 8).join(', ')}` : ''}${z.elements.length ? ` · elements: ${z.elements.slice(0, 6).join(', ')}` : ''}${z.note ? ` · ${z.note}` : ''}`);
  const user = [
    `APP: ${app}${page ? `  PAGE: ${page}` : ''}`,
    name ? `MENU NAME: ${name}` : '',
    `ZONES (${zs.length}):`, ...zoneLines,
    `ACTIONS (${actionList.length}):`, ...actionList.map((a) => `- ${a.id}: ${a.label}${a.module ? ` [${a.module}]` : ''}`),
    'Map every zone listed. Reply with the JSON object only.',
  ].filter(Boolean).join('\n');
  return { system, messages: [{ role: 'user', content: user }], level: l.id, zones: zs.map((z) => z.id), actions: actionList.map((a) => a.id) };
}

/** The JSON object in a model reply (bare, or inside a code fence, or with words around it). */
export function parseReply(text) {
  const s = String(text ?? '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidates = [fence?.[1], s, s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)].filter((x) => typeof x === 'string' && x.trim());
  for (const c of candidates) { try { const v = JSON.parse(c); if (v && typeof v === 'object') return v; } catch { /* next */ } }
  return null;
}

/**
 * Claude's reply → a context-menu@1 document: unknown actions dropped (a warning each), unknown zones dropped,
 * every target slimmed to the level, the default target guaranteed (the level's first items when Claude left it empty).
 */
export function fromReply(reply, { level = 'pro', app = DEFAULT_APP, page = '', zones = [], actions = [], id = '', name = '', by = '', model = '', now = new Date().toISOString() } = {}) {
  const l = LEVELS[level] ?? LEVELS.pro;
  const obj = typeof reply === 'string' ? parseReply(reply) : reply;
  const warnings = [];
  if (!obj) return { doc: null, warnings: ['the reply held no JSON object'] };
  const known = new Set([...arr(actions).map((a) => String(a?.id ?? '')), ...(l.developer ? DEVELOPER_ACTIONS.map((d) => d.id) : [])].filter(Boolean));
  const zoneIds = new Set(mergeZones(zones).map((z) => z.id));
  const clean = (items, depth) => arr(items).flatMap((it) => {
    if (!it || typeof it !== 'object') return [];
    if (it.separator) return [{ id: str(it.id, 48) || 'sep', separator: true }];
    if (arr(it.items).length) { const kids = clean(it.items, depth + 1); return kids.filter((k) => !k.separator).length ? [{ ...it, items: kids }] : []; }
    const action = str(it.action, 120);
    if (!known.has(action)) { warnings.push(`dropped "${str(it.label, 60) || it.id}": unknown action "${action}"`); return []; }
    return [{ ...it, action, ...(it.rare ? { rare: true } : {}) }];
  });
  const targets = {};
  for (const [zone, items] of Object.entries(obj.targets && typeof obj.targets === 'object' ? obj.targets : {})) {
    const z = str(zone, 120).toLowerCase();
    if (!zoneIds.has(z)) { warnings.push(`dropped zone "${z}": not a zone of ${app}`); continue; }
    const cleaned = clean(items, 0);
    const marked = markRare(normalizeItems(cleaned, 0, l.depth + 1), cleaned);
    targets[z] = slim(marked, l.perTarget, l.depth);
  }
  if (!targets.default?.length) {
    const first = [...known].slice(0, Math.min(3, l.perTarget)).map((a) => ({ id: slug(a), label: arr(actions).find((x) => x.id === a)?.label || a, action: a }));
    if (first.length) { targets.default = normalizeItems(first); warnings.push('default zone was empty: filled with the first actions'); }
  }
  const menuId = slug(id || `${app}-${l.id}${page ? `-${page}` : ''}`, 44);
  const doc = normalizeMenu({
    id: menuId, name: str(name, 80) || str(obj.name, 80) || `${LEVELS[l.id].label} context menus · ${app}${page ? ` · ${page}` : ''}`,
    level: l.id, app, page, source: 'claude', model, by, createdAt: now, updatedAt: now,
    asset: { data: { variant: VARIANTS.includes(obj.variant) ? obj.variant : 'compact', showIcons: true, showShortcuts: l.shortcuts, targets } },
  }, now);
  return { doc, warnings };
}

/** Carry the model's `rare` marks over normalisation (normalizeItem drops unknown keys) so slim() can fold them. */
function markRare(normalized, original) {
  const rare = new Set(arr(original).filter((x) => x && x.rare && !x.separator).map((x) => slug(x.id || x.label || 'item', 48)));
  return normalized.map((it) => (rare.has(it.id) ? { ...it, rare: true } : it));
}

/* ---------------- voice ---------------- */

/**
 * A spoken or typed sentence → what to do: "generate pro context menus", "make beginner menus for the console",
 * "preview advanced coder context menu", "apply", "list context menus", "use <id>".
 */
export function matchPhrase(text) {
  const s = String(text ?? '').toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const level = LEVEL_IDS.find((l) => new RegExp(`\\b${l}\\b`).test(s)) ?? (/\badvanced\b|\bcoder\b|\bdeveloper\b/.test(s) ? 'advanced' : /\bprofessional\b/.test(s) ? 'pro' : /\bnovice\b|\bbasic\b/.test(s) ? 'beginner' : /\bcasual\b/.test(s) ? 'amateur' : '');
  const appM = /\b(?:for|of|in) (?:the )?([a-z][a-z0-9-]+)(?: app)?\b/.exec(s);
  const app = appM && !LEVEL_IDS.includes(appM[1]) && !/^(context|menus?|console app)$/.test(appM[1]) ? (appM[1] === 'console' ? 'console-web' : appM[1]) : '';
  if (/\b(generate|make|build|create|write|map)\b/.test(s) && /\bmenus?\b/.test(s)) return { op: 'generate', level: level || 'pro', app: app || DEFAULT_APP, preview: /\bpreview\b/.test(s) };
  if (/\bpreview\b/.test(s) && /\bmenus?\b/.test(s)) return { op: 'generate', level: level || 'pro', app: app || DEFAULT_APP, preview: true };
  if (/\bapply\b|\bput .* live\b|\buse the (?:draft|preview)\b/.test(s)) return { op: 'apply' };
  if (/\b(list|show|which|what)\b.*\bmenus\b/.test(s)) return { op: 'list', ...(level ? { level } : {}), ...(app ? { app } : {}) };
  const useM = /\b(?:use|switch to|activate) (?:the )?(?:context )?menus? ([a-z0-9-]{2,48})\b/.exec(s);
  if (useM) return { op: 'use', id: useM[1] };
  if (/\brestore\b/.test(s) && /\bmenus?\b/.test(s)) return { op: 'restore' };
  return null;
}
