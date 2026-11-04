/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps nothing in its data folder: the cap's store (settings + queue)
 * belongs to framework/cli/agent-slots.mjs, which the VPS launcher uses with or without this plugin. Uninstalling the
 * plugin only removes the console's view of it; the cap keeps working from its saved settings.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CLI = new URL('../../../../framework/cli/agent-slots.mjs', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log(`agent cap engine: ${CLI}`); }
export async function onUninstall(ctx) { ctx.log('agent cap view removed; the VPS cap keeps its settings (node framework/cli/agent-slots.mjs settings)'); }
export async function checks() { return [{ id: 'engine', ok: existsSync(CLI), detail: 'framework/cli/agent-slots.mjs' }, { id: 'server', ok: existsSync(join(new URL('.', import.meta.url).pathname, 'server/__init__.py')), detail: 'server/__init__.py' }]; }
