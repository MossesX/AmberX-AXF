/** Lifecycle hooks (plugin-lifecycle@1). The tracker (_claude/builds/orchestrator.json) is a project file: uninstall never deletes it. */
import { existsSync } from 'node:fs';
import { trackerFile } from './orchestrator.mjs';

export async function onInstall(ctx) { ctx.log(`tracker: ${trackerFile()}`); }
export async function onUninstall(ctx) { ctx.log('build orchestrator removed; the tracker file stays in _claude/builds/'); }
export async function checks() { return [{ id: 'tracker', ok: existsSync(trackerFile()), detail: trackerFile() }]; }
