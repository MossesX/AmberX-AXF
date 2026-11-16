#!/usr/bin/env node
/**
 * Pending banner installer (plugin-lifecycle@1). Creates the data folder and enables the plugin.
 *   node apps/console-web/plugins/pending-banner/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'pending-banner');
