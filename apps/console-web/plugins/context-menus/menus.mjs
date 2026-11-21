#!/usr/bin/env node
/**
 * Context menus — store + CLI (context-menu@1, capability context-menus@1). ONE TRUE SOURCE: every context menu is one
 * JSON file in the hub's shared data, so every plugin, app and Claude session reads and writes the same menus:
 *
 *   <store>/menus/<id>.json      context-menu@1 (the asset@1 context-menu inside, plus level / app / page / source)
 *   <store>/history/<id>.json    ctx-history@1 (snapshots, restore like skins)
 *   <store>/zones.json           ctx-zone@1 registry (code scan + what open consoles report)
 *   <store>/drafts/<id>.json     ctx-draft@1 (a generated menu waiting for Preview → Apply)
 *   <store>/active.json          { "<app>": "<menu id>", "<app>/<page>": "<menu id>" } — which menu each app (and page) shows
 *   <store>/actions/<owner>.json ctx-actions@1 — the actions / hooks a plugin or app offers; menu items reference them
 *
 * <store> is the hub's shared data where /projects is mounted (the console container): /projects/amberx-axf/_data/
 * context-menus/ = axhub.memory_read / memory_write project "amberx-axf", area "data", path "context-menus/menus/<id>.json".
 * Elsewhere it is the plugin's data folder (.axf-console/plugins/context-menus). AXF_CONTEXT_MENUS_DIR overrides (tests).
 * The rules are the framework's (framework/core/engines/context-menus-rules.mjs); nothing here decides what a menu is.
 *
 *   node apps/console-web/plugins/context-menus/menus.mjs list [--app a] [--level l] [--zone z] [--q words]
 *   … show <id>                       one menu (context-menu@1)
 *   … save <file.json|->              save a menu (validated, snapshot kept)
 *   … delete <id>
 *   … history <id> · restore <id> <v>
 *   … use <id> · active [--app a] [--page p]   which menu an app (page) shows; a page menu wins on its page
 *   … unuse [--app a] [--page p]      stop using the page's (or app's) own menu
 *   … zones [--scan]                  the zone registry (--scan rescans the code)
 *   … index [--app a]                 every menu per zone (owner plugin / app, pages) and per page
 *   … zone <zone> [--app a]            the menus that map one zone and the items shown there (what the UI Manager shows)
 *   … levels                          the four coder levels
 *   … actions                         the actions a menu item may run (console inventory + registered on the hub)
 *   … register-actions <owner> <file.json|->   a plugin / app registers the actions it offers ([{id, label, zones?}])
 *   … prompt --level pro [--app a] [--page p]      the prompt Claude gets (zero tokens)
 *   … generate --level pro [--app a] [--page p] [--reply-file f] [--apply]   a draft from a model reply (tests: a fixed reply)
 *   … draft [<id>] · apply <draft id> · discard <draft id>
 *   … voice "<sentence>"              what a sentence means ("generate pro context menus")
 *   … api '<json {op,…}>'             everything the console page does (the server calls this); also reads stdin
 *   … where                           the store folder
 *   --json on any command prints one JSON line.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as R from '../../../../framework/core/engines/context-menus-rules.mjs';
import { persistRoot } from '../../../../framework/cli/persist.mjs';
import { projectDataDir } from '../../../../framework/cli/projects.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const FOLDER = 'context-menus';

/* ---------------- files ---------------- */

