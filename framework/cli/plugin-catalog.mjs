#!/usr/bin/env node
/**
 * Plugin catalog (plugin-catalog@1): plugins anyone of Brett's apps can install, kept on axHub.
 *
 * Where it lives: the hub's projects tree, shared by every project (axhub-projects@1):
 *   /projects/_shared/_data/plugin-catalog/
 *     catalog.json                                  plugin-catalog@1: the index (one entry per kind + folder, latest version)
 *     packages/<kind>/<folder>/<version>.json       plugin-package@1: the plugin's files, base64, with a content hash
 * The Dev Console mounts /projects, so it reads and writes the folder directly; axHub serves the same folder through
 * its axhub.memory_* tools (project "shared", area "data"). Other apps (Build Pilot) reach it through the console.
 * Resolution: AXF_PLUGIN_CATALOG (exact folder; "off" = none), else <AXHUB_PROJECTS_DIR or /projects>/_shared/_data/plugin-catalog
 * when that projects folder exists, else no catalog (commands say so).
 *
 * Kinds are an open registry (KINDS below): `console` = Dev Console plugins (plugin@1, any files),
 * `pilot` = Build Pilot plugins (pilot-plugin@1, web only: plugin.json, README.md, web/**), `axhub` = axHub web app
 * plugins (axhub-plugin@1, web only; `into` = the app folder in this repo they install into, see app-install). Add a kind there.
 *
 * Safety (the same checks run on pack, publish, read and install, and in Build Pilot's Python copy):
 *  - folder names ^[a-z0-9][a-z0-9-]{1,47}$; file paths relative, plain segments, no "..", no dot-files, no symlinks
 *  - never secret-looking files (.env*, keys, *.pem, credentials.json, secrets.env), never node_modules/dist/caches
 *  - at most 600 files, 2 MB per file, 8 MB per plugin
 *  - content hash (sha256 over path\0size\0bytes in path order) is checked against the index on every read
 *  - a version, once published, never changes: publishing other content needs a new version
 *  - installing never overwrites a different plugin (same folder, other id) and never a folder that is a symlink
 *
 *   node framework/cli/plugin-catalog.mjs where
 *   node framework/cli/plugin-catalog.mjs list [--kind console|pilot]
 *   node framework/cli/plugin-catalog.mjs show <kind> <folder>
 *   node framework/cli/plugin-catalog.mjs pack <dir> --kind <kind> [--out file.json]
 *   node framework/cli/plugin-catalog.mjs publish <dir> --kind <kind> [--from "who/where"] [--console https://console.amberxai.com]
 *        (--console: send it to that Dev Console instead of writing the folder here; needs AXF_TOKEN)
 *   node framework/cli/plugin-catalog.mjs publish-package <file|-> [--from …]      store a packed plugin (the console's route)
 *   node framework/cli/plugin-catalog.mjs package <kind> <folder> [--version v]    print the verified package
 *   node framework/cli/plugin-catalog.mjs install console <folder> [--update] [--publish]
 *        unpack into apps/console-web/plugins/<folder>, run its lifecycle install, and with --publish commit it to the
 *        repo on GitHub (needs GITHUB_TOKEN) so the console keeps it after its 5-minute reset and rebuilds with it
 *   node framework/cli/plugin-catalog.mjs install <kind> <folder> --into <plugins dir> [--update]
 *   node framework/cli/plugin-catalog.mjs swap <folder> [--version v] [--keep-data] [--publish]
 *        replace the installed console plugin with another build of it (another model): remove the old build (its
 *        hook + data, backed up, unless --keep-data), install the new one in the same folder. An update whose model
 *        differs from the installed build is refused unless it goes through swap (one instance per plugin)
 *   node framework/cli/plugin-catalog.mjs install-package <file|-> [--update] [--replace [--keep-data]] [--publish] [--sha256 h]
 *        install a console plugin package read from any archive (the Plugins installer: folder, https, another console);
 *        same checks as install (verified, one instance per plugin, other-model builds only with --replace = swap)
 *   node framework/cli/plugin-catalog.mjs remove <kind> <folder>                   take it out of the catalog (packages kept)
 *   node framework/cli/plugin-catalog.mjs app-list <kind>                          plugins of a kind with `into` (e.g. axhub) in this repo
 *   node framework/cli/plugin-catalog.mjs app-install <kind> <folder> [--update] [--version v] [--publish]
 *        unpack it into the kind's app folder (apps/axhub-web/src/plugins/<folder>) and commit just that folder to GitHub
 *   node framework/cli/plugin-catalog.mjs app-uninstall <kind> <folder> [--publish]  remove it there (and on GitHub)
 *   add --json for one JSON result on stdout
 */
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyDefaults, applyToPluginFile } from './build-defaults.mjs';
import { installClash } from './plugin-instances.mjs';

