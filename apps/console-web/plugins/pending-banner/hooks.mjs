/** Lifecycle hooks (plugin-lifecycle@1) for the Pending banner. Everything stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: the Pending banner shows on the next console load whenever builds wait in Pending'); }
export async function onUninstall(ctx) { ctx.log('removing the seen-builds file; builds stay where they are'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
