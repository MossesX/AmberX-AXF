/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (settings, pins, pick log and topics live here)`); }
export async function onUninstall(ctx) { ctx.log('removing menu learning, pins, settings and topics; menus go back to plain static menus'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
