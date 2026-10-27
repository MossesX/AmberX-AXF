/**
 * Lifecycle hooks (plugin-lifecycle@1). The profiles themselves (framework/plan/profiles.json, framework/plan/profiles/,
 * _claude/builds/profiles/) are framework data, not this plugin's: uninstall never deletes them, and the CLI
 * (framework/cli/profiles.mjs) keeps working without the plugin.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('build profiles stay (framework data); only the console picker goes'); }
export async function checks(ctx) {
  const root = ctx.root ?? process.cwd();
  return [{ id: 'profiles-cli', ok: existsSync(join(root, 'framework', 'cli', 'profiles.mjs')), detail: 'framework/cli/profiles.mjs' }];
}
