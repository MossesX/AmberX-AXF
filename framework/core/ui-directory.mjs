/**
 * ui-directory@1 — one live data set of every UI surface across every AmberX AXF app (pure, IO-free).
 *
 * Brett, Nov 14 2026: "a plugin that's just a data set of every single UI page and settings interface, that scales
 * and grows on its own dynamically." Every screen, page, tab, dialog, settings interface, settings panel, plugin UI
 * and banner, from every app, in one shape, populated from what the repo already registers (the console-control
 * inventory, plugin manifests and their web registrations, app manifests, UI registries). Nothing is hand-kept: a new
 * UI appears on the next build, a removed one drops out, and the change log says which build moved it.
 *
 * This module is the contract the UI Directory plugin (its collector, server, page, CLI), the CI check and every
 * other reader share: the row shape, the kinds, ids, validation, the content hash, add/remove diffs, history merge,
 * the token-family classifier, the four-way reach of a row (REST / MCP / CLI / voice from one address) and the
 * tree / search / filter projections the page draws from. No files, no DOM, no git here: the collector hands rows in.
 *
 * Records (each `$axf`-tagged):
 *   ui-directory@1       the data set: generatedAt, hash, counts, rows
 *   ui-directory-row@1   one UI surface: id, name, kind, app, parent, plugin, address, deep link, settings, tokens,
 *                        status, source, file, keywords
 */

export const SCHEMA = 'ui-directory@1';
export const ROW = 'ui-directory-row@1';
export const VERSION = 1;

/** What a row can be. `screen` = a view / page; `tab` covers tab rows and sub-tabs (`level`). */
export const KINDS = ['app', 'screen', 'tab', 'dialog', 'settings-tab', 'settings-panel', 'plugin', 'banner', 'window', 'element'];
export const KIND_LABEL = Object.freeze({ app: 'App', screen: 'Screen', tab: 'Tab', dialog: 'Dialog', 'settings-tab': 'Settings', 'settings-panel': 'Settings panel', plugin: 'Plugin UI', banner: 'Banner', window: 'Window', element: 'UI element' });
/** Where a row was read from. */
export const SOURCES = ['shell', 'framework', 'plugin', 'manifest', 'inventory', 'ui-registry', 'help'];
/**
 * live      registered and reachable (it has a deep link)
 * dynamic   its id is only known at run time (a TabGroup whose id is built from data); addressable once rendered
 * unlinked  registered but no deep link is known: the CI check ratchets these down
 * off       its plugin is not enabled by default (the row stays so it can be found and switched on)
 */
export const STATUSES = ['live', 'dynamic', 'unlinked', 'off'];
export const STATUS_LABEL = Object.freeze({ live: 'Live', dynamic: 'Dynamic', unlinked: 'No deep link', off: 'Off' });
/** Tone names are theme tokens (the UI maps them to --fx-* colours), never colours. */
export const STATUS_TONE = Object.freeze({ live: 'ok', dynamic: 'info', unlinked: 'warn', off: 'muted' });

/**
 * Asset-token families (the hot-swappable asset system): every `--fx-<segment>-…` token belongs to one. A row's
 * `tokens` lists the families its code uses, so the directory shows at a glance what a screen is styled from.
 */
export const TOKEN_FAMILIES = ['color', 'type', 'dens', 'size', 'space', 'radius', 'border', 'font', 'motion', 'shadow', 'opacity', 'component'];
const FAMILY_OF_SEGMENT = Object.freeze({
  type: 'type', dens: 'dens', size: 'size', space: 'space', radius: 'radius', border: 'border', font: 'font',
  motion: 'motion', ease: 'motion', shadow: 'shadow', blur: 'shadow', backdrop: 'shadow', opacity: 'opacity',
  accent: 'color', surface: 'color', muted: 'color', text: 'color', danger: 'color', warning: 'color', success: 'color', info: 'color', bg: 'color', brand: 'color', focus: 'color',
});
const TOKEN_RE = /--fx-([a-z]+)/g;

