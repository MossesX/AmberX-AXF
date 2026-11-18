/** Lifecycle hooks (plugin-lifecycle@1). Toolbar widgets keeps no data of its own: what is on a toolbar is a look setting (axf.toolbar.<id>.widgets). */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('toolbar widgets keeps no data; the widgets stay on their toolbars (look settings)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
