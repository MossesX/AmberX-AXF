/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps only the switch (state.json) in ctx.dataDir; the follow
 * streams and the recent list live in the console server's memory and go with it.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  ctx.log(`ready: ${ctx.dataDir} (Follow Amber starts off)`);
}
export async function onUninstall(ctx) { ctx.log('removing the Follow Amber switch'); }
export async function checks(ctx) {
  const f = join(ctx.dataDir, 'state.json');
  let on = false;
  try { on = JSON.parse(readFileSync(f, 'utf8')).on === true; } catch { /* never switched */ }
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'switch', ok: true, detail: on ? 'Follow Amber is on' : 'Follow Amber is off' },
  ];
}
