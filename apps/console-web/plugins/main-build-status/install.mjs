#!/usr/bin/env node
/**
 * Main build status installer (plugin-lifecycle@1). Creates the data folder and enables the plugin.
 *   node apps/console-web/plugins/main-build-status/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'main-build-status');
