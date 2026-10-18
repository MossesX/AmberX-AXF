#!/usr/bin/env node
/**
 * AI assistant installer (plugin-lifecycle@1). Creates the plugin's data folder, seeds its config, enables it.
 *   node apps/console-web/plugins/ai-assistant/install.mjs [--json]
 * Same as Settings → AI assistant → Install & uninstall → Install.
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'ai-assistant');
