#!/usr/bin/env node
/**
 * Audio Output Recorder uninstaller (plugin-lifecycle@1). It keeps no data on the console; recordings stay on axHub
 * (hub project `amberx-recordings`, they're the person's).
 * --all removes this folder and its doc lines.
 *   node apps/console-web/plugins/output-recorder/uninstall.mjs [--all] [--dry-run] [--json]
 * Then: node framework/cli/plugin-lifecycle.mjs check output-recorder --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'output-recorder');
