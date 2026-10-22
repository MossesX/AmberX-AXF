/** Lifecycle hooks (plugin-lifecycle@1) for the push banner. Everything stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: the banner lists branches not on main on the next console load (needs GITHUB_TOKEN on the console server)'); }
export async function onUninstall(ctx) { ctx.log('removing the watched repos and hidden branches'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
