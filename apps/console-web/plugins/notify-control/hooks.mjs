/** Lifecycle hooks (plugin-lifecycle@1). The plugin keeps only config.json in ctx.dataDir. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  ctx.log(`ready: ${ctx.dataDir} (every notification starts as it was)`);
}
export async function onUninstall(ctx) { ctx.log('removing the Notifications panel choices'); }
export async function checks(ctx) {
  const reg = JSON.parse(readFileSync(new URL('./registry.json', import.meta.url), 'utf8'));
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'registry', ok: reg.$axf === 'notify-registry@1' && reg.types.length > 0, detail: `${reg.types.length} types in the registry (plus each plugin's notify.json)` },
    { id: 'config', ok: true, detail: existsSync(join(ctx.dataDir, 'config.json')) ? 'choices saved' : 'all defaults' },
  ];
}
