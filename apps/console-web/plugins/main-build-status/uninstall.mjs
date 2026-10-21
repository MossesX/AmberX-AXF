#!/usr/bin/env node
/**
 * Main build status uninstaller (plugin-lifecycle@1). Removes only this plugin's banner dot: the banner and the status
 * widget type stay in the framework.
 *   node apps/console-web/plugins/main-build-status/uninstall.mjs [--data]          watched repos, enabled flag
 *   node apps/console-web/plugins/main-build-status/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check main-build-status --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'main-build-status');
