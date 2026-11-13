/** Lifecycle hooks (plugin-lifecycle@1). The tracker (_claude/builds/orchestrator.json) is a project file: uninstall never deletes it. */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { trackerFile } from './orchestrator.mjs';
import { DATA_FILES as RECOVERY_FILES, dataDir as recoveryDir } from './recover.mjs';

export async function onInstall(ctx) { ctx.log(`tracker: ${trackerFile()}`); }
export async function onUninstall(ctx) {
  // auto-recovery's files sit in the pipeline's data folder (shared with the host): recovery-state.json, recovery.jsonl,
  // recovery.lock, recovery-request.json. The per-build recovery records stay in the builds store (project data).
  const dir = recoveryDir();
  for (const f of RECOVERY_FILES) { const p = join(dir, f); if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); ctx.log(`removed ${p}`); } }
  ctx.log('build orchestrator removed; the tracker file stays in _claude/builds/');
}
export async function checks() {
  return [
    { id: 'tracker', ok: existsSync(trackerFile()), detail: trackerFile() },
    { id: 'recovery', ok: existsSync(new URL('./recover.mjs', import.meta.url)), detail: `auto-recovery data in ${recoveryDir()} (${RECOVERY_FILES.join(', ')})` },
  ];
}
