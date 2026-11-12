/**
 * Lifecycle hooks (plugin-lifecycle@1). The lists live on the hub (amberx-axf/_data/amberx-notes, through control@1);
 * the data folder holds the page settings only, so uninstalling leaves every list (plugin.json → keeps).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log('AmberX lists: the Lists screen on the console, over control@1 amberx.lists and amberx.items'); }
export async function onUninstall(ctx) { ctx.log('AmberX lists page removed; the lists stay on the hub and in control@1 (axf list …)'); }
export async function checks() {
  return [
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
    { id: 'web', ok: existsSync(join(HERE, 'web/index.tsx')), detail: 'web/index.tsx' },
  ];
}
