#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines.
 * --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json. The build watchdog's cron
 * (/etc/cron.d/axf-watchdog) goes first, so nothing runs a pass while the plugin is taken out.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
import { removeCron } from './watchdog/sessions.mjs';

if (!process.argv.includes('--dry-run')) {
  const r = removeCron();
  console.log(r.ok ? `watchdog cron: ${r.removed ? `removed ${r.file}` : 'none'}` : `watchdog cron: not removed (${r.error})`);
}
await main(['uninstall', ...process.argv.slice(2)], 'build-orchestrator');
