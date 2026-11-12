/** Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (display setting, AmberX delivery record)`); }
export async function onUninstall(ctx) { ctx.log('removing the Auto-fixes display setting and delivery record (the framework ledger stays)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
