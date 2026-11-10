/** Lifecycle hooks (plugin-lifecycle@1): the built catalog lives only in ctx.dataDir. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  process.env.AXF_GLOSSARY_DIR = ctx.dataDir;
  const { writeCatalog } = await import('./catalog.mjs');
  const r = writeCatalog({ reason: 'install' });
  ctx.log(`glossary built: ${r.catalog.total} entries in ${ctx.dataDir}`);
}
export async function onUninstall(ctx) { ctx.log('removing the built glossary and its change log'); }
export async function checks(ctx) {
  return [{ id: 'catalog', ok: existsSync(join(ctx.dataDir, 'catalog.json')), detail: join(ctx.dataDir, 'catalog.json') }];
}
