/**
 * Lifecycle hooks (plugin-lifecycle@1). Everything the plugin writes is `agent-pick.json` in its data folder (settings,
 * persona / voice notes, sessions). Session bookings live on the agents' cards (the Agent swarm's runs), not here.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log(`Claude agent settings and sessions: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('removing the Claude plugin data (settings, personas, sessions); bookings stay on the agents\' cards'); }
export async function checks() { return [{ id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' }, { id: 'web', ok: existsSync(join(HERE, 'web/index.tsx')), detail: 'web/index.tsx' }]; }
