/** Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes (settings.json, cache/) stays in ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir} (AI features off by default)`); }
export async function onUninstall(ctx) { ctx.log('removing Build search settings and its session cache'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
