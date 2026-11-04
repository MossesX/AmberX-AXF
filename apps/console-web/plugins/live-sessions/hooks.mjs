/** Lifecycle hooks (plugin-lifecycle@1). Data: state.json (check-ins, picks, settings, storage), audit.jsonl and recordings/. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('check-ins, the watch log and recordings in the data folder go with it (recordings moved elsewhere stay there)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
