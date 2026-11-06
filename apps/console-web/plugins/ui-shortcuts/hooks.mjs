/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes (shortcuts.json, live.json, recent.json) lives in ctx.dataDir. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (shortcuts.json is made on the first shortcut)`); }
export async function onUninstall(ctx) { ctx.log('removing the UI shortcuts data (your shortcuts, the live registry cache)'); }
export async function checks(ctx) {
  const f = join(ctx.dataDir, 'shortcuts.json');
  let count = 0;
  try { count = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).shortcuts ?? []).length : 0; } catch { count = -1; }
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'shortcuts', ok: count >= 0, detail: count < 0 ? `${f} is not JSON` : `${count} shortcut(s)` },
  ];
}
