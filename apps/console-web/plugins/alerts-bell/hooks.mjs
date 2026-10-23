/** Lifecycle hooks (plugin-lifecycle@1). The alerts bell stores nothing on the server; its two settings live in the browser. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: the alerts bell appears on the banner on the next console load'); }
export async function onUninstall(ctx) { ctx.log('nothing to remove: the bell keeps no data; the alerts library stays'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
