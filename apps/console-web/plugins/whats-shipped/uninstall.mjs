#!/usr/bin/env node
/**
 * What's new uninstaller (plugin-lifecycle@1). Removes only this plugin's banner widget: the banner and the status
 * widget type stay in the framework.
 *   node apps/console-web/plugins/whats-shipped/uninstall.mjs [--data]          feed cache, file lists, settings
 *   node apps/console-web/plugins/whats-shipped/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check whats-shipped --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'whats-shipped');
