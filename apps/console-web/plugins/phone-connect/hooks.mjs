/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes stays inside ctx.dataDir (data-store@1 namespace `phone`). */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  for (const d of ['devices', 'pairings', 'commands']) mkdirSync(join(ctx.dataDir, d), { recursive: true });
  ctx.log(`ready: ${ctx.dataDir}`);
}
export async function onUninstall(ctx) { ctx.log('removing Phone Connect data: paired phones lose their device tokens'); }
export async function checks(ctx) {
  return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }];
}