/** The MCP tools a deep link can use (console-commands@1 CONSOLE_TOOLS) and what each kind opens with. */
export const DEEP_LINK_TOOLS = ['console_open', 'console_settings', 'console_dialog'];
const TOOL_OF_KIND = Object.freeze({ screen: 'console_open', tab: 'console_open', 'settings-tab': 'console_settings', 'settings-panel': 'console_settings', dialog: 'console_dialog', plugin: 'console_open', banner: 'console_open', window: 'console_open', element: 'console_open', app: '' });

export const REGISTRY = Object.freeze({
  $id: 'axf/ui-directory',
  schema: SCHEMA,
  row: ROW,
  version: VERSION,
  kinds: KINDS,
  sources: SOURCES,
  statuses: STATUSES,
  tokenFamilies: TOKEN_FAMILIES,
  deepLinkTools: DEEP_LINK_TOOLS,
  idPattern: '^[a-z0-9][a-z0-9._%-]*(:[a-z0-9][a-z0-9._%=*-]*){1,4}$',
  appPattern: '^[a-z0-9][a-z0-9-]{0,47}$',
  maxName: 200,
  maxKeywords: 24,
  maxRows: 20000,
  rowRequired: ['$axf', 'id', 'name', 'kind', 'app', 'status', 'source'],
  rowOptional: ['parent', 'plugin', 'address', 'deepLink', 'settings', 'tokens', 'file', 'icon', 'detail', 'keywords', 'level', 'dynamic', 'firstSeen'],
  directoryRequired: ['$axf', 'generatedAt', 'hash', 'counts', 'total', 'rows'],
});

const ID_RE = new RegExp(REGISTRY.idPattern);
const APP_RE = new RegExp(REGISTRY.appPattern);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

