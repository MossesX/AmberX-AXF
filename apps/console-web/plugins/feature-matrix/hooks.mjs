/**
 * Lifecycle hooks (plugin-lifecycle@1). The matrices files (_claude/builds/[profiles/<id>/]matrices.json) are project
 * files next to each profile's orchestrator tracker: uninstall never deletes them. Only the data folder (Apply reports,
 * the mirror) goes.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { activeId, matricesFile } from './matrix.mjs';

export async function onInstall(ctx) { mkdirSync(ctx.dataDir, { recursive: true }); ctx.log(`matrices: ${matricesFile(activeId())}`); }
export async function onUninstall(ctx) { ctx.log('feature matrix removed; the matrices files stay in _claude/builds/'); }
export async function checks(ctx) {
  const f = matricesFile(activeId());
  return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }, { id: 'matrices', ok: true, detail: existsSync(f) ? f : `${f} (made on the first save)` }];
}
