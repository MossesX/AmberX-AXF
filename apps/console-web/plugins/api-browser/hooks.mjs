/** Lifecycle hooks (plugin-lifecycle@1): the API Browser keeps only a cache of the generated registry in its data folder. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (registry cache)`); }
export async function onUninstall(ctx) { ctx.log('removing the API Browser registry cache'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
