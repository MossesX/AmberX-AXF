/** Lifecycle hooks (plugin-lifecycle@1). The Crew stores nothing: it reads the headless logs, the builds store and git. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('nothing stored by the Crew'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
