/** Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes is inside ctx.dataDir (keys.json, 0600). */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the stored AI keys'); }
export async function checks(ctx) {
  const f = join(ctx.dataDir, 'keys.json');
  const priv = !existsSync(f) || (statSync(f).mode & 0o077) === 0;
  return [{ id: 'keys-private', ok: priv, detail: priv ? 'keys file is private (0600) or not made yet' : `${f} is readable by others: chmod 600` }];
}
