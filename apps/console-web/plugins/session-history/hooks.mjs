/** Lifecycle hooks (plugin-lifecycle@1). The session browser only reads; its data folder holds config.json + killed.json. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removes config.json and killed.json only; transcripts, stream logs and reports are never touched'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
