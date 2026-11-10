#!/usr/bin/env node
/**
 * Skin editor installer (plugin-lifecycle@1). Creates the data folder and enables the plugin.
 *   node apps/console-web/plugins/skin-editor/install.mjs [--json]
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['install', ...process.argv.slice(2)], 'skin-editor');
