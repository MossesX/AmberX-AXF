/** Lifecycle hooks (plugin-lifecycle@1) for the brand library. Its only file is ctx.dataDir/config.json. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (the library itself is read from framework/brand-library, never copied)`); }
export async function onUninstall(ctx) { ctx.log('removing the brand library settings; a brand you applied stays in the app until you pick another'); }
export async function checks(ctx) {
  const lib = join(ctx.root ?? process.cwd(), 'framework', 'brand-library', 'index.json');
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'library', ok: existsSync(lib), detail: lib },
  ];
}
