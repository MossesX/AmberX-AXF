/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps only the view filter and the widget settings in its data
 * folder; uninstalling it removes them, which leaves every builds table showing every profile. The profiles and the
 * active pick are framework data (framework/cli/profiles.mjs) and stay.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('view filter and widget settings go with the data folder; build profiles stay (framework data)'); }
export async function checks(ctx) {
  const root = ctx.root ?? process.cwd();
  return [
    { id: 'profiles-cli', ok: existsSync(join(root, 'framework', 'cli', 'profiles.mjs')), detail: 'framework/cli/profiles.mjs' },
    { id: 'filter-engine', ok: existsSync(join(root, 'framework', 'core', 'engines', 'profile-filter.mjs')), detail: 'framework/core/engines/profile-filter.mjs' },
  ];
}
