/** Lifecycle hooks (plugin-lifecycle@1). Stored: holds.json (PRs put on hold) and batches.json (push batches). */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('holds and batches go with the data folder; held PRs merge again'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
