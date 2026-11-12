/** Lifecycle hooks (plugin-lifecycle@1). The plugin keeps nothing of its own: the notes are AmberX's, on axHub. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (notes stay in AmberX's store on axHub)`); }
export async function onUninstall(ctx) { ctx.log('removing the Notes screen; AmberX notes are not touched'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
