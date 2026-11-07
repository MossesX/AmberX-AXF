/**
 * Lifecycle hooks (plugin-lifecycle@1). The Data set bar has no server part and writes no files: its attachments
 * (data-set-bar.attachments) and default picks (data-set-bar.defaults) live in the app's settings in the browser
 * (local-first), and the filters / sorts it applies are runtime transforms on lib-datagrid datasets that leave with
 * the plugin. The asset types it draws from (search-bar, filter-button, sort-control, data-set-bar) are the framework's.
 */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: right-click any data set → Attach data set bar (hidden until attached)'); }
export async function onUninstall(ctx) { ctx.log('nothing on disk to remove: bars are runtime transforms; browser settings keys data-set-bar.* are ignored once the plugin is gone'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
