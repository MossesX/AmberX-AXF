/** Lifecycle hooks (plugin-lifecycle@1). The Build manager keeps no data of its own: it reads the pending list, the
 * build queue and the plan (framework data) and the activity feed (capability axf.activity@1). Its three preferences
 * are browser settings (build-manager.*), removed with the plugin's settings module. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log('ready (no data of its own)'); }
export async function onUninstall(ctx) { ctx.log('nothing to remove beyond this folder'); }
export async function checks(ctx) {
  const root = ctx.root ?? process.cwd();
  return ['pending.json', 'build-queue.json', 'plan.json'].map((f) => ({ id: f, ok: existsSync(join(root, 'framework', 'plan', f)), detail: `framework/plan/${f}` }));
}
