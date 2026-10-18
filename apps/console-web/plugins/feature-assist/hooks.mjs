/** Lifecycle hooks (plugin-lifecycle@1) for the Feature assistant. Everything stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';

export async function onInstall(ctx) { ctx.log('ready: the Plan view shows “Describe a feature” once the AI assistant and the AXF expert are installed'); }
export async function onUninstall(ctx) { ctx.log('removing the build history; features already in the plan and pending list stay'); }
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
