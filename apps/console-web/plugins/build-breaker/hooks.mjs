/**
 * Lifecycle hooks (plugin-lifecycle@1). The seed (data/asks.jsonl) lives in this folder; the live copy that sessions
 * add to lives in the data folder (asks.jsonl). Install copies the seed there; uninstall removes only the data folder.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  const { mirrorSeed, MIRROR } = await import('./asks.mjs');
  ctx.log(mirrorSeed() ? `asks copied to ${MIRROR}` : `asks: ${MIRROR}`);
}
export async function onUninstall(ctx) { ctx.log('removing the Build Breaker data folder (the seed in data/asks.jsonl goes with the plugin folder)'); }
export async function checks(ctx) {
  const { load } = await import('./asks.mjs');
  const { doc, files } = load();
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'seed', ok: files.seedFound, detail: files.seed },
    { id: 'asks', ok: doc.asks.length > 0, detail: `${doc.asks.length} asks${existsSync(join(ctx.dataDir, 'asks.jsonl')) ? ' (live copy in the data folder)' : ' (seed only)'}` },
  ];
}
