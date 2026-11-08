/** Lifecycle hooks (plugin-lifecycle@1). The plugin keeps no server data: favourites, recents and settings live in the browser's settings (axf.menus.*). */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (no data is written here; settings are per device)`); }
export async function onUninstall(ctx) { ctx.log('nested menus removed: the shared app-menu and nav-menu assets show again on the next load'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
