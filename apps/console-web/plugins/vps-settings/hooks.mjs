/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps nothing in its data folder: the settings store and the
 * refused-jobs log belong to framework/cli/vps-settings.mjs, which the VPS launchers use with or without this plugin.
 * Uninstalling the plugin only removes the console's view; the VPS keeps enforcing its saved settings.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CLI = new URL('../../../../framework/cli/vps-settings.mjs', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log(`VPS settings engine: ${CLI}`); }
export async function onUninstall(ctx) { ctx.log('VPS Settings view removed; the VPS keeps its settings (node framework/cli/vps-settings.mjs get)'); }
export async function checks() { return [{ id: 'engine', ok: existsSync(CLI), detail: 'framework/cli/vps-settings.mjs' }, { id: 'server', ok: existsSync(join(new URL('.', import.meta.url).pathname, 'server/__init__.py')), detail: 'server/__init__.py' }]; }
