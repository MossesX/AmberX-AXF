/**
 * Lifecycle hooks (plugin-lifecycle@1). The settings live in AmberX's own hub-settings@1 document on axHub
 * (/projects/_shared/_data/settings/apps/amberx-droid.json); uninstalling leaves it (plugin.json → keeps).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log('AmberX settings: Settings → Plugins → AmberX, over the hub-settings@1 document every phone mirrors'); }
export async function onUninstall(ctx) { ctx.log('AmberX settings tab removed; the phones keep their settings document on axHub'); }
export async function checks() {
  return [
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
    { id: 'registry', ok: existsSync(join(HERE, 'registry.json')), detail: 'registry.json' },
  ];
}
