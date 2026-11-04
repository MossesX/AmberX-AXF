/**
 * Lifecycle hooks (plugin-lifecycle@1). The seed (data/asks.jsonl) lives in this folder; the live copy that sessions
 * add to lives in the data folder (asks.jsonl). Install copies the seed there; uninstall removes only the data folder.
 * The requests ledger (request-ledger@1) lives in the hub's shared data where it exists, like Plan Studio's plans, and
 * stays there on uninstall (other sessions use it); elsewhere it is in the data folder and goes with it.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  const { mirrorSeed, MIRROR } = await import('./asks.mjs');
  ctx.log(mirrorSeed() ? `asks copied to ${MIRROR}` : `asks: ${MIRROR}`);
}
export async function onUninstall(ctx) { ctx.log('removing the Build Breaker data folder (the seed in data/asks.jsonl goes with the plugin folder; a requests ledger in the hub shared data stays)'); }
export async function checks(ctx) {
  const { load } = await import('./asks.mjs');
  const { doc, files } = load();
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'seed', ok: files.seedFound, detail: files.seed },
    ...(await ledgerCheck()),
    { id: 'asks', ok: doc.asks.length > 0, detail: `${doc.asks.length} asks${existsSync(join(ctx.dataDir, 'asks.jsonl')) ? ' (live copy in the data folder)' : ' (seed only)'}` },
  ];
}

async function ledgerCheck() {
  try {
    const { paths, requests } = await import('./requests.mjs');
    const p = await paths();
    const { all, counts } = await requests();
    return [{ id: 'requests', ok: all.length > 0, detail: `${all.length} requests (${counts.builds} builds, ${counts.briefs} briefs, ${counts.plans} plans, ${counts.memory} memory files); ledger ${p.ledger}` }];
  } catch (e) { return [{ id: 'requests', ok: false, detail: e.message }]; }
}