export const SCHEMA = 'plugin-catalog@1';
export const PACKAGE_SCHEMA = 'plugin-package@1';
const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));

/** Open registry of plugin kinds. `allow` limits which files a plugin of that kind may carry (null = any safe file). */
export const KINDS = {
  console: { label: 'Dev Console plugin', manifest: 'plugin@1', allow: null, idPattern: /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/ },
  pilot: { label: 'Build Pilot plugin', manifest: 'pilot-plugin@1', allow: /^(plugin\.json|README\.md|web\/.+)$/, idPattern: /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/ },
  // axHub's web app (apps/axhub-web, static files the hub only hosts: decision #93, the hub server never runs them).
  axhub: { label: 'axHub web plugin', manifest: 'axhub-plugin@1', allow: /^(plugin\.json|README\.md|web\/.+)$/, idPattern: /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/, into: 'apps/axhub-web/src/plugins' },
};

export const LIMITS = { files: 600, fileBytes: 2 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, pathChars: 200 };
export const FOLDER_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const SEGMENT_RE = /^[A-Za-z0-9_@+][A-Za-z0-9._@+-]{0,99}$/;
const SECRET_RE = /(^|\/)(\.env(\..*)?|secrets?\.env|credentials\.json|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|[^/]*\.(pem|key|p12|pfx|keystore|jks))$/i;
const SKIP = new Set(['node_modules', 'dist', 'dist-single', '__pycache__', '.git', 'build', '.gradle', '.pytest_cache', '.mypy_cache', '.venv']);

/* ------------------------------------------------------------------ where */

export function catalogRoot() {
  const exact = process.env.AXF_PLUGIN_CATALOG;
  if (exact !== undefined) return exact && exact !== 'off' ? resolve(exact) : null;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  return existsSync(projects) ? join(projects, '_shared', '_data', 'plugin-catalog') : null;
}

function needRoot() {
  const root = catalogRoot();
  if (!root) throw new Error('the plugin catalog is not reachable here: it lives on axHub (/projects/_shared/_data/plugin-catalog). Run this where /projects is mounted (the Dev Console), set AXF_PLUGIN_CATALOG, or use --console');
  return root;
}

/** Refuse when the catalog root or anything on the way to `target` inside it is a symlink. */
function noLinks(root, target) {
  const rel = relative(root, target);
  if (rel.startsWith('..') || resolve(root, rel) !== resolve(target)) throw new Error('path leaves the catalog');
  let cur = root;
  for (const part of ['', ...rel.split(sep).filter(Boolean)]) {
    if (part) cur = join(cur, part);
    let st = null;
    try { st = lstatSync(cur); } catch { return; }
    if (st.isSymbolicLink()) throw new Error(`${cur} is a symlink; refusing to use it`);
  }
}

/* ------------------------------------------------------------------ checks */

export function checkKind(kind) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new Error(`unknown plugin kind "${kind}" (known: ${Object.keys(KINDS).join(', ')})`);
  return KINDS[kind];
}

export function checkFolder(folder) {
  if (typeof folder !== 'string' || !FOLDER_RE.test(folder)) throw new Error(`"${folder}" is not a plugin folder name (lowercase letters, digits, dashes)`);
  return folder;
}

/** Problems with one file path inside a plugin (empty = fine). */
export function pathProblem(kind, path) {
  if (typeof path !== 'string' || !path) return 'empty path';
  if (path.length > LIMITS.pathChars) return `${path.slice(0, 40)}…: path too long`;
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/')) return `${path}: not a plain relative path`;
  const segs = path.split('/');
  for (const s of segs) {
    if (s === '.' || s === '..' || !SEGMENT_RE.test(s)) return `${path}: "${s}" is not allowed in a plugin path`;
    if (SKIP.has(s)) return `${path}: ${s} is never shipped`;
  }
  if (SECRET_RE.test(path)) return `${path}: looks like a secret and is never shipped`;
  const allow = KINDS[kind]?.allow;
  if (allow && !allow.test(path)) return `${path}: a ${KINDS[kind].label} may only carry ${allow.source}`;
  return '';
}

