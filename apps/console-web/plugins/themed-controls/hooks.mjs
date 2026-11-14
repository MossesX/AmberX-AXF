/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes stays in ctx.dataDir (settings.json, live.json). */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) { mkdirSync(ctx.dataDir, { recursive: true }); ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the themed controls data (switches and the last live report); every control is native again'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
