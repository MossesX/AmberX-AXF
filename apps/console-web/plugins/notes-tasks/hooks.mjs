/** Lifecycle hooks (plugin-lifecycle@1). The notes, to-dos and tasks are Brett's (on the hub) and are never removed here. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const storeDir = () => process.env.AXF_AMBERX_NOTES_DIR || join(process.env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data', 'amberx-notes');

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}; the one store is at ${storeDir()}`); }
export async function onUninstall(ctx) { ctx.log(`removing the plugin; the backups in its data folder go with it, the store stays at ${storeDir()}`); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'store', ok: true, detail: existsSync(storeDir()) ? storeDir() : `${storeDir()} (not mounted on this machine)` },
  ];
}
