#!/usr/bin/env node
/**
 * Plugin lifecycle (plugin-lifecycle@1): install, uninstall and stale-code checks for console plugins.
 *
 *   node framework/cli/plugin-lifecycle.mjs list                              every plugin and its footprint
 *   node framework/cli/plugin-lifecycle.mjs status    <folder>                footprint, data size, references
 *   node framework/cli/plugin-lifecycle.mjs install   <folder> [--no-state]   create the data folder, run the plugin's onInstall hook, enable it
 *   node framework/cli/plugin-lifecycle.mjs uninstall <folder> [--data] [--code] [--all] [--publish] [--no-backup] [--dry-run] [--no-state]
 *   node framework/cli/plugin-lifecycle.mjs check     <folder> [--after-uninstall]   stale-reference check (exit 1 on stale hits)
 *   node framework/cli/plugin-lifecycle.mjs restore   <folder> <backup.tar.gz>
 *   add --json for one JSON result on stdout (the Dev Console drives it this way)
 *
 * The convention every plugin follows (docs: apps/console-web/plugins/README.md → "Lifecycle"):
 *  1. All of a plugin's code lives in its own folder, apps/console-web/plugins/<folder>/. Nothing outside it is edited
 *     for the plugin. Cross-plugin features go through generic services (server/plugin_services.py), never by name.
 *  2. All of its runtime data lives in ONE folder, `lifecycle.dataDir` (default .axf-console/plugins/<folder>/).
 *  3. The only other trace is its enabled flag in the console state file (state.json → plugins.<folder>).
 *  4. Documentation lines outside the folder that mention it end with the marker `axf-plugin:<folder>` (in a comment)
 *     and their files are listed in `lifecycle.mentions`; uninstall --code strips those lines.
 *  5. Optional hooks in <folder>/hooks.mjs: onInstall(ctx), onUninstall(ctx), checks(ctx) → [{ id, ok, detail }].
 *     `checks` are the plugin's declared self-checks: run after install, by `checks <folder>`, and by the systems check.
 *  6. The plugin ships install.mjs + uninstall.mjs (thin wrappers around this file) and shows the shared lifecycle panel
 *     in its settings tab.
 * So uninstall --all leaves nothing behind: no code, no data, no state, no doc lines. `check --after-uninstall` proves it.
 */
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gitAuthEnv, scrub } from './github.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
export const PLUGINS_DIR = join(ROOT, 'apps/console-web/plugins');
const STATE = resolve(process.env.AXF_STATE || join(ROOT, '.axf-console/state.json'));
const BACKUPS = join(ROOT, '.axf-console/plugin-backups');
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const REBUILDS_DIR = join(ROOT, '_claude', 'memory', 'docs', 'rebuilds');
const HARVEST_DIR = join(ROOT, '_claude', 'memory', 'docs', 'harvest');
// The Codebase changes log (change-log@1, one JSON per request) is history too: an entry names the folders a build touched.
const CHANGES_DIR = join(ROOT, 'changes');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-single', '.axf-console', '__pycache__', 'build', '.gradle']);
const TEXT_EXT = /\.(md|mjs|js|cjs|ts|tsx|json|py|css|html|ya?ml|kt|kts|sh|txt|toml)$/i;

/* ------------------------------------------------------------------ manifest + footprint */

export function readManifest(folder) {
  if (!FOLDER_RE.test(folder)) throw new Error(`"${folder}" is not a plugin folder name (lowercase letters, digits, dashes)`);
  const dir = join(PLUGINS_DIR, folder);
  const file = join(dir, 'plugin.json');
  if (!existsSync(file)) return { folder, dir, present: false, manifest: null, lifecycle: defaults(folder) };
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.$axf !== 'plugin@1') throw new Error(`${folder}/plugin.json is not a plugin@1 manifest`);
  return { folder, dir, present: true, manifest, lifecycle: { ...defaults(folder), ...(manifest.lifecycle ?? {}) } };
}

