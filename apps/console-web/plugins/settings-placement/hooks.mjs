/** Lifecycle hooks (plugin-lifecycle@1): the only file it writes is ctx.dataDir/placements.json. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the saved settings placements (each browser keeps its own copy until it is cleared)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
