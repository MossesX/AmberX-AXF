/**
 * Lifecycle hooks (plugin-lifecycle@1). The saved logins and the script live on the VPS host, not in this plugin, so
 * uninstalling leaves them there (plugin.json → lifecycle.keeps). The data folder holds only the email + plan last seen
 * per account.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log('Claude accounts: needs the VPS host script /usr/local/bin/claude-account'); }
export async function onUninstall(ctx) { ctx.log('Claude accounts removed; the saved logins stay on the VPS host in /root/.claude-accounts'); }
export async function checks() {
  return [{ id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' }];
}
