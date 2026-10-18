#!/usr/bin/env node
/**
 * Agent manager installer (plugin-lifecycle@1). Creates the data folder, enables the plugin; add-on agents are
 * installed from Settings → Plugins → Agent manager → Add-ons (or pass --addons to install the three bundled ones now:
 * that needs the console server running, because add-ons install through its API).
 *   node apps/console-web/plugins/agent-manager/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2).filter((a) => a !== '--addons')], 'agent-manager');
