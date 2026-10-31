/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes is inside ctx.dataDir (store, keys, audio cache). */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (voice profiles, mic settings, cloud keys, audio cache)`); }
export async function onUninstall(ctx) { ctx.log('removing agent voices, the mic settings, the stored cloud keys and the audio cache'); }
export async function checks(ctx) {
  const cache = join(ctx.dataDir, 'cache');
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'audio-cache', ok: true, detail: existsSync(cache) ? `${readdirSync(cache).length} cached clips` : 'empty' },
  ];
}
