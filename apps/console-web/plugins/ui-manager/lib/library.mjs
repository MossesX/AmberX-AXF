/**
 * Asset libraries (ui-library@1): the IO behind "export any UI as an asset library". The rules are pure
 * (framework/core/engines/ui-manager-rules.mjs libraryFrom / libraryErrors / libraryAsSkin / libraryImportPlan); this
 * file reads the catalog, writes the shared hub library, makes the downloadable package and applies an import plan.
 *
 *   hub library   /projects/_shared/_data/libraries/ui/<id>.json + index.json (ui-library-index@1), shared by every
 *                 project on the hub like the appearance document next to it; AXF_UI_LIBRARY_DIR points elsewhere
 *                 (tests); without a /projects mount the plugin's data folder holds it.
 *   package       one file, <id>.ui-library.json: the whole library, importable anywhere.
 *   import        framework (the shared set: every listed app and every future app bakes it), app (an app folder),
 *                 project (a plain assets/ folder), skin (a skin@1 asset), console (assets into this plugin's assets
 *                 folder + the overrides applied through the UI Manager).
 */
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import * as R from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { DATA_DIR, PLUGIN_DIR, ROOT } from './common.mjs';

export const INDEX_FILE = 'index.json';
export const PACKAGE_SUFFIX = '.ui-library.json';
/** Where a console import puts assets: this plugin's assets folder, which the catalog reads (lib/catalog.mjs). */
export const PLUGIN_ASSETS = `apps/console-web/plugins/${PLUGIN_DIR.split(/[\\/]/).pop()}/assets`;

export function libraryDir() {
  if (process.env.AXF_UI_LIBRARY_DIR) return process.env.AXF_UI_LIBRARY_DIR;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  if (existsSync(projects)) return join(projects, '_shared', '_data', 'libraries', 'ui');
  return join(DATA_DIR, 'library');
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
function chownLike(f, like) {
  // the hub's data server owns its folder: a file written as root stays writable by it
  try { const { uid, gid } = statSync(like); chownSync(dirname(f), uid, gid); chownSync(f, uid, gid); } catch { /* not root, or not on the hub */ }
}
function writeJson(file, value, like = '') {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
  if (like) chownLike(file, like);
}

/** The index entry of a library: what the list shows without reading every document. */
export const indexEntry = (lib, file = '') => ({
  id: lib.id, name: lib.name, version: lib.version, ...(lib.description ? { description: lib.description } : {}), author: lib.author, createdAt: lib.createdAt, app: lib.app,
  ...(lib.skin ? { skin: lib.skin } : {}), elements: lib.elements.length, assets: lib.assets.length, tokens: Object.values(lib.tokens ?? {}).reduce((n, m) => n + Object.keys(m).length, 0), ...(file ? { file } : {}),
});

/** Every library on the hub (the index, rebuilt from the files when it is missing or stale). */
export function listHub() {
  const dir = libraryDir();
  if (!existsSync(dir)) return { $axf: R.LIBRARY_INDEX_FRAME, dir, items: [] };
  const items = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== INDEX_FILE).sort()) {
    const lib = readJson(join(dir, f));
    if (lib?.$axf === R.LIBRARY_FRAME && !R.libraryErrors(lib).length) items.push(indexEntry(lib, f));
  }
  return { $axf: R.LIBRARY_INDEX_FRAME, dir, items };
}

export function readHub(id) {
  const f = join(libraryDir(), `${String(id).replace(/[^a-z0-9-]/g, '')}.json`);
  const lib = readJson(f);
  return lib?.$axf === R.LIBRARY_FRAME ? lib : null;
}

/** Publish to the shared hub library (a library of the same id is replaced) and refresh the index. */
export function publish(lib) {
  const errors = R.libraryErrors(lib);
  if (errors.length) return { error: errors.join('; ') };
  const dir = libraryDir();
  const like = dirname(dirname(dir));
  const file = join(dir, `${lib.id}.json`);
  writeJson(file, lib, existsSync(like) ? like : '');
  const index = listHub();
  writeJson(join(dir, INDEX_FILE), { $axf: R.LIBRARY_INDEX_FRAME, updatedAt: new Date().toISOString(), items: index.items }, existsSync(like) ? like : '');
  return { published: true, file, hub: dir, entry: indexEntry(lib, `${lib.id}.json`) };
}

/** The downloadable package: one file carrying the whole library. */
export const packageOf = (lib) => ({ filename: `${lib.id}${PACKAGE_SUFFIX}`, type: 'application/json', text: `${JSON.stringify(lib, null, 2)}\n` });

/** A library from a hub id, a file path or a parsed document. */
export function resolveLibrary(what) {
  if (what && typeof what === 'object') return what.$axf === R.LIBRARY_FRAME ? what : null;
  const s = String(what ?? '');
  if (!s) return null;
  if (/^[a-z0-9][a-z0-9-]{1,47}$/.test(s)) { const hub = readHub(s); if (hub) return hub; }
  const f = isAbsolute(s) ? s : resolve(ROOT, s);
  const lib = existsSync(f) ? readJson(f) : null;
  return lib?.$axf === R.LIBRARY_FRAME ? lib : null;
}

/** `type/id` of every asset the framework ships (the shared set an app already bakes). */
export function sharedRefs() {
  const out = [];
  const base = join(ROOT, 'framework', 'assets');
  if (!existsSync(base)) return out;
  for (const type of readdirSync(base, { withFileTypes: true })) {
    if (!type.isDirectory()) continue;
    for (const f of readdirSync(join(base, type.name))) if (f.endsWith('.json')) out.push(`${type.name}/${f.slice(0, -5)}`);
  }
  return out;
}

/**
 * Write an import plan: `into` framework | app | project | skin | console, `dir` the target folder (the repo for
 * framework / skin / console, the app or project folder otherwise). Existing files are only replaced with `force`.
 * → { into, written[], skipped[], overrides } ; the caller applies `overrides` through the UI Manager (console).
 */
export function writePlan(lib, { into, dir = '', catalog = null, force = false } = {}) {
  const base = into === 'app' || into === 'project' ? resolve(ROOT, dir || '.') : ROOT;
  const plan = R.libraryImportPlan(lib, { into, dir: '', catalog, sharedRefs: sharedRefs(), pluginAssets: PLUGIN_ASSETS });
  if (plan.error) return plan;
  const written = [], skipped = [];
  for (const f of plan.files) {
    const abs = resolve(base, f.path);
    if (!abs.startsWith(base)) { skipped.push({ path: f.path, why: 'outside the target folder' }); continue; }
    if (existsSync(abs) && !force) { skipped.push({ path: f.path, why: 'exists (use force to replace)' }); continue; }
    writeJson(abs, f.json);
    written.push(f.path);
  }
  return { into, base, written, skipped, overrides: plan.overrides, note: plan.note };
}
