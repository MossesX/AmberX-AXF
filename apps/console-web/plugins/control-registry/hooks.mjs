/** Lifecycle hooks (plugin-lifecycle@1). The only file the plugin writes is the page state, inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the Registry page state'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
