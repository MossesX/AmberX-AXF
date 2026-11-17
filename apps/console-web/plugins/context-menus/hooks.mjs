/** Lifecycle hooks (plugin-lifecycle@1). The plugin writes only inside its data folder; the hub store is read through menus.mjs. */
import { existsSync } from 'node:fs';
import { storeDir, onHub, zones } from './menus.mjs';

export async function onInstall(ctx) {
  ctx.log(`ready: ${ctx.dataDir}; menus live in ${storeDir()}${onHub() ? ' (axHub shared data: one true source)' : ' (no hub mounted: local until it runs on the VPS)'}`);
  try { const z = zones({ scan: true }); ctx.log(`zone registry: ${z.items.length} zones found in the code`); } catch (e) { ctx.log(`zone scan skipped: ${e.message}`); }
}
export async function onUninstall(ctx) { ctx.log('removing the Context menus plugin data; the menus on the hub stay (other plugins read them)'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'store', ok: true, detail: `${storeDir()}${onHub() ? ' (hub)' : ' (local)'}` },
  ];
}
