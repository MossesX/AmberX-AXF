/** Lifecycle hooks (plugin-lifecycle@1). The tracker (_claude/builds/orchestrator.json) is a project file: uninstall never deletes it. */
import { existsSync } from 'node:fs';
import { trackerFile } from './orchestrator.mjs';
import * as cron from './watchdog/cron.mjs';

export async function onInstall(ctx) {
  ctx.log(`tracker: ${trackerFile()}`);
  const c = cron.install();
  ctx.log(`stale-row watchdog cron: ${c.skipped ?? (c.ok ? `${c.unchanged ? 'already' : 'installed'} ${c.file}` : `not installed (${c.why})`)}`);
}
export async function onUninstall(ctx) {
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
