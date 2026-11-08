#!/usr/bin/env node
/** Uninstaller (plugin-lifecycle@1): disable, run hooks.mjs onUninstall, remove the data folder (and the code with --code). */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'nested-menus');
