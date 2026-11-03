#!/usr/bin/env node
/**
 * The plugin commands registry from the files (plugin-commands@1, framework/core/engines/plugin-commands.mjs): reads
 * every app's plugins (plugin.json, server/*.py, web sources) and builds the registry, and checks a plugin's coverage
 * (what plugin-lifecycle.mjs check and CI run). The transports (REST, MCP, CLI runner) are the Plugin commands
 * plugin's; this is the part the framework owns, so a plugin is checked even when that plugin is not installed.
 *
 *   node framework/cli/plugin-commands.mjs check [folder…] [--json]     every console plugin (or the ones named)
 *   node framework/cli/plugin-commands.mjs registry [--json]            the whole registry
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginCommandCoverage, pluginCommandRegistry, scanPythonRoutes, scanWebActions } from '../core/engines/plugin-commands.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

function* files(dir, test, depth = 0) {
  if (depth > 4 || !existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p, test, depth + 1);
    else if (test(e.name)) yield p;
  }
}

/** Where each app keeps its plugins. Only the console's run here; the others are listed (their app runs them). */
export const PLUGIN_HOMES = [
  { app: 'console-web', dir: 'apps/console-web/plugins' },
  { app: 'amberx-droid', dir: 'apps/amberx-droid/src/plugins' },
  { app: 'axhub-web', dir: 'apps/axhub-web/src/plugins' },
];
/* ------------------------------------------------------------------ reading plugins */


/** One plugin's facts for the engine: manifest, routes, actions, whether it has a data folder. */
export function readPlugin(app, dir, folder) {
  const base = join(ROOT, dir, folder);
  const manifest = readJson(join(base, 'plugin.json')) ?? {};
  const routes = []; const unread = [];
  for (const f of files(join(base, 'server'), (n) => n.endsWith('.py') && !n.startsWith('test_') && n !== 'conftest.py')) {
    const r = scanPythonRoutes(read(f), relative(base, f));
    routes.push(...r.routes); unread.push(...r.unread);
  }
  const actions = [];
  for (const f of files(join(base, 'web'), (n) => /\.(tsx?|mjs|js)$/.test(n) && !n.endsWith('.d.ts') && !n.endsWith('.d.mts') && !/\.test\./.test(n))) actions.push(...scanWebActions(read(f), relative(base, f)));
  const seen = new Set();
  return { folder, app, dir: join(dir, folder), manifest, routes, unread, actions: actions.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))), hasData: typeof manifest.lifecycle?.dataDir === 'string' && !!manifest.lifecycle.dataDir };
}

/** Every plugin of every app (folders with a plugin.json; `_template` and dotted folders are not plugins). */
export function readPlugins({ apps = null, folders = null } = {}) {
  const out = [];
  for (const h of PLUGIN_HOMES) {
    if (apps && !apps.includes(h.app)) continue;
    const d = join(ROOT, h.dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort()) {
      if (f.startsWith('_') || f.startsWith('.') || !existsSync(join(d, f, 'plugin.json'))) continue;
      if (folders && !folders.includes(f)) continue;
      out.push(readPlugin(h.app, h.dir, f));
    }
  }
  return out;
}

/** The registry. `enabled` = { folder: bool } from the console (turned-off plugins are listed, never run). */
export function registry({ enabled = null, apps = null, folders = null } = {}) {
  return pluginCommandRegistry(readPlugins({ apps, folders }).map((p) => ({ ...p, enabled: enabled && p.app === 'console-web' ? enabled[p.folder] !== false : true })));
}

/** Coverage of console plugins: [{ folder, ok, errors, warnings, reads, commands }]. */
export function coverage(folders = null) {
  return registry({ folders, apps: ['console-web'] }).plugins.map((p) => ({ folder: p.folder, ...pluginCommandCoverage(p) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const [cmd = 'check', ...rest] = argv.filter((a) => a !== '--json');
  if (cmd === 'registry') console.log(JSON.stringify(registry(), null, json ? 0 : 2));
  else if (cmd === 'check') {
    const res = coverage(rest.length ? rest : null);
    if (json) console.log(JSON.stringify(res, null, 2));
    else for (const x of res) console.log(`${x.ok ? '✓' : '✗'} ${x.folder.padEnd(24)} ${x.reads} reads · ${x.commands} commands${x.errors.length ? `\n${x.errors.map((e) => `    ✗ ${e}`).join('\n')}` : ''}`);
    if (!rest.length && !json) console.log(`${res.filter((x) => x.ok).length}/${res.length} plugins expose every command and read (plugin-commands@1)`);
    process.exitCode = res.every((x) => x.ok) ? 0 : 1;
  } else { console.error('usage: plugin-commands.mjs check [folder…] | registry  [--json]'); process.exitCode = 2; }
}
