/** Lifecycle hooks (plugin-lifecycle@1). Reference links keeps no data of its own; the folder is there for the contract. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('reference links keeps no data; banner text goes back to plain text'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
