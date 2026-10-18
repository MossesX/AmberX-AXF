/** Lifecycle hooks (plugin-lifecycle@1). The Plugin Manager keeps no server data; layout/view choices are settings. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the Plugin Manager (its menu link, nav entry and settings tab leave with the code)'); }
export async function checks(ctx) {
  const assets = join(ctx.root, 'apps/console-web/src/assets/context-menu');
  // The context-menu link is contributed at runtime; it must never be written into a context-menu asset.
  let baked = false;
  try { baked = ['compact-classic', 'glass-minimal', 'roomy-touch'].some((f) => readFileSync(join(assets, `${f}.json`), 'utf8').includes('plugin-manager')); } catch { /* assets moved */ }
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'menu-link-not-baked', ok: !baked, detail: baked ? 'a context-menu asset mentions plugin-manager; the link must stay a runtime contribution' : 'runtime contribution only' },
  ];
}
