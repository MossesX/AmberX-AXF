#!/usr/bin/env node
/**
 * Snapshot Manager installer (plugin-lifecycle@1). Creates the data folder, seeds retention settings, enables it.
 *   node apps/console-web/plugins/snapshot-manager/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'snapshot-manager');