function readJson(f, fallback = null) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } }
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(v, null, 1)}\n`); renameSync(tmp, f); }
const now = () => new Date().toISOString();

/** Where the menus live: the hub's shared data (one true source) when mounted, else the plugin's data folder. */
export function storeDir() {
  if (process.env.AXF_CONTEXT_MENUS_DIR) return process.env.AXF_CONTEXT_MENUS_DIR;
  const root = persistRoot();
  return projectDataDir(root ? join(root, FOLDER) : join(ROOT, '.axf-console/plugins', FOLDER));
}
const P = (...x) => join(storeDir(), ...x);
export const onHub = () => !process.env.AXF_CONTEXT_MENUS_DIR && !!persistRoot();
const idOk = (id) => R.ID_RE.test(String(id ?? ''));

/* ---------------- menus ---------------- */

export function loadMenus() {
  const dir = P('menus');
  if (!existsSync(dir)) return [];
  const active = activeMap();
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter(Boolean)
    .map((m) => ({ ...R.normalizeMenu(m), active: active[activeKey(m)] === m.id }))
    .sort((a, b) => a.app.localeCompare(b.app) || R.LEVELS[a.level].order - R.LEVELS[b.level].order || a.name.localeCompare(b.name));
}
export function getMenu(id) {
  if (!idOk(id)) throw new Error(`bad menu id "${id}"`);
  const raw = readJson(P('menus', `${id}.json`));
  return raw ? { ...R.normalizeMenu(raw), active: activeMap()[activeKey(raw)] === id } : null;
}
export function history(id) { return idOk(id) ? readJson(P('history', `${id}.json`), R.emptyHistory(id)) : R.emptyHistory(id); }

export function saveMenu(raw, { by = '', source } = {}) {
  const t = now();
  const prev = raw?.id && idOk(raw.id) ? readJson(P('menus', `${raw.id}.json`)) : null;
  const doc = R.normalizeMenu({ ...raw, source: source ?? raw?.source ?? prev?.source, createdAt: prev?.createdAt ?? raw?.createdAt, updatedAt: t, by: by || raw?.by || prev?.by }, t);
  const errors = R.validateMenu(doc);
  if (errors.length) return { ok: false, errors };
  if (prev) writeJson(P('history', `${doc.id}.json`), R.snapshot(history(doc.id), R.normalizeMenu(prev), prev.by, prev.updatedAt));
  const { active: _a, ...stored } = doc;
  writeJson(P('menus', `${doc.id}.json`), stored);
  return { ok: true, menu: { ...doc, active: activeMap()[activeKey(doc)] === doc.id } };
}

export function deleteMenu(id) {
  if (!idOk(id)) throw new Error(`bad menu id "${id}"`);
  const f = P('menus', `${id}.json`);
  if (!existsSync(f)) return { ok: false, error: 'no such menu' };
  const m = readJson(f);
  rmSync(f);
  const act = activeMap();
  if (m?.app && act[activeKey(m)] === id) { delete act[activeKey(m)]; writeJson(P('active.json'), act); }
  return { ok: true, id };
}

export function restore(id, v, by = '') {
  const doc = R.restoreFrom(history(id), v);
  if (!doc) return { ok: false, error: `no version ${v} of ${id}` };
  return saveMenu({ ...doc, by }, { by });
}

/* ---------------- which menu an app shows ---------------- */

/** The key a menu is "in use" under: its app, or app/page for a page menu (the level can differ per app and page). */
export const activeKey = (m) => (m?.page ? `${m.app}/${m.page}` : String(m?.app ?? R.DEFAULT_APP));

export function activeMap() { const m = readJson(P('active.json'), {}); return m && typeof m === 'object' ? m : {}; }
export function useMenu(id, by = '') {
  const m = getMenu(id);
  if (!m) return { ok: false, error: 'no such menu' };
  const act = { ...activeMap(), [activeKey(m)]: id };
  writeJson(P('active.json'), act);
  return { ok: true, app: m.app, page: m.page, key: activeKey(m), id, by };
}
/** The menu an app shows (on a page: that page's menu first, else the app's). */
export function activeFor(app = R.DEFAULT_APP, page = '') {
  const map = activeMap();
  const id = (page && map[`${app}/${page}`]) || map[app];
  return id ? getMenu(id) : null;
}
/** Stop using a page's own menu (the page falls back to the app's), or the app's (falls back to the built-in default). */
export function unuse(app = R.DEFAULT_APP, page = '') {
  const map = activeMap();
  const key = page ? `${app}/${page}` : app;
  if (!(key in map)) return { ok: true, key, changed: false };
  delete map[key];
  writeJson(P('active.json'), map);
  return { ok: true, key, changed: true };
}

/* ---------------- zones: the code scan + what consoles report ---------------- */

const SCAN_DIRS = ['apps/console-web/src', 'apps/console-web/plugins', 'framework/react', 'framework/libs'];
const SKIP = new Set(['node_modules', 'dist', 'vendor', 'fixtures', '.git']);
const TARGET_RE = /data-fx-ctx-target=\{?["'`]([a-z0-9_.:-]+)["'`]/g;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|mjs|jsx?)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) yield p;
  }
}

