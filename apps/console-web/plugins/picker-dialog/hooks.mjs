/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (drop-downs open the picker dialog while the plugin is on)`); }
export async function onUninstall(ctx) { ctx.log('removing the picker dialog data; drop-downs go back to the original controls'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
