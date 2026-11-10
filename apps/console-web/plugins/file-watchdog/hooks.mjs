/** Lifecycle hooks (plugin-lifecycle@1). Everything the watchdog writes (watches.json, events.jsonl) stays in ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (no watches yet: add one on the File watchdog page or with axf file-watchdog add)`); }
export async function onUninstall(ctx) { ctx.log('removing the file watchdog\'s watches and event log'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
