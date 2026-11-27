#!/usr/bin/env node
/**
 * Audio Output Recorder installer (plugin-lifecycle@1). Enables it on the console: the recordings the paired phone
 * sends to axHub, their transcripts and search.
 *   node apps/console-web/plugins/output-recorder/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'output-recorder');
