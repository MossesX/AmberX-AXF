/** Lifecycle hooks (plugin-lifecycle@1). The decision queue and its settings live in the data folder. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('the data folder (decisions.json, settings.json, answers.jsonl) goes with the data uninstall'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
