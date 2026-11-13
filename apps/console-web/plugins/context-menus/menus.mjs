#!/usr/bin/env node
/**
 * Context menus — store + CLI (context-menu@1, capability context-menus@1). ONE TRUE SOURCE: every context menu is one
 * JSON file in the hub's shared data, so every plugin, app and Claude session reads and writes the same menus:
 *
 *   <store>/menus/<id>.json      context-menu@1 (the asset@1 context-menu inside, plus level / app / page / source)
 *   <store>/history/<id>.json    ctx-history@1 (snapshots, restore like skins)
 *   <store>/zones.json           ctx-zone@1 registry (code scan + what open consoles report)
 *   <store>/drafts/<id>.json     ctx-draft@1 (a generated menu waiting for Preview → Apply)
 *   <store>/active.json          { "<app>": "<menu id>" } — which menu each app shows
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
 *   … use <id> · active [--app a]     which menu an app shows
 *   … zones [--scan]                  the zone registry (--scan rescans the code)
 *   … levels                          the four coder levels
 *   … actions                         the actions a menu item may run (console inventory)
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
    .map((m) => ({ ...R.normalizeMenu(m), active: active[m.app] === m.id }))
    .sort((a, b) => a.app.localeCompare(b.app) || R.LEVELS[a.level].order - R.LEVELS[b.level].order || a.name.localeCompare(b.name));
}
export function getMenu(id) {
  if (!idOk(id)) throw new Error(`bad menu id "${id}"`);
  const raw = readJson(P('menus', `${id}.json`));
  return raw ? { ...R.normalizeMenu(raw), active: activeMap()[raw.app] === id } : null;
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
  return { ok: true, menu: { ...doc, active: activeMap()[doc.app] === doc.id } };
}

export function deleteMenu(id) {
  if (!idOk(id)) throw new Error(`bad menu id "${id}"`);
  const f = P('menus', `${id}.json`);
  if (!existsSync(f)) return { ok: false, error: 'no such menu' };
  const m = readJson(f);
  rmSync(f);
  const act = activeMap();
  if (m?.app && act[m.app] === id) { delete act[m.app]; writeJson(P('active.json'), act); }
  return { ok: true, id };
}

export function restore(id, v, by = '') {
  const doc = R.restoreFrom(history(id), v);
  if (!doc) return { ok: false, error: `no version ${v} of ${id}` };
  return saveMenu({ ...doc, by }, { by });
}

/* ---------------- which menu an app shows ---------------- */

export function activeMap() { const m = readJson(P('active.json'), {}); return m && typeof m === 'object' ? m : {}; }
export function useMenu(id, by = '') {
  const m = getMenu(id);
  if (!m) return { ok: false, error: 'no such menu' };
  const act = { ...activeMap(), [m.app]: id };
  writeJson(P('active.json'), act);
  return { ok: true, app: m.app, id, by };
}
export function activeFor(app = R.DEFAULT_APP) { const id = activeMap()[app]; return id ? getMenu(id) : null; }

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

/* ---------------- actions a menu item may run ---------------- */

/** The console's registered actions (control inventory: every `rt.actions.register` + every toolbar button's action). */
export function inventoryActions(root = ROOT) {
  const inv = readJson(join(root, 'apps/console-web/src/control/inventory.json'), {});
  const out = new Map();
  for (const f of inv.functions ?? []) if (f?.id && R.ACTION_RE.test(f.id)) out.set(f.id, { id: f.id, label: f.label || f.id, module: f.plugin || f.source || '' });
  for (const b of inv.buttons ?? []) if (b?.action && R.ACTION_RE.test(b.action) && !out.has(b.action)) out.set(b.action, { id: b.action, label: b.label || b.action, module: b.source || '' });
  for (const v of inv.views ?? []) if (v?.id && !out.has(`nav:${v.id}`)) out.set(`nav:${v.id}`, { id: `nav:${v.id}`, label: `Open ${v.label || v.id}`, module: v.source || 'shell' });
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/* ---------------- drafts: preview before applying ---------------- */

export function drafts() { const dir = P('drafts'); return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at))) : []; }
export function getDraft(id) { return idOk(id) ? readJson(P('drafts', `${id}.json`)) : null; }
export function discardDraft(id) { if (!idOk(id)) return { ok: false, error: 'bad id' }; const f = P('drafts', `${id}.json`); if (!existsSync(f)) return { ok: false, error: 'no such draft' }; rmSync(f); return { ok: true, id }; }

export function promptFor({ level = 'pro', app = R.DEFAULT_APP, page = '', actions, name = '' } = {}) {
  if (!R.isLevel(level)) throw new Error(`level must be one of ${R.LEVEL_IDS.join(', ')}`);
  const acts = Array.isArray(actions) && actions.length ? actions : inventoryActions();
  return R.buildPrompt({ level, app, page, zones: zones().items, actions: acts, name });
}

/**
 * A model reply → a draft (ctx-draft@1) with the preview: the menu, warnings, what changes against the menu the app
 * shows now. Nothing is saved as a menu until `apply`.
 */
export function draftFromReply(reply, { level = 'pro', app = R.DEFAULT_APP, page = '', actions, name = '', by = '', model = '', id = '' } = {}) {
  const acts = Array.isArray(actions) && actions.length ? actions : inventoryActions();
  const t = now();
  const { doc, warnings } = R.fromReply(reply, { level, app, page, zones: zones().items, actions: acts, id, name, by, model, now: t });
  if (!doc) return { ok: false, error: 'Claude did not answer with a menu', warnings };
  const errors = R.validateMenu(doc);
  if (errors.length) return { ok: false, error: errors.join('; '), warnings };
  const draftId = R.slug(`${doc.id}-${t.replace(/\D/g, '').slice(4, 14)}`, 44);
  const draft = { $axf: R.DRAFT_FORMAT, id: draftId, at: t, by, model, level, app, page, menu: doc, warnings, diff: R.diffMenus(activeFor(app), doc), summary: R.summarize(doc) };
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
    case 'active': return { ok: true, active: activeMap(), menu: activeFor(req.app || R.DEFAULT_APP) };
    case 'zones': return { ok: true, ...zones({ scan: !!req.scan }) };
    case 'report-zones': return reportZones(req.items, req.page);
    case 'levels': return { ok: true, levels: Object.values(R.LEVELS) };
    case 'actions': return { ok: true, actions: inventoryActions() };
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
    case 'active': { const m = activeFor(f.app || R.DEFAULT_APP); return out({ ok: true, active: activeMap(), menu: m }, m ? `${m.app}: ${m.id} (${m.level})` : `${f.app || R.DEFAULT_APP}: the app's own default`); }
    case 'zones': { const z = zones({ scan: !!f.scan }); return out({ ok: true, ...z }, z.items.map((x) => `${x.weight.padEnd(7)} ${x.id.padEnd(28)} ${x.owner.kind}${x.owner.id ? `:${x.owner.id}` : ''}${x.pages.length ? ` · ${x.pages.join(', ')}` : ''}`).join('\n')); }
    case 'levels': return out({ ok: true, levels: Object.values(R.LEVELS) }, Object.values(R.LEVELS).map((l) => `${l.id.padEnd(9)} ${l.label.padEnd(15)} ≤${l.perTarget} items · depth ${l.depth} · zones ${l.zones}\n          ${l.brief}`).join('\n'));
    case 'actions': { const acts = inventoryActions(); return out({ ok: true, actions: acts }, acts.map((a) => `${a.id}  ${a.label}`).join('\n')); }
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
