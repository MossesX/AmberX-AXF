/**
 * Lifecycle hooks (plugin-lifecycle@1). The tree lives in the store (tree.mjs storeDir: the hub's shared data where
 * /projects is mounted, else this plugin's data folder). Install makes the data folder and nothing else: the store
 * starts empty and nothing is ever synced into it. Uninstall removes the data folder only; a tree on the hub is shared
 * data and stays. Checks: the data folder, the store, and whether this host can launch hand builds (hand-build.mjs).
 */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  const { storeDir, onHub } = await import('./tree.mjs');
  ctx.log(`Plan Studio 2.0 store: ${storeDir()}${onHub() ? ' (hub shared data)' : ''}; it starts empty`);
}
export async function onUninstall(ctx) { ctx.log('removing the Plan Studio 2.0 data folder (a tree in the hub shared data stays: other sessions use it)'); }
export async function checks(ctx) {
  const { load, storeDir, onHub } = await import('./tree.mjs');
  const { normalize } = await import('./web/tree-core.mjs');
  let count = -1;
  try { count = normalize(load()).items.length; } catch { /* reported below */ }
  const { launchReadiness } = await import('./hand-build.mjs');
  const hand = launchReadiness();
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'hand-build-launch', ok: hand.ok, detail: hand.detail },
    { id: 'store', ok: count >= 0, detail: `${storeDir()}${onHub() ? ' (hub shared data)' : ''}: ${count < 0 ? 'unreadable' : `${count} items`}` },
  ];
}