const str = (v, n = 400) => (typeof v === 'string' ? v.trim().slice(0, n) : v == null ? '' : String(v).trim().slice(0, n));
const list = (v) => (Array.isArray(v) ? v : []);
const uniq = (a) => [...new Set(a)];
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stable row id: `<app>:<kind>:<path…>`; every segment lower-cased, `/` and spaces folded. */
export function rowId(app, kind, ...path) {
  const seg = (s) => str(s, 160).toLowerCase().replace(/\s+/g, '-').replace(/\//g, '%2f').replace(/[^a-z0-9._%=*-]/g, '-').replace(/^-+|-+$/g, '');
  return [seg(app), seg(kind), ...path.map(seg).filter(Boolean)].join(':');
}

/** The family of one token name (`--fx-type-sm` → type); an unknown `--fx-<x>` is a component token. */
export function tokenFamily(token) {
  const m = /^--fx-([a-z]+)/.exec(str(token, 80));
  if (!m) return '';
  return FAMILY_OF_SEGMENT[m[1]] ?? 'component';
}

/** Every token family a piece of CSS / TSX uses, in TOKEN_FAMILIES order. */
export function familiesOf(text) {
  const found = new Set();
  for (const m of String(text ?? '').matchAll(TOKEN_RE)) found.add(FAMILY_OF_SEGMENT[m[1]] ?? 'component');
  return TOKEN_FAMILIES.filter((f) => found.has(f));
}

/** The status a row has from its facts: off beats dynamic beats unlinked beats live. */
export function statusOf({ enabled = true, dynamic = false, address = '', deepLink = null } = {}) {
  if (enabled === false) return 'off';
  if (dynamic) return 'dynamic';
  if (!address && !deepLink) return 'unlinked';
  return 'live';
}

/**
 * How a row is reached without its UI: the same address through the four doors (Brett, Nov 8 2026: everything comes
 * with an API). `null` for an app row or a row with no address (status unlinked / dynamic).
 */
export function reachOf(row) {
  const r = normRow(row);
  if (r.kind === 'app') return null;
  const tool = r.deepLink?.tool || TOOL_OF_KIND[r.kind] || 'console_open';
  const target = r.deepLink?.target || r.address;
  if (!target) return null;
  // with a console-control address the one verb `open` reaches it; a dialog (no address) goes through the console
  // commands API, the same thing the MCP tool does
  if (r.address) return { mcp: { tool, target }, rest: { method: 'POST', path: '/api/console-control/do', body: { verb: 'open', address: r.address } }, cli: `axf console do open ${r.address}`, voice: `open ${r.name}` };
  const route = tool === 'console_dialog' ? ['dialog', 'id'] : tool === 'console_settings' ? ['settings', 'tab'] : ['open', 'screen'];
  return { mcp: { tool, target }, rest: { method: 'POST', path: `/api/plugins/console-commands/${route[0]}`, body: { [route[1]]: target } }, cli: `axf console-commands ${route[0]} --${route[1]} ${target}`, voice: `open ${r.name}` };
}

/** One row brought to shape: strings trimmed, lists deduped and capped, status derived when missing. Never throws. */
export function normRow(row, { now = '' } = {}) {
  const r = isObj(row) ? row : {};
  const kind = KINDS.includes(r.kind) ? r.kind : '';
  const app = str(r.app, 48).toLowerCase();
  const address = str(r.address, 400);
  const deepLink = isObj(r.deepLink) && DEEP_LINK_TOOLS.includes(r.deepLink.tool) && str(r.deepLink.target) ? { tool: r.deepLink.tool, target: str(r.deepLink.target, 400) } : address && kind ? { tool: TOOL_OF_KIND[kind] || 'console_open', target: str(r.deepLink?.target, 400) || address } : null;
  const out = {
    $axf: ROW,
    id: str(r.id, 400).toLowerCase() || (kind && app ? rowId(app, kind, r.name) : ''),
    name: str(r.name, REGISTRY.maxName),
    kind,
    app,
    parent: str(r.parent, 400),
    plugin: str(r.plugin, 80),
    address,
    deepLink: kind === 'app' ? null : deepLink,
    settings: str(r.settings, 400),
    tokens: TOKEN_FAMILIES.filter((f) => list(r.tokens).includes(f)),
    status: STATUSES.includes(r.status) ? r.status : statusOf({ enabled: r.enabled !== false, dynamic: !!r.dynamic, address, deepLink }),
    source: SOURCES.includes(r.source) ? r.source : '',
    file: str(r.file, 300),
    icon: str(r.icon, 60),
    detail: str(r.detail, 300),
    keywords: uniq(list(r.keywords).map((k) => str(k, 80)).filter(Boolean)).slice(0, REGISTRY.maxKeywords),
  };
  if (Number.isInteger(r.level) && r.level >= 0) out.level = r.level;
  if (r.dynamic) out.dynamic = true;
  const seen = ISO_RE.test(str(r.firstSeen, 40)) ? str(r.firstSeen, 40) : now; // a bad timestamp falls back to the scan time
  if (ISO_RE.test(seen)) out.firstSeen = seen;
  // an app is a container, not a place to open: it has no deep link and is never "unlinked"
  if (out.kind === 'app') { out.deepLink = null; if (out.status === 'unlinked') out.status = 'live'; }
  return out;
}

/** Validation: { ok, errors: [{ field, code, message }] }. Every error names its field. */
export function validateRow(row) {
  const errors = [];
  const bad = (field, code, message) => errors.push({ field, code, message });
  if (!isObj(row)) return { ok: false, errors: [{ field: 'row', code: 'type', message: 'row must be an object' }] };
  for (const f of REGISTRY.rowRequired) if (row[f] === undefined || row[f] === null || row[f] === '') bad(f, 'missing', `${f} is missing`);
  if (row.$axf !== undefined && row.$axf !== ROW) bad('$axf', 'invalid', `$axf must be ${ROW}`);
  if (row.id !== undefined && !(typeof row.id === 'string' && ID_RE.test(row.id))) bad('id', 'invalid', 'id must be <app>:<kind>:<path> in lower case');
  if (row.name !== undefined && (typeof row.name !== 'string' || !row.name.trim())) bad('name', 'invalid', 'name must be a non-empty string');
  if (row.kind !== undefined && !KINDS.includes(row.kind)) bad('kind', 'enum', `kind must be one of ${KINDS.join(', ')}`);
  if (row.app !== undefined && !(typeof row.app === 'string' && APP_RE.test(row.app))) bad('app', 'invalid', 'app must be a folder-like id');
  if (row.status !== undefined && !STATUSES.includes(row.status)) bad('status', 'enum', `status must be one of ${STATUSES.join(', ')}`);
  if (row.source !== undefined && !SOURCES.includes(row.source)) bad('source', 'enum', `source must be one of ${SOURCES.join(', ')}`);
  if (row.id && row.kind && row.app && typeof row.id === 'string' && !row.id.startsWith(`${row.app}:${row.kind}:`)) bad('id', 'mismatch', 'id must start with <app>:<kind>:');
  if (row.deepLink !== undefined && row.deepLink !== null) {
    if (!isObj(row.deepLink) || !DEEP_LINK_TOOLS.includes(row.deepLink.tool) || !str(row.deepLink.target)) bad('deepLink', 'invalid', `deepLink must be { tool: ${DEEP_LINK_TOOLS.join(' | ')}, target }`);
    else if (row.kind === 'app') bad('deepLink', 'invalid', 'an app row has no deep link');
  }
  if (row.tokens !== undefined && (!Array.isArray(row.tokens) || row.tokens.some((t) => !TOKEN_FAMILIES.includes(t)))) bad('tokens', 'enum', `tokens must be token families (${TOKEN_FAMILIES.join(', ')})`);
  if (row.keywords !== undefined && (!Array.isArray(row.keywords) || row.keywords.length > REGISTRY.maxKeywords)) bad('keywords', 'invalid', `keywords must be a list of at most ${REGISTRY.maxKeywords}`);
  if (row.firstSeen !== undefined && !ISO_RE.test(String(row.firstSeen))) bad('firstSeen', 'invalid', 'firstSeen must be an ISO timestamp');
  if (row.status === 'live' && row.kind !== 'app' && !row.address && !row.deepLink) bad('status', 'mismatch', 'a live row has an address or a deep link');
  if (row.parent && row.parent === row.id) bad('parent', 'invalid', 'a row is not its own parent');
  return { ok: !errors.length, errors };
}

/** One message naming every failing field. */
export const rejection = (errors) => list(errors).map((e) => e.message).join('; ');

/** FNV-1a over the rows' JSON (ids sorted), hex: the same rows → the same hash on every port, no crypto needed. */
export function hashRows(rows) {
  const text = JSON.stringify([...list(rows)].sort((a, b) => String(a.id).localeCompare(String(b.id))));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let h2 = 0x811c9dc5;
  for (let i = text.length - 1; i >= 0; i--) { h2 ^= text.charCodeAt(i); h2 = Math.imul(h2, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Rows deduped by id (first wins), normalised, sorted by app, kind, name, id. Invalid rows are dropped and listed. */
export function normRows(rows, { now = '' } = {}) {
  const seen = new Map();
  const dropped = [];
  for (const raw of list(rows)) {
    const r = normRow(raw, { now });
    const v = validateRow(r);
    if (!v.ok) { dropped.push({ id: r.id || str(raw?.id), errors: v.errors }); continue; }
    if (!seen.has(r.id)) seen.set(r.id, r);
  }
  const out = [...seen.values()].sort((a, b) => a.app.localeCompare(b.app) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  // a parent nobody has is dropped to '' (the row stays; the tree puts it at its app's root)
  const ids = new Set(out.map((r) => r.id));
  for (const r of out) if (r.parent && !ids.has(r.parent)) r.parent = '';
  for (const r of out) if (r.settings && !ids.has(r.settings)) r.settings = '';
  return { rows: out.slice(0, REGISTRY.maxRows), dropped };
}

/** Counts per kind, per app, per status, per source. */
export function countRows(rows) {
  const counts = { kinds: {}, apps: {}, statuses: {}, sources: {}, plugins: 0 };
  const plugins = new Set();
  for (const r of list(rows)) {
    counts.kinds[r.kind] = (counts.kinds[r.kind] ?? 0) + 1;
    counts.apps[r.app] = (counts.apps[r.app] ?? 0) + 1;
    counts.statuses[r.status] = (counts.statuses[r.status] ?? 0) + 1;
    counts.sources[r.source] = (counts.sources[r.source] ?? 0) + 1;
    if (r.plugin) plugins.add(`${r.app}/${r.plugin}`);
  }
  counts.plugins = plugins.size;
  return counts;
}

/** The data set from rows: normalised, hashed, counted. `generatedAt` is the only clock input. */
export function buildDirectory(rows, { generatedAt = '', previous = null } = {}) {
  const now = ISO_RE.test(generatedAt) ? generatedAt : '';
  const { rows: fresh, dropped } = normRows(rows, { now });
  const merged = previous ? mergeHistory(previous, fresh, now) : fresh;
  return { $axf: SCHEMA, version: VERSION, generatedAt: now, hash: hashRows(merged), counts: countRows(merged), total: merged.length, dropped: dropped.length, rows: merged };
}

/** What moved between two data sets: ids added, removed, and rows whose facts changed (firstSeen aside). */
export function diffDirectories(prev, next) {
  const key = (r) => { const { firstSeen, ...rest } = r; return JSON.stringify(rest); };
  const before = new Map(list(prev?.rows).map((r) => [r.id, key(r)]));
  const after = new Map(list(next?.rows).map((r) => [r.id, key(r)]));
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id));
  return { added, removed, changed };
}

/** A fresh scan keeps each row's firstSeen from the previous data set; new rows get `now`. Removed rows are gone. */
export function mergeHistory(prev, rows, now = '') {
  const seen = new Map(list(prev?.rows).map((r) => [r.id, r.firstSeen]));
  return list(rows).map((r) => {
    const first = seen.get(r.id) || r.firstSeen || now;
    const out = { ...r };
    if (ISO_RE.test(String(first))) out.firstSeen = first; else delete out.firstSeen;
    return out;
  });
}

/** Validation of a whole data set: structure, every row, unique ids, hash. */
export function validateDirectory(dir) {
  const errors = [];
  if (!isObj(dir)) return { ok: false, errors: [{ field: 'directory', code: 'type', message: 'directory must be an object' }] };
  for (const f of REGISTRY.directoryRequired) if (dir[f] === undefined) errors.push({ field: f, code: 'missing', message: `${f} is missing` });
  if (dir.$axf !== SCHEMA) errors.push({ field: '$axf', code: 'invalid', message: `$axf must be ${SCHEMA}` });
  if (!Array.isArray(dir.rows)) return { ok: false, errors };
  const ids = new Set();
  dir.rows.forEach((r, i) => {
    const v = validateRow(r);
    for (const e of v.errors) errors.push({ field: `rows[${i}].${e.field}`, code: e.code, message: `${r?.id ?? i}: ${e.message}` });
    if (ids.has(r?.id)) errors.push({ field: `rows[${i}].id`, code: 'duplicate', message: `duplicate row id ${r.id}` });
    ids.add(r?.id);
  });
  if (dir.total !== undefined && dir.total !== dir.rows.length) errors.push({ field: 'total', code: 'mismatch', message: 'total must equal rows.length' });
  if (dir.hash !== undefined && dir.hash !== hashRows(dir.rows)) errors.push({ field: 'hash', code: 'mismatch', message: 'hash does not match the rows' });
  return { ok: !errors.length, errors };
}

// ------------------------------------------------------------------ projections (what the page draws from)

/** Filter: every given field must match; `q` is a word search over name, id, keywords, detail, plugin, address. */
export function filterRows(rows, { kind = '', kinds = [], app = '', plugin = '', status = '', source = '', family = '', q = '' } = {}) {
  const words = str(q, 200).toLowerCase().split(/\s+/).filter(Boolean);
  const ks = new Set([...(kind ? [kind] : []), ...list(kinds)]);
  return list(rows).filter((r) => {
    if (ks.size && !ks.has(r.kind)) return false;
    if (app && r.app !== app) return false;
    if (plugin && r.plugin !== plugin) return false;
    if (status && r.status !== status) return false;
    if (source && r.source !== source) return false;
    if (family && !list(r.tokens).includes(family)) return false;
    if (!words.length) return true;
    const hay = `${r.name} ${r.id} ${list(r.keywords).join(' ')} ${r.detail} ${r.plugin} ${r.address} ${KIND_LABEL[r.kind] ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Ranked search: name hits first, then keyword, then anything else; ties by name. */
export function search(rows, q, { limit = 50, kinds = [], app = '' } = {}) {
  const words = str(q, 200).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const r of filterRows(rows, { kinds, app })) {
    const name = r.name.toLowerCase();
    const kw = list(r.keywords).join(' ').toLowerCase();
    const rest = `${r.id} ${r.detail} ${r.plugin} ${r.address}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (name === w) score += 10;
      else if (name.startsWith(w)) score += 6;
      else if (name.includes(w)) score += 4;
      else if (kw.includes(w)) score += 2;
      else if (rest.includes(w)) score += 1;
      else { score = 0; break; }
    }
    if (score) hits.push({ row: r, score });
  }
  hits.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name, 'en', { sensitivity: 'base' }));
  return hits.slice(0, Math.max(1, Math.min(500, limit))).map((h) => ({ id: h.row.id, name: h.row.name, kind: h.row.kind, app: h.row.app, address: h.row.address, score: h.score }));
}

/**
 * The grouped tree: app → (plugin | shell) → rows by parent. A row whose parent is in the set nests under it; the
 * rest sit at their group's root. Every node: { id, name, kind, row?, children }.
 */
export function tree(rows) {
  const all = list(rows);
  const byId = new Map(all.map((r) => [r.id, r]));
  const nodes = new Map(all.map((r) => [r.id, { id: r.id, name: r.name, kind: r.kind, row: r, children: [] }]));
  const roots = [];
  const appNode = new Map();
  const groupNode = new Map();
  const appOf = (app) => {
    if (!appNode.has(app)) {
      const row = all.find((r) => r.kind === 'app' && r.app === app);
      const n = row ? nodes.get(row.id) : { id: `${app}:app`, name: app, kind: 'app', children: [] };
      appNode.set(app, n); roots.push(n);
    }
    return appNode.get(app);
  };
  const groupOf = (app, plugin) => {
    const key = `${app}/${plugin}`;
    if (!groupNode.has(key)) {
      const a = appOf(app);
      const prow = all.find((r) => r.kind === 'plugin' && r.app === app && r.plugin === plugin);
      const n = prow ? nodes.get(prow.id) : { id: `${app}:group:${plugin || 'shell'}`, name: plugin || 'Shell', kind: plugin ? 'plugin' : 'app', children: [] };
      groupNode.set(key, n);
      if (!a.children.includes(n)) a.children.push(n);
    }
    return groupNode.get(key);
  };
  for (const r of all) {
    if (r.kind === 'app') { appOf(r.app); continue; }
    if (r.kind === 'plugin') { groupOf(r.app, r.plugin); continue; }
    const n = nodes.get(r.id);
    const parent = r.parent && byId.has(r.parent) && r.parent !== r.id ? nodes.get(r.parent) : null;
    if (parent) parent.children.push(n);
    else groupOf(r.app, r.plugin).children.push(n);
  }
  // a parent chain that loops puts the row at the group root
  const seen = new Set();
  const walk = (n) => { if (seen.has(n.id)) return; seen.add(n.id); for (const c of n.children) walk(c); };
  for (const r of roots) walk(r);
  for (const r of all) if (!seen.has(r.id)) { groupOf(r.app, r.plugin).children.push(nodes.get(r.id)); seen.add(r.id); }
  const sortKids = (n) => { n.children.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })); n.children.forEach(sortKids); };
  roots.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  roots.forEach(sortKids);
  return roots;
}

