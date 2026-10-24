/** Lifecycle hooks (plugin-lifecycle@1). Voice notes stores nothing on the console server: everything is on axHub. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: Settings → Plugins → Voice notes (settings and lists are kept on axHub)'); }
export async function onUninstall(ctx) { ctx.log('nothing to remove here: its settings and lists stay on axHub'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
