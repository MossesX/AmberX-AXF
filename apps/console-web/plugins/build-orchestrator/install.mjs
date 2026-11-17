#!/usr/bin/env node
/**
 * Installer (plugin-lifecycle@1): data folder + hooks.mjs onInstall + enable, then the build watchdog's cron
 * (/etc/cron.d/axf-watchdog, every minute under flock; skipped where there is no cron.d, e.g. the console container).
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
import { installCron } from './recovery-watchdog.mjs';

await main(['install', ...process.argv.slice(2)], 'build-orchestrator');
if (!process.argv.includes('--dry-run')) {
  const r = installCron();
  console.log(r.ok ? (r.skipped ? `watchdog cron: skipped (${r.skipped})` : `watchdog cron: ${r.file}`) : `watchdog cron: not installed (${r.error})`);
}
