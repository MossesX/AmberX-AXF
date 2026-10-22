#!/usr/bin/env node
// bake-banner-plugins — copy the Dev Console's banner plugins' web parts into Patches (Brett, Oct 22 2026: "port all
// the banner plugins to Patches and install them; remove all banner plugins from console and pilot").
//
//   node apps/patches-web/scripts/bake-banner-plugins.mjs [--check]
//
// Patches runs these plugins' banners above every tab; their server parts stay in the console (they read its data and
// its host), reached through Patches' own server (`/api/console/...`, server/main.py), which holds the console token.
// The console itself draws no plugin banners any more. The plugins' code stays in one place
// (apps/console-web/plugins/<folder>/web): this script copies it, the way `axf init` bakes the framework, and records a
// sha256 prefix of every baked file in plugins.lock.json, so `--check` tells whether a baked file was edited by hand
// (change the plugin, re-bake). Copies:
//   apps/console-web/plugins/<folder>/{plugin.json, web/**}  → src/plugins/<folder>/
//   apps/console-web/src/commandText.tsx                      → src/console/commandText.tsx (console helper they use)
//   framework/plan/{pending,build-queue}-core.{mjs,d.mts}     → src/axf/plan/ (the build manager reads the queue)
// One rewrite while copying: a plugin's own routes `/api/plugins/<folder>/` become `/api/console/plugins/<folder>/`
// (Patches' proxy); `@console/...` imports resolve to src/console (Patches' stand-ins) and src/axf (vite.config.ts).
// approvals-banner is Patches' own (it moved here: it was only a banner), so it is not baked.
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '..', '..');
const LOCK = join(app, 'plugins.lock.json');
const check = process.argv.includes('--check');

/** The console plugins whose banners Patches runs (every plugin that contributes a banner). */
export const BANNER_PLUGINS = ['activity', 'build-manager', 'claude-handoff', 'codebase-changes', 'push-banner', 'systems-check'];

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const TEXT = /\.(tsx?|mjs|mts|css|json)$/;
const rewrite = (text) => text.replace(/([`'"])\/api\/plugins\//g, '$1/api/console/plugins/');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** dest (relative to the app) → contents, for everything the bake writes. */
function plan() {
  const files = new Map();
  for (const folder of BANNER_PLUGINS) {
    const src = join(repo, 'apps/console-web/plugins', folder);
    // a plugin uninstalled from the console isn't baked (its copy goes with the next bake)
    if (!existsSync(join(src, 'plugin.json'))) { console.warn(`console plugin not present, skipped: ${folder}`); continue; }
    files.set(`src/plugins/${folder}/plugin.json`, readFileSync(join(src, 'plugin.json')));
    for (const f of walk(join(src, 'web'))) {
      const rel = relative(src, f);
      const buf = readFileSync(f);
      files.set(`src/plugins/${folder}/${rel}`, TEXT.test(f) ? Buffer.from(rewrite(buf.toString('utf8'))) : buf);
    }
  }
  const cmd = readFileSync(join(repo, 'apps/console-web/src/commandText.tsx'), 'utf8').replace("from './axf/react'", "from '../axf/react'");
  files.set('src/console/commandText.tsx', Buffer.from(cmd));
  for (const f of ['pending-core.mjs', 'pending-core.d.mts', 'build-queue-core.mjs', 'build-queue-core.d.mts']) files.set(`src/axf/plan/${f}`, readFileSync(join(repo, 'framework/plan', f)));
  return files;
}

if (check) {
  if (!existsSync(LOCK)) { console.error('no plugins.lock.json: run the bake first'); process.exit(2); }
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const want = plan();
  let bad = 0;
  for (const [dest, hash] of Object.entries(lock.files)) {
    const p = join(app, dest);
    if (!existsSync(p)) { console.error(`missing baked file: ${dest}`); bad++; }
    else if (sha(readFileSync(p)) !== hash) { console.error(`baked file edited: ${dest} (change the console plugin and re-bake instead)`); bad++; }
  }
  for (const dest of Object.keys(lock.files)) if (!want.has(dest)) { console.error(`no longer baked: ${dest} (its console plugin is gone: re-bake)`); bad++; }
  for (const [dest, buf] of want) if (lock.files[dest] !== sha(buf)) { console.error(`out of date: ${dest} (the console plugin changed: re-bake)`); bad++; }
  console.log(bad ? `${bad} problem(s)` : `plugins.lock.json: ${Object.keys(lock.files).length} baked files current`);
  process.exit(bad ? 1 : 0);
}

for (const folder of BANNER_PLUGINS) rmSync(join(app, 'src/plugins', folder), { recursive: true, force: true });
const files = plan();
const hashes = {};
for (const [dest, buf] of files) {
  const p = join(app, dest);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  hashes[dest] = sha(buf);
}
let commit = 'unknown';
try { commit = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim(); } catch { /* no git */ }
writeFileSync(LOCK, JSON.stringify({ $axf: 'patches-plugins-lock@1', plugins: BANNER_PLUGINS.filter((f) => existsSync(join(app, 'src/plugins', f))), commit, files: hashes }, null, 2) + '\n');
console.log(`baked ${BANNER_PLUGINS.length} banner plugins (${files.size} files) into apps/patches-web; plugins.lock.json written`);
