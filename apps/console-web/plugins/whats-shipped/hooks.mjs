/** Lifecycle hooks (plugin-lifecycle@1) for What's new. Everything stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: the What\'s new widget appears on the banner on the next console load'); }
export async function onUninstall(ctx) { ctx.log('removing the feed cache, file lists and settings; read marks stay in each browser until cleared'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