function defaults(folder) {
  return { $axf: 'plugin-lifecycle@1', dataDir: `.axf-console/plugins/${folder}`, mentions: [], env: [] };
}

function safeDataDir(p) {
  const abs = resolve(ROOT, p.lifecycle.dataDir);
  const own = resolve(ROOT, '.axf-console/plugins', p.folder);
  // Only the plugin's own folder (or something inside it): never .axf-console itself, plugins/, backups, env or state.
  if (abs !== own && !abs.startsWith(own + '/')) throw new Error(`lifecycle.dataDir must be .axf-console/plugins/${p.folder} (or inside it), got ${p.lifecycle.dataDir}`);
  let st = null;
  try { st = lstatSync(abs); } catch { /* not there yet */ }
  if (st?.isSymbolicLink()) throw new Error(`${p.lifecycle.dataDir} is a symlink; refusing to touch it`);
  return abs;
}

function sizeOf(path) {
  let st;
  try { st = lstatSync(path); } catch { return { files: 0, bytes: 0 }; }
  if (st.isSymbolicLink()) return { files: 1, bytes: 0 };
  if (!st.isDirectory()) return { files: 1, bytes: st.size };
  let files = 0, bytes = 0;
  for (const n of readdirSync(path)) { const s = sizeOf(join(path, n)); files += s.files; bytes += s.bytes; }
  return { files, bytes };
}

function readState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function writeState(mut) {
  const s = readState();
  mut(s);
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

/* ------------------------------------------------------------------ stale reference scan */

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue;
    const p = join(dir, n);
    let st; try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.test(n) && st.size < 2_000_000) yield p;
  }
}

/** Every line outside the plugin's folder that names it. Marker lines in listed mention files are "managed", the rest "stale". */
export function scanReferences(p) {
  const id = p.manifest?.id;
  const needles = [`plugins/${p.folder}/`, `plugins/${p.folder}'`, `plugins/${p.folder}"`, `axf-plugin:${p.folder}`];
  if (id) needles.push(id);
  const quoted = [`'${p.folder}'`, `"${p.folder}"`]; // only meaningful inside other plugins' code
  const mentions = new Set((p.lifecycle.mentions ?? []).map((m) => resolve(ROOT, m)));
  const hits = [];
  for (const file of walk(ROOT)) {
    if (file.startsWith(p.dir + '/') || file === STATE) continue;
    // Rebuild and harvest reports (and their screenshots) are history: they describe a plugin version and must outlive it.
    if (file.startsWith(REBUILDS_DIR + '/') || file.startsWith(HARVEST_DIR + '/') || file.startsWith(CHANGES_DIR + '/')) continue;
    // Another plugin's own tests may name plugins as data (e.g. the rebuild tracker's fixtures); only its runtime
    // code is held to "never by folder name".
    const inOtherPlugin = file.startsWith(PLUGINS_DIR + '/') && !/^test[._]/.test(file.split('/').pop());
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const hit = needles.some((n) => line.includes(n)) || (inOtherPlugin && quoted.some((q) => line.includes(q)));
      if (!hit) return;
      const managed = line.includes(`axf-plugin:${p.folder}`) && mentions.has(file);
      hits.push({ file: relative(ROOT, file), line: i + 1, text: line.trim().slice(0, 200), managed });
    });
  }
  return hits;
}

