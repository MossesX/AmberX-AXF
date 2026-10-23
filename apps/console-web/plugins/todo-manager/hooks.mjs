/** Lifecycle hooks (plugin-lifecycle@1). Everything the Todo manager writes is store.json in ctx.dataDir. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the Todo manager data (every list and entry)'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'store', ok: true, detail: existsSync(join(ctx.dataDir, 'store.json')) ? 'store.json present' : 'no lists yet' },
  ];
}
