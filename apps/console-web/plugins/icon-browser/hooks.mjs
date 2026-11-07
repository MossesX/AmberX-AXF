/**
 * Lifecycle hooks (plugin-lifecycle@1) for the Icon Browser. Its data folder holds config.json, sources/ (icon-source
 * assets), secrets.json (the secure store: secret values by ref, 0600, never served), packs/ (icon packs you made or
 * imported) and maps/ (icon maps saved by the Icon Manager). The library itself is read from framework/icon-library.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (the icon library is read from framework/icon-library, never copied)`); }
export async function onUninstall(ctx) { ctx.log('removing the Icon Browser data: sources, their secrets, saved packs and maps; icon picks applied to apps stay in their settings until reset'); }
export async function checks(ctx) {
  const lib = join(ctx.root ?? process.cwd(), 'framework', 'icon-library', 'index.json');
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'library', ok: existsSync(lib), detail: lib },
  ];
}
