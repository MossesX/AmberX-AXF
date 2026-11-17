/**
 * Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes stays inside ctx.dataDir, except the build rules
 * store: that one is framework data (build-rules@1, framework/core/build-rules.mjs; on the VPS
 * /projects/amberx-axf/_data/build-rules, data.shared `build-rules/`), read by the dispatcher whether or not this plugin
 * is installed. Install seeds it once from the repo seed when it is missing; uninstall leaves it (and its runs.jsonl)
 * where it is, so removing the tab never drops a rule. The dispatcher and the lander simply stop finding the runner.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const storeLine = async () => { try { const BR = await import('../../../../framework/core/build-rules.mjs'); const l = BR.load(); return { ok: true, live: !l.seeded && !l.empty, path: l.path, rules: l.store.rules.length }; } catch (e) { return { ok: false, error: String(e.message || e) }; } };

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  ctx.log(`ready: ${ctx.dataDir} (rules are migrated from the lander settings on first read)`);
  const r = spawnSync(process.execPath, [join(ROOT, 'framework/cli/build-rules-migrate.mjs'), '--live'], { cwd: ROOT, encoding: 'utf8' });
  ctx.log(`build rules store: ${(r.stdout || r.stderr || '').trim().split('\n').pop()}`);
}
export async function onUninstall(ctx) {
  ctx.log('removing the gate rules and history (the lander keeps its own settings)');
  const s = await storeLine();
  ctx.log(`build rules store kept${s.path ? ` at ${s.path}` : ''}: framework data the dispatcher still reads; the Build rules tab, its REST routes, MCP tools, CLI and voice actions go with the plugin`);
}
export async function checks(ctx) {
  const s = await storeLine();
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'build-rules-store', ok: s.ok && s.rules > 0, detail: s.ok ? `${s.live ? 'live' : 'seed only'}: ${s.path} (${s.rules} rules)` : s.error },
  ];
}
