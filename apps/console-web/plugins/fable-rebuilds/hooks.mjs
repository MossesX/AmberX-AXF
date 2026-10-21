/** Lifecycle hooks (plugin-lifecycle@1). Fable rebuilds keeps no data of its own: everything lives on the pending list
 * and in _claude/memory/docs/rebuilds/, which belong to the framework, not this plugin. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log('ready (no data of its own)'); }
export async function onUninstall(ctx) { ctx.log('nothing to remove beyond this folder'); }
export async function checks(ctx) {
  return [{ id: 'pending-list', ok: existsSync(join(ctx.root ?? process.cwd(), 'framework', 'plan', 'pending.json')), detail: 'framework/plan/pending.json' }];
}
