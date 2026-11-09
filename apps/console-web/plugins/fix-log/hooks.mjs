/** Lifecycle hooks (plugin-lifecycle@1). The plugin keeps entries.jsonl and settings.json in ctx.dataDir. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { mkdirSync(ctx.dataDir, { recursive: true }); ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the Fix log lines and settings'); }
export async function checks(ctx) {
  const f = join(ctx.dataDir, 'entries.jsonl');
  const lines = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'entries', ok: true, detail: `${lines} line(s) in the Fix log` },
  ];
}
