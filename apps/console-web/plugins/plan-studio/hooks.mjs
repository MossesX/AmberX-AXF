/**
 * Lifecycle hooks (plugin-lifecycle@1). Plans live in the plan store (plans.mjs storeDir: the hub's shared data where
 * /projects is mounted, else this plugin's data folder). Install sets up the store (any seed plans in data/plans are
 * copied in, never over a plan that exists; none ship today); uninstall removes the data folder only — plans on the hub
 * are shared data and stay. An empty store is healthy.
 */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  const { seed, storeDir } = await import('./plans.mjs');
  const added = seed();
  ctx.log(added.length ? `seed plans copied to ${storeDir()}: ${added.join(', ')}` : `plans: ${storeDir()}`);
}
export async function onUninstall(ctx) { ctx.log('removing the Plan Studio data folder (plans in the hub shared data stay: other sessions use them)'); }
export async function checks(ctx) {
  const { loadPlans, storeDir, onHub } = await import('./plans.mjs');
  const { validate } = await import('./web/plan-core.mjs');
  const plans = loadPlans();
  const bad = plans.filter((p) => validate(p).length);
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'store', ok: existsSync(storeDir()), detail: `${storeDir()}${onHub() ? ' (hub shared data)' : ''}` },
    { id: 'plans', ok: !bad.length, detail: `${plans.length} plans${bad.length ? `, ${bad.length} invalid: ${bad.map((p) => p.id).join(', ')}` : ''}` },
  ];
}
