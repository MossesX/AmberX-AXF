/** Lifecycle hooks (plugin-lifecycle@1). The only file the plugin writes is icons.json in ctx.dataDir (the pack in force + per-slot picks). */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`icon map state folder ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the icon map state (pack pick and per-slot picks)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
