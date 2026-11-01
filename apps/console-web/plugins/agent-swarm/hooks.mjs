/** Lifecycle hooks (plugin-lifecycle@1). Swarm state (agents, runs, chat) lives in the data folder only. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log(`roster: ${join(HERE, 'agents/roster.json')}`); }
export async function onUninstall(ctx) { ctx.log('agent swarm removed; worktrees under its data folder go with it'); }
export async function checks() { return [{ id: 'roster', ok: existsSync(join(HERE, 'agents/roster.json')), detail: 'agents/roster.json' }]; }