export function checkManifest(kind, m, folder) {
  const k = checkKind(kind);
  const problems = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['plugin.json is not an object'];
  if (m.$axf !== k.manifest) problems.push(`plugin.json must be ${k.manifest} (got ${JSON.stringify(m.$axf)})`);
  if (typeof m.id !== 'string' || !k.idPattern.test(m.id) || m.id.length > 120) problems.push('plugin.json id must be a dotted lowercase id (e.g. ai.amberx.pilot.my-plugin)');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) problems.push('plugin.json needs a name (≤ 80 characters)');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) problems.push('plugin.json needs a version like 1.2.3');
  if (folder && m.folder && m.folder !== folder) problems.push(`plugin.json folder "${m.folder}" differs from "${folder}"`);
  // Console plugins follow the build engine's default rules (build-defaults@1): a package that misses a required field
  // (e.g. the model that built it, builtWith.model) is refused; missing defaults are filled when it is installed.
  if (kind === 'console') for (const x of applyDefaults('plugin', m).problems) problems.push(`plugin.json: ${x.message}`);
  return problems;
}

/** sha256 over every file, in path order: path \0 size \0 bytes. Build Pilot's Python copy computes the same. */
export function contentHash(files) {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const bytes = Buffer.from(f.b64, 'base64');
    h.update(f.path); h.update('\0'); h.update(String(bytes.length)); h.update('\0'); h.update(bytes);
  }
  return h.digest('hex');
}

/** Full check of a package object; returns it (normalised) or throws with every problem. */
export function verifyPackage(pkg, expect = {}) {
  const problems = [];
  if (!pkg || typeof pkg !== 'object' || pkg.$axf !== PACKAGE_SCHEMA) throw new Error(`not a ${PACKAGE_SCHEMA} package`);
  const kind = pkg.kind;
  checkKind(kind);
  checkFolder(pkg.folder);
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) throw new Error('package has no files');
  if (pkg.files.length > LIMITS.files) throw new Error(`package has ${pkg.files.length} files (max ${LIMITS.files})`);
  const seen = new Set();
  let total = 0;
  let manifest = null;
  for (const f of pkg.files) {
    if (!f || typeof f.path !== 'string' || typeof f.b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.b64)) { problems.push('a file entry is malformed'); continue; }
    const pp = pathProblem(kind, f.path);
    if (pp) problems.push(pp);
    const lower = f.path.toLowerCase();
    if (seen.has(lower)) problems.push(`${f.path}: listed twice`);
    seen.add(lower);
    const size = Buffer.from(f.b64, 'base64').length;
    if (size > LIMITS.fileBytes) problems.push(`${f.path}: ${size} bytes (max ${LIMITS.fileBytes})`);
    total += size;
    if (f.path === 'plugin.json') {
      try { manifest = JSON.parse(Buffer.from(f.b64, 'base64').toString('utf8')); } catch { problems.push('plugin.json is not valid JSON'); }
    }
  }
  if (total > LIMITS.totalBytes) problems.push(`package is ${total} bytes (max ${LIMITS.totalBytes})`);
  for (const dir of [...seen]) for (const other of seen) if (other.startsWith(`${dir}/`)) problems.push(`${dir} is both a file and a folder`);
  if (!manifest) problems.push('package has no plugin.json');
  else problems.push(...checkManifest(kind, manifest, pkg.folder));
  const hash = contentHash(pkg.files);
  if (pkg.sha256 && pkg.sha256 !== hash) problems.push('content hash does not match the files (damaged or altered package)');
  if (expect.sha256 && expect.sha256 !== hash) problems.push('package does not match the catalog entry (damaged or altered)');
  if (manifest && pkg.version && pkg.version !== manifest.version) problems.push('package version differs from plugin.json');
  if (manifest && pkg.id && pkg.id !== manifest.id) problems.push('package id differs from plugin.json');
  if (problems.length) throw new Error(problems.join('; '));
  return { ...pkg, id: manifest.id, name: manifest.name, version: manifest.version, manifest, sha256: hash, bytes: total };
}

/* ------------------------------------------------------------------ pack */

export function pack(dir, kind, folder) {
  checkKind(kind);
  const abs = resolve(dir);
  const st = lstatSync(abs);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${dir} is not a plugin folder`);
  folder = checkFolder(folder || abs.split(sep).pop());
  const files = [];
  const walk = (d, rel) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const s = lstatSync(p);
      if (s.isSymbolicLink()) throw new Error(`${r} is a symlink; plugins can't ship links`);
      if (s.isDirectory()) { if (SKIP.has(name)) continue; walk(p, r); continue; }
      if (!s.isFile()) continue;
      if (SECRET_RE.test(r)) continue; // never packed (a secret-looking file left in a plugin folder)
      if (KINDS[kind].allow && !KINDS[kind].allow.test(r)) continue; // e.g. a pilot plugin's tests or notes
      if (name.startsWith('.')) continue;
      const pp = pathProblem(kind, r);
      if (pp) throw new Error(pp);
      files.push({ path: r, b64: readFileSync(p).toString('base64') });
      if (files.length > LIMITS.files) throw new Error(`more than ${LIMITS.files} files`);
    }
  };
  walk(abs, '');
  return verifyPackage({ $axf: PACKAGE_SCHEMA, kind, folder, files });
}

