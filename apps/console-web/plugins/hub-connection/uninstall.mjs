#!/usr/bin/env node
/**
 * axHub connection uninstaller (plugin-lifecycle@1). Removes only the axHub connection: the banner, badge and clock asset types
 * stay in the framework.
 *   node apps/console-web/plugins/hub-connection/uninstall.mjs [--data]          last test result, enabled flag
 *   node apps/console-web/plugins/hub-connection/uninstall.mjs --all [--publish] + this folder and its doc lines
 * Then: node framework/cli/plugin-lifecycle.mjs check hub-connection --after-uninstall
 */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'hub-connection');
