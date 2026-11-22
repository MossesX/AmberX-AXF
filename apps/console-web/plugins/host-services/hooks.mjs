/**
 * Lifecycle hooks (plugin-lifecycle@1). The plugin keeps only a small cache in its data folder; the host services
 * themselves are systemd units on the VPS (deploy/install-host-services.sh) and their state lives in the shared data
 * folder (_data/host-services). Uninstalling the plugin removes the console's view and its MCP commands; the units keep
 * running and the client (server/host_services.py) and the systems-check items keep working.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../../', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log('host services view installed; install the units on the VPS with: bash deploy/install-host-services.sh'); }
export async function onUninstall(ctx) { ctx.log('host services view removed; the VPS units keep running (bash deploy/install-host-services.sh --uninstall removes them)'); }
export async function checks() {
  return [
    { id: 'client', ok: existsSync(join(ROOT, 'apps/console-web/server/host_services.py')), detail: 'apps/console-web/server/host_services.py' },
    { id: 'runner', ok: existsSync(join(ROOT, 'deploy/host-services/axf-hostd.mjs')), detail: 'deploy/host-services/axf-hostd.mjs' },
    { id: 'installer', ok: existsSync(join(ROOT, 'deploy/install-host-services.sh')), detail: 'deploy/install-host-services.sh' },
  ];
}