/* ------------------------------------------------------------------ catalog store */

function emptyCatalog() { return { $axf: SCHEMA, updatedAt: null, items: [] }; }

export function readCatalog(root = catalogRoot()) {
  if (!root) return { ...emptyCatalog(), reachable: false };
  const f = join(root, 'catalog.json');
  noLinks(root, f);
  if (!existsSync(f)) return { ...emptyCatalog(), reachable: true };
  const c = JSON.parse(readFileSync(f, 'utf8'));
  if (c.$axf !== SCHEMA || !Array.isArray(c.items)) throw new Error(`${f} is not a ${SCHEMA} index`);
  return { ...c, reachable: true };
}

function writeAtomic(root, file, text) {
  noLinks(root, file);
  mkdirSync(dirname(file), { recursive: true });
  noLinks(root, file);
  const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, text, { mode: 0o664 });
  renameSync(tmp, file);
}

function withLock(root, fn) {
  mkdirSync(root, { recursive: true });
  noLinks(root, root);
  const lock = join(root, '.lock');
  for (let i = 0; ; i++) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 60000) { rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (i > 50) throw new Error('the plugin catalog is busy; try again');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try { return fn(); } finally { rmSync(lock, { force: true }); }
}

const pkgFile = (root, kind, folder, version) => join(root, 'packages', kind, folder, `${version}.json`);

export function compareVersions(a, b) {
  const pa = String(a).split(/[-+]/)[0].split('.').map(Number);
  const pb = String(b).split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return String(a).localeCompare(String(b));
}

/** Store a package in the catalog. Same version + same content = nothing to do; same version + other content = refused. */
export function publishPackage(pkg, { from = '' } = {}) {
  const root = needRoot();
  const v = verifyPackage(pkg);
  return withLock(root, () => {
    const cat = readCatalog(root);
    const clash = cat.items.find((it) => it.kind === v.kind && it.id === v.id && it.folder !== v.folder);
    if (clash) throw new Error(`${v.id} is already in the catalog as folder "${clash.folder}"`);
    const prev = cat.items.find((it) => it.kind === v.kind && it.folder === v.folder);
    if (prev && prev.id !== v.id) throw new Error(`folder "${v.folder}" is already in the catalog for another plugin (${prev.id})`);
    const file = pkgFile(root, v.kind, v.folder, v.version);
    noLinks(root, file);
    if (existsSync(file)) {
      const old = JSON.parse(readFileSync(file, 'utf8'));
      if (old.sha256 !== v.sha256) throw new Error(`${v.folder} ${v.version} is already published with other content: raise the version in plugin.json`);
      if (prev && prev.version === v.version) return { published: false, item: prev, note: 'already in the catalog' };
    }
    const now = new Date().toISOString();
    const stored = { $axf: PACKAGE_SCHEMA, kind: v.kind, folder: v.folder, id: v.id, name: v.name, version: v.version, sha256: v.sha256, publishedAt: now, publishedFrom: String(from).slice(0, 120), files: v.files };
    if (!existsSync(file)) writeAtomic(root, file, JSON.stringify(stored));
    const m = v.manifest;
    const item = {
      kind: v.kind, folder: v.folder, id: v.id, name: v.name, version: v.version,
      description: typeof m.description === 'string' ? m.description.slice(0, 400) : '',
      author: typeof m.author === 'string' ? m.author.slice(0, 80) : '',
      ...(Array.isArray(m.stacks) ? { stacks: m.stacks.filter((s) => typeof s === 'string').slice(0, 20) } : {}),
      ...(Array.isArray(m.requires) ? { requires: m.requires.filter((s) => typeof s === 'string').slice(0, 20) } : {}),
      ...(Array.isArray(m.provides) ? { provides: m.provides.filter((s) => typeof s === 'string').slice(0, 20) } : {}),
      ...(m.builtWith && typeof m.builtWith.model === 'string' ? { builtWith: { model: m.builtWith.model.slice(0, 20), ...(typeof m.builtWith.builtAt === 'string' ? { builtAt: m.builtWith.builtAt.slice(0, 10) } : {}) } } : {}),
      sha256: v.sha256, bytes: v.bytes, files: v.files.length, publishedAt: now, publishedFrom: stored.publishedFrom,
      versions: [...new Set([...(prev?.versions ?? []), v.version])].sort(compareVersions),
      // the model that built each version, so a host sees "a Fable rebuild is out" (Plugin Update)
      models: { ...(prev?.models ?? {}), ...(m.builtWith?.model ? { [v.version]: String(m.builtWith.model).slice(0, 20) } : {}) },
    };
    // The index shows the newest version; publishing an older one only adds it to `versions`.
    const keep = prev && compareVersions(prev.version, v.version) > 0 ? { ...prev, versions: item.versions, models: item.models } : item;
    cat.items = [...cat.items.filter((it) => it !== prev), keep].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    cat.updatedAt = now;
    delete cat.reachable;
    writeAtomic(root, join(root, 'catalog.json'), `${JSON.stringify(cat, null, 2)}\n`);
    return { published: true, item: keep };
  });
}

