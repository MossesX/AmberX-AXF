#!/usr/bin/env node
/**
 * rebake — find apps whose baked framework copy (src/axf/{core,react,ui,schemas}, written by `axf init`) is behind
 * the framework, and re-bake them.
 *
 *   node framework/cli/rebake.mjs [status] [--json]          every baked app: current / stale (what differs) / edited
 *   node framework/cli/rebake.mjs apply <app dir> [--json]   copy the framework in again + rewrite axf.lock.json
 *   node framework/cli/rebake.mjs publish <app dir> [--json] apply in a temporary worktree of origin's main, push branch
 *                                                           rebake/<app> and open (or reuse) a pull request (GITHUB_TOKEN)
 *
 * An app is found by its axf.lock.json naming baked files under src/axf/core/. A baked file whose hash no longer
 * matches the lock was edited in the app: the app is "edited" and is never re-baked automatically (the edit would be
 * lost; move it into the framework first). Apps without baked files (Android) are skipped.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGitHub, gitAuthEnv, repoPath, scrub, validRepo } from './github.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BAKED = ['core', 'react', 'ui', 'schemas'];
const BAKE_DIR = 'src/axf';
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const posix = (p) => p.split(sep).join('/');

/**
 * rel path under src/axf → hash, for the framework (what a bake would write) or an app's copy: the baked folders plus the
 * libraries the app has (`libs/<name>`, put there by `axf install`), so a re-bake never leaves an app's libraries behind.
 */
function tree(base, libs = []) {
  const out = {};
  for (const d of BAKED) for (const f of walk(join(base, d))) out[posix(relative(base, f))] = sha(f);
  for (const n of libs) {
    const p = join(base, 'libs', n);
    if (!existsSync(p)) continue;
    for (const f of statSync(p).isDirectory() ? walk(p) : [p]) out[posix(relative(base, f))] = sha(f);
  }
  return out;
}

/** The libraries (and libs/ files) an app has baked in that the framework still ships. */
function appLibs(appDir, root) {
  const d = join(appDir, BAKE_DIR, 'libs');
  return existsSync(d) ? readdirSync(d).filter((n) => existsSync(join(root, 'framework', 'libs', n))).sort() : [];
}

/** Every app dir (relative to root) with a lock naming baked files. */
export function bakedApps(root = ROOT) {
  const apps = join(root, 'apps');
  return (existsSync(apps) ? readdirSync(apps) : []).filter((n) => {
    const lock = join(apps, n, 'axf.lock.json');
    if (!existsSync(lock)) return false;
    try { return Object.keys(JSON.parse(readFileSync(lock, 'utf8')).files ?? {}).some((k) => k.startsWith(`${BAKE_DIR}/core/`)); } catch { return false; }
  }).map((n) => `apps/${n}`);
}

/** One app's state against the framework. */
export function appStatus(dir, root = ROOT) {
  const appDir = resolve(root, dir);
  const name = posix(relative(root, appDir));
  let lock;
  try { lock = JSON.parse(readFileSync(join(appDir, 'axf.lock.json'), 'utf8')); } catch (e) { return { dir: name, state: 'error', error: `axf.lock.json unreadable: ${e.message}` }; }
  const libs = appLibs(appDir, root);
  const want = tree(join(root, 'framework'), libs);
  const have = tree(join(appDir, BAKE_DIR), libs);
  const changed = [], missing = [], extra = [], edited = [];
  for (const [rel, h] of Object.entries(want)) { if (!(rel in have)) missing.push(rel); else if (have[rel] !== h) changed.push(rel); }
  for (const rel of Object.keys(have)) if (!(rel in want)) extra.push(rel);
  for (const [rel, h] of Object.entries(lock.files ?? {})) {
    if (!rel.startsWith(`${BAKE_DIR}/`)) continue;
    const p = join(appDir, rel);
    if (existsSync(p) && sha(p) !== h) edited.push(rel.slice(BAKE_DIR.length + 1));
  }
  let app = name;
  try { app = JSON.parse(readFileSync(join(appDir, 'axf.manifest.json'), 'utf8')).app?.name || name; } catch { /* keep the folder name */ }
  const stale = changed.length + missing.length + extra.length;
  return { dir: name, app, state: edited.length ? 'edited' : stale ? 'stale' : 'current', changed, missing, extra, edited };
}

export function status(root = ROOT) { return bakedApps(root).map((d) => appStatus(d, root)); }

