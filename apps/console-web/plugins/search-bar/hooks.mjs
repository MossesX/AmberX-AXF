/** Lifecycle hooks (plugin-lifecycle@1) for the search bar. Its only file is ctx.dataDir/config.json. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: the banner search bar is drawn by this plugin on the next console load'); }
export async function onUninstall(ctx) { ctx.log('removing the matching options; the framework search-bar widget type stays (its plain search box comes back)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
