/** Lifecycle hooks (plugin-lifecycle@1). The tracker (_claude/builds/orchestrator.json) is a project file: uninstall never deletes it. */
import { existsSync } from 'node:fs';
import { trackerFile } from './orchestrator.mjs';
import * as cron from './watchdog/cron.mjs';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

export async function onInstall(ctx) {
  ctx.log(`tracker: ${trackerFile()}`);
  const c = cron.install();
  ctx.log(`stale-row watchdog cron: ${c.skipped ?? (c.ok ? `${c.unchanged ? 'already' : 'installed'} ${c.file}` : `not installed (${c.why})`)}`);
}
export async function onUninstall(ctx) {
  // the 15-second liveness timer (deploy/systemd/axf-liveness.*, installed by deploy/install-console.sh)
  try { spawnSync('systemctl', ['disable', '--now', 'axf-liveness.timer'], { stdio: 'ignore' }); for (const u of ['axf-liveness.timer', 'axf-liveness.service']) rmSync(`/etc/systemd/system/${u}`, { force: true }); } catch { /* not a systemd host */ }
  const c = cron.uninstall();
  ctx.log(`build orchestrator removed; the tracker file stays in _claude/builds/; watchdog cron ${c.removed ? 'removed' : 'was not installed'}`);
}
export async function checks() {
  const c = cron.status();
  return [
    { id: 'tracker', ok: existsSync(trackerFile()), detail: trackerFile() },
    { id: 'watchdog-cron', ok: c.installed || !existsSync('/opt/axf/apps/console-web'), detail: c.installed ? c.file : `${c.file} missing: node apps/console-web/plugins/build-orchestrator/install.mjs` },
  ];
}