/** Every `data-fx-ctx-target` literal in the console, its plugins and the framework, with the files that draw it. */
export function scanZones(root = ROOT) {
  const found = new Map();
  for (const d of SCAN_DIRS) {
    const dir = join(root, d);
    if (!existsSync(dir)) continue;
    for (const f of walk(dir)) {
      let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(TARGET_RE)) {
        const id = m[1];
        const rel = relative(root, f).replace(/\\/g, '/');
        const z = found.get(id) ?? { id, files: new Set(), uses: 0 };
        z.files.add(rel); z.uses += 1;
        found.set(id, z);
      }
    }
  }
  return [...found.values()].map((z) => {
    const files = [...z.files].sort();
    const owner = R.ownerOfPath(files.find((f) => f.includes('/plugins/')) ?? files[0]);
    return R.normalizeZone({ id: z.id, files, owner, weight: R.weightOf(z.id, z.uses), elements: [], pages: [] });
  });
}

export function zones({ scan = false } = {}) {
  const f = P('zones.json');
  const saved = readJson(f, { $axf: 'ctx-zones@1', items: [], scannedAt: '', reported: [] });
  if (scan || !saved.items?.length) {
    saved.items = scanZones().map((z) => ({ ...z }));
    saved.scannedAt = now();
    writeJson(f, saved);
  }
  return { ...saved, items: R.mergeZones(saved.items, saved.reported ?? []) };
}

/** An open console reports the zones on its screen (id, page, element labels): the registry remembers pages + elements. */
export function reportZones(items, page = '') {
  const f = P('zones.json');
  const saved = readJson(f, { $axf: 'ctx-zones@1', items: [], scannedAt: '', reported: [] });
  const reported = new Map((saved.reported ?? []).map((z) => [z.id, z]));
  for (const raw of Array.isArray(items) ? items : []) {
    const z = R.normalizeZone({ ...raw, pages: [...(raw?.pages ?? []), ...(page ? [page] : [])] });
    if (!z.id) continue;
    const prev = reported.get(z.id);
    reported.set(z.id, prev ? R.mergeZones([prev], [z]).find((x) => x.id === z.id) : z);
  }
  saved.reported = [...reported.values()].slice(0, 400);
  writeJson(f, saved);
  return { ok: true, zones: saved.reported.length };
}

/** Per zone (what the UI Manager shows for an element): every menu that maps it, and the items the app shows there now. */
export function menusForZone(zone, app = R.DEFAULT_APP) {
  const z = String(zone ?? '').trim();
  if (!z) return { ok: false, error: 'name a zone' };
  const menus = loadMenus().filter((m) => z in (m.asset?.data?.targets ?? {}));
  const act = activeFor(app);
  const items = act ? (act.asset.data.targets[z] ?? act.asset.data.targets.default ?? []) : [];
  const info = zones().items.find((x) => x.id === z) ?? null;
  return { ok: true, zone: z, app, info, active: act ? { id: act.id, name: act.name, level: act.level, fallback: !(z in act.asset.data.targets) } : null, items, menus: menus.map((m) => ({ id: m.id, name: m.name, level: m.level, app: m.app, page: m.page, active: m.active, items: R.countItems(m.asset.data.targets[z]) })) };
}

