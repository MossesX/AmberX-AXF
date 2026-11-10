/**
 * Lifecycle hooks (plugin-lifecycle@1). The data folder holds only this plugin's settings (banner widget, Terminal
 * column, floating overlay, plan prices). The accounts belong to the VPS host and the Claude accounts plugin; the order
 * belongs to the build orchestrator, so uninstalling leaves both alone.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log(`Claude accounts manager ready: ${ctx.dataDir}`); }
export async function onUninstall(ctx) { ctx.log('Claude accounts manager removed: the Terminal column, banner widget and overlay go with it; the account order stays with the orchestrator'); }
export async function checks() {
  return [
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
    { id: 'web', ok: existsSync(join(HERE, 'web/index.tsx')), detail: 'web/index.tsx' },
  ];
}