export function removeEntry(kind, folder) {
  checkKind(kind); checkFolder(folder);
  const root = needRoot();
  return withLock(root, () => {
    const cat = readCatalog(root);
    const before = cat.items.length;
    cat.items = cat.items.filter((it) => !(it.kind === kind && it.folder === folder));
    if (cat.items.length === before) throw new Error(`${kind}/${folder} is not in the catalog`);
    cat.updatedAt = new Date().toISOString();
    delete cat.reachable;
    writeAtomic(root, join(root, 'catalog.json'), `${JSON.stringify(cat, null, 2)}\n`);
    return { removed: `${kind}/${folder}` };
  });
}

export function list({ kind } = {}) {
  if (kind) checkKind(kind);
  const cat = readCatalog();
  return { reachable: cat.reachable, root: catalogRoot(), updatedAt: cat.updatedAt, kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])), items: cat.items.filter((it) => !kind || it.kind === kind) };
}

export function entry(kind, folder) {
  checkKind(kind); checkFolder(folder);
  const it = readCatalog().items.find((x) => x.kind === kind && x.folder === folder);
  if (!it) throw new Error(`${kind}/${folder} is not in the catalog`);
  return it;
}

/** The package for a catalog entry (newest unless `version`), checked against the index and itself. */
export function getPackage(kind, folder, version) {
  const root = needRoot();
  const it = entry(kind, folder);
  const ver = version || it.version;
  if (!VERSION_RE.test(ver) || !(it.versions ?? [it.version]).includes(ver)) throw new Error(`${folder} has no version ${ver} in the catalog`);
  const file = pkgFile(root, kind, folder, ver);
  noLinks(root, file);
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const v = verifyPackage(pkg, ver === it.version ? { sha256: it.sha256 } : {});
  if (v.kind !== kind || v.folder !== folder || v.id !== it.id) throw new Error('package does not match its catalog entry');
  return v;
}

/* ------------------------------------------------------------------ install */

function manifestIn(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8')); } catch { return null; }
}
function manifestIdIn(dir) { return manifestIn(dir)?.id ?? null; }

/**
 * Unpack a verified package into `<pluginsDir>/<folder>`. New folders only, unless `update` (then only over the same
 * plugin id). Written to a hidden sibling first and swapped in, so a failed install leaves the old folder as it was.
 */