/** The index of every context menu per zone (owner plugin / app, pages) and per page: the list the page groups by. */
export function menuIndex({ app = '' } = {}) {
  const menus = loadMenus().filter((m) => !app || m.app === app);
  const zs = zones().items;
  const byZone = new Map();
  for (const m of menus) for (const [t, items] of Object.entries(m.asset.data.targets)) {
    const z = zs.find((x) => x.id === t);
    const e = byZone.get(t) ?? { zone: t, owner: z?.owner ?? null, pages: z?.pages ?? [], elements: z?.elements ?? [], menus: [] };
    e.menus.push({ id: m.id, name: m.name, app: m.app, page: m.page, level: m.level, active: m.active, items: R.countItems(items) });
    byZone.set(t, e);
  }
  const byPage = {};
  for (const m of menus) (byPage[`${m.app}/${m.page || '*'}`] ??= []).push(m.id);
  return { ok: true, zones: [...byZone.values()].sort((a, b) => a.zone.localeCompare(b.zone)), pages: byPage, menus: menus.length };
}

/* ---------------- actions a menu item may run ---------------- */

/** The console's registered actions (control inventory: every `rt.actions.register` + every toolbar button's action). */
export function inventoryActions(root = ROOT) {
  const file = join(root, 'apps/console-web/src/control/inventory.json');
  // generated, never committed: write it from the installed plugins when it is missing (as the console server does)
  if (!existsSync(file)) {
    try { execFileSync('node', [join(root, 'apps/console-web/scripts/control-inventory.mjs')], { stdio: 'pipe', timeout: 120_000 }); } catch { /* no inventory: hub-registered actions only */ }
  }
  const inv = readJson(file, {});
  const out = new Map();
  for (const f of inv.functions ?? []) if (f?.id && R.ACTION_RE.test(f.id)) out.set(f.id, { id: f.id, label: f.label || f.id, module: f.plugin || f.source || '' });
  for (const b of inv.buttons ?? []) if (b?.action && R.ACTION_RE.test(b.action) && !out.has(b.action)) out.set(b.action, { id: b.action, label: b.label || b.action, module: b.source || '' });
  for (const v of inv.views ?? []) if (v?.id && !out.has(`nav:${v.id}`)) out.set(`nav:${v.id}`, { id: `nav:${v.id}`, label: `Open ${v.label || v.id}`, module: v.source || 'shell' });
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------------- registered actions: what plugins and apps offer (one true source too) ---------------- */

export const ACTIONS_FORMAT = 'ctx-actions@1';
const ownerOk = (o) => /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(String(o ?? ''));

/** A plugin or app registers the actions / hooks it offers (replaces its previous list). Menus reference them by id. */
export function registerActions(owner, actions, { app = R.DEFAULT_APP, by = '' } = {}) {
  if (!ownerOk(owner)) return { ok: false, error: `bad owner "${owner}"` };
  const list = [];
  const seen = new Set();
  for (const a of Array.isArray(actions) ? actions : []) {
    const id = String(a?.id ?? '');
    if (!R.ACTION_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, label: String(a?.label ?? id).slice(0, 120), ...(Array.isArray(a?.zones) ? { zones: a.zones.map(String).slice(0, 40) } : {}), ...(a?.params ? { params: true } : {}) });
  }
  const doc = { $axf: ACTIONS_FORMAT, owner, app, by, at: now(), actions: list.slice(0, 600) };
  writeJson(P('actions', `${owner.replace(/[^a-z0-9._-]/gi, '_')}.json`), doc);
  return { ok: true, owner, count: doc.actions.length };
}

export function registeredActions() {
  const dir = P('actions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter((d) => d?.$axf === ACTIONS_FORMAT);
}

/** Every action a menu item may run: the console inventory plus what plugins and apps registered on the hub. */
export function allActions(root = ROOT) {
  const out = new Map(inventoryActions(root).map((a) => [a.id, a]));
  for (const d of registeredActions()) for (const a of d.actions) if (!out.has(a.id)) out.set(a.id, { id: a.id, label: a.label, module: d.owner, ...(a.zones ? { zones: a.zones } : {}) });
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The action ids a menu references that nobody registered (shown per row; a stale item does nothing on click). */
export function unknownActions(doc, known = new Set(allActions().map((a) => a.id))) {
  const out = new Set();
  const walkItems = (items) => { for (const it of items ?? []) { if (it.action && !known.has(String(it.action).split(':').slice(0, it.action.startsWith('nav:') ? 2 : 1).join(':'))) out.add(it.action); walkItems(it.items); } };
  for (const items of Object.values(doc?.asset?.data?.targets ?? {})) walkItems(items);
  return [...out];
}

/* ---------------- drafts: preview before applying ---------------- */

export function drafts() { const dir = P('drafts'); return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at))) : []; }
export function getDraft(id) { return idOk(id) ? readJson(P('drafts', `${id}.json`)) : null; }
export function discardDraft(id) { if (!idOk(id)) return { ok: false, error: 'bad id' }; const f = P('drafts', `${id}.json`); if (!existsSync(f)) return { ok: false, error: 'no such draft' }; rmSync(f); return { ok: true, id }; }

