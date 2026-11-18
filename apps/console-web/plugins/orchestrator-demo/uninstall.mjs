#!/usr/bin/env node
/**
 * Orchestrator demo uninstaller (plugin-lifecycle@1). Run records and demo fixtures live only in the data folder; the
 * demo-run@1 core, its schema and the demo-build@1 sandbox stay in the framework.
 *   node apps/console-web/plugins/orchestrator-demo/uninstall.mjs [--data]          run records, enabled flag
 *   node apps/console-web/plugins/orchestrator-demo/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check orchestrator-demo --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'orchestrator-demo');
