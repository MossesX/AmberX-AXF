#!/usr/bin/env node
/**
 * Systems check installer (plugin-lifecycle@1). Creates the data folder, seeds settings (AI off), enables the plugin.
 *   node apps/console-web/plugins/systems-check/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'systems-check');
