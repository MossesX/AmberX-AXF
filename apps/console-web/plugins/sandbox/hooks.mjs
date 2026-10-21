/** Lifecycle hooks (plugin-lifecycle@1). Every file the sandbox writes is inside ctx.dataDir (workspaces, config, log). */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) { ctx.log(`sandbox data: ${ctx.dataDir} (workspaces stay until an admin clears them)`); }
export async function onUninstall(ctx) { ctx.log('removing every sandbox workspace, the sandbox config and its activity log'); }
export async function checks(ctx) {
  const ws = join(ctx.dataDir, 'workspaces');
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'workspaces-private', ok: !existsSync(ws) || (statSync(ws).mode & 0o077) === 0, detail: 'workspace folders are owner-only' },
    { id: 'axhub-token', ok: true, detail: process.env.AXHUB_TOKEN ? 'axHub token set: the GitHub tab can read' : 'no AXHUB_TOKEN here: the GitHub tab says so until the console has one' },
  ];
}
