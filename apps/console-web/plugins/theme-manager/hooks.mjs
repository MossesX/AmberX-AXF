/** Lifecycle hooks (plugin-lifecycle@1) for the Theme manager. Everything stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: nav → Plugins → Theme manager'); }
export async function onUninstall(ctx) { ctx.log('removing saved themes and presets (export the ones you want first)'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
