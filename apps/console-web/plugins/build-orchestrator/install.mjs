#!/usr/bin/env node
/**
 * Installer (plugin-lifecycle@1): data folder + hooks.mjs onInstall + enable, then the Pipeline 2.0 schedules
 * (deploy/watchdog/cron.mjs install: the orchestrator tick, the layer-2 watchdog, the audits and layer 3; it also removes
 * the retired axf-pipeline, axf-auto-land and axf-watchdog crons). Skipped where there is no /etc/cron.d (the console
 * container).
 */
import { existsSync } from 'node:fs';
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';

await main(['install', ...process.argv.slice(2)], 'build-orchestrator');
if (!process.argv.includes('--dry-run')) {
  if (!existsSync('/etc/cron.d') && !process.env.AXF_WATCHDOG2_CRON_DIR) console.log('pipeline schedules: skipped (no /etc/cron.d here)');
  else {
    try {
      const { install } = await import('../../../../deploy/watchdog/cron.mjs');
      const r = install();
      console.log(`pipeline schedules: ${r.written.length ? `wrote ${r.written.join(', ')}` : 'up to date'}${r.removed.length ? `; removed retired ${r.removed.join(', ')}` : ''}`);
    } catch (e) { console.log(`pipeline schedules: not installed (${String(e.message || e).slice(0, 200)})`); }
  }
}
