/**
 * Lifecycle hooks (plugin-lifecycle@1). Everything the plugin keeps is in its data folder (settings, the host's
 * snapshot, plans, run results, state). The host part (a cron file) removes itself once this folder is gone.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
export async function onInstall(ctx) { ctx.log(`ready: ${ctx.dataDir}; the host part installs with deploy/install-console.sh (deploy/host.sh up)`); }
export async function onUninstall(ctx) { ctx.log('removing maintenance data (settings, snapshot, plans, runs, host jobs); the host runner removes its systemd unit once this folder is gone'); }
export async function checks(ctx) {
  return [
    { id: 'engine', ok: existsSync(join(HERE, 'engine/maint.py')), detail: 'engine/maint.py' },
    { id: 'server', ok: existsSync(join(HERE, 'server/__init__.py')), detail: 'server/__init__.py' },
    { id: 'host-part', ok: existsSync(join(HERE, 'deploy/host.sh')), detail: 'deploy/host.sh' },
    { id: 'host-runner', ok: existsSync(join(HERE, 'engine/hostd.py')), detail: 'engine/hostd.py (systemd axf-maintenance.service)' },
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
  ];
}
