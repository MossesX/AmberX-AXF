/** Lifecycle hooks (plugin-lifecycle@1) for the push banner. Everything stays inside ctx.dataDir. */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANDER_SERVICE = join(dirname(fileURLToPath(import.meta.url)), 'land', 'lander-service.sh');

export async function onInstall(ctx) { ctx.log('ready: the banner lists branches not on main on the next console load (needs GITHUB_TOKEN on the console server)'); }
export async function onUninstall(ctx) {
  ctx.log('removing the watched repos and hidden branches');
  // the lander's systemd unit (root on the host only; elsewhere there is none to remove)
  if (existsSync('/etc/systemd/system/axf-lander.service') && existsSync(LANDER_SERVICE)) { const r = spawnSync('bash', [LANDER_SERVICE, 'remove'], { encoding: 'utf8', timeout: 60000 }); ctx.log((r.stdout || r.stderr || '').trim() || 'lander service removed'); }
}
export async function checks(ctx) { return [{ id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir }]; }