export function unpack(pkg, pluginsDir, { update = false, replaceModel = false } = {}) {
  const v = verifyPackage(pkg);
  const base = resolve(pluginsDir);
  const bst = lstatSync(base);
  if (bst.isSymbolicLink() || !bst.isDirectory()) throw new Error(`${pluginsDir} is not a folder`);
  const dest = join(base, v.folder);
  let st = null;
  try { st = lstatSync(dest); } catch { /* new */ }
  if (st?.isSymbolicLink()) throw new Error(`${v.folder} is a symlink; refusing to touch it`);
  if (st && !update) throw new Error(`${v.folder} is already installed; use update`);
  if (st && manifestIdIn(dest) !== v.id) throw new Error(`${v.folder} holds another plugin (${manifestIdIn(dest) ?? 'no plugin.json'}); not overwriting it`);
  // An update built by another model is a replacement: only with replaceModel (Plugin Update's confirmed swap).
  const was = st ? manifestIn(dest)?.builtWith?.model : null;
  const now = v.manifest?.builtWith?.model;
  if (st && was && now && was !== now && !replaceModel) throw new Error(`${v.folder} is installed as the ${was} build and this is the ${now} build: replacing one build with the other needs the confirmed swap (Plugin Update → Replace, plugin-catalog.mjs swap)`);
  const installed = [];
  for (const name of readdirSync(base)) {
    if (name === v.folder || name.startsWith('.') || name.startsWith('_')) continue;
    const other = join(base, name);
    try { if (!lstatSync(other).isDirectory()) continue; } catch { continue; }
    if (manifestIdIn(other) === v.id) throw new Error(`${v.id} is already installed as "${name}"`);
    const om = manifestIn(other);
    if (om) installed.push({ folder: name, manifest: om });
  }
  // One instance per plugin (Brett, Oct 23 2026): never next to another build of the same plugin, whatever its model.
  const clash = installClash({ folder: v.folder, manifest: v.manifest }, installed);
  if (clash) throw new Error(clash);
  const tmp = join(base, `.${v.folder}.incoming-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmp);
  try {
    for (const f of v.files) {
      const target = resolve(tmp, f.path);
      if (!target.startsWith(tmp + sep)) throw new Error(`${f.path} leaves the plugin folder`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(f.b64, 'base64'), { mode: 0o644, flag: 'wx' });
    }
    let old = null;
    if (st) { old = join(base, `.${v.folder}.old-${randomBytes(4).toString('hex')}`); renameSync(dest, old); }
    try { renameSync(tmp, dest); } catch (e) { if (old) renameSync(old, dest); throw e; }
    if (old) rmSync(old, { recursive: true, force: true });
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  // build-defaults@1: fill what the package left to the defaults (e.g. where its UI opens) in the installed plugin.json
  if (v.kind === 'console') applyToPluginFile(join(dest, 'plugin.json'), { write: true });
  return { installed: v.folder, id: v.id, name: v.name, version: v.version, updated: !!st, files: v.files.length, dir: dest };
}

/** Console plugin from the catalog: unpack, run its lifecycle install, optionally commit it to the repo on GitHub. */
export async function installConsole(folder, opts = {}, log = () => {}) {
  return installConsolePackage(getPackage('console', folder, opts.version), opts, log);
}

/**
 * A console plugin package from anywhere (the catalog on axHub, another archive the Plugins installer reads): verified
 * (and checked against `sha256` when the archive's index gives one), unpacked with every install rule (one instance,
 * model swap only with replaceModel, build defaults), lifecycle install, optionally committed to GitHub.
 */
export async function installConsolePackage(raw, { update = false, publish = false, noState = false, replaceModel = false, sha256 } = {}, log = () => {}) {
  const lc = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'plugin-lifecycle.mjs')).href);
  const pkg = verifyPackage(raw, sha256 ? { sha256 } : {});
  if (pkg.kind !== 'console') throw new Error(`this is a ${pkg?.kind ?? 'unknown'} plugin, not a console plugin`);
  const folder = pkg.folder;
  const r = unpack(pkg, lc.PLUGINS_DIR, { update, replaceModel });
  log(`${r.updated ? 'updated' : 'installed'} ${r.name} ${r.version} in apps/console-web/plugins/${folder}`);
  const life = await lc.install(folder, { noState }, log);
  let published = null;
  if (publish) published = lc.publishAddition(folder, `${r.updated ? 'Update' : 'Install'} plugin ${r.name} ${r.version} (${folder}) from the plugin catalog`, log);
  else log('in this clone only: publish it (--publish) or the console\'s 5-minute reset keeps it but other clones won\'t get it');
  return { ...r, dir: relative(ROOT, r.dir), lifecycle: life, published };
}

/**
 * Replace an installed console plugin with another build of it from the catalog (e.g. the Opus build with its Fable
 * rebuild): Plugin Update's confirmed swap. 1) remove the old build: its onUninstall hook and, unless `keepData`, its
 * data folder (backed up first); 2) install the new build in the same folder (atomic swap, so never two copies) and run
 * its lifecycle install; 3) optionally commit it to GitHub. If step 2 fails, the old code is still in place (the folder
 * swap never happened) and its backed-up data can be restored from the lifecycle panel.
 */
export async function swapConsole(folder, { version, keepData = false, publish = false, noState = false } = {}, log = () => {}) {
  return swapConsolePackage(getPackage('console', folder, version), { keepData, publish, noState }, log);
}

/** swapConsole with a package from any archive. */
export async function swapConsolePackage(raw, { keepData = false, publish = false, noState = false, sha256 } = {}, log = () => {}) {
  const lc = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'plugin-lifecycle.mjs')).href);
  const pkg = verifyPackage(raw, sha256 ? { sha256 } : {});
  if (pkg.kind !== 'console') throw new Error(`this is a ${pkg.kind} plugin, not a console plugin`);
  const folder = pkg.folder;
  const cur = manifestIn(join(lc.PLUGINS_DIR, folder));
  if (!cur) throw new Error(`${folder} is not installed: install it instead`);
  if (cur.id !== pkg.id) throw new Error(`${folder} holds another plugin (${cur.id}); not replacing it`);
  const from = { model: cur.builtWith?.model ?? '?', version: cur.version };
  const to = { model: pkg.manifest?.builtWith?.model ?? '?', version: pkg.version };
  log(`replacing ${pkg.name} ${from.version} (${from.model}) with ${to.version} (${to.model})`);
  let removed = null;
  if (!keepData) { removed = await lc.uninstall(folder, { data: true, noState: true }, log); log('removed the old build\'s data (backed up)'); }
  else log('keeping its data folder');
  const r = await installConsolePackage(pkg, { update: true, replaceModel: true, publish, noState }, log);
  return { ...r, swapped: true, from, to, removed: removed ? { data: removed.data, backup: removed.backup } : null };
}

/* ------------------------------------------------------------------ app plugins (kinds with `into`) */

/** The app plugins folder of a kind that installs into an app in this repo (e.g. axhub → apps/axhub-web/src/plugins). */
export function appPluginsDir(kind) {
  const k = checkKind(kind);
  if (!k.into) throw new Error(`${k.label}s don't install into an app in this repo`);
  const dir = resolve(ROOT, k.into);
  let st = null;
  try { st = lstatSync(dir); } catch { throw new Error(`${k.into} is missing in this clone`); }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${k.into} is not a folder`);
  return { dir, rel: k.into };
}

/** Plugins of that kind in its app folder ("_" and dot folders are templates / half-installed, never listed). */
export function listAppPlugins(kind) {
  const { dir, rel } = appPluginsDir(kind);
  const items = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name.startsWith('_') || !FOLDER_RE.test(name)) continue;
    const d = join(dir, name);
    try { if (lstatSync(d).isSymbolicLink() || !lstatSync(d).isDirectory()) continue; } catch { continue; }
    const m = manifestIn(d);
    if (!m || m.$axf !== KINDS[kind].manifest || typeof m.id !== 'string') continue;
    items.push({ folder: name, id: m.id, name: typeof m.name === 'string' ? m.name : m.id, version: typeof m.version === 'string' ? m.version : '', builtWith: m.builtWith && typeof m.builtWith === 'object' ? m.builtWith : null });
  }
  return { kind, dir: rel, items };
}

async function lifecycle() {
  return import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'plugin-lifecycle.mjs')).href);
}

/** Install (or update) a catalog plugin into its app folder; with `publish`, commit only that folder to GitHub. */
export async function installAppPlugin(kind, folder, { update = false, publish = false, version } = {}, log = () => {}) {
  checkFolder(folder);
  const { dir, rel } = appPluginsDir(kind);
  const r = unpack(getPackage(kind, folder, version), dir, { update });
  log(`${r.updated ? 'updated' : 'installed'} ${r.name} ${r.version} in ${rel}/${folder}`);
  let published = null;
  if (publish) {
    const lc = await lifecycle();
    const dest = `${rel}/${folder}`;
    published = lc.publishChange((wt, git) => {
      rmSync(join(wt, dest), { recursive: true, force: true });
      cpSync(join(dir, folder), join(wt, dest), { recursive: true });
      git(['-C', wt, 'add', '-A', '--', dest]);
    }, `${r.updated ? 'Update' : 'Install'} ${KINDS[kind].label} ${r.name} ${r.version} (${folder}) from the plugin catalog`, log, 'GitHub already has this plugin as installed');
  }
  return { ...r, dir: relative(ROOT, r.dir), published };
}

/** Remove a plugin from its app folder (only a folder holding a plugin of that kind); with `publish`, on GitHub too. */
export async function uninstallAppPlugin(kind, folder, { publish = false } = {}, log = () => {}) {
  checkFolder(folder);
  const { dir, rel } = appPluginsDir(kind);
  const d = join(dir, folder);
  let st = null;
  try { st = lstatSync(d); } catch { throw new Error(`${folder} is not installed in ${rel}`); }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${rel}/${folder} is not a plugin folder`);
  const m = manifestIn(d);
  if (!m || m.$axf !== KINDS[kind].manifest) throw new Error(`${rel}/${folder} doesn't hold a ${KINDS[kind].label}; not removing it`);
  rmSync(d, { recursive: true, force: true });
  log(`removed ${m.name ?? folder} from ${rel}/${folder}`);
  let published = null;
  if (publish) {
    const lc = await lifecycle();
    const dest = `${rel}/${folder}`;
    published = lc.publishChange((wt, git) => {
      if (existsSync(join(wt, dest))) git(['-C', wt, 'rm', '-r', '-q', '--', dest]);
    }, `Uninstall ${KINDS[kind].label} ${m.name ?? folder} (${folder})`, log, 'GitHub already has this removal');
  }
  return { removed: folder, id: m.id, name: m.name ?? folder, dir: `${rel}/${folder}`, published };
}

