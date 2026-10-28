/**
 * Lifecycle hooks (plugin-lifecycle@1). Basic filter has no server part and writes no files: its three values
 * (basic-filter.toolbar / .datasets / .state) live in the app's settings in the browser, and its filters are runtime
 * transforms that leave with the plugin. Settings → Plugins → Basic filter → "Back to default" resets the toolbar.
 */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: attach Basic filter to a dataset in Plugin switches or its settings tab'); }
export async function onUninstall(ctx) { ctx.log('nothing on disk to remove: filters are runtime transforms; browser settings keys basic-filter.* are ignored once the plugin is gone'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