export function promptFor({ level = 'pro', app = R.DEFAULT_APP, page = '', actions, name = '' } = {}) {
  if (!R.isLevel(level)) throw new Error(`level must be one of ${R.LEVEL_IDS.join(', ')}`);
  const acts = Array.isArray(actions) && actions.length ? actions : allActions();
  return R.buildPrompt({ level, app, page, zones: zones().items, actions: acts, name });
}

/**
 * A model reply → a draft (ctx-draft@1) with the preview: the menu, warnings, what changes against the menu the app
 * shows now. Nothing is saved as a menu until `apply`.
 */
export function draftFromReply(reply, { level = 'pro', app = R.DEFAULT_APP, page = '', actions, name = '', by = '', model = '', id = '' } = {}) {
  const acts = Array.isArray(actions) && actions.length ? actions : allActions();
  const t = now();
  const { doc, warnings } = R.fromReply(reply, { level, app, page, zones: zones().items, actions: acts, id, name, by, model, now: t });
  if (!doc) return { ok: false, error: 'Claude did not answer with a menu', warnings };
  const errors = R.validateMenu(doc);
  if (errors.length) return { ok: false, error: errors.join('; '), warnings };
  const draftId = R.slug(`${doc.id}-${t.replace(/\D/g, '').slice(4, 14)}`, 44);
  const draft = { $axf: R.DRAFT_FORMAT, id: draftId, at: t, by, model, level, app, page, menu: doc, warnings, diff: R.diffMenus(activeFor(app, page), doc), summary: R.summarize(doc) };
  writeJson(P('drafts', `${draftId}.json`), draft);
  return { ok: true, draft };
}

export function applyDraft(id, { by = '', use = true } = {}) {
  const d = getDraft(id);
  if (!d) return { ok: false, error: 'no such draft' };
  const saved = saveMenu({ ...d.menu, by: by || d.by }, { by: by || d.by, source: 'claude' });
  if (!saved.ok) return saved;
  if (use) useMenu(saved.menu.id, by);
  rmSync(P('drafts', `${id}.json`), { force: true });
  return { ok: true, menu: getMenu(saved.menu.id), applied: id };
}

/* ---------------- state + api (what the console page and the server call) ---------------- */

export function state({ app = '' } = {}) {
  const menus = loadMenus();
  return { ok: true, menus: app ? menus.filter((m) => m.app === app) : menus, active: activeMap(), levels: Object.values(R.LEVELS), zones: zones().items, drafts: drafts(), store: storeDir(), onHub: onHub(), apps: [...new Set([R.DEFAULT_APP, ...menus.map((m) => m.app)])] };
}

