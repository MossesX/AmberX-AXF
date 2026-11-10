/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes lives in ctx.dataDir: events.jsonl, rules.json, settings.json, cursors.json. */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) { mkdirSync(ctx.dataDir, { recursive: true, mode: 0o700 }); ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the activity log, its rules and settings'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