function stripMentions(p, dry, log) {
  let n = 0;
  for (const m of p.lifecycle.mentions ?? []) {
    const file = resolve(ROOT, m);
    if (!file.startsWith(ROOT + '/') || !existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const kept = lines.filter((l) => !l.includes(`axf-plugin:${p.folder}`));
    if (kept.length !== lines.length) {
      n += lines.length - kept.length;
      log(`${dry ? 'would strip' : 'stripped'} ${lines.length - kept.length} line(s) from ${m}`);
      if (!dry) writeFileSync(file, kept.join('\n'));
    }
  }
  return n;
}

/* ------------------------------------------------------------------ hooks */

async function hooks(p) {
  const f = join(p.dir, 'hooks.mjs');
  if (!existsSync(f)) return {};
  return import(pathToFileURL(f).href);
}

function ctxFor(p, log) {
  return { root: ROOT, folder: p.folder, dir: p.dir, dataDir: safeDataDir(p), manifest: p.manifest, log };
}

/* ------------------------------------------------------------------ actions */

export function status(folder) {
  const p = readManifest(folder);
  const data = p.present || p.lifecycle ? safeDataDir(p) : null;
  const state = readState().plugins ?? {};
  const refs = scanReferences(p);
  return {
    folder, present: p.present, id: p.manifest?.id ?? null, name: p.manifest?.name ?? folder, version: p.manifest?.version ?? null,
    lifecycle: p.lifecycle, dataDir: relative(ROOT, data), data: sizeOf(data), dataExists: existsSync(data),
    stateEntry: Object.prototype.hasOwnProperty.call(state, folder) ? state[folder] : null,
    hasHooks: existsSync(join(p.dir, 'hooks.mjs')), hasInstallScript: existsSync(join(p.dir, 'install.mjs')), hasUninstallScript: existsSync(join(p.dir, 'uninstall.mjs')),
    references: { managed: refs.filter((r) => r.managed), stale: refs.filter((r) => !r.managed) },
    backups: existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((n) => n.startsWith(`${folder}-`)).sort().reverse() : [],
    installed: p.present && existsSync(data),
  };
}

export function list() {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR).filter((n) => !n.startsWith('_') && existsSync(join(PLUGINS_DIR, n, 'plugin.json'))).map((f) => {
    try { const p = readManifest(f); return { folder: f, id: p.manifest.id, name: p.manifest.name, version: p.manifest.version, dataDir: p.lifecycle.dataDir, lifecycle: !!p.manifest.lifecycle, scripts: existsSync(join(p.dir, 'uninstall.mjs')) }; }
    catch (e) { return { folder: f, error: e.message }; }
  });
}

export async function install(folder, { noState = false } = {}, log = () => {}) {
  const p = readManifest(folder);
  if (!p.present) throw new Error(`plugin ${folder} is not in apps/console-web/plugins (its code must be there first, e.g. from a git pull)`);
  const data = safeDataDir(p);
  mkdirSync(data, { recursive: true, mode: 0o700 });
  try { chmodSync(data, 0o700); } catch { /* not ours */ }
  log(`data folder ${relative(ROOT, data)} ready`);
  const h = await hooks(p);
  if (h.onInstall) { await h.onInstall(ctxFor(p, log)); log('onInstall hook ran'); }
  if (!noState) { writeState((s) => { s.plugins = { ...(s.plugins ?? {}), [folder]: true }; }); log('enabled in the console state'); }
  const checks = h.checks ? await h.checks(ctxFor(p, log)) : [];
  return { installed: true, checks };
}

/** The plugin's declared self-checks (hooks.mjs → checks(ctx)), without installing anything. */
export async function runChecks(folder) {
  const p = readManifest(folder);
  if (!p.present) throw new Error(`plugin ${folder} is not in apps/console-web/plugins`);
  const h = await hooks(p);
  if (!h.checks) return { folder, checks: [], declared: false };
  const raw = await h.checks(ctxFor(p, () => {}));
  const checks = (Array.isArray(raw) ? raw : []).slice(0, 50).map((c) => ({ id: String(c?.id ?? '').slice(0, 64), ok: c?.ok !== false, detail: String(c?.detail ?? '').slice(0, 500) })).filter((c) => /^[a-z0-9][a-z0-9._-]*$/i.test(c.id));
  return { folder, checks, declared: true };
}

