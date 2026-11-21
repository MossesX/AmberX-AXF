/** Lifecycle hooks (plugin-lifecycle@1) for Status styles. Everything it saves stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: every status takes its shipped style on the next console load (Settings → Plugins → Status styles)'); }
export async function onUninstall(ctx) { ctx.log('removing the saved status styles and your own presets; statuses go back to plain'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
