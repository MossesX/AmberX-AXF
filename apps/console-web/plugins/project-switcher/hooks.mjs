/**
 * Lifecycle hooks (plugin-lifecycle@1). Projects (framework/plan/projects.json) and every project's data are framework
 * and plugin data, not this plugin's: uninstall never deletes them, and the CLI (framework/cli/projects.mjs) and
 * /api/projects keep working without the plugin.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('projects and their data stay (framework data); only the console switcher goes'); }
export async function checks(ctx) {
  const root = ctx.root ?? process.cwd();
  return [{ id: 'projects-cli', ok: existsSync(join(root, 'framework', 'cli', 'projects.mjs')), detail: 'framework/cli/projects.mjs' }];
}