function backup(p, data, log) {
  if (!existsSync(data)) return null;
  mkdirSync(BACKUPS, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(BACKUPS, `${p.folder}-${stamp}.tar.gz`);
  const r = spawnSync('tar', ['-czf', out, '-C', dirname(data), relative(dirname(data), data)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`backup failed: ${(r.stderr || '').trim()}`);
  chmodSync(out, 0o600);
  log(`backed up data to ${relative(ROOT, out)}`);
  return relative(ROOT, out);
}

export async function uninstall(folder, opts = {}, log = () => {}) {
  const all = !!opts.all;
  const doData = all || !!opts.data || (!opts.data && !opts.code);
  const doCode = all || !!opts.code;
  const dry = !!opts.dryRun;
  const p = readManifest(folder);
  const data = safeDataDir(p);
  const result = { folder, dry, data: false, code: false, state: false, mentions: 0, backup: null, published: null, stale: [] };

  if (doData) {
    const h = p.present ? await hooks(p) : {};
    if (h.onUninstall && !dry) { await h.onUninstall(ctxFor(p, log)); log('onUninstall hook ran'); }
    if (existsSync(data)) {
      const s = sizeOf(data);
      if (dry) log(`would delete ${relative(ROOT, data)} (${s.files} files, ${s.bytes} bytes)${opts.backup === false ? '' : ' after backing it up'}`);
      else {
        if (opts.backup !== false) result.backup = backup(p, data, log);
        rmSync(data, { recursive: true, force: true });
        log(`deleted ${relative(ROOT, data)}`);
      }
      result.data = true;
    } else log(`no data folder (${relative(ROOT, data)})`);
    if (!opts.noState) {
      if (doCode) {
        const had = Object.prototype.hasOwnProperty.call(readState().plugins ?? {}, folder);
        if (had) { if (!dry) writeState((s) => { delete s.plugins[folder]; }); log(`${dry ? 'would remove' : 'removed'} its console state entry`); result.state = true; }
      } else {
        // Code stays: keep it switched OFF so it doesn't come back enabled by default and recreate its data. Install turns it on.
        if (!dry) writeState((s) => { s.plugins = { ...(s.plugins ?? {}), [folder]: false }; });
        log(`${dry ? 'would disable' : 'disabled'} it (code kept; run install to turn it back on)`);
        result.state = true;
      }
    }
  }

  if (doCode) {
    if (opts.publish) {
      if (dry) log('would commit the removal and push it to GitHub with GITHUB_TOKEN');
      else result.published = publishRemoval(p, log);
    }
    result.mentions = stripMentions(p, dry, log);
    if (p.present) {
      if (dry) log(`would delete apps/console-web/plugins/${folder}/ (${sizeOf(p.dir).files} files)`);
      else { rmSync(p.dir, { recursive: true, force: true }); log(`deleted apps/console-web/plugins/${folder}/`); }
      result.code = true;
    } else log('plugin code already gone');
    if (!dry) {
      result.stale = scanReferences({ ...p, present: false }).filter((r) => !r.managed);
      log(result.stale.length ? `${result.stale.length} stale reference(s) remain — see the list` : 'stale check: nothing left behind');
      if (!opts.publish) log('code removed in this clone only: commit and push (or re-run with --publish) so other clones drop it too');
    }
  }
  return result;
}

/** Commit the folder removal (+ stripped doc lines) in a temporary worktree of origin's branch and push it. */
function publishRemoval(p, log) {
  return publishToSource((wt, git) => {
    const rel = `apps/console-web/plugins/${p.folder}`;
    if (existsSync(join(wt, rel))) git(['-C', wt, 'rm', '-r', '-q', '--', rel]);
    for (const mm of p.lifecycle.mentions ?? []) {
      const f = resolve(wt, mm);
      if (!f.startsWith(wt + '/') || !existsSync(f)) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      const kept = lines.filter((l) => !l.includes(`axf-plugin:${p.folder}`));
      if (kept.length !== lines.length) { writeFileSync(f, kept.join('\n')); git(['-C', wt, 'add', '--', mm]); }
    }
  }, `Uninstall plugin ${p.manifest?.name ?? p.folder} (${p.folder}): remove its code and doc lines (plugin-lifecycle)`, log, 'GitHub already has this removal');
}

/**
 * Commit a plugin folder that is in this clone (e.g. just installed from the plugin catalog) to the repo on GitHub,
 * so the 5-minute reset keeps it and every clone gets it. Only that folder is committed; nothing else in the clone.
 */
export function publishAddition(folder, message, log = () => {}) {
  const p = readManifest(folder);
  if (!p.present) throw new Error(`apps/console-web/plugins/${folder} is not in this clone`);
  return publishToSource((wt, git) => {
    const rel = `apps/console-web/plugins/${folder}`;
    rmSync(join(wt, rel), { recursive: true, force: true });
    cpSync(p.dir, join(wt, rel), { recursive: true, verbatimSymlinks: true, filter: (src) => !SKIP_DIRS.has(src.split('/').pop()) });
    git(['-C', wt, 'add', '-A', '--', rel]);
  }, message || `Install plugin ${p.manifest?.name ?? folder} (${folder}) from the plugin catalog`, log, 'GitHub already has this plugin as installed');
}

/** Run `change(worktree, git)` in a temporary worktree of origin's current branch, then commit and push it. */
function publishToSource(change, message, log, already) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('publishing needs GITHUB_TOKEN with Contents: write on the repo');
  const git = (args, o = {}) => {
    const r = spawnSync('git', ['-c', 'safe.directory=*', ...args], { encoding: 'utf8', timeout: 120000, cwd: o.cwd, env: { ...process.env, ...o.env, GIT_TERMINAL_PROMPT: '0' } });
    if (r.status !== 0 && !o.ok) throw new Error(scrub(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`, [token]));
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  const m = git(['-C', ROOT, 'remote', 'get-url', 'origin']).out.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/);
  if (!m) throw new Error('could not read the repo\'s GitHub origin');
  const slug = m[1];
  const branch = process.env.AXF_LIFECYCLE_BRANCH || git(['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (!branch || branch === 'HEAD') throw new Error('publishing needs a checked-out branch (this clone is on a detached HEAD)');
  const url = process.env.AXF_LIFECYCLE_PUSH_URL || `https://github.com/${slug}.git`;
  const tmp = mkdtempSync(join(tmpdir(), 'axf-lifecycle-'));
  // lib-github: the token reaches git only through GIT_CONFIG_* (header scoped to https://github.com/, no redirects)
  const auth = { env: gitAuthEnv(token) };
  const wt = join(tmp, 'wt');
  try {
    git(['-C', ROOT, 'fetch', '-q', url, branch], auth);
    git(['-C', ROOT, 'worktree', 'add', '-q', '--detach', wt, 'FETCH_HEAD']);
    change(wt, git);
    if (git(['-C', wt, 'diff', '--cached', '--quiet'], { ok: true }).ok) { log(already); return { pushed: false }; }
    git(['-C', wt, '-c', 'user.name=AXF Dev Console', '-c', 'user.email=axf-console@users.noreply.github.com', 'commit', '-q', '-m', message]);
    for (let i = 0; i < 3; i++) {
      const r = git(['-C', wt, 'push', '-q', url, `HEAD:refs/heads/${branch}`], { ...auth, ok: true });
      if (r.ok) { const sha = git(['-C', wt, 'rev-parse', '--short', 'HEAD']).out; log(`pushed ${sha} to ${slug} ${branch}`); return { pushed: true, sha }; }
      if (/denied|403|401|not permitted|authentication/i.test(r.err)) throw new Error('GitHub refused the push: GITHUB_TOKEN needs Contents: write');
      git(['-C', wt, 'fetch', '-q', url, branch], auth);
      git(['-C', wt, 'rebase', '-q', 'FETCH_HEAD']);
    }
    throw new Error('could not push after 3 tries; try again');
  } finally {
    git(['-C', ROOT, 'worktree', 'remove', '--force', wt], { ok: true });
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function check(folder, { afterUninstall = false } = {}) {
  const p = readManifest(folder);
  const refs = scanReferences(p);
  const stale = refs.filter((r) => !r.managed);
  const problems = [];
  if (afterUninstall) {
    if (p.present) problems.push(`apps/console-web/plugins/${folder}/ still exists`);
    if (existsSync(safeDataDir(p))) problems.push(`${p.lifecycle.dataDir} still exists`);
    if (Object.prototype.hasOwnProperty.call(readState().plugins ?? {}, folder)) problems.push('console state still has an entry');
    for (const r of refs.filter((x) => x.managed)) problems.push(`managed doc line left in ${r.file}:${r.line}`);
  } else if (p.present) {
    if (!p.manifest.lifecycle) problems.push('plugin.json has no "lifecycle" block (plugin-lifecycle@1)');
    if (!existsSync(join(p.dir, 'install.mjs'))) problems.push('no install.mjs');
    if (!existsSync(join(p.dir, 'uninstall.mjs'))) problems.push('no uninstall.mjs');
  }
  for (const r of stale) problems.push(`stale reference ${r.file}:${r.line}: ${r.text}`);
  return { ok: problems.length === 0, problems, references: refs };
}

export function restore(folder, file) {
  const p = readManifest(folder);
  const abs = resolve(ROOT, file);
  if (!abs.startsWith(BACKUPS + '/')) throw new Error('backups are restored from .axf-console/plugin-backups/ only');
  if (!abs.slice(BACKUPS.length + 1).startsWith(`${folder}-`) || abs.slice(BACKUPS.length + 1).includes('/')) throw new Error(`that backup does not belong to ${folder}`);
  const data = safeDataDir(p);
  if (existsSync(data)) throw new Error(`${p.lifecycle.dataDir} exists; uninstall the data first`);
  mkdirSync(dirname(data), { recursive: true });
  const r = spawnSync('tar', ['-xzf', abs, '-C', dirname(data)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`restore failed: ${(r.stderr || '').trim()}`);
  return { restored: relative(ROOT, data) };
}

/* ------------------------------------------------------------------ CLI */

export async function main(argv, forcedFolder) {
  const flags = {};
  const args = [];
  for (const a of argv) { if (a.startsWith('--')) flags[a.slice(2)] = true; else args.push(a); }
  let [cmd, folder, extra] = args;
  if (forcedFolder) { extra = folder; folder = forcedFolder; }
  const lines = [];
  const log = (m) => { lines.push(m); if (!flags.json) console.log(m); };
  const out = (o) => { if (flags.json) console.log(JSON.stringify({ ok: true, ...o, log: lines })); else if (o && !o.log) console.log(JSON.stringify(o, null, 2)); };
  try {
    if (cmd === 'list') return out({ items: list() });
    if (!folder) throw new Error('usage: plugin-lifecycle.mjs <status|install|uninstall|check|checks|restore> <folder> [flags]');
    if (cmd === 'status') return out(status(folder));
    if (cmd === 'install') return out(await install(folder, { noState: !!flags['no-state'] }, log));
    if (cmd === 'uninstall') {
      const r = await uninstall(folder, { all: !!flags.all, data: !!flags.data, code: !!flags.code, publish: !!flags.publish, backup: !flags['no-backup'], dryRun: !!flags['dry-run'], noState: !!flags['no-state'] }, log);
      out(r);
      if (r.stale.length && !flags.json) { console.error('stale references:'); for (const s of r.stale) console.error(`  ${s.file}:${s.line}  ${s.text}`); process.exitCode = 1; }
      return;
    }
    if (cmd === 'check') {
      const r = check(folder, { afterUninstall: !!flags['after-uninstall'] });
      if (flags.json) console.log(JSON.stringify({ ok: true, ...r }));
      else { console.log(r.ok ? `✓ ${folder}: clean` : `✗ ${folder}:\n  ${r.problems.join('\n  ')}`); }
      if (!r.ok) process.exitCode = 1;
      return;
    }
    if (cmd === 'checks') return out(await runChecks(folder));
    if (cmd === 'restore') return out(restore(folder, extra));
    throw new Error(`unknown command "${cmd}"`);
  } catch (e) {
    if (flags.json) console.log(JSON.stringify({ ok: false, error: e.message, log: lines }));
    else console.error(`plugin-lifecycle: ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