/** The settings interface of a row: its own `settings` link, else its plugin's settings tab, else null. */
export function settingsOf(rows, id) {
  const all = list(rows);
  const r = all.find((x) => x.id === id);
  if (!r) return null;
  if (r.settings) return all.find((x) => x.id === r.settings) ?? null;
  if (r.plugin) return all.find((x) => x.kind === 'settings-tab' && x.app === r.app && x.plugin === r.plugin) ?? null;
  return null;
}

/**
 * Registration gaps: UIs a plugin's web code declares that its manifest does not list, and the other way round.
 * `declared` / `provided` are lists of `view:<id>`, `dialog:<id>`, `settings-tab:<id>` strings.
 */
export function registrationGaps(declared, provided) {
  const d = new Set(list(declared).map(String));
  const p = new Set(list(provided).map(String).filter((x) => /^(view|dialog|settings-tab):/.test(x)));
  return { unregistered: [...d].filter((x) => !p.has(x)).sort(), phantom: [...p].filter((x) => !d.has(x)).sort() };
}

// ------------------------------------------------------------------ JSON Schemas (written by `axf schemas`)

export function jsonSchemas() {
  const R = REGISTRY;
  const ts = { type: 'string', format: 'date-time', pattern: ISO_RE.source };
  const row = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'axf/ui-directory-row.schema.json', title: `AmberX AXF UI Directory row (${ROW})`,
    description: 'Generated from framework/core/ui-directory.mjs. One UI surface: a screen, tab, dialog, settings interface, settings panel, plugin UI, banner, window or app.',
    type: 'object', required: R.rowRequired, additionalProperties: false,
    properties: {
      $axf: { const: ROW },
      id: { type: 'string', pattern: R.idPattern, description: '<app>:<kind>:<path>' },
      name: { type: 'string', minLength: 1, maxLength: R.maxName },
      kind: { enum: KINDS },
      app: { type: 'string', pattern: R.appPattern },
      parent: { type: 'string', description: 'the row this one sits in (a screen for a tab, a settings tab for a panel), or empty' },
      plugin: { type: 'string', description: 'the plugin folder that owns it, or empty for the shell / framework' },
      address: { type: 'string', description: 'its console-control@1 address, when known' },
      deepLink: { anyOf: [{ type: 'null' }, { type: 'object', required: ['tool', 'target'], additionalProperties: false, properties: { tool: { enum: DEEP_LINK_TOOLS }, target: { type: 'string', minLength: 1 } } }] },
      settings: { type: 'string', description: 'the row id of its settings interface, or empty' },
      tokens: { type: 'array', uniqueItems: true, items: { enum: TOKEN_FAMILIES } },
      status: { enum: STATUSES },
      source: { enum: SOURCES },
      file: { type: 'string' },
      icon: { type: 'string' },
      detail: { type: 'string' },
      keywords: { type: 'array', maxItems: R.maxKeywords, items: { type: 'string' } },
      level: { type: 'integer', minimum: 0 },
      dynamic: { type: 'boolean' },
      firstSeen: ts,
    },
  };
  const directory = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'axf/ui-directory.schema.json', title: `AmberX AXF UI Directory (${SCHEMA})`,
    description: 'Generated from framework/core/ui-directory.mjs. The live data set of every UI surface across every app, rebuilt from the registries on every build.',
    type: 'object', required: R.directoryRequired,
    properties: {
      $axf: { const: SCHEMA }, version: { const: VERSION }, generatedAt: ts, hash: { type: 'string', pattern: '^[0-9a-f]{16}$' },
      counts: { type: 'object', properties: { kinds: { type: 'object' }, apps: { type: 'object' }, statuses: { type: 'object' }, sources: { type: 'object' }, plugins: { type: 'integer' } } },
      total: { type: 'integer', minimum: 0 }, dropped: { type: 'integer', minimum: 0 },
      rows: { type: 'array', maxItems: R.maxRows, items: { $ref: 'axf/ui-directory-row.schema.json' } },
    },
  };
  return { 'ui-directory-row.schema.json': row, 'ui-directory.schema.json': directory };
}
