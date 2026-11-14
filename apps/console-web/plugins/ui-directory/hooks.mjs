/** Lifecycle hooks (plugin-lifecycle@1): the built directory lives only in ctx.dataDir. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  process.env.AXF_UI_DIRECTORY_DIR = ctx.dataDir;
  const { writeDirectory } = await import('./directory.mjs');
  const r = writeDirectory({ reason: 'install' });
  ctx.log(`ui directory built: ${r.directory.total} rows in ${ctx.dataDir}`);
}
export async function onUninstall(ctx) { ctx.log('removing the built UI directory and its change log'); }
export async function checks(ctx) {
  return [{ id: 'directory', ok: existsSync(join(ctx.dataDir, 'directory.json')), detail: join(ctx.dataDir, 'directory.json') }];
}
