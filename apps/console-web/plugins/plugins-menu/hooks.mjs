/** Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes is inside ctx.dataDir (archives.json with the archives' credentials, config.json; 0600). */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the archive list and its stored credentials'); }
export async function checks(ctx) {
  const f = join(ctx.dataDir, 'archives.json');
  const priv = !existsSync(f) || (statSync(f).mode & 0o077) === 0;
  return [{ id: 'archives-private', ok: priv, detail: priv ? 'archive credentials are private (0600) or not saved yet' : `${f} is readable by others: chmod 600` }];
}