export async function api(req) {
  const op = req?.op;
  const by = String(req?.by ?? '');
  switch (op) {
    case 'state': return state(req);
    case 'list': return { ok: true, menus: R.filterMenus(loadMenus(), req) };
    case 'get': { const m = getMenu(req.id); return m ? { ok: true, menu: m, history: history(req.id).versions.map(({ doc: _d, ...v }) => v) } : { ok: false, error: 'no such menu' }; }
    case 'save': return saveMenu(req.menu, { by, source: req.source });
    case 'delete': return deleteMenu(req.id);
    case 'history': return { ok: true, history: history(req.id) };
    case 'restore': return restore(req.id, req.v, by);
    case 'use': return useMenu(req.id, by);
    case 'active': return { ok: true, active: activeMap(), menu: activeFor(req.app || R.DEFAULT_APP, req.page || '') };
    case 'unuse': return unuse(req.app || R.DEFAULT_APP, req.page || '');
    case 'zones': return { ok: true, ...zones({ scan: !!req.scan }) };
    case 'report-zones': return reportZones(req.items, req.page);
    case 'index': return menuIndex(req);
    case 'zone-menus': return menusForZone(req.zone, req.app || R.DEFAULT_APP);
    case 'levels': return { ok: true, levels: Object.values(R.LEVELS) };
    case 'actions': return { ok: true, actions: allActions(), registered: registeredActions().map((d) => ({ owner: d.owner, app: d.app, at: d.at, count: d.actions.length })) };
    case 'register-actions': {
      if (!Array.isArray(req.batch)) return registerActions(req.owner, req.actions, { app: req.app || R.DEFAULT_APP, by });
      const done = req.batch.slice(0, 200).map((b) => registerActions(b?.owner, b?.actions, { app: req.app || R.DEFAULT_APP, by }));
      return { ok: done.every((d) => d.ok), owners: done.filter((d) => d.ok).length, errors: done.filter((d) => !d.ok).map((d) => d.error) };
    }
    case 'unknown-actions': { const m = getMenu(req.id); return m ? { ok: true, id: m.id, unknown: unknownActions(m) } : { ok: false, error: 'no such menu' }; }
    case 'prompt': return { ok: true, prompt: promptFor(req) };
    case 'draft': return draftFromReply(req.reply, { ...req, by });
    case 'drafts': return { ok: true, drafts: drafts() };
    case 'get-draft': { const d = getDraft(req.id); return d ? { ok: true, draft: d } : { ok: false, error: 'no such draft' }; }
    case 'apply': return applyDraft(req.id, { by, use: req.use !== false });
    case 'discard': return discardDraft(req.id);
    case 'voice': { const p = R.matchPhrase(req.text); return p ? { ok: true, ...p } : { ok: false, error: 'not a context-menu sentence' }; }
    case 'where': return { ok: true, store: storeDir(), onHub: onHub() };
    default: return { ok: false, error: `unknown op "${op}"` };
  }
}

/* ---------------- CLI ---------------- */

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = args[i + 1]; if (v !== undefined && !v.startsWith('--')) { out[k] = v; i++; } else out[k] = true; }
    else out._.push(a);
  }
  return out;
}
const readInput = (f) => (f === '-' || !f ? readFileSync(0, 'utf8') : readFileSync(f, 'utf8'));