/* ------------------------------------------------------------------ CLI */

async function sendToConsole(base, pkg, from) {
  const token = process.env.AXF_TOKEN;
  if (!token) throw new Error('--console needs AXF_TOKEN (the Dev Console token) in the environment');
  const url = new URL('/api/plugin-catalog/publish', base);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('--console must be https');
  const r = await fetch(url, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ package: pkg, from }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`console refused it (${r.status}): ${body.detail ?? ''}`);
  return body;
}

export async function main(argv) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args.push(a); continue; }
    const k = a.slice(2);
    if (['kind', 'out', 'from', 'console', 'version', 'into', 'sha256'].includes(k)) flags[k] = argv[++i]; else flags[k] = true;
  }
  const [cmd, a1, a2] = args;
  const lines = [];
  const log = (m) => { lines.push(m); if (!flags.json) console.error(m); };
  const out = (o) => console.log(flags.json ? JSON.stringify({ ok: true, ...o, log: lines }) : JSON.stringify(o, null, 2));
  try {
    if (cmd === 'where') return out({ root: catalogRoot(), reachable: !!catalogRoot() && existsSync(catalogRoot()) });
    if (cmd === 'list') return out(list({ kind: flags.kind }));
    if (cmd === 'show') return out(entry(a1, a2));
    if (cmd === 'pack') {
      const p = pack(a1, flags.kind || 'console');
      if (flags.out) { writeFileSync(flags.out, JSON.stringify(p)); return out({ written: flags.out, id: p.id, version: p.version, sha256: p.sha256 }); }
      return console.log(JSON.stringify(p));
    }
    if (cmd === 'publish') {
      if (!a1 || !flags.kind) throw new Error('usage: publish <dir> --kind <kind>');
      const p = pack(a1, flags.kind);
      if (flags.console) return out(await sendToConsole(flags.console, p, flags.from || 'cli'));
      return out(publishPackage(p, { from: flags.from || 'cli' }));
    }
    if (cmd === 'publish-package') {
      const text = !a1 || a1 === '-' ? readFileSync(0, 'utf8') : readFileSync(a1, 'utf8');
      return out(publishPackage(JSON.parse(text), { from: flags.from || '' }));
    }
    if (cmd === 'package') return console.log(JSON.stringify(getPackage(a1, a2, flags.version)));
    if (cmd === 'install') {
      checkKind(a1); checkFolder(a2);
      if (a1 === 'console' && !flags.into) return out(await installConsole(a2, { update: !!flags.update, publish: !!flags.publish, version: flags.version, noState: !!flags['no-state'] }, log));
      if (!flags.into) throw new Error(`installing a ${a1} plugin needs --into <its app's plugins folder>`);
      return out(unpack(getPackage(a1, a2, flags.version), flags.into, { update: !!flags.update }));
    }
    if (cmd === 'swap') {
      checkFolder(a1);
      return out(await swapConsole(a1, { version: flags.version, keepData: !!flags['keep-data'], publish: !!flags.publish, noState: !!flags['no-state'] }, log));
    }
    if (cmd === 'install-package') {
      const text = !a1 || a1 === '-' ? readFileSync(0, 'utf8') : readFileSync(a1, 'utf8');
      const pkg = JSON.parse(text);
      const o = { publish: !!flags.publish, noState: !!flags['no-state'], ...(flags.sha256 ? { sha256: flags.sha256 } : {}) };
      if (flags.replace) return out(await swapConsolePackage(pkg, { ...o, keepData: !!flags['keep-data'] }, log));
      return out(await installConsolePackage(pkg, { ...o, update: !!flags.update }, log));
    }
    if (cmd === 'remove') return out(removeEntry(a1, a2));
    if (cmd === 'app-list') return out(listAppPlugins(a1));
    if (cmd === 'app-install') return out(await installAppPlugin(a1, a2, { update: !!flags.update, publish: !!flags.publish, version: flags.version }, log));
    if (cmd === 'app-uninstall') return out(await uninstallAppPlugin(a1, a2, { publish: !!flags.publish }, log));
    throw new Error('usage: plugin-catalog.mjs where | list | show | pack | publish | publish-package | package | install | remove (see the header)');
  } catch (e) {
    if (flags.json) console.log(JSON.stringify({ ok: false, error: e.message, log: lines }));
    else console.error(`plugin-catalog: ${e.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
