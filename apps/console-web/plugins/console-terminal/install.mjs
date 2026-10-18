#!/usr/bin/env node
/**
 * Terminal installer (plugin-lifecycle@1). Creates the data folder and seeds settings, enables the plugin.
 *   node apps/console-web/plugins/console-terminal/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'console-terminal');
