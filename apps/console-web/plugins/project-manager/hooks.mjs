/** Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes is inside ctx.dataDir (projects.json + projects/<id>/). */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { mkdirSync(join(ctx.dataDir, 'projects'), { recursive: true }); ctx.log(`projects store: ${ctx.dataDir}/projects.json`); }
export async function onUninstall(ctx) { ctx.log('removing the project list and every project\'s builds/notes/data folder (app folders under apps/ stay)'); }
export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'cli', ok: existsSync(join(HERE, 'projects.mjs')), detail: 'projects.mjs' },
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
  ];
}
