#!/usr/bin/env node
/**
 * Search bar uninstaller (plugin-lifecycle@1). Removes only this plugin's bars and options: the framework's search-bar
 * widget type stays, and its plain search box comes back in the banner.
 *   node apps/console-web/plugins/search-bar/uninstall.mjs [--data]          matching options
 *   node apps/console-web/plugins/search-bar/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check search-bar --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'search-bar');
