#!/usr/bin/env node
/** Uninstaller (plugin-lifecycle@1): hooks.mjs onUninstall + disable. */
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
await main(['uninstall', ...process.argv.slice(2)], 'toolbar-widgets');
