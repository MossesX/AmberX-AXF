#!/usr/bin/env node
/**
 * Container access installer (plugin-lifecycle@1). Creates the data folder, seeds settings, enables the plugin.
 *   node apps/console-web/plugins/container-access/install.mjs [--json]
 * The Docker socket proxy itself starts on the VPS with deploy/install-console.sh (it runs this plugin's deploy/host.sh).
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'container-access');