/** Re-bake one app in `root` (copy the framework in, rewrite the lock's baked entries, keep the rest). */
export function apply(dir, root = ROOT, { force = false } = {}) {
  const s = appStatus(dir, root);
  if (s.state === 'error') throw new Error(s.error);
  if (s.state === 'edited' && !force) throw new Error(`${s.dir} has edited baked files (${s.edited.slice(0, 3).join(', ')}): move the edits into the framework first`);
  if (s.state === 'current') return { ...s, rebaked: false };
  const appDir = resolve(root, dir);
  const libs = appLibs(appDir, root);
  for (const d of BAKED) { rmSync(join(appDir, BAKE_DIR, d), { recursive: true, force: true }); cpSync(join(root, 'framework', d), join(appDir, BAKE_DIR, d), { recursive: true }); }
  for (const n of libs) { rmSync(join(appDir, BAKE_DIR, 'libs', n), { recursive: true, force: true }); cpSync(join(root, 'framework', 'libs', n), join(appDir, BAKE_DIR, 'libs', n), { recursive: true }); }
  const lockPath = join(appDir, 'axf.lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const ours = (k) => BAKED.some((d) => k.startsWith(`${BAKE_DIR}/${d}/`)) || libs.some((n) => k === `${BAKE_DIR}/libs/${n}` || k.startsWith(`${BAKE_DIR}/libs/${n}/`));
  const files = Object.fromEntries(Object.entries(lock.files ?? {}).filter(([k]) => !ours(k)));
  for (const [rel, h] of Object.entries(tree(join(appDir, BAKE_DIR), libs))) files[`${BAKE_DIR}/${rel}`] = h;
  lock.files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return { ...s, rebaked: true };
}

/** Re-bake on a branch of origin's default branch and open a pull request; the server checkout is never touched. */
export async function publish(dir, { root = ROOT, base = process.env.AXF_REBAKE_BASE || 'main' } = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('re-baking needs GITHUB_TOKEN with Contents + Pull requests: write on the repo');
  const git = (args, o = {}) => {
    const r = spawnSync('git', ['-c', 'safe.directory=*', ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, ...o.env, GIT_TERMINAL_PROMPT: '0' } });
    if (r.status !== 0 && !o.ok) throw new Error(scrub(`git ${args[2] ?? args[0]} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`, [token]));
    return { ok: r.status === 0, out: (r.stdout || '').trim() };
  };
  const m = git(['-C', root, 'remote', 'get-url', 'origin']).out.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/);
  if (!m || !validRepo(m[1])) throw new Error('could not read the repo\'s GitHub origin');
  const slug = m[1];
  const rel = posix(relative(root, resolve(root, dir)));
  if (!/^apps\/[A-Za-z0-9._-]+$/.test(rel) || rel.includes('..')) throw new Error('app dir must be apps/<name>');
  const app = rel.slice(5);
  const branch = `rebake/${app}`;
  const url = process.env.AXF_REBAKE_PUSH_URL || `https://github.com/${slug}.git`;
  const auth = { env: gitAuthEnv(token) };
  const tmp = mkdtempSync(join(tmpdir(), 'axf-rebake-'));
  const wt = join(tmp, 'wt');
  try {
    git(['-C', root, 'fetch', '-q', url, base], auth);
    git(['-C', root, 'worktree', 'add', '-q', '--detach', wt, 'FETCH_HEAD']);
    const r = apply(rel, wt);
    if (!r.rebaked) return { ...r, pushed: false, note: `${rel} is already current on ${base}` };
    git(['-C', wt, 'add', '-A', '--', rel]);
    const msg = `${app}: re-bake the framework (${r.changed.length} changed, ${r.missing.length} new, ${r.extra.length} removed)`;
    git(['-C', wt, '-c', 'user.name=AXF Dev Console', '-c', 'user.email=axf-console@users.noreply.github.com', 'commit', '-q', '-m', msg]);
    git(['-C', wt, 'push', '-q', '--force', url, `HEAD:refs/heads/${branch}`], auth);
    const gh = createGitHub({ token, userAgent: 'axf-rebake' });
    const [owner] = slug.split('/');
    const open = await gh.get(repoPath(slug, ['pulls'], { head: `${owner}:${branch}`, state: 'open' }));
    const pr = open?.[0] ?? await gh.json('POST', repoPath(slug, ['pulls']), {
      title: msg, head: branch, base,
      body: `Systems check Auto fix: ${rel}'s baked framework (src/axf) was behind ${base}. Copied framework/{${BAKED.join(',')}} in again and rewrote axf.lock.json; nothing else changed.`,
    });
    return { ...r, pushed: true, branch, pr: pr?.html_url ?? null, number: pr?.number ?? null };
  } finally {
    git(['-C', root, 'worktree', 'remove', '--force', wt], { ok: true });
    rmSync(tmp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const [cmd = 'status', dir] = args.filter((a) => !a.startsWith('--'));
  const out = (v) => { if (json) console.log(JSON.stringify(v, null, 2)); return v; };
  try {
    if (cmd === 'status') {
      const s = out(status());
      if (!json) for (const a of s) console.log(`${a.state.padEnd(8)} ${a.dir}${a.state === 'stale' ? `  (${a.changed.length} changed, ${a.missing.length} new, ${a.extra.length} removed)` : a.state === 'edited' ? `  edited: ${a.edited.join(', ')}` : ''}`);
    } else if (cmd === 'apply' && dir) {
      const r = out(apply(dir, ROOT, { force: args.includes('--force') }));
      if (!json) console.log(r.rebaked ? `re-baked ${r.dir}` : `${r.dir} is current`);
    } else if (cmd === 'publish' && dir) {
      const r = out(await publish(dir));
      if (!json) console.log(r.pushed ? `pushed ${r.branch}: ${r.pr}` : r.note);
    } else {
      console.error('usage: rebake.mjs [status] [--json] | apply <app dir> [--force] | publish <app dir>');
      process.exit(2);
    }
  } catch (e) {
    if (json) console.log(JSON.stringify({ error: e.message }));
    else console.error(e.message);
    process.exit(1);
  }
}
