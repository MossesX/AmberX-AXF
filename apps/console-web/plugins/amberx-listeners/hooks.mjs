/**
 * Lifecycle hooks (plugin-lifecycle@1). Everything this plugin shows lives on the hub (the phones' listener-state
 * documents, AmberX's settings document), not in its data folder, so uninstalling leaves them (plugin.json → keeps).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log('AmberX listeners: devices from amberx-axf/_data/listeners/devices, policies in the AmberX settings document on the hub'); }
export async function onUninstall(ctx) { ctx.log('AmberX listeners page removed; the phones keep publishing to the hub and keep their own Listeners panel'); }
export async function checks() {
  return [
    { id: 'core', ok: existsSync(join(HERE, 'core.mjs')), detail: 'core.mjs' },
    { id: 'cli', ok: existsSync(join(HERE, 'listeners.mjs')), detail: 'listeners.mjs' },
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
    { id: 'registry', ok: existsSync(join(HERE, '../../../../framework/libs/listeners/registry.json')), detail: 'framework/libs/listeners/registry.json' },
  ];
}
