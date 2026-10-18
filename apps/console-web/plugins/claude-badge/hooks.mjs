/** Lifecycle hooks (plugin-lifecycle@1) for the Claude badge. Everything stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: the Claude badge appears on the banner on the next console load'); }
export async function onUninstall(ctx) { ctx.log('removing the last AI connection result; the banner and its asset types stay'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
