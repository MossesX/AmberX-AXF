/** Lifecycle hooks (plugin-lifecycle@1) for Container access. Everything stays inside ctx.dataDir. */
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export async function onInstall(ctx) {
  mkdirSync(join(ctx.dataDir, 'batches'), { recursive: true, mode: 0o700 });
  const f = join(ctx.dataDir, 'settings.json');
  if (!existsSync(f)) {
    writeFileSync(f, JSON.stringify({ $axf: 'container-access-settings@1', reach: 'all', allow: [], protect: [] }, null, 2));
    chmodSync(f, 0o600);
    ctx.log('seeded settings.json (every container except the protected list is reachable)');
  } else ctx.log('kept the existing settings.json');
  ctx.log('on the VPS, run deploy/install-console.sh once so the Docker socket proxy starts');
}

export async function onUninstall(ctx) {
  ctx.log('removing settings, the audit log and change batches; the proxy container goes on the next install-console.sh run');
}

export async function checks(ctx) {
  return [
    { id: 'data-folder', ok: existsSync(ctx.dataDir), detail: ctx.dataDir },
    { id: 'proxy-url', ok: true, detail: process.env.AXF_DOCKER_PROXY || 'AXF_DOCKER_PROXY not set here (set by install-console.sh in the console container)' },
  ];
}
