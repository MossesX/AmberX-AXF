/** Lifecycle hooks (plugin-lifecycle@1). The bugs list itself is _claude/builds/bugs.json (kept, see plugin.json). */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('the bugs list (_claude/builds/bugs.json) is kept with the builds store'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
