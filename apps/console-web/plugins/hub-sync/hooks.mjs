/** Lifecycle hooks (plugin-lifecycle@1). axHub sync stores nothing on the console server: the look, settings and data are on axHub. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: Settings → Plugins → axHub sync'); }
export async function onUninstall(ctx) { ctx.log('nothing to remove here: what it synced stays on axHub'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
