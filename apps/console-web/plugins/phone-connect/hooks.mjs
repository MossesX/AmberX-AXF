/** Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes stays inside ctx.dataDir. */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  for (const sub of ['recorder', 'commands']) mkdirSync(join(ctx.dataDir, sub), { recursive: true });
  ctx.log(`ready: ${ctx.dataDir}`);
}
export async function onUninstall(ctx) { ctx.log('removing Phone Connect data (devices, pairings, command queue, rules, recorder index)'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'notify-types', ok: existsSync(new URL('./notify.json', import.meta.url)), detail: 'notify.json' },
  ];
}
