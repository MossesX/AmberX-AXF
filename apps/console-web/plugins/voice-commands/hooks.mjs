/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps only the audit of runs (runs.jsonl) in ctx.dataDir; the
 * voice commands themselves are each app's src/assets/voice-command/<app>.json in the repo.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  ctx.log(`ready: ${ctx.dataDir}`);
}
export async function onUninstall(ctx) { ctx.log('removing the voice command run log'); }
export async function checks(ctx) {
  const f = join(ctx.dataDir, 'runs.jsonl');
  let runs = 0;
  try { runs = readFileSync(f, 'utf8').split('\n').filter(Boolean).length; } catch { /* nothing run yet */ }
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'runs', ok: true, detail: `${runs} voice command(s) run` },
  ];
}