async function main(argv) {
  const f = flags(argv);
  const [cmd, a1, a2] = f._;
  const json = !!f.json;
  const out = (v, text) => { if (json) console.log(JSON.stringify(v)); else console.log(text ?? JSON.stringify(v, null, 2)); return v.ok === false ? 1 : 0; };
  switch (cmd) {
    case 'list': { const menus = R.filterMenus(loadMenus(), { q: f.q, app: f.app, level: f.level, zone: f.zone }); return out({ ok: true, menus }, menus.map((m) => `${m.active ? '●' : '○'} ${m.id.padEnd(36)} ${m.level.padEnd(9)} ${m.app.padEnd(14)} ${R.summarize(m).targets} zones · ${R.summarize(m).items} items · ${m.source}`).join('\n') || 'no menus yet'); }
    case 'show': { const m = getMenu(a1); return out(m ? { ok: true, menu: m } : { ok: false, error: 'no such menu' }); }
    case 'save': return out(saveMenu(JSON.parse(readInput(a1)), { by: f.by || 'cli' }));
    case 'delete': return out(deleteMenu(a1));
    case 'history': return out({ ok: true, history: history(a1) }, history(a1).versions.map((v) => `v${v.v}  ${v.at}  ${v.by || '-'}  ${v.doc.name}`).join('\n') || 'no history');
    case 'restore': return out(restore(a1, a2, f.by || 'cli'));
    case 'use': return out(useMenu(a1, f.by || 'cli'));
    case 'unuse': return out(unuse(f.app || R.DEFAULT_APP, f.page || ''));
    case 'active': { const m = activeFor(f.app || R.DEFAULT_APP, f.page || ''); return out({ ok: true, active: activeMap(), menu: m }, m ? `${m.app}: ${m.id} (${m.level})` : `${f.app || R.DEFAULT_APP}: the app's own default`); }
    case 'index': { const r = menuIndex({ app: f.app }); return out(r, r.zones.map((z) => `${z.zone.padEnd(28)} ${z.owner ? `${z.owner.kind}${z.owner.id ? `:${z.owner.id}` : ''}` : '?'}  ${z.menus.map((m) => `${m.active ? '●' : '○'}${m.id}`).join(' ')}`).join('\n') || 'no menus yet'); }
    case 'zone': { const r = menusForZone(a1, f.app || R.DEFAULT_APP); return out(r, r.ok ? `${r.zone}: ${r.active ? `${r.active.name}${r.active.fallback ? ' (default items)' : ''}` : 'app default'} · ${r.items.length} items\n${r.menus.map((m) => `  ${m.active ? '●' : '○'} ${m.id} ${m.level} ${m.items} items`).join('\n')}` : r.error); }
    case 'zones': { const z = zones({ scan: !!f.scan }); return out({ ok: true, ...z }, z.items.map((x) => `${x.weight.padEnd(7)} ${x.id.padEnd(28)} ${x.owner.kind}${x.owner.id ? `:${x.owner.id}` : ''}${x.pages.length ? ` · ${x.pages.join(', ')}` : ''}`).join('\n')); }
    case 'levels': return out({ ok: true, levels: Object.values(R.LEVELS) }, Object.values(R.LEVELS).map((l) => `${l.id.padEnd(9)} ${l.label.padEnd(15)} ≤${l.perTarget} items · depth ${l.depth} · zones ${l.zones}\n          ${l.brief}`).join('\n'));
    case 'register-actions': return out(registerActions(a1, JSON.parse(readInput(a2)), { app: f.app || R.DEFAULT_APP, by: f.by || 'cli' }));
    case 'actions': { const acts = allActions(); return out({ ok: true, actions: acts }, acts.map((a) => `${a.id}  ${a.label}`).join('\n')); }
    case 'prompt': return out({ ok: true, prompt: promptFor({ level: f.level || 'pro', app: f.app, page: f.page, name: f.name }) });
    case 'generate': {
      if (!f['reply-file']) return out({ ok: false, error: 'the CLI needs --reply-file <model reply>; the console server sends the prompt to Claude (POST /generate)' });
      const r = draftFromReply(readInput(f['reply-file']), { level: f.level || 'pro', app: f.app, page: f.page, name: f.name, by: f.by || 'cli', model: f.model || 'reply-file' });
      if (r.ok && f.apply) return out(applyDraft(r.draft.id, { by: f.by || 'cli' }));
      return out(r);
    }
    case 'draft': return out(a1 ? (getDraft(a1) ? { ok: true, draft: getDraft(a1) } : { ok: false, error: 'no such draft' }) : { ok: true, drafts: drafts() });
    case 'apply': return out(applyDraft(a1, { by: f.by || 'cli', use: !f['no-use'] }));
    case 'discard': return out(discardDraft(a1));
    case 'voice': { const p = R.matchPhrase(f._.slice(1).join(' ')); return out(p ? { ok: true, ...p } : { ok: false, error: 'not a context-menu sentence' }); }
    case 'api': { const req = JSON.parse(a1 && a1 !== '-' ? a1 : readFileSync(0, 'utf8')); const r = await api(req); console.log(JSON.stringify(r)); return r.ok === false ? 1 : 0; }
    case 'where': return out({ ok: true, store: storeDir(), onHub: onHub() }, `${storeDir()}${onHub() ? ' (hub shared data: one true source)' : ' (plugin data folder; no hub mounted)'}`);
    default: console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?\s?/, '').replace(/^ \* ?/gm, '')); return cmd ? 1 : 0;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
}

export { R as rules };
