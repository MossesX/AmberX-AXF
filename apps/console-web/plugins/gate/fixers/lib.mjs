/**
 * Shared helpers for the gate's build-rule fixers (build-rules@1, framework/spec/BUILD-RULES.md).
 *
 * A fixer is a module with `id`, `check(ctx)` and `fix(ctx, { dryRun })`. Both answer a result:
 *   { ok, fixer, detail, missing?: string[], planned?: string[], changed?: string[], unfixable?: string }
 * `ctx` is { root, build?: { id, title, text, branch, pr, plugins? }, plugins?: string[], env? }. `plugins` limits the
 * work to those plugin folders; empty = every plugin. A fixer is idempotent: a second run changes nothing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DIR = fileURLToPath(new URL('..', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));
export const PLUGINS_REL = 'apps/console-web/plugins';

export const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
export const readText = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

/** Write when the content differs; → true when written. */
export function writeIfChanged(f, text) {
  if (readText(f) === text) return false;
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, f);
  return true;
}
export const jsonText = (v) => `${JSON.stringify(v, null, 2)}\n`;

export const rootOf = (ctx = {}) => ctx.root || REPO_ROOT;
export const pluginsRoot = (ctx = {}) => join(rootOf(ctx), PLUGINS_REL);

/**
 * Plugin folders in scope: ctx.plugins, else ctx.build.plugins when the build says which it touched (an empty list =
 * none), else every folder with a plugin.json (no _template).
 */
export function pluginFolders(ctx = {}) {
  const want = [...(ctx.plugins || []), ...(ctx.build?.plugins || [])].filter(Boolean);
  if (!want.length && Array.isArray(ctx.build?.plugins)) return [];
  const base = pluginsRoot(ctx);
  let all = [];
  try { all = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(base, d.name, 'plugin.json'))).map((d) => d.name).sort(); } catch { /* no plugins */ }
  return want.length ? all.filter((p) => want.includes(p)) : all;
}

/** One plugin's manifest and folder. */
export function plugin(ctx, folder) {
  const dir = join(pluginsRoot(ctx), folder);
  return { folder, dir, manifest: readJson(join(dir, 'plugin.json')) || {} };
}

/** The plugin-commands@1 items of a manifest. */
export const commandsOf = (m) => (Array.isArray(m?.commands?.items) ? m.commands.items : []);

/** A result in the one shape every fixer answers. */
export function result(fixer, fields) {
  const r = { fixer, ok: true, detail: '', missing: [], planned: [], changed: [], ...fields };
  if (!r.detail) r.detail = r.ok ? 'nothing to do' : (r.unfixable || `${r.missing.length} missing`);
  return r;
}

/** Run a fixer from the command line: node <fixer> [check|fix] [--dry-run] [--plugin a,b] [--json]. */
export async function cli(mod, argv = process.argv.slice(2)) {
  const mode = argv[0] === 'fix' ? 'fix' : 'check';
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : ''; };
  const ctx = { plugins: (flag('--plugin') || '').split(',').filter(Boolean), build: flag('--build') ? { id: flag('--build') } : undefined };
  const r = mode === 'fix' ? await mod.fix(ctx, { dryRun: argv.includes('--dry-run') }) : await mod.check(ctx);
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else console.log(`${r.ok ? 'ok' : 'FAIL'} ${r.fixer}: ${r.detail}${[...r.missing, ...r.planned, ...r.changed].map((x) => `\n  ${x}`).join('')}`);
  process.exitCode = r.ok ? 0 : 1;
}
