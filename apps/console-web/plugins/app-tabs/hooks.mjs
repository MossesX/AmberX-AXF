/** Lifecycle hooks (plugin-lifecycle@1). App tabs stores its choices as settings in the browser; nothing on the server. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('nothing to remove: tab choices are browser settings'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
