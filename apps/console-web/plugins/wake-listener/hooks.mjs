/**
 * Lifecycle hooks (plugin-lifecycle@1). The data folder holds the settings (wake phrases, switch) and the last state the
 * console reported; uninstalling with --data removes them (a backup is made first).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log('Wake listener: settings and the last reported state live in the data folder; the mic light appears on the banner once the console reloads'); }
export async function onUninstall(ctx) { ctx.log('Wake listener removed: the console stops listening for a wake phrase; the agent voice and AmberX hands-free are not affected'); }
export async function checks() {
  return [
    { id: 'core', ok: existsSync(join(HERE, 'core.mjs')), detail: 'core.mjs' },
    { id: 'catalog', ok: existsSync(join(HERE, 'catalog.mjs')), detail: 'catalog.mjs' },
    { id: 'cli', ok: existsSync(join(HERE, 'listener.mjs')), detail: 'listener.mjs' },
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
  ];
}
