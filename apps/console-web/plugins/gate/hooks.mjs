/** Lifecycle hooks (plugin-lifecycle@1). Every file the plugin writes stays inside ctx.dataDir. */
import { existsSync, mkdirSync } from 'node:fs';

export async function onInstall(ctx) { mkdirSync(ctx.dataDir, { recursive: true }); ctx.log(`ready: ${ctx.dataDir} (rules are migrated from the lander settings on first read)`); }
export async function onUninstall(ctx) { ctx.log('removing the gate rules and history (the lander keeps its own settings)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
