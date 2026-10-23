/** Lifecycle hooks (plugin-lifecycle@1) for the main build status. Everything stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: the build status dot appears on the banner on the next console load (needs GITHUB_TOKEN on the console server)'); }
export async function onUninstall(ctx) { ctx.log('removing the watched-repos setting; the banner and its widget types stay'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
