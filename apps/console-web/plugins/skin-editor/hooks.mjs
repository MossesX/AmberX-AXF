/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes (sessions, exported skins) stays inside ctx.dataDir. */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  for (const d of ['sessions', 'skins']) mkdirSync(join(ctx.dataDir, d), { recursive: true });
  ctx.log(`ready: ${ctx.dataDir} (sessions/, skins/)`);
}
export async function onUninstall(ctx) { ctx.log('removing the Skin editor sessions and exported skins'); }
export async function checks(ctx) {
  const count = (d) => (existsSync(join(ctx.dataDir, d)) ? readdirSync(join(ctx.dataDir, d)).filter((f) => f.endsWith('.json')).length : 0);
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'sessions', ok: true, detail: `${count('sessions')} session(s)` },
    { id: 'skins', ok: true, detail: `${count('skins')} exported skin(s)` },
  ];
}
